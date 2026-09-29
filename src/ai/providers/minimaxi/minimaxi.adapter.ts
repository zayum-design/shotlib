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
 * MiniMax 文本模型适配器
 * API 文档: https://platform.minimaxi.com/docs/llms.txt
 * 协议: OpenAI 兼容 (/v1/chat/completions)
 */
import { BaseAdapter } from '../../core/base-adapter';
import type {
  AdapterConfig,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '../../core/types';
import { ModelException, ModelTimeoutException } from '../../core/exceptions';
import { MiniMaxErrorParser } from './error-parser';
import providerJson from '@/config/models/minimaxi.json';

// json 构建期内联,断言为宽松结构(厂商专用字段原样保留)
const providerConfig = providerJson as unknown as {
  variants?: import('../../core/types').AdapterVariant[];
  config?: { reasoningTokenBuffer?: number };
};

export class MiniMaxAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'minimaxi',
    modelName: 'MiniMax',
    modelType: 'text',
    capabilities: [
      'text_generation',
      'text_chat',
      'text_summarization',
    ],
    isAsync: false,
    enabled: true,
    baseUrl: 'https://api.minimaxi.com/v1',
  };

  /** 推理模型集合(配置驱动:model.json variant.reasoning=true,如 MiniMax-M2.7) */
  private reasoningModelSet = new Set<string>();
  /** 各变体最大输出 token 上限(model.json variant.maxOutputTokens) */
  private variantMaxOutputTokensMap = new Map<string, number>();
  /** 推理模型追加的输出预算(model.json config.reasoningTokenBuffer) */
  private reasoningTokenBuffer = 0;

  constructor() {
    super();
    // 仅注入 text 类型变体
    (this.config as AdapterConfig).variants = (providerConfig.variants || []).filter(
      (v) => v.enabled !== false && v.type === 'text',
    );
    for (const variant of this.config.variants || []) {
      const v = variant as Record<string, any>;
      // 推理模型由配置声明,禁止在代码中用 includes() 推断
      if (v.reasoning === true) {
        this.reasoningModelSet.add(variant.id);
      }
      if (typeof v.maxOutputTokens === 'number') {
        this.variantMaxOutputTokensMap.set(variant.id, v.maxOutputTokens);
      }
    }
    this.reasoningTokenBuffer =
      (
        providerConfig as {
          config?: { reasoningTokenBuffer?: number };
        }
      ).config?.reasoningTokenBuffer ?? 0;
  }

  protected createErrorParser(): MiniMaxErrorParser {
    return new MiniMaxErrorParser();
  }

  async process(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
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

      const response = await this.fetchWithTimeout(`${baseUrl}/chat/completions`, {
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
        `MiniMax调用失败: ${err.message}`,
        'MINIMAX_ERROR',
        500,
        true,
      );
    }
  }

  transformRequest(request: UnifiedModelRequest): unknown {
    const input = this.parseInput(request.input);
    const actualModel =
      request.modelId &&
      this.config.variants?.some((v) => v.id === request.modelId)
        ? request.modelId
        : this.config.variants?.[0]?.id || 'MiniMax-M2.7';

    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    if (input.messages) {
      for (const m of input.messages) {
        messages.push({ role: m.role, content: m.content });
      }
    } else if (input.text) {
      messages.push({ role: 'user', content: input.text });
    }

    const params = (request.parameters || {}) as Record<string, any>;
    const processedParams: Record<string, any> = {};

    if (params.temperature !== undefined)
      processedParams.temperature = params.temperature;
    if (params.topP !== undefined) processedParams.top_p = params.topP;
    if (params.top_p !== undefined) processedParams.top_p = params.top_p;
    if (params.presence_penalty !== undefined)
      processedParams.presence_penalty = params.presence_penalty;
    if (params.frequency_penalty !== undefined)
      processedParams.frequency_penalty = params.frequency_penalty;

    let maxTokens = params.maxTokens ?? params.max_tokens;
    if (maxTokens !== undefined) {
      // 推理模型的 reasoning_content 计入 max_tokens 输出预算:
      // 额外追加推理预算,避免推理链耗尽预算导致正文为空。
      // 推理预算(config.reasoningTokenBuffer)与输出上限(variant.maxOutputTokens)
      // 均由 model.json 配置驱动,不在代码中硬编码
      if (this.reasoningModelSet.has(actualModel)) {
        maxTokens = maxTokens + this.reasoningTokenBuffer;
      }
      const maxOutputTokens = this.variantMaxOutputTokensMap.get(actualModel);
      if (maxOutputTokens !== undefined && maxTokens > maxOutputTokens) {
        console.warn(
          `[MiniMaxAdapter] max_tokens ${maxTokens} 超过上限 ${maxOutputTokens} (model.json maxOutputTokens),已截断`,
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
    if (!content && reasoningContent) {
      console.warn(
        `[MiniMaxAdapter] 正文为空(推理链耗尽 max_tokens?)model=${metadata?.modelId}, finish_reason=${choice?.finish_reason}, reasoning长度=${reasoningContent.length}`,
      );
    }

    const tokenInfo = usage
      ? {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
        }
      : undefined;

    return this.buildSuccessResponse(
      {
        content,
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
