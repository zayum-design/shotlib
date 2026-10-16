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

import { getEpisodeVideoUrl } from '@/modules/workflow/utils/workflowUtils';

/**
 * 导入数据步骤选择工具：
 * - detectEpisodeStepOptions：从导入的 JSON 中逐集识别已完成的步数（分集多选弹窗数据源）
 * - detectCompletedStepCount：识别导入文件整体的已完成步数（旧格式/兼容用）
 * - filterImportDataBySelection：按所选分集与每集步骤过滤导入数据
 * - filterImportDataBySteps：按统一步数过滤导入数据（旧格式单集用）
 */

/** 工作流 5 步定义（与 WorkflowPage 侧边栏一致，id 为用户可见的第几步） */
export const IMPORT_STEP_LABELS = [
  { id: 1, title: '剧本输入', desc: '创作主题与生成的剧本文本' },
  { id: 2, title: '剧本编辑', desc: '剧本定稿内容' },
  { id: 3, title: '剧本分解', desc: '角色、场景与故事背景' },
  { id: 4, title: '片段生成', desc: '片段分镜与视频提示词' },
  { id: 5, title: '视频合成', desc: '片段已生成的视频' },
] as const;

/**
 * 从导入数据中提取剧本文本
 *
 * 导出数据中 episodesData[*].script 可能是多种格式：
 * 1. 纯文本："# 时代背景\n- 时代名称：..."
 * 2. JSON 编码字符串（单层）：'{"script":"# 时代背景\\n- 时代名称：..."}'
 * 3. JSON 编码字符串（多层）：'{"script":"{\\"script\\":\\"# 时代背景..."}"}'
 *    （后端 script 资产行的 data 字段被序列化为字符串，前端再序列化一次，
 *     每多一道序列化就多包一层 {"script":"..."}）
 * 此函数循环剥离 JSON 编码层，统一解析为纯剧本文本。
 */
export function extractScriptText(scriptField: any): string {
  if (typeof scriptField !== 'string' || !scriptField.trim()) return '';
  // 循环剥离 JSON 编码层，兼容单层/双层/多层 {"script":"..."} 包装
  let cur = scriptField;
  let guard = 0; // 防御性上限，避免极端数据导致死循环
  while (cur.startsWith('{"script"') && guard < 5) {
    try {
      const parsed = JSON.parse(cur);
      if (parsed && typeof parsed.script === 'string') {
        cur = parsed.script;
        guard++;
        continue;
      }
    } catch { /* 解析失败，按当前内容返回 */ }
    break;
  }
  return cur;
}

/** 单个分集的导入选项（分集多选 + 每集步骤选择的弹窗数据源） */
export interface EpisodeStepOption {
  episodeNumber: number;
  /** 该分集检测到的已完成步数（1-5，连续） */
  stepCount: number;
  /** 片段数（展示用） */
  fragmentCount: number;
  /** 已生成视频数（展示用） */
  videoCount: number;
}

/**
 * 检测导入文件中各分集的步骤完成情况
 *
 * v2 项目格式：按 episodesData 逐集检测（currentEpisode 仅存在于 currentEpisodeData
 * 时也纳入）；旧格式（平铺）：返回单个伪分集（episodeNumber=1）。
 * 无任何步骤数据的分集不返回。
 */
export function detectEpisodeStepOptions(data: any): EpisodeStepOption[] {
  if (!data || typeof data !== 'object') return [];

  const countVideos = (frags: any[]): number =>
    (frags || []).filter((ep) => ep && !ep.deleted && !!getEpisodeVideoUrl(ep)).length;

  const isV2 = data.version === 2 && data.projectAssets;
  if (!isV2) {
    const stepCount = detectCompletedStepCount(data);
    if (stepCount < 1) return [];
    const eps: any[] = Array.isArray(data.episodes) ? data.episodes : [];
    return [
      {
        episodeNumber: 1,
        stepCount,
        fragmentCount: eps.length,
        videoCount: countVideos(eps),
      },
    ];
  }

  const assets: any = data.projectAssets || {};
  const currentEpData = data.currentEpisodeData || {};
  const epNumbers = new Set<number>([
    ...Object.keys(data.episodesData || {}).map(Number).filter((n) => !isNaN(n)),
    ...(typeof data.currentEpisode === 'number' ? [data.currentEpisode] : []),
  ]);

  const options: EpisodeStepOption[] = [];
  for (const n of Array.from(epNumbers).sort((a, b) => a - b)) {
    const epData = data.episodesData?.[n] || (n === data.currentEpisode ? currentEpData : null);
    if (!epData || typeof epData !== 'object') continue;

    // 剧本：分集剧本 → 项目级剧本（与 detectCompletedStepCount 的回退顺序一致）
    const script = extractScriptText(epData.script) || (typeof assets.script === 'string' ? assets.script : '');
    const charCount = epData.characters?.length || assets.characters?.length || 0;
    const sceneCount = epData.scenes?.length || assets.scenes?.length || 0;
    const propCount = epData.props?.length || assets.props?.length || 0;
    const activeCount = epData.activeCharacterIds?.length || epData.activeSceneIds?.length || 0;
    const frags: any[] = Array.isArray(epData.episodes) ? epData.episodes : [];
    const hasVideos = countVideos(frags) > 0;

    let stepCount = 0;
    if (script.trim().length > 0) stepCount = 2;
    if (stepCount === 2 && (charCount > 0 || sceneCount > 0 || activeCount > 0 || propCount > 0)) stepCount = 3;
    if (stepCount === 3 && frags.length > 0) stepCount = 4;
    if (stepCount === 4 && hasVideos) stepCount = 5;
    if (stepCount < 1) continue;

    options.push({ episodeNumber: n, stepCount, fragmentCount: frags.length, videoCount: countVideos(frags) });
  }
  return options;
}

/**
 * 识别导入文件中已完成的步数（连续，从第 1 步起）
 *
 * 判定标准（与侧边栏完成态一致）：
 * - 第 1/2 步（剧本输入/编辑）：存在剧本文本
 * - 第 3 步（剧本分解）：存在角色/场景/活跃角色场景
 * - 第 4 步（片段生成）：存在片段（分镜）数据
 * - 第 5 步（视频合成）：存在已生成的片段视频
 *
 * @returns 已完成的连续步数（0-5），0 表示无有效步骤数据
 */
export function detectCompletedStepCount(data: any): number {
  if (!data || typeof data !== 'object') return 0;

  const isV2 = data.version === 2 && data.projectAssets;
  const assets: any = isV2 ? data.projectAssets : {};
  // v2：结构数据优先取 currentEpisodeData（导出时必含），剧本优先取 episodesData[currentEpisode]
  const currentEp: any = isV2 ? data.currentEpisodeData || {} : data;
  const epFromData: any = isV2 ? data.episodesData?.[data.currentEpisode] || {} : {};

  // 剧本文本：分集剧本 -> 项目级剧本 -> 顶层（旧格式）
  const script =
    extractScriptText(epFromData.script) ||
    extractScriptText(currentEp.script) ||
    (typeof assets.script === 'string' ? assets.script : '') ||
    (typeof data.script === 'string' ? extractScriptText(data.script) : '');

  // 分解数据：角色/场景/活跃 ID 任一存在
  const charCount =
    (currentEp.characters?.length ?? 0) ||
    (epFromData.characters?.length ?? 0) ||
    (assets.characters?.length ?? 0) ||
    (data.characters?.length ?? 0);
  const sceneCount =
    (currentEp.scenes?.length ?? 0) ||
    (epFromData.scenes?.length ?? 0) ||
    (assets.scenes?.length ?? 0) ||
    (data.scenes?.length ?? 0);
  const activeCount =
    (currentEp.activeCharacterIds?.length ?? 0) ||
    (currentEp.activeSceneIds?.length ?? 0) ||
    (epFromData.activeCharacterIds?.length ?? 0) ||
    (epFromData.activeSceneIds?.length ?? 0);
  const propCount =
    (currentEp.props?.length ?? 0) ||
    (epFromData.props?.length ?? 0) ||
    (assets.props?.length ?? 0) ||
    (data.props?.length ?? 0);

  // 片段数据
  const episodes: any[] = currentEp.episodes || epFromData.episodes || data.episodes || [];

  // 已生成视频（与侧边栏 hasGeneratedVideos 判定一致）
  const hasVideos = (episodes || []).some((ep) => ep && !ep.deleted && !!getEpisodeVideoUrl(ep));

  let count = 0;
  if (script.trim().length > 0) count = 2; // 第 1/2 步都以剧本存在为准
  if (count === 2 && (charCount > 0 || sceneCount > 0 || activeCount > 0 || propCount > 0)) count = 3;
  if (count === 3 && episodes.length > 0) count = 4;
  if (count === 4 && hasVideos) count = 5;
  return count;
}

/**
 * 裁剪单集数据到指定步数（深拷贝后的对象上就地修改）
 *
 * - maxStep <= 2：只保留剧本，清除分解/片段/视频数据
 * - maxStep = 3：保留剧本+分解，清除片段与视频
 * - maxStep = 4：保留剧本+分解+片段（分镜/提示词），清除已生成的视频
 * - maxStep >= 5：不裁剪（全量）
 */
export function stripEpisodeDataBySteps(ep: any, maxStep: number): void {
  if (!ep || typeof ep !== 'object' || maxStep >= 5) return;
  if (maxStep <= 2) {
    delete ep.characters;
    delete ep.scenes;
    delete ep.props;
    delete ep.era;
    delete ep.relationshipNetwork;
    delete ep.activeCharacterIds;
    delete ep.activeSceneIds;
    delete ep.episodes;
    ep.currentStep = 1; // 停在「剧本编辑」步骤
  } else if (maxStep === 3) {
    delete ep.episodes;
    ep.currentStep = 2; // 停在「剧本分解」步骤
  } else if (maxStep === 4) {
    // 片段数据保留，清除已生成视频（视频属于第 5 步产物）
    for (const epItem of ep.episodes || []) {
      if (epItem && typeof epItem === 'object') {
        delete epItem.generatedVideoUrl;
        delete epItem.generatedVideos;
      }
    }
    ep.currentStep = 3; // 停在「片段生成」步骤
  }
}

/**
 * 按所选步数过滤导入数据（深拷贝后裁剪，不修改原对象）
 *
 * - maxStep <= 2：只保留剧本，清除分解/片段/视频数据
 * - maxStep = 3：保留剧本+分解，清除片段与视频
 * - maxStep = 4：保留剧本+分解+片段（分镜/提示词），清除已生成的视频
 * - maxStep >= 5：原样返回（全量导入）
 */
export function filterImportDataBySteps(data: any, maxStep: number): any {
  if (!data || typeof data !== 'object' || maxStep >= 5) return data;
  const d = JSON.parse(JSON.stringify(data));

  if (d.version === 2 && d.projectAssets) {
    if (maxStep <= 2) {
      // 项目级资产同步清除分解产物（角色/场景/道具/背景）
      delete d.projectAssets.characters;
      delete d.projectAssets.scenes;
      delete d.projectAssets.props;
      delete d.projectAssets.era;
      delete d.projectAssets.relationshipNetwork;
    }
    if (d.currentEpisodeData) stripEpisodeDataBySteps(d.currentEpisodeData, maxStep);
    if (d.episodesData && typeof d.episodesData === 'object') {
      for (const key of Object.keys(d.episodesData)) {
        stripEpisodeDataBySteps(d.episodesData[key], maxStep);
      }
    }
  } else {
    // 旧格式：平铺的 workflow 数据
    stripEpisodeDataBySteps(d, maxStep);
  }
  return d;
}

/**
 * 按分集选择过滤导入数据（每集可独立选择导入到第几步）
 *
 * @param selection 分集号 → 该集导入的最大步数（1-5）
 *   - 只保留选中的分集（episodeList / episodesData / episodeIdMap 同步裁剪）
 *   - 每集按各自 maxStep 裁剪（规则同 filterImportDataBySteps）
 *   - 项目级资产（角色/场景）在所有选中分集都 ≤ 2 步时才清除（任一分集需要分解数据即保留）
 *   - currentEpisode 不在选中范围时切换为最小选中分集号
 */
export function filterImportDataBySelection(data: any, selection: Record<number, number>): any {
  if (!data || typeof data !== 'object') return data;

  const isV2 = data.version === 2 && data.projectAssets;
  if (!isV2) {
    // 旧格式：平铺单集数据，取所选步数（仅一个伪分集）
    const step = Math.max(1, ...Object.values(selection));
    return filterImportDataBySteps(data, step);
  }

  const selected = Object.keys(selection)
    .map(Number)
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
  if (selected.length === 0) return data;

  const d = JSON.parse(JSON.stringify(data));
  const srcEpisodesData = d.episodesData || {};
  // currentEpisodeData 对应原始 currentEpisode；该集仅存在于 currentEpisodeData 时补充进 episodesData
  if (typeof d.currentEpisode === 'number' && d.currentEpisodeData && !srcEpisodesData[d.currentEpisode]) {
    srcEpisodesData[d.currentEpisode] = d.currentEpisodeData;
  }

  const newData: Record<string, any> = {};
  for (const n of selected) {
    const ep = srcEpisodesData[n];
    if (!ep) continue;
    stripEpisodeDataBySteps(ep, selection[n] ?? 5);
    newData[n] = ep;
  }
  if (Object.keys(newData).length === 0) return data;

  d.episodesData = newData;
  d.episodeList = Object.keys(newData).map(Number).sort((a, b) => a - b);
  if (d.episodeIdMap && typeof d.episodeIdMap === 'object') {
    const idMap: Record<string, string> = {};
    for (const n of d.episodeList) {
      if (d.episodeIdMap[n] !== undefined) idMap[n] = d.episodeIdMap[n];
    }
    d.episodeIdMap = idMap;
  }
  if (!d.episodeList.includes(d.currentEpisode)) {
    d.currentEpisode = d.episodeList[0];
  }
  // currentEpisodeData 与目标分集对齐（applyV2ProjectData 的回退路径使用）
  d.currentEpisodeData = JSON.parse(JSON.stringify(d.episodesData[d.currentEpisode] || {}));

  // 项目级分解资产：所有选中分集都 ≤2 步时才清除
  const globalMax = Math.max(...d.episodeList.map((n: number) => selection[n] ?? 5));
  if (globalMax <= 2) {
    delete d.projectAssets.characters;
    delete d.projectAssets.scenes;
    delete d.projectAssets.props;
    delete d.projectAssets.era;
    delete d.projectAssets.relationshipNetwork;
  }
  return d;
}
