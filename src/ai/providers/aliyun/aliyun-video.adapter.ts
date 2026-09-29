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
 * 阿里云视频模型适配器(万相 wan2.7 / HappyHorse)
 *
 * 异步任务:submit → taskId → query 轮询(前端 task-runner 负责)。
 * 媒体支持公网 URL 或 base64 data URL。
 */
import { BaseAdapter } from '../../core/base-adapter';
import type {
  AdapterConfig,
  TaskQueryResponse,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '../../core/types';
import { PollingMode, TaskStatus } from '../../core/types';
import { ModelException, ModelTimeoutException } from '../../core/exceptions';
import { AliyunErrorParser } from './error-parser';
import { AliyunPromptTransformer } from './aliyun-prompt.transformer';
import providerJson from '@/config/models/aliyun.json';

// json 构建期内联,断言为宽松结构(厂商专用字段原样保留)
const providerConfig = providerJson as unknown as {
  variants?: import('../../core/types').AdapterVariant[];
  config?: { reasoningTokenBuffer?: number };
};

export class AliyunVideoAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'aliyun',
    modelName: '阿里云万相视频',
    modelType: 'video',
    capabilities: ['video_generation', 'async_task'],
    isAsync: true,
    pollingMode: PollingMode.CLIENT_SIDE,
    enabled: true,
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  };

  private variantSupportsMap = new Map<string, Record<string, any>>();
  private variantAsyncConfigMap = new Map<
    string,
    { taskQueryUrl: string; taskQueryPath: string }
  >();
  private promptTransformer = new AliyunPromptTransformer();

  constructor() {
    super();
    // 仅注入 video 类型变体
    const variants = (providerConfig.variants || []).filter(
      (v) => v.enabled !== false && v.type === 'video',
    );
    (this.config as AdapterConfig).variants = variants;
    for (const variant of variants) {
      const v = variant as Record<string, any>;
      if (v.supports) {
        this.variantSupportsMap.set(variant.id, v.supports);
      }
      if (v.async) {
        this.variantAsyncConfigMap.set(variant.id, {
          taskQueryUrl:
            v.taskQueryUrl || v.baseUrl || this.config.baseUrl!,
          taskQueryPath: v.taskQueryPath || '/tasks/{taskId}',
        });
      }
    }
  }

  protected createErrorParser(): AliyunErrorParser {
    return new AliyunErrorParser();
  }

  async process(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    return this.submit(request);
  }

  async submit(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const startTime = Date.now();
    const modelId = request.modelId;
    const actualModel =
      modelId && this.config.variants?.some((v) => v.id === modelId)
        ? modelId
        : this.config.variants?.[0]?.id || 'happyhorse-1.0-i2v';
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new ModelException(
        '未配置阿里云 API Key,请在「设置」页填写',
        'API_KEY_MISSING',
        401,
        false,
      );
    }

    try {
      const body = this.transformRequest(request);
      const baseUrl = this.getVariantBaseUrl(actualModel) || this.config.baseUrl!;

      const response = await this.fetchWithTimeout(
        `${baseUrl}/services/aigc/video-generation/video-synthesis`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(body),
          timeout: request.options?.timeout || 30000,
        },
      );

      if (!response.ok) {
        await this.handleHttpError(response);
      }

      const rawData = await response.json();
      const taskId = (rawData as Record<string, any>)?.output?.task_id;

      return this.buildSuccessResponse(
        {
          taskId,
          status: TaskStatus.PENDING,
        },
        {
          modelId: actualModel,
          processingTime: Date.now() - startTime,
          rawResponse: rawData,
        },
      );
    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        throw new ModelTimeoutException(
          actualModel,
          request.options?.timeout || 30000,
        );
      }
      if (error instanceof ModelException) throw error;
      throw new ModelException(
        `Aliyun Video提交失败: ${err.message}`,
        'ALIYUN_VIDEO_ERROR',
        500,
        true,
      );
    }
  }

  async query(taskId: string, modelId?: string): Promise<TaskQueryResponse> {
    const startTime = Date.now();
    const actualModelId =
      modelId && this.config.variants?.some((v) => v.id === modelId)
        ? modelId
        : this.config.variants?.[0]?.id || 'happyhorse-1.0-i2v';
    const apiKey = await this.getApiKey();

    try {
      const queryUrl = this.buildQueryUrl(actualModelId, taskId);

      const response = await this.fetchWithTimeout(queryUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 10000,
      });

      if (!response.ok) {
        await this.handleHttpError(response);
      }

      const rawData = await response.json();
      return this.transformResponse(rawData, {
        modelId: actualModelId,
        processingTime: Date.now() - startTime,
      }) as TaskQueryResponse;
    } catch (error) {
      if (error instanceof ModelException) throw error;
      throw new ModelException(
        `查询任务失败: ${(error as Error).message}`,
        'QUERY_ERROR',
        500,
        true,
      );
    }
  }

  transformRequest(request: UnifiedModelRequest): unknown {
    const input = request.input;
    const params = (request.parameters || {}) as Record<string, any>;
    const actualModel =
      request.modelId &&
      this.config.variants?.some((v) => v.id === request.modelId)
        ? request.modelId
        : this.config.variants?.[0]?.id || 'happyhorse-1.0-i2v';

    // 从 variant 配置动态读取能力支持
    const variantSupports = this.variantSupportsMap.get(actualModel);
    const supportsTextToVideo = !!variantSupports?.text_to_video;
    const supportsReferenceImage = !!variantSupports?.reference_image;
    const supportsReferenceVideo = !!variantSupports?.reference_video;
    const supportsReferenceVoice = !!variantSupports?.reference_voice;
    const supportsFirstFrame = !!variantSupports?.first_frame;
    const supportsLastFrame = !!variantSupports?.last_frame;
    const supportsDrivingAudio = !!variantSupports?.driving_audio;
    const mediaMaxCount =
      variantSupports?.media_max_count !== undefined
        ? Number(variantSupports.media_max_count)
        : undefined;

    const isHappyHorse = variantSupports?.modelFamily === 'happyhorse';
    const isHappyHorseR2V = isHappyHorse && supportsReferenceImage;

    // 构建 input
    const requestInput: Record<string, any> = {};
    const requestParams: Record<string, any> = {};

    if (input.text || params.prompt) {
      let prompt = input.text || (params.prompt as string);
      // 清理前端残留的 HTML 标签(role/scene/portrait/img)
      prompt = prompt
        .replace(/@<role\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/role>/gi, '$1')
        .replace(/#<scene\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/scene>/gi, '$1')
        .replace(
          /@<portrait\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/portrait>/gi,
          '$1',
        )
        .replace(/<img[^>]*>/gi, '')
        .replace(/<\/?[a-z][^>]*>/gi, '');
      // 应用厂商提示词转换
      prompt = this.promptTransformer.transform(prompt, {
        taskType: 'video',
        modelId: actualModel,
        supports: variantSupports,
      });
      requestInput.prompt = prompt;
    }

    // 媒体处理
    const media: any[] = [];

    // 音频映射:图片/视频 URL -> 音频 URL(供 wan2.7-r2v 绑定 reference_voice 用)
    const referenceAudioMap: Record<string, string> =
      (params.referenceAudioMap as Record<string, string>) || {};

    if (input.firstFrameUrl) {
      // HappyHorse r2v 用 reference_image,其余模型统一用 first_frame
      const mediaType = isHappyHorseR2V ? 'reference_image' : 'first_frame';
      media.push({ type: mediaType, url: input.firstFrameUrl });
    }
    if (input.lastFrameUrl && supportsLastFrame) {
      media.push({ type: 'last_frame', url: input.lastFrameUrl });
    }
    if (input.referenceImageUrls?.length) {
      for (const url of input.referenceImageUrls) {
        if (supportsReferenceImage) {
          const mediaItem: any = { type: 'reference_image', url };
          // 支持为每个 reference_image 绑定 reference_voice(音色参考)
          if (supportsReferenceVoice && referenceAudioMap[url]) {
            mediaItem.reference_voice = referenceAudioMap[url];
          }
          media.push(mediaItem);
        } else if (supportsFirstFrame && media.length === 0) {
          // 模型不支持 reference_image 但支持 first_frame:仅取第一张作为首帧,忽略其余
          media.push({ type: 'first_frame', url });
        }
        // 不支持 reference_image 也不支持 first_frame 的模型直接忽略参考图
      }
    }
    if (input.referenceVideoUrls?.length) {
      for (const url of input.referenceVideoUrls) {
        if (supportsReferenceVideo) {
          const mediaItem: any = { type: 'reference_video', url };
          // 支持为每个 reference_video 绑定 reference_voice(音色参考)
          if (supportsReferenceVoice && referenceAudioMap[url]) {
            mediaItem.reference_voice = referenceAudioMap[url];
          }
          media.push(mediaItem);
        }
      }
    }
    if (input.referenceAudioUrls?.length) {
      if (supportsReferenceVoice) {
        // 通过 reference_voice 绑定到对应 media 项上
        // 若 referenceAudioMap 未提供或匹配失败,将第一个音频作为 fallback 绑定到首个 reference_image/reference_video
        const unboundAudioUrls = input.referenceAudioUrls.filter(
          (audioUrl) => !media.some((m: any) => m.reference_voice === audioUrl),
        );
        for (const mediaItem of media) {
          if (unboundAudioUrls.length === 0) break;
          if (
            (mediaItem.type === 'reference_image' ||
              mediaItem.type === 'reference_video') &&
            !mediaItem.reference_voice
          ) {
            mediaItem.reference_voice = unboundAudioUrls.shift();
          }
        }
      } else if (supportsDrivingAudio) {
        media.push({ type: 'driving_audio', url: input.referenceAudioUrls[0] });
      }
    }

    // 对 media 数组做数量限制截断(如 wan2.7-r2v 要求 media 最多 5 项)
    if (
      mediaMaxCount !== undefined &&
      mediaMaxCount > 0 &&
      media.length > mediaMaxCount
    ) {
      // 优先保留有 reference_voice 绑定的项
      const sorted = [...media].sort((a, b) => {
        const aHasVoice = a.reference_voice ? 1 : 0;
        const bHasVoice = b.reference_voice ? 1 : 0;
        return bHasVoice - aHasVoice;
      });
      const truncated = sorted.slice(0, mediaMaxCount);
      console.warn(
        `[AliyunVideoAdapter] media 数组超限 model=${actualModel}, 原始=${media.length}项, 截断后=${truncated.length}项, max=${mediaMaxCount}`,
      );
      media.length = 0;
      media.push(...truncated);
    }

    if (media.length > 0 && !supportsTextToVideo) {
      requestInput.media = media;
    }

    // 图生视频/参考生视频模型不支持纯文生视频,必须有 media 输入;
    // 缺图时直接抛错,避免无效请求发到阿里云才报 "Field required: input.media"
    if (!supportsTextToVideo && media.length === 0) {
      throw new ModelException(
        `模型 ${actualModel} 为图生视频模型,请上传参考图或首帧图后再生成`,
        'ALIYUN_VIDEO_MISSING_MEDIA',
        400,
        false,
      );
    }

    // 音频URL(t2v)
    if (supportsTextToVideo && input.referenceAudioUrls?.length) {
      requestInput.audio_url = input.referenceAudioUrls[0];
    }

    // 参数
    if (params.negativePrompt && !isHappyHorse)
      requestInput.negative_prompt = params.negativePrompt;

    // resolution / size
    // 阿里云要求 resolution 为大写 '720P' / '1080P',前端视频统一传小写 '720p',需归一化
    const rawResolution = (params.resolution || '720P') as string;
    const normalizedResolution = rawResolution.toUpperCase();
    requestParams.resolution = ['720P', '1080P'].includes(normalizedResolution)
      ? normalizedResolution
      : '720P';

    if (params.ratio) {
      requestParams.ratio = params.ratio;
    }

    requestParams.duration = params.duration || 5;
    if (!isHappyHorse) {
      requestParams.prompt_extend =
        params.promptExtend !== undefined ? Boolean(params.promptExtend) : true;
    }
    requestParams.watermark =
      params.watermark !== undefined ? Boolean(params.watermark) : false;

    if (params.seed !== undefined) requestParams.seed = params.seed;

    return {
      model: actualModel,
      input: requestInput,
      parameters: requestParams,
    };
  }

  transformResponse(
    rawResponse: unknown,
    metadata?: { modelId: string; processingTime: number },
  ): UnifiedModelResponse {
    const raw = rawResponse as Record<string, any>;
    const output = raw.output || {};
    const status = (output.task_status || 'unknown').toLowerCase();
    const isSucceeded = status === 'succeeded';
    const isFailed = status === 'failed';

    const normalizedStatus = isSucceeded
      ? TaskStatus.COMPLETED
      : isFailed
        ? TaskStatus.FAILED
        : TaskStatus.RUNNING;

    return this.buildSuccessResponse(
      {
        status: normalizedStatus,
        urls: isSucceeded ? this.extractVideoUrls(output) : undefined,
        taskId: output.task_id,
        extra: {
          requestId: raw.request_id,
          taskStatus: output.task_status,
          usage: raw.usage,
        },
      },
      {
        modelId: metadata?.modelId || this.config.modelId,
        processingTime: metadata?.processingTime || 0,
        rawResponse,
      },
    );
  }

  private extractVideoUrls(output: Record<string, any>): string[] {
    const urls: string[] = [];
    // 阿里云可能返回 video_urls 数组(多个视频)或 video_url 单个
    if (output.video_urls && Array.isArray(output.video_urls)) {
      urls.push(
        ...output.video_urls.filter(
          (url: any) => typeof url === 'string' && url.length > 0,
        ),
      );
    }
    if (typeof output.video_url === 'string' && output.video_url.length > 0) {
      urls.push(output.video_url);
    }
    // 去重
    return [...new Set(urls)];
  }

  private buildQueryUrl(modelId: string, taskId: string): string {
    const asyncConfig = this.variantAsyncConfigMap.get(modelId);
    if (asyncConfig) {
      const path = asyncConfig.taskQueryPath.replace('{taskId}', taskId);
      return `${asyncConfig.taskQueryUrl}${path}`;
    }
    const baseUrl = this.getVariantBaseUrl(modelId) || this.config.baseUrl!;
    return `${baseUrl}/tasks/${taskId}`;
  }
}
