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
 * projectSync.types.ts — 兼容出口
 *
 * 类型真源已迁至 src/storage/types.ts(本地仓储层)。
 * 保留本文件使迁移中的业务代码 import 路径不变;清理阶段统一改路径后移除。
 */
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
  ApiResult as ControllerResponse,
} from '@/storage/types';
