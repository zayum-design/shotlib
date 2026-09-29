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

import { useEffect, useMemo } from 'react';
import { useWorkflowStore } from '../stores/workflowStore';
import { useAssetImageResolver } from './useAssetImageResolver';

/**
 * 基于当前 workflowStore 的 projectId 解析图片资产
 */
export function useWorkflowImageResolver() {
  const projectId = useWorkflowStore((state) => state.currentProjectId);
  return useAssetImageResolver({ projectId });
}

/**
 * 解析单张图片资产
 * @param assetId 图片资产ID
 * @param fallbackUrl 解析失败时的回退URL
 */
export function useResolvedImageUrl(
  assetId?: string,
  fallbackUrl?: string,
): string {
  const { resolve, getUrl } = useWorkflowImageResolver();

  useEffect(() => {
    if (assetId) {
      resolve([assetId]).catch((e) => console.warn('[useResolvedImageUrl] 解析失败:', e));
    }
  }, [assetId, resolve]);

  return getUrl(assetId) || fallbackUrl || '';
}

/**
 * 批量解析图片资产
 * @param assetIds 图片资产ID数组（可含 undefined）
 */
export function useResolvedImageUrls(
  assetIds: (string | undefined)[],
): { getUrl: (assetId?: string) => string } {
  const { resolve, getUrl } = useWorkflowImageResolver();

  const validIds = useMemo(
    () => assetIds.filter((id): id is string => !!id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assetIds.join(',')],
  );

  useEffect(() => {
    if (validIds.length > 0) {
      resolve(validIds).catch((e) => console.warn('[useResolvedImageUrls] 解析失败:', e));
    }
  }, [validIds, resolve]);

  return { getUrl };
}
