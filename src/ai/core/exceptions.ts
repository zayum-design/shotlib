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
 * 统一模型异常体系(移植自后端,保留前端用到的子集)
 */

export class ModelException extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: string = 'MODEL_ERROR',
    statusCode: number = 500,
    retryable: boolean = false,
    details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

/** 模型超时 */
export class ModelTimeoutException extends ModelException {
  constructor(modelId: string, timeoutMs: number) {
    super(
      `模型响应超时: ${modelId} (超过 ${timeoutMs}ms)`,
      'MODEL_TIMEOUT',
      504,
      true,
      { modelId, timeoutMs },
    );
  }
}

/** 模型配额超限 */
export class ModelQuotaExceededException extends ModelException {
  constructor(modelId: string) {
    super(`模型配额已用完: ${modelId}`, 'MODEL_QUOTA_EXCEEDED', 429, true, {
      modelId,
    });
  }
}

/** 内容被过滤 */
export class ModelContentFilteredException extends ModelException {
  constructor(modelId: string, reason?: string) {
    super(
      `内容被模型过滤: ${modelId}${reason ? ` - ${reason}` : ''}`,
      'CONTENT_FILTERED',
      400,
      false,
      { modelId, reason },
    );
  }
}

/** 参数错误 */
export class ModelParameterException extends ModelException {
  constructor(message: string, details?: unknown) {
    super(`参数错误: ${message}`, 'INVALID_PARAMETERS', 400, false, details);
  }
}

/** 异步任务失败 */
export class AsyncTaskFailedException extends ModelException {
  constructor(taskId: string, modelId: string, errorMessage?: string) {
    super(
      `异步任务失败: ${taskId}${errorMessage ? ` - ${errorMessage}` : ''}`,
      'ASYNC_TASK_FAILED',
      500,
      true,
      { taskId, modelId, errorMessage },
    );
  }
}

/** 轮询超时 */
export class PollingTimeoutException extends ModelException {
  constructor(taskId: string, modelId: string, maxAttempts: number) {
    super(
      `轮询超时: 任务 ${taskId} 在 ${maxAttempts} 次轮询后仍未完成`,
      'POLLING_TIMEOUT',
      504,
      false,
      { taskId, modelId, maxAttempts },
    );
  }
}
