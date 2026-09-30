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
 * client.ts — 统一请求客户端
 *
 * 职责(替代后端 BaseAdapter.fetchWithTimeout + 网关):
 * 1. 代理改写:按每厂商代理策略把原始 URL 包成代理 URL(解决国内厂商接口 CORS)
 * 2. 超时控制:AbortController
 * 3. 请求日志:所有厂商请求记录到 LogPanel(右下角「日志」),视频轮询类同 URL GET 自动合并
 *
 * 代理约定:通用转发器收到 `?url=<encodeURIComponent(原始URL)>` 后原样转发
 * 请求方法/头/体,并回加 CORS 头。参考 proxy/ 目录的 cloudflare-worker.js / node-proxy.mjs。
 */
import { settingsRepo } from '@/storage/settingsRepo';
import { getProviderProxyDefault } from './model-registry';
import { useLogStore } from '@/shared/stores/logStore';

export interface FetchOptions extends RequestInit {
  /** 超时毫秒数,默认 30000 */
  timeout?: number;
}

/** 拼接代理 URL:去掉代理基址尾部斜杠 + ?url= 编码透传 */
export function buildProxyUrl(proxyBase: string, targetUrl: string): string {
  const base = proxyBase.replace(/\/+$/, '');
  return `${base}?url=${encodeURIComponent(targetUrl)}`;
}

/**
 * 解析请求最终 URL:按厂商代理策略决定直连或走代理
 * @param providerId 厂商标识(如 volcengine)
 */
export async function resolveRequestUrl(
  providerId: string,
  url: string,
): Promise<string> {
  const useProxy = await settingsRepo.useProxy(
    providerId,
    getProviderProxyDefault(providerId),
  );
  if (!useProxy) return url;
  const settings = await settingsRepo.get();
  if (!settings.proxyUrl) return url; // 未配置代理时静默直连
  return buildProxyUrl(settings.proxyUrl, url);
}

/** 日志中的响应摘要:JSON 响应原样记录(轮询/生成响应均为小 JSON),其余记状态 */
async function summarizeResponse(resp: Response): Promise<unknown> {
  try {
    const cloned = resp.clone();
    const text = await cloned.text();
    try {
      return JSON.parse(text);
    } catch {
      return { status: resp.status, bodyPreview: text.slice(0, 200) };
    }
  } catch {
    return { status: resp.status };
  }
}

/**
 * 记录厂商请求日志(LogPanel 右下角「日志」可查)。
 * 视频/图片任务的轮询是同 URL GET 高频调用:15 秒内的相同 GET 合并到最近一条,
 * 在 message 上累计轮询次数,避免刷掉关键请求。
 */
function logProviderRequest(
  providerId: string,
  finalUrl: string,
  fetchOptions: RequestInit,
  resp: Response | undefined,
  duration: number,
  error?: unknown,
): void {
  const method = (fetchOptions.method || 'GET').toUpperCase();
  let request: unknown = fetchOptions.body;
  if (typeof request === 'string') {
    try {
      request = JSON.parse(request);
    } catch {
      /* 保留原字符串 */
    }
  }

  const level = error || !resp?.ok ? 'error' : 'success';
  const statusText = error
    ? `失败: ${error instanceof Error ? error.message : String(error)}`
    : `HTTP ${resp!.status}`;
  const message = `${method} ${shortUrl(finalUrl)} ${statusText} (${duration}ms)`;

  const store = useLogStore.getState();
  const last = store.logs[0];
  if (method === 'GET' && !error && resp?.ok && last?.url === finalUrl && last.method === 'GET' && Date.now() - last.timestamp < 15000) {
    const pollCount = (last.pollCount || 1) + 1;
    useLogStore.setState((s) => ({
      logs: s.logs.map((l, i) =>
        i === 0
          ? { ...l, timestamp: Date.now(), duration, pollCount, response: undefined, message: `${message} · 第 ${pollCount} 次轮询` }
          : l,
      ),
    }));
    return;
  }

  // 响应体异步读取,不阻塞请求返回
  const responsePromise = resp ? summarizeResponse(resp) : Promise.resolve(undefined);
  void responsePromise.then((response) => {
    useLogStore.getState().addLog({
      level,
      source: 'ai-model',
      vendor: providerId,
      url: finalUrl,
      method,
      request,
      response,
      error: error instanceof Error ? error.message : error,
      message,
      duration,
    });
  });
}

/** 日志展示用的短 URL:代理 URL 展示真实目标路径,厂商 URL 展示 path */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const target = u.searchParams.get('url');
    if (target) return new URL(target).pathname;
    return u.pathname;
  } catch {
    return url.slice(0, 80);
  }
}

/**
 * 带超时与代理策略的 fetch 封装
 * 超时抛出 DOMException(AbortError),与浏览器原生 fetch 超时行为一致
 */
export async function providerFetch(
  providerId: string,
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;
  const finalUrl = await resolveRequestUrl(providerId, url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const startTime = Date.now();
  try {
    const resp = await fetch(finalUrl, {
      ...fetchOptions,
      signal: controller.signal,
    });
    logProviderRequest(providerId, finalUrl, fetchOptions, resp, Date.now() - startTime);
    return resp;
  } catch (e) {
    logProviderRequest(providerId, finalUrl, fetchOptions, undefined, Date.now() - startTime, e);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}
