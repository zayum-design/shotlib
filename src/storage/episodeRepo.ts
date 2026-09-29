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
 * episodeRepo.ts — 短剧分集仓储
 *
 * 分集行存 `episode:{projectId}`,分集数据存 `episodedata:{projectId}:{episodeId}`。
 * 无乐观锁:保存直接覆盖,version 仅自增展示。
 */
import { idbGet, idbSet, idbDel, idbKeys } from './db';
import { stripBase64Fields } from './serialize';
import type {
  DramaEpisode,
  DramaEpisodeData,
  CreateDramaEpisodeRequest,
  UpdateDramaEpisodeRequest,
  Episode,
  EpisodeData,
  ApiResult,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

async function loadEpisodes(projectId: string): Promise<DramaEpisode[]> {
  return (await idbGet<DramaEpisode[]>(`episode:${projectId}`)) || [];
}

async function saveEpisodes(projectId: string, episodes: DramaEpisode[]): Promise<void> {
  await idbSet(`episode:${projectId}`, episodes);
}

const EPISODEDATA_PREFIX = 'episodedata:';

export const episodeRepo = {
  async list(projectId: string): Promise<ApiResult<DramaEpisode[]>> {
    const episodes = await loadEpisodes(projectId);
    episodes.sort((a, b) => a.episode_number - b.episode_number);
    return { success: true, data: episodes };
  },

  /** 获取分集详情 + 分集数据(scenes 为老后端"场景表"形状,本地恒为空数组) */
  async get(episodeId: string): Promise<
    ApiResult<{ episode: DramaEpisode; episodeData: DramaEpisodeData | null; scenes: Episode[] }>
  > {
    // episodeId 全局唯一,遍历各项目索引查找(项目数量有限,可接受)
    const allProjectKeys = await idbKeys('episode:');
    for (const key of allProjectKeys) {
      const episodes = (await idbGet<DramaEpisode[]>(key)) || [];
      const episode = episodes.find((e) => e.id === episodeId);
      if (episode) {
        const episodeData =
          (await idbGet<DramaEpisodeData>(`${EPISODEDATA_PREFIX}${episode.project_id}:${episodeId}`)) || null;
        return { success: true, data: { episode, episodeData, scenes: [] } };
      }
    }
    return {
      success: false,
      data: undefined as unknown as { episode: DramaEpisode; episodeData: DramaEpisodeData | null; scenes: Episode[] },
      message: '分集不存在',
    };
  },

  async create(req: CreateDramaEpisodeRequest): Promise<ApiResult<DramaEpisode>> {
    const episodes = await loadEpisodes(req.project_id);
    if (episodes.some((e) => e.episode_number === req.episode_number)) {
      return {
        success: false,
        data: undefined as unknown as DramaEpisode,
        message: `第 ${req.episode_number} 集已存在`,
      };
    }
    const now = nowIso();
    const episode: DramaEpisode = {
      id: newId(),
      project_id: req.project_id,
      member_id: 0,
      episode_number: req.episode_number,
      title: req.title,
      status: 'draft',
      script: req.script,
      duration: req.duration || 0,
      cover_url: req.cover_url,
      scene_count: 0,
      created_at: now,
      updated_at: now,
    };
    episodes.push(episode);
    await saveEpisodes(req.project_id, episodes);
    return { success: true, data: episode };
  },

  async update(episodeId: string, req: UpdateDramaEpisodeRequest): Promise<ApiResult<DramaEpisode>> {
    const allProjectKeys = await idbKeys('episode:');
    for (const key of allProjectKeys) {
      const projectId = key.slice('episode:'.length);
      const episodes = (await idbGet<DramaEpisode[]>(key)) || [];
      const idx = episodes.findIndex((e) => e.id === episodeId);
      if (idx >= 0) {
        const updated: DramaEpisode = { ...episodes[idx], ...req, updated_at: nowIso() };
        episodes[idx] = updated;
        await saveEpisodes(projectId, episodes);
        return { success: true, data: updated };
      }
    }
    return { success: false, data: undefined as unknown as DramaEpisode, message: '分集不存在' };
  },

  async remove(episodeId: string): Promise<ApiResult<{ message: string }>> {
    const allProjectKeys = await idbKeys('episode:');
    for (const key of allProjectKeys) {
      const projectId = key.slice('episode:'.length);
      const episodes = (await idbGet<DramaEpisode[]>(key)) || [];
      const idx = episodes.findIndex((e) => e.id === episodeId);
      if (idx >= 0) {
        episodes.splice(idx, 1);
        await saveEpisodes(projectId, episodes);
        await idbDel(`${EPISODEDATA_PREFIX}${projectId}:${episodeId}`);
        return { success: true, data: { message: '已删除' } };
      }
    }
    return { success: true, data: { message: '分集不存在,视为已删除' } };
  },

  async saveData(episodeId: string, req: { data: Record<string, any> }): Promise<ApiResult<DramaEpisodeData>> {
    // 定位分集所属项目
    const allProjectKeys = await idbKeys('episode:');
    for (const key of allProjectKeys) {
      const projectId = key.slice('episode:'.length);
      const episodes = (await idbGet<DramaEpisode[]>(key)) || [];
      const episode = episodes.find((e) => e.id === episodeId);
      if (episode) {
        const dataKey = `${EPISODEDATA_PREFIX}${projectId}:${episodeId}`;
        const existing = await idbGet<DramaEpisodeData>(dataKey);
        const record: DramaEpisodeData = {
          id: existing?.id || `${episodeId}:data`,
          episode_id: episodeId,
          project_id: projectId,
          member_id: 0,
          data: stripBase64Fields(req.data),
          version: (existing?.version || 0) + 1,
          edit_count: (existing?.edit_count || 0) + 1,
          data_size: JSON.stringify(req.data || {}).length,
          updated_at: nowIso(),
        };
        await idbSet(dataKey, record);
        return { success: true, data: record };
      }
    }
    return { success: false, data: undefined as unknown as DramaEpisodeData, message: '分集不存在' };
  },

  /** 重排分集:按传入 id 顺序重排 episode_number(1 起) */
  async reorder(req: { project_id: string; episode_ids: string[] }): Promise<ApiResult<{ message: string }>> {
    const episodes = await loadEpisodes(req.project_id);
    const byId = new Map(episodes.map((e) => [e.id, e]));
    const reordered: DramaEpisode[] = [];
    req.episode_ids.forEach((id, i) => {
      const ep = byId.get(id);
      if (ep) {
        reordered.push({ ...ep, episode_number: i + 1, updated_at: nowIso() });
        byId.delete(id);
      }
    });
    // 未在列表中的分集按原序追加在尾部
    for (const ep of byId.values()) {
      reordered.push({ ...ep, episode_number: reordered.length + 1 });
    }
    await saveEpisodes(req.project_id, reordered);
    return { success: true, data: { message: '已重排' } };
  },

  /**
   * 兼容接口:老后端的"分集-场景关联"表(creator_drama_episode_scene)。
   * 开源版场景数据完整保存在分集 data 内,无需独立关联,恒返回成功。
   */
  async assignScenes(episodeId: string, _sceneIds: string[]): Promise<ApiResult<{ message: string }>> {
    void episodeId;
    void _sceneIds;
    return { success: true, data: { message: 'ok' } };
  },

  /** 供 AI/工作流层使用:按项目+集号获取或隐式创建分集行 */
  async ensure(projectId: string, episodeNumber: number, title?: string): Promise<DramaEpisode> {
    const episodes = await loadEpisodes(projectId);
    const existing = episodes.find((e) => e.episode_number === episodeNumber);
    if (existing) return existing;
    const res = await episodeRepo.create({
      project_id: projectId,
      episode_number: episodeNumber,
      title: title || `第 ${episodeNumber} 集`,
    });
    if (!res.success) {
      // 并发创建竞态兜底:重新查找
      const again = (await loadEpisodes(projectId)).find((e) => e.episode_number === episodeNumber);
      if (again) return again;
      throw new Error(res.message || '创建分集失败');
    }
    return res.data;
  },

  /** 项目级联删除时按项目清理 */
  async purgeByProject(projectId: string): Promise<void> {
    const episodes = await loadEpisodes(projectId);
    await Promise.all(episodes.map((e) => idbDel(`${EPISODEDATA_PREFIX}${projectId}:${e.id}`)));
    await idbDel(`episode:${projectId}`);
  },
};
