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
 * MiniMax 错误解析器
 *
 * 错误特征(标准 OpenAI 兼容格式):
 * - HTTP 非 200 + { error: { code, message, type } }
 * - v2 API(视频生成等):HTTP 200 + base_resp.status_code !== 0
 */
import { BaseErrorParser } from '../../core/base-error-parser';
import { ErrorCategory } from '../../core/base-error-parser';
import type { ParsedModelError } from '../../core/base-error-parser';

export class MiniMaxErrorParser extends BaseErrorParser {
  protected readonly providerName = 'MiniMax';

  /**
   * 错误码精确映射表(OpenAI 兼容错误码)
   * 优先于文本匹配
   */
  private readonly errorCodeMap: Record<string, string> = {
    // 认证/权限
    invalid_request_error: '请求参数有误，请检查后重试',
    authentication_error: '认证失败，请稍后重试',
    api_key_expired: '认证过期，请稍后重试',
    api_key_invalid: '认证失败，请稍后重试',

    // 频率/配额
    rate_limit_error: '请求过于频繁，请稍后再试',
    quota_exceeded: '配额已用完，请稍后再试',
    insufficient_quota: '账户额度不足，请稍后再试',

    // 内容安全
    content_filtered: '内容包含敏感信息，请修改后重试',
    content_policy_violation: '内容包含敏感信息，请修改后重试',

    // 敏感内容检测
    InputTextSensitiveContentDetected: '输入文本包含敏感信息，请修改后重试',
    InputImageSensitiveContentDetected: '输入图片包含敏感信息，请更换图片后重试',
    sensitive_content: '内容包含敏感信息，请修改后重试',

    // 参数/输入错误
    context_length_exceeded: '输入内容过长，请精简提示词或缩短文本后重试',
    max_tokens_exceeded: '输出长度超限，请精简后重试',
    parameter_invalid: '请求参数无效，请检查后重试',

    // 服务状态
    server_error: '服务内部错误，请稍后重试',
    service_unavailable: '服务暂时不可用，请稍后重试',
    server_overloaded: '服务繁忙，请稍后重试',

    // 超时
    timeout: '请求超时，请稍后重试',

    // 通用
    invalid_request: '请求格式有误，请检查后重试',
    not_found_error: '请求的资源不存在',
  };

  /**
   * 将技术错误信息转换为友好中文提示
   */
  private translateMessage(rawMessage: string, errorCode?: string): string {
    if (!rawMessage) return rawMessage;
    let msg = rawMessage;

    // 0. 优先按 errorCode 精确映射
    if (errorCode && this.errorCodeMap[errorCode]) {
      return this.errorCodeMap[errorCode];
    }

    // 1. 隐藏模型名
    msg = msg.replace(/\bminimax-[\w.-]+\b/gi, '当前模型');

    // 2. 文本模式匹配兜底
    const errorMappings: Array<{ pattern: RegExp; replacement: string }> = [
      // 上下文长度超限
      {
        pattern: /context length|token limit|max tokens|上下文长度|超出.*长度/i,
        replacement: '输入内容过长，请精简提示词或缩短文本后重试',
      },
      // 余额不足 / 额度不足
      {
        pattern: /InsufficientBalance|余额不足|额度不足|quota|insufficient|credit|billing/i,
        replacement: '账户额度不足，请稍后再试',
      },
      // 请求频率超限
      {
        pattern: /RateLimitExceeded|rate limit|throttle|too many requests|请求过于频繁/i,
        replacement: '请求过于频繁，请稍后再试',
      },
      // 内容安全
      {
        pattern: /content policy|safety|moderation|sensitive|harmful|violates|blocked|内容安全|敏感|违规/i,
        replacement: '内容可能包含敏感信息，请修改提示词后重试',
      },
      // 无效请求
      {
        pattern: /invalid_request_error|bad request|invalid request|请求无效/i,
        replacement: '请求参数有误，请检查后重试',
      },
      // 超时
      {
        pattern: /timeout|timed out|超时/i,
        replacement: '请求超时，请稍后重试',
      },
      // 服务不可用
      {
        pattern: /service unavailable|internal error|server error|overloaded|服务不可用|服务器错误/i,
        replacement: '服务暂时不可用，请稍后重试',
      },
      // 认证失败
      {
        pattern: /unauthorized|authentication|api key|access key|密钥|认证失败/i,
        replacement: '认证失败，请稍后重试',
      },
    ];

    for (const { pattern, replacement } of errorMappings) {
      if (pattern.test(msg)) {
        return msg.replace(pattern, replacement);
      }
    }

    return msg;
  }

  parseBusinessError(rawData: unknown): ParsedModelError | null {
    if (!rawData) return null;
    const raw = rawData as Record<string, any>;

    // MiniMax v2 API(视频生成等)错误格式:HTTP 200 + base_resp.status_code !== 0
    const baseResp = raw.base_resp;
    if (
      baseResp &&
      baseResp.status_code !== undefined &&
      baseResp.status_code !== 0
    ) {
      const code = String(baseResp.status_code);
      const rawMessage = baseResp.status_msg || '未知错误';
      const translatedMessage = this.translateMessage(rawMessage, code);

      const isContentPolicy = this.isContentPolicyError(code, rawMessage);
      const isQuotaExceeded = /quota|limit|insufficient|balance/i.test(
        `${code} ${rawMessage}`,
      );

      return {
        message: `[${this.providerName}] ${translatedMessage}`,
        code,
        category: isContentPolicy
          ? ErrorCategory.CONTENT_POLICY
          : isQuotaExceeded
            ? ErrorCategory.QUOTA_EXCEEDED
            : ErrorCategory.API_ERROR,
        retryable: !isContentPolicy && !isQuotaExceeded,
        raw: rawData,
      };
    }

    if (!raw.error) return null;

    const errorObj = raw.error;
    const code = errorObj.code || errorObj.type || 'API_ERROR';
    const rawMessage = errorObj.message || JSON.stringify(errorObj);
    const translatedMessage = this.translateMessage(rawMessage, code);

    const isContentPolicy = this.isContentPolicyError(code, rawMessage);
    const isQuotaExceeded = /quota|limit|insufficient/i.test(
      `${code} ${rawMessage}`,
    );

    return {
      message: `[${this.providerName}] ${translatedMessage}`,
      code,
      category: isContentPolicy
        ? ErrorCategory.CONTENT_POLICY
        : isQuotaExceeded
          ? ErrorCategory.QUOTA_EXCEEDED
          : ErrorCategory.API_ERROR,
      retryable:
        !isContentPolicy &&
        code !== 'invalid_request_error' &&
        code !== 'api_key_invalid',
      raw: rawData,
    };
  }

  /**
   * 覆盖 HTTP 错误解析,同样应用友好转换
   */
  parseHttpError(response: Response, bodyText?: string): ParsedModelError {
    const parsed = super.parseHttpError(response, bodyText);
    const parsedBody = this.tryParseJson(bodyText);
    const errorCode =
      parsedBody?.error?.code || parsedBody?.error?.type || parsed.code;
    const prefix = `[${this.providerName}] `;
    const rawMsg = parsed.message.startsWith(prefix)
      ? parsed.message.slice(prefix.length)
      : parsed.message;
    parsed.message = prefix + this.translateMessage(rawMsg, errorCode);
    return parsed;
  }
}
