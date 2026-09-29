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
 * 阿里云图片模型适配器
 *
 * 支持两套 API:
 * 1. 万相 (Wan) 异步:POST /services/aigc/image-generation/generation 提交任务,轮询 /tasks/{taskId}
 * 2. 千问 (Qwen) 同步:POST /services/aigc/multimodal-generation/generation 直接返回结果
 *
 * 异步变体 process() 只负责提交返回 taskId,轮询由前端 task-runner 统一负责
 */
import { BaseAdapter } from '../../core/base-adapter';
import type {
  AdapterConfig,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '../../core/types';
import { PollingMode, TaskStatus } from '../../core/types';
import { ModelException, ModelTimeoutException } from '../../core/exceptions';
import { AliyunErrorParser } from './error-parser';
import {
  extractImageUrls,
  resolveSize,
  resolveActualModelId,
} from './aliyun-image.utils';
import providerJson from '@/config/models/aliyun.json';

// json 构建期内联,断言为宽松结构(厂商专用字段原样保留)
const providerConfig = providerJson as unknown as {
  variants?: import('../../core/types').AdapterVariant[];
  config?: { reasoningTokenBuffer?: number };
};

export class AliyunImageAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'aliyun',
    modelName: '阿里云万相图片',
    modelType: 'image',
    capabilities: ['image_generation', 'image_edit', 'async_task'],
    isAsync: true,
    pollingMode: PollingMode.CLIENT_SIDE,
    enabled: true,
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  };

  private variantSupportsMap = new Map<string, Record<string, any>>();
  private variantAsyncMap = new Map<string, boolean>();
  private variantAsyncConfigMap = new Map<
    string,
    { taskQueryUrl: string; taskQueryPath: string }
  >();

  constructor() {
    super();
    // 仅注入 image 类型变体
    const variants = (providerConfig.variants || []).filter(
      (v) => v.enabled !== false && v.type === 'image',
    );
    (this.config as AdapterConfig).variants = variants;
    for (const variant of variants) {
      const v = variant as Record<string, any>;
      if (v.supports) {
        this.variantSupportsMap.set(variant.id, v.supports);
      }
      this.variantAsyncMap.set(variant.id, !!v.async);
      if (v.async) {
        this.variantAsyncConfigMap.set(variant.id, {
          taskQueryUrl: v.taskQueryUrl || this.config.baseUrl!,
          taskQueryPath: v.taskQueryPath || '/tasks/{taskId}',
        });
      }
    }
  }

  protected createErrorParser(): AliyunErrorParser {
    return new AliyunErrorParser();
  }

  /**
   * 同步入口
   * - Wan 异步模型:提交任务返回 taskId(轮询走 task-runner)
   * - Qwen 同步模型:直接请求返回
   */
  async process(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const actualModel = resolveActualModelId(
      request.modelId,
      this.config.variants,
    );
    const isAsync = this.variantAsyncMap.get(actualModel) ?? false;

    if (isAsync) {
      return this.submit({ ...request, modelId: actualModel });
    }
    return this.processSync(request, actualModel);
  }

  /**
   * 同步模型直接请求
   */
  private async processSync(
    request: UnifiedModelRequest,
    actualModel: string,
  ): Promise<UnifiedModelResponse> {
    const startTime = Date.now();
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
      const body = this.transformRequest({ ...request, modelId: actualModel });
      const variantUrl = this.getVariantBaseUrl(actualModel);
      // 变体 baseUrl 已含完整路径时直接用,否则拼接多模态生成路径
      const url =
        variantUrl && variantUrl.includes('/generation')
          ? variantUrl
          : `${this.config.baseUrl}/services/aigc/multimodal-generation/generation`;

      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        timeout: request.options?.timeout || 180000,
      });

      if (!response.ok) {
        await this.handleHttpError(response);
      }

      const rawData = await response.json();
      this.handleBusinessError(rawData);

      return this.transformResponse(rawData, {
        modelId: actualModel,
        processingTime: Date.now() - startTime,
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        throw new ModelTimeoutException(
          actualModel,
          request.options?.timeout || 180000,
        );
      }
      if (error instanceof ModelException) throw error;
      throw new ModelException(
        `Aliyun Image 调用失败: ${err.message}`,
        'ALIYUN_IMAGE_ERROR',
        500,
        true,
      );
    }
  }

  /**
   * 提交异步任务(仅 Wan 异步模型),返回 taskId 供 task-runner 轮询
   */
  async submit(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const startTime = Date.now();
    const actualModel = resolveActualModelId(
      request.modelId,
      this.config.variants,
    );
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
      const body = this.transformRequest({ ...request, modelId: actualModel });
      const variantUrl = this.getVariantBaseUrl(actualModel);
      // 异步图片生成路径;变体 baseUrl 已含完整路径时直接用
      const url =
        variantUrl && variantUrl.includes('/generation')
          ? variantUrl
          : `${variantUrl || this.config.baseUrl}/services/aigc/image-generation/generation`;

      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify(body),
        timeout: request.options?.timeout || 30000,
      });

      if (!response.ok) {
        await this.handleHttpError(response);
      }

      const rawData = await response.json();
      this.handleBusinessError(rawData);
      const taskId = (rawData as Record<string, any>)?.output?.task_id;

      return this.buildSuccessResponse(
        { taskId, status: TaskStatus.PENDING },
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
        `Aliyun Image 提交失败: ${err.message}`,
        'ALIYUN_IMAGE_SUBMIT_ERROR',
        500,
        true,
      );
    }
  }

  /**
   * 查询异步任务状态
   */
  async query(taskId: string, modelId?: string): Promise<UnifiedModelResponse> {
    const startTime = Date.now();
    const actualModel = resolveActualModelId(
      modelId || '',
      this.config.variants,
    );
    const apiKey = await this.getApiKey();

    try {
      const queryUrl = this.buildQueryUrl(actualModel, taskId);

      const response = await this.fetchWithTimeout(queryUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 15000,
      });

      if (!response.ok) {
        await this.handleHttpError(response);
      }

      const rawData = await response.json();
      const output = (rawData as Record<string, any>).output || {};
      const rawStatus = (output.task_status || '').toUpperCase();
      const normalized =
        rawStatus === 'SUCCEEDED'
          ? TaskStatus.COMPLETED
          : rawStatus === 'FAILED' || rawStatus === 'ERROR'
            ? TaskStatus.FAILED
            : TaskStatus.RUNNING;

      return this.buildSuccessResponse(
        {
          status: normalized,
          urls:
            normalized === TaskStatus.COMPLETED
              ? extractImageUrls(output)
              : undefined,
          taskId,
          extra: {
            requestId: (rawData as Record<string, any>).request_id,
            taskStatus: output.task_status,
            usage: (rawData as Record<string, any>).usage,
          },
        },
        {
          modelId: actualModel,
          processingTime: Date.now() - startTime,
          rawResponse: rawData,
        },
      );
    } catch (error) {
      if (error instanceof ModelException) throw error;
      throw new ModelException(
        `Aliyun Image 查询失败: ${(error as Error).message}`,
        'ALIYUN_IMAGE_QUERY_ERROR',
        500,
        true,
      );
    }
  }

  /**
   * 构造请求体(同步/异步共用,DashScope 标准格式)
   */
  transformRequest(request: UnifiedModelRequest): unknown {
    const input = this.parseInput(request.input);
    const params = (request.parameters || {}) as Record<string, any>;
    const actualModel = resolveActualModelId(
      request.modelId,
      this.config.variants,
    );
    const supports = this.variantSupportsMap.get(actualModel) || {};

    const promptText = input.text || params.prompt || '';
    const content: any[] = [];

    // 参考图(图生图)—— 阿里云 multimodal 接口支持在 content 中混合 image 与 text
    const hasReferenceImage =
      input.images &&
      input.images.length > 0 &&
      supports.image_to_image === true;

    if (hasReferenceImage) {
      // 部分模型限制参考图数量(如 qwen-image-2.0 系列最多 3 张),按 supports 限制截断
      const maxImages =
        (supports.reference_image_max_count as number) || input.images!.length;
      for (const url of input.images!.slice(0, maxImages)) {
        content.push({ image: url });
      }
      // 阿里云要求:如果有参考图,需要在 text 中标注"参考图1"等标记
      // 这帮助模型正确关联参考图和提示词
      content.push({ text: `参考图1，${promptText}` });
    } else {
      content.push({ text: promptText });
    }

    const messages = [
      {
        role: 'user',
        content,
      },
    ];

    // 参数构造
    const parameters: Record<string, any> = {};

    // 尺寸
    const sizeValue = resolveSize(params, supports);
    if (sizeValue) {
      // wan2.7-image-pro / wan2.7-image 支持 1K/2K/4K 缩写
      parameters.size = sizeValue;
    }

    // 图片数量
    if (params.numImages || params.n) {
      parameters.n = Number(params.numImages || params.n) || 1;
    }

    // 水印
    parameters.watermark =
      params.watermark !== undefined ? Boolean(params.watermark) : false;

    // 负向提示词:前端未传时注入默认质量负面词(wan2.7-image-pro / wan2.7-image 不支持)
    const negativePrompt =
      params.negativePrompt ?? '模糊,低质量,变形,丑陋,不合理构图';
    if (negativePrompt && supports.negative_prompt !== false) {
      parameters.negative_prompt = negativePrompt;
    }

    // prompt_extend(wan2.7-image-pro / wan2.7-image 不支持)
    if (supports.prompt_extend !== false) {
      parameters.prompt_extend =
        params.promptExtend !== undefined ? Boolean(params.promptExtend) : true;
    }

    // thinking_mode(wan2.7-image-pro / wan2.7-image 独有)
    if (supports.thinking_mode && !params.enableSequential) {
      parameters.thinking_mode =
        params.thinkingMode !== undefined ? Boolean(params.thinkingMode) : true;
    }

    // 组图模式
    if (supports.enable_sequential && params.enableSequential !== undefined) {
      parameters.enable_sequential = Boolean(params.enableSequential);
    }

    // 自定义色板
    if (
      supports.color_palette &&
      Array.isArray(params.colorPalette) &&
      params.colorPalette.length > 0
    ) {
      parameters.color_palette = params.colorPalette;
    }

    // seed
    if (params.seed !== undefined && supports.seed !== false) {
      parameters.seed = Number(params.seed);
    }

    const body: Record<string, any> = {
      model: actualModel,
      input: { messages },
      parameters,
    };

    // 千问同步接口的额外参数
    if (!this.variantAsyncMap.get(actualModel)) {
      body.parameters.result_format =
        body.parameters.result_format || 'message';
    }

    return body;
  }

  /**
   * 解析同步响应(异步任务的成功响应也走这里)
   */
  transformResponse(
    rawResponse: unknown,
    metadata?: { modelId: string; processingTime: number },
  ): UnifiedModelResponse {
    const raw = rawResponse as Record<string, any>;
    const output = raw.output || {};
    const urls = extractImageUrls(output);

    return this.buildSuccessResponse(
      {
        urls,
        extra: {
          requestId: raw.request_id,
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

  private buildQueryUrl(modelId: string, taskId: string): string {
    const asyncConfig = this.variantAsyncConfigMap.get(modelId);
    if (asyncConfig) {
      const p = asyncConfig.taskQueryPath.replace('{taskId}', taskId);
      return `${asyncConfig.taskQueryUrl}${p}`;
    }
    return `${this.config.baseUrl}/tasks/${taskId}`;
  }
}
