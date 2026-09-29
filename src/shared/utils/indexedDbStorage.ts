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
 * IndexedDBStorage - 用户隔离的 IndexedDB 存储层
 *
 * 用于存储大容量数据（项目资产、分集数据），替代 localStorage。
 * 容量可达几百 MB，异步操作不阻塞主线程。
 *
 * 前缀格式: sl_u{userId}_   未登录状态: sl_uguest_
 */

import { get, set, del, keys } from 'idb-keyval';

let userIdResolver: (() => number | null | undefined) = () => undefined;

/** 注册获取当前用户 ID 的 resolver(开源版:无账号体系,恒为本地单用户) */
export function setUserIdResolverForIDB(resolver: () => number | null | undefined): void {
  userIdResolver = resolver;
}

/** 获取当前用户前缀 */
function getPrefix(): string {
  const userId = userIdResolver();
  return `sl_u${userId ?? 'guest'}_`;
}

/** 为 key 添加用户前缀 */
function prefixKey(key: string): string {
  if (key.startsWith('sl_u')) return key;
  return getPrefix() + key;
}

class IndexedDbStorage {
  /** 读取数据（优先读用户隔离数据，找不到则 fallback 到旧版 guest 数据） */
  async getItem<T = any>(key: string): Promise<T | null> {
    const prefixed = prefixKey(key);
    try {
      const value = await get(prefixed);
      if (value !== undefined) return value;
      // fallback：兼容未注册 resolver 时的旧数据（sl_uguest_ 前缀）
      const guestPrefixed = `sl_uguest_${key}`;
      const guestValue = await get(guestPrefixed);
      return guestValue ?? null;
    } catch (e) {
      console.error('[IndexedDbStorage] getItem failed:', e);
      return null;
    }
  }

  /** 写入数据 */
  async setItem<T = any>(key: string, value: T): Promise<void> {
    const prefixed = prefixKey(key);
    try {
      await set(prefixed, value);
    } catch (e) {
      console.error('[IndexedDbStorage] setItem failed:', e);
      // 配额超限时降级到 localStorage
      this.fallbackToLocalStorage(prefixed, value);
    }
  }

  /** 删除数据 */
  async removeItem(key: string): Promise<void> {
    const prefixed = prefixKey(key);
    try {
      await del(prefixed);
    } catch (e) {
      console.error('[IndexedDbStorage] removeItem failed:', e);
    }
  }

  /** 清除当前用户的所有数据 */
  async clearUserData(): Promise<void> {
    const prefix = getPrefix();
    try {
      const allKeys = await keys();
      for (const key of allKeys) {
        if (typeof key === 'string' && key.startsWith(prefix)) {
          await del(key);
        }
      }
    } catch (e) {
      console.error('[IndexedDbStorage] clearUserData failed:', e);
    }
  }

  /** 清除所有用户的数据（可保留指定用户的数据，同时清理无隔离的 guest 数据） */
  async clearAllUserDataExcept(excludeUserId?: number | null): Promise<void> {
    const excludePrefix = excludeUserId != null ? `sl_u${excludeUserId}_` : null;
    try {
      const allKeys = await keys();
      for (const key of allKeys) {
        if (typeof key !== 'string') continue;
        // 清理所有用户隔离数据（保留当前用户的）
        if (key.startsWith('sl_u')) {
          if (excludePrefix && key.startsWith(excludePrefix)) continue;
          await del(key);
        }
      }
    } catch (e) {
      console.error('[IndexedDbStorage] clearAllUserDataExcept failed:', e);
    }
  }

  /** 降级到 localStorage（配额超限时的 fallback） */
  private fallbackToLocalStorage(key: string, value: any): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      console.warn('[IndexedDbStorage] 降级到 localStorage:', key);
    } catch (e) {
      console.error('[IndexedDbStorage] fallback 也失败了:', e);
    }
  }
}

/** 全局 IndexedDB 存储实例 */
export const idbStorage = new IndexedDbStorage();
