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
  hasClassNode,
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
import { settingsRepo } from '@/storage/settingsRepo';
import providerJson from '@/config/models/comfyui.json';

const providerConfig = providerJson as unknown as {
  variants?: AdapterConfig['variants'];
};

/**
 * shotlib 自定义节点类名(comfyui-nodes/shotlib-h3-context-ir):
 * 服务器安装后,提示词优化在 ComfyUI 节点内完成,云端优化与 H3 采样一条工作流串行
 */
const CONTEXT_IR_NODE = 'MiniMaxH3ContextIR';

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
    const { variant, template } = resolveVariantWorkflow(this.config.variants, request.modelId);
    const prompt = (request.input.text || '').trim();
    if (!prompt) {
      throw new ModelException('缺少提示词', 'NO_PROMPT', 400, false);
    }
    const { width, height } = resolveSize(request);
    const durationSec = numberParam(request, 'duration', 5);

    // MiniMax H3 提示词优化:统一在 ComfyUI 节点内完成 —— 服务器安装了 shotlib 自定义
    // 节点 MiniMaxH3ContextIR(comfyui-nodes/shotlib-h3-context-ir)时,云端优化作为
    // 工作流的一个环节,优化完成后直接进入 H3 采样,前端不参与、不阻塞等待。
    // 节点未安装/未配置 Key 时直接用原始提示词(自建 H3 不依赖 MiniMax Key,属正常降级)
    // 节点侧优化参数;注入工作流后据此组装 Context-IR 节点(null = 不优化)
    let irNodeParams: {
      apiKey: string;
      ratio?: string;
      duration: number;
      isFl2v: boolean;
      isR2v: boolean;
    } | null = null;
    const supports = variant.supports as Record<string, any> | undefined;
    const minimaxApiKey = (await settingsRepo.getApiKey('minimaxi')).trim();
    if (supports?.context_ir && minimaxApiKey) {
      const isFl2v = !!template['load_first'];
      const isR2v = !!template['r2v'];
      const p = (request.parameters || {}) as Record<string, unknown>;
      const ratioParam =
        (typeof p.ratio === 'string' && p.ratio) ||
        (typeof p.aspectRatio === 'string' && p.aspectRatio) ||
        undefined;
      // Context-IR 支持的画幅;纯文生视频必填且不能为 adaptive,首尾帧恒为 adaptive(不传)
      const H3_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
      const ratio = isFl2v
        ? undefined
        : ratioParam && H3_RATIOS.includes(ratioParam)
          ? ratioParam
          : isR2v
            ? undefined
            : '16:9';
      // Context-IR 允许的时长范围 4~15 秒
      const irDuration = Math.min(15, Math.max(4, Math.round(durationSec)));

      if (await hasClassNode(baseUrl, CONTEXT_IR_NODE)) {
        console.log(
          `[ComfyUIVideo] 服务器已安装 ${CONTEXT_IR_NODE},提示词优化将在 ComfyUI 节点内执行`,
        );
        irNodeParams = {
          apiKey: minimaxApiKey,
          ratio,
          duration: irDuration,
          isFl2v,
          isR2v,
        };
      } else {
        console.warn(
          `[ComfyUIVideo] 服务器未安装 ${CONTEXT_IR_NODE} 自定义节点` +
            '(comfyui-nodes/shotlib-h3-context-ir),跳过提示词优化,使用原始提示词',
        );
      }
    } else if (supports?.context_ir) {
      console.log(
        '[ComfyUIVideo] 未配置 MiniMax API Key,跳过提示词优化,使用原始提示词',
      );
    }

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

    // 注入 Context-IR 节点(节点侧提示词优化):生成节点的 prompt 改接本节点输出,
    // ComfyUI 按依赖顺序先执行云端优化、后执行 H3 采样,「先优化、后生成」串行完成。
    // 注意:api_key 会明文写入工作流并保留在 history 中 —— ComfyUI 服务器是用户自建
    // 环境,风险与前端直发 Authorization 头同级;介意时可在服务器设 MINIMAX_API_KEY
    // 环境变量(节点支持输入留空读环境变量)。
    if (irNodeParams) {
      // Context-IR 的参考媒体:首尾帧模式传首/尾帧原图 URL,参考模式传参考图 URL
      const imageUrls = irNodeParams.isFl2v
        ? [
            request.input.firstFrameUrl || request.input.imageUrl || '',
            request.input.lastFrameUrl || '',
          ]
        : irNodeParams.isR2v
          ? (request.input.referenceImageUrls || []).filter((u) => !!u)
          : [];
      const imageRoles = irNodeParams.isFl2v
        ? ['first_frame', 'last_frame']
        : imageUrls.map(() => 'reference_image');
      // 生成节点 = 注入后 prompt 仍为字符串的那个节点(t2v/fl2v 的 i2v、r2v 的 r2v)
      const genNode = Object.values(workflow).find(
        (n) => typeof n.inputs.prompt === 'string' && n.inputs.prompt === prompt,
      );
      if (genNode) {
        workflow['context_ir'] = {
          class_type: CONTEXT_IR_NODE,
          inputs: {
            prompt,
            duration: irNodeParams.duration,
            ratio: irNodeParams.ratio || '',
            api_key: irNodeParams.apiKey,
            image_urls: imageUrls.filter(Boolean).join('\n'),
            image_roles: imageRoles.join('\n'),
            fallback_on_error: true,
          },
        };
        genNode.inputs.prompt = ['context_ir', 0];
      } else {
        console.warn(
          '[ComfyUIVideo] 工作流中未找到提示词生成节点,跳过节点侧提示词优化,使用原始提示词',
        );
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
