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

import { useCallback } from 'react';

export function useInstantNavigation({
  setActiveSegmentId,
  setSelectedSceneItemId,
  setSearchParams,
}: {
  setActiveSegmentId: (id: string | null) => void;
  setSelectedSceneItemId: (id: string | null) => void;
  setSearchParams: (updater: (prev: URLSearchParams) => URLSearchParams, options?: { replace?: boolean }) => void;
}) {
  // 切换片段：原子地更新 state + URL，避免 effect 间的竞态
  const switchSegment = useCallback(
    (id: string | null) => {
      setActiveSegmentId(id);
      if (id) {
        // 同时使用 router 和原生 history,确保 URL 在所有场景下都同步
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('segment', id);
            return next;
          },
          { replace: true }
        );
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('segment', id);
          window.history.replaceState(window.history.state, '', url.toString());
        } catch (e) {
          console.warn('[switchSegment] URL 更新失败:', e);
        }
      }
    },
    [setSearchParams, setActiveSegmentId]
  );

  // 切换当前选中的场次（场景拖入后的 box）：原子地更新 state + URL
  const applySelectedScene = useCallback(
    (id: string | null) => {
      setSelectedSceneItemId(id);
      try {
        const url = new URL(window.location.href);
        if (id) {
          url.searchParams.set('scene', id);
        } else {
          url.searchParams.delete('scene');
        }
        window.history.replaceState(window.history.state, '', url.toString());
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            if (id) {
              next.set('scene', id);
            } else {
              next.delete('scene');
            }
            return next;
          },
          { replace: true }
        );
      } catch (e) {
        console.warn('[applySelectedScene] URL 更新失败:', e);
      }
    },
    [setSearchParams, setSelectedSceneItemId]
  );

  return { switchSegment, applySelectedScene };
}
