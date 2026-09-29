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
 * 错误解析器基类与接口(移植自后端 shared/ai/domain/errors)
 */
import {
  ModelException,
  ModelContentFilteredException,
  ModelQuotaExceededException,
  ModelTimeoutException,
} from './exceptions';

/** 错误分类 */
export const ErrorCategory = {
  HTTP_ERROR: 'http_error',
  API_ERROR: 'api_error',
  CONTENT_POLICY: 'content_policy',
  QUOTA_EXCEEDED: 'quota_exceeded',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  AUTH: 'auth',
  UNKNOWN: 'unknown',
} as const;
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

/** 解析后的模型错误 */
export interface ParsedModelError {
  /** 用户友好的错误消息 */
  message: string;
  /** 错误代码 */
  code: string;
  /** 错误分类 */
  category: ErrorCategory;
  /** 是否可重试 */
  retryable: boolean;
  /** 原始错误数据 */
  raw: unknown;
}

/** 每个模型厂商实现自己的错误解析逻辑 */
export interface IModelErrorParser {
  /** 解析 HTTP 非 2xx 错误 */
  parseHttpError(response: Response, bodyText?: string): ParsedModelError;

  /** 解析 HTTP 200 但 body 中包含业务错误;无业务错误返回 null */
  parseBusinessError(rawData: unknown): ParsedModelError | null;

  /** 将 ParsedModelError 转换为 ModelException */
  toException(parsed: ParsedModelError): ModelException;
}

/** 错误解析器基类:提供通用逻辑,各模型解析器继承后覆盖特定方法 */
export abstract class BaseErrorParser implements IModelErrorParser {
  /** 模型标识,用于错误消息前缀 */
  protected abstract readonly providerName: string;

  /** 解析 HTTP 非 2xx 错误:尝试从 body 中解析 JSON 错误 */
  parseHttpError(response: Response, bodyText?: string): ParsedModelError {
    const status = response.status;
    const parsed = this.tryParseJson(bodyText);

    const code = parsed?.error?.code || parsed?.code || `HTTP_${status}`;
    const message =
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.error?.error ||
      parsed?.error ||
      bodyText ||
      `HTTP ${status}`;

    return {
      message: `[${this.providerName}] ${message}`,
      code,
      category: ErrorCategory.HTTP_ERROR,
      retryable: status >= 500 || status === 429,
      raw: { status, body: parsed || bodyText },
    };
  }

  /** 解析业务错误 — 子类必须覆盖 */
  abstract parseBusinessError(rawData: unknown): ParsedModelError | null;

  /** 根据错误分类自动映射到对应的异常子类 */
  toException(parsed: ParsedModelError): ModelException {
    switch (parsed.category) {
      case ErrorCategory.CONTENT_POLICY:
        return new ModelContentFilteredException(
          this.providerName,
          parsed.message,
        );
      case ErrorCategory.QUOTA_EXCEEDED:
        return new ModelQuotaExceededException(this.providerName);
      case ErrorCategory.TIMEOUT:
        return new ModelTimeoutException(this.providerName, 0);
      default:
        return new ModelException(
          parsed.message,
          parsed.code,
          500,
          parsed.retryable,
          parsed.raw,
        );
    }
  }

  /**
   * 尝试解析嵌套的 error 消息
   * 处理如上游返回的错误嵌套:error.message 中包含 JSON 字符串
   */
  protected extractNestedErrorMessage(raw: unknown): string | null {
    if (!raw) return null;

    // 直接字符串
    if (typeof raw === 'string') {
      const nested = this.tryParseJson(raw);
      if (nested?.error) {
        return (
          nested.error.message ||
          nested.error.error ||
          nested.error.reason ||
          raw
        );
      }
      if (nested?.message) return nested.message;
      return raw;
    }

    // 对象
    if (typeof raw === 'object') {
      const obj = raw as Record<string, any>;
      const msg =
        obj.message ||
        obj.error?.message ||
        obj.error?.error ||
        obj.error?.reason ||
        obj.msg ||
        obj.error;
      if (msg) return typeof msg === 'string' ? msg : JSON.stringify(msg);
    }

    return null;
  }

  /** 安全解析 JSON */
  protected tryParseJson(text?: string): any {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /** 检测内容策略违规关键词 */
  protected isContentPolicyError(code?: string, message?: string): boolean {
    const keywords = [
      'content_policy_violation',
      'content_policy',
      'safety',
      'moderation',
      'sensitive',
      'harmful',
      'violates',
      'blocked',
    ];
    const text = `${code || ''} ${message || ''}`.toLowerCase();
    return keywords.some((k) => text.includes(k));
  }
}
