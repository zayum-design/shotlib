// Copyright 2026 zayum-design
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * ComfyUI API 格式工作流:类型定义与占位符注入引擎
 *
 * 模板来源:在 ComfyUI 网页里调好工作流 → Export (API Format) → 放入 workflows/ 目录。
 * 需要由调用方注入的参数用 __TOKEN__ 占位(见 WorkflowInjectParams),
 * 注入后校验不允许残留未替换的占位符,防止把工作流里的字面量当参数提交。
 */
import { ModelParameterException } from '../../core/exceptions';

/** 一个 ComfyUI 节点(API 格式) */
export interface ComfyWorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  [key: string]: unknown;
}

/** API 格式工作流:node_id → 节点定义 */
export type ComfyWorkflowTemplate = Record<string, ComfyWorkflowNode>;

/** 可注入参数(均为可选,按模板里实际出现的占位符取用) */
export interface WorkflowInjectParams {
  /** 正向提示词 */
  prompt?: string;
  width?: number;
  height?: number;
  /** 随机种子(缺省由适配器生成) */
  seed?: number;
  /** 采样步数 */
  steps?: number;
  /** H3 视频帧数(17k+5 网格,由秒数换算) */
  length?: number;
  /** 图生图去噪强度 */
  denoise?: number;
  /**
   * 已上传到 ComfyUI /upload/image 的文件名,按键名对应模板占位符:
   * { IMAGE_1: 'xxx.png' } 替换 __IMAGE_1__
   */
  images?: Record<string, string>;
}

/** 占位符 token → 注入值 */
type TokenValue = string | number;

const TOKEN_PATTERN = /^__([A-Z0-9_]+)__$/;
const RESIDUAL_PATTERN = /__([A-Z0-9_]+)__/g;

/**
 * H3 时长(秒)→ 帧数。模型帧网格为 17k+5(124≈5.2s 为训练标准长度),
 * 取最近网格点并夹在训练范围 [124, 362](约 5~15 秒)内。
 */
export function secondsToH3Length(seconds: number): number {
  const frames = Math.round(seconds * 24);
  const k = Math.round((frames - 5) / 17);
  const snapped = 17 * k + 5;
  return Math.min(362, Math.max(124, snapped));
}

/** 生成随机种子(ComfyUI 种子范围 0 ~ 2^63) */
export function randomSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

/** 把模板里所有 __TOKEN__ 占位符替换为实际值(字符串原位替换,数字保持数字类型) */
export function injectWorkflow(
  template: ComfyWorkflowTemplate,
  params: WorkflowInjectParams,
): ComfyWorkflowTemplate {
  // 数值类 token 做字符串→数字转换;提示词/图片名保持字符串
  const numericTokens = new Set(['WIDTH', 'HEIGHT', 'SEED', 'STEPS', 'LENGTH', 'DENOISE']);
  const tokenValues: Record<string, TokenValue> = {};

  if (params.prompt !== undefined) tokenValues.PROMPT = params.prompt;
  if (params.width !== undefined) tokenValues.WIDTH = params.width;
  if (params.height !== undefined) tokenValues.HEIGHT = params.height;
  if (params.seed !== undefined) tokenValues.SEED = params.seed;
  if (params.steps !== undefined) tokenValues.STEPS = params.steps;
  if (params.length !== undefined) tokenValues.LENGTH = params.length;
  if (params.denoise !== undefined) tokenValues.DENOISE = params.denoise;
  for (const [key, filename] of Object.entries(params.images || {})) {
    tokenValues[key] = filename;
  }

  const workflow = structuredClone(template);

  const replaceIn = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    const m = value.match(TOKEN_PATTERN);
    if (!m) return value;
    const replacement = tokenValues[m[1]];
    if (replacement === undefined) return value; // 未提供的占位符留给最终校验报错
    if (numericTokens.has(m[1])) {
      const n = Number(replacement);
      return Number.isFinite(n) ? n : replacement;
    }
    return replacement;
  };

  for (const node of Object.values(workflow)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      node.inputs[key] = replaceIn(value);
    }
  }

  // 校验:不允许残留任何未替换的占位符
  const missing = new Set<string>();
  for (const [nodeId, node] of Object.entries(workflow)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value !== 'string') continue;
      RESIDUAL_PATTERN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RESIDUAL_PATTERN.exec(value)) !== null) {
        missing.add(`${m[1]}(节点 ${nodeId}.${key})`);
      }
    }
  }
  if (missing.size > 0) {
    throw new ModelParameterException(
      `ComfyUI 工作流缺少参数: ${[...missing].join(', ')}`,
      { missing: [...missing] },
    );
  }

  return workflow;
}
