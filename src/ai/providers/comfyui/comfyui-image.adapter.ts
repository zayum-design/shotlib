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
 * ComfyUI 图片模型适配器(Qwen-Image-2.1 文生图 / 图生图编辑)
 *
 * 与云厂商"同步返回 URL"不同,ComfyUI 一切皆为工作流任务:
 * process() 内部完成 提交 → 轮询 history → 收集 /view 地址 的全流程,
 * 对上层仍表现为同步图片生成(单张 1~2 分钟,轮询上限 15 分钟)。
 */
import { BaseAdapter } from '../../core/base-adapter';
import type {
  AdapterConfig,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '../../core/types';
import { TaskStatus } from '../../core/types';
import { ModelException } from '../../core/exceptions';
import { ComfyUIErrorParser } from './comfyui-error.parser';
import {
  injectWorkflow,
  randomSeed,
  type WorkflowInjectParams,
} from './comfyui-workflow-loader';
import {
  collectOutputUrls,
  fetchImageBlob,
  getPromptHistory,
  submitPrompt,
  uploadImage,
} from './comfyui-api';
import {
  getComfyBaseUrl,
  numberParam,
  resolveSize,
  resolveVariantWorkflow,
} from './comfyui-shared';
import providerJson from '@/config/models/comfyui.json';

const providerConfig = providerJson as unknown as {
  variants?: AdapterConfig['variants'];
};

/** 轮询:间隔 3s,上限 15 分钟(图片任务量级) */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 300;
/** 轮询期间容忍的连续网络错误次数(超过才放弃;服务器任务仍在执行,放弃后结果留 history) */
const MAX_CONSECUTIVE_POLL_ERRORS = 5;
/**
 * 图片长边上限:业务侧(如头像)固定派生 2048×2048,自建 4090 GGUF Q8 跑一张要 5~8 分钟;
 * Qwen-Image 推荐 1024~1344,画质足够(头像/场景图/视频首帧的展示与下游消耗都 ≤960p),
 * 1344² 像素量约为 2048² 的 43%,耗时约快 2.3 倍
 */
const IMAGE_MAX_SIDE = 1344;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ComfyUIImageAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'comfyui',
    modelName: 'ComfyUI 图片(Qwen-Image-2.1)',
    modelType: 'image',
    capabilities: ['image_generation', 'image_edit'],
    isAsync: false,
    enabled: true,
  };

  constructor() {
    super();
    this.loadVariants(providerConfig);
  }

  protected createErrorParser(): ComfyUIErrorParser {
    return new ComfyUIErrorParser();
  }

  /** 请求转换(编排层经 modelSDK.process 直调本适配器,此实现仅供日志/调试) */
  transformRequest(request: UnifiedModelRequest): unknown {
    const { width, height } = resolveSize(request, IMAGE_MAX_SIDE);
    return {
      workflow: resolveVariantWorkflow(this.config.variants, request.modelId).variant
        .workflow,
      prompt: request.input.text,
      width,
      height,
    };
  }

  transformResponse(): UnifiedModelResponse {
    throw new ModelException(
      'ComfyUI 图片适配器请使用 process() 调用',
      'USE_PROCESS',
      400,
      false,
    );
  }

  /** 统一图片生成入口(对齐 modelSDK.process) */
  async process(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const startedAt = Date.now();
    const baseUrl = await getComfyBaseUrl();
    const { template } = resolveVariantWorkflow(this.config.variants, request.modelId);
    const prompt = (request.input.text || '').trim();
    if (!prompt) {
      throw new ModelException('缺少提示词', 'NO_PROMPT', 400, false);
    }
    const { width, height } = resolveSize(request, IMAGE_MAX_SIDE);

    const params: WorkflowInjectParams = {
      prompt,
      width,
      height,
      seed: numberParam(request, 'seed', randomSeed()),
      steps: numberParam(request, 'steps', 30),
      denoise: numberParam(request, 'denoise', 0.85),
    };

    // 图生图:上传参考图并替换 LoadImage 占位符
    const refImage = request.input.imageUrls?.[0] || request.input.imageUrl;
    if (template['load_image']) {
      if (!refImage) {
        throw new ModelException(
          '图生图模式需要提供参考图(referenceImage)',
          'NO_REFERENCE_IMAGE',
          400,
          false,
        );
      }
      const blob = await fetchImageBlob(refImage);
      const name = await uploadImage(
        baseUrl,
        blob,
        `shotlib_ref_${Date.now()}.png`,
      );
      params.images = { IMAGE_1: name };
    }

    const workflow = injectWorkflow(template, params);
    const { prompt_id } = await submitPrompt(baseUrl, workflow);

    // 轮询 history 直到完成(提交即入队,记录可能延迟出现)
    // 单次轮询的偶发网络错误(休眠断网/代理抖动)不应杀死整个生成任务,
    // 连续失败超过阈值才放弃;此时服务器侧仍会跑完,产物留在 history。
    let consecutiveErrors = 0;
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      let entry;
      try {
        entry = await getPromptHistory(baseUrl, prompt_id);
        consecutiveErrors = 0;
      } catch (pollError) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) throw pollError;
        continue;
      }
      if (!entry) continue;
      if (entry.status?.completed) {
        const urls = collectOutputUrls(baseUrl, entry);
        if (urls.length === 0) {
          throw new ModelException(
            'ComfyUI 任务完成但未产出图片(检查工作流 Save 节点)',
            'NO_OUTPUT',
            500,
            true,
          );
        }
        return this.buildSuccessResponse(
          { urls, status: TaskStatus.COMPLETED },
          { modelId: request.modelId, processingTime: Date.now() - startedAt },
        );
      }
      if (entry.status?.status_str === 'error') {
        const err = new ModelException(
          `ComfyUI 执行失败: ${JSON.stringify(entry.status.messages ?? entry.status).slice(0, 500)}`,
          'COMFYUI_EXEC_ERROR',
          500,
          true,
        );
        return this.buildErrorResponse(err, {
          modelId: request.modelId,
          processingTime: Date.now() - startedAt,
        });
      }
    }

    throw new ModelException(
      `ComfyUI 图片任务超时(${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS / 60000} 分钟): ${prompt_id}`,
      'COMFYUI_TIMEOUT',
      504,
      true,
    );
  }
}
