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
 * assetRepo.ts — 项目资产仓储
 *
 * 两种存取形态(与原后端一致):
 * - 整包(KV):`assets:{projectId}:{category}` → 一个 ProjectAsset,适合 characters/scenes 等整读整写
 * - 按行:`assetrows:{projectId}` → ProjectAsset[],upsert by (category, asset_key, episode_number)
 *
 * category='image_asset' 的行只存元信息索引,图片二进制在 imageRepo(按 assetKey 关联)。
 */
import { idbGet, idbSet, idbDel, idbDelByPrefix } from './db';
import { stripBase64Fields } from './serialize';
import { imageRepo } from './imageRepo';
import type {
  ProjectAsset,
  SaveProjectAssetRequest,
  ProjectAssetItem,
  BulkSaveProjectAssetsRequest,
  ApiResult,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

function bundleKey(projectId: string, category: string): string {
  return `assets:${projectId}:${category}`;
}

const ROWS_PREFIX = 'assetrows:';

function rowMatches(row: ProjectAsset, category: string, asset_key: string, episode_number?: number): boolean {
  return (
    row.category === category &&
    row.asset_key === asset_key &&
    (episode_number === undefined || (row.episode_number ?? 0) === episode_number)
  );
}

export const assetRepo = {
  // ---------- 整包形态 ----------

  async getBundle(projectId: string, category?: string, episode_number?: number): Promise<ApiResult<ProjectAsset | null>> {
    if (!category) return { success: true, data: null };
    // 带集号的整包在 key 上追加集号段(与后端"按行+集号过滤"语义对齐的本地简化)
    const key = episode_number !== undefined ? `${bundleKey(projectId, category)}:ep${episode_number}` : bundleKey(projectId, category);
    const record = await idbGet<ProjectAsset>(key);
    return { success: true, data: record || null };
  },

  async saveBundle(projectId: string, req: SaveProjectAssetRequest): Promise<ApiResult<ProjectAsset>> {
    const key =
      req.episode_number !== undefined
        ? `${bundleKey(projectId, req.category)}:ep${req.episode_number}`
        : bundleKey(projectId, req.category);
    const existing = await idbGet<ProjectAsset>(key);
    const record: ProjectAsset = {
      id: existing?.id || `${projectId}:${req.category}${req.episode_number !== undefined ? `:ep${req.episode_number}` : ''}`,
      project_id: projectId,
      member_id: 0,
      category: req.category,
      episode_number: req.episode_number,
      data: stripBase64Fields(req.data),
      version: (existing?.version || 0) + 1,
      data_size: JSON.stringify(req.data || {}).length,
      created_at: existing?.created_at || nowIso(),
      updated_at: nowIso(),
    };
    await idbSet(key, record);
    return { success: true, data: record };
  },

  async deleteBundle(projectId: string, category?: string, episode_number?: number): Promise<ApiResult<{ message: string }>> {
    if (category) {
      const key =
        episode_number !== undefined
          ? `${bundleKey(projectId, category)}:ep${episode_number}`
          : bundleKey(projectId, category);
      await idbDel(key);
    } else {
      await idbDelByPrefix(`assets:${projectId}:`);
    }
    return { success: true, data: { message: '已删除' } };
  },

  // ---------- 按行形态 ----------

  async listRows(projectId: string, categories?: string, episode_number?: number): Promise<ApiResult<ProjectAsset[]>> {
    let rows = (await idbGet<ProjectAsset[]>(`${ROWS_PREFIX}${projectId}`)) || [];
    if (categories) {
      const set = new Set(categories.split(','));
      rows = rows.filter((r) => set.has(r.category));
    }
    if (episode_number !== undefined) {
      rows = rows.filter((r) => (r.episode_number ?? 0) === episode_number);
    }
    return { success: true, data: rows };
  },

  async bulkSaveRows(projectId: string, req: BulkSaveProjectAssetsRequest): Promise<ApiResult<ProjectAsset[]>> {
    const rows = (await idbGet<ProjectAsset[]>(`${ROWS_PREFIX}${projectId}`)) || [];
    const saved: ProjectAsset[] = [];
    for (const item of req.assets) {
      const idx = rows.findIndex((r) => rowMatches(r, item.category, item.asset_key, item.episode_number));
      const cleaned = { ...item, data: stripBase64Fields(item.data) } as ProjectAssetItem;
      if (idx >= 0) {
        const updated: ProjectAsset = {
          ...rows[idx],
          data: cleaned.data,
          episode_number: item.episode_number,
          version: rows[idx].version + 1,
          updated_at: nowIso(),
        };
        rows[idx] = updated;
        saved.push(updated);
      } else {
        const created: ProjectAsset = {
          id: item.id || crypto.randomUUID(),
          project_id: projectId,
          member_id: 0,
          category: item.category,
          asset_key: item.asset_key,
          episode_number: item.episode_number,
          data: cleaned.data,
          version: 1,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        rows.push(created);
        saved.push(created);
      }
    }
    await idbSet(`${ROWS_PREFIX}${projectId}`, rows);
    return { success: true, data: saved };
  },

  async deleteRow(
    projectId: string,
    category: string,
    asset_key: string,
    episode_number?: number,
  ): Promise<ApiResult<{ message: string }>> {
    // image_asset 行与 blob 记录联动删除
    if (category === 'image_asset') {
      await imageRepo.remove(projectId, asset_key);
    }
    const rows = (await idbGet<ProjectAsset[]>(`${ROWS_PREFIX}${projectId}`)) || [];
    const filtered = rows.filter((r) => !rowMatches(r, category, asset_key, episode_number));
    await idbSet(`${ROWS_PREFIX}${projectId}`, filtered);
    return { success: true, data: { message: '已删除' } };
  },

  /** 项目级联删除时按项目清理 */
  async purgeByProject(projectId: string): Promise<void> {
    await idbDelByPrefix(`assets:${projectId}:`);
    await idbDel(`${ROWS_PREFIX}${projectId}`);
  },
};
