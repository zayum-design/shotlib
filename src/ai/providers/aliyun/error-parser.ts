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
 * 阿里云错误解析器
 *
 * 错误特征:
 * - HTTP 非 200 + { code, message, request_id }
 * - 异步任务失败 output.task_status: FAILED + output.code/output.message
 *
 * 错误码参考:https://help.aliyun.com/zh/model-studio/error-code
 */
import { BaseErrorParser } from '../../core/base-error-parser';
import { ErrorCategory } from '../../core/base-error-parser';
import type { ParsedModelError } from '../../core/base-error-parser';

export class AliyunErrorParser extends BaseErrorParser {
  protected readonly providerName = 'Aliyun';

  /**
   * 错误码精确映射表(阿里云官方错误码)
   * 优先于文本匹配
   */
  private readonly errorCodeMap: Record<string, string> = {
    // ========== 认证/权限 ==========
    InvalidApiKey: '认证失败，请稍后重试',
    ExpiredApiKey: '认证过期，请稍后重试',
    InvalidSignature: '请求签名无效，请稍后重试',
    AccessDenied: '权限不足，请稍后重试',
    Unauthorized: '未授权访问，请检查权限配置',

    // ========== 参数/输入错误 ==========
    InvalidParameter: '请求参数有误，请检查画面比例、时长、分辨率等参数后重试',
    MissingRequiredParameter: '缺少必要参数，请检查后重试',
    InvalidParameterValue: '参数值无效，请检查后重试',
    UnsupportedParameter: '不支持该参数，请检查后重试',
    InvalidFormat: '参数格式错误，请检查后重试',

    // ========== 资源/配额 ==========
    InsufficientBalance: '账户余额不足，请充值后再试',
    QuotaExceeded: '配额已用完，请稍后再试',
    Throttling: '请求过于频繁，请稍后再试',
    RateLimitExceeded: '请求过于频繁，请稍后再试',

    // ========== 内容安全 ==========
    InputTextSensitiveContentDetected: '输入文本包含敏感信息，请修改后重试',
    InputImageSensitiveContentDetected: '输入图片包含敏感信息，请更换图片后重试',
    ContentModerationFailed: '内容安全检测未通过，请修改后重试',
    SensitiveContentDetected: '内容包含敏感信息，请修改后重试',

    // ========== 资源状态 ==========
    TaskNotFound: '任务不存在或已过期',
    ResourceNotFound: '请求的资源不存在',
    ResourceGone: '请求的资源已过期或不可用',

    // ========== 服务状态 ==========
    InternalError: '服务内部错误，请稍后重试',
    ServiceUnavailable: '服务暂时不可用，请稍后重试',
    RequestTimeOut: '请求超时，请稍后重试',
    BackendError: '服务响应异常，请稍后重试',

    // ========== 任务执行错误 ==========
    TaskExecutionFailed: '视频生成任务执行失败，请稍后重试',
    TaskCancelled: '任务已取消',
    TaskTimeout: '任务执行超时，请稍后重试',

    // ========== 通用 HTTP 状态码 ==========
    BadRequest: '请求格式有误，请检查参数后重试',
    Forbidden: '禁止访问，请检查权限配置',
    NotFound: '请求的资源不存在',
    TooManyRequests: '请求过于频繁，请稍后再试',
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

    // 0.5 隐藏模型名/版本号(避免向用户暴露接口版本/名称)
    //    覆盖阿里云通义万相系列(wanx2.1-i2v-plus 等)及 "model xxx" 描述
    msg = msg.replace(/\bwanx[\w.-]*\b/gi, '当前模型');
    msg = msg.replace(/\bmodel\s+[\w.-]+/gi, '当前模型');

    // 1. 文本模式匹配兜底
    const errorMappings: Array<{ pattern: RegExp; replacement: string }> = [
      // 任务执行失败
      {
        pattern: /任务执行失败|task execution failed|TASK_FAILED/i,
        replacement: '视频生成任务执行失败，请稍后重试',
      },
      // 参数错误
      {
        pattern: /InvalidParameter|参数错误|parameter.*invalid/i,
        replacement: '请求参数有误，请检查画面比例、时长、分辨率等参数后重试',
      },
      // 余额不足 / 额度不足
      {
        pattern: /InsufficientBalance|余额不足|额度不足|quota|insufficient|credit/i,
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
      // 超时
      {
        pattern: /timeout|timed out|超时/i,
        replacement: '请求超时，请稍后重试',
      },
      // 服务不可用
      {
        pattern: /service unavailable|internal error|server error|服务不可用/i,
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

    // 检查异步任务状态中的错误
    const taskStatus = raw.output?.task_status || raw.task_status;
    if (taskStatus === 'FAILED' || taskStatus === 'ERROR') {
      const code =
        raw.code || raw.output?.code || raw.error_code || 'TASK_FAILED';
      const rawMessage =
        raw.message || raw.output?.message || '任务执行失败';
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
        retryable: !isContentPolicy,
        raw: rawData,
      };
    }

    // 直接返回的错误(HTTP 400/500 等)
    if (raw.code && raw.message) {
      const code = raw.code;
      const translatedMessage = this.translateMessage(raw.message, code);
      const isContentPolicy = this.isContentPolicyError(code, raw.message);
      const isQuotaExceeded = /quota|limit|insufficient/i.test(
        `${code} ${raw.message}`,
      );

      return {
        message: `[${this.providerName}] ${translatedMessage}`,
        code,
        category: isContentPolicy
          ? ErrorCategory.CONTENT_POLICY
          : isQuotaExceeded
            ? ErrorCategory.QUOTA_EXCEEDED
            : ErrorCategory.API_ERROR,
        retryable: !isContentPolicy,
        raw: rawData,
      };
    }

    return null;
  }

  /**
   * 覆盖 HTTP 错误解析，同样应用友好转换
   */
  parseHttpError(response: Response, bodyText?: string): ParsedModelError {
    const parsed = super.parseHttpError(response, bodyText);
    const parsedBody = this.tryParseJson(bodyText);
    const errorCode =
      parsedBody?.code || parsedBody?.error?.code || parsed.code;
    const prefix = `[${this.providerName}] `;
    const rawMsg = parsed.message.startsWith(prefix)
      ? parsed.message.slice(prefix.length)
      : parsed.message;
    parsed.message = prefix + this.translateMessage(rawMsg, errorCode);
    return parsed;
  }
}
