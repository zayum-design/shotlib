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

import { useState, useCallback } from 'react';
import {
  useWorkflowStore,
  loadAllEpisodesFromServer,
} from '@/modules/workflow/stores/workflowStore';
import {
  syncWorkflowToCloudApi,
  exportWorkflowZipApi,
} from '@/modules/workflow/api/workflowApi';
import { getEpisodeDataKey, getEpisodeAssetsKey, getScriptAssetKey } from '@/modules/workflow/utils/workflowUtils';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { extractDramaAssets, saveGeneratedAssets } from '@/shared/utils/generatedAssetsHistory';
import { localApi } from '@/storage';
import { buildUrl } from '@/shared/config/api';
import { message } from '@/shared/utils/message';

/**
 * 收集角色/场景中所有 assetId（用于导出/同步前解析 URL）
 */
function collectImageAssetIds(data: any): string[] {
  const ids = new Set<string>();

  const collectFromImageItem = (item: any) => {
    if (!item || typeof item !== 'object') return;
    if (item.assetId) ids.add(item.assetId);
  };

  const collectFromScene = (scene: any) => {
    if (!scene || typeof scene !== 'object') return;
    if (Array.isArray(scene.imageAssetIds)) {
      scene.imageAssetIds.forEach((id: string) => id && ids.add(id));
    }
  };

  const collectFromCharacter = (character: any) => {
    if (!character || typeof character !== 'object') return;
    (character.avatarImages || []).forEach(collectFromImageItem);
    (character.multiViewImages || []).forEach(collectFromImageItem);
    (character.fullBodyImages || []).forEach(collectFromImageItem);
  };

  const collectFromProp = (prop: any) => {
    if (!prop || typeof prop !== 'object') return;
    if (Array.isArray(prop.imageAssetIds)) {
      prop.imageAssetIds.forEach((id: string) => id && ids.add(id));
    }
  };

  if (Array.isArray(data.projectAssets?.characters)) {
    data.projectAssets.characters.forEach(collectFromCharacter);
  }
  if (Array.isArray(data.projectAssets?.scenes)) {
    data.projectAssets.scenes.forEach(collectFromScene);
  }
  if (Array.isArray(data.projectAssets?.props)) {
    data.projectAssets.props.forEach(collectFromProp);
  }

  if (data.episodesData && typeof data.episodesData === 'object') {
    for (const epData of Object.values(data.episodesData)) {
      const ep = epData as any;
      if (Array.isArray(ep.characters)) {
        ep.characters.forEach(collectFromCharacter);
      }
      if (Array.isArray(ep.scenes)) {
        ep.scenes.forEach(collectFromScene);
      }
    }
  }

  return Array.from(ids);
}

/**
 * 根据解析结果回填 imageUrl / imageUrls，同时把 image_asset.data 中的合规数据（seedance）
 * 附加到图片对象上，使导出的 JSON 携带合规状态，导入时可写入新项目的 image_asset.data。
 */
function fillImageUrls(
  data: any,
  mapping: Record<string, { url?: string; thumbnailUrl?: string; data?: Record<string, any> }>,
) {
  const fillItem = (item: any) => {
    if (!item || typeof item !== 'object' || !item.assetId) return;
    const resolved = mapping[item.assetId];
    if (!resolved) return;
    // 回填显示 URL（缺失时）
    if ((!item.imageUrl || item.imageUrl === '') && resolved.url) {
      item.imageUrl = resolved.url;
    }
    // 回填合规数据（image_asset.data 中的 seedance 等），供导入时写入新项目
    if (resolved.data && !item.seedance) {
      // 仅写入非空 data，避免覆盖已有值
      const seedance = resolved.data.seedance;
      if (seedance && typeof seedance === 'object') {
        item.seedance = seedance;
      }
    }
  };

  const fillScene = (scene: any) => {
    if (!scene || typeof scene !== 'object') return;
    const ids: string[] = scene.imageAssetIds || [];
    if (!ids.length) return;
    const urls: string[] = Array.isArray(scene.imageUrls) ? [...scene.imageUrls] : [];
    let changed = false;
    ids.forEach((id, index) => {
      if (!id) return;
      if (!urls[index] || urls[index] === '') {
        const resolved = mapping[id];
        if (resolved?.url) {
          urls[index] = resolved.url;
          changed = true;
        }
      }
    });
    if (changed) {
      scene.imageUrls = urls;
    }
  };

  const fillCharacter = (character: any) => {
    if (!character || typeof character !== 'object') return;
    (character.avatarImages || []).forEach(fillItem);
    (character.multiViewImages || []).forEach(fillItem);
    (character.fullBodyImages || []).forEach(fillItem);
  };

  // 道具图片是 imageAssetIds/imageUrls 平行数组（与场景一致）
  const fillProp = (prop: any) => {
    if (!prop || typeof prop !== 'object') return;
    const ids: string[] = prop.imageAssetIds || [];
    if (!ids.length) return;
    const urls: string[] = Array.isArray(prop.imageUrls) ? [...prop.imageUrls] : [];
    let changed = false;
    ids.forEach((id, index) => {
      if (!id) return;
      if (!urls[index] || urls[index] === '') {
        const resolved = mapping[id];
        if (resolved?.url) {
          urls[index] = resolved.url;
          changed = true;
        }
      }
    });
    if (changed) {
      prop.imageUrls = urls;
    }
  };

  if (Array.isArray(data.projectAssets?.characters)) {
    data.projectAssets.characters.forEach(fillCharacter);
  }
  if (Array.isArray(data.projectAssets?.scenes)) {
    data.projectAssets.scenes.forEach(fillScene);
  }
  if (Array.isArray(data.projectAssets?.props)) {
    data.projectAssets.props.forEach(fillProp);
  }

  if (data.episodesData && typeof data.episodesData === 'object') {
    for (const epData of Object.values(data.episodesData)) {
      const ep = epData as any;
      if (Array.isArray(ep.characters)) {
        ep.characters.forEach(fillCharacter);
      }
      if (Array.isArray(ep.scenes)) {
        ep.scenes.forEach(fillScene);
      }
    }
  }
}

/**
 * 剥离导出数据中的合规运行时字段。
 * 合规状态由 image_asset.data[compliance_key] 管理，不属于 character 行数据，
 * 导出时需转为 seedance 格式供导入时写入 image_asset.data。
 * 保留 assetId（image_asset UUID）与 imageUrl（解析后的可访问 URL），
 * 后端 asset processor 仍可据此下载图片。
 */
function stripComplianceFromExport(data: any) {
  // CharacterImage 已无 complianceAssetId / isCompliant 字段，
  // 此处保留函数签名，后续可按需剥离其他运行时字段
  void data;
}

/**
 * 导出时规范化角色图片的 imageUrl：将 /api/workspace/ 相对路径转为绝对 URL，
 * 使导出的 workflow-cloud.json 在任何环境下都能正确解析图片地址。
 */
function normalizeExportImageUrls(data: any) {
  const normalizeImage = (img: any) => {
    if (!img || typeof img !== 'object' || !img.imageUrl) return img;
    const url = img.imageUrl;
    if (url.startsWith('/api/workspace/') || url.startsWith('/api/creator/workspace/')) {
      img.imageUrl = buildUrl(url);
    }
    return img;
  };
  const normalizeCharacter = (character: any) => {
    if (!character || typeof character !== 'object') return character;
    (character.avatarImages || []).forEach(normalizeImage);
    (character.multiViewImages || []).forEach(normalizeImage);
    (character.fullBodyImages || []).forEach(normalizeImage);
    return character;
  };

  // 道具图片是 imageUrls 字符串数组，直接规范化每个 URL
  const normalizeProp = (prop: any) => {
    if (!prop || typeof prop !== 'object' || !Array.isArray(prop.imageUrls)) return prop;
    prop.imageUrls = prop.imageUrls.map((url: string) => {
      if (url && (url.startsWith('/api/workspace/') || url.startsWith('/api/creator/workspace/'))) {
        return buildUrl(url);
      }
      return url;
    });
    return prop;
  };

  if (Array.isArray(data.projectAssets?.characters)) {
    data.projectAssets.characters.forEach(normalizeCharacter);
  }
  if (Array.isArray(data.projectAssets?.props)) {
    data.projectAssets.props.forEach(normalizeProp);
  }
  if (data.episodesData && typeof data.episodesData === 'object') {
    for (const epData of Object.values(data.episodesData)) {
      const ep = epData as any;
      if (Array.isArray(ep.characters)) {
        ep.characters.forEach(normalizeCharacter);
      }
    }
  }
}

/**
 * 把 projectAssets.scenes / projectAssets.characters 的图片字段按 id 合并到各分集
 * 的 scenes / characters 副本中。
 *
 * 分集 episodesData 中的 scenes/characters 来自 localStorage 缓存，场景图生成后只
 * 更新了 state.scenes，缓存副本的 imageUrls 可能仍是空数组。projectAssets 取自
 * state.scenes/state.characters，是最新数据，作为合并来源，保证导出后各分集图片不丢。
 */
function syncEpisodeAssetsFromProject(
  episodesData: Record<number, any> | undefined,
  currentEpisodeData: any,
  projectAssets: any,
): void {
  const projectScenes = Array.isArray(projectAssets?.scenes) ? projectAssets.scenes : [];
  const projectCharacters = Array.isArray(projectAssets?.characters) ? projectAssets.characters : [];
  if (projectScenes.length === 0 && projectCharacters.length === 0) return;

  const sceneMap = new Map<string, any>();
  for (const s of projectScenes) {
    if (s && s.id) sceneMap.set(s.id, s);
  }
  const charMap = new Map<string, any>();
  for (const c of projectCharacters) {
    if (c && c.id) charMap.set(c.id, c);
  }

  const mergeScene = (scene: any): any => {
    if (!scene || typeof scene !== 'object' || !scene.id) return scene;
    const src = sceneMap.get(scene.id);
    if (!src) return scene;
    const merged = { ...scene };
    if ((!merged.imageUrls || merged.imageUrls.length === 0) && Array.isArray(src.imageUrls)) {
      merged.imageUrls = [...src.imageUrls];
    }
    if ((!merged.imageUrl || merged.imageUrl === '') && src.imageUrl) {
      merged.imageUrl = src.imageUrl;
    }
    if ((!merged.imageAssetIds || merged.imageAssetIds.length === 0) && Array.isArray(src.imageAssetIds)) {
      merged.imageAssetIds = [...src.imageAssetIds];
    }
    return merged;
  };

  const mergeCharacter = (char: any): any => {
    if (!char || typeof char !== 'object' || !char.id) return char;
    const src = charMap.get(char.id);
    if (!src) return char;
    const merged = { ...char };
    const pickImages = (field: string) => {
      const cur = merged[field];
      if ((!Array.isArray(cur) || cur.length === 0) && Array.isArray(src[field]) && src[field].length > 0) {
        merged[field] = src[field];
      }
    };
    pickImages('avatarImages');
    pickImages('multiViewImages');
    pickImages('fullBodyImages');
    return merged;
  };

  const mergeEpisode = (epData: any) => {
    if (!epData || typeof epData !== 'object') return;
    if (Array.isArray(epData.scenes)) {
      epData.scenes = epData.scenes.map(mergeScene);
    }
    if (Array.isArray(epData.characters)) {
      epData.characters = epData.characters.map(mergeCharacter);
    }
  };

  for (const epData of Object.values(episodesData || {})) {
    mergeEpisode(epData);
  }
  if (currentEpisodeData) {
    mergeEpisode(currentEpisodeData);
  }
}

/**
 * 将 workflow 数据中的 assetId 解析为 URL，确保后端 asset processor 能下载图片
 */
async function hydrateWorkflowImageUrls(projectId: string | undefined, data: any) {
  if (!projectId) return;
  const assetIds = collectImageAssetIds(data);
  if (assetIds.length === 0) return;

  try {
    console.log(`[hydrateWorkflowImageUrls] 解析 ${assetIds.length} 个 assetId`);
    const res = await localApi.resolveImageAssets(projectId, { asset_ids: assetIds });
    if (res.success && res.data) {
      fillImageUrls(data, res.data);
    } else {
      console.warn('[hydrateWorkflowImageUrls] 解析失败:', res.message);
    }
  } catch (e) {
    console.error('[hydrateWorkflowImageUrls] 解析异常:', e);
  }
}

export function useWorkflowSync(projectId: string | undefined) {
  const [isSyncing, setIsSyncing] = useState(false);

  // 构建完整项目数据（包含所有分集）
  const buildCompleteProjectData = useCallback(
    async (
      episodeList: number[],
      currentEpisode: number,
      episodeIdMap: Record<number, string>,
    ) => {
      const state = useWorkflowStore.getState();

      // 关键修复：按 id 去重 characters/scenes，防止 store 中有重复角色时导出重复数据
      const dedupeById = (items: any[]): any[] => {
        const seen = new Set<string>();
        return items.filter((item: any) => {
          if (!item?.id) return true;
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      };
      const uniqueCharacters = dedupeById(state.characters || []);
      const uniqueScenes = dedupeById(state.scenes || []);
      const uniqueProps = dedupeById(state.props || []);

      const projectAssets = {
        textModel: state.textModel,
        imageModel: state.imageModel,
        videoModel: state.videoModel,
        sceneModel: state.sceneModel,
        eraModel: state.eraModel,
        voiceModel: state.voiceModel,
        agentType: state.agentType,
        artStyle: state.artStyle,
        artStylePromptHint: state.artStylePromptHint,
        skills: state.skills,
        genre: state.genre,
        characters: uniqueCharacters,
        scenes: uniqueScenes,
        props: uniqueProps,
        era: state.era,
        relationshipNetwork: state.relationshipNetwork,
        textModels: state.textModels,
        imageModels: state.imageModels,
        videoModels: state.videoModels,
        voiceModels: state.voiceModels,
        audioAssets: state.audioAssets,
        // script 是项目级别数据，放在 projectAssets 中以便导入/导出时正确保留
        script: state.script,
      };

      const episodesData: Record<number, unknown> = {};
      for (const epNum of episodeList) {
        const epKey = getEpisodeDataKey(projectId!, epNum);
        try {
          const raw = userStorage.getItem(epKey);
          if (raw) {
            episodesData[epNum] = JSON.parse(raw);
          }
        } catch (e) {
          console.warn(`[buildCompleteProjectData] 读取第${epNum}集数据失败:`, e);
        }

        // 缓存缺失时（fresh 浏览器或从未编辑过该集）从后端回退加载，
        // 否则转无限画布/下载数据会缺少该集片段
        if (!episodesData[epNum] && episodeIdMap?.[epNum]) {
          try {
            const epRes = await localApi.getDramaEpisode(episodeIdMap[epNum]);
            const dramaData = epRes.success ? epRes.data?.episodeData?.data : null;
            if (dramaData && Object.keys(dramaData).some((k) => k !== '_savedAt')) {
              episodesData[epNum] = dramaData;
            }
          } catch (e) {
            console.warn(`[buildCompleteProjectData] 后端加载第${epNum}集数据失败:`, e);
          }
        }

        // 关键修复：把每集的 characters/scenes 资产也合并到 episodesData，
        // 否则多集项目导出后其它分集缺少角色/场景，导致 step2 无法点击
        const epAssetsKey = getEpisodeAssetsKey(projectId!, epNum);
        try {
          const rawAssets = userStorage.getItem(epAssetsKey);
          if (rawAssets) {
            const epAssets = JSON.parse(rawAssets);
            const existing = (episodesData[epNum] as Record<string, any>) || {};
            if (epAssets.characters !== undefined && existing.characters === undefined) {
              existing.characters = epAssets.characters;
            }
            if (epAssets.scenes !== undefined && existing.scenes === undefined) {
              existing.scenes = epAssets.scenes;
            }
            episodesData[epNum] = existing;
          }
        } catch (e) {
          console.warn(`[buildCompleteProjectData] 读取第${epNum}集资产失败:`, e);
        }

        // 关键修复：把每集的剧本也合并到 episodesData，
        // 否则多集项目导出后其它分集缺少 script，导入时 step1 显示空白
        const existingEp = (episodesData[epNum] as Record<string, any>) || {};
        if (!existingEp.script) {
          // 优先从 localStorage 读取
          const scriptKey = getScriptAssetKey(projectId!, epNum);
          let epScript: string | undefined;
          try {
            const rawScript = userStorage.getItem(scriptKey);
            if (rawScript) epScript = rawScript;
          } catch { /* ignore */ }
          // localStorage 无数据时从后端 script 资产行加载
          if (!epScript) {
            try {
              const scriptRes = await localApi.getProjectAssets(projectId!, 'script', epNum);
              if (scriptRes.success && scriptRes.data?.data) {
                const raw = scriptRes.data.data;
                const unpacked = raw.data || raw;
                if (typeof unpacked.script === 'string' && unpacked.script.trim()) {
                  epScript = unpacked.script;
                }
              }
            } catch { /* ignore */ }
          }
          if (epScript) {
            existingEp.script = epScript;
            episodesData[epNum] = existingEp;
          }
        }
      }

      const currentEpisodeData = {
        currentStep: state.currentStep,
        topic: state.topic,
        summary: state.summary,
        previousEpisodeScript: state.previousEpisodeScript,
        previousEpisodeSummary: state.previousEpisodeSummary,
        isEnding: state.isEnding,
        isSimplifiedMode: state.isSimplifiedMode,
        activeCharacterIds: state.activeCharacterIds,
        activeSceneIds: state.activeSceneIds,
        characters: uniqueCharacters,
        scenes: uniqueScenes,
        props: uniqueProps,
        era: state.era,
        relationshipNetwork: state.relationshipNetwork,
        episodes: state.episodes,
      };

      const projectData = {
        version: 2,
        category: 'workflow',
        projectId,
        projectAssets,
        episodesData,
        currentEpisode,
        episodeList,
        episodeIdMap,
        currentEpisodeData,
        exportedAt: Date.now(),
      };

      // 关键修复：导出/同步前剥离合规运行时字段（仅存 image_asset.data.seedance，不下沉到 character 行）
      stripComplianceFromExport(projectData);
      // 关键修复：导出/同步前把 assetId 解析为 URL（resolveImageAssets 会将 /api/workspace/ 本地路径代理到 OSS）
      await hydrateWorkflowImageUrls(projectId, projectData);
      // 兜底：对残余的 /api/workspace/ 相对地址规范化（正常情况此时不应再有本地路径）
      normalizeExportImageUrls(projectData);
      // 关键修复：分集 episodesData 中的 scenes/characters 来自 localStorage 缓存，
      // 其 imageUrls 可能为空（场景图生成只更新了 state.scenes），按 id 从 projectAssets
      // 合并最新图片字段，保证导出后各分集场景图/角色图不丢失
      syncEpisodeAssetsFromProject(projectData.episodesData, projectData.currentEpisodeData, projectData.projectAssets);

      return projectData;
    },
    [projectId],
  );

  // 将后端返回的云端 workflowData 应用到本地状态
  const applyCloudWorkflowData = useCallback(
    (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: any,
      setEpisodeList: (list: number[]) => void,
      setEpisodeIdMap: (map: Record<number, string>) => void,
      setCurrentEpisode: (ep: number) => void,
    ) => {
      if (!data) return;
      if (data.version === 2 && data.projectAssets) {
        useWorkflowStore.setState((prev) => ({
          ...data.projectAssets,
          ...data.currentEpisodeData,
          characters: data.projectAssets.characters ?? prev.characters ?? [],
          scenes: data.projectAssets.scenes ?? prev.scenes ?? [],
          episodes: data.currentEpisodeData?.episodes ?? prev.episodes ?? [],
          skills: data.projectAssets.skills ?? prev.skills ?? ['character', 'scene', 'dialogue', 'plot'],
          textModels: data.projectAssets.textModels ?? prev.textModels,
          imageModels: data.projectAssets.imageModels ?? prev.imageModels,
          videoModels: data.projectAssets.videoModels ?? prev.videoModels,
          voiceModels: data.projectAssets.voiceModels ?? prev.voiceModels,
          audioAssets: data.projectAssets.audioAssets ?? prev.audioAssets ?? [],
        }));
        if (data.episodeList && Array.isArray(data.episodeList)) {
          setEpisodeList(data.episodeList);
        }
        if (data.episodeIdMap && typeof data.episodeIdMap === 'object') {
          setEpisodeIdMap(data.episodeIdMap);
        }
        if (data.currentEpisode && typeof data.currentEpisode === 'number') {
          setCurrentEpisode(data.currentEpisode);
        }
        if (data.episodesData && typeof data.episodesData === 'object') {
          for (const [epNumStr, epData] of Object.entries(data.episodesData)) {
            const epNum = Number(epNumStr);
            if (!isNaN(epNum) && epData) {
              try {
                const epKey = getEpisodeDataKey(projectId!, epNum);
                userStorage.setItem(epKey, JSON.stringify(epData));
              } catch (e) {
                console.warn(`[云端同步] 恢复第${epNum}集数据到 localStorage 失败:`, e);
              }
            }
          }
        }
      } else {
        useWorkflowStore.setState((prev) => ({
          ...data,
          characters: data.characters ?? prev.characters ?? [],
          scenes: data.scenes ?? prev.scenes ?? [],
          episodes: data.episodes ?? prev.episodes ?? [],
          skills: data.skills ?? prev.skills ?? ['character', 'scene', 'dialogue', 'plot'],
          textModels: data.textModels ?? prev.textModels,
          imageModels: data.imageModels ?? prev.imageModels,
          videoModels: data.videoModels ?? prev.videoModels,
          voiceModels: data.voiceModels ?? prev.voiceModels,
          audioAssets: data.audioAssets ?? prev.audioAssets ?? [],
        }));
      }
      const assets = extractDramaAssets(data, projectId!);
      if (assets.length > 0) {
        saveGeneratedAssets(assets);
        console.log(`已保存 ${assets.length} 条 Drama 生成资产到本地历史记录`);
      }
    },
    [projectId],
  );

  // 下载数据（直接导出 zip，不再先同步到 OSS）
  const handleDownloadData = useCallback(
    async (
      episodeList: number[],
      currentEpisode: number,
      episodeIdMap: Record<number, string>,
      _setEpisodeList: (list: number[]) => void,
      _setEpisodeIdMap: (map: Record<number, string>) => void,
      _setCurrentEpisode: (ep: number) => void,
    ) => {
      if (!projectId) {
        message.warning('请先选择项目');
        return;
      }

      setIsSyncing(true);
      try {
        const loadedCount = await loadAllEpisodesFromServer(projectId);
        if (loadedCount > 0) {
          console.log(`[下载数据] 已加载 ${loadedCount} 个分集数据`);
        }

        const projectData = await buildCompleteProjectData(episodeList, currentEpisode, episodeIdMap);
        const workflowData = JSON.parse(JSON.stringify(projectData));

        await exportWorkflowZipApi(projectId, workflowData);
        message.success('打包文件下载已启动');
      } catch (error) {
        console.error('下载打包文件失败:', error);
        message.error(`下载失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        setIsSyncing(false);
      }
    },
    [projectId, buildCompleteProjectData],
  );

  return {
    isSyncing,
    buildCompleteProjectData,
    applyCloudWorkflowData,
    handleDownloadData,
  };
}
