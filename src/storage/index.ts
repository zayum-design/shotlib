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
 * index.ts — 本地仓储层聚合出口
 *
 * 聚合各仓储(repo)并以 localApi 门面暴露 drama 业务所需子集,
 * 方法名/参数/返回形状与原服务端版 projectSyncApi 保持一致。
 */
import { projectRepo } from './projectRepo';
import { episodeRepo } from './episodeRepo';
import { assetRepo } from './assetRepo';
import { imageRepo } from './imageRepo';
import { settingsRepo } from './settingsRepo';
import { exportProject, importProject } from './exportImport';
import type { ImageAssetRecord } from './types';
import type { AppSettings } from './settingsRepo';

export { projectRepo, episodeRepo, assetRepo, imageRepo, settingsRepo, exportProject, importProject };
export { stripBase64Fields } from './serialize';
export { idbGet, idbSet, idbDel, idbKeys, idbDelByPrefix, idbDump, idbRestore, idbClearAll } from './db';
export type { ImageAssetRecord };
export type {
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectData,
  SaveProjectDataRequest,
  Episode,
  EpisodeData,
  UserPreference,
  SaveUserPreferenceRequest,
  ProjectAsset,
  SaveProjectAssetRequest,
  ProjectAssetItem,
  BulkSaveProjectAssetsRequest,
  DramaEpisode,
  DramaEpisodeData,
  CreateDramaEpisodeRequest,
  UpdateDramaEpisodeRequest,
  SaveDramaEpisodeDataRequest,
  ReorderDramaEpisodesRequest,
  ApiResult,
} from './types';
export type { AppSettings, ProxyMode, OssConfig } from './settingsRepo';

/**
 * 本地 API 门面:方法名/参数/返回形状沿用原服务端版 projectSyncApi 的 drama 子集,
 * 业务代码零改动完成了从 REST 到本地 IndexedDB 的切换。
 */
export const localApi = {
  // ---------- image_asset data 缓存 ----------

  getCachedImageData(assetId: string): Record<string, any> | undefined {
    return imageRepo.getCachedImageData(assetId);
  },

  clearProjectCache(): void {
    imageRepo.clearProjectCache();
    imageRepo.revokeAll();
  },

  invalidateCachedImageData(assetId: string): void {
    imageRepo.invalidateCachedImageData(assetId);
  },

  // ---------- Projects ----------

  async getProjects(status?: 'active' | 'trashed') {
    return projectRepo.list(status);
  },

  async getProjectStats(ids: string[]) {
    return projectRepo.getStats(ids);
  },

  async createProject(req: import('./types').CreateProjectRequest) {
    return projectRepo.create(req);
  },

  async updateProject(projectId: string, req: import('./types').UpdateProjectRequest) {
    return projectRepo.update(projectId, req);
  },

  async deleteProject(projectId: string) {
    return projectRepo.softDelete(projectId);
  },

  async restoreProject(projectId: string) {
    return projectRepo.restore(projectId);
  },

  async purgeProject(projectId: string) {
    await episodeRepo.purgeByProject(projectId);
    await assetRepo.purgeByProject(projectId);
    await imageRepo.purgeByProject(projectId);
    return projectRepo.purge(projectId);
  },

  /** 清空项目全部数据(分集/资产/图片)但保留项目行 —— 导入前清场用 */
  async clearProjectData(projectId: string) {
    await episodeRepo.purgeByProject(projectId);
    await assetRepo.purgeByProject(projectId);
    await imageRepo.purgeByProject(projectId);
  },

  // ---------- Project Data ----------

  async getProjectData(projectId: string, category?: string) {
    return projectRepo.getData(projectId, category);
  },

  async saveProjectData(projectId: string, req: import('./types').SaveProjectDataRequest) {
    return projectRepo.saveData(projectId, req);
  },

  // ---------- Drama Episodes ----------

  async getDramaEpisodes(projectId: string) {
    return episodeRepo.list(projectId);
  },

  async getDramaEpisode(episodeId: string) {
    return episodeRepo.get(episodeId);
  },

  async createDramaEpisode(req: import('./types').CreateDramaEpisodeRequest) {
    return episodeRepo.create(req);
  },

  async updateDramaEpisode(episodeId: string, req: import('./types').UpdateDramaEpisodeRequest) {
    return episodeRepo.update(episodeId, req);
  },

  async deleteDramaEpisode(episodeId: string) {
    return episodeRepo.remove(episodeId);
  },

  async saveDramaEpisodeData(episodeId: string, req: import('./types').SaveDramaEpisodeDataRequest) {
    void req.expectedVersion; // 本地存储无乐观锁,兼容保留字段
    return episodeRepo.saveData(episodeId, req);
  },

  async reorderDramaEpisodes(req: import('./types').ReorderDramaEpisodesRequest) {
    return episodeRepo.reorder(req);
  },

  async assignScenesToEpisode(episodeId: string, sceneIds: string[]) {
    return episodeRepo.assignScenes(episodeId, sceneIds);
  },

  // ---------- Project Assets(整包) ----------

  async getProjectAssets(projectId: string, category?: string, episode_number?: number) {
    return assetRepo.getBundle(projectId, category, episode_number);
  },

  async saveProjectAssets(projectId: string, req: import('./types').SaveProjectAssetRequest) {
    return assetRepo.saveBundle(projectId, req);
  },

  async deleteProjectAssets(projectId: string, category?: string, episode_number?: number) {
    return assetRepo.deleteBundle(projectId, category, episode_number);
  },

  // ---------- Project Assets(按行) ----------

  async listProjectAssets(projectId: string, categories?: string, episode_number?: number) {
    return assetRepo.listRows(projectId, categories, episode_number);
  },

  async bulkSaveProjectAssets(projectId: string, req: import('./types').BulkSaveProjectAssetsRequest) {
    return assetRepo.bulkSaveRows(projectId, req);
  },

  async deleteProjectAsset(projectId: string, category: string, asset_key: string, episode_number?: number) {
    return assetRepo.deleteRow(projectId, category, asset_key, episode_number);
  },

  // ---------- Image Assets ----------

  async createImageAssets(projectId: string, req: { assets: any[] }) {
    return imageRepo.create(projectId, req);
  },

  async resolveImageAssets(projectId: string, req: { asset_ids: string[] }) {
    return imageRepo.resolve(projectId, req);
  },

  async listImageAssets(projectId: string, filters?: { episode_number?: number; asset_type?: string }) {
    return imageRepo.list(projectId, filters);
  },

  async uploadImageAsset(projectId: string, formData: FormData) {
    return imageRepo.upload(projectId, formData);
  },

  async patchImageAssetData(projectId: string, assetKey: string, patch: Record<string, any>) {
    return imageRepo.patchData(projectId, assetKey, patch);
  },

  // ---------- 用户偏好 ----------

  async getUserPreference() {
    return settingsRepo.getPreference();
  },

  async saveUserPreference(req: import('./types').SaveUserPreferenceRequest) {
    return settingsRepo.savePreference(req);
  },

  // ---------- 设置(开源版新增) ----------

  async getAppSettings(): Promise<AppSettings> {
    return settingsRepo.get();
  },

  async saveAppSettings(patch: Partial<AppSettings>) {
    return settingsRepo.save(patch);
  },

  // ---------- 导出/导入 ----------

  async exportProject(projectId: string) {
    return exportProject(projectId);
  },

  async importProject(bundle: Parameters<typeof importProject>[0]) {
    return importProject(bundle);
  },
};
