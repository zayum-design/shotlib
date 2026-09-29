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

import { useState, useEffect, useCallback } from 'react';
import {
  getDevelopmentDirectionsApi,
  type DevelopmentCategory,
  type DevelopmentDirection,
} from '../api/scriptApi';

export interface DevelopmentDirectionsState {
  categories: DevelopmentCategory[];
  isLoading: boolean;
  error: string | null;
}

/**
 * 分集发展方向选择 hook
 * 从后端 /api/creator/script/development-directions 获取预制分类与方向
 */
export function useDevelopmentDirections() {
  const [categories, setCategories] = useState<DevelopmentCategory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirections = useCallback(async () => {
    if (categories.length > 0) return; // 已加载则不再重复请求
    setIsLoading(true);
    setError(null);
    try {
      const res = await getDevelopmentDirectionsApi();
      if (res.success && res.data?.categories) {
        setCategories(res.data.categories);
      } else {
        setError(res.message || '加载发展方向失败');
      }
    } catch (e: any) {
      setError(e?.message || '加载发展方向失败');
      console.error('[useDevelopmentDirections] 加载失败:', e);
    } finally {
      setIsLoading(false);
    }
  }, [categories.length]);

  // 组件挂载时自动加载
  useEffect(() => {
    loadDirections();
  }, [loadDirections]);

  return {
    categories,
    isLoading,
    error,
    reload: loadDirections,
  };
}

export type { DevelopmentCategory, DevelopmentDirection };
