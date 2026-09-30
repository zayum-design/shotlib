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

import { localApi } from '@/storage';
import type { InstantProjectData } from '@/shared/types/project';
import { userStorage } from '@/shared/utils/userScopedStorage';
import {
  clearInstantDirty,
  clearInstantDirtyIfUnchanged,
  isInstantDirty,
  loadInstantData,
  readInstantDirtyMark,
} from './instantStorageUtils';

// 标记是否正在从服务器加载，防止加载时触发保存
let isLoadingFromServer = false;

/** 判断错误是否为 409 冲突 */
function isConflictError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('409');
}

/** 带自动重试的 API 调用（409 冲突时重试 3 次，指数退避） */
async function saveWithRetry<T>(label: string, saveFn: () => Promise<T>): Promise<T | null> {
  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await saveFn();
    } catch (e) {
      lastError = e;
      if (isConflictError(e) && attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.warn(`[instantSync] ${label} 冲突，${delay}ms 后重试 (${attempt + 1}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  const errorMsg = lastError instanceof Error ? lastError.message : '未知错误';
  console.error(`[instantSync] ${label} 保存失败:`, errorMsg);
  return null;
}

/** 判断即时创作数据是否有效（防止空状态覆盖服务器） */
export function hasValidInstantData(data: InstantProjectData): boolean {
  return (
    (data.instantCharacters && data.instantCharacters.length > 0) ||
    (data.instantScenes && data.instantScenes.length > 0) ||
    (data.instantSegments && data.instantSegments.length > 0)
  );
}

/** 从服务器加载即时创作数据 */
export async function loadInstantFromServer(projectId: string): Promise<InstantProjectData | null> {
  if (!projectId || projectId === 'default') return null;

  // 如果本地存在未同步到服务器的修改（脏数据），优先返回本地数据，
  // 避免服务器旧数据覆盖用户最新的编辑（例如 2s 自动保存防抖期内刷新页面）。
  if (isInstantDirty(projectId)) {
    const local = loadInstantData(projectId);
    if (local) {
      console.log('[instantSync] 检测到本地脏数据，使用本地缓存并稍后同步服务器');
      return local;
    }
  }

  isLoadingFromServer = true;
  try {
    const serverData: InstantProjectData = {
      instantCharacters: [],
      instantScenes: [],
      instantSegments: [],
    };

    // 1. 加载项目全局数据（片段）
    const projectDataRes = await localApi.getProjectData(projectId, 'instant');
    if (projectDataRes.success && (projectDataRes.data as any)?.projectData) {
      const projectData = (projectDataRes.data as any).projectData;
      serverData.instantSegments = projectData.data?.instantSegments || [];
    }

    // 2. 加载资产数据（角色和场景的完整定义）— 与短剧剧本创作保持一致
    let assetsLoaded = false;
    try {
      const assetsRes = await localApi.getProjectAssets(projectId, 'instant');
      if (assetsRes.success && assetsRes.data?.data) {
        const assets = assetsRes.data.data;
        // 检查资产表数据是否为完整定义（新格式），而非仅图片资源（旧格式）
        const hasFullCharacters = Array.isArray(assets.instantCharacters) &&
          assets.instantCharacters.length > 0 &&
          assets.instantCharacters[0]?.name !== undefined;
        const hasFullScenes = Array.isArray(assets.instantScenes) &&
          assets.instantScenes.length > 0 &&
          assets.instantScenes[0]?.name !== undefined;

        if (hasFullCharacters) {
          serverData.instantCharacters = assets.instantCharacters;
        }
        if (hasFullScenes) {
          serverData.instantScenes = assets.instantScenes;
        }
        assetsLoaded = hasFullCharacters || hasFullScenes;
      }
    } catch (e) {
      console.warn('[instantSync] 加载资产数据失败:', e);
    }


    // 4. 合并本地任务状态字段（videoTaskId / videoJobId 等）— 服务器可能不保存这些临时字段
    const localData = loadInstantData(projectId);
    if (localData?.instantSegments) {
      const localSegMap = new Map(localData.instantSegments.map((s) => [s.id, s]));
      serverData.instantSegments = serverData.instantSegments.map((seg) => {
        const localSeg = localSegMap.get(seg.id);
        if (!localSeg) return seg;
        const localItemMap = new Map((localSeg.canvasItems || []).map((item) => [item.id, item]));
        return {
          ...seg,
          canvasItems: (seg.canvasItems || []).map((item) => {
            const localItem = localItemMap.get(item.id);
            if (!localItem) return item;
            return {
              ...item,
              videoTaskId: localItem.videoTaskId ?? item.videoTaskId,
              videoJobId: localItem.videoJobId ?? item.videoJobId,
              videoUrl: localItem.videoUrl ?? item.videoUrl,
              videoUrls: localItem.videoUrls ?? item.videoUrls,
              currentVideoIndex: localItem.currentVideoIndex ?? item.currentVideoIndex,
              isGeneratingVideo: localItem.isGeneratingVideo ?? item.isGeneratingVideo,
              videoGenerationFailed: localItem.videoGenerationFailed ?? item.videoGenerationFailed,
            };
          }),
        };
      });
    }

    // 5. 保存到本地缓存并清除脏标记（服务器数据已是最新）
    const key = getInstantDataKey(projectId);
    userStorage.setItem(key, JSON.stringify(serverData));
    clearInstantDirty(projectId);
    console.log('[instantSync] 已从服务器加载并缓存到本地，脏标记已清除');

    return serverData;
  } catch (e) {
    console.error('[instantSync] 从服务器加载失败:', e);
    return null;
  } finally {
    // 延迟重置标记，确保 subscribe 不会触发
    setTimeout(() => {
      isLoadingFromServer = false;
    }, 100);
  }
}

/** 保存即时创作数据到服务器 */
export async function saveInstantToServer(
  projectId: string,
  data: InstantProjectData,
): Promise<boolean> {
  if (!projectId || projectId === 'default') return false;
  if (!hasValidInstantData(data)) {
    console.log('[instantSync] 数据为空，跳过保存');
    return false;
  }

  // 在保存开始前捕获脏标记时间戳，用于检测保存期间是否有新的修改
  const markBeforeSave = readInstantDirtyMark(projectId);

  // 1. 保存资产数据（角色和场景的完整定义）— 与短剧剧本创作保持一致
  // 调试：确认发送给后端的角色数据结构
  try {
    console.log(
      '[saveInstantToServer] sending instantCharacters sample:',
      (data.instantCharacters || []).map((c: any) => ({
        id: c.id,
        avatarImages: c.avatarImages?.map((img: any) => ({
          imageUrl: img.imageUrl,
          assetId: img.assetId,
          id: img.id,
        })),
        portraitImages: c.portraitImages?.map((img: any) => ({
          imageUrl: img.imageUrl,
          assetId: img.assetId,
          id: img.id,
        })),
      })),
    );
  } catch (e) {
    console.log('[saveInstantToServer] log error', e);
  }

  const assetsResult = await saveWithRetry('资产数据', () =>
    localApi.saveProjectAssets(projectId, {
      category: 'instant',
      data: {
        instantCharacters: data.instantCharacters || [],
        instantScenes: data.instantScenes || [],
      },
    }),
  );

  if (!assetsResult) {
    console.warn('[instantSync] 资产数据保存失败，中止保存');
    return false;
  }

  // 2. 保存项目全局数据（仅片段，角色/场景已迁移到资产表）
  const projectDataResult = await saveWithRetry('项目数据', () =>
    localApi.saveProjectData(projectId, {
      category: 'instant',
      data: {
        instantSegments: data.instantSegments,
      },
    }),
  );

  if (!projectDataResult) {
    console.warn('[instantSync] 项目数据保存失败');
    return false;
  }

  // 保存成功后直接清除本地脏标记
  clearInstantDirty(projectId);
  console.log('[instantSync] 数据已保存到服务器，脏标记已清除');
  return true;
}

/** 获取本地存储 key */
function getInstantDataKey(projectId: string): string {
  return `shotlib_workflow_drama_instant_${projectId}`;
}

/** 创建防抖保存函数 */
export function createDebouncedSave(delay = 2000) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingData: { projectId: string; data: InstantProjectData } | null = null;

  return (projectId: string, data: InstantProjectData) => {
    if (isLoadingFromServer) return;

    pendingData = { projectId, data };

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (pendingData) {
        saveInstantToServer(pendingData.projectId, pendingData.data);
        pendingData = null;
      }
    }, delay);
  };
}

/** 检查是否正在从服务器加载 */
export function getIsLoadingFromServer(): boolean {
  return isLoadingFromServer;
}
