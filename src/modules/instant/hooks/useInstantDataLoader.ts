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

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'react';
import type { InstantSegment, InstantCharacter, InstantScene, CanvasItem } from '@/shared/types/project';
import { loadInstantData, saveInstantData, cleanGeneratingState } from '@/modules/instant/utils/instantStorageUtils';
import { loadInstantFromServer } from '@/modules/instant/utils/instantSyncUtils';
import { localApi } from '@/storage';
import { useProjectStore } from '@/shared/stores/projectStore';

const createEmptySegment = (name: string): InstantSegment => ({
  id: crypto.randomUUID(),
  name,
  canvasItems: [],
  connections: [],
});

/** 收集角色/场景图片的 assetId，用于加载时填充 image_asset.data 缓存 */
const collectImageAssetIds = (
  characters: InstantCharacter[],
  scenes: InstantScene[],
  segments: InstantSegment[] = [],
): string[] => {
  const ids = new Set<string>();
  for (const char of characters) {
    for (const img of char.avatarImages || []) {
      const key = img.assetId || img.id;
      if (key) ids.add(key);
    }
    for (const img of char.portraitImages || []) {
      const key = img.assetId || img.id;
      if (key) ids.add(key);
    }
    for (const img of char.fullBodyImages || []) {
      const key = img.assetId || img.id;
      if (key) ids.add(key);
    }
  }
  for (const scene of scenes) {
    if (scene.assetId) ids.add(scene.assetId);
  }
  // 首尾帧图（asset_type=frame_image）的 asset_key，用于加载图片数据
  for (const seg of segments) {
    for (const item of seg.canvasItems || []) {
      if (item.firstFrameImageAssetId) ids.add(item.firstFrameImageAssetId);
      if (item.lastFrameImageAssetId) ids.add(item.lastFrameImageAssetId);
    }
  }
  return Array.from(ids);
};

interface UseInstantDataLoaderOptions {
  projectId: string | undefined;
  setSearchParams: (updater: (prev: URLSearchParams) => URLSearchParams, options?: { replace?: boolean }) => void;
  setCharacters: React.Dispatch<React.SetStateAction<InstantCharacter[]>>;
  setScenes: React.Dispatch<React.SetStateAction<InstantScene[]>>;
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  setActiveSegmentId: (id: string | null) => void;
  setSelectedSceneItemId: (id: string | null) => void;
  markAsSaved: (characters: InstantCharacter[], scenes: InstantScene[], segments: InstantSegment[]) => void;
}

export function useInstantDataLoader({
  projectId,
  setSearchParams,
  setCharacters,
  setScenes,
  setSegments,
  setActiveSegmentId,
  setSelectedSceneItemId,
  markAsSaved,
}: UseInstantDataLoaderOptions) {
  const dataLoadedForProjectRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId || dataLoadedForProjectRef.current === projectId) return;
    dataLoadedForProjectRef.current = projectId;
    // 开源版:登记当前项目,生成图片时 AI 层据此 blob 化落库(imageRepo)
    useProjectStore.getState().setCurrentProject(projectId);

    const load = async () => {
      // 1. 优先从服务器加载
      let stored = await loadInstantFromServer(projectId);

      // 2. 服务器没有数据，尝试从 localStorage 加载
      if (!stored) {
        stored = loadInstantData(projectId);
      }

      // 加载数据并清理临时生成状态（防止刷新后loading卡住）
      const cleanedStored = stored ? cleanGeneratingState(stored) : null;
      const loadedChars = cleanedStored?.instantCharacters || [];
      const loadedScenes = cleanedStored?.instantScenes || [];
      const loadedSegments = (cleanedStored?.instantSegments || []).map((s: InstantSegment) => ({
        ...s,
        canvasItems: (s.canvasItems || []).map((item: CanvasItem) => ({
          ...item,
          characters: item.characters || [],
        })),
        connections: s.connections || [],
      }));

      // 诊断: 检查加载的数据中是否有未完成的视频任务
      const pendingItems = loadedSegments.flatMap((s: InstantSegment) =>
        s.canvasItems
          .filter((item: CanvasItem) => item.videoTaskId && !item.videoUrl)
          .map((item: CanvasItem) => ({
            segmentId: s.id,
            itemId: item.id,
            videoTaskId: item.videoTaskId,
            isGeneratingVideo: item.isGeneratingVideo,
            videoGenerationFailed: item.videoGenerationFailed,
          }))
      );
      console.log('[loadInstantData] loaded pending video tasks:', pendingItems.length, pendingItems);

      // 预加载图片资产 data 到缓存，避免刷新后图片解析失败
      const assetIds = collectImageAssetIds(
        loadedChars,
        loadedScenes,
        loadedSegments,
      );
      if (assetIds.length > 0 && projectId) {
        try {
          await localApi.resolveImageAssets(projectId, { asset_ids: assetIds });
        } catch (e) {
          console.warn('[loadInstantData] 预加载图片资产缓存失败:', e);
        }
      }

      setCharacters(loadedChars);
      setScenes(loadedScenes);

      // 从当前真实 URL 读取片段/场景参数，避免 useSearchParams 在初始渲染时不同步的问题
      const currentUrl = new URL(window.location.href);
      const urlSegmentId = currentUrl.searchParams.get('segment');
      const urlSceneId = (currentUrl.searchParams.get('scene') || '').trim() || null;
      const cleanSegmentId = urlSegmentId ? urlSegmentId.trim() : null;

      if (loadedSegments.length === 0) {
        const defaultSegment = createEmptySegment('片段1');
        const next = [defaultSegment];
        setSegments(next);
        setActiveSegmentId(defaultSegment.id);
        saveInstantData(projectId, {
          instantCharacters: loadedChars,
          instantScenes: loadedScenes,
          instantSegments: next,
        });
        // 初始化 lastSavedDataRef，避免加载后立即触发 autoSave
        markAsSaved(loadedChars, loadedScenes, next);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('segment', defaultSegment.id);
            return next;
          },
          { replace: true }
        );
        return;
      }

      setSegments(loadedSegments);
      // 初始化 lastSavedDataRef，避免加载后立即触发 autoSave
      markAsSaved(loadedChars, loadedScenes, loadedSegments);
      const targetId =
        cleanSegmentId && loadedSegments.some((s: InstantSegment) => s.id === cleanSegmentId)
          ? cleanSegmentId
          : loadedSegments[0].id;
      setActiveSegmentId(targetId);
      if (targetId !== cleanSegmentId) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('segment', targetId);
            return next;
          },
          { replace: true }
        );
      }

      // 自动选中第一个场景：优先使用 URL 中 ?scene= 指定的场次
      const sceneItems = (loadedSegments.find((s: InstantSegment) => s.id === targetId)?.canvasItems || [])
        .filter((item: CanvasItem) => item.type === 'scene');
      const matchedScene = urlSceneId
        ? sceneItems.find((item: CanvasItem) => item.id === urlSceneId)
        : null;
      const targetSceneItem = matchedScene || sceneItems[0];
      if (targetSceneItem) {
        setSelectedSceneItemId(targetSceneItem.id);
        // 如果 URL 中的 scene id 不匹配,清理 URL；否则保持原样
        if (urlSceneId && !matchedScene) {
          try {
            const url = new URL(window.location.href);
            url.searchParams.set('scene', targetSceneItem.id);
            window.history.replaceState(window.history.state, '', url.toString());
          } catch {
            // ignore
          }
        }
      }
    };

    load();
  }, [projectId, setSearchParams]);
}
