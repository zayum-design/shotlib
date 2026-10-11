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
 * ComfyUI 适配器共享逻辑:服务器地址解析、尺寸映射、工作流模板装载
 */
import { settingsRepo } from '@/storage/settingsRepo';
import { ModelException } from '../../core/exceptions';
import type { AdapterVariant, UnifiedModelRequest } from '../../core/types';
import type { ComfyWorkflowTemplate } from './comfyui-workflow-loader';
import qwenImageT2i from './workflows/qwen-image-t2i.json';
import qwenImageEdit from './workflows/qwen-image-edit.json';
import h3T2v from './workflows/h3-t2v.json';
import h3Fl2v from './workflows/h3-fl2v.json';

/** 内建工作流模板注册表(model.json 变体的 workflow 字段 → 模板) */
const WORKFLOW_TEMPLATES: Record<string, ComfyWorkflowTemplate> = {
  'qwen-image-t2i': qwenImageT2i as unknown as ComfyWorkflowTemplate,
  'qwen-image-edit': qwenImageEdit as unknown as ComfyWorkflowTemplate,
  'h3-t2v': h3T2v as unknown as ComfyWorkflowTemplate,
  'h3-fl2v': h3Fl2v as unknown as ComfyWorkflowTemplate,
};

/** 服务器地址存在厂商 Key 栏;不是密钥,是 http(s) 基址 */
export async function getComfyBaseUrl(): Promise<string> {
  const raw = (await settingsRepo.getApiKey('comfyui')).trim();
  if (!raw) {
    throw new ModelException(
      '请先在设置页填写 ComfyUI 服务器地址(Key 栏)',
      'COMFYUI_NO_BASE_URL',
      400,
      false,
    );
  }
  if (!/^https?:\/\//i.test(raw)) {
    throw new ModelException(
      'ComfyUI 服务器地址须以 http:// 或 https:// 开头',
      'COMFYUI_BAD_BASE_URL',
      400,
      false,
    );
  }
  return raw.replace(/\/+$/, '');
}

/** 按变体 id 取变体配置与对应工作流模板 */
export function resolveVariantWorkflow(
  variants: AdapterVariant[] | undefined,
  modelId: string,
): { variant: AdapterVariant; template: ComfyWorkflowTemplate } {
  const variant = (variants || []).find((v) => v.id === modelId);
  const workflowKey = variant?.workflow as string | undefined;
  const template = workflowKey ? WORKFLOW_TEMPLATES[workflowKey] : undefined;
  if (!variant || !template) {
    throw new ModelException(
      `ComfyUI 变体 ${modelId} 未配置工作流模板(workflow=${workflowKey || '未设置'})`,
      'COMFYUI_NO_WORKFLOW',
      400,
      false,
    );
  }
  return { variant, template };
}

/** 画幅 → 默认分辨率(均为 32 的倍数,与服务器 H3/Qwen 对齐) */
const ASPECT_SIZE: Record<string, { width: number; height: number }> = {
  '16:9': { width: 960, height: 544 },
  '9:16': { width: 544, height: 960 },
  '1:1': { width: 832, height: 832 },
  '4:3': { width: 992, height: 736 },
  '3:4': { width: 736, height: 992 },
};

/** 标清度(如 720p)→ 16:9 基准宽/高,再按画幅翻转或缩放 */
const RESOLUTION_BASE: Record<number, { width: number; height: number }> = {
  480: { width: 832, height: 480 },
  540: { width: 960, height: 544 },
  720: { width: 1248, height: 704 },
  1080: { width: 1920, height: 1088 },
};

/**
 * 业务参数 → 像素尺寸:显式宽高优先,其次 resolution("720p") + ratio,再次画幅,兜底 960×544
 * (兼容图片链路的 aspectRatio 与视频链路的 ratio 两种字段名)
 *
 * maxSide:长边上限(自建 GPU 算力有限,图片链路默认 1344,约 2.3× 快于 2048;
 * 视频链路不传,由 H3 训练分辨率与显存约束自然封顶)
 */
export function resolveSize(
  request: UnifiedModelRequest,
  maxSide?: number,
): {
  width: number;
  height: number;
} {
  const p = (request.parameters || {}) as Record<string, unknown>;
  const clampSide = (size: { width: number; height: number }) => {
    if (!maxSide) return size;
    const long = Math.max(size.width, size.height);
    if (long <= maxSide) return size;
    const scale = maxSide / long;
    const snap = (n: number) => Math.max(32, Math.round((n * scale) / 32) * 32);
    return { width: snap(size.width), height: snap(size.height) };
  };
  const w = Number(p.width);
  const h = Number(p.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w >= 64 && h >= 64) {
    return clampSide({ width: Math.round(w), height: Math.round(h) });
  }

  const aspect =
    (typeof p.aspectRatio === 'string' && p.aspectRatio) ||
    (typeof p.ratio === 'string' && p.ratio) ||
    '16:9';

  if (typeof p.resolution === 'string') {
    const level = parseInt(p.resolution, 10);
    const base = RESOLUTION_BASE[level];
    if (base) {
      // 竖屏/方屏在 16:9 基准上翻转或按画幅表取
      if (aspect === '16:9') return clampSide({ ...base });
      const aspectSize = ASPECT_SIZE[aspect];
      if (aspectSize) {
        // 按标清度与默认档位的比例缩放画幅表值,保持 32 对齐
        const scale = level / 540;
        const snap = (n: number) => Math.max(32, Math.round((n * scale) / 32) * 32);
        return clampSide({ width: snap(aspectSize.width), height: snap(aspectSize.height) });
      }
      return clampSide({ ...base });
    }
  }

  return clampSide(ASPECT_SIZE[aspect] || ASPECT_SIZE['16:9']);
}

/** 读取数值参数(parameters.x 或 input 兜底) */
export function numberParam(
  request: UnifiedModelRequest,
  key: string,
  fallback: number,
): number {
  const v = Number((request.parameters || {})[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
