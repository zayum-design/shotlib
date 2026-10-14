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
 * projectStats.ts — 首页项目卡片统计(纯本地版)
 *
 * 参照云端版 getProjectStats 的返回形状,数据源改为浏览器本地存储:
 * - 剧本模式:分集列表(shotlib_episode_list_{id}) + 项目资产(shotlib_workflow_{id}_assets)
 *   + 各分集数据(shotlib_workflow_{id}_episode_{n},取片段数)
 * - 即时创作:即时数据(shotlib_workflow_drama_instant_{id},角色/场景/画布分镜)
 */

export interface ProjectStats {
  characterCount: number;
  sceneCount: number;
  /** 片段数(剧本模式为各分集片段之和;即时创作画布分镜不计入) */
  segmentCount: number;
  audioCount: number;
  hasData: boolean;
}

const EMPTY_STATS: ProjectStats = {
  characterCount: 0,
  sceneCount: 0,
  segmentCount: 0,
  audioCount: 0,
  hasData: false,
};

/** 结果缓存(会话内);项目打开/保存后由调用方失效 */
const statsCache = new Map<string, ProjectStats>();

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 剧本模式统计 */
function loadScriptStats(projectId: string): ProjectStats {
  const episodeList = readJson<number[]>(`shotlib_episode_list_${projectId}`) || [];
  const assets = readJson<any>(`shotlib_workflow_${projectId}_assets`) || {};

  let characterCount = Array.isArray(assets.characters) ? assets.characters.length : 0;
  let sceneCount = Array.isArray(assets.scenes) ? assets.scenes.length : 0;
  const audioCount = Array.isArray(assets.audioAssets) ? assets.audioAssets.length : 0;

  // 片段数:各分集 episodes 之和;角色/场景缺失时从第一个非空分集回填
  let segmentCount = 0;
  for (const epNum of episodeList) {
    const epData = readJson<any>(`shotlib_workflow_${projectId}_episode_${epNum}`);
    if (!epData) continue;
    if (Array.isArray(epData.episodes)) segmentCount += epData.episodes.length;
    if (characterCount === 0 && Array.isArray(epData.characters)) {
      characterCount = epData.characters.length;
    }
    if (sceneCount === 0 && Array.isArray(epData.scenes)) {
      sceneCount = epData.scenes.length;
    }
  }

  return {
    characterCount,
    sceneCount,
    segmentCount,
    audioCount,
    hasData: characterCount + sceneCount + segmentCount + audioCount > 0,
  };
}

/** 即时创作统计 */
function loadInstantStats(projectId: string): ProjectStats {
  const data = readJson<any>(`shotlib_workflow_drama_instant_${projectId}`) || {};
  const characterCount = Array.isArray(data.instantCharacters) ? data.instantCharacters.length : 0;
  const sceneCount = Array.isArray(data.instantScenes) ? data.instantScenes.length : 0;
  const segmentCount = Array.isArray(data.instantSegments)
    ? data.instantSegments.reduce(
        (sum: number, seg: any) => sum + (Array.isArray(seg?.canvasItems) ? seg.canvasItems.length : 0),
        0,
      )
    : 0;
  return {
    characterCount,
    sceneCount,
    segmentCount,
    audioCount: 0,
    hasData: characterCount + sceneCount + segmentCount > 0,
  };
}

/** 批量加载项目统计(带会话缓存) */
export async function loadProjectsStats(
  projects: Array<{ id: string; type: string }>,
  force = false,
): Promise<Record<string, ProjectStats>> {
  const map: Record<string, ProjectStats> = {};
  for (const p of projects) {
    if (!force && statsCache.has(p.id)) {
      map[p.id] = statsCache.get(p.id)!;
      continue;
    }
    const stats = p.type === 'instant' ? loadInstantStats(p.id) : loadScriptStats(p.id);
    statsCache.set(p.id, stats);
    map[p.id] = stats;
  }
  return map;
}

/** 项目数据变化后失效缓存(打开项目返回首页时刷新统计) */
export function invalidateProjectStats(projectId?: string): void {
  if (projectId) statsCache.delete(projectId);
  else statsCache.clear();
}
