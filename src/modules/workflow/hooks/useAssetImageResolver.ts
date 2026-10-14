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

import { useEffect, useRef, useState, useCallback } from 'react';
import { localApi } from '@/storage';
import { idbStorage } from '@/shared/utils/indexedDbStorage';

interface ResolvedImage {
  url: string;
  thumbnailUrl?: string;
  status: string;
  assetType: string;
  metadata?: Record<string, any>;
}

interface UseAssetImageResolverOptions {
  projectId?: string;
}

const CACHE_KEY_PREFIX = 'shotlib_image_asset_cache_';
const pendingRequests = new Map<string, Promise<Record<string, ResolvedImage>>>();

/**
 * 图片资产 URL 解析 Hook
 *
 * 接收 assetId 或 assetId[]，从项目资产库批量解析为可访问 URL。
 * 结果会缓存到 IndexedDB，避免重复请求。
 */
export function useAssetImageResolver(options: UseAssetImageResolverOptions = {}) {
  const { projectId } = options;
  const [resolvedMap, setResolvedMap] = useState<Record<string, ResolvedImage>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mapRef = useRef(resolvedMap);
  mapRef.current = resolvedMap;

  const loadFromCache = useCallback(async (assetId: string): Promise<ResolvedImage | null> => {
    try {
      const cached = await idbStorage.getItem<ResolvedImage>(`${CACHE_KEY_PREFIX}${assetId}`);
      if (!cached?.url) return null;
      // blob: objectURL 仅当前会话有效,历史缓存里的一定是死链 —— 视为未命中并清除,
      // 让本次重新解析(配置了 OSS 时 ensureUrl 会补传为持久远程地址)
      if (cached.url.startsWith('blob:')) {
        await idbStorage.removeItem(`${CACHE_KEY_PREFIX}${assetId}`);
        return null;
      }
      return cached;
    } catch (e) {
      console.warn('[useAssetImageResolver] 读取缓存失败:', e);
    }
    return null;
  }, []);

  const saveToCache = useCallback(async (assetId: string, data: ResolvedImage) => {
    // 会话级 blob: 地址不落缓存,避免刷新后读到死链
    if (!data.url || data.url.startsWith('blob:')) return;
    try {
      await idbStorage.setItem(`${CACHE_KEY_PREFIX}${assetId}`, data);
    } catch (e) {
      console.warn('[useAssetImageResolver] 写入缓存失败:', e);
    }
  }, []);

  const resolve = useCallback(
    async (assetIds: string[]): Promise<Record<string, ResolvedImage>> => {
      if (!projectId || assetIds.length === 0) return {};

      const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
      const result: Record<string, ResolvedImage> = {};
      const idsToFetch: string[] = [];

      // 先读本地缓存
      await Promise.all(
        uniqueIds.map(async (id) => {
          const cached = await loadFromCache(id);
          if (cached) {
            result[id] = cached;
          } else {
            idsToFetch.push(id);
          }
        }),
      );

      if (idsToFetch.length === 0) {
        setResolvedMap((prev) => ({ ...prev, ...result }));
        return result;
      }

      setIsLoading(true);
      setError(null);

      try {
        // 复用完全相同 id 集合的进行中请求,避免重复调用。
        // 注意不能只按 projectId 去重:多张卡片并发解析各自的 assetId 时,
        // 只按 projectId 复用会让后到的卡片拿到前一批的结果,自己的 id 永远解析不到
        const requestKey = `${projectId}:${[...idsToFetch].sort().join(',')}`;
        let request = pendingRequests.get(requestKey);
        if (!request) {
          request = localApi.resolveImageAssets(projectId, { asset_ids: idsToFetch }).then((res) => {
            if (res.success && res.data) {
              return res.data;
            }
            throw new Error(res.message || '解析图片资产失败');
          });
          pendingRequests.set(requestKey, request);
          request.finally(() => pendingRequests.delete(requestKey));
        }

        const fetched = await request;
        for (const [id, data] of Object.entries(fetched)) {
          result[id] = data;
          saveToCache(id, data);
        }

        setResolvedMap((prev) => ({ ...prev, ...result }));
        return result;
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, loadFromCache, saveToCache],
  );

  const getUrl = useCallback(
    (assetId?: string): string => {
      if (!assetId) return '';
      return mapRef.current[assetId]?.url || '';
    },
    [],
  );

  const getUrls = useCallback(
    (assetIds?: string[]): string[] => {
      if (!assetIds) return [];
      return assetIds.map((id) => mapRef.current[id]?.url || '');
    },
    [],
  );

  return {
    resolvedMap,
    isLoading,
    error,
    resolve,
    getUrl,
    getUrls,
  };
}

/**
 * 同步批量解析工具（不依赖 React 生命周期）
 */
export async function resolveAssetImages(
  projectId: string,
  assetIds: string[],
): Promise<Record<string, ResolvedImage>> {
  if (!projectId || assetIds.length === 0) return {};
  const res = await localApi.resolveImageAssets(projectId, { asset_ids: assetIds });
  if (res.success && res.data) {
    for (const [id, data] of Object.entries(res.data)) {
      // 会话级 blob: 地址不落缓存(同 useAssetImageResolver.saveToCache)
      if (!data.url || data.url.startsWith('blob:')) continue;
      try {
        await idbStorage.setItem(`${CACHE_KEY_PREFIX}${id}`, data);
      } catch (e) {
        console.warn('[resolveAssetImages] 写入缓存失败:', e);
      }
    }
    return res.data;
  }
  return {};
}
