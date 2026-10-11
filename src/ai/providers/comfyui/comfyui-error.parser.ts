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
 * ComfyUI 错误解析器
 *
 * - HTTP 错误:ComfyUI 返回 {error: {type, message}} 结构
 * - 业务错误:提交响应里的 node_errors(适配器已前置抛错,这里兜底)
 * - 执行错误(节点运行期,如 CUDA OOM / 模型缺失)在 history 里,由适配器用
 *   extractHistoryError 提取后经 parseBusinessError 同类映射
 */
import {
  BaseErrorParser,
  ErrorCategory,
  type ParsedModelError,
} from '../../core/base-error-parser';

export class ComfyUIErrorParser extends BaseErrorParser {
  protected readonly providerName = 'ComfyUI';

  parseBusinessError(rawData: unknown): ParsedModelError | null {
    if (!rawData || typeof rawData !== 'object') return null;
    const data = rawData as Record<string, unknown>;
    if (!data.error) return null;

    const err = data.error as Record<string, unknown>;
    const message = typeof err.message === 'string' ? err.message : JSON.stringify(err);
    const type = typeof err.type === 'string' ? err.type : '';

    const lower = `${type} ${message}`.toLowerCase();
    let category = ErrorCategory.API_ERROR;
    let retryable = true;
    if (
      lower.includes('out of memory') ||
      lower.includes('缺失') ||
      lower.includes('not found') ||
      lower.includes('does not exist')
    ) {
      retryable = false; // 资源类错误重试无意义,需降参或补模型
    }

    return {
      message: `[ComfyUI] ${message}`,
      code: type || 'COMFYUI_ERROR',
      category,
      retryable,
      raw: data.error,
    };
  }
}
