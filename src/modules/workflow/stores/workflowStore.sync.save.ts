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
 * workflowStore.sync.save.ts — 后端保存（分层：项目级 / 角色·场景 / 分集级）
 *
 * 核心原则：
 * - 项目级字段和角色/场景在变更时即时保存
 * - 分集级数据通过 debouncedSave 防抖保存，flush 时立即执行
 * - debouncedSave 在触发时捕获快照，执行时校验上下文未切换
 */
import { localApi } from '@/storage';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { saveGuard, SaveRiskLevel } from '../utils/workflowSaveGuard';
import { extractProjectData, extractEpisodeData, stripCharacterImageUrls, stripDeadBlobUrls } from './workflowStore.storage';
import {
  persistWorkflowState,
  hasValidWorkflowData,
  hasUnsyncedImages,
} from './workflowStore.sync.persist';
import { ensureDramaEpisode } from './workflowStore.sync.episode';
import type { WorkflowState } from './workflowStore';

/** 页面加载时间戳，用于防抖保存的冷却期 */
const pageLoadTime = Date.now();
const SAVE_COOLDOWN_MS = 3000;

/** 同步获取 store（用于 debouncedSave 顶层闭包） */
function getWorkflowStoreSync() {
  const wfStore = (window as any).__shotlib_workflow_store;
  return wfStore;
}

/** 标记是否有未保存的变更 */
let hasUnsavedChanges = false;

/** 获取未保存状态 */
export function getUnsavedChanges(): boolean {
  return hasUnsavedChanges;
}

/** 标记已保存 */
export function markSaved() {
  hasUnsavedChanges = false;
}

/** 标记有未保存变更 */
export function markUnsaved() {
  hasUnsavedChanges = true;
}

/** 保存冲突状态（供 UI 层监听） */
let conflictCallback: ((message: string) => void) | null = null;

/** 注册冲突回调（由 WorkflowPage 设置） */
export function setSaveConflictCallback(cb: (message: string) => void) {
  conflictCallback = cb;
}

/** 当前分集数据版本号（加载时捕获，保存时作为 expectedVersion 检测冲突；保存成功后由后端响应更新） */
let currentEpisodeDataVersion: number | undefined;
export function setEpisodeDataVersion(v: number | undefined) {
  currentEpisodeDataVersion = v;
}
export function getEpisodeDataVersion(): number | undefined {
  return currentEpisodeDataVersion;
}
/** 强制覆盖：清除本地版本基准，下一次保存不带 expectedVersion，直接覆盖服务端数据（用户在冲突弹窗选择「强制覆盖」时调用） */
export function clearEpisodeDataVersion() {
  currentEpisodeDataVersion = undefined;
}

/** 判断错误是否为 409 冲突 */
function isConflictError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('409');
}

/** 带自动重试的 API 调用（409 冲突时重试 3 次，指数退避）。
 * 带 expectedVersion 的分集数据保存须传 retryOnConflict:false——此时 409 是真实的跨端过期，重试必然再 409 */
async function saveWithRetry<T>(
  label: string,
  saveFn: () => Promise<T>,
  options?: { retryOnConflict?: boolean },
): Promise<T | null> {
  const retryOnConflict = options?.retryOnConflict !== false;
  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await saveFn();
    } catch (e) {
      lastError = e;
      if (retryOnConflict && isConflictError(e) && attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.warn(`[workflowStore] ${label} 冲突，${delay}ms 后重试 (${attempt + 1}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  const errorMsg = lastError instanceof Error ? lastError.message : '未知错误';
  console.error(`[workflowStore] ${label} 保存失败:`, errorMsg);

  if (isConflictError(lastError) && conflictCallback) {
    conflictCallback('数据已被其他会话修改，请刷新后重试');
  }

  return null;
}

// ========== 保存函数：项目级 ==========

/** 保存项目级字段到 creator_project_data */
export async function saveProjectData(state: WorkflowState): Promise<boolean> {
  const projectId = state.currentProjectId;
  if (!projectId || projectId === 'default') return false;

  let category = 'drama';
  try {
    const { useProjectStore } = await import('@/shared/stores/projectStore');
    const project = useProjectStore.getState().getCurrentProject();
    if (project) category = project.category;
  } catch { /* ignore */ }

  const projectData = extractProjectData(state);
  const result = await saveWithRetry('项目数据', () =>
    localApi.saveProjectData(projectId, { category, data: projectData })
  );
  return result !== null;
}

// ========== 保存函数：角色/场景 ==========

/**
 * 应用后端同名合并返回的 id 重映射（载荷新 id → 服务端既有行旧 id）。
 * 后端为保持跨集引用稳定，同名角色/场景会保留旧 id 落库；
 * 本地 state 中的新 id 引用（characters/scenes/activeIds/关系网/片段提示词标签）需同步回写。
 */
function applyAssetIdRemap(remap: Record<string, string>): void {
  const store = getWorkflowStoreSync();
  if (!store?.getState || !store?.setState) return;
  const st = store.getState();
  const replaceIds = (obj: any) => {
    if (obj === null || obj === undefined) return obj;
    let text = JSON.stringify(obj);
    for (const [from, to] of Object.entries(remap)) {
      text = text.split(from).join(to);
    }
    return JSON.parse(text);
  };
  store.setState({
    characters: replaceIds(st.characters),
    scenes: replaceIds(st.scenes),
    props: replaceIds(st.props),
    activeCharacterIds: (st.activeCharacterIds || []).map(
      (id: string) => remap[id] ?? id,
    ),
    activeSceneIds: (st.activeSceneIds || []).map(
      (id: string) => remap[id] ?? id,
    ),
    activePropIds: (st.activePropIds || []).map(
      (id: string) => remap[id] ?? id,
    ),
    relationshipNetwork: replaceIds(st.relationshipNetwork),
    episodes: replaceIds(st.episodes),
  });
  console.log(
    `[saveCharacterSceneAssets] 同名合并：已回写 ${Object.keys(remap).length} 个 id 引用`,
  );
}

/** 保存角色/场景到 creator_drama_project_assets（按行存储） */
export async function saveCharacterSceneAssets(state: WorkflowState): Promise<boolean> {
  const projectId = state.currentProjectId;
  if (!projectId || projectId === 'default') return false;

  let category = 'drama';
  try {
    const { useProjectStore } = await import('@/shared/stores/projectStore');
    const project = useProjectStore.getState().getCurrentProject();
    if (project) category = project.category;
  } catch { /* ignore */ }

  const isDramaMode = ['drama', 'advertisement', 'novel'].includes(category);

  if (isDramaMode) {
    // 关键修复：写入 orderIndex 记录分解时的展示顺序。
    // 后端列表按 created_at/id 排序，批量插入 created_at 可能相同（退化为 uuid 随机序）、
    // 复用的旧角色 created_at 更早会排到前面，导致刷新后角色顺序变化。
    const characterItems = (state.characters || []).map((c, index) => ({
      id: c.id,
      category: 'character',
      asset_key: c.id,
      episode_number: 0,
      data: { ...stripCharacterImageUrls(c), orderIndex: index },
    }));
    const sceneItems = (state.scenes || []).map((s, index) => ({
      id: s.id,
      category: 'scene',
      asset_key: s.id,
      episode_number: 0,
      // objectURL(blob:) 跨刷新失效,真相源只存可恢复数据(assetId + 远程 URL)
      data: { ...stripDeadBlobUrls(s), orderIndex: index },
    }));
    // 道具同为项目级资产（episode_number=0），随角色/场景一起落库
    const propItems = (state.props || []).map((p, index) => ({
      id: p.id,
      category: 'prop',
      asset_key: p.id,
      episode_number: 0,
      data: { ...stripDeadBlobUrls(p), orderIndex: index },
    }));

    const result = await saveWithRetry('角色/场景资产', () =>
      localApi.bulkSaveProjectAssets(projectId, {
        assets: [...characterItems, ...sceneItems, ...propItems],
      })
    );
    console.log('[ModelPersist] 保存角色/场景/道具资产:', {
      characters: (state.characters || []).map((c) => `${c.name}:${c.model}`),
      scenes: (state.scenes || []).map((s) => `${s.name}:${s.model}`),
      props: (state.props || []).map((p) => `${p.name}:${p.model}`),
    });
    // 后端同名合并可能保留了旧 id（为跨集引用稳定），将返回的 id 映射回写本地 state
    const idRemap = (result as any)?.data?.idRemap as
      | Record<string, string>
      | undefined;
    if (idRemap && Object.keys(idRemap).length > 0) {
      applyAssetIdRemap(idRemap);
    }
    return result !== null;
  } else {
    // 非 drama 模式保留原有 category 资产行保存方式
    const projectData = extractProjectData(state);
    const assetsResult = await saveWithRetry('项目资产', () =>
      localApi.saveProjectAssets(projectId, { category, data: projectData })
    );
    return assetsResult !== null;
  }
}

// ========== 保存函数：分集级 ==========

/** 保存分集数据到 creator_drama_episode_data + script 资产 */
export async function saveEpisodeData(
  state: WorkflowState,
  episodeNumber: number,
): Promise<boolean> {
  const projectId = state.currentProjectId;
  if (!projectId || projectId === 'default') return false;

  const riskReport = saveGuard.validateSave(state);
  if (riskReport.level === SaveRiskLevel.BLOCKED) {
    console.warn('[saveEpisodeData] SaveGuard 阻止保存:', riskReport.message);
    return false;
  }

  // 获取 episodeId
  let episodeId: string | undefined;
  try {
    const episodeInfoRaw = userStorage.getItem(`shotlib_episode_list_${projectId}`);
    const episodeInfo = episodeInfoRaw ? JSON.parse(episodeInfoRaw) : null;
    episodeId = episodeInfo?.episodeIdMap?.[episodeNumber];
  } catch (e) {
    console.error('[saveEpisodeData] 解析 episodeInfo 失败:', e);
  }

  if (!episodeId) {
    console.warn(`[saveEpisodeData] localStorage 中找不到 episodeId，尝试从后端获取: episodeNumber=${episodeNumber}`);
    const ensuredEpisodeId = (await ensureDramaEpisode(projectId, episodeNumber)) ?? undefined;
    if (ensuredEpisodeId) {
      episodeId = ensuredEpisodeId;
      // 更新 localStorage
      try {
        const episodeInfoRaw = userStorage.getItem(`shotlib_episode_list_${projectId}`);
        const episodeInfo = episodeInfoRaw ? JSON.parse(episodeInfoRaw) : {};
        const updatedIdMap = { ...(episodeInfo.episodeIdMap || {}), [episodeNumber]: episodeId };
        userStorage.setItem(`shotlib_episode_list_${projectId}`, JSON.stringify({
          ...episodeInfo,
          episodeIdMap: updatedIdMap,
        }));
      } catch (e) {
        console.error('[saveEpisodeData] 更新 episodeIdMap 失败:', e);
      }
    } else {
      console.error(`[saveEpisodeData] 无法获取 episodeId: episodeNumber=${episodeNumber}`);
      return false;
    }
  }

  // 保存分集数据
  let episodeSaved = true;
  if (episodeId) {
    const episodeData = extractEpisodeData(state, episodeNumber);
    console.log('[导入诊断-E] saveEpisodeData', { episodeNumber, episodeId, dataEps: episodeData.episodes?.length, stateEps: state.episodes?.length, hasDerive: episodeData.episodes?.some((e:any)=>e.title?.includes('衍生')), titles: episodeData.episodes?.map((e:any)=>e.title) });
    const result = await saveWithRetry(
      '分集数据',
      () =>
        localApi.saveDramaEpisodeData(episodeId!, {
          data: episodeData,
          expectedVersion: currentEpisodeDataVersion,
        }),
      { retryOnConflict: false },
    );
    episodeSaved = result !== null;
    // 保存成功：用后端返回的新版本号更新本地基准（返回实体含 version）
    if (episodeSaved && result && typeof (result as any)?.version === 'number') {
      currentEpisodeDataVersion = (result as any).version;
    }
  }

  // 保存剧本
  let scriptSaved = true;
  const hasScript = typeof state.script === 'string' && state.script.trim().length > 0;
  if (hasScript) {
    let category = 'drama';
    try {
      const { useProjectStore } = await import('@/shared/stores/projectStore');
      const project = useProjectStore.getState().getCurrentProject();
      if (project) category = project.category;
    } catch { /* ignore */ }

    const scriptResult = await saveWithRetry('分集剧本', () =>
      localApi.saveProjectAssets(projectId!, {
        category: 'script',
        data: { script: state.script },
        episode_number: episodeNumber,
      })
    );
    scriptSaved = scriptResult !== null;
  }

  return episodeSaved && scriptSaved;
}

// ========== 完整保存（兼容旧调用点） ==========

/** 保存完整状态到后端（项目级 + 角色/场景 + 分集级） */
export async function saveToServer(
  state: WorkflowState,
  episodeNumberOverride?: number,
  options?: { force?: boolean },
): Promise<boolean> {
  if (!hasValidWorkflowData(state)) {
    console.log('[saveToServer] 状态无有效数据，跳过保存');
    return false;
  }

  const projectId = state.currentProjectId;
  if (!projectId || projectId === 'default') return false;

  const riskReport = saveGuard.validateSave(state);
  if (riskReport.level === SaveRiskLevel.BLOCKED) {
    console.warn('[saveToServer] SaveGuard 阻止保存:', riskReport.message);
    return false;
  }

  const episodeNumber = episodeNumberOverride ?? state.currentEpisodeNumber ?? 1;

  // 防线1（跨分集写入拦截）：目标分集必须与 store 当前分集一致。
  // 调用方可能传入构造过的 state 副本（如 {...state, currentEpisodeNumber: N}），
  // 因此以 live store 的分集号为准——防止分集切换/状态错序时把 A 集数据写进 B 集
  // （生产事故：第2集生成片段时把数据写进第1集，导致第1集 step3/step4 全丢）
  const liveEpisode = getWorkflowStoreSync()?.getState()?.currentEpisodeNumber;
  if (liveEpisode && episodeNumber !== liveEpisode) {
    console.error(
      `[saveToServer] 阻止跨分集写入：目标第${episodeNumber}集 ≠ store当前第${liveEpisode}集`,
    );
    return false;
  }

  // 防线2（生成/解析进行中拦截）：生成片段/分解剧本进行中 episodes 会被临时清空，
  // 此间触发的保存（防抖/切换页面等）会把空片段覆盖到云端。
  // 两条链路成功后的显式保存通过 force 放行（parseScript 的显式保存在 flag 复位之前）。
  if (
    !options?.force &&
    (state.isGeneratingEpisodes || state.isParsingScript)
  ) {
    console.log('[saveToServer] 生成/解析进行中，跳过保存（完成后会显式保存）');
    return false;
  }

  // 图片同步到云端
  if (hasUnsyncedImages(state)) {
    try {
      const { useSettingsStore } = await import('@/shared/stores/settingsStore');
      const provider = useSettingsStore.getState().remoteStorage || 'aliyun';
      const { syncWorkflowToCloudApi } = await import('@/modules/workflow/api/workflowApi');

      let category = 'drama';
      try {
        const { useProjectStore } = await import('@/shared/stores/projectStore');
        const project = useProjectStore.getState().getCurrentProject();
        if (project) category = project.category;
      } catch { /* ignore */ }

      const workflowData = {
        characters: state.characters,
        scenes: state.scenes,
        era: state.era,
        relationshipNetwork: state.relationshipNetwork,
        episodes: state.episodes,
        audioAssets: state.audioAssets,
      };

      const syncResponse = await syncWorkflowToCloudApi(
        projectId, provider as 'amazon' | 'aliyun', workflowData, category
      );
      if (syncResponse.success && syncResponse.data?.workflowData) {
        const cloudData = syncResponse.data.workflowData;
        const patches: Record<string, any> = {};
        // 异常A修复：characters 不使用云端整体覆盖——云端返回的 characters 可能为旧版本，
        // 会把本地已清空的 multiViewImages 等编辑回填。改为仅用 urlMapping 局部更新图片 URL，
        // 保留本地最新结构（与 CharacterCard.syncToCloud 的正确做法一致）。
        if (cloudData.scenes?.length) patches.scenes = cloudData.scenes;
        // episodes 不使用云端整体覆盖（同下文 characters 的异常A修复）：云端返回的 episodes
        // 可能为旧版本，会冲掉本地新增/编辑的片段。改为仅用 urlMapping 局部更新图片 URL。
        if (cloudData.audioAssets?.length) patches.audioAssets = cloudData.audioAssets;
        if (cloudData.era) patches.era = cloudData.era;
        if (cloudData.relationshipNetwork) patches.relationshipNetwork = cloudData.relationshipNetwork;
        const urlMapping = syncResponse.data.urlMapping;
        if (urlMapping) {
          const remap = (url?: string) => (url && urlMapping[url] ? urlMapping[url] : url);
          const cur = getWorkflowStoreSync()?.getState();
          if (cur) {
            patches.characters = (cur.characters || []).map((c: any) => ({
              ...c,
              avatarImages: (c.avatarImages || []).map((img: any) => ({ ...img, imageUrl: remap(img.imageUrl) })),
              multiViewImages: (c.multiViewImages || []).map((img: any) => ({ ...img, imageUrl: remap(img.imageUrl) })),
              fullBodyImages: (c.fullBodyImages || []).map((img: any) => ({ ...img, imageUrl: remap(img.imageUrl) })),
            }));
            // episodes 同样保留本地最新结构（含新增片段），仅用 urlMapping 更新图片 URL
            patches.episodes = (cur.episodes || []).map((ep: any) => ({
              ...ep,
              firstFrameImageUrl: remap(ep.firstFrameImageUrl),
              lastFrameImageUrl: remap(ep.lastFrameImageUrl),
              generatedVideoUrl: remap(ep.generatedVideoUrl),
              shots: (ep.shots || []).map((shot: any) => ({
                ...shot,
                referenceImageUrl: remap(shot.referenceImageUrl),
              })),
            }));
          }
        }
        if (Object.keys(patches).length > 0) {
          const store = getWorkflowStoreSync();
          if (store?.setState) store.setState(patches);
        }
      }
    } catch (syncErr) {
      console.error('[saveToServer] 图片同步异常:', syncErr);
    }
  }

  // 分层保存
  const projectDataSaved = await saveProjectData(state);
  const characterSceneSaved = await saveCharacterSceneAssets(state);
  const episodeSaved = await saveEpisodeData(state, episodeNumber);

  // 保存分集列表元信息
  try {
    const episodeInfoRaw = userStorage.getItem(`shotlib_episode_list_${projectId}`);
    if (episodeInfoRaw) {
      const episodeInfo = JSON.parse(episodeInfoRaw);
      const metaData: Record<string, any> = {};
      if (episodeInfo.episodes !== undefined) metaData.episodeList = episodeInfo.episodes;
      if (episodeInfo.currentEpisode !== undefined) metaData.currentEpisode = episodeInfo.currentEpisode;
      if (episodeInfo.episodeIdMap !== undefined) metaData.episodeIdMap = episodeInfo.episodeIdMap;
      if (Object.keys(metaData).length > 0) {
        await saveWithRetry('分集列表元信息', () =>
          localApi.saveProjectAssets(projectId, { category: 'episode_meta', data: metaData })
        );
      }
    }
  } catch (e) {
    console.warn('[saveToServer] 保存分集列表元信息失败:', e);
  }

  const allSaved = projectDataSaved && characterSceneSaved && episodeSaved;
  if (allSaved) {
    markSaved();
    cancelDebouncedSave();
    persistWorkflowState(projectId, episodeNumber, state);
    saveGuard.recordSnapshot(state);
  }
  return allSaved;
}

// ========== Flush：立即保存当前分集数据 ==========

/** 立即保存当前分集数据（切换上下文前调用） */
export async function flush(): Promise<boolean> {
  cancelDebouncedSave();
  const useWorkflowStore = getWorkflowStoreSync();
  if (!useWorkflowStore) return false;

  const state = useWorkflowStore.getState();
  const episodeNumber = state.currentEpisodeNumber ?? 1;

  // 等待可能正在执行的保存完成
  if (isSaving) {
    // 简单等待：轮询直到保存完成（最多 5 秒）
    const maxWait = 5000;
    const start = Date.now();
    while (isSaving && Date.now() - start < maxWait) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isSaving) {
      console.warn('[flush] 等待保存超时，继续执行');
    }
  }

  console.log(`[flush] 保存第${episodeNumber}集数据`);
  return await saveToServer(state, episodeNumber);
}

// ========== Debounced Save（快照机制） ==========

/** 快照：触发时捕获的上下文 */
interface SaveSnapshot {
  projectId: string;
  episodeNumber: number;
  state: WorkflowState;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveSnapshot: SaveSnapshot | null = null;

/** 取消待执行的防抖保存 */
export function cancelDebouncedSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveSnapshot = null;
    console.log('[debouncedSave] 已取消待执行的保存');
  }
}

/** 是否正在保存（用于防止并发保存） */
let isSaving = false;

export function getIsSaving(): boolean {
  return isSaving;
}

/** 防抖保存到后端（1秒延迟，触发时捕获快照） */
export function debouncedSave(isLoadingFromServer: boolean) {
  if (isLoadingFromServer) return;
  if (Date.now() - pageLoadTime < SAVE_COOLDOWN_MS) {
    console.log('[debouncedSave] 处于冷却期，跳过自动保存');
    return;
  }

  // 触发时捕获快照
  const useWorkflowStore = getWorkflowStoreSync();
  if (!useWorkflowStore) return;
  const currentState = useWorkflowStore.getState();
  saveSnapshot = {
    projectId: currentState.currentProjectId || '',
    episodeNumber: currentState.currentEpisodeNumber ?? 1,
    state: { ...currentState } as WorkflowState,
  };

  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    if (isSaving) {
      console.log('[debouncedSave] 已有保存进行中，跳过');
      return;
    }
    if (!saveSnapshot) return;

    // 执行时校验：上下文是否已切换
    const latestState = useWorkflowStore.getState();
    const latestProjectId = latestState.currentProjectId;
    const latestEpisodeNumber = latestState.currentEpisodeNumber ?? 1;

    if (saveSnapshot.projectId !== latestProjectId) {
      console.warn(`[debouncedSave] 项目已切换(${saveSnapshot.projectId} -> ${latestProjectId})，丢弃快照`);
      saveSnapshot = null;
      return;
    }
    if (saveSnapshot.episodeNumber !== latestEpisodeNumber) {
      console.warn(`[debouncedSave] 分集已切换(${saveSnapshot.episodeNumber} -> ${latestEpisodeNumber})，丢弃快照`);
      saveSnapshot = null;
      return;
    }

    // 使用快照的 state 执行保存，而非最新 state
    console.log(`[debouncedSave] 执行保存, episode=${saveSnapshot.episodeNumber}`);
    saveToServer(saveSnapshot.state, saveSnapshot.episodeNumber);
    saveSnapshot = null;
  }, 1000);
}

/** 保存指定分集数据到后端（兼容旧调用点） */
export async function saveDramaEpisodeToServer(
  episodeId: string,
  state: WorkflowState
): Promise<void> {
  if (!episodeId) return;
  const episodeData = extractEpisodeData(state);
  try {
    const saved = await localApi.saveDramaEpisodeData(episodeId, {
      data: episodeData,
      expectedVersion: currentEpisodeDataVersion,
    });
    if (typeof (saved as any)?.version === 'number') {
      currentEpisodeDataVersion = (saved as any).version;
    }
    markSaved();
  } catch (e) {
    console.error('[saveDramaEpisodeToServer] failed:', e);
  }
}
