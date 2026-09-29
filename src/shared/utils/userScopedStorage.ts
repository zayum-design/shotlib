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
 * UserScopedStorage - 用户隔离的浏览器存储代理层
 *
 * 所有 localStorage 操作都通过此层代理，自动注入当前登录用户的 ID 作为 key 前缀。
 * 确保用户A的数据不会被用户B看到/访问。
 *
 * 前缀格式: sl_u{userId}_   示例: sl_u42_project-storage
 * 未登录状态使用: sl_uguest_
 */

let userIdResolver: (() => number | null | undefined) = () => undefined;

/** 注册获取当前用户 ID 的 resolver(开源版:无账号体系,恒为本地单用户) */
export function setUserIdResolver(resolver: () => number | null | undefined): void {
  userIdResolver = resolver;
}

/** 获取当前用户前缀 */
function getPrefix(): string {
  const userId = userIdResolver();
  return `sl_u${userId ?? 'guest'}_`;
}

/** 为 key 添加用户前缀（已带前缀的不再重复添加） */
function prefixKey(key: string): string {
  if (key.startsWith('sl_u')) return key;
  return getPrefix() + key;
}

class UserScopedStorage {
  getItem(key: string): string | null {
    return localStorage.getItem(prefixKey(key));
  }

  setItem(key: string, value: string): void {
    localStorage.setItem(prefixKey(key), value);
  }

  removeItem(key: string): void {
    localStorage.removeItem(prefixKey(key));
  }

  /** 获取当前用户前缀（用于需要直接操作 key 的场景） */
  getUserPrefix(): string {
    return getPrefix();
  }

  /** 登出时：清除当前用户的所有 localStorage 数据 */
  clearUserData(): void {
    const prefix = getPrefix();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
  }

  /** 登录时：清理旧格式数据（无用户前缀的历史 key） */
  cleanupLegacyData(): void {
    const legacyKeys = [
      'project-storage',
      'theme-storage',
      'novel-chat-storage',
      'settings-storage',
      'novel-model-storage',
      // 任务队列历史曾用无前缀裸 key 存储（会跨用户泄漏），登录时清理
      'shotlib_task_queue',
    ];
    const legacyPrefixes = ['chuangcool_', 'cc_u', 'all:apiPreviewMode'];

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || key.startsWith('sl_u')) continue;

      const isLegacyKey = legacyKeys.includes(key);
      const isLegacyPrefix = legacyPrefixes.some((p) => key.startsWith(p));

      if (isLegacyKey || isLegacyPrefix) {
        localStorage.removeItem(key);
      }
    }
  }
}

/** 全局用户隔离存储实例 */
export const userStorage = new UserScopedStorage();

/** 供 zustand persist middleware 使用的自定义 storage */
export function createUserScopedPersistStorage(): {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
} {
  return {
    getItem: (name: string): string | null => {
      return userStorage.getItem(name);
    },
    setItem: (name: string, value: string): void => {
      userStorage.setItem(name, value);
    },
    removeItem: (name: string): void => {
      userStorage.removeItem(name);
    },
  };
}
