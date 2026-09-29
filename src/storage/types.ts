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
 * types.ts — 本地仓储层类型定义
 *
 * 镜像原后端契约(projectSync.types.ts),保持客户端模型形状不变,
 * 使业务代码从 API 切换到本地仓储时零结构改动。
 * member_id 字段保留但恒为 0(无登录体系,仅为形状兼容)。
 */

export interface Project {
  id: string;
  member_id: number;
  name: string;
  category: string;
  type?: string;
  aspect_ratio?: string;
  status?: string;
  episode_count?: number;
  total_duration?: number;
  cover_url?: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectRequest {
  id: string;
  name: string;
  category: string;
  type?: string;
  aspect_ratio?: string;
  description?: string;
  cover_url?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  aspect_ratio?: string;
  description?: string;
  cover_url?: string;
  status?: string;
}

export interface ProjectData {
  id: string;
  project_id: string;
  member_id: number;
  category: string;
  data: Record<string, any>;
  version: number;
  edit_count?: number;
  last_editor_id?: number;
  data_size?: number;
  updated_at: string;
}

export interface SaveProjectDataRequest {
  category: string;
  data: Record<string, any>;
}

export interface Episode {
  id: string;
  project_id: string;
  member_id: number;
  episode_number: number;
  title?: string;
  status: string;
  script?: string;
  duration: number;
  cover_url?: string;
  generation_job_id?: string;
  created_at: string;
  updated_at: string;
}

export interface EpisodeData {
  id: string;
  episode_id: string;
  project_id: string;
  member_id: number;
  data: Record<string, any>;
  version: number;
  edit_count?: number;
  last_editor_id?: number;
  data_size?: number;
  updated_at: string;
}

export interface CreateEpisodeRequest {
  episode_number: number;
  title?: string;
  script?: string;
  duration?: number;
  cover_url?: string;
}

export interface UpdateEpisodeRequest {
  title?: string;
  script?: string;
  duration?: number;
  cover_url?: string;
  status?: string;
}

export interface SaveEpisodeDataRequest {
  data: Record<string, any>;
}

export interface ReorderEpisodesRequest {
  episode_ids: string[];
}

export interface UserPreference {
  id: string;
  member_id: number;
  theme: string;
  settings: Record<string, any>;
  version?: number;
  edit_count?: number;
  updated_at: string;
}

export interface SaveUserPreferenceRequest {
  theme?: string;
  settings?: Record<string, any>;
}

export interface ProjectAsset {
  id: string;
  project_id: string;
  member_id: number;
  category: string;
  episode_number?: number;
  asset_key?: string;
  data: Record<string, any>;
  version: number;
  edit_count?: number;
  last_editor_id?: number;
  data_size?: number;
  created_at: string;
  updated_at: string;
}

export interface SaveProjectAssetRequest {
  category: string;
  data: Record<string, any>;
  episode_number?: number;
}

export interface ProjectAssetItem {
  id: string;
  category: string;
  asset_key: string;
  episode_number?: number;
  data: Record<string, any>;
}

export interface BulkSaveProjectAssetsRequest {
  assets: ProjectAssetItem[];
}

export interface DramaEpisode {
  id: string;
  project_id: string;
  member_id: number;
  episode_number: number;
  title?: string;
  status: string;
  script?: string;
  duration: number;
  cover_url?: string;
  scene_count?: number;
  generation_job_id?: string;
  created_at: string;
  updated_at: string;
}

export interface DramaEpisodeData {
  id: string;
  episode_id: string;
  project_id: string;
  member_id: number;
  data: Record<string, any>;
  version: number;
  edit_count?: number;
  last_editor_id?: number;
  data_size?: number;
  updated_at: string;
}

export interface CreateDramaEpisodeRequest {
  project_id: string;
  episode_number: number;
  title?: string;
  script?: string;
  duration?: number;
  cover_url?: string;
}

export interface UpdateDramaEpisodeRequest {
  title?: string;
  script?: string;
  duration?: number;
  cover_url?: string;
  status?: string;
}

export interface SaveDramaEpisodeDataRequest {
  data: Record<string, any>;
  /** 兼容保留:本地存储无乐观锁,该字段被忽略,保存总是直接覆盖 */
  expectedVersion?: number;
}

export interface ReorderDramaEpisodesRequest {
  project_id: string;
  episode_ids: string[];
}

/** 本地仓储层响应包装(与原 unpack() 输出形状一致) */
export interface ApiResult<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** image_asset 的本地存储记录(blob 与元信息一体) */
export interface ImageAssetRecord {
  id: string;
  projectId: string;
  episodeNumber?: number;
  assetType: string;
  /** 生成的图片二进制(生成的图存 blob;素材库引入的图只有 original_url) */
  blob?: Blob;
  mimeType?: string;
  /** 素材来源 URL(上传/素材库场景) */
  originalUrl?: string;
  /** 厂商生成结果的原始 URL(可能过期,仅作兜底展示) */
  remoteUrl?: string;
  status: string;
  metadata?: Record<string, any>;
  data: Record<string, any>;
  createdAt: string;
}
