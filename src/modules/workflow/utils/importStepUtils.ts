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
 * - detectCompletedStepCount：从导入的 JSON 中识别已完成的步数（1-5，连续）
 * - filterImportDataBySteps：按所选步数过滤导入数据（只保留前 N 步的产物）
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

  /** 裁剪单集数据（v2 的 episodesData[*] / currentEpisodeData，或旧格式的顶层平铺对象） */
  const stripEpisodeData = (ep: any) => {
    if (!ep || typeof ep !== 'object') return;
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
  };

  if (d.version === 2 && d.projectAssets) {
    if (maxStep <= 2) {
      // 项目级资产同步清除分解产物（角色/场景/道具/背景）
      delete d.projectAssets.characters;
      delete d.projectAssets.scenes;
      delete d.projectAssets.props;
      delete d.projectAssets.era;
      delete d.projectAssets.relationshipNetwork;
    }
    if (d.currentEpisodeData) stripEpisodeData(d.currentEpisodeData);
    if (d.episodesData && typeof d.episodesData === 'object') {
      for (const key of Object.keys(d.episodesData)) {
        stripEpisodeData(d.episodesData[key]);
      }
    }
  } else {
    // 旧格式：平铺的 workflow 数据
    stripEpisodeData(d);
  }
  return d;
}
