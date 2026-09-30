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
 * workflowStore.storage.ts — 本地缓存操作（localStorage / IndexedDB）
 *
 * 核心原则：数据库为唯一真相源，本地缓存仅作降级使用。
 * - 保存：先写服务器，成功后更新缓存
 * - 加载：先读缓存秒开，后端数据到后覆盖
 * - 不做时间戳对比、不做 merge
 */
import { userStorage } from '@/shared/utils/userScopedStorage';
import { idbStorage } from '@/shared/utils/indexedDbStorage';
import { getProjectAssetsKey, getEpisodeDataKey, getScriptAssetKey } from '../utils/workflowUtils';
import type { WorkflowState } from './workflowStore';

/**
 * 项目数据字段（存储在 creator_project_data，跨分集共享）
 * 这些字段在新建分集时保持不变，不需要显式继承或重置。
 *
 * 注意：characters 和 scenes 虽然也是项目级（存储在 creator_drama_project_assets 按行），
 * 但不在此列表中，因为：
 * 1. 后端保存/加载通过独立的 saveCharacterSceneAssets / listProjectAssets 处理
 * 2. localStorage 缓存中 characters/scenes 写入项目级 key（与 PROJECT_DATA_FIELDS 同 key），
 *    但 extractProjectData 不提取它们——在 beforeunload 和 persistWorkflowState 中单独补充
 * 3. loadWorkflowFromCache 从项目级 key 中读取 characters/scenes（隐含约定）
 */
export const PROJECT_DATA_FIELDS = [
  'agentType', 'artStyle', 'artStylePromptHint', 'skills', 'genre', 'creationMode',
  'textModel', 'imageModel', 'videoModel', 'episodeMaxDuration', 'audioAssets',
  'sceneModel', 'eraModel', 'voiceModel',
  'era', 'relationshipNetwork',
] as const;

/**
 * 分集数据字段（存储在 creator_drama_episode_data.data，各集独立）
 *
 * 在分集操作时必须正确处理每个字段：
 * - 新建分集：isEnding=false, activeCharacterIds=[], activeSceneIds=[], 其余为默认值
 * - 切换分集：从目标分集数据加载
 * - 删除分集：后端软删除后重新加载目标分集
 */
export const EPISODE_DATA_FIELDS = [
  'currentStep', 'topic', 'previousEpisodeScript', 'previousEpisodeSummary', 'previousEpisodeFragments', 'summary', 'isEnding',
  'episodes', 'isSimplifiedMode', 'activeCharacterIds', 'activeSceneIds', 'activePropIds', 'composedVideoUrl',
] as const;

/** script 资产字段（存储在 creator_drama_project_assets 的 script 类别，按 episode_number 区分） */
export const SCRIPT_ASSET_FIELDS = ['script'] as const;

/** 从状态中提取项目数据（存入 creator_project_data） */
export function extractProjectData(state: WorkflowState): Record<string, any> {
  const assets: Record<string, any> = {};
  for (const key of PROJECT_DATA_FIELDS) {
    assets[key] = (state as any)[key];
  }
  return assets;
}

/** 从状态中提取分集数据 */
export function extractEpisodeData(state: WorkflowState, episodeNumberOverride?: number): Record<string, any> {
  const data: Record<string, any> = {};
  const episodeNumber = episodeNumberOverride ?? state.currentEpisodeNumber ?? 1;
  for (const key of EPISODE_DATA_FIELDS) {
    // 第1集不应该保存 previousEpisodeScript / previousEpisodeSummary / previousEpisodeFragments
    if ((key === 'previousEpisodeScript' || key === 'previousEpisodeSummary' || key === 'previousEpisodeFragments') && episodeNumber === 1) {
      continue;
    }
    data[key] = (state as any)[key];
  }
  // 清理 episodes 中的 loading 状态
  if (data.episodes && Array.isArray(data.episodes)) {
    data.episodes = data.episodes.map((ep: any) => {
      const isFailedVideo = ep.videoTaskStatus === 'failed';
      const hasPendingVideo = ep.videoTaskId && !ep.generatedVideoUrl && !isFailedVideo;
      // 剔除首尾帧图 URL（运行时由 hydrate 从 firstFrameImageAssetId/lastFrameImageAssetId 还原，不持久化）
      const { firstFrameImageUrl: _fUrl, lastFrameImageUrl: _lUrl, ...cleaned } = {
        ...ep,
        isGenerating: hasPendingVideo ? ep.isGenerating : false,
        videoGenerationProgress: hasPendingVideo ? ep.videoGenerationProgress : 0,
        isGeneratingFirstFrame: false,
        isGeneratingLastFrame: false,
        isExpandingFirstFrame: false,
        isExpandingLastFrame: false,
      };
      void _fUrl; void _lUrl;
      // 已失败的视频：清除 videoTaskId，保留 videoTaskStatus 供 UI 展示
      if (isFailedVideo) {
        cleaned.videoTaskId = undefined;
      }
      if (cleaned.shots && Array.isArray(cleaned.shots)) {
        cleaned.shots = cleaned.shots.map((shot: any) => ({
          ...shot,
          isGeneratingReferenceImage: false,
        }));
      }
      return cleaned;
    });
  }
  return data;
}

/**
 * 递归剔除对象中的 base64 data URI（体积太大，不适合存 localStorage）
 */
export function stripBase64Fields(obj: any): any {
  if (typeof obj === 'string' && obj.startsWith('data:')) {
    return '';
  }
  if (Array.isArray(obj)) {
    return obj.map(stripBase64Fields);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      result[key] = stripBase64Fields(obj[key]);
    }
    return result;
  }
  return obj;
}

/**
 * 剔除角色对象中的图片 URL，仅保留 assetId（image_asset UUID）等元数据。
 * 图片 URL 运行时由 hydrate 从 image_asset 还原，不持久化到 character 行。
 */
export function stripCharacterImageUrls(character: any): any {
  if (!character || typeof character !== 'object') return character;
  const stripImages = (images: any[] | undefined) => {
    if (!Array.isArray(images)) return images;
    return images.map((img) => {
      if (!img || typeof img !== 'object') return img;
      // 剔除 imageUrl（由 hydrate 从 image_asset 还原）、seedance（历史遗留字段）与
      // isGenerating（会话内瞬时状态，持久化会导致加载永久 loading）
      const { imageUrl, seedance, isGenerating, ...rest } = img;
      void imageUrl; void seedance; void isGenerating;
      return rest;
    });
  };
  const { avatarUrls, fullBodyUrls, isGeneratingAvatar, isGeneratingViews, ...rest } = character;
  void isGeneratingAvatar; void isGeneratingViews;
  return {
    ...rest,
    avatarImages: stripImages(character.avatarImages),
    fullBodyImages: stripImages(character.fullBodyImages),
    multiViewImages: stripImages(character.multiViewImages),
  };
}

/**
 * 清洗 objectURL（blob:）死链:objectURL 仅当前会话有效,持久化后再读必然失效。
 * 场景/道具的 imageUrls 与 imageAssetIds 按下标一一对应,因此只置空不清除,保住下标对位;
 * 展示层 getUrl(assetId) 优先级高于 imageUrl,空串不参与回退。
 */
export function stripDeadBlobUrls(sceneOrProp: any): any {
  if (!sceneOrProp || typeof sceneOrProp !== 'object') return sceneOrProp;
  const urls = sceneOrProp.imageUrls;
  if (!Array.isArray(urls) || !urls.some((u) => typeof u === 'string' && u.startsWith('blob:'))) {
    return sceneOrProp;
  }
  return {
    ...sceneOrProp,
    imageUrls: urls.map((u: string) => (typeof u === 'string' && u.startsWith('blob:') ? '' : u)),
  };
}

// ========== 缓存写入 ==========

/** 保存项目资产到缓存（缓存写失败不影响功能） */
export async function saveProjectAssetsToStorage(projectId: string, assets: Record<string, any>) {
  const key = getProjectAssetsKey(projectId);
  try {
    await idbStorage.setItem(key, assets);
  } catch (e) {
    console.warn('[saveProjectAssets] IndexedDB 写入失败:', e);
  }
  try {
    userStorage.setItem(key, JSON.stringify(assets));
  } catch (e) {
    console.warn('[saveProjectAssets] localStorage 写入失败，不影响功能:', e);
  }
}

/** 保存分集数据到缓存 */
export async function saveEpisodeDataToStorage(projectId: string, episodeNumber: number, data: Record<string, any>) {
  const key = getEpisodeDataKey(projectId, episodeNumber);
  try {
    await idbStorage.setItem(key, data);
  } catch (e) {
    console.warn('[saveEpisodeData] IndexedDB 写入失败:', e);
  }
  try {
    userStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('[saveEpisodeData] localStorage 写入失败，不影响功能:', e);
  }
}

/** 保存剧本到缓存 */
export async function saveScriptToStorage(projectId: string, episodeNumber: number, script: string) {
  const key = getScriptAssetKey(projectId, episodeNumber);
  const data = { script };
  try {
    await idbStorage.setItem(key, data);
  } catch (e) {
    console.warn('[saveScript] IndexedDB 写入失败:', e);
  }
  try {
    userStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('[saveScript] localStorage 写入失败:', e);
  }
}

// ========== 缓存读取 ==========

/** 从缓存加载项目资产 */
export async function loadProjectAssetsFromStorage(projectId: string): Promise<Record<string, any> | null> {
  const key = getProjectAssetsKey(projectId);
  try {
    const idbData = await idbStorage.getItem<Record<string, any>>(key);
    if (idbData) return idbData;
  } catch (e) { /* ignore */ }
  try {
    const raw = userStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

/** 从缓存加载分集数据 */
export async function loadEpisodeDataFromStorage(projectId: string, episodeNumber: number): Promise<Record<string, any> | null> {
  const key = getEpisodeDataKey(projectId, episodeNumber);
  try {
    const idbData = await idbStorage.getItem<Record<string, any>>(key);
    if (idbData) return idbData;
  } catch (e) { /* ignore */ }
  try {
    const raw = userStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

/** 从缓存加载剧本 */
export async function loadScriptFromStorage(projectId: string, episodeNumber: number): Promise<string | null> {
  const key = getScriptAssetKey(projectId, episodeNumber);
  try {
    const idbData = await idbStorage.getItem<{ script?: string }>(key);
    if (idbData?.script !== undefined) return idbData.script;
  } catch (e) { /* ignore */ }
  try {
    const raw = userStorage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw);
      return data.script ?? null;
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * 从缓存加载完整 workflow 数据（用于初次加载秒开）
 * 返回结构与 WorkflowLoadResult 兼容，供调用方一次性 setState。
 */
export async function loadWorkflowFromCache(
  projectId: string,
  episodeNumber: number
): Promise<Record<string, any> | null> {
  const projectAssets = await loadProjectAssetsFromStorage(projectId);
  const episode = await loadEpisodeDataFromStorage(projectId, episodeNumber);
  const localScript = await loadScriptFromStorage(projectId, episodeNumber);

  if (!projectAssets && !episode && localScript === null) return null;

  const result: Record<string, any> = {};

  // 项目级字段
  if (projectAssets) {
    for (const key of PROJECT_DATA_FIELDS) {
      if (projectAssets[key] !== undefined) result[key] = projectAssets[key];
    }
    // 缓存中的 characters/scenes/props（秒开用，服务端数据到后覆盖）；
    // scenes/props 清洗 blob: 死链（objectURL 跨刷新失效），由 resolver 按 assetId 还原
    if (projectAssets.characters) result.characters = projectAssets.characters;
    if (projectAssets.scenes) result.scenes = projectAssets.scenes.map(stripDeadBlobUrls);
    if (projectAssets.props) result.props = projectAssets.props.map(stripDeadBlobUrls);
    console.log('[ModelPersist] 从缓存恢复模型选择:', {
      characters: (projectAssets.characters || []).map((c: any) => `${c.name}:${c.model}`),
      scenes: (projectAssets.scenes || []).map((s: any) => `${s.name}:${s.model}`),
      props: (projectAssets.props || []).map((p: any) => `${p.name}:${p.model}`),
    });
  }

  // 分集级字段
  if (episode) {
    for (const key of EPISODE_DATA_FIELDS) {
      if (episode[key] !== undefined) result[key] = episode[key];
    }
  }

  // 剧本
  if (localScript !== null) {
    result.script = localScript;
  }

  // 第1集特殊处理
  if (episodeNumber === 1) {
    result.previousEpisodeScript = '';
    result.previousEpisodeSummary = '';
    result.previousEpisodeFragments = [];
  }

  return result;
}
