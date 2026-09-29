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
 * settingsRepo.ts — 应用设置仓储
 *
 * 单 key 整包存储:厂商 API Key、代理配置、默认模型。
 * API Key 只存浏览器本地(IndexedDB),永不上传。
 */
import { idbGet, idbSet } from './db';
import type { UserPreference, SaveUserPreferenceRequest, ApiResult } from './types';

const SETTINGS_KEY = 'app-settings';
const PREF_KEY = 'user-preference';

/** 每厂商代理策略 */
export type ProxyMode = 'direct' | 'proxy';

export interface AppSettings {
  /** 厂商 API Key:providerId → key */
  apiKeys: Record<string, string>;
  /** 全局代理地址(如 https://your-worker.workers.dev) */
  proxyUrl: string;
  /** 每厂商代理模式覆盖(缺省用厂商默认建议) */
  providerProxyMode: Record<string, ProxyMode>;
  /** 全局默认模型回退:text/image/video/voice */
  defaultModels: { text?: string; image?: string; video?: string; voice?: string };
}

const DEFAULT_SETTINGS: AppSettings = {
  apiKeys: {},
  proxyUrl: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEFAULT_PROXY_URL) || '',
  providerProxyMode: {},
  defaultModels: {},
};

let cache: AppSettings | undefined;

export const settingsRepo = {
  async get(): Promise<AppSettings> {
    if (!cache) {
      cache = { ...DEFAULT_SETTINGS, ...((await idbGet<AppSettings>(SETTINGS_KEY)) || {}) };
    }
    return cache;
  },

  async save(patch: Partial<AppSettings>): Promise<ApiResult<AppSettings>> {
    const current = await settingsRepo.get();
    cache = { ...current, ...patch };
    await idbSet(SETTINGS_KEY, cache);
    return { success: true, data: cache };
  },

  async getApiKey(providerId: string): Promise<string> {
    const s = await settingsRepo.get();
    return s.apiKeys[providerId] || '';
  },

  async setApiKey(providerId: string, key: string): Promise<void> {
    const s = await settingsRepo.get();
    await settingsRepo.save({ apiKeys: { ...s.apiKeys, [providerId]: key } });
  },

  /** 该厂商是否走代理:用户覆盖 > 默认(调用方传入厂商默认建议) */
  async useProxy(providerId: string, providerDefault: boolean): Promise<boolean> {
    const s = await settingsRepo.get();
    const mode = s.providerProxyMode[providerId];
    if (mode === 'proxy') return true;
    if (mode === 'direct') return false;
    return providerDefault && !!s.proxyUrl;
  },

  // ---------- 用户偏好(主题等,兼容原 getUserPreference/saveUserPreference) ----------

  async getPreference(): Promise<ApiResult<UserPreference | null>> {
    const pref = await idbGet<UserPreference>(PREF_KEY);
    return { success: true, data: pref || null };
  },

  async savePreference(req: SaveUserPreferenceRequest): Promise<ApiResult<UserPreference>> {
    const existing = await idbGet<UserPreference>(PREF_KEY);
    const record: UserPreference = {
      id: 'local-preference',
      member_id: 0,
      theme: req.theme ?? existing?.theme ?? 'dark',
      settings: { ...existing?.settings, ...req.settings },
      version: (existing?.version || 0) + 1,
      updated_at: new Date().toISOString(),
    };
    await idbSet(PREF_KEY, record);
    return { success: true, data: record };
  },
};
