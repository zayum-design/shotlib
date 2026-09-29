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
 * 适配器基类(移植自后端 BaseAdapter,去除 NestJS/日志文件/健康监控)
 *
 * 提供:
 * 1. 配置管理(variants 由子类从 model.json 注入)
 * 2. 统一 HTTP 错误处理入口
 * 3. 成功/失败响应构建
 * 4. API Key 读取(浏览器本地设置)与带超时/代理策略的 fetch
 */
import { settingsRepo } from '@/storage/settingsRepo';
import { providerFetch, type FetchOptions } from './client';
import type {
  AdapterConfig,
  AdapterVariant,
  UnifiedInput,
  UnifiedModelResponse,
  UnifiedResponseMetadata,
} from './types';
import { TaskStatus } from './types';
import { ModelParameterException } from './exceptions';
import type { IModelErrorParser } from './base-error-parser';

export abstract class BaseAdapter {
  abstract readonly config: AdapterConfig;

  /**
   * 从 model.json 配置注入启用的变体列表
   * 子类构造时调用;变体 baseUrl 缺省时由 getVariantBaseUrl 回退 config.baseUrl
   */
  protected loadVariants(providerJson: {
    variants?: AdapterVariant[];
  }): void {
    (this.config as AdapterConfig).variants = (
      providerJson.variants || []
    ).filter((v) => v.enabled !== false);
  }

  /** 读取厂商 API Key(浏览器本地设置,永不上传) */
  protected async getApiKey(): Promise<string> {
    return settingsRepo.getApiKey(this.config.modelId);
  }

  /** 带超时与代理策略的 fetch 封装 */
  protected fetchWithTimeout(
    url: string,
    options: FetchOptions,
  ): Promise<Response> {
    return providerFetch(this.config.modelId, url, options);
  }

  /** 统一 HTTP 错误处理入口:!response.ok 时调用 */
  protected async handleHttpError(response: Response): Promise<never> {
    const parser = this.createErrorParser();
    const bodyText = await response.text().catch(() => undefined);
    const parsed = parser.parseHttpError(response, bodyText);
    throw parser.toException(parsed);
  }

  /** 统一业务错误处理入口:HTTP 200 但 body 包含错误时调用 */
  protected handleBusinessError(rawData: unknown): void {
    const parser = this.createErrorParser();
    const parsed = parser.parseBusinessError(rawData);
    if (parsed) {
      throw parser.toException(parsed);
    }
  }

  /** 创建错误解析器(子类必须实现) */
  protected abstract createErrorParser(): IModelErrorParser;

  /** 请求转换(子类实现) */
  abstract transformRequest(request: import('./types').UnifiedModelRequest): unknown;

  /** 响应转换(子类实现) */
  abstract transformResponse(
    rawResponse: unknown,
    metadata?: { modelId: string; processingTime: number },
  ): UnifiedModelResponse;

  /** 构建成功响应 */
  protected buildSuccessResponse(
    data: UnifiedModelResponse['data'],
    metadata: Partial<UnifiedResponseMetadata>,
  ): UnifiedModelResponse {
    return {
      success: true,
      data,
      metadata: {
        modelId: metadata.modelId || this.config.modelId,
        processingTime: metadata.processingTime || 0,
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    };
  }

  /** 构建错误响应 */
  protected buildErrorResponse(
    error: Error,
    metadata?: Partial<UnifiedResponseMetadata>,
  ): UnifiedModelResponse {
    return {
      success: false,
      data: {
        status: TaskStatus.FAILED,
      },
      metadata: {
        modelId: metadata?.modelId || this.config.modelId,
        processingTime: metadata?.processingTime || 0,
        timestamp: new Date().toISOString(),
        ...metadata,
      },
      error: {
        code: 'ADAPTER_ERROR',
        message: error.message || '适配器处理失败',
        details: error instanceof ModelParameterException ? error.details : undefined,
        retryable: true,
      },
    };
  }

  /** 解析统一输入 */
  protected parseInput(input: UnifiedInput): {
    text?: string;
    messages?: Array<{ role: string; content: string }>;
    images?: string[];
    videos?: string[];
    audios?: string[];
  } {
    return {
      text: input.text,
      messages: input.messages,
      images:
        input.imageUrls || (input.imageUrl ? [input.imageUrl] : undefined),
      videos:
        input.videoUrls || (input.videoUrl ? [input.videoUrl] : undefined),
      audios:
        input.audioUrls || (input.audioUrl ? [input.audioUrl] : undefined),
    };
  }

  /** 获取变体的 baseUrl:变体声明优先,回退 config.baseUrl */
  protected getVariantBaseUrl(variantId?: string): string {
    if (!variantId) return this.config.baseUrl || '';
    const variant = this.config.variants?.find((v) => v.id === variantId);
    if (variant?.baseUrl) return variant.baseUrl;
    return this.config.baseUrl || '';
  }

  /** 验证必需参数 */
  protected validateRequired(
    params: Record<string, unknown>,
    requiredFields: string[],
  ): void {
    for (const field of requiredFields) {
      const value = params[field];
      if (value === undefined || value === null || value === '') {
        throw new ModelParameterException(`缺少必需参数: ${field}`, { field });
      }
    }
  }
}
