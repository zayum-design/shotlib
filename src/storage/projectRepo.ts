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
 * projectRepo.ts — 项目仓储(项目列表 + 项目数据 category KV)
 *
 * 软删除用 status 字段('active' | 'trashed')保持回收站 UX。
 */
import { idbGet, idbSet, idbDel, idbDelByPrefix } from './db';
import { stripBase64Fields } from './serialize';
import type {
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectData,
  SaveProjectDataRequest,
  ProjectAsset,
  DramaEpisode,
  ApiResult,
} from './types';

const PROJECTS_KEY = 'projects';

// ---------- 项目列表 ----------

async function loadAll(): Promise<Project[]> {
  return (await idbGet<Project[]>(PROJECTS_KEY)) || [];
}

async function saveAll(projects: Project[]): Promise<void> {
  await idbSet(PROJECTS_KEY, projects);
}

function nowIso(): string {
  return new Date().toISOString();
}

export const projectRepo = {
  async list(status?: 'active' | 'trashed'): Promise<ApiResult<Project[]>> {
    const all = await loadAll();
    const list = status ? all.filter((p) => (p.status || 'active') === status) : all;
    return { success: true, data: list };
  },

  async get(projectId: string): Promise<Project | undefined> {
    const all = await loadAll();
    return all.find((p) => p.id === projectId);
  },

  async create(req: CreateProjectRequest): Promise<ApiResult<Project>> {
    const all = await loadAll();
    if (all.some((p) => p.id === req.id)) {
      return { success: false, data: undefined as unknown as Project, message: '项目 ID 已存在' };
    }
    const now = nowIso();
    const project: Project = {
      id: req.id,
      member_id: 0,
      name: req.name,
      category: req.category,
      type: req.type,
      aspect_ratio: req.aspect_ratio,
      description: req.description,
      cover_url: req.cover_url,
      status: 'active',
      episode_count: 0,
      created_at: now,
      updated_at: now,
    };
    all.push(project);
    await saveAll(all);
    return { success: true, data: project };
  },

  async update(projectId: string, req: UpdateProjectRequest): Promise<ApiResult<Project>> {
    const all = await loadAll();
    const idx = all.findIndex((p) => p.id === projectId);
    if (idx < 0) {
      return { success: false, data: undefined as unknown as Project, message: '项目不存在' };
    }
    const updated: Project = { ...all[idx], ...req, updated_at: nowIso() };
    all[idx] = updated;
    await saveAll(all);
    return { success: true, data: updated };
  },

  /** 软删除(进回收站) */
  async softDelete(projectId: string): Promise<ApiResult<{ message: string }>> {
    const res = await projectRepo.update(projectId, { status: 'trashed' });
    return res.success
      ? { success: true, data: { message: '已移入回收站' } }
      : { success: false, data: { message: res.message || '删除失败' }, message: res.message };
  },

  async restore(projectId: string): Promise<ApiResult<Project>> {
    return projectRepo.update(projectId, { status: 'active' });
  },

  /** 彻底删除:级联清理分集、项目数据、资产、图片资产 */
  async purge(projectId: string): Promise<ApiResult<{ message: string }>> {
    const all = await loadAll();
    const idx = all.findIndex((p) => p.id === projectId);
    if (idx < 0) {
      return { success: true, data: { message: '项目不存在,视为已删除' } };
    }
    all.splice(idx, 1);
    await saveAll(all);
    // 级联清理各命名空间
    await idbDelByPrefix(`projectdata:${projectId}:`);
    await idbDelByPrefix(`episode:${projectId}`);
    await idbDelByPrefix(`episodedata:`); // episode key 含 projectId,由调用方按 episode 索引清理,此处兜底
    await idbDelByPrefix(`assets:${projectId}:`);
    await idbDelByPrefix(`assetrows:${projectId}`);
    await idbDelByPrefix(`imageasset:${projectId}:`);
    return { success: true, data: { message: '已彻底删除' } };
  },

  // ---------- 项目数据(category KV) ----------

  async getData(projectId: string, category?: string): Promise<ApiResult<ProjectData | null>> {
    if (!category) {
      // 不带 category 时返回默认 category(与后端行为对齐:业务总是显式传 category,此分支兜底)
      return { success: true, data: null };
    }
    const record = await idbGet<ProjectData>(`projectdata:${projectId}:${category}`);
    return { success: true, data: record || null };
  },

  async saveData(projectId: string, req: SaveProjectDataRequest): Promise<ApiResult<ProjectData>> {
    const key = `projectdata:${projectId}:${req.category}`;
    const existing = await idbGet<ProjectData>(key);
    const record: ProjectData = {
      id: existing?.id || `${projectId}:${req.category}`,
      project_id: projectId,
      member_id: 0,
      category: req.category,
      data: stripBase64Fields(req.data),
      version: (existing?.version || 0) + 1,
      edit_count: (existing?.edit_count || 0) + 1,
      data_size: JSON.stringify(req.data || {}).length,
      updated_at: nowIso(),
    };
    await idbSet(key, record);
    return { success: true, data: record };
  },

  /** 批量项目资产统计(项目卡片徽标) */
  async getStats(ids: string[]): Promise<
    ApiResult<Record<string, { characterCount: number; sceneCount: number; segmentCount: number; audioCount: number }>>
  > {
    const result: Record<
      string,
      { characterCount: number; sceneCount: number; segmentCount: number; audioCount: number }
    > = {};
    for (const projectId of ids) {
      const [characters, scenes, episodes] = await Promise.all([
        idbGet<ProjectAsset>(`assets:${projectId}:characters`),
        idbGet<ProjectAsset>(`assets:${projectId}:scenes`),
        idbGet<DramaEpisode[]>(`episode:${projectId}`),
      ]);
      const characterData = characters?.data as any;
      const sceneData = scenes?.data as any;
      result[projectId] = {
        characterCount: Array.isArray(characterData?.characters) ? characterData.characters.length : 0,
        sceneCount: Array.isArray(sceneData?.scenes) ? sceneData.scenes.length : 0,
        segmentCount: Array.isArray(episodes)
          ? episodes.reduce((sum: number, ep) => sum + (ep.scene_count || 0), 0)
          : 0,
        audioCount: 0, // 开源版无 TTS/音频资产
      };
    }
    return { success: true, data: result };
  },
};
