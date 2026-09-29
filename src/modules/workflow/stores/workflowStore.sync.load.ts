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
 * workflowStore.sync.load.ts — 从后端加载 workflow 数据（纯数据返回，不写 store）
 *
 * 核心原则：数据库为唯一真相源，此函数只负责从后端获取数据并返回结构化结果，
 * 由调用方决定何时、如何写入 store。
 */
import { localApi } from '@/storage';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { PROJECT_DATA_FIELDS, EPISODE_DATA_FIELDS } from './workflowStore.storage';

/** 加载结果：结构化的项目/分集数据 */
export interface WorkflowLoadResult {
  /** 项目级字段（PROJECT_DATA_FIELDS + era + relationshipNetwork） */
  projectData: Record<string, any>;
  /** 角色列表（从 character 资产行加载，已还原图片 URL） */
  characters: any[];
  /** 场景列表（从 scene 资产行加载） */
  scenes: any[];
  /** 道具列表（从 prop 资产行加载） */
  props: any[];
  /** 分集级字段（EPISODE_DATA_FIELDS） */
  episodeData: Record<string, any>;
  /** 剧本内容（从 script 资产行加载） */
  script: string;
  /** 需要恢复视频轮询的片段列表 */
  episodesNeedRecovery: Array<{ id: string; videoTaskId: string }>;
  /** 后端返回的分集列表（用于更新 episodeIdMap） */
  episodeIdMap: Record<number, string>;
  /** 分集数据版本号（保存冲突检测基准，expectedVersion） */
  episodeDataVersion?: number;
}

export let isLoadingFromServer = false;

/**
 * 按保存时写入的 orderIndex 还原列表顺序。
 * 只要任意一项带 orderIndex 就按它排序（缺失的排到最后，稳定排序保持相对顺序）；
 * 全部缺失（历史数据）时原样返回。
 */
function sortBySavedOrder<T extends { orderIndex?: number }>(list: T[]): T[] {
  if (!list?.length || !list.some((x) => typeof x?.orderIndex === 'number')) return list;
  return [...list].sort(
    (a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * 清理角色/场景资产行中的瞬时生成标志。
 * 历史数据可能把 isGeneratingAvatar/isGeneratingViews/isGenerating 持久化到云端
 * （如生成过程中服务器重启、会话中断），加载后会导致占位/按钮永久 loading 且批量生成跳过。
 * 头像/形象照/场景图生成无断点恢复机制，加载时一律复位为 false。
 */
function cleanAssetLoadingStates(
  characters: any[],
  scenes: any[],
): { characters: any[]; scenes: any[] } {
  const clearImgFlag = (img: any) =>
    img && typeof img === 'object' ? { ...img, isGenerating: false } : img;
  return {
    characters: (characters || []).map((c) => ({
      ...c,
      isGeneratingAvatar: false,
      isGeneratingViews: false,
      avatarImages: (c?.avatarImages || []).map(clearImgFlag),
      multiViewImages: (c?.multiViewImages || []).map(clearImgFlag),
      fullBodyImages: (c?.fullBodyImages || []).map(clearImgFlag),
    })),
    scenes: (scenes || []).map((s) => ({ ...s, isGenerating: false })),
  };
}

/**
 * 根据 image_asset 行还原角色图片 URL。
 * character 资产行只存 assetId，不存 imageUrl，避免与 image_asset 重复。
 */
export async function hydrateCharacterImages(projectId: string, characters: any[]): Promise<any[]> {
  if (!characters || characters.length === 0) return characters;

  const assetIds = new Set<string>();
  for (const char of characters) {
    for (const img of char.avatarImages || []) {
      if (img?.assetId) assetIds.add(img.assetId);
    }
    for (const img of char.multiViewImages || []) {
      if (img?.assetId) assetIds.add(img.assetId);
    }
    for (const img of char.fullBodyImages || []) {
      if (img?.assetId) assetIds.add(img.assetId);
    }
  }

  if (assetIds.size === 0) return characters;

  try {
    const resolveRes = await localApi.resolveImageAssets(projectId, {
      asset_ids: Array.from(assetIds),
    });
    if (!resolveRes.success || !resolveRes.data) return characters;

    // resolveImageAssets 已自动填充 localApi 的 imageDataCache，
    // 合规状态通过 getCachedImageData + readAnyCompliance 按需读取，不再写入 CharacterImage。
    const assetMap = resolveRes.data as Record<string, { url?: string; data?: Record<string, any> }>;
    return characters.map((char) => {
      const fillUrl = (img: any) => {
        if (!img || typeof img !== 'object') return img;
        const resolved = img.assetId ? assetMap[img.assetId] : undefined;
        if (resolved?.url) {
          return { ...img, imageUrl: resolved.url };
        }
        return img;
      };
      return {
        ...char,
        avatarImages: (char.avatarImages || []).map(fillUrl),
        multiViewImages: (char.multiViewImages || []).map(fillUrl),
        fullBodyImages: (char.fullBodyImages || []).map(fillUrl),
      };
    });
  } catch (e) {
    console.warn('[hydrateCharacterImages] 解析角色图片资产失败:', e);
    return characters;
  }
}

/** 清理片段中的 loading 状态并收集需要恢复的视频任务 */
function cleanEpisodesAndGetRecovery(episodes: any[]): {
  cleaned: any[];
  needRecovery: Array<{ id: string; videoTaskId: string }>;
} {
  const needRecovery: Array<{ id: string; videoTaskId: string }> = [];
  if (!Array.isArray(episodes)) return { cleaned: [], needRecovery };

  const cleaned = episodes.map((ep: any) => {
    // 视频任务已失败的不算 pending，不应恢复轮询
    const isFailedVideo = ep.videoTaskStatus === 'failed';
    const hasPendingVideo = ep.videoTaskId && !ep.generatedVideoUrl && !isFailedVideo;
    if (hasPendingVideo) {
      needRecovery.push({ id: ep.id, videoTaskId: ep.videoTaskId });
    }
    const result = {
      ...ep,
      isGenerating: hasPendingVideo ? true : false,
      videoGenerationProgress: hasPendingVideo ? (ep.videoGenerationProgress || 10) : 0,
      isGeneratingFirstFrame: false,
      isGeneratingLastFrame: false,
      isExpandingFirstFrame: false,
      isExpandingLastFrame: false,
    };
    // 已失败的视频：清除 videoTaskId 避免被当作 pending，保留 videoTaskStatus 供 UI 展示失败状态
    if (isFailedVideo) {
      result.videoTaskId = undefined;
    }
    if (result.shots && Array.isArray(result.shots)) {
      result.shots = result.shots.map((shot: any) => ({
        ...shot,
        isGeneratingReferenceImage: false,
      }));
    }
    return result;
  });
  // 按 id 去重：清理历史数据中可能存在的重复 id 片段
  // （会导致 Tabs 重复渲染、多个 tab 同时选中、多个 content 同时显示等异常）
  const seenIds = new Set<string>();
  const deduped = cleaned.filter((ep: any) => {
    if (!ep?.id || seenIds.has(ep.id)) return false;
    seenIds.add(ep.id);
    return true;
  });
  // 诊断：历史衍生片段加载状态（排查尾帧图字段缺失 / firstFrameImageUrl 未还原）
  for (const ep of deduped) {
    if (!ep?.firstFrameImageAssetId) continue;
    console.log('[cleanEpisodesAndGetRecovery] 衍生片段加载状态:', {
      episodeId: ep.id, title: ep.title,
      videoGenerationMode: ep.videoGenerationMode,
      firstFrameImageAssetId: ep.firstFrameImageAssetId,
      firstFrameImageUrl: ep.firstFrameImageUrl,
      shots: (ep.shots || []).map((s: any, i: number) => ({
        idx: i,
        useReferenceAsFirstFrame: s.useReferenceAsFirstFrame,
        referenceImageUrl: s.referenceImageUrl,
        referenceImageAssetId: s.referenceImageAssetId,
        promptHead: (s.prompt || '').substring(0, 80),
      })),
    });
  }
  return { cleaned: deduped, needRecovery };
}

/**
 * 从后端加载 workflow 数据，返回结构化结果。
 * 不写入 store，由调用方决定何时写入。
 */
export async function loadWorkflowFromServer(
  projectId: string,
  category: string = 'drama',
  episodeNumber: number,
): Promise<WorkflowLoadResult | null> {
  console.log(`[episode=${episodeNumber}] [loadWorkflowFromServer] START: projectId=${projectId}, category=${category}`);
  if (!projectId || projectId === 'default') {
    console.log('[loadWorkflowFromServer] 无效 projectId，直接返回');
    return null;
  }

  try {
    isLoadingFromServer = true;
    const isDramaMode = ['drama', 'advertisement', 'novel'].includes(category);

    // ========== 1. 加载角色/场景/道具（drama 模式：按行存储） ==========
    let characters: any[] = [];
    let scenes: any[] = [];
    let props: any[] = [];

    if (isDramaMode) {
      try {
        const assetsListRes = await localApi.listProjectAssets(
          projectId,
          'character,scene,prop',
          0,
        );
        if (assetsListRes.success && Array.isArray(assetsListRes.data)) {
          const rows = assetsListRes.data as any[];
          const rawCharacters = rows
            .filter((a) => a.category === 'character')
            .map((a) => a.data)
            .filter(Boolean);
          const rawScenes = rows
            .filter((a) => a.category === 'scene')
            .map((a) => a.data)
            .filter(Boolean);
          const rawProps = rows
            .filter((a) => a.category === 'prop')
            .map((a) => a.data)
            .filter(Boolean);

          // 复位持久化的瞬时生成标志（防止历史污染数据导致永久 loading）
          const cleaned = cleanAssetLoadingStates(rawCharacters, rawScenes);
          // 道具同理复位 isGenerating（与场景共用同一瞬时标志语义）
          const cleanedProps = (rawProps || []).map((p) => ({ ...p, isGenerating: false }));
          // 按保存时写入的 orderIndex 还原分解时的顺序（后端按 created_at/id 排序，
          // created_at 相同或复用旧角色时顺序会乱）；无 orderIndex 的历史数据保持原列表顺序
          characters = sortBySavedOrder(cleaned.characters);
          scenes = sortBySavedOrder(cleaned.scenes);
          props = sortBySavedOrder(cleanedProps);

          if (characters.length > 0) {
            characters = await hydrateCharacterImages(projectId, characters);
          }
          console.log(`[loadWorkflowFromServer] 加载角色/场景/道具: chars=${characters.length}, scenes=${scenes.length}, props=${props.length}`);
          console.log('[ModelPersist] 恢复角色/场景/道具模型:', {
            characters: characters.map((c: any) => `${c.name}:${c.model}`),
            scenes: scenes.map((s: any) => `${s.name}:${s.model}`),
            props: props.map((p: any) => `${p.name}:${p.model}`),
          });
        }
      } catch (e) {
        console.warn(`[loadWorkflowFromServer] 角色/场景/道具资产列表加载失败:`, e);
      }
    }

    // ========== 2. 加载剧本（script 资产行，按 episode_number 区分） ==========
    let script = '';
    try {
      const scriptResponse = await localApi.getProjectAssets(
        projectId,
        'script',
        episodeNumber,
      );
      if (scriptResponse.success && scriptResponse.data?.data) {
        const rawScript = scriptResponse.data.data;
        const unpackedScript = rawScript.data || rawScript;
        if (typeof unpackedScript.script === 'string') {
          script = unpackedScript.script;
          console.log(`[loadWorkflowFromServer] 加载第${episodeNumber}集剧本，长度=${script.length}`);
        }
      }
    } catch (e) {
      console.warn('[loadWorkflowFromServer] script 资产加载失败:', e);
    }

    // ========== 3. 加载项目数据（creator_project_data） ==========
    const projectData: Record<string, any> = {};

    try {
      const response = await localApi.getProjectData(projectId, category);
      if (response.success && response.data) {
        const responseData = response.data as any;
        const saved = responseData?.projectData?.data || responseData?.data || {};
        for (const key of PROJECT_DATA_FIELDS) {
          if (saved[key] !== undefined) projectData[key] = saved[key];
        }
        console.log(`[loadWorkflowFromServer] 项目数据: keys=${Object.keys(projectData).join(',')}`);
      }
    } catch (e) {
      console.warn('[loadWorkflowFromServer] 项目数据加载失败:', e);
    }

    // ========== 4. 加载分集数据（creator_drama_episode_data） ==========
    const episodeData: Record<string, any> = {};

    // 获取 episodeId（优先从 localStorage，否则从后端获取）
    const episodeInfoRaw = userStorage.getItem(`shotlib_episode_list_${projectId}`);
    const episodeInfo = episodeInfoRaw ? JSON.parse(episodeInfoRaw) : null;
    let episodeId = episodeInfo?.episodeIdMap?.[episodeNumber];

    // 用于返回给调用方的 episodeIdMap
    const episodeIdMap: Record<number, string> = episodeInfo?.episodeIdMap || {};
    let episodeDataVersion: number | undefined;

    if (!episodeId) {
      try {
        const listRes = await localApi.getDramaEpisodes(projectId);
        if (listRes.success && Array.isArray(listRes.data)) {
          const dramaEpisodes = listRes.data as any[];
          const foundEp = dramaEpisodes.find((ep: any) => ep.episode_number === episodeNumber);
          if (foundEp?.id) {
            episodeId = foundEp.id;
            for (const ep of dramaEpisodes) {
              episodeIdMap[ep.episode_number] = ep.id;
            }
            // 更新 localStorage 缓存
            userStorage.setItem(`shotlib_episode_list_${projectId}`, JSON.stringify({
              episodes: dramaEpisodes.map((ep: any) => ep.episode_number),
              currentEpisode: episodeNumber,
              episodeIdMap,
            }));
          }
        }
      } catch (e) {
        console.warn('[loadWorkflowFromServer] 从后端获取分集列表失败:', e);
      }
    }

    if (episodeId) {
      try {
        const dramaEpisodeRes = await localApi.getDramaEpisode(episodeId);
        if (dramaEpisodeRes.success && dramaEpisodeRes.data?.episodeData?.data) {
          episodeDataVersion = (dramaEpisodeRes.data.episodeData as any)?.version;
          const dramaData = dramaEpisodeRes.data.episodeData.data;
          const dramaDataKeys = Object.keys(dramaData);
          const isEmptyData = dramaDataKeys.length === 0 || (dramaDataKeys.length === 1 && dramaDataKeys[0] === '_savedAt');
          if (!isEmptyData) {
            for (const key of EPISODE_DATA_FIELDS) {
              if (dramaData[key] !== undefined) episodeData[key] = dramaData[key];
            }
            console.log(`[loadWorkflowFromServer] 加载第${episodeNumber}集数据: keys=${Object.keys(episodeData).join(',')}`);
          } else {
            console.log(`[loadWorkflowFromServer] 第${episodeNumber}集数据为空`);
          }
        }
      } catch (e) {
        console.warn(`[loadWorkflowFromServer] 第${episodeNumber}集数据加载失败:`, e);
      }
    } else {
      console.log(`[loadWorkflowFromServer] 未找到第${episodeNumber}集的 episodeId`);
    }

    // ========== 5. 清理片段 loading 状态，收集视频恢复任务 ==========
    // （episodeDataVersion 在上方 getDramaEpisode 处捕获）
    let episodesNeedRecovery: Array<{ id: string; videoTaskId: string }> = [];
    if (episodeData.episodes && Array.isArray(episodeData.episodes)) {
      let { cleaned, needRecovery } = cleanEpisodesAndGetRecovery(episodeData.episodes);
      episodesNeedRecovery = needRecovery;

      // 收集首尾帧图 assetId，resolve 填充 imageDataCache（合规状态恢复）+ 还原 URL（运行时，不持久化）
      const frameAssetIds = new Set<string>();
      for (const ep of cleaned) {
        if (ep?.firstFrameImageAssetId) frameAssetIds.add(ep.firstFrameImageAssetId);
        if (ep?.lastFrameImageAssetId) frameAssetIds.add(ep.lastFrameImageAssetId);
        // 分镜参考附件的 image_asset 行（assetKey）一并 resolve 填充缓存，
        // 刷新页面后合规状态可从缓存恢复（附件 URL 存在 assetId 字段，无需还原）
        for (const s of ep?.shots || []) {
          for (const a of s?.referenceAssets || []) {
            if (a?.assetKey) frameAssetIds.add(a.assetKey);
          }
        }
      }
      if (frameAssetIds.size > 0) {
        try {
          const frameRes = await localApi.resolveImageAssets(projectId, { asset_ids: Array.from(frameAssetIds) });
          if (frameRes.success && frameRes.data) {
            const frameAssetMap = frameRes.data as Record<string, { url?: string }>;
            cleaned = cleaned.map((ep: any) => ({
              ...ep,
              firstFrameImageUrl: ep.firstFrameImageAssetId ? (frameAssetMap[ep.firstFrameImageAssetId]?.url ?? ep.firstFrameImageUrl) : ep.firstFrameImageUrl,
              lastFrameImageUrl: ep.lastFrameImageAssetId ? (frameAssetMap[ep.lastFrameImageAssetId]?.url ?? ep.lastFrameImageUrl) : ep.lastFrameImageUrl,
            }));
          }
        } catch (e) {
          console.warn('[loadWorkflowFromServer] 首尾帧图资产解析失败:', e);
        }
      }
      episodeData.episodes = cleaned;
    }

    // ========== 6. 非 drama 模式：从 project_assets 表读取 ==========
    if (!isDramaMode) {
      try {
        const projectAssetResponse = await localApi.getProjectAssets(projectId, category, 0);
        if (projectAssetResponse.success && projectAssetResponse.data?.data) {
          const unpacked = projectAssetResponse.data.data.data || projectAssetResponse.data.data;
          for (const key of PROJECT_DATA_FIELDS) {
            if (unpacked[key] !== undefined) projectData[key] = unpacked[key];
          }
          // 非 drama 模式下 characters/scenes 可能在 project_assets 中
          if (unpacked.characters) characters = unpacked.characters;
          if (unpacked.scenes) scenes = unpacked.scenes;
        }
      } catch (e) {
        console.warn('[loadWorkflowFromServer] 非 drama 项目资产加载失败:', e);
      }
    }

    console.log(`[loadWorkflowFromServer] 加载完成: chars=${characters.length}, scenes=${scenes.length}, projectKeys=${Object.keys(projectData).join(',')}, episodeKeys=${Object.keys(episodeData).join(',')}, scriptLen=${script.length}`);

    return {
      projectData,
      characters,
      scenes,
      props,
      episodeData,
      script,
      episodesNeedRecovery,
      episodeIdMap,
      episodeDataVersion,
    };
  } catch (e) {
    console.error('[loadWorkflowFromServer] load from server failed:', e);
    return null;
  } finally {
    setTimeout(() => { isLoadingFromServer = false; }, 100);
    console.log(`[episode=${episodeNumber}] [loadWorkflowFromServer] END`);
  }
}
