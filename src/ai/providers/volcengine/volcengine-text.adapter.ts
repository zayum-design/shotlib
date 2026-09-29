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
 * 火山引擎文本模型适配器
 * 变体 baseUrl 已含完整路径(/chat/completions),请求直接 POST 到 baseUrl
 */
import { BaseAdapter } from '../../core/base-adapter';
import type {
  AdapterConfig,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '../../core/types';
import { ModelException, ModelTimeoutException } from '../../core/exceptions';
import { VolcEngineErrorParser } from './error-parser';
import providerJson from '@/config/models/volcengine.json';

// json 构建期内联,断言为宽松结构(厂商专用字段原样保留)
const providerConfig = providerJson as unknown as {
  variants?: import('../../core/types').AdapterVariant[];
  config?: { reasoningTokenBuffer?: number };
};

export class VolcEngineTextAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'volcengine',
    modelName: '豆包对话',
    modelType: 'text',
    capabilities: [
      'text_generation',
      'text_chat',
      'text_summarization',
    ],
    isAsync: false,
    enabled: true,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  };

  /** 推理模型集合(配置驱动:model.json variant.reasoning=true) */
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

  protected createErrorParser(): VolcEngineErrorParser {
    return new VolcEngineErrorParser();
  }

  async process(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
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

      const response = await this.fetchWithTimeout(baseUrl, {
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
        `VolcEngine调用失败: ${err.message}`,
        'VOLCENGINE_ERROR',
        500,
        true,
      );
    }
  }

  transformRequest(request: UnifiedModelRequest): unknown {
    const input = this.parseInput(request.input);
    const actualModel = this.config.variants?.some((v) => v.id === request.modelId)
      ? request.modelId
      : this.config.variants?.[0]?.id || 'doubao-seed-evolving';

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
    const processedParams: Record<string, unknown> = {};

    if (params.temperature !== undefined)
      processedParams.temperature = params.temperature;
    // 推理模型的 reasoning_content 计入 max_tokens 输出预算:
    // 推理预算与输出上限均由 model.json 配置驱动
    let maxTokens = params.maxTokens ?? params.max_tokens;
    if (maxTokens !== undefined) {
      if (this.reasoningModelSet.has(actualModel)) {
        maxTokens = maxTokens + this.reasoningTokenBuffer;
      }
      const maxOutputTokens = this.variantMaxOutputTokensMap.get(actualModel);
      if (maxOutputTokens !== undefined && maxTokens > maxOutputTokens) {
        console.warn(
          `[VolcEngineTextAdapter] max_tokens ${maxTokens} 超过上限 ${maxOutputTokens} (model.json maxOutputTokens),已截断`,
        );
        maxTokens = maxOutputTokens;
      }
      processedParams.max_tokens = maxTokens;
    }
    if (params.topP !== undefined) processedParams.top_p = params.topP;
    if (params.stream !== undefined) processedParams.stream = params.stream;

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
    // 火山推理模型(Seed 1.6+/2.x)返回 reasoning_content,正文为空时打警告便于排查
    const reasoningContent = message.reasoning_content || '';
    if (!content && reasoningContent) {
      console.warn(
        `[VolcEngineTextAdapter] 正文为空(推理链耗尽 max_tokens?)model=${metadata?.modelId}, finish_reason=${choice?.finish_reason}, reasoning长度=${reasoningContent.length}`,
      );
    }
    const usage = raw.usage;

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
