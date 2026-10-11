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
 * ComfyUI HTTP API 封装:/prompt 提交、/history 查询、/upload/image 参考图上传
 *
 * 文档: https://docs.comfy.org/development/comfyui-server/comms_routes
 * 所有请求经 providerFetch 走现有代理策略与请求日志面板。
 */
import { providerFetch } from '../../core/client';
import type { ComfyWorkflowTemplate } from './comfyui-workflow-loader';

export interface ComfyPromptResponse {
  /** 任务 id(即 history 查询键) */
  prompt_id: string;
  /** 队列序号 */
  number: number;
  /** 节点错误(校验失败时返回,HTTP 仍为 200/400 视版本而定) */
  node_errors?: Record<string, unknown>;
}

export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string; // 'output' | 'temp' | 'input'
}

/** history 接口里单个任务的完整记录 */
export interface ComfyHistoryEntry {
  prompt: unknown;
  outputs?: Record<string, {
    images?: ComfyOutputFile[];
    gifs?: ComfyOutputFile[];
    audio?: unknown[];
    [key: string]: unknown;
  }>;
  status: {
    status_str: 'success' | 'error' | string;
    completed: boolean;
    /** 执行失败时的异常详情数组(格式不稳定,取文本用) */
    messages?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const PROVIDER_ID = 'comfyui';

/** 提交工作流,返回 prompt_id */
export async function submitPrompt(
  baseUrl: string,
  workflow: ComfyWorkflowTemplate,
): Promise<ComfyPromptResponse> {
  const resp = await providerFetch(PROVIDER_ID, `${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
    timeout: 60000,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`ComfyUI 提交失败 HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
  const data = (await resp.json()) as ComfyPromptResponse;
  if (data.node_errors && Object.keys(data.node_errors).length > 0) {
    throw new Error(
      `ComfyUI 工作流校验失败: ${JSON.stringify(data.node_errors).slice(0, 500)}`,
    );
  }
  return data;
}

/** 查询任务记录;不存在(仍在队列/已被取消删除)返回 undefined */
export async function getPromptHistory(
  baseUrl: string,
  promptId: string,
): Promise<ComfyHistoryEntry | undefined> {
  const resp = await providerFetch(PROVIDER_ID, `${baseUrl}/history/${encodeURIComponent(promptId)}`, {
    method: 'GET',
    timeout: 30000,
  });
  if (!resp.ok) {
    if (resp.status === 404) return undefined;
    const text = await resp.text().catch(() => '');
    throw new Error(`ComfyUI 查询失败 HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = (await resp.json()) as Record<string, ComfyHistoryEntry>;
  return data[promptId];
}

/** ComfyUI 队列状态 */
export interface ComfyQueueStatus {
  queue_running: Array<[number, string, unknown]>;
  queue_pending: Array<[number, string, unknown]>;
}

/** 查询 prompt_id 是否仍在 ComfyUI 队列(running/pending)中 */
export async function isPromptInQueue(
  baseUrl: string,
  promptId: string,
): Promise<boolean> {
  const resp = await providerFetch(PROVIDER_ID, `${baseUrl}/queue`, {
    method: 'GET',
    timeout: 30000,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`ComfyUI 查询队列失败 HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = (await resp.json()) as ComfyQueueStatus;
  const inRunning = (data.queue_running || []).some((item) => item[1] === promptId);
  const inPending = (data.queue_pending || []).some((item) => item[1] === promptId);
  return inRunning || inPending;
}

/** 上传参考图到 ComfyUI input 目录,返回可供 LoadImage 引用的文件名 */
export async function uploadImage(
  baseUrl: string,
  blob: Blob,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append('image', blob, filename);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const resp = await providerFetch(PROVIDER_ID, `${baseUrl}/upload/image`, {
    method: 'POST',
    body: form,
    timeout: 120000,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`ComfyUI 图片上传失败 HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = (await resp.json()) as { name?: string };
  if (!data.name) throw new Error('ComfyUI 图片上传未返回文件名');
  return data.name;
}

/** 远程 URL / blob URL → Blob(参考图上传前的取料步骤) */
export async function fetchImageBlob(url: string): Promise<Blob> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`获取参考图失败 HTTP ${resp.status}: ${url.slice(0, 120)}`);
  return resp.blob();
}

/** 拼 /view 下载地址 */
export function buildViewUrl(baseUrl: string, file: ComfyOutputFile): string {
  const q = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || '',
    type: file.type || 'output',
  });
  return `${baseUrl}/view?${q.toString()}`;
}

/** 从 history 记录收集全部产物文件的 /view 地址 */
export function collectOutputUrls(
  baseUrl: string,
  entry: ComfyHistoryEntry,
): string[] {
  const urls: string[] = [];
  for (const outputs of Object.values(entry.outputs || {})) {
    const files = [...(outputs.images || []), ...(outputs.gifs || [])];
    for (const f of files) {
      urls.push(buildViewUrl(baseUrl, f));
    }
  }
  return urls;
}

/** 从 history 的执行错误消息里提取人类可读文本 */
export function extractHistoryError(entry: ComfyHistoryEntry): string {
  const messages = entry.status?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return entry.status?.status_str || '执行失败';
  }
  const parts: string[] = [];
  for (const item of messages) {
    // 形如 ["execution_error", { exception_message, node_id, ... }]
    if (Array.isArray(item) && item[1] && typeof item[1] === 'object') {
      const detail = item[1] as Record<string, unknown>;
      const msg =
        (typeof detail.exception_message === 'string' && detail.exception_message) ||
        (typeof detail.message === 'string' && detail.message);
      if (msg) parts.push(msg);
    }
  }
  return parts.join('; ') || JSON.stringify(messages).slice(0, 500);
}
