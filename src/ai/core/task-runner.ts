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
 * 视频异步任务运行器:提交 → 轮询 → 完成/失败
 *
 * - 刷新恢复:调用方持久化 {providerId, modelId, taskId},回来后直接调 pollVideoTask 即可续上
 * - 取消:AbortSignal 仅停止本地轮询;厂商侧任务会继续执行(与原后端行为一致,费用照常产生)
 * - 速率限制(并发批/rpm 限流)由上层 store 负责,本模块只管单个任务生命周期
 */
import { createAdapter } from './adapter-factory';
import { findProviderByVariantId } from './model-registry';
import type {
  BaseAdapter,
} from './base-adapter';
import type {
  TaskQueryResponse,
  TaskStatus,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from './types';
import { TaskStatus as TaskStatusConst } from './types';
import {
  AsyncTaskFailedException,
  ModelException,
  PollingTimeoutException,
} from './exceptions';

/** 可提交/查询异步任务的适配器形状(视频三家均满足) */
type VideoTaskAdapter = BaseAdapter & {
  submit(request: UnifiedModelRequest): Promise<UnifiedModelResponse>;
  query(taskId: string, modelId?: string): Promise<UnifiedModelResponse>;
};

/** 任务句柄:持久化这三个字段即可在刷新后恢复轮询 */
export interface VideoTaskHandle {
  /** 供应商标识(deepseek/volcengine/aliyun/minimaxi/moonshot) */
  providerId: string;
  /** 变体 id(如 doubao-seedance-2-0-260128) */
  modelId: string;
  /** 厂商侧任务 id */
  taskId: string;
}

export interface PollOptions {
  /** 轮询间隔(毫秒),默认 5000 */
  intervalMs?: number;
  /** 最大轮询次数,默认 120(默认间隔下约 10 分钟) */
  maxAttempts?: number;
  /** 每次轮询回调(可用于更新 UI 进度状态) */
  onPoll?: (status: TaskStatus, attempt: number) => void;
  /** 取消信号:触发后停止本地轮询 */
  signal?: AbortSignal;
}

export interface VideoTaskResult {
  handle: VideoTaskHandle;
  status: TaskStatus;
  /** 完成时的视频 URL(可能含尾帧图,见 extra) */
  urls?: string[];
  extra?: Record<string, unknown>;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** 供编排层单次查询复用(见 video-processing.service.queryTaskStatus) */
export function getVideoAdapter(providerId: string): VideoTaskAdapter {
  const adapter = createAdapter(providerId, 'video');
  if (!adapter) {
    throw new ModelException(
      `供应商 ${providerId} 未注册视频模型`,
      'ADAPTER_NOT_FOUND',
      400,
      false,
    );
  }
  const candidate = adapter as VideoTaskAdapter;
  if (typeof candidate.submit !== 'function' || typeof candidate.query !== 'function') {
    throw new ModelException(
      `供应商 ${providerId} 的视频适配器不支持异步任务`,
      'ASYNC_NOT_SUPPORTED',
      400,
      false,
    );
  }
  return candidate;
}

/**
 * 提交视频生成任务,返回句柄(调用方应立即持久化以便刷新恢复)
 */
export async function submitVideoTask(
  request: UnifiedModelRequest,
): Promise<VideoTaskHandle> {
  const modelId = request.modelId;
  const providerId = findProviderByVariantId(modelId);
  if (!providerId) {
    throw new ModelException(
      `未知模型: ${modelId}`,
      'MODEL_NOT_FOUND',
      400,
      false,
    );
  }
  const adapter = getVideoAdapter(providerId);
  const response = await adapter.submit(request);
  const taskId = response.data.taskId;
  if (!taskId) {
    throw new ModelException(
      '提交成功但未返回任务 ID',
      'NO_TASK_ID',
      500,
      true,
    );
  }
  return { providerId, modelId, taskId };
}

/**
 * 轮询任务直到完成/失败。刷新恢复场景直接传持久化的 handle 调用即可。
 *
 * @throws AsyncTaskFailedException 厂商侧任务失败
 * @throws PollingTimeoutException 超过最大轮询次数
 * @throws AbortError(DOMException)signal 取消
 */
export async function pollVideoTask(
  handle: VideoTaskHandle,
  options: PollOptions = {},
): Promise<VideoTaskResult> {
  const { intervalMs = 5000, maxAttempts = 120, onPoll, signal } = options;
  const adapter = getVideoAdapter(handle.providerId);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = (await adapter.query(
      handle.taskId,
      handle.modelId,
    )) as TaskQueryResponse;

    const status = response.data.status;
    onPoll?.(status, attempt);

    if (status === TaskStatusConst.COMPLETED) {
      return {
        handle,
        status,
        urls: response.data.urls,
        extra: response.data.extra,
      };
    }

    if (status === TaskStatusConst.FAILED) {
      const errExtra = response.data.extra as { error?: unknown } | undefined;
      throw new AsyncTaskFailedException(
        handle.taskId,
        handle.modelId,
        typeof errExtra?.error === 'object' && errExtra?.error !== null
          ? JSON.stringify(errExtra.error)
          : String(errExtra?.error || '厂商未返回失败原因'),
      );
    }

    // RUNNING / PENDING:等待下一轮
    await sleep(intervalMs, signal);
  }

  throw new PollingTimeoutException(handle.taskId, handle.modelId, maxAttempts);
}

/**
 * 一体化:提交 + 轮询(内部不持久化;需要刷新恢复时请分开调 submitVideoTask + pollVideoTask)
 */
export async function runVideoTask(
  request: UnifiedModelRequest,
  options: PollOptions = {},
): Promise<VideoTaskResult> {
  const providerId = findProviderByVariantId(request.modelId);
  const adapter = getVideoAdapter(providerId || '');
  const handle: VideoTaskHandle = {
    providerId: providerId || '',
    modelId: request.modelId,
    taskId: '',
  };
  // 复用 submit 以拿到 taskId;这里不走 submitVideoTask 避免重复反查
  const submitResponse = await adapter.submit(request);
  handle.taskId = submitResponse.data.taskId || '';
  if (!handle.taskId) {
    throw new ModelException('提交成功但未返回任务 ID', 'NO_TASK_ID', 500, true);
  }
  return pollVideoTask(handle, options);
}
