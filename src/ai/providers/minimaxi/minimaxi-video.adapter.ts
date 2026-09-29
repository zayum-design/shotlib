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
 * MiniMax 视频模型适配器(MiniMax H3)
 * API 文档: https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create
 * 支持模式: 文生视频(t2va) / 首尾帧图生视频(i2va) / 全能参考生视频(r2va)
 * 协议: 多模态 content[] 结构,异步任务(submit + query 轮询)
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
import { MiniMaxErrorParser } from './error-parser';
import providerJson from '@/config/models/minimaxi.json';

// json 构建期内联,断言为宽松结构(厂商专用字段原样保留)
const providerConfig = providerJson as unknown as {
  variants?: import('../../core/types').AdapterVariant[];
  config?: { reasoningTokenBuffer?: number };
};

export class MiniMaxVideoAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'minimaxi',
    modelName: 'MiniMax 视频',
    modelType: 'video',
    capabilities: ['video_generation', 'async_task'],
    isAsync: true,
    pollingMode: PollingMode.CLIENT_SIDE,
    enabled: true,
    baseUrl: 'https://api.minimaxi.com',
  };

  private variantSupportsMap = new Map<string, Record<string, any>>();

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

  protected createErrorParser(): MiniMaxErrorParser {
    return new MiniMaxErrorParser();
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
        '未配置 MiniMax API Key,请在「设置」页填写',
        'API_KEY_MISSING',
        401,
        false,
      );
    }

    try {
      const body = this.transformRequest(request);
      const baseUrl = this.getVariantBaseUrl(modelId) || this.config.baseUrl!;

      const response = await this.fetchWithTimeout(`${baseUrl}/v2/video_generation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        timeout: request.options?.timeout || 60000,
      });

      if (!response.ok) {
        await this.handleHttpError(response);
      }

      const rawData = await response.json();
      this.handleBusinessError(rawData);

      const taskId = (rawData as Record<string, any>).task_id;
      if (!taskId) {
        throw new ModelException(
          'MiniMax Video API未返回任务ID,请检查模型权限或请求参数',
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
          request.options?.timeout || 60000,
        );
      }
      if (error instanceof ModelException) throw error;
      throw new ModelException(
        `MiniMax Video提交失败: ${err.message}`,
        'MINIMAX_VIDEO_ERROR',
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
        : this.config.variants?.[0]?.id || 'MiniMax-H3';
    const apiKey = await this.getApiKey();
    const baseUrl = this.getVariantBaseUrl(actualModelId) || this.config.baseUrl!;

    try {
      const response = await this.fetchWithTimeout(
        `${baseUrl}/v2/query/video_generation/${taskId}`,
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

  transformRequest(request: UnifiedModelRequest): unknown {
    const input = request.input;
    const params = (request.parameters || {}) as Record<string, any>;
    const actualModel =
      request.modelId &&
      this.config.variants?.some((v) => v.id === request.modelId)
        ? request.modelId
        : this.config.variants?.[0]?.id || 'MiniMax-H3';

    const variantSupports = this.variantSupportsMap.get(actualModel);

    // 按类型截断参考资源,避免超出 API 限制
    const referenceImageUrls = this.truncateUrls(
      input.referenceImageUrls,
      variantSupports?.reference_image_max_count as number | undefined,
      'reference_image',
      actualModel,
    );
    const referenceVideoUrls = this.truncateUrls(
      input.referenceVideoUrls,
      variantSupports?.reference_video_max_count as number | undefined,
      'reference_video',
      actualModel,
    );
    const referenceAudioUrls = this.truncateUrls(
      input.referenceAudioUrls,
      variantSupports?.reference_audio_max_count as number | undefined,
      'reference_audio',
      actualModel,
    );

    const content: any[] = [];

    // 文本提示(必填),清理前端残留的 HTML 标签(role/scene/portrait/img)
    const rawText = input.text || params.prompt;
    if (rawText) {
      let sanitizedText = (rawText as string)
        .replace(/@<role\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/role>/gi, '$1')
        .replace(/#<scene\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/scene>/gi, '$1')
        .replace(
          /@<portrait\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/portrait>/gi,
          '$1',
        )
        .replace(/<img[^>]*>/gi, '')
        .replace(/<\/?[a-z][^>]*>/gi, '')
        .trim();

      const maxChars = variantSupports?.prompt_max_chars as number | undefined;
      if (maxChars && sanitizedText.length > maxChars) {
        console.warn(
          `[MiniMaxVideoAdapter] 提示词超长 model=${actualModel}, ${sanitizedText.length}字符, 截断至${maxChars}字符`,
        );
        sanitizedText = sanitizedText.slice(0, maxChars);
      }

      content.push({ type: 'text', text: sanitizedText });
    }

    // 首帧/尾帧(role=first_frame / last_frame)
    if (input.firstFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: input.firstFrameUrl },
        role: 'first_frame',
      });
    }
    if (input.lastFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: input.lastFrameUrl },
        role: 'last_frame',
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
    if (referenceVideoUrls?.length) {
      for (const url of referenceVideoUrls) {
        content.push({
          type: 'video_url',
          video_url: { url },
          role: 'reference_video',
        });
      }
    }

    // 参考音频(必须搭配图片或视频输入,不能单独传入)
    const hasVisualInput = content.some(
      (c) => c.type === 'image_url' || c.type === 'video_url',
    );
    if (referenceAudioUrls?.length && hasVisualInput) {
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

    // 时长:H3 仅支持 4~15 秒整数,越界收敛到范围内
    if (params.duration) {
      const duration = Math.round(Number(params.duration));
      const min = 4;
      const max = 15;
      body.duration = Math.min(max, Math.max(min, duration));
    }

    // 分辨率:归一化到 H3 支持的档位(768P / 2K)
    const resolutions: string[] =
      (variantSupports?.resolutions as string[]) || ['768P'];
    body.resolution = this.normalizeResolution(
      params.resolution as string | undefined,
      resolutions,
    );

    // 宽高比:
    // - 纯文生视频(无任何图片/视频输入):ratio 必填且不能为 adaptive,取业务传入比例,兜底 16:9
    // - 全能参考(r2va,无首/尾帧):ratio 可选,显式传业务比例;否则默认 adaptive 可能选出与项目不一致的比例
    // - 首尾帧/图生视频(i2va):宽高比由输入图片决定,API 恒按 adaptive 处理,传入也会被忽略,不传
    const hasFrameInput = !!(input.firstFrameUrl || input.lastFrameUrl);
    if (!hasVisualInput) {
      body.ratio = params.ratio || '16:9';
    } else if (!hasFrameInput && params.ratio) {
      body.ratio = params.ratio;
    }

    return body;
  }

  transformResponse(
    rawResponse: unknown,
    metadata?: { modelId: string; processingTime: number },
  ): UnifiedModelResponse {
    const raw = rawResponse as Record<string, any>;
    const task = raw.task || {};
    const status = task.status;
    const isSucceeded = status === 'succeeded';
    const isFailed = status === 'failed' || status === 'cancelled';

    const normalizedStatus = isSucceeded
      ? TaskStatus.COMPLETED
      : isFailed
        ? TaskStatus.FAILED
        : TaskStatus.RUNNING;

    return this.buildSuccessResponse(
      {
        status: normalizedStatus,
        urls: isSucceeded ? [task.content?.url].filter(Boolean) : undefined,
        taskId: task.task_id || raw.task_id,
        extra: {
          error: task.error,
        },
      },
      {
        modelId: metadata?.modelId || this.config.modelId,
        processingTime: metadata?.processingTime || 0,
        rawResponse,
      },
    );
  }

  /**
   * 将传入的分辨率参数归一化到模型支持的档位
   * 优先精确匹配;否则高清参数(1080p 等)映射到最高档,标清参数(720p 等)映射到默认档
   */
  private normalizeResolution(
    resolution: string | undefined,
    resolutions: string[],
  ): string {
    const defaultResolution = resolutions[0];
    if (!resolution) return defaultResolution;
    if (resolutions.includes(resolution)) return resolution;

    // 数字档位比较(如 1080p → 1080,720p → 720,2K 视为最高档)
    const isHighRes = /2k|4k|1080/i.test(resolution);
    return isHighRes ? resolutions[resolutions.length - 1] : defaultResolution;
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
      `[MiniMaxVideoAdapter] ${typeLabel} 数量超限 model=${modelId}, 原始=${urls.length}项, 截断后=${maxCount}项`,
    );
    return urls.slice(0, maxCount);
  }
}
