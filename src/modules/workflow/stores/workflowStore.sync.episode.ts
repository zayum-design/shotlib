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
 * workflowStore.sync.episode.ts — 分集数据后端操作
 */
import { localApi } from '@/storage';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { getEpisodeDataKey } from '../utils/workflowUtils';

/** 自动创建后端分集（如果不存在） */
export async function ensureDramaEpisode(
  projectId: string,
  episodeNumber: number
): Promise<string | null> {
  try {
    const listRes = await localApi.getDramaEpisodes(projectId);
    if (listRes.success && Array.isArray(listRes.data)) {
      const existing = (listRes.data as any[]).find((ep: any) => ep.episode_number === episodeNumber);
      if (existing?.id) {
        console.log(`[workflowStore] 分集已存在: episodeNumber=${episodeNumber}, id=${existing.id}`);
        return existing.id;
      }
    }

    const createRes = await localApi.createDramaEpisode({
      project_id: projectId,
      episode_number: episodeNumber,
      title: `第${episodeNumber}集`,
    });
    if (createRes.success && createRes.data?.id) {
      console.log(`[workflowStore] 自动创建分集成功: episodeNumber=${episodeNumber}, id=${createRes.data.id}`);
      return createRes.data.id;
    }
  } catch (e) {
    console.error('[workflowStore] ensureDramaEpisode failed:', e);
  }
  return null;
}

/** 从后端加载指定分集数据 */
export async function loadDramaEpisodeFromServer(episodeId: string): Promise<Record<string, any> | null> {
  if (!episodeId) return null;
  try {
    const response = await localApi.getDramaEpisode(episodeId);
    if (response.success && response.data?.episodeData) {
      return response.data.episodeData.data || {};
    }
  } catch (e) {
    console.error('[workflowStore] load drama episode data failed:', e);
  }
  return null;
}

/** 从后端加载所有分集数据到 localStorage */
export async function loadAllEpisodesFromServer(projectId: string): Promise<number> {
  if (!projectId || projectId === 'default') {
    console.log('[workflowStore] loadAllEpisodesFromServer: 无效 projectId');
    return 0;
  }
  let loadedCount = 0;
  try {
    const listRes = await localApi.getDramaEpisodes(projectId);
    if (!listRes.success || !Array.isArray(listRes.data)) {
      console.log('[workflowStore] 后端无分集数据，跳过全量加载');
      return 0;
    }
    const dramaEpisodes = listRes.data as any[];
    console.log(`[workflowStore] 开始加载 ${dramaEpisodes.length} 个分集数据...`);
    for (const ep of dramaEpisodes) {
      const epNumber = ep.episode_number;
      const epId = ep.id;
      if (!epId || typeof epNumber !== 'number') continue;
      try {
        const epData = await loadDramaEpisodeFromServer(epId);
        if (epData && Object.keys(epData).length > 0) {
          const epKey = getEpisodeDataKey(projectId, epNumber);
          userStorage.setItem(epKey, JSON.stringify(epData));
          loadedCount++;
        }
      } catch (e) {
        console.warn(`[workflowStore] 加载第${epNumber}集数据失败:`, e);
      }
    }
    console.log(`[workflowStore] 全量加载完成: ${loadedCount}/${dramaEpisodes.length} 个分集`);
  } catch (e) {
    console.error('[workflowStore] loadAllEpisodesFromServer failed:', e);
  }
  return loadedCount;
}
