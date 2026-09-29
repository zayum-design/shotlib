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
 * DeepSeek 文本模型适配器
 * API 文档: https://api-docs.deepseek.com/zh-cn/
 * 模型配置: src/config/models/deepseek.json(构建期内联)
 */
import { BaseAdapter } from '../../core/base-adapter';
import type {
  AdapterConfig,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '../../core/types';
import { ModelException, ModelTimeoutException } from '../../core/exceptions';
import { DeepSeekErrorParser } from './error-parser';
import providerJson from '@/config/models/deepseek.json';

// json 构建期内联,断言为宽松结构(厂商专用字段原样保留)
const providerConfig = providerJson as unknown as {
  variants?: import('../../core/types').AdapterVariant[];
  config?: { reasoningTokenBuffer?: number };
};

export class DeepSeekAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'deepseek',
    modelName: 'DeepSeek',
    modelType: 'text',
    capabilities: [
      'text_generation',
      'text_chat',
      'batch_processing',
    ],
    isAsync: false,
    enabled: true,
    baseUrl: 'https://api.deepseek.com',
  };

  /** 推理模型集合(配置驱动:model.json variant.reasoning=true) */
  private reasoningModelSet = new Set<string>();
  /** 各变体最大输出 token 上限(model.json variant.maxOutputTokens) */
  private variantMaxOutputTokensMap = new Map<string, number>();
  /** 推理模型追加的输出预算(model.json config.reasoningTokenBuffer) */
  private reasoningTokenBuffer = 0;

  constructor() {
    super();
    this.loadVariants(providerConfig);
    for (const variant of this.config.variants || []) {
      // 推理模型由配置声明,禁止在代码中用 includes() 推断
      if ((variant as Record<string, unknown>).reasoning === true) {
        this.reasoningModelSet.add(variant.id);
      }
      const maxOutputTokens = (variant as Record<string, unknown>).maxOutputTokens;
      if (typeof maxOutputTokens === 'number') {
        this.variantMaxOutputTokensMap.set(variant.id, maxOutputTokens);
      }
    }
    this.reasoningTokenBuffer =
      (providerConfig as { config?: { reasoningTokenBuffer?: number } }).config
        ?.reasoningTokenBuffer ?? 0;
  }

  protected createErrorParser(): DeepSeekErrorParser {
    return new DeepSeekErrorParser();
  }

  /** 是否为推理模型(配置 reasoning=true,历史兼容兜底 r1/reasoner) */
  private isReasoningModel(modelId: string): boolean {
    return (
      this.reasoningModelSet.has(modelId) ||
      modelId.includes('r1') ||
      modelId.includes('reasoner')
    );
  }

  async process(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const startTime = Date.now();
    const modelId = request.modelId;
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new ModelException(
        '未配置 DeepSeek API Key,请在「设置」页填写',
        'API_KEY_MISSING',
        401,
        false,
      );
    }

    try {
      const body = this.transformRequest(request) as Record<string, unknown>;
      const baseUrl =
        this.getVariantBaseUrl(modelId) ||
        this.config.baseUrl ||
        'https://api.deepseek.com';

      const response = await this.fetchWithTimeout(
        `${baseUrl}/chat/completions`,
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
      return this.transformResponse(rawData, {
        modelId,
        processingTime: Date.now() - startTime,
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        throw new ModelTimeoutException(
          modelId,
          request.options?.timeout || 180000,
        );
      }
      if (error instanceof ModelException) throw error;
      throw new ModelException(
        `DeepSeek调用失败: ${err.message}`,
        'DEEPSEEK_ERROR',
        500,
        true,
      );
    }
  }

  transformRequest(request: UnifiedModelRequest): unknown {
    const input = this.parseInput(request.input);
    const modelId = request.modelId;
    const actualModel =
      modelId === 'deepseek'
        ? this.config.variants?.[0]?.id || 'deepseek-v4-flash'
        : modelId;

    // 构建消息数组
    const messages: Array<{
      role: string;
      content: string;
      reasoning_content?: string;
    }> = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    if (input.messages) {
      for (const m of input.messages) {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        // 多轮对话时,如果上一条 assistant 消息有 reasoning_content,必须传回
        const reasoning = (m as Record<string, unknown>).reasoning_content;
        if (m.role === 'assistant' && reasoning) {
          msg.reasoning_content = reasoning;
        }
        messages.push(msg as { role: string; content: string });
      }
    } else if (input.text) {
      messages.push({ role: 'user', content: input.text });
    }

    // 参数转换
    const params = (request.parameters || {}) as Record<string, any>;
    const processedParams: Record<string, unknown> = {};

    // 推理模型不支持 temperature、top_p 等参数
    if (!this.isReasoningModel(actualModel)) {
      if (params.temperature !== undefined)
        processedParams.temperature = params.temperature;
      if (params.topP !== undefined) processedParams.top_p = params.topP;
      if (params.top_p !== undefined) processedParams.top_p = params.top_p;
      if (params.presence_penalty !== undefined)
        processedParams.presence_penalty = params.presence_penalty;
      if (params.frequency_penalty !== undefined)
        processedParams.frequency_penalty = params.frequency_penalty;
    }

    let maxTokens = params.maxTokens ?? params.max_tokens;
    if (maxTokens !== undefined) {
      // 推理模型的 reasoning_content 计入 max_tokens 输出预算:
      // 调用方传的 maxTokens 是期望的正文长度,推理链额外占用预算,
      // 不足时正文被截断甚至 content 为空。
      // 推理预算与输出上限均由 model.json 配置驱动
      if (this.isReasoningModel(actualModel)) {
        maxTokens = maxTokens + this.reasoningTokenBuffer;
      }
      const maxOutputTokens = this.variantMaxOutputTokensMap.get(actualModel);
      if (maxOutputTokens !== undefined && maxTokens > maxOutputTokens) {
        console.warn(
          `[DeepSeekAdapter] max_tokens ${maxTokens} 超过上限 ${maxOutputTokens} (model.json maxOutputTokens),已截断`,
        );
        maxTokens = maxOutputTokens;
      }
      processedParams.max_tokens = maxTokens;
    }

    if (params.stream !== undefined) processedParams.stream = params.stream;
    if (params.responseFormat !== undefined)
      processedParams.response_format = params.responseFormat;
    if (params.response_format !== undefined)
      processedParams.response_format = params.response_format;
    // thinking 控制(DeepSeek 官方参数,如 {"type":"disabled"} 关闭思考模式):
    // 仅在调用方显式携带时透传,未传时保持模型默认行为
    if (params.thinking !== undefined) processedParams.thinking = params.thinking;

    return {
      model: actualModel,
      messages,
      ...processedParams,
    };
  }

  transformResponse(
    rawResponse: unknown,
    metadata?: { modelId: string; processingTime: number },
  ): UnifiedModelResponse {
    const raw = rawResponse as Record<string, any>;
    const choice = raw.choices?.[0];
    const message = choice?.message || {};
    const content = message.content || '';
    const reasoningContent = message.reasoning_content || '';
    const usage = raw.usage;

    // 推理链耗尽输出预算时正文为空:打警告便于排查
    // (上游 HTTP 200 无法感知,finish_reason=length + content 空是特征)
    if (!content && reasoningContent) {
      console.warn(
        `[DeepSeekAdapter] 正文为空(推理链耗尽 max_tokens?)model=${metadata?.modelId}, finish_reason=${choice?.finish_reason}, reasoning长度=${reasoningContent.length}`,
      );
    }

    // 构建 token 使用量(包含 DeepSeek 特有字段)
    const tokenInfo: Record<string, number> | undefined = usage
      ? {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
        }
      : undefined;

    // DeepSeek 特有字段放入 extra
    const extra: Record<string, unknown> = {};
    if (reasoningContent) {
      extra.reasoningContent = reasoningContent;
    }
    if (usage?.reasoning_tokens !== undefined) {
      extra.reasoningTokens = usage.reasoning_tokens;
    }
    if (usage?.prompt_cache_hit_tokens !== undefined) {
      extra.promptCacheHitTokens = usage.prompt_cache_hit_tokens;
    }
    if (usage?.prompt_cache_miss_tokens !== undefined) {
      extra.promptCacheMissTokens = usage.prompt_cache_miss_tokens;
    }

    return this.buildSuccessResponse(
      {
        content,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      },
      {
        modelId: metadata?.modelId || this.config.modelId,
        processingTime: metadata?.processingTime || 0,
        tokens: tokenInfo,
        rawResponse,
      },
    );
  }
}
