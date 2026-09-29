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
 * 统一模型请求/响应类型(移植自后端 shared/ai/domain,裁剪路由/熔断/健康监控)
 */

/** 统一任务状态枚举 */
export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled',
  TIMEOUT: 'timeout',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/** 轮询模式 */
export const PollingMode = {
  SERVER_SIDE: 'server_side', // SDK 内部轮询直到完成
  CLIENT_SIDE: 'client_side', // 提交返回 taskId,前端轮询
} as const;
export type PollingMode = (typeof PollingMode)[keyof typeof PollingMode];

/** 模型变体时长配置 */
export interface DurationConfig {
  min: number;
  max: number;
  default: number;
  allowAuto: boolean;
}

/** 统一输入格式:屏蔽不同模型类型的差异 */
export interface UnifiedInput {
  // 文本输入
  text?: string;
  messages?: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;

  // 媒体输入(图片/视频/音频 URL 或 Base64)
  imageUrl?: string;
  imageUrls?: string[];
  videoUrl?: string;
  videoUrls?: string[];
  audioUrl?: string;
  audioUrls?: string[];

  // 视频生成专用
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];

  // 原始输入(透传)
  raw?: unknown;
}

/** 统一模型请求:所有模型调用的入口参数 */
export interface UnifiedModelRequest {
  /** 目标模型 ID */
  modelId: string;

  /** 任务类型 */
  taskType: 'text' | 'image' | 'video' | 'music' | 'voice';

  /** 操作类型 */
  operation: string;

  /** 统一输入 */
  input: UnifiedInput;

  /** 额外参数(厂商特定参数) */
  parameters?: Record<string, unknown>;

  /** 系统提示词(文本模型用) */
  systemPrompt?: string;

  /** 提示词模板类型 */
  promptType?: string;

  /** 调用选项 */
  options?: {
    /** 超时时间(毫秒) */
    timeout?: number;

    /** 轮询配置(异步任务) */
    pollingConfig?: {
      interval?: number;
      maxAttempts?: number;
      timeout?: number;
    };

    /** 是否返回原始响应 */
    includeRawResponse?: boolean;
  };
}

/** 统一响应数据 */
export interface UnifiedResponseData {
  /** 文本内容 */
  content?: string;

  /** 生成的媒体 URL 列表(图片/视频/音乐) */
  urls?: string[];

  /** 异步任务 ID */
  taskId?: string;

  /** 任务状态 */
  status?: TaskStatus;

  /** 进度百分比 (0-100) */
  progress?: number;

  /** 额外数据 */
  extra?: Record<string, unknown>;
}

/** 统一响应元数据 */
export interface UnifiedResponseMetadata {
  /** 实际使用的模型 ID */
  modelId: string;

  /** 处理耗时(毫秒) */
  processingTime: number;

  /** 时间戳 */
  timestamp: string;

  /** Token 使用量 */
  tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };

  /** 原始响应(调试用) */
  rawResponse?: unknown;
}

/** 统一错误信息 */
export interface UnifiedErrorInfo {
  /** 错误码 */
  code: string;

  /** 错误消息 */
  message: string;

  /** 错误详情 */
  details?: unknown;

  /** 是否可重试 */
  retryable?: boolean;

  /** 重试任务 ID(轮询超时等场景下返回) */
  retryTaskId?: string;
}

/** 统一模型响应:所有模型调用的统一返回格式 */
export interface UnifiedModelResponse {
  /** 是否成功 */
  success: boolean;

  /** 响应数据 */
  data: UnifiedResponseData;

  /** 元数据 */
  metadata: UnifiedResponseMetadata;

  /** 错误信息(失败时) */
  error?: UnifiedErrorInfo;
}

/** 任务查询响应(异步任务) */
export interface TaskQueryResponse extends UnifiedModelResponse {
  data: UnifiedResponseData & {
    taskId: string;
    status: TaskStatus;
    result?: unknown;
    error?: UnifiedErrorInfo;
  };
}

/** 适配器配置 */
export interface AdapterConfig {
  /** 厂商标识(同时是 settings 中的 apiKey 键) */
  modelId: string;
  modelName: string;
  modelType: 'text' | 'image' | 'video' | 'music' | 'voice';
  capabilities: string[];
  isAsync: boolean;
  /** 异步任务轮询模式(视频模型:client_side 提交返回 taskId 由前端轮询) */
  pollingMode?: 'client_side' | 'server_side';
  enabled: boolean;
  /** 默认(未从 model.json 读到时的)Base URL */
  baseUrl?: string;
  /** API 文档地址 */
  apiDocUrl?: string;
  /** 启用的变体(model.json 构建期注入) */
  variants?: AdapterVariant[];
}

/** 适配器变体(model.json variant 子集) */
export interface AdapterVariant {
  id: string;
  name: string;
  /** 变体类型(来自 model.json,宽 string,调用方按值比较) */
  type: string;
  baseUrl?: string;
  description?: string;
  /** 变体级附加配置(reasoning/maxOutputTokens 等厂商专用字段原样保留) */
  [key: string]: unknown;
}
