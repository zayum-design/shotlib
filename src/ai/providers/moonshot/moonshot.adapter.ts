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
 * Moonshot(Kimi)文本模型适配器
 * 模型配置: src/config/models/moonshot.json(构建期内联)
 */
import { BaseAdapter } from '../../core/base-adapter';
import type {
  AdapterConfig,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '../../core/types';
import { ModelException, ModelTimeoutException } from '../../core/exceptions';
import { MoonshotErrorParser } from './error-parser';
import providerJson from '@/config/models/moonshot.json';

// json 构建期内联,断言为宽松结构(厂商专用字段原样保留)
const providerConfig = providerJson as unknown as {
  variants?: import('../../core/types').AdapterVariant[];
  config?: { reasoningTokenBuffer?: number };
};

export class MoonshotAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'moonshot',
    modelName: 'Moonshot',
    modelType: 'text',
    capabilities: [
      'text_generation',
      'text_chat',
      'batch_processing',
    ],
    isAsync: false,
    enabled: true,
    baseUrl: 'https://api.moonshot.cn/v1',
  };

  // 变体级强制参数(来自 model.json variant.parameters,如 kimi 仅允许 temperature=1)
  private variantParametersMap = new Map<string, Record<string, unknown>>();
  /** 推理模型集合(配置驱动:model.json variant.reasoning=true,如 kimi-k3) */
  private reasoningModelSet = new Set<string>();
  /** 各变体最大输出 token 上限(model.json variant.maxOutputTokens) */
  private variantMaxOutputTokensMap = new Map<string, number>();
  /** 推理模型追加的输出预算(model.json config.reasoningTokenBuffer) */
  private reasoningTokenBuffer = 0;

  constructor() {
    super();
    this.loadVariants(providerConfig);
    for (const variant of this.config.variants || []) {
      const v = variant as Record<string, unknown>;
      if (v.parameters && typeof v.parameters === 'object') {
        this.variantParametersMap.set(variant.id, v.parameters as Record<string, unknown>);
      }
      // 推理模型由配置声明,禁止在代码中用 includes() 推断
      if (v.reasoning === true) {
        this.reasoningModelSet.add(variant.id);
      }
      if (typeof v.maxOutputTokens === 'number') {
        this.variantMaxOutputTokensMap.set(variant.id, v.maxOutputTokens);
      }
    }
    this.reasoningTokenBuffer =
      (providerConfig as { config?: { reasoningTokenBuffer?: number } }).config
        ?.reasoningTokenBuffer ?? 0;
  }

  protected createErrorParser(): MoonshotErrorParser {
    return new MoonshotErrorParser();
  }

  async process(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const startTime = Date.now();
    const modelId = request.modelId;
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new ModelException(
        '未配置 Moonshot API Key,请在「设置」页填写',
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
        'https://api.moonshot.cn/v1';

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
        `Moonshot调用失败: ${err.message}`,
        'MOONSHOT_ERROR',
        500,
        true,
      );
    }
  }

  transformRequest(request: UnifiedModelRequest): unknown {
    const input = this.parseInput(request.input);
    const actualModel =
      request.modelId === 'moonshot'
        ? this.config.variants?.[0]?.id || 'kimi-k3'
        : request.modelId;

    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    if (input.messages) {
      messages.push(
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      );
    } else if (input.text) {
      messages.push({ role: 'user', content: input.text });
    }

    const params = (request.parameters || {}) as Record<string, any>;

    // 推理模型的 reasoning_content 计入 max_tokens 输出预算:
    // 调用方传的 maxTokens 是期望的正文长度,推理链额外占用预算,
    // 不足时正文被截断甚至 content 为空。
    // 推理预算与输出上限均由 model.json 配置驱动
    let maxTokens = params.maxTokens ?? params.max_tokens ?? 2000;
    if (this.reasoningModelSet.has(actualModel)) {
      maxTokens = maxTokens + this.reasoningTokenBuffer;
    }
    const maxOutputTokens = this.variantMaxOutputTokensMap.get(actualModel);
    if (maxOutputTokens !== undefined && maxTokens > maxOutputTokens) {
      console.warn(
        `[MoonshotAdapter] max_tokens ${maxTokens} 超过上限 ${maxOutputTokens} (model.json maxOutputTokens),已截断`,
      );
      maxTokens = maxOutputTokens;
    }

    // 变体级强制参数必须放在 ...params 之后,确保覆盖调用方传入的同名参数
    const variantParams = this.variantParametersMap.get(actualModel) || {};
    return {
      model: actualModel,
      messages,
      temperature: params.temperature ?? 0.7,
      ...params,
      // max_tokens 放在 ...params 之后:推理预算计算结果覆盖调用方原始 max_tokens
      max_tokens: maxTokens,
      ...variantParams,
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
        `[MoonshotAdapter] 正文为空(推理链耗尽 max_tokens?)model=${metadata?.modelId}, finish_reason=${choice?.finish_reason}, reasoning长度=${reasoningContent.length}`,
      );
    }

    return this.buildSuccessResponse(
      { content },
      {
        modelId: metadata?.modelId || this.config.modelId,
        processingTime: metadata?.processingTime || 0,
        tokens: usage
          ? {
              prompt: usage.prompt_tokens,
              completion: usage.completion_tokens,
              total: usage.total_tokens,
            }
          : undefined,
        rawResponse,
      },
    );
  }
}
