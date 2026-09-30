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
 * workflowStore.sync.persist.ts — 本地持久化与保存前校验
 */
import { saveGuard, SaveRiskLevel } from '../utils/workflowSaveGuard';
import {
  PROJECT_DATA_FIELDS,
  extractProjectData,
  extractEpisodeData,
  saveProjectAssetsToStorage,
  saveEpisodeDataToStorage,
  saveScriptToStorage,
  stripCharacterImageUrls,
} from './workflowStore.storage';
import type { WorkflowState } from './workflowStore';

// 延迟导入 useWorkflowStore 避免循环依赖
const getWorkflowStore = async () => {
  const { useWorkflowStore } = await import('./workflowStore');
  return useWorkflowStore;
};

/** 页面加载时间戳，用于防抖保存的冷却期 */
const pageLoadTime = Date.now();
const SAVE_COOLDOWN_MS = 3000;

/** 判断状态是否包含有效创作数据 */
export function hasValidWorkflowData(state: WorkflowState): boolean {
  const hasContent =
    (state.script && state.script.trim().length > 0) ||
    (state.characters && state.characters.length > 0) ||
    (state.scenes && state.scenes.length > 0) ||
    (state.episodes && state.episodes.length > 0) ||
    (state.topic && state.topic.trim().length > 0) ||
    (state.audioAssets && state.audioAssets.length > 0);
  console.log(`[debug001] hasValidWorkflowData: ${!!hasContent}, script=${state.script?.length ?? 0}, chars=${state.characters?.length ?? 0}, scenes=${state.scenes?.length ?? 0}, eps=${state.episodes?.length ?? 0}, topic=${state.topic?.length ?? 0}, audio=${state.audioAssets?.length ?? 0}`);
  return !!hasContent;
}

/** 判断 URL 是否为尚未同步到云端的临时地址 */
export function isUnsyncedImageUrl(url: string | undefined): boolean {
  if (!url || !url.startsWith('http')) return false;
  // 云存储地址已同步
  if (url.includes('aliyuncs.com')) return false;
  if (url.includes('amazonaws.com')) return false;
  if (url.includes('cos.')) return false;
  // 本地 uploads 目录 URL（来自 AiAssetProxyService.uploadToLocal）已可访问，无需同步
  if (url.includes('/uploads/ai-assets/')) return false;
  // workspace API URL 已可通过 WorkspaceController 访问，无需同步
  if (url.includes('/api/workspace/')) return false;
  return true;
}

/** 检查状态中是否存在尚未同步到云端的图片 */
export function hasUnsyncedImages(state: WorkflowState): boolean {
  for (const char of state.characters || []) {
    for (const img of char.avatarImages || []) {
      if (isUnsyncedImageUrl(img.imageUrl)) return true;
    }
    for (const img of char.multiViewImages || []) {
      if (isUnsyncedImageUrl(img.imageUrl)) return true;
    }
    for (const img of char.fullBodyImages || []) {
      if (isUnsyncedImageUrl(img.imageUrl)) return true;
    }
  }
  for (const scene of state.scenes || []) {
    for (const url of scene.imageUrls || []) {
      if (isUnsyncedImageUrl(url)) return true;
    }
  }
  for (const ep of state.episodes || []) {
    if (isUnsyncedImageUrl(ep.firstFrameImageUrl)) return true;
    if (isUnsyncedImageUrl(ep.lastFrameImageUrl)) return true;
    if (isUnsyncedImageUrl(ep.generatedVideoUrl)) return true;
    for (const shot of ep.shots || []) {
      if (isUnsyncedImageUrl(shot.referenceImageUrl)) return true;
    }
  }
  for (const asset of state.audioAssets || []) {
    if (isUnsyncedImageUrl(asset.audioUrl)) return true;
    if (isUnsyncedImageUrl(asset.coverUrl)) return true;
  }
  return false;
}

/** 持久化当前状态（项目资产 + 分集数据） */
export async function persistWorkflowState(
  projectId: string,
  episodeNumber: number,
  stateOverride?: WorkflowState
) {
  const useWorkflowStore = await getWorkflowStore();
  const state = stateOverride ?? useWorkflowStore.getState();

  const riskReport = saveGuard.validateSave(state);
  if (riskReport.level === SaveRiskLevel.BLOCKED) {
    console.warn('[workflowStore] persistWorkflowState: SaveGuard 阻止保存:', riskReport.message);
    return;
  }

  if (!hasValidWorkflowData(state)) {
    console.log('[workflowStore] persistWorkflowState: 状态无有效数据，跳过 localStorage 同步');
    return;
  }

  const assets = extractProjectData(state);
  const episode = extractEpisodeData(state);

  let category = 'drama';
  try {
    const { useProjectStore } = await import('@/shared/stores/projectStore');
    const project = useProjectStore.getState().getCurrentProject();
    if (project) category = project.category;
  } catch { /* ignore */ }
  const isDramaMode = ['drama', 'advertisement', 'novel'].includes(category);

  if (isDramaMode) {
    // 关键修复：characters/scenes 是项目级资产（episode_number=0），
    // 统一写入项目级 localStorage key，不再按分集存储。
    // 补齐 characters/scenes/props：loadWorkflowFromCache 从项目级 key 读取三者做秒开，
    // 之前漏写导致缓存秒开永远无资产数据；characters 剥离 imageUrl（objectURL 跨刷新失效）
    // 只留 assetId，由 hydrate/resolver 从 imageRepo 还原。
    const assetsWithRows = {
      ...assets,
      characters: (state.characters || []).map(stripCharacterImageUrls),
      scenes: state.scenes,
      props: state.props,
    };
    saveProjectAssetsToStorage(projectId, assetsWithRows).catch(() => {});
  } else {
    saveProjectAssetsToStorage(projectId, assets).catch(() => {});
  }

  saveEpisodeDataToStorage(projectId, episodeNumber, episode).catch(() => {});
  saveScriptToStorage(projectId, episodeNumber, state.script || '').catch(() => {});

  saveGuard.recordSnapshot(state);
}
