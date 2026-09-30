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
 * runtime-config.ts — 部署级运行时配置(CLI ↔ 前端桥梁)
 *
 * 拉取部署服务暴露的 /app-config.json(由 `npm run cli` 写入 runtime/app-config.json,
 * scripts/serve.mjs 与 vite dev 中间件均会动态映射该文件),按 generatedAt 版本号
 * 合并进 settingsRepo:
 * - CLI 每次保存都会刷新 generatedAt,下次页面加载以文件为准覆盖同名项(一次性)
 * - 文件未再修改时,浏览器内(设置页)手动修改不会被反复覆盖
 *
 * 优先级:CLI 文件(每次保存后生效一次)> 浏览器设置页 > VITE_DEFAULT_PROXY_URL
 */
import { idbGet, idbSet } from './db';
import { settingsRepo } from './settingsRepo';
import type { AppSettings, OssConfig } from './settingsRepo';

/** 部署级配置文件形状(与 scripts/cli.mjs 写出的 runtime/app-config.json 对应) */
interface RuntimeConfig {
  generatedAt?: string;
  apiKeys?: Record<string, string>;
  defaultModels?: Partial<AppSettings['defaultModels']>;
  proxyUrl?: string;
  oss?: Partial<OssConfig>;
}

/** 已应用版本标记的 IndexedDB key(自动带 shotlib: 前缀) */
const RUNTIME_MARKER_KEY = 'app-settings-runtime';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 应用部署级配置。应在应用渲染前调用(main.tsx),
 * 保证设置页首次读取 settingsRepo 时即为合并后的值。
 * 任何失败(无配置文件 / 非 JSON / IndexedDB 异常)都静默降级,不阻塞启动。
 */
export async function applyRuntimeConfig(): Promise<void> {
  // 1. 拉取配置文件(404 / 非 JSON 时静默跳过——未配置属正常情况)
  let config: RuntimeConfig;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}app-config.json`, { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    config = JSON.parse(text) as RuntimeConfig;
    if (!isPlainObject(config)) return;
  } catch {
    return;
  }

  // 2. 版本比较:同一份文件只应用一次,避免覆盖浏览器内的后续手动修改
  const generatedAt = typeof config.generatedAt === 'string' ? config.generatedAt : '';
  if (!generatedAt) return;
  const marker = await idbGet<{ appliedGeneratedAt?: string }>(RUNTIME_MARKER_KEY);
  if (marker?.appliedGeneratedAt === generatedAt) return;

  // 3. 字段级合并:仅覆盖文件中显式给出的项
  const patch: Partial<AppSettings> = {};
  const current = await settingsRepo.get();

  if (isPlainObject(config.apiKeys)) {
    const apiKeys: Record<string, string> = {};
    for (const [provider, key] of Object.entries(config.apiKeys)) {
      if (typeof key === 'string' && key.trim()) apiKeys[provider] = key.trim();
    }
    if (Object.keys(apiKeys).length > 0) {
      patch.apiKeys = { ...current.apiKeys, ...apiKeys };
    }
  }

  if (isPlainObject(config.defaultModels)) {
    const defaultModels: AppSettings['defaultModels'] = { ...current.defaultModels };
    for (const type of ['text', 'image', 'video'] as const) {
      const modelId = config.defaultModels[type];
      if (typeof modelId === 'string' && modelId.trim()) {
        defaultModels[type] = modelId.trim() as AppSettings['defaultModels'][typeof type];
      }
    }
    patch.defaultModels = defaultModels;
  }

  if (typeof config.proxyUrl === 'string' && config.proxyUrl.trim()) {
    patch.proxyUrl = config.proxyUrl.trim();
  }

  // OSS 配置:文件提供了完整凭证时整体覆盖(部署级配置为单一事实源)
  const fileOss = isPlainObject(config.oss) ? (config.oss as Record<string, unknown>) : undefined;
  if (fileOss && typeof fileOss.bucket === 'string' && fileOss.bucket.trim()) {
    patch.oss = {
      provider: fileOss.provider === 'amazon' ? 'amazon' : 'aliyun',
      bucket: (fileOss.bucket as string).trim(),
      region: typeof fileOss.region === 'string' ? fileOss.region.trim() : '',
      accessKeyId: typeof fileOss.accessKeyId === 'string' ? fileOss.accessKeyId.trim() : '',
      accessKeySecret: typeof fileOss.accessKeySecret === 'string' ? fileOss.accessKeySecret.trim() : '',
      endpoint: typeof fileOss.endpoint === 'string' ? fileOss.endpoint.trim() : undefined,
      publicBaseUrl: typeof fileOss.publicBaseUrl === 'string' ? fileOss.publicBaseUrl.trim() : undefined,
    };
  }

  // 4. 落库并记录已应用版本(即使无覆盖项也要记录,避免每次加载重复解析合并)
  if (Object.keys(patch).length > 0) {
    await settingsRepo.save(patch);
  }
  await idbSet(RUNTIME_MARKER_KEY, { appliedGeneratedAt: generatedAt });
}
