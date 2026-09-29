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
 * 火山引擎视频模型适配器(即梦 Seedance)
 *
 * 异步任务:submit → taskId → query 轮询(前端 task-runner 负责)。
 * 首帧/尾帧/参考图支持公网 URL 或 base64 data URL。
 */
import { BaseAdapter } from '../../core/base-adapter';
import type {
  AdapterConfig,
  TaskQueryResponse,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '../../core/types';
import { PollingMode, TaskStatus } from '../../core/types';
import {
  ModelException,
  ModelTimeoutException,
} from '../../core/exceptions';
import { VolcEngineErrorParser } from './error-parser';
import { VolcenginePromptTransformer } from './volcengine-prompt.transformer';
import providerJson from '@/config/models/volcengine.json';

// json 构建期内联,断言为宽松结构(厂商专用字段原样保留)
const providerConfig = providerJson as unknown as {
  variants?: import('../../core/types').AdapterVariant[];
  config?: { reasoningTokenBuffer?: number };
};

export class VolcEngineVideoAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'volcengine',
    modelName: '即梦视频',
    modelType: 'video',
    capabilities: ['video_generation', 'async_task'],
    isAsync: true,
    pollingMode: PollingMode.CLIENT_SIDE,
    enabled: true,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  };

  private variantSupportsMap = new Map<string, Record<string, any>>();
  private promptTransformer = new VolcenginePromptTransformer();

  constructor() {
    super();
    // 仅注入 video 类型变体
    (this.config as AdapterConfig).variants = (providerConfig.variants || []).filter(
      (v) => v.enabled !== false && v.type === 'video',
    );
    for (const variant of this.config.variants || []) {
      const supports = (variant as Record<string, any>).supports;
      if (supports) {
        this.variantSupportsMap.set(variant.id, supports);
      }
    }
  }

  protected createErrorParser(): VolcEngineErrorParser {
    return new VolcEngineErrorParser();
  }

  async process(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    // 视频模型是异步的,process 直接委托给 submit
    return this.submit(request);
  }

  async submit(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const startTime = Date.now();
    const modelId = request.modelId;
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new ModelException(
        '未配置火山引擎 API Key,请在「设置」页填写',
        'API_KEY_MISSING',
        401,
        false,
      );
    }

    try {
      const body = this.transformRequest(request);
      const baseUrl = this.getVariantBaseUrl(modelId) || this.config.baseUrl!;

      const response = await this.fetchWithTimeout(
        `${baseUrl}/contents/generations/tasks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          timeout: request.options?.timeout || 180000,
        },
      );

      if (!response.ok) {
        await this.handleHttpError(response);
      }

      const rawData = await response.json();
      this.handleBusinessError(rawData);

      const taskId = (rawData as Record<string, any>).id;
      if (!taskId) {
        throw new ModelException(
          'VolcEngine Video API未返回任务ID,请检查模型权限或请求参数',
          'NO_TASK_ID',
          500,
          true,
        );
      }

      return this.buildSuccessResponse(
        {
          taskId,
          status: TaskStatus.PENDING,
        },
        {
          modelId,
          processingTime: Date.now() - startTime,
          rawResponse: rawData,
        },
      );
    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        throw new ModelTimeoutException(
          modelId,
          request.options?.timeout || 30000,
        );
      }
      if (error instanceof ModelException) throw error;
      throw new ModelException(
        `VolcEngine Video提交失败: ${err.message}`,
        'VOLCENGINE_VIDEO_ERROR',
        500,
        true,
      );
    }
  }

  async query(taskId: string, modelId?: string): Promise<TaskQueryResponse> {
    const startTime = Date.now();
    const actualModelId = modelId || 'doubao-seedance-2-0-260128';
    const apiKey = await this.getApiKey();
    const baseUrl = this.getVariantBaseUrl(actualModelId) || this.config.baseUrl!;

    try {
      const response = await this.fetchWithTimeout(
        `${baseUrl}/contents/generations/tasks/${taskId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 10000,
        },
      );

      if (!response.ok) {
        await this.handleHttpError(response);
      }

      const rawData = await response.json();
      this.handleBusinessError(rawData);

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

  /**
   * 净化提示词:
   * 1. 移除HTML标签但保留文本内容
   * 2. 移除 [图N] 占位符标记之外的自定义标签
   * 3. 移除音频参考、面部特征/装束/五官锁定等技术描述
   * 4. 清理多余空白
   */
  private sanitizePrompt(prompt: string): string {
    if (!prompt) return '';

    // 移除HTML标签但保留其中的文本内容
    let result = prompt
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // 首先处理带 img 的自定义标签(如 @<role>名字<img src="..."></role>)
    // 保留标签内的文本内容,移除 img 标签
    result = result
      // 处理带 img 的 role 标签:保留名字,移除 img
      .replace(/@<role\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/role>/gi, '$1')
      // 处理带 img 的 scene 标签:保留场景名,移除 img
      .replace(/#<scene\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/scene>/gi, '$1')
      // 处理带 img 的 portrait 标签:保留形象照名称,移除 img
      .replace(/@<portrait\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/portrait>/gi, '$1')
      // 处理不带 img 的 role 标签
      .replace(/@<role\s+[^>]*>([^<]*)<\/role>/gi, '$1')
      // 处理不带 img 的 scene 标签
      .replace(/#<scene\s+[^>]*>([^<]*)<\/scene>/gi, '$1')
      // 处理不带 img 的 portrait 标签
      .replace(/@<portrait\s+[^>]*>([^<]*)<\/portrait>/gi, '$1')
      // 移除残留的 img 标签
      .replace(/<img[^>]*>/gi, '')
      // 移除其他HTML标签
      .replace(/<\/?[a-z][^>]*>/gi, '');

    // 移除音频参考描述(如"音频参考:参考音频1中的音色")
    result = result.replace(/，?音频参考：参考音频\d+中的音色/g, '');
    result = result.replace(/（音频参考：参考音频\d+中的音色）/g, '');
    result = result.replace(/（音频参考：参考音频\d+中的音色）/g, '');

    // 移除技术描述性短语(面部特征/装束/五官锁定等)
    result = result.replace(/全程面部特征严格参考[^，。；！？\n]*，?/g, '');
    result = result.replace(/全程保持人物ID一致，?/g, '');
    result = result.replace(/装束参照[^，。；！？\n]*，?/g, '');
    result = result.replace(/五官锁定，禁止修改五官妆容，?/g, '');

    // 清理角色括号内可能遗留的空括号、多余标点
    result = result.replace(/（\s*，*\s*）/g, '');
    result = result.replace(/（([^（）]*?)\s*，\s*）/g, '（$1）');
    result = result.replace(/（\s*，/g, '（');
    result = result.replace(/，\s*）/g, '）');
    // 清理多余空白和换行
    result = result
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return result;
  }

  transformRequest(request: UnifiedModelRequest): unknown {
    const input = request.input;
    const params = (request.parameters || {}) as Record<string, any>;
    const actualModel = this.config.variants?.some((v) => v.id === request.modelId)
      ? request.modelId
      : this.config.variants?.[0]?.id || 'doubao-seedance-2-0-260128';

    const variantSupports = this.variantSupportsMap.get(actualModel);

    // 按类型截断参考资源,避免超出 API 限制
    const referenceImageUrls = this.truncateUrls(
      input.referenceImageUrls,
      variantSupports?.reference_image_max_count,
      'reference_image',
      actualModel,
    );
    const referenceVideoUrls = this.truncateUrls(
      input.referenceVideoUrls,
      variantSupports?.reference_video_max_count,
      'reference_video',
      actualModel,
    );
    const referenceAudioUrls = this.truncateUrls(
      input.referenceAudioUrls,
      variantSupports?.reference_audio_max_count,
      'reference_audio',
      actualModel,
    );

    const content: any[] = [];

    // 文本提示(清理HTML标签 + 厂商预处理)
    const rawText = input.text || params.prompt;
    if (rawText) {
      let sanitizedText = this.sanitizePrompt(rawText);
      // 应用厂商提示词转换
      sanitizedText = this.promptTransformer.transform(sanitizedText, {
        taskType: 'video',
      });

      // 根据首帧/尾帧添加引导语
      // 仅在全能参考生成模式(references_to_video)下添加,首尾帧模式(frames_to_video)下不添加
      // content 数组中图片顺序:first_frame → last_frame → reference_image → ...
      // 对应自然语言中的 图片1、图片2...
      const isReferencesToVideo = request.operation === 'references_to_video';
      let imageIndex = 1;
      const guidanceParts: string[] = [];

      if (isReferencesToVideo && input.firstFrameUrl) {
        guidanceParts.push(`首帧为图片${imageIndex}`);
        imageIndex++;
      }
      if (isReferencesToVideo && input.lastFrameUrl) {
        guidanceParts.push(`尾帧为图片${imageIndex}`);
        imageIndex++;
      }

      if (guidanceParts.length > 0) {
        // 引导语放在提示词开头
        sanitizedText = `${guidanceParts.join('，')}，${sanitizedText}`;
      }

      content.push({ type: 'text', text: sanitizedText });
    }

    // 首帧/尾帧
    if (input.firstFrameUrl && input.lastFrameUrl) {
      content.push(
        {
          type: 'image_url',
          image_url: { url: input.firstFrameUrl },
          role: 'first_frame',
        },
        {
          type: 'image_url',
          image_url: { url: input.lastFrameUrl },
          role: 'last_frame',
        },
      );
    } else if (input.firstFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: input.firstFrameUrl },
      });
    }

    // 参考图片
    if (referenceImageUrls?.length) {
      for (const url of referenceImageUrls) {
        content.push({
          type: 'image_url',
          image_url: { url },
          role: 'reference_image',
        });
      }
    }

    // 参考视频
    if (
      referenceVideoUrls?.length &&
      this.supportsParameter(actualModel, 'reference_video')
    ) {
      for (const url of referenceVideoUrls) {
        content.push({
          type: 'video_url',
          video_url: { url },
          role: 'reference_video',
        });
      }
    }

    // 参考音频
    if (
      referenceAudioUrls?.length &&
      this.supportsParameter(actualModel, 'reference_audio')
    ) {
      const audioTotalMax = (
        variantSupports?.reference_audio_duration as
          | { total_max?: number }
          | undefined
      )?.total_max;
      if (audioTotalMax !== undefined && referenceAudioUrls.length > 1) {
        console.warn(
          `[VolcEngineVideoAdapter] 传入 ${referenceAudioUrls.length} 个参考音频,模型 ${actualModel} 要求音频总时长 ≤ ${audioTotalMax} 秒,请确保各音频时长之和不超过限制`,
        );
      }
      for (const url of referenceAudioUrls) {
        content.push({
          type: 'audio_url',
          audio_url: { url },
          role: 'reference_audio',
        });
      }
    }

    const body: Record<string, any> = {
      model: actualModel,
      content,
    };

    if (params.ratio) body.ratio = params.ratio;
    if (params.duration) body.duration = params.duration;
    if (params.generateAudio !== undefined)
      body.generate_audio = params.generateAudio;
    if (params.resolution && this.supportsParameter(actualModel, 'resolution'))
      body.resolution = params.resolution;
    if (
      params.seed !== undefined &&
      this.supportsParameter(actualModel, 'seed')
    )
      body.seed = params.seed;
    if (params.watermark !== undefined) body.watermark = params.watermark;
    // human_face_mode 仅部分模型支持(Seedance 2.5 不支持,传入会报 InvalidParameter),
    // 是否下发由 model.json 各变体的 supports.human_face_mode 控制;
    // 默认值:未指定时使用 'inpainting'(人像保护模式)
    if (this.supportsParameter(actualModel, 'human_face_mode')) {
      body.human_face_mode = params.humanFaceMode ?? 'inpainting';
    }

    return body;
  }

  transformResponse(
    rawResponse: unknown,
    metadata?: { modelId: string; processingTime: number },
  ): UnifiedModelResponse {
    const raw = rawResponse as Record<string, any>;
    const status = raw.status;
    const isSucceeded = status === 'succeeded';
    const isFailed = status === 'failed';

    const normalizedStatus = isSucceeded
      ? TaskStatus.COMPLETED
      : isFailed
        ? TaskStatus.FAILED
        : TaskStatus.RUNNING;

    const usage = raw.usage;
    const tokens = usage
      ? {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
        }
      : undefined;

    return this.buildSuccessResponse(
      {
        status: normalizedStatus,
        urls: isSucceeded
          ? [raw.content?.video_url].filter(Boolean)
          : undefined,
        taskId: raw.id,
        extra: {
          lastFrameUrl: raw.content?.last_frame_url,
          error: raw.error,
        },
      },
      {
        modelId: metadata?.modelId || this.config.modelId,
        processingTime: metadata?.processingTime || 0,
        tokens,
        rawResponse,
      },
    );
  }

  private supportsParameter(modelId: string, parameter: string): boolean {
    const supports = this.variantSupportsMap.get(modelId);
    if (!supports) return true;
    return supports[parameter] === true;
  }

  private truncateUrls(
    urls: string[] | undefined,
    maxCount: number | undefined,
    typeLabel: string,
    modelId: string,
  ): string[] | undefined {
    if (!urls?.length) return urls;
    if (maxCount === undefined || maxCount <= 0) return urls;
    if (urls.length <= maxCount) return urls;
    console.warn(
      `[VolcEngineVideoAdapter] ${typeLabel} 数量超限 model=${modelId}, 原始=${urls.length}项, 截断后=${maxCount}项`,
    );
    return urls.slice(0, maxCount);
  }
}
