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
 * ModelSDKService 前端替身
 *
 * 后端 ModelSDKService 按模型 ID 路由到对应厂商适配器(服务端内网直调);
 * 纯前端版经 adapter-factory 反查供应商并直调适配器(浏览器 fetch + 代理策略)。
 * 请求/响应形状与后端 UnifiedModelRequest / UnifiedModelResponse 完全一致。
 */
import { createAdapterForModel } from '@/ai/core/adapter-factory';
import type {
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '@/ai/core/types';

export class ModelSDKService {
  async process(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    if (request.taskType !== 'text' && request.taskType !== 'image' && request.taskType !== 'video') {
      // music/voice 生成依赖 Suno 等厂商服务端能力,开源版未移植
      return {
        success: false,
        data: { status: 'failed' as const },
        metadata: {
          modelId: request.modelId,
          processingTime: 0,
          timestamp: new Date().toISOString(),
        },
        error: {
          code: 'TASK_TYPE_UNSUPPORTED',
          message: `暂不支持的任务类型: ${request.taskType}`,
          retryable: false,
        },
      };
    }
    // BaseAdapter 为抽象基类,process 由各任务类型子类实现,此处收窄调用面
    const adapter = createAdapterForModel(request.modelId, request.taskType) as unknown as
      | { process(req: UnifiedModelRequest): Promise<UnifiedModelResponse> }
      | null
      | undefined;
    if (!adapter) {
      return {
        success: false,
        data: { status: 'failed' as const },
        metadata: {
          modelId: request.modelId,
          processingTime: 0,
          timestamp: new Date().toISOString(),
        },
        error: {
          code: 'ADAPTER_NOT_FOUND',
          message: `未找到模型 ${request.modelId} 的适配器,请确认已在「设置」页配置对应厂商`,
          retryable: false,
        },
      };
    }
    return adapter.process(request);
  }
}

/** 模块级单例(替代 NestJS DI) */
export const modelSDK = new ModelSDKService();
