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
 * ComfyUI 视频模型适配器(MiniMax H3 文生视频 / 首尾帧视频)
 *
 * CLIENT_SIDE 轮询模式,与 volcengine/aliyun/minimaxi 视频适配器对齐:
 * - submit():上传参考图(如需) → 注入工作流 → POST /prompt → data.taskId = prompt_id
 * - query(prompt_id):GET /history → 映射 TaskStatus,完成的产物转 /view 地址
 * 刷新恢复:上层持久化 {providerId:'comfyui', modelId, taskId:prompt_id} 后直接 poll。
 */
import { BaseAdapter } from '../../core/base-adapter';
import type {
  AdapterConfig,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '../../core/types';
import { PollingMode, TaskStatus } from '../../core/types';
import { ModelException } from '../../core/exceptions';
import { ComfyUIErrorParser } from './comfyui-error.parser';
import {
  injectWorkflow,
  randomSeed,
  secondsToH3Length,
  type WorkflowInjectParams,
} from './comfyui-workflow-loader';
import {
  collectOutputUrls,
  extractHistoryError,
  fetchImageBlob,
  getPromptHistory,
  isPromptInQueue,
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

export class ComfyUIVideoAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'comfyui',
    modelName: 'ComfyUI 视频(MiniMax H3)',
    modelType: 'video',
    capabilities: ['video_generation', 'first_last_frame'],
    isAsync: true,
    pollingMode: PollingMode.CLIENT_SIDE,
    enabled: true,
  };

  constructor() {
    super();
    this.loadVariants(providerConfig);
  }

  protected createErrorParser(): ComfyUIErrorParser {
    return new ComfyUIErrorParser();
  }

  transformRequest(request: UnifiedModelRequest): unknown {
    const { width, height } = resolveSize(request);
    const durationSec = numberParam(request, 'duration', 5);
    return {
      prompt: request.input.text,
      width,
      height,
      length: secondsToH3Length(durationSec),
      duration: durationSec,
    };
  }

  transformResponse(): UnifiedModelResponse {
    throw new ModelException(
      'ComfyUI 视频适配器请使用 submit()/query() 调用',
      'USE_SUBMIT_QUERY',
      400,
      false,
    );
  }

  /** 注入工作流并提交,返回 prompt_id 作为 taskId */
  async submit(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const startedAt = Date.now();
    const baseUrl = await getComfyBaseUrl();
    const { template } = resolveVariantWorkflow(this.config.variants, request.modelId);
    const prompt = (request.input.text || '').trim();
    if (!prompt) {
      throw new ModelException('缺少提示词', 'NO_PROMPT', 400, false);
    }
    const { width, height } = resolveSize(request);
    const durationSec = numberParam(request, 'duration', 5);

    const params: WorkflowInjectParams = {
      prompt,
      width,
      height,
      // 业务传的是秒,模板要帧;H3 网格 17k+5
      length: secondsToH3Length(durationSec),
      seed: numberParam(request, 'seed', randomSeed()),
      steps: numberParam(request, 'steps', 20),
    };

    // 首尾帧:上传两张参考图并注入 LoadImage
    const needFirst = !!template['load_first'];
    if (needFirst) {
      const firstUrl =
        request.input.firstFrameUrl || request.input.imageUrl;
      const lastUrl = request.input.lastFrameUrl;
      if (!firstUrl || !lastUrl) {
        throw new ModelException(
          '首尾帧视频需要同时提供 firstFrameUrl 与 lastFrameUrl',
          'NO_FIRST_LAST_FRAME',
          400,
          false,
        );
      }
      const stamp = Date.now();
      const [firstName, lastName] = await Promise.all([
        uploadImage(baseUrl, await fetchImageBlob(firstUrl), `shotlib_first_${stamp}.png`),
        uploadImage(baseUrl, await fetchImageBlob(lastUrl), `shotlib_last_${stamp}.png`),
      ]);
      params.images = { IMAGE_FIRST: firstName, IMAGE_LAST: lastName };
    }

    const workflow = injectWorkflow(template, params);

    // 参考生视频(r2v):上传头像/形象照/场景图等参考图,注入 ref_images autogrow 槽位。
    // COMFY_AUTOGROW_V3 在 API 格式中必须用点分键(每个槽位一个 key):
    //   ref_images.ref_image_0 = [load_ref_1, 0]
    //   而非数组 ref_images = [[load_ref_1, 0]](数组会被当字面值,连线丢失)。
    // MiniMaxH3ReferenceToVideo 最多 9 张 ref_image;未提供参考图时退化为文生视频。
    const needRefImages = !!template['r2v'];
    if (needRefImages) {
      const refUrls = (request.input.referenceImageUrls || []).filter(
        (u) => !!u,
      );
      const r2vNode = workflow['r2v'] as { inputs: Record<string, unknown> } | undefined;
      if (r2vNode && refUrls.length > 0) {
        const stamp = Date.now();
        for (let i = 0; i < Math.min(refUrls.length, 9); i++) {
          const name = await uploadImage(
            baseUrl,
            await fetchImageBlob(refUrls[i]),
            `shotlib_ref_${stamp}_${i}.png`,
          );
          const nodeId = `load_ref_${i + 1}`;
          workflow[nodeId] = { class_type: 'LoadImage', inputs: { image: name } };
          // 点分键:ref_images.ref_image_0/ref_image_1/... 对应 <Picture 1>/<Picture 2>/...
          r2vNode.inputs[`ref_images.ref_image_${i}`] = [nodeId, 0];
        }
      }
    }

    const { prompt_id, number } = await submitPrompt(baseUrl, workflow);

    return this.buildSuccessResponse(
      {
        taskId: prompt_id,
        status: TaskStatus.RUNNING,
        // 队列序号供上层展示"排队中 #N"
        extra: { queueNumber: number, length: params.length },
      },
      { modelId: request.modelId, processingTime: Date.now() - startedAt },
    );
  }

  /** 查询任务(history 无记录 = 仍在队列,返回 PENDING) */
  async query(
    taskId: string,
    modelId?: string,
  ): Promise<UnifiedModelResponse> {
    const startedAt = Date.now();
    const baseUrl = await getComfyBaseUrl();
    const entry = await getPromptHistory(baseUrl, taskId);

    // 队列中:history 还没有记录
    if (!entry) {
      // history 无记录有两种可能:仍在队列(刚提交) / 已被取消或删除。
      // 仅在确认队列中也不存在时判为已取消,避免前端无限轮询一个已不存在的任务。
      const inQueue = await isPromptInQueue(baseUrl, taskId);
      if (!inQueue) {
        return {
          success: false,
          data: {
            taskId,
            status: TaskStatus.FAILED,
            extra: { error: '任务已在 ComfyUI 侧被取消或删除' },
          },
          metadata: {
            modelId: modelId || this.config.modelId,
            processingTime: Date.now() - startedAt,
            timestamp: new Date().toISOString(),
          },
          error: {
            code: 'COMFYUI_TASK_CANCELLED',
            message: '[ComfyUI] 任务已取消或丢失',
            retryable: false,
          },
        };
      }
      return this.buildSuccessResponse(
        { taskId, status: TaskStatus.PENDING },
        { modelId: modelId || this.config.modelId, processingTime: Date.now() - startedAt },
      );
    }

    // 执行失败 / 被中断(status_str=error,含 execution_interrupted 等)
    if (entry.status?.status_str === 'error') {
      const message = extractHistoryError(entry);
      const oom = /out of memory/i.test(message);
      return {
        success: false,
        data: {
          taskId,
          status: TaskStatus.FAILED,
          extra: { error: message },
        },
        metadata: {
          modelId: modelId || this.config.modelId,
          processingTime: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
        error: {
          code: 'COMFYUI_EXEC_ERROR',
          message: `[ComfyUI] 任务执行失败: ${message}${oom ? '(建议:降低分辨率或时长后重试)' : ''}`,
          retryable: !oom,
        },
      };
    }

    // 完成
    if (entry.status?.completed) {
      const urls = collectOutputUrls(baseUrl, entry);
      return this.buildSuccessResponse(
        {
          taskId,
          status: TaskStatus.COMPLETED,
          urls,
          extra: { outputs: entry.outputs },
        },
        { modelId: modelId || this.config.modelId, processingTime: Date.now() - startedAt },
      );
    }

    // 其余按运行中处理
    return this.buildSuccessResponse(
      { taskId, status: TaskStatus.RUNNING },
      { modelId: modelId || this.config.modelId, processingTime: Date.now() - startedAt },
    );
  }
}
