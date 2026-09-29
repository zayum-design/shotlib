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
 * AI 异步任务通用 API(存根)
 *
 * 原版走服务端 Bull 队列(提交任务拿 jobId → 轮询状态);开源版 AI 调用恒为
 * 浏览器内同步 await,不存在服务端任务。接口仅为兼容保留:
 * - getJobStatusApi 恒返回不可用
 * - pollJobStatus 恒返回失败(store 层 async 分支在 P5 清理时摘除)
 */
import type { ApiResponse } from './types';

export interface JobQueueInfo {
  state: 'running' | 'queued' | 'unknown';
  position?: number; // 排队中：第几位（从 1 开始）
  waitingCount: number;
  runningCount: number;
  max: number;
  avgDurationMs: number;
  etaSeconds?: number; // 预估等待秒数
}

export interface JobStatusResponse {
  jobId: string | number;
  state: string;
  result?: {
    success: boolean;
    data: any;
    duration?: number;
  };
  failedReason?: string;
  attemptsMade: number;
  progress: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  queue?: JobQueueInfo;
}

/**
 * 查询异步任务状态(开源版无服务端队列,恒不可用)
 */
export async function getJobStatusApi(
  jobId: string | number,
): Promise<ApiResponse<JobStatusResponse>> {
  return {
    success: false,
    data: {
      jobId,
      state: 'unavailable',
      attemptsMade: 0,
      progress: 0,
      timestamp: Date.now(),
    },
    message: '开源版无服务端队列,任务在浏览器内同步执行',
  };
}

/**
 * 通用轮询函数(存根:开源版无异步任务,立即返回失败)
 */
export interface PollOptions {
  interval?: number;      // 轮询间隔（毫秒），默认 3000
  maxWaitTime?: number;   // 最大等待时间（毫秒），默认 10分钟
  onPoll?: (attempt: number, state: string, queue?: JobQueueInfo) => void;  // 每次轮询回调
}

export async function pollJobStatus<T = any>(
  _jobId: string | number,
  _options: PollOptions = {},
): Promise<{ success: boolean; data?: T; error?: string }> {
  return { success: false, error: '开源版无服务端队列,AI 任务在浏览器内同步执行' };
}
