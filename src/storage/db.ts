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
 * db.ts — IndexedDB 底层封装(基于 idb-keyval)
 *
 * 纯前端项目唯一持久层。所有 key 使用 `shotlib:` 前缀统一命名空间,
 * 无用户隔离(开源版无登录体系)。
 */
import { createStore, get, set, del, keys } from 'idb-keyval';

const DB_NAME = 'shotlib-db';
const STORE_NAME = 'kv';
const KEY_PREFIX = 'shotlib:';

/** 延迟创建 store(避免 SSR/测试环境下顶层副作用) */
let _store: ReturnType<typeof createStore> | undefined;
function store() {
  if (!_store) {
    _store = createStore(DB_NAME, STORE_NAME);
  }
  return _store;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  return (await get<T>(KEY_PREFIX + key, store())) as T | undefined;
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  await set(KEY_PREFIX + key, value, store());
}

export async function idbDel(key: string): Promise<void> {
  await del(KEY_PREFIX + key, store());
}

/** 列出指定前缀下的所有完整 key(不含前缀) */
export async function idbKeys(prefix?: string): Promise<string[]> {
  const all = (await keys(store())) as string[];
  return all
    .filter((k) => k.startsWith(KEY_PREFIX))
    .map((k) => k.slice(KEY_PREFIX.length))
    .filter((k) => (prefix ? k.startsWith(prefix) : true));
}

/** 删除指定前缀下的所有 key,返回删除数量 */
export async function idbDelByPrefix(prefix: string): Promise<number> {
  const matched = await idbKeys(prefix);
  await Promise.all(matched.map((k) => idbDel(k)));
  return matched.length;
}

/** 导出整个数据库(排除大 blob 图片可选),供数据导出功能使用 */
export async function idbDump(includeBlobs = true): Promise<Record<string, unknown>> {
  const all = await idbKeys();
  const dump: Record<string, unknown> = {};
  for (const key of all) {
    if (!includeBlobs && key.startsWith('imageasset:')) continue;
    dump[key] = await idbGet(key);
  }
  return dump;
}

/** 从导出数据恢复(逐 key 写入) */
export async function idbRestore(dump: Record<string, unknown>): Promise<void> {
  await Promise.all(Object.entries(dump).map(([key, value]) => idbSet(key, value)));
}

/** 清空全部数据(设置页"清空所有本地数据"用) */
export async function idbClearAll(): Promise<void> {
  const all = await idbKeys();
  await Promise.all(all.map((k) => idbDel(k)));
}
