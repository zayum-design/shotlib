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
 *
 * 代理约定:通用转发器收到 `?url=<encodeURIComponent(原始URL)>` 后原样转发
 * 请求方法/头/体,并回加 CORS 头。参考 proxy/ 目录的 cloudflare-worker.js / node-proxy.mjs。
 */
import { settingsRepo } from '@/storage/settingsRepo';
import { getProviderProxyDefault } from './model-registry';

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

  try {
    return await fetch(finalUrl, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
