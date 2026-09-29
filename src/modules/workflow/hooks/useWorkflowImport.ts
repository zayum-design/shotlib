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

import { createElement, useCallback, useRef, useState } from 'react';
import { Modal } from 'antd';
import {
  useWorkflowStore,
  saveToServer,
  saveEpisodeDataToServer,
  saveScriptToStorage,
  saveProjectAssetsToStorage,
  saveEpisodeDataToStorage,
  cancelDebouncedSave,
} from '@/modules/workflow/stores/workflowStore';
import { getEpisodeDataKey, getProjectAssetsKey } from '@/modules/workflow/utils/workflowUtils';
import { saveGuard } from '@/modules/workflow/utils/workflowSaveGuard';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { remapImportedIds } from '@/modules/workflow/utils/importIdRemapUtils';
import { localApi } from '@/storage';
import {
  extractScriptText,
  detectCompletedStepCount,
  filterImportDataBySteps,
} from '@/modules/workflow/utils/importStepUtils';
import { ImportStepSelectModal } from '@/modules/workflow/components/ImportStepSelectModal';
import { useSearchParams } from 'react-router-dom';
import { message } from '@/shared/utils/message';

/**
 * 清除项目图片资产的 assetId / imageAssetIds
 *
 * 导入通常是跨项目操作，旧的 assetId 指向原项目的 creator_drama_project_assets，
 * 保留会导致新项目中解析到不存在的图片资产。清除后前端会回退到 imageUrl。
 */
function stripProjectImageAssetIds(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(stripProjectImageAssetIds);
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // 剥离图片对象顶层的 assetId（image_asset UUID，指向原项目，需在新项目重建）
      // 但保留 seedance 内部的 assetId（火山合规 assetId，跨项目通用，导入时写入 image_asset.data）
      if (key === 'assetId' || key === 'imageAssetIds') {
        continue;
      }
      // seedance 是合规数据对象，内部 assetId 是火山合规 ID，不递归剥离
      if (key === 'seedance') {
        result[key] = value;
      } else {
        result[key] = stripProjectImageAssetIds(value);
      }
    }
    return result;
  }
  return obj;
}

/**
 * 把 projectAssets.scenes / projectAssets.characters 的图片字段（imageUrls、imageUrl、
 * imageAssetIds、avatarImages、multiViewImages、fullBodyImages）按 id 合并到各分集
 * 的 scenes / characters 副本中。
 *
 * 背景：分集 scenes/characters 来自 localStorage 的 getEpisodeAssetsKey 缓存，
 * 场景图生成后只更新了 state.scenes，缓存副本的 imageUrls 可能仍是空数组，
 * 导致导出后 episodesData 中的 scenes 没有图片。projectAssets 取自 state.scenes/
 * state.characters，是最新数据，因此作为合并来源。
 */
function syncEpisodeAssetsFromProject(
  episodesData: Record<number, any>,
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

  // 合并单条 scene 的图片字段
  const mergeScene = (scene: any): any => {
    if (!scene || typeof scene !== 'object' || !scene.id) return scene;
    const src = sceneMap.get(scene.id);
    if (!src) return scene;
    const merged = { ...scene };
    // 图片字段以 projectAssets 为准（最新），分集副本只在为空时回填，避免覆盖已有
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

  // 合并单条 character 的图片字段
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
 * 根据实际数据校准 currentStep，避免有片段但 step 不可点击
 *
 * 导出数据中 currentStep 可能滞后于实际数据（如用户回到 step1 修改后导出），
 * 导入后需根据片段/角色场景数据将 currentStep 推进到合理位置。
 */
function calibrateCurrentStep(
  currentStep: number,
  episodes: any[],
  activeCharacterIds: string[],
  activeSceneIds: string[],
  isSimplifiedMode: boolean,
): number {
  const hasEpisodes = Array.isArray(episodes) && episodes.length > 0;
  const hasActiveCharScene = (activeCharacterIds?.length ?? 0) > 0 || (activeSceneIds?.length ?? 0) > 0;
  const targetForEpisodes = isSimplifiedMode ? 2 : 3;
  const targetForSplit = isSimplifiedMode ? 1 : 2;

  let step = currentStep;
  if (hasEpisodes && step < targetForEpisodes) step = targetForEpisodes;
  else if (hasActiveCharScene && step < targetForSplit) step = targetForSplit;
  return step;
}

interface UseWorkflowImportOptions {
  projectId: string | undefined;
  currentEpisode: number;
  setEpisodeList: (list: number[]) => void;
  setEpisodeIdMap: (map: Record<number, string>) => void;
  setCurrentEpisode: (ep: number) => void;
  saveEpisodeData: (projectId: string, episode: number) => Promise<boolean> | boolean;
  saveProjectEpisodeInfo: (
    projectId: string,
    episodes: number[],
    currentEpisode: number,
    episodeIdMap: Record<number, string>,
  ) => void;
  resetLoadingStates: () => void;
}

/**
 * 导入时为角色图片补建 image_asset 行。
 *
 * 跨项目导入时旧 assetId 已被 stripProjectImageAssetIds 剥离（指向原项目），
 * 仅靠 character 行的 imageUrl 不足以让新项目的 resolveImageAssets / 合规检查工作。
 * 这里按 imageUrl 在当前项目批量新建 image_asset 行（asset_type='character_image'），
 * 并把返回的 assetId 回填到所有引用该 url 的角色图片上（master + 各分集副本）。
 */
async function ensureCharacterImageAssets(
  projectId: string,
  cleanedAssets: any,
  cleanedEpisodesData: Record<number, any>,
): Promise<void> {
  type Pending = {
    url: string;
    episode_number: number;
    metadata: Record<string, any>;
    complianceData?: Record<string, any>; // 合规数据（seedance 格式）
  };
  const pending: Pending[] = [];
  const urlToRefs = new Map<string, any[]>(); // url -> 引用该 url 的所有 image 对象

  const visitImage = (img: any, character: any, kind: string, episodeNumber: number) => {
    if (!img || typeof img !== 'object') return;
    const url = img.imageUrl;
    if (!url) return;
    if (!urlToRefs.has(url)) {
      urlToRefs.set(url, []);
      // 收集合规数据：支持新格式（seedance 对象）和旧格式（complianceAssetId/isCompliant）兼容
      let complianceData: Record<string, any> | undefined;
      if (img.seedance) {
        // 新格式：直接使用 seedance 对象
        complianceData = { seedance: img.seedance };
      } else if (img.complianceAssetId || img.isCompliant) {
        // 旧格式兼容：complianceAssetId/isCompliant → seedance 格式
        const seedance: Record<string, any> = {};
        if (img.complianceAssetId) seedance.assetId = img.complianceAssetId;
        if (img.isCompliant !== undefined) seedance.isCompliant = img.isCompliant;
        if (Object.keys(seedance).length > 0) {
          complianceData = { seedance };
        }
      }
      pending.push({
        url,
        episode_number: episodeNumber || 1,
        metadata: {
          characterId: character?.id,
          characterName: character?.name,
          name: img.name ?? '',
          prompt: img.prompt ?? '',
          kind,
        },
        complianceData,
      });
    }
    urlToRefs.get(url)!.push(img);
  };

  const visitCharacter = (character: any, episodeNumber?: number) => {
    if (!character) return;
    const fallbackEp = episodeNumber ?? 1;
    (character.avatarImages || []).forEach((i: any) => visitImage(i, character, 'avatar', fallbackEp));
    (character.multiViewImages || []).forEach((i: any) => visitImage(i, character, 'multiview', fallbackEp));
    (character.fullBodyImages || []).forEach((i: any) =>
      visitImage(i, character, 'fullbody', i?.episodeNumber ?? fallbackEp),
    );
  };

  if (Array.isArray(cleanedAssets?.characters)) {
    cleanedAssets.characters.forEach((c: any) => visitCharacter(c, 1));
  }

  // 道具图片：imageUrls/imageAssetIds 平行数组（assetId 已剥离），按 url 重建 prop_image 资产行
  if (Array.isArray(cleanedAssets?.props)) {
    for (const prop of cleanedAssets.props) {
      if (!prop || typeof prop !== 'object') continue;
      const urls: string[] = Array.isArray(prop.imageUrls) ? prop.imageUrls.filter(Boolean) : [];
      if (urls.length === 0) continue;
      try {
        const res = await localApi.createImageAssets(projectId, {
          assets: urls.map((url) => ({
            episode_number: 0,
            asset_type: 'prop_image',
            original_url: url,
            source: 'ai',
            metadata: { propId: prop.id, propName: prop.name, kind: 'prop' },
          })),
        });
        if (res.success && Array.isArray(res.data)) {
          const newIds = res.data.map((created: any) => created?.id).filter(Boolean);
          if (newIds.length === urls.length) {
            prop.imageAssetIds = newIds;
          }
        }
      } catch (e) {
        console.warn('[ensureCharacterImageAssets] 重建道具图片资产失败:', prop?.name, e);
      }
    }
  }

  for (const epData of Object.values(cleanedEpisodesData || {})) {
    const ep = epData as any;
    if (Array.isArray(ep?.characters)) {
      ep.characters.forEach((c: any) => visitCharacter(c, ep?.currentEpisode));
    }
  }

  if (pending.length === 0) return;

  try {
    const res = await localApi.createImageAssets(projectId, {
      assets: pending.map((p) => ({
        episode_number: p.episode_number,
        asset_type: 'character_image',
        original_url: p.url,
        source: 'ai',
        metadata: p.metadata,
      })),
    });
    if (!res.success || !Array.isArray(res.data) || res.data.length === 0) {
      console.warn('[ensureCharacterImageAssets] 创建 image_asset 失败:', res.message);
      return;
    }
    // createImageAssets 返回顺序与入参一致；按 original_url 建立映射
    const urlToAssetId = new Map<string, string>();
    res.data.forEach((created: any, idx: number) => {
      const id = created?.id;
      const url = created?.data?.original_url || pending[idx]?.url;
      if (id && url) urlToAssetId.set(url, id);
    });
    for (const [url, imgs] of urlToRefs) {
      const assetId = urlToAssetId.get(url);
      if (!assetId) continue;
      imgs.forEach((img) => {
        img.assetId = assetId;
      });
    }
    console.log(`[ensureCharacterImageAssets] 已创建 ${urlToAssetId.size} 条 image_asset 行`);

    // 写入合规数据到新项目的 image_asset.data.seedance
    // 避免导入后需要重新进行合规检查
    const compliancePending = pending.filter((p) => p.complianceData);
    if (compliancePending.length > 0) {
      let complianceCount = 0;
      for (const p of compliancePending) {
        const assetKey = urlToAssetId.get(p.url);
        if (!assetKey || !p.complianceData) continue;
        try {
          await localApi.patchImageAssetData(projectId, assetKey, p.complianceData);
          complianceCount++;
        } catch (e) {
          console.warn(`[ensureCharacterImageAssets] 写入合规数据失败: assetKey=${assetKey}`, e);
        }
      }
      if (complianceCount > 0) {
        console.log(`[ensureCharacterImageAssets] 已写入 ${complianceCount} 条合规数据`);
      }
    }
  } catch (e) {
    console.error('[ensureCharacterImageAssets] 异常:', e);
  }
}

/**
 * Workflow 数据导入 Hook：负责解析用户上传的 JSON 文件，
 * 同时支持 v2 完整项目格式与旧版平铺格式。
 */
export function useWorkflowImport(options: UseWorkflowImportOptions) {
  const {
    projectId,
    currentEpisode,
    setEpisodeList,
    setEpisodeIdMap,
    setCurrentEpisode,
    saveEpisodeData,
    saveProjectEpisodeInfo,
    resetLoadingStates,
  } = options;

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 待导入数据 + 检测到的完成步数（弹窗选择导入前 N 步）
  const [pendingImport, setPendingImport] = useState<{
    data: any;
    stepCount: number;
    episodeCount?: number;
  } | null>(null);

  const [, setSearchParams] = useSearchParams();

  /** 实际执行导入：按所选步数过滤后清空目标项目并写入 */
  const proceedImport = useCallback(
    async (rawData: any, maxStep: number) => {
      if (!projectId) {
        message.error('导入失败：当前项目 ID 为空');
        return;
      }
      // 设置导入锁：导入执行期间阻止项目切换等并发操作
      useWorkflowStore.getState().setIsImporting(true);
      try {
        try {
          await localApi.clearProjectData(projectId);
        } catch (e) {
          console.error('[导入] 清空项目数据失败:', e);
          message.error('导入失败：清空项目数据失败，请重试');
          return;
        }

        // 按所选步数过滤数据（只保留前 maxStep 步的产物）
        const data = filterImportDataBySteps(rawData, maxStep);

        if (data.version === 2 && data.projectAssets) {
          await applyV2ProjectData(data, {
            projectId,
            currentEpisode,
            setEpisodeList,
            setEpisodeIdMap,
            setCurrentEpisode,
            saveProjectEpisodeInfo,
          });
        } else {
          applyLegacyData(data, {
            projectId,
            currentEpisode,
            saveEpisodeData,
          });
        }

        // 重置加载状态
        resetLoadingStates();
        message.success(`已导入前 ${maxStep} 步数据`);

        // 跳转到导入的步骤（URL step 从 1 开始）
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('step', String(maxStep));
            return next;
          },
          { replace: true },
        );
      } finally {
        // 释放导入锁
        useWorkflowStore.getState().setIsImporting(false);
      }
    },
    [projectId, currentEpisode, setEpisodeList, setEpisodeIdMap, setCurrentEpisode, saveEpisodeData, saveProjectEpisodeInfo, resetLoadingStates, setSearchParams],
  );

  /** 步骤选择弹窗确认后：走原有的两次高危确认，再执行导入 */
  const handleStepSelectConfirm = useCallback(
    (maxStep: number) => {
      const pending = pendingImport;
      setPendingImport(null);
      if (!pending) return;
      const rawData = pending.data;

      Modal.confirm({
        title: '确认导入？',
        content: `⚠️ 高危操作：将清空当前项目的所有分集、片段、角色、场景、剧本、图片、快照和生成任务记录，并替换为导入内容（前 ${maxStep} 步数据），删除后无法恢复。`,
        okText: '继续',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          Modal.confirm({
            title: '再次确认导入？',
            content: '这是最后一次确认，清空后数据无法恢复！',
            okText: '确认导入',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: () => proceedImport(rawData, maxStep),
          });
        },
      });
    },
    [pendingImport, proceedImport],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // 导入锁：防止同一标签页内并发导入导致数据混乱
      if (useWorkflowStore.getState().isImporting) {
        message.warning('正在导入中，请稍候');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        // 设置导入锁
        useWorkflowStore.getState().setIsImporting(true);
        try {
          const content = event.target?.result as string;
          const data = JSON.parse(content);

          // 基础验证：检查是否是有效的 workflow 数据
          if (typeof data !== 'object' || data === null) {
            message.error('导入失败：文件格式不正确');
            return;
          }

          // 检查跨模式导入：剧本模式只能导入 workflow 数据
          if (data.category && data.category !== 'workflow') {
            message.error(`导入失败：该文件是${data.category === 'instant' ? '即时创作' : data.category}模式的数据，不能导入到剧本创作中`);
            return;
          }

          // 检查关键字段，确保是 workflow 数据
          const isV2ProjectData = data.version === 2 && data.projectAssets;
          const hasWorkflowData =
            isV2ProjectData ||
            typeof data.script === 'string' ||
            Array.isArray(data.characters) ||
            Array.isArray(data.scenes) ||
            Array.isArray(data.episodes) ||
            typeof data.topic === 'string';

          if (!hasWorkflowData) {
            message.error('导入失败：未识别到有效的工作流数据');
            return;
          }

          // 识别文件中已完成的步数（连续，1-5）
          const stepCount = detectCompletedStepCount(data);
          if (stepCount < 1) {
            message.error('导入失败：文件中未检测到已完成的步骤数据（无剧本文本）');
            return;
          }

          // 打开步骤选择弹窗：用户选择导入前 N 步（连续，不可隔步）
          setPendingImport({
            data,
            stepCount,
            episodeCount: Array.isArray(data.episodeList) ? data.episodeList.length : undefined,
          });
        } catch (err) {
          console.error('导入数据失败:', err);
          message.error('导入失败：文件解析错误，请确认是有效的 JSON 文件');
        } finally {
          // 释放导入锁（解析阶段结束，弹窗期间允许用户取消）
          useWorkflowStore.getState().setIsImporting(false);
          // 清空 input，允许重复选择同一文件
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }
      };
      reader.onerror = () => {
        message.error('导入失败：文件读取错误');
        // 释放导入锁（文件读取错误时也需要释放）
        useWorkflowStore.getState().setIsImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      };
      reader.readAsText(file);
    },
    [],
  );

  // 步骤选择弹窗（由页面渲染；.ts 文件中用 createElement 避免 JSX 语法）
  const importStepModal = pendingImport
    ? createElement(ImportStepSelectModal, {
        open: true,
        stepCount: pendingImport.stepCount,
        episodeCount: pendingImport.episodeCount,
        onCancel: () => setPendingImport(null),
        onConfirm: handleStepSelectConfirm,
      })
    : null;

  return { fileInputRef, handleFileChange, importStepModal };
}

// ===== v2 完整项目数据处理 =====
async function applyV2ProjectData(
  data: any,
  ctx: {
    projectId: string | undefined;
    currentEpisode: number;
    setEpisodeList: (list: number[]) => void;
    setEpisodeIdMap: (map: Record<number, string>) => void;
    setCurrentEpisode: (ep: number) => void;
    saveProjectEpisodeInfo: (
      projectId: string,
      episodes: number[],
      currentEpisode: number,
      episodeIdMap: Record<number, string>,
    ) => void;
  },
) {
  const { projectId, currentEpisode, setEpisodeList, setEpisodeIdMap, setCurrentEpisode, saveProjectEpisodeInfo } = ctx;

  if (!projectId) {
    message.error('导入失败：当前项目 ID 为空');
    return;
  }

  // 捕获导入开始时的项目 ID，用于后续关键操作前校验项目上下文
  // 防止导入过程中用户切换项目导致数据写入错误项目
  const importProjectId = projectId;

  /** 校验当前项目是否与导入时一致，不一致则中止导入 */
  const validateProjectContext = (operation: string): boolean => {
    const currentPid = useWorkflowStore.getState().currentProjectId;
    if (currentPid !== importProjectId) {
      console.warn(`[导入] 项目上下文已变更（导入项目=${importProjectId}，当前项目=${currentPid}），中止操作：${operation}`);
      return false;
    }
    return true;
  };

  // 诊断：订阅 store.episodes 长度变化，捕获导入过程中 episodes 何时被清空
  const __unsubImport = useWorkflowStore.subscribe((state: any, prev: any) => {
    const cur = state.episodes?.length ?? -1;
    const pre = prev.episodes?.length ?? -1;
    if (cur !== pre) {
      console.warn('[导入诊断-SUB] episodes', pre, '→', cur, 'epNum=' + state.currentEpisodeNumber, 'activeChar=' + (state.activeCharacterIds?.length ?? -1));
      try { console.warn(new Error().stack); } catch { /* ignore */ }
    }
  });

  const rawAssets = data.projectAssets || {};
  const rawEpisodesData = data.episodesData || {};
  const currentEpisodeData = data.currentEpisodeData || {};

  // ID 重映射（同时重映射 currentEpisodeData，确保回退路径 ID 一致）
  const {
    assets,
    episodesData: remappedEpisodesData,
    episodeIdMap: remappedEpisodeIdMap,
    currentEpisodeData: remappedCurrentEpisodeDataRaw,
  } = remapImportedIds(rawAssets, rawEpisodesData, undefined, currentEpisodeData);

  // 关键修复：导入的数据中 assetId 指向原项目，需清除，避免写入新项目后解析失败
  const cleanedAssets = stripProjectImageAssetIds(assets);
  const cleanedEpisodesData: Record<number, any> = {};
  for (const [epNumStr, epData] of Object.entries(remappedEpisodesData)) {
    cleanedEpisodesData[Number(epNumStr)] = stripProjectImageAssetIds(epData);
  }
  // currentEpisodeData 同样剥离 assetId，保持与分集数据一致的处理
  const remappedCurrentEpisodeData = stripProjectImageAssetIds(remappedCurrentEpisodeDataRaw) || {};

  // 关键修复：导出数据中角色/场景可能重复（projectAssets + episodesData 各有一套），
  // 按 id 去重，保留第一次出现的条目（通常图片更完整）
  const dedupeById = (items: any[]): any[] => {
    const seen = new Set<string>();
    return items.filter((item: any) => {
      if (!item?.id) return true; // 无 id 的保留
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };
  if (Array.isArray(cleanedAssets.characters)) {
    cleanedAssets.characters = dedupeById(cleanedAssets.characters);
  }
  if (Array.isArray(cleanedAssets.scenes)) {
    cleanedAssets.scenes = dedupeById(cleanedAssets.scenes);
  }
  if (Array.isArray(cleanedAssets.props)) {
    cleanedAssets.props = dedupeById(cleanedAssets.props);
  }
  for (const epData of Object.values(cleanedEpisodesData)) {
    const ep = epData as any;
    if (Array.isArray(ep?.characters)) ep.characters = dedupeById(ep.characters);
    if (Array.isArray(ep?.scenes)) ep.scenes = dedupeById(ep.scenes);
  }
  if (Array.isArray(remappedCurrentEpisodeData?.characters)) {
    remappedCurrentEpisodeData.characters = dedupeById(remappedCurrentEpisodeData.characters);
  }
  if (Array.isArray(remappedCurrentEpisodeData?.scenes)) {
    remappedCurrentEpisodeData.scenes = dedupeById(remappedCurrentEpisodeData.scenes);
  }

  // 关键修复：旧版导出没有为每集单独保存 characters/scenes，
  // 导入时若某分集缺少，则回退到 projectAssets 的角色/场景，避免 step2 无法点击
  const sortedEpisodeNumbers = Object.keys(cleanedEpisodesData)
    .map((n) => Number(n))
    .sort((a, b) => a - b);
  for (const epNum of sortedEpisodeNumbers) {
    const epData = cleanedEpisodesData[epNum];
    if (!epData) continue;
    if (!Array.isArray(epData.characters) || epData.characters.length === 0) {
      epData.characters = JSON.parse(JSON.stringify(cleanedAssets.characters || []));
    }
    if (!Array.isArray(epData.scenes) || epData.scenes.length === 0) {
      epData.scenes = JSON.parse(JSON.stringify(cleanedAssets.scenes || []));
    }
  }

  // 关键修复：分集 scenes 的 imageUrls 来自陈旧的 localStorage 缓存，可能为空，
  // 而场景图实际存储在 projectAssets.scenes（导出时取自 state.scenes，最新）。
  // 这里按 id 把 projectAssets.scenes 的 imageUrls/imageAssetIds/imageUrl 合并到各分集 scenes，
  // 保证导入后场景图正确显示。characters 同理合并图片字段。
  syncEpisodeAssetsFromProject(cleanedEpisodesData, remappedCurrentEpisodeData, cleanedAssets);

  // 导入数据的目标分集：以文件记录的 currentEpisode 为准，默认第1集
  const targetEpisodeNum = data.currentEpisode || 1;
  // 优先使用已重映射的分集数据；缺失时回退到重映射后的 currentEpisodeData（ID 已对齐）
  const targetEpisodeData = cleanedEpisodesData[targetEpisodeNum] || remappedCurrentEpisodeData || {};
  console.log('[导入诊断-A] targetEpisodeData', {
    targetEpisodeNum,
    eps: targetEpisodeData?.episodes?.length,
    activeChar: targetEpisodeData?.activeCharacterIds?.length,
    activeScene: targetEpisodeData?.activeSceneIds?.length,
    cleanedKeys: Object.keys(cleanedEpisodesData),
  });

  // 关键修复：跨项目导入后旧 assetId 已剥离，按 imageUrl 在当前项目新建 image_asset 行并回填 assetId，
  // 使 resolveImageAssets / 合规检查在新项目可用（character 行同步带上 assetId）
  // 但先删除该项目旧的角色/场景/image_asset 行，避免新旧 ID 不同导致 loadWorkflowFromServer 时返回重复角色

  // 校验项目上下文：ensureCharacterImageAssets 前确认项目未切换
  if (!validateProjectContext('ensureCharacterImageAssets')) {
    message.warning('导入已中止：项目已切换');
    return;
  }

  // 项目旧数据已在导入前由 clearProjectData 彻底清空（drama-episode.service.clearProjectData），
  // 此处不再单独删除资产；ensureCharacterImageAssets 会按导入数据重建 image_asset 行。
  await ensureCharacterImageAssets(projectId, cleanedAssets, cleanedEpisodesData);

  // 项目级剧本（旧格式回退用）和目标分集专属剧本
  const importedScript = typeof cleanedAssets.script === 'string' ? cleanedAssets.script : '';
  // 关键修复：目标分集应使用自己的剧本，而非项目级剧本（两者可能不同）
  // 注意：episodesData 中的 script 字段可能是 JSON 编码的 {"script":"..."} 字符串，
  // 需要解析提取纯文本；projectAssets.script 则是纯文本。
  const targetScript = extractScriptText(targetEpisodeData.script) || importedScript;

  // 取消可能存在的待执行自动保存，避免导入过程中数据被写到错误分集
  cancelDebouncedSave();
  // 关键修复：清除 SaveGuard 快照和重置标记，避免导入前后数据量差异导致保存被拦截
  saveGuard.clearSnapshot();
  saveGuard.clearResetMark();

  // 校验项目上下文：setState 写入前确认项目未切换
  if (!validateProjectContext('setState-写入数据')) {
    message.warning('导入已中止：项目已切换');
    return;
  }

  // 关键修复：先把 store 中的分集号切换到目标分集，确保后续 setState 触发的自动保存也落到正确分集
  useWorkflowStore.setState({ currentProjectId: projectId, currentEpisodeNumber: targetEpisodeNum });

  try {
    // 加载项目资产到 workflowStore
    useWorkflowStore.setState({
      textModel: cleanedAssets.textModel ?? useWorkflowStore.getState().textModel,
      imageModel: cleanedAssets.imageModel ?? useWorkflowStore.getState().imageModel,
      videoModel: cleanedAssets.videoModel ?? useWorkflowStore.getState().videoModel,
      sceneModel: cleanedAssets.sceneModel ?? useWorkflowStore.getState().sceneModel,
      eraModel: cleanedAssets.eraModel ?? useWorkflowStore.getState().eraModel,
      voiceModel: cleanedAssets.voiceModel ?? useWorkflowStore.getState().voiceModel,
      agentType: cleanedAssets.agentType ?? 'realism',
      artStyle: cleanedAssets.artStyle ?? '',
      artStylePromptHint: cleanedAssets.artStylePromptHint ?? '',
      skills: cleanedAssets.skills ?? ['character', 'scene', 'dialogue', 'plot'],
      genre: cleanedAssets.genre ?? '',
      characters: targetEpisodeData.characters ?? cleanedAssets.characters ?? [],
      scenes: targetEpisodeData.scenes ?? cleanedAssets.scenes ?? [],
      props: targetEpisodeData.props ?? cleanedAssets.props ?? [],
      era: targetEpisodeData.era ?? cleanedAssets.era ?? null,
      relationshipNetwork: targetEpisodeData.relationshipNetwork ?? cleanedAssets.relationshipNetwork ?? null,
      textModels: cleanedAssets.textModels ?? useWorkflowStore.getState().textModels,
      imageModels: cleanedAssets.imageModels ?? useWorkflowStore.getState().imageModels,
      videoModels: cleanedAssets.videoModels ?? useWorkflowStore.getState().videoModels,
      voiceModels: cleanedAssets.voiceModels ?? useWorkflowStore.getState().voiceModels,
      audioAssets: cleanedAssets.audioAssets ?? [],
      // 关键修复：使用目标分集的专属剧本，而非项目级剧本
      script: targetScript,
      // 当前分集数据（currentStep 根据实际数据校准，避免有片段但 step 不可点击）
      currentStep: calibrateCurrentStep(
        targetEpisodeData.currentStep ?? 0,
        targetEpisodeData.episodes ?? [],
        targetEpisodeData.activeCharacterIds ?? [],
        targetEpisodeData.activeSceneIds ?? [],
        targetEpisodeData.isSimplifiedMode ?? false,
      ),
      topic: targetEpisodeData.topic ?? '',
      summary: targetEpisodeData.summary ?? '',
      previousEpisodeScript: targetEpisodeData.previousEpisodeScript ?? '',
      previousEpisodeSummary: targetEpisodeData.previousEpisodeSummary ?? '',
      isEnding: targetEpisodeData.isEnding ?? false,
      isSimplifiedMode: targetEpisodeData.isSimplifiedMode ?? false,
      activeCharacterIds: targetEpisodeData.activeCharacterIds ?? [],
      activeSceneIds: targetEpisodeData.activeSceneIds ?? [],
      activePropIds: targetEpisodeData.activePropIds ?? [],
      episodes: targetEpisodeData.episodes ?? [],
    });

    const __diagAfterSet = useWorkflowStore.getState();
    console.log('[导入诊断-B] setState后立即读取 store', {
      eps: __diagAfterSet.episodes?.length,
      activeChar: __diagAfterSet.activeCharacterIds?.length,
      activeScene: __diagAfterSet.activeSceneIds?.length,
      epNum: __diagAfterSet.currentEpisodeNumber,
      pid: __diagAfterSet.currentProjectId,
    });

    // 恢复分集列表信息
    if (data.episodeList && Array.isArray(data.episodeList)) {
      setEpisodeList(data.episodeList);
    }
    setEpisodeIdMap(remappedEpisodeIdMap);
    if (data.currentEpisode && typeof data.currentEpisode === 'number') {
      setCurrentEpisode(data.currentEpisode);
    }

    // 恢复所有分集数据到 localStorage
    if (cleanedEpisodesData && typeof cleanedEpisodesData === 'object') {
      for (const [epNumStr, epData] of Object.entries(cleanedEpisodesData)) {
        const epNum = Number(epNumStr);
        if (!isNaN(epNum) && epData) {
          try {
            const epKey = getEpisodeDataKey(projectId, epNum);
            userStorage.setItem(epKey, JSON.stringify({ ...epData, _savedAt: Date.now() }));

            // 角色场景现在是项目级资产，写入分集数据缓存即可
            await saveEpisodeDataToStorage(projectId, epNum, { ...epData, _savedAt: Date.now() });
          } catch (e) {
            console.warn(`[导入] 恢复第${epNum}集数据到 localStorage 失败:`, e);
          }
        }
      }
    }

    // 保存项目资产到 localStorage（项目级资产中不再包含 script）
    const assetsKey = getProjectAssetsKey(projectId);
    try {
      const projectAssets = {
        ...cleanedAssets,
        _savedAt: Date.now(),
      };
      // 项目级资产中不应再包含 script（已按分集独立存储）
      delete projectAssets.script;
      userStorage.setItem(assetsKey, JSON.stringify(projectAssets));
      await saveProjectAssetsToStorage(projectId, projectAssets);
    } catch (e) {
      console.warn('[导入] 保存项目资产到本地存储失败:', e);
    }

    // 关键修复：剧本按目标分集保存到 localStorage，使用分集专属剧本
    if (targetScript.trim().length > 0) {
      await saveScriptToStorage(projectId, targetEpisodeNum, targetScript);
    }

    if (data.episodeList) {
      saveProjectEpisodeInfo(projectId, data.episodeList, data.currentEpisode ?? currentEpisode, remappedEpisodeIdMap);
    }

    // 校验项目上下文：saveToServer 前确认项目未切换
    if (!validateProjectContext('saveToServer')) {
      message.warning('导入已中止：项目已切换');
      return;
    }

    // 关键修复：立即同步到后端，确保导入数据持久化到正确分集
    const __diagBeforeSave = useWorkflowStore.getState();
    console.log('[导入诊断-C] saveToServer前 store', {
      eps: __diagBeforeSave.episodes?.length,
      activeChar: __diagBeforeSave.activeCharacterIds?.length,
      activeScene: __diagBeforeSave.activeSceneIds?.length,
      epNum: __diagBeforeSave.currentEpisodeNumber,
    });
    const stateSnapshot = {
      ...useWorkflowStore.getState(),
      script: targetScript,
    };
    console.log('[导入诊断-D] stateSnapshot', {
      eps: stateSnapshot.episodes?.length,
      activeChar: stateSnapshot.activeCharacterIds?.length,
    });
    const success = await saveToServer(stateSnapshot, targetEpisodeNum);
    if (success) {
      console.log(`[导入] 第${targetEpisodeNum}集数据已同步到后端`);
    } else {
      console.warn(`[导入] 第${targetEpisodeNum}集数据同步到后端失败`);
    }

    // 校验项目上下文：保存非目标分集前确认项目未切换
    if (!validateProjectContext('saveEpisodeDataToServer-非目标分集')) {
      console.warn('[导入] 项目已切换，跳过保存剩余分集数据');
      return;
    }

    // 关键修复：保存所有非目标分集的数据到后端
    // 导入时 saveToServer 只保存了目标分集（targetEpisodeNum），其他分集数据仅写入 localStorage。
    // 切换分集时 loadWorkflowFromServer 从后端加载，如果没有后端数据会导致空数据 + 上一集残留。
    for (const epNumStr of Object.keys(cleanedEpisodesData)) {
      const epNum = Number(epNumStr);
      if (isNaN(epNum) || epNum === targetEpisodeNum) continue; // 目标分集已保存，跳过

      // 校验项目上下文：每个分集保存前确认项目未切换
      if (!validateProjectContext(`saveEpisodeDataToServer-第${epNum}集`)) {
        console.warn(`[导入] 项目已切换，跳过第${epNum}集及后续分集保存`);
        break;
      }

      const epData = cleanedEpisodesData[epNum];
      if (!epData) continue;

      // 构造分集级状态快照，合并项目级数据供 extractEpisodeData 使用
      const epIsSimplified = epData.isSimplifiedMode ?? (epNum !== 1);
      const epStateSnapshot = {
        ...stateSnapshot,
        currentProjectId: projectId,
        currentEpisodeNumber: epNum,
        currentStep: calibrateCurrentStep(
          epData.currentStep ?? 0,
          epData.episodes ?? [],
          epData.activeCharacterIds ?? [],
          epData.activeSceneIds ?? [],
          epIsSimplified,
        ),
        topic: epData.topic ?? '',
        summary: epData.summary ?? '',
        previousEpisodeScript: epNum === 1 ? '' : (epData.previousEpisodeScript ?? ''),
        previousEpisodeSummary: epNum === 1 ? '' : (epData.previousEpisodeSummary ?? ''),
        isEnding: epData.isEnding ?? false,
        isSimplifiedMode: epData.isSimplifiedMode ?? (epNum !== 1),
        activeCharacterIds: epData.activeCharacterIds ?? [],
        activeSceneIds: epData.activeSceneIds ?? [],
        episodes: epData.episodes ?? [],
        // 导出数据中每集可能包含 script 字段；旧格式无则回退空字符串，后端已有剧本不会被覆盖
        // 注意：script 可能是 JSON 编码的 {"script":"..."} 字符串，需解析
        script: extractScriptText(epData.script),
      };

      // 临时切换 store 中的分集号，确保 saveEpisodeDataToServer 能找到正确的 episodeId
      useWorkflowStore.setState({ currentProjectId: projectId, currentEpisodeNumber: epNum });

      // 同步该集的剧本到 localStorage
      const epScript = typeof epData.script === 'string' ? epData.script : '';
      if (epScript.trim().length > 0) {
        await saveScriptToStorage(projectId, epNum, epScript);
      }

      try {
        const epSuccess = await saveEpisodeDataToServer(epStateSnapshot, epNum);
        if (epSuccess) {
          console.log(`[导入] 第${epNum}集数据已同步到后端`);
        } else {
          console.warn(`[导入] 第${epNum}集数据同步到后端失败`);
        }
      } catch (epErr) {
        console.warn(`[导入] 第${epNum}集数据同步异常:`, epErr);
      }
    }
  } finally {
    // 始终恢复 store 中的分集号到目标分集
    // 导入循环中临时切换了 currentEpisodeNumber，必须恢复，否则切换分集时
    // flushSave() 会把目标分集的数据错误地保存到最后一集（#2集）的后端记录中
    useWorkflowStore.setState({ currentEpisodeNumber: targetEpisodeNum });
    __unsubImport();
  }
}

// ===== 旧格式：平铺的 workflow 数据 =====
function applyLegacyData(
  data: any,
  ctx: {
    projectId: string | undefined;
    currentEpisode: number;
    saveEpisodeData: (projectId: string, episode: number) => Promise<boolean> | boolean;
  },
) {
  const { projectId, currentEpisode, saveEpisodeData } = ctx;

  // 关键修复：旧格式数据中的 assetId 同样指向原项目，需清除
  const cleanedData = stripProjectImageAssetIds(data);

  useWorkflowStore.setState({
    currentStep: cleanedData.currentStep ?? 0,
    topic: cleanedData.topic ?? '',
    script: cleanedData.script ?? '',
    textModel: cleanedData.textModel ?? useWorkflowStore.getState().textModel,
    agentType: cleanedData.agentType ?? 'realism',
    artStyle: cleanedData.artStyle ?? '',
    artStylePromptHint: cleanedData.artStylePromptHint ?? '',
    skills: cleanedData.skills ?? ['character', 'scene', 'dialogue', 'plot'],
    genre: cleanedData.genre ?? '',
    imageModel: cleanedData.imageModel ?? useWorkflowStore.getState().imageModel,
    videoModel: cleanedData.videoModel ?? useWorkflowStore.getState().videoModel,
    sceneModel: cleanedData.sceneModel ?? useWorkflowStore.getState().sceneModel,
    eraModel: cleanedData.eraModel ?? useWorkflowStore.getState().eraModel,
    characters: cleanedData.characters ?? [],
    scenes: cleanedData.scenes ?? [],
    props: cleanedData.props ?? [],
    era: cleanedData.era ?? null,
    relationshipNetwork: cleanedData.relationshipNetwork ?? null,
    previousEpisodeScript: cleanedData.previousEpisodeScript ?? '',
    episodes: cleanedData.episodes ?? [],
    isSimplifiedMode: cleanedData.isSimplifiedMode ?? false,
    activeCharacterIds: cleanedData.activeCharacterIds ?? [],
    activeSceneIds: cleanedData.activeSceneIds ?? [],
    textModels: cleanedData.textModels ?? useWorkflowStore.getState().textModels,
    imageModels: cleanedData.imageModels ?? useWorkflowStore.getState().imageModels,
    videoModels: cleanedData.videoModels ?? useWorkflowStore.getState().videoModels,
    voiceModels: cleanedData.voiceModels ?? useWorkflowStore.getState().voiceModels,
    audioAssets: cleanedData.audioAssets ?? [],
  });

  // 保存到当前分集
  if (projectId) {
    saveEpisodeData(projectId, currentEpisode);
  }
}
