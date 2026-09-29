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
 * VolcEngine(火山引擎 / 即梦)错误解析器
 *
 * 错误特征:
 * - HTTP 200 + { error: { code, message } }
 * - HTTP 非 200 + JSON { error: { code, message } }
 *
 * 错误码参考:https://www.volcengine.com/docs/82379/1299023
 */
import { BaseErrorParser } from '../../core/base-error-parser';
import { ErrorCategory, type ParsedModelError } from '../../core/base-error-parser';

export class VolcEngineErrorParser extends BaseErrorParser {
  protected readonly providerName = 'VolcEngine';

  /** 视频生成模式缩写 → 中文 */
  private readonly modeMap: Record<string, string> = {
    r2v: '全能参考模式',
    i2v: '图生视频模式',
    t2v: '文生视频模式',
    frames_to_video: '首尾帧模式',
    references_to_video: '全能参考模式',
    image_to_video: '图生视频模式',
    text_to_video: '文生视频模式',
  };

  /**
   * 错误码精确映射表
   * 火山引擎各模型返回的 error.code → 用户友好消息
   * 按错误码精确匹配,优先级最高
   */
  private readonly errorCodeMap: Record<string, string> = {
    // ========== 敏感内容检测 ==========
    /** 输入文本包含敏感信息 */
    InputTextSensitiveContentDetected: '输入文本包含敏感信息,请修改后重试',
    /** 输入图片包含敏感信息 */
    InputImageSensitiveContentDetected:
      '输入图片包含敏感信息,请更换图片后重试',
    /** 输入图片包含真实人物(隐私信息,带后缀的精确 code) */
    'InputImageSensitiveContentDetected.PrivacyInformation':
      '输入图片可能包含真实人物,请更换图片后重试',
    /** 输入音频包含敏感信息 */
    InputAudioSensitiveContentDetected:
      '输入音频包含敏感信息,请更换音频后重试',
    /** 输入视频包含敏感信息 */
    InputVideoSensitiveContentDetected:
      '输入视频包含敏感信息,请更换视频后重试',
    /** 输入视频涉及版权限制(带后缀的精确 code) */
    'InputVideoSensitiveContentDetected.PolicyViolation':
      '参考视频可能涉及版权限制,请更换视频后重试',
    /** 输出图片包含敏感信息 */
    OutputImageSensitiveContentDetected:
      '生成结果包含敏感信息,请尝试更换描述或图片后重试',
    /** 通用敏感内容检测 */
    SensitiveContentDetected: '内容包含敏感信息,请修改后重试',
    /** 内容安全检测未通过 */
    ContentModerationFailed: '内容安全检测未通过,请修改后重试',

    // ========== 认证/权限 ==========
    /** 认证失败 */
    InvalidCredentials: '认证失败,请稍后重试',
    /** 未授权访问 */
    Unauthorized: '未授权访问,请稍后重试',
    /** 权限不足 */
    PermissionDenied: '权限不足,请稍后重试',

    // ========== 资源/配额 ==========
    /** 账户余额不足 */
    InsufficientBalance: '账户余额不足,请稍后再试',
    /** 配额已用完 */
    QuotaExceeded: '配额已用完,请稍后再试',
    /** 请求频率超限 */
    RateLimitExceeded: '请求过于频繁,请稍后再试',
    /** 请求被限流 */
    Throttled: '请求被限流,请稍后再试',

    // ========== 参数/输入错误 ==========
    /** 请求参数无效(通用) */
    InvalidParameter: '请求参数无效,请检查后重试',
    /** 参数值无效 */
    InvalidParameterValue: '参数值无效,请检查后重试',
    /** 缺少必要参数 */
    MissingRequiredParameter: '缺少必要参数,请检查后重试',
    /** 参数值不支持 */
    ParameterValueNotSupported: '不支持该参数值,请切换其他选项',

    // ========== 资源状态 ==========
    /** 请求的资源不存在 */
    ResourceNotFound: '请求的资源不存在',
    /** 请求的资源已过期或不可用 */
    ResourceGone: '请求的资源已过期或不可用',
    /** 任务不存在或已过期 */
    TaskNotFound: '任务不存在或已过期',

    // ========== 服务状态 ==========
    /** 服务暂时不可用 */
    ServiceUnavailable: '服务暂时不可用,请稍后重试',
    /** 服务内部错误 */
    InternalError: '服务内部错误,请稍后重试',
    /** 后端服务错误 */
    BackendError: '服务响应异常,请稍后重试',
    /** 模型暂时不可用 */
    ModelCurrentlyUnavailable: '模型暂时不可用,请稍后重试或切换其他模型',

    // ========== 内容生成专项 ==========
    /** 文本过长 */
    TextTooLong: '输入文本过长,请精简后重试',
    /** 图片尺寸过大 */
    ImageTooLarge: '图片尺寸过大,请压缩后重试',
    /** 不支持的图片格式 */
    UnsupportedImageFormat: '不支持的图片格式,请使用 JPG/PNG/WebP',
    /** 视频时长超出限制 */
    VideoDurationExceeded: '视频时长超出限制,请调整时长后重试',
    /** 分辨率不支持 */
    ResolutionNotSupported: '分辨率不支持,请切换其他分辨率',
    /** 画面比例不支持 */
    AspectRatioNotSupported: '画面比例不支持,请切换其他比例',

    // ========== HTTP 状态码相关 ==========
    /** 400 Bad Request */
    BadRequest: '请求格式有误,请检查参数后重试',
    /** 403 Forbidden */
    Forbidden: '禁止访问,请检查权限配置',
    /** 404 Not Found */
    NotFound: '请求的资源不存在',
    /** 429 Too Many Requests */
    TooManyRequests: '请求过于频繁,请稍后再试',
  };

  /**
   * 将技术错误信息转换为友好中文提示
   * 1. 参考视频时长阈值提取 2. 错误码精确映射 3. 隐藏模型名
   * 4. 转换模式缩写 5. 文本模式匹配兜底
   */
  private translateMessage(rawMessage: string, errorCode?: string): string {
    if (!rawMessage) return rawMessage;
    let msg = rawMessage;

    // 0. 参考视频时长限制:优先从 message 提取具体阈值(通用参数错误码会丢失该信息)
    const videoDurationMaxMatch = msg.match(
      /video duration \(seconds\).*?must be less than or equal to ([\d.]+)/i,
    );
    if (videoDurationMaxMatch) {
      return `参考视频时长超出限制(最长 ${videoDurationMaxMatch[1]} 秒),请更换或剪辑后重试`;
    }
    const videoDurationMinMatch = msg.match(
      /video duration \(seconds\).*?must be greater than or equal to ([\d.]+)/i,
    );
    if (videoDurationMinMatch) {
      return `参考视频时长不足(至少 ${videoDurationMinMatch[1]} 秒),请更换后重试`;
    }

    // 1. 优先按 errorCode 精确映射
    if (errorCode && this.errorCodeMap[errorCode]) {
      return this.errorCodeMap[errorCode];
    }

    // 2. 隐藏模型名
    msg = msg.replace(/\bdoubao-seedance-[\w.-]+\b/g, '当前模型');
    msg = msg.replace(/\bmodel\s+[\w.-]+/gi, '当前模型');

    // 3. 转换模式缩写
    for (const [abbr, cn] of Object.entries(this.modeMap)) {
      const regex = new RegExp(`\\b${abbr.replace(/_/g, '[_\\s]')}\\b`, 'gi');
      msg = msg.replace(regex, cn);
    }

    // 4. 文本模式匹配兜底
    const errorMappings: Array<{ pattern: RegExp; replacement: string }> = [
      {
        pattern:
          /the parameter duration specified in the request is not valid/i,
        replacement: '当前模型不支持该视频时长,请调整时长后重试',
      },
      {
        pattern:
          /the parameter resolution specified in the request is not valid/i,
        replacement: '当前模型不支持该分辨率,请切换其他分辨率后重试',
      },
      {
        pattern: /the parameter ratio specified in the request is not valid/i,
        replacement: '当前模型不支持该画面比例,请切换其他比例后重试',
      },
      {
        pattern: /the parameter (\w+) specified in the request is not valid/i,
        replacement: '请求参数「$1」无效,请检查参数后重试',
      },
      {
        pattern: /InsufficientBalance|余额不足|insufficient balance/i,
        replacement: '账户余额不足,请稍后再试',
      },
      {
        pattern: /RateLimitExceeded|rate limit|throttle|请求过于频繁/i,
        replacement: '请求过于频繁,请稍后再试',
      },
      {
        pattern: /TaskNotFound|任务不存在|已过期|expired/i,
        replacement: '任务不存在或已过期',
      },
      {
        pattern: /ModelNotSupported|不支持该功能|not supported/i,
        replacement: '当前模型不支持该功能,请尝试切换其他模型',
      },
      {
        pattern: /real person|真实人物/i,
        replacement: '输入图片可能包含真实人物,请更换图片后重试',
      },
      {
        pattern: /copyright|版权/i,
        replacement: '参考素材可能涉及版权限制,请更换后重试',
      },
      {
        pattern:
          /content policy|safety|moderation|sensitive|harmful|violates|blocked|内容安全|敏感|违规/i,
        replacement: '内容可能包含敏感信息,请修改提示词后重试',
      },
      {
        pattern: /图片尺寸|image size|尺寸不符合/i,
        replacement: '图片尺寸不符合要求,请检查后重试',
      },
      {
        pattern: /reference image|参考图.*超限|超出.*限制/i,
        replacement: '参考图片数量超出限制,请减少数量后重试',
      },
    ];

    for (const { pattern, replacement } of errorMappings) {
      if (pattern.test(msg)) {
        return msg.replace(pattern, replacement);
      }
    }

    return msg;
  }

  parseBusinessError(rawData: any): ParsedModelError | null {
    if (!rawData || !rawData.error) return null;

    const errorObj = rawData.error;
    const code = errorObj.code || 'API_ERROR';
    const rawMessage = errorObj.message || JSON.stringify(errorObj);
    const translatedMessage = this.translateMessage(rawMessage, code);

    const isContentPolicy = this.isContentPolicyError(code, rawMessage);
    const isQuotaExceeded = /quota|limit|insufficient|throttle/i.test(
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
      retryable: !isContentPolicy && code !== 'NO_TASK_ID',
      raw: rawData,
    };
  }

  /** 覆盖 HTTP 错误解析,同样应用友好转换 */
  parseHttpError(response: Response, bodyText?: string): ParsedModelError {
    const parsed = super.parseHttpError(response, bodyText);
    // 尝试从响应体中提取 error.code 做精确映射
    const parsedBody = this.tryParseJson(bodyText);
    const errorCode = parsedBody?.error?.code;
    const prefix = `[${this.providerName}] `;
    const rawMsg = parsed.message.startsWith(prefix)
      ? parsed.message.slice(prefix.length)
      : parsed.message;
    parsed.message = prefix + this.translateMessage(rawMsg, errorCode);
    return parsed;
  }
}
