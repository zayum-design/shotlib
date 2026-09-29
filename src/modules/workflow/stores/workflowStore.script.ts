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

import type { StoreApi } from 'zustand';
import * as workflowApi from '../api/workflowApi';
import type { AssetPromptChanges, AssetPromptChangeItem, EpisodePromptChanges, EpisodePromptChangeItem } from '../api/scriptApi';
import { saveWorkflowStateToLocal } from '../utils/workflowUtils';
import { MAX_PORTRAITS_PER_CHARACTER } from '@/shared/types/index';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { shouldPreview, triggerPreview, persistWorkflowState, saveToServer, notifyScriptGenerated } from './workflowStore';
import type { WorkflowState } from './workflowStore';
import { message } from '@/shared/utils/message';
import { saveGuard } from '../utils/workflowSaveGuard';
import { useLoadingStore } from '@/shared/stores/useLoadingStore';

type SetFn = StoreApi<WorkflowState>['setState'];
type GetFn = StoreApi<WorkflowState>['getState'];

/** 新增片段的分镜时长归一化：单镜 1-maxTotal s，且合计 ≤ maxTotal（视频模型硬上限）。
 * LLM 输出可能超限，按比例向下压缩（每镜保底 1s），避免视频生成失败/尾部镜头被截断 */
const normalizeAddedShotDurations = (shots: any[], maxTotal = 15): number[] => {
  const durations = shots.map((s) => Math.min(Math.max(s?.duration || 5, 1), maxTotal));
  const total = durations.reduce((sum, d) => sum + d, 0);
  if (total <= maxTotal) return durations;
  const scale = maxTotal / total;
  return durations.map((d) => Math.max(1, Math.floor(d * scale)));
};

/**
 * 形象照名称补齐角色名前缀（如「平妻常服照」→「柳氏-平妻常服照」）。
 * 命名规则要求「角色名-时间场景装照」以保证跨角色全局唯一（分镜提示词按名称精确匹配
 * 形象照引用，重名会关联到错误角色），但 LLM 在续集（第2集+）中经常漏加前缀，这里统一兜底：
 * 1) 已是「角色名…」开头 → 不动；
 * 2) 以角色名的后缀开头（如 孙悟空/「悟空-…」、贴身丫鬟/「丫鬟-…」）→ 替换为全名前缀，避免别名歧义；
 * 3) 其他 → 直接补上「角色名-」前缀。
 * 该归一化是幂等的，且发生在形象照写入 store 之前，下游角色清单/标记注入/名称匹配全部用新名。
 */
const ensurePortraitNamePrefix = (charName: string | undefined, portraitName: string | undefined): string | undefined => {
  if (!charName || !portraitName) return portraitName;
  if (portraitName.startsWith(charName)) return portraitName;
  const dashIdx = portraitName.indexOf('-');
  if (dashIdx >= 2) {
    const head = portraitName.slice(0, dashIdx);
    // 前缀是角色名的后缀片段（≥2字），视为别名前缀，替换为全名
    if (head.length >= 2 && charName.endsWith(head)) {
      return `${charName}${portraitName.slice(dashIdx)}`;
    }
  }
  return `${charName}-${portraitName}`;
};

/**
 * 根据角色信息自动生成音色提示词 (text_prompt)
 * 优先使用 LLM 返回的 gender、age 字段，不再从 description 正则提取
 */
function generateVoicePromptFromDescription(
  character: { gender?: string; age?: string | number; description?: string }
): string {
  const desc = character.description || '';
  if (desc.trim().length === 0) {
    return '自然语速，情感丰富';
  }
  const parts: string[] = [];

  // 性别：直接使用 LLM 返回的字段
  if (character.gender === '女') {
    parts.push('女性');
  } else if (character.gender === '男') {
    parts.push('男性');
  }

  // 年龄：直接使用 LLM 返回的字段
  const age = character.age;
  if (typeof age === 'number') {
    if (age <= 5) parts.push('婴儿声');
    else if (age <= 25) parts.push('年轻');
    else if (age <= 50) parts.push('中年');
    else parts.push('老年');
  } else if (typeof age === 'string') {
    if (age.includes('婴儿') || age.includes('幼儿')) parts.push('婴儿声');
    else if (age.includes('少年') || age.includes('青年') || age.includes('年轻')) parts.push('年轻');
    else if (age.includes('中年')) parts.push('中年');
    else if (age.includes('老')) parts.push('老年');
  }

  // 口音/语种（从 description 提取，与音色选择无关）
  if (/粤语|广东话/.test(desc)) {
    parts.push('粤语口音');
  } else if (/四川|川普/.test(desc)) {
    parts.push('四川口音');
  } else if (/东北/.test(desc)) {
    parts.push('东北口音');
  } else if (/台湾/.test(desc)) {
    parts.push('台湾口音');
  } else if (/英文|英语|美式|英式|伦敦|纽约/.test(desc)) {
    parts.push('英文');
  } else if (/日本|日语|东京/.test(desc)) {
    parts.push('日语');
  } else {
    parts.push('普通话');
  }

  // 语调/音色特征（从 description 提取）
  if (/温柔|温婉|柔和|轻声|细语/.test(desc)) {
    parts.push('温柔');
  } else if (/低沉|浑厚|沙哑|磁性|沧桑/.test(desc)) {
    parts.push('低沉');
  } else if (/高亢|洪亮|嘹亮|清脆|响亮/.test(desc)) {
    parts.push('高亢');
  } else if (/冷|冷酷|冷漠|冰冷|淡然|淡漠/.test(desc)) {
    parts.push('冷淡');
  } else if (/活泼|开朗|轻快|阳光|俏皮/.test(desc)) {
    parts.push('活泼');
  } else if (/沉稳|稳重|成熟|内敛/.test(desc)) {
    parts.push('沉稳');
  }

  // 语速
  if (/快|急促|急切|匆忙/.test(desc)) {
    parts.push('语速偏快');
  } else if (/慢|迟缓|悠然|缓缓/.test(desc)) {
    parts.push('语速偏慢');
  } else {
    parts.push('语速中等');
  }

  const result = parts.join('，');
  return result.length > 200 ? result.substring(0, 200) : result;
}

export function createScriptSlice(set: SetFn, get: GetFn) {
  return {
generateScript: async (subStyle?: string, artStyle?: string, regenerateSummary?: boolean) => {
  const { topic, textModel, agentType, skills, previousEpisodeScript, previousEpisodeSummary, summary, era, isEnding, genre } = get();
  if (!topic.trim()) return false;

  // 是否忽略当前故事梗概，重新生成整个故事
  const shouldRegenerateSummary = regenerateSummary === true || !summary.trim();

  // 如果存在上一集故事梗概，构建包含上下文的复合提示词（续集）
  let actualTopic = topic;
  if (previousEpisodeSummary || previousEpisodeScript) {
    // 构建故事背景描述
    const eraParts: string[] = [];
    if (era) {
      if (era.name) eraParts.push(`时代背景：${era.name}`);
      if (era.year) eraParts.push(`年代：${era.year}`);
      if (era.location) eraParts.push(`地点：${era.location}`);
      if (era.description) eraParts.push(`背景描述：${era.description}`);
      if (era.socialBackground) eraParts.push(`社会环境：${era.socialBackground}`);
      if (era.culturalFeatures) eraParts.push(`文化特征：${era.culturalFeatures}`);
      if (era.visualStyle) eraParts.push(`视觉风格：${era.visualStyle}`);
      if (era.globalPrompt) eraParts.push(`全局设定：${era.globalPrompt}`);
    }
    const eraText = eraParts.length > 0 ? eraParts.join('\n') : '暂无详细背景设定';
    const previousContext = previousEpisodeSummary || previousEpisodeScript;

    // 衔接依据一：上一集逐片段概述（每片段的标题+详细描述按顺序合并，
    // 能完整还原上一集剧情脉络，避免只凭压缩梗概续写导致剧情断裂）。
    // 旧数据无片段概述时回退到上一集剧本结尾原文
    const prevFragments = get().previousEpisodeFragments || [];
    const prevFragmentsText = prevFragments
      .filter((f) => f.description)
      .map((f, i) => `片段${i + 1}「${f.title || '未命名'}」：${f.description}`)
      .join('\n');
    const prevScriptTail = !prevFragmentsText && previousEpisodeScript
      ? previousEpisodeScript.slice(-1500)
      : '';

    // 衔接依据二：上一集已分解的形象照/场景/道具清单（项目级资产）。
    // 只给梗概时模型看不到这些名称只能现编，导致续集资产与第1集对不上
    const prevPortraitNames = (get().characters || []).flatMap((c) =>
      (c.fullBodyImages || [])
        .map((img) => img?.name)
        .filter((name): name is string => !!name),
    );
    const prevSceneNames = (get().scenes || [])
      .map((s) => s?.name)
      .filter((name): name is string => !!name);
    const prevPropNames = (get().props || [])
      .map((p) => p?.name)
      .filter((name): name is string => !!name);
    const prevAssetsSection =
      prevPortraitNames.length > 0 || prevSceneNames.length > 0 || prevPropNames.length > 0
        ? `\n\n【上一集已有资产（续集复用，禁止新造同义名称）】\n` +
          (prevPortraitNames.length > 0
            ? `- 形象照：${prevPortraitNames.join('、')}\n`
            : '') +
          (prevSceneNames.length > 0
            ? `- 场景：${prevSceneNames.join('、')}\n`
            : '') +
          (prevPropNames.length > 0
            ? `- 道具：${prevPropNames.join('、')}`
            : '')
        : '';

    const prevPlotSection = prevFragmentsText
      ? `\n\n【上一集完整剧情（逐片段概述，按播放顺序，最高优先级衔接依据）】\n${prevFragmentsText}`
      : prevScriptTail
        ? `\n\n【上一集剧本结尾原文（最高优先级衔接依据）】\n……${prevScriptTail}`
        : '';

    const currentSummarySection = !shouldRegenerateSummary && summary.trim()
      ? `\n\n【本集故事梗概】\n${summary.trim()}\n请严格依据以上本集故事梗概生成剧本正文，梗概中的关键情节点必须在剧本中一一对应呈现。`
      : '';

    actualTopic = `【重要：本集是续集，不是第一集】你必须基于上一集故事梗概继续创作下一集，绝对禁止重新创作独立的第一集或从头开始的故事。

请根据以下主题创作下一集剧本，要求与上一集剧情紧密衔接、逻辑连贯地发展。

【故事主题/方向】
${topic}${currentSummarySection}

【故事背景设定】
${eraText}

【上一集故事梗概】
${previousContext}${prevPlotSection}${prevAssetsSection}

创作要求：
1. 本集是上一集的直接延续，剧情必须自然衔接、连贯发展；上一集逐片段概述中的关键事件、人物状态变化、伏笔都必须视为已发生的事实，禁止与之矛盾
2. **开头接续（最高优先级）**：本集第一个片段节拍必须从上一集**最后一个片段概述所描述的结尾画面**自然接续——同一场景时人物的位置、姿势、手中道具、情绪落点必须与上集结尾完全一致；若换场或时间跳跃，必须用一句过渡描述交代（如"次日清晨""半小时后"），禁止无过渡跳变
3. 保持已有角色的性格设定和关系一致性；上一集出现的形象照、场景和道具在本集中出现时，**必须原样使用【上一集已有资产】清单中的名称**（含角色名前缀，一字不差）；角色在本集需要新造型时，按形象照命名规则以「角色名-时间场景装」新建，不得改写清单中已有的名称
4. 可以根据主题方向引入新角色或新场景来推动剧情
5. 延续上一集的悬念或冲突，并适当展开新的情节线
6. 剧本格式与上一集保持一致
7. 故事背景设定（时代、地点、社会环境、文化特征等）必须与上一集完全一致`;
  } else if (!shouldRegenerateSummary && summary.trim()) {
    // 第1集基于当前故事梗概重新生成剧本
    actualTopic = `【故事梗概】
${summary.trim()}

【创作主题/方向】
${topic}

请基于以上故事梗概和主题创作第1集短剧剧本。故事梗概是对本集核心剧情的概述，剧本应完整呈现梗概中的关键情节点，并按输出格式创作。`;
  }

  const doGenerate = async () => {
    // 记录当前项目ID，用于后续校验防止跨项目数据污染
    const startedProjectId = get().currentProjectId;
    const startedEpisodeNumber = get().currentEpisodeNumber ?? 1;

    set({ isGeneratingScript: true });
    const loading = useLoadingStore.getState();
    loading.show({ title: '正在生成剧本...', description: '请稍候，这可能需要一分钟左右' });
    const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
    const taskId = addTask({ type: 'script-generate', name: `生成剧本: ${actualTopic}`, status: 'running', prompt: topic, modelVariant: textModel });
    try {
      // 使用异步模式，将剧本生成任务放入队列
      const enqueueResponse = await workflowApi.generateScriptApi(
        actualTopic, textModel, agentType, skills, false, subStyle, artStyle, true, isEnding, genre || undefined, get().creationMode || undefined,
      );

      if (!enqueueResponse.success) {
        failTask(taskId, '提交生成任务失败');
        message.error('提交生成任务失败');
        return false;
      }

      const jobData = enqueueResponse.data as any;
      if (jobData?.jobId) {
        const jobId = jobData.jobId;
        message.info('剧本生成任务已提交，正在排队处理...');

        const pollResult = await workflowApi.pollJobStatus<{ script: string; summary?: string }>(jobId, {
          interval: 2000,
          maxWaitTime: 10 * 60 * 1000,
          onPoll: (attempt) => {
            incrementPollCount(taskId);
          },
        });

        if (!pollResult.success) {
          failTask(taskId, pollResult.error || '执行失败');
          message.error(`剧本生成失败: ${pollResult.error || '未知错误'}`);
          return false;
        }

        const script = pollResult.data?.script;
        const generatedSummary = pollResult.data?.summary || '';
        if (script) {
          // ===== 跨项目切换校验 =====
          const currentProjectId = get().currentProjectId;
          if (startedProjectId && startedProjectId !== currentProjectId) {
            console.warn(`[generateScript] 项目已切换(${startedProjectId} -> ${currentProjectId})，不更新当前 workflowStore`);
            saveWorkflowStateToLocal(startedProjectId, startedEpisodeNumber, { ...get(), script, summary: generatedSummary });
            completeTask(taskId, { script, summary: generatedSummary });
            return true;
          }

          const state = get();
          const isSimplified = state.isSimplifiedMode;
          set({ script, summary: generatedSummary });
          // 手动触发持久化（v2 格式）- 先保存到 localStorage
          saveWorkflowStateToLocal(startedProjectId || 'default', startedEpisodeNumber, { ...state, script, summary: generatedSummary });
          // 关键修复：生成剧本后立即保存到后端，避免刷新后数据丢失
          // 必须 await 确保保存完成，否则用户快速刷新时请求可能被浏览器取消
          try {
            await saveToServer({ ...state, script, summary: generatedSummary });
          } catch (e: any) {
            console.warn('[generateScript] 云端同步失败（非阻塞）:', e?.message || e);
          }
          if (!isSimplified) {
            set({ currentStep: 1 });
            notifyScriptGenerated();
          }
          message.success('剧本生成成功');
          completeTask(taskId, { script, summary: generatedSummary });
          // 数据已重新生成，清除 SaveGuard 的重置标记
          saveGuard.clearResetMark();
          return true;
        }
        failTask(taskId, '任务完成但未返回剧本');
        message.error('任务完成但未返回剧本');
        return false;
      } else {
        // 同步模式回退（Redis 未启用时）
        const script = (enqueueResponse.data as any)?.script;
        const generatedSummary = (enqueueResponse.data as any)?.summary || '';
        if (script) {
          // ===== 跨项目切换校验 =====
          const currentProjectId = get().currentProjectId;
          if (startedProjectId && startedProjectId !== currentProjectId) {
            console.warn(`[generateScript] 项目已切换(${startedProjectId} -> ${currentProjectId})，不更新当前 workflowStore`);
            saveWorkflowStateToLocal(startedProjectId, startedEpisodeNumber, { ...get(), script, summary: generatedSummary });
            completeTask(taskId, { script, summary: generatedSummary });
            return true;
          }

          const state = get();
          const isSimplified = state.isSimplifiedMode;
          set({ script, summary: generatedSummary });
          // 手动触发持久化（v2 格式）- 先保存到 localStorage
          saveWorkflowStateToLocal(startedProjectId || 'default', startedEpisodeNumber, { ...state, script, summary: generatedSummary });
          // 关键修复：生成剧本后立即保存到后端，避免刷新后数据丢失
          // 必须 await 确保保存完成，否则用户快速刷新时请求可能被浏览器取消
          try {
            await saveToServer({ ...state, script, summary: generatedSummary });
          } catch (e: any) {
            console.warn('[generateScript] 云端同步失败（非阻塞）:', e?.message || e);
          }
          if (!isSimplified) {
            set({ currentStep: 1 });
            notifyScriptGenerated();
          }
          message.success('剧本生成成功');
          completeTask(taskId, { script, summary: generatedSummary });
          // 数据已重新生成，清除 SaveGuard 的重置标记
          saveGuard.clearResetMark();
          return true;
        }
        failTask(taskId, '未返回剧本');
        message.error('未返回剧本');
        return false;
      }
    } catch (error: any) {
      failTask(taskId, error.message || '未知错误');
      console.error('[generateScript] 异步生成失败:', error);
      message.error(`生成失败: ${error.message || '未知错误'}`);
      return false;
    } finally {
      set({ isGeneratingScript: false });
      loading.hide();
      const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
      if (task && (task.status === 'running' || task.status === 'polling')) {
        removeTask(taskId);
      }
    }
  };

  if (shouldPreview()) {
    triggerPreview(
      {
        endpoint: '/api/creator/script/generate',
        body: { topic: actualTopic, model: textModel, agentType, skills, isEnding, genre },
      },
      doGenerate
    );
    return false;
  }

  return doGenerate();
},

reviewScript: async (mode: 'review' | 'modify', requirement?: string) => {
  const { script, summary, textModel } = get();
  if (!script.trim()) {
    message.warning('剧本内容为空，无法校验或修改');
    return null;
  }
  if (mode === 'modify' && !requirement?.trim()) {
    message.warning('请输入修改要求');
    return null;
  }

  // 记录当前项目ID，用于后续校验防止跨项目数据污染
  const startedProjectId = get().currentProjectId;
  const startedEpisodeNumber = get().currentEpisodeNumber ?? 1;
  const taskLabel = mode === 'modify' ? '修改剧本' : '校验审阅剧本';

  set({ isReviewingScript: true });
  const loading = useLoadingStore.getState();
  loading.show({ title: `正在${taskLabel}...`, description: '请稍候，这可能需要一分钟左右' });
  const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
  const taskId = addTask({ type: 'script-review', name: taskLabel, status: 'running', prompt: requirement || summary?.substring(0, 200), modelVariant: textModel });
  try {
    // 使用异步模式，将任务放入队列
    const enqueueResponse = await workflowApi.reviewScriptApi(
      script, summary || '', mode, requirement, textModel, true, get().creationMode || undefined,
    );

    if (!enqueueResponse.success) {
      failTask(taskId, '提交任务失败');
      message.error('提交任务失败');
      return null;
    }

    let resultData: { mode: 'review' | 'modify'; report?: string; script?: string } | undefined;
    const jobData = enqueueResponse.data as any;
    if (jobData?.jobId) {
      message.info(`${taskLabel}任务已提交，正在排队处理...`);
      const pollResult = await workflowApi.pollJobStatus<{ mode: 'review' | 'modify'; report?: string; script?: string }>(jobData.jobId, {
        interval: 2000,
        maxWaitTime: 10 * 60 * 1000,
        onPoll: () => {
          incrementPollCount(taskId);
        },
      });

      if (!pollResult.success) {
        failTask(taskId, pollResult.error || '执行失败');
        message.error(`${taskLabel}失败: ${pollResult.error || '未知错误'}`);
        return null;
      }
      resultData = pollResult.data;
    } else {
      // 同步模式回退（Redis 未启用时）
      resultData = jobData;
    }

    if (!resultData) {
      failTask(taskId, '任务完成但未返回结果');
      message.error('任务完成但未返回结果');
      return null;
    }

    // 校验审阅：直接返回审阅报告，由调用方展示
    if (mode === 'review') {
      const report = resultData.report || '';
      if (!report) {
        failTask(taskId, '任务完成但未返回审阅报告');
        message.error('任务完成但未返回审阅报告');
        return null;
      }
      message.success('校验审阅完成');
      completeTask(taskId, { text: '校验审阅完成' });
      return report;
    }

    // 修改剧本：返回修改后的新剧本，由调用方展示差异对比，确认后再调用 applyModifiedScript 应用
    const newScript = resultData.script;
    if (!newScript) {
      failTask(taskId, '任务完成但未返回修改后的剧本');
      message.error('任务完成但未返回修改后的剧本');
      return null;
    }

    // ===== 跨项目切换校验 =====
    const currentProjectId = get().currentProjectId;
    if (startedProjectId && startedProjectId !== currentProjectId) {
      console.warn(`[reviewScript] 项目已切换(${startedProjectId} -> ${currentProjectId})，放弃修改结果`);
      failTask(taskId, '项目已切换，修改结果已放弃');
      message.warning('项目已切换，修改结果未应用');
      return null;
    }

    completeTask(taskId, { script: newScript });
    return newScript;
  } catch (error: any) {
    failTask(taskId, error.message || '未知错误');
    console.error(`[reviewScript] ${taskLabel}失败:`, error);
    message.error(`${taskLabel}失败: ${error.message || '未知错误'}`);
    return null;
  } finally {
    set({ isReviewingScript: false });
    loading.hide();
    const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
    if (task && (task.status === 'running' || task.status === 'polling')) {
      removeTask(taskId);
    }
  }
},

/**
 * 确认应用修改后的剧本（差异对比弹窗确认按钮触发）
 * 更新当前剧本并立即持久化（localStorage + 云端）
 */
applyModifiedScript: async (newScript: string) => {
  const projectId = get().currentProjectId || 'default';
  const episodeNumber = get().currentEpisodeNumber ?? 1;
  const state = get();
  set({ script: newScript });
  // 手动触发持久化（v2 格式）- 先保存到 localStorage
  saveWorkflowStateToLocal(projectId, episodeNumber, { ...state, script: newScript });
  // 立即保存到后端，避免刷新后数据丢失
  try {
    await saveToServer({ ...state, script: newScript });
  } catch (e: any) {
    console.warn('[applyModifiedScript] 云端同步失败（非阻塞）:', e?.message || e);
  }
  message.success('剧本修改已应用');
},

reviewAssetPrompts: async (mode: 'review' | 'modify', requirement?: string) => {
  const state = get();
  const { script, textModel } = state;
  if (!script.trim()) {
    message.warning('剧本内容为空，无法校验或修改');
    return null;
  }
  if (mode === 'modify' && !requirement?.trim()) {
    message.warning('请输入修改要求');
    return null;
  }

  // 只提交当前分集活跃的角色/场景，且仅保留提示词相关字段（避免图片等大字段撑爆请求体）
  const activeCharacters = state.activeCharacterIds?.length
    ? state.characters.filter((c: any) => state.activeCharacterIds.includes(c.id))
    : state.characters;
  const activeScenes = state.activeSceneIds?.length
    ? state.scenes.filter((s: any) => state.activeSceneIds.includes(s.id))
    : state.scenes;
  if (activeCharacters.length === 0 && activeScenes.length === 0) {
    message.warning('暂无分解产出的角色/场景，请先分解剧本');
    return null;
  }
  const characterPayload = activeCharacters.map((c: any) => ({
    name: c.name,
    gender: c.gender,
    age: c.age,
    description: c.description,
    imagePrompt: c.imagePrompt,
    avatarPrompt: c.avatarPrompt,
    voicePrompt: c.voicePrompt,
  }));
  const scenePayload = activeScenes.map((s: any) => ({
    name: s.name,
    description: s.description,
    location: s.location,
    timeOfDay: s.timeOfDay,
    season: s.season,
    weather: s.weather,
    imagePrompt: s.imagePrompt,
  }));

  // 记录当前项目ID，用于后续校验防止跨项目数据污染
  const startedProjectId = get().currentProjectId;
  const taskLabel = mode === 'modify' ? '修改资产提示词' : '校验审阅资产提示词';

  set({ isReviewingAssets: true });
  const loading = useLoadingStore.getState();
  loading.show({ title: `正在${taskLabel}...`, description: '请稍候，这可能需要一分钟左右' });
  const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
  const taskId = addTask({ type: 'asset-review', name: taskLabel, status: 'running', prompt: requirement || script.substring(0, 200), modelVariant: textModel });
  try {
    // 使用异步模式，将任务放入队列
    const enqueueResponse = await workflowApi.reviewAssetsApi(
      script, characterPayload, scenePayload, mode, requirement, textModel, true,
    );

    if (!enqueueResponse.success) {
      failTask(taskId, '提交任务失败');
      message.error('提交任务失败');
      return null;
    }

    let resultData: { mode: 'review' | 'modify'; report?: string; changes?: AssetPromptChanges } | undefined;
    const jobData = enqueueResponse.data as any;
    if (jobData?.jobId) {
      message.info(`${taskLabel}任务已提交，正在排队处理...`);
      const pollResult = await workflowApi.pollJobStatus<{ mode: 'review' | 'modify'; report?: string; changes?: AssetPromptChanges }>(jobData.jobId, {
        interval: 2000,
        maxWaitTime: 10 * 60 * 1000,
        onPoll: () => {
          incrementPollCount(taskId);
        },
      });

      if (!pollResult.success) {
        failTask(taskId, pollResult.error || '执行失败');
        message.error(`${taskLabel}失败: ${pollResult.error || '未知错误'}`);
        return null;
      }
      resultData = pollResult.data;
    } else {
      // 同步模式回退（Redis 未启用时）
      resultData = jobData;
    }

    if (!resultData) {
      failTask(taskId, '任务完成但未返回结果');
      message.error('任务完成但未返回结果');
      return null;
    }

    // ===== 跨项目切换校验 =====
    const currentProjectId = get().currentProjectId;
    if (startedProjectId && startedProjectId !== currentProjectId) {
      console.warn(`[reviewAssetPrompts] 项目已切换(${startedProjectId} -> ${currentProjectId})，放弃结果`);
      failTask(taskId, '项目已切换，结果已放弃');
      message.warning('项目已切换，结果未应用');
      return null;
    }

    // 校验审阅：直接返回审阅报告，由调用方展示
    if (mode === 'review') {
      const report = resultData.report || '';
      if (!report) {
        failTask(taskId, '任务完成但未返回审阅报告');
        message.error('任务完成但未返回审阅报告');
        return null;
      }
      message.success('校验审阅完成');
      completeTask(taskId, { text: '校验审阅完成' });
      return report;
    }

    // 修改提示词：返回修改结果，由调用方展示勾选对比，确认后再调用 applyAssetPromptChanges 应用
    const changes = resultData.changes || { characters: [], scenes: [] };
    completeTask(taskId, { text: '修改结果已生成' });
    return changes;
  } catch (error: any) {
    failTask(taskId, error.message || '未知错误');
    console.error(`[reviewAssetPrompts] ${taskLabel}失败:`, error);
    message.error(`${taskLabel}失败: ${error.message || '未知错误'}`);
    return null;
  } finally {
    set({ isReviewingAssets: false });
    loading.hide();
    const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
    if (task && (task.status === 'running' || task.status === 'polling')) {
      removeTask(taskId);
    }
  }
},

/**
 * 应用勾选的资产提示词修改项（按名称匹配角色/场景），更新后立即持久化
 */
applyAssetPromptChanges: async (items: AssetPromptChangeItem[]) => {
  if (!items.length) return;
  const state = get();

  const characters = state.characters.map((c: any) => {
    const updates = items.filter((i) => i.assetType === 'character' && i.name === c.name);
    if (!updates.length) return c;
    const next = { ...c };
    for (const u of updates) {
      (next as any)[u.field] = u.newValue;
    }
    return next;
  });

  const scenes = state.scenes.map((s: any) => {
    const updates = items.filter((i) => i.assetType === 'scene' && i.name === s.name);
    if (!updates.length) return s;
    const next = { ...s };
    for (const u of updates) {
      (next as any)[u.field] = u.newValue;
    }
    return next;
  });

  set({ characters, scenes });

  // 立即持久化（localStorage + 云端），与 parseScript 的保存路径一致
  const projectId = get().currentProjectId || 'default';
  const episodeNumber = get().currentEpisodeNumber ?? 1;
  saveWorkflowStateToLocal(projectId, episodeNumber, { ...state, characters, scenes });
  try {
    await saveToServer({ ...state, characters, scenes }, episodeNumber);
  } catch (e: any) {
    console.warn('[applyAssetPromptChanges] 云端同步失败（非阻塞）:', e?.message || e);
  }
  message.success(`已应用 ${items.length} 条提示词修改`);
},

reviewEpisodePrompts: async (mode: 'review' | 'modify', requirement?: string) => {
  const state = get();
  const { script, textModel } = state;
  if (!script.trim()) {
    message.warning('剧本内容为空，无法校验或修改');
    return null;
  }
  if (mode === 'modify' && !requirement?.trim()) {
    message.warning('请输入修改要求');
    return null;
  }

  // 只提交未删除的片段，且仅保留提示词相关字段（避免图片/视频等大字段撑爆请求体）
  const activeEpisodes = (state.episodes || []).filter((e: any) => !e.deleted);
  if (activeEpisodes.length === 0) {
    message.warning('暂无片段数据，请先生成片段');
    return null;
  }
  const episodePayload = activeEpisodes.map((e: any) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    videoPrompt: e.videoPrompt,
    firstFramePrompt: e.firstFramePrompt,
    lastFramePrompt: e.lastFramePrompt,
    firstLastFrameVideoPrompt: e.firstLastFrameVideoPrompt,
    shots: (e.shots || []).map((shot: any) => ({
      id: shot.id,
      prompt: shot.prompt,
      referencePrompt: shot.referencePrompt,
    })),
  }));
  // 角色清单（名称 + id + 形象照名列表）：供后端校验/修正 @<portrait> 标签的 character-id 归属
  const characterPayload = (state.characters || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    fullBodyImages: (c.fullBodyImages || []).map((img: any) => ({ name: img?.name })),
  }));

  // 记录当前项目ID，用于后续校验防止跨项目数据污染
  const startedProjectId = get().currentProjectId;
  const taskLabel = mode === 'modify' ? '修改片段提示词' : '校验审阅片段提示词';

  set({ isReviewingEpisodes: true });
  const loading = useLoadingStore.getState();
  loading.show({ title: `正在${taskLabel}...`, description: '请稍候，修改幅度较大时可能需要几分钟' });
  const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
  const taskId = addTask({ type: 'episode-review', name: taskLabel, status: 'running', prompt: requirement || script.substring(0, 200), modelVariant: textModel });
  try {
    // 使用异步模式，将任务放入队列
    const enqueueResponse = await workflowApi.reviewEpisodesApi(
      script, episodePayload, characterPayload, mode, requirement, textModel, true,
    );

    if (!enqueueResponse.success) {
      failTask(taskId, '提交任务失败');
      message.error('提交任务失败');
      return null;
    }

    let resultData: { mode: 'review' | 'modify'; report?: string; changes?: EpisodePromptChanges } | undefined;
    const jobData = enqueueResponse.data as any;
    if (jobData?.jobId) {
      message.info(`${taskLabel}任务已提交，正在排队处理...`);
      const pollResult = await workflowApi.pollJobStatus<{ mode: 'review' | 'modify'; report?: string; changes?: EpisodePromptChanges }>(jobData.jobId, {
        interval: 2000,
        // 20 分钟：单次 LLM 调用可达 5 分钟以上，队列配置 attempts=3 自动重试，
        // 一次失败重试即需 ~10 分钟，10 分钟上限会导致前端先超时、任务后完成（结果丢失）
        maxWaitTime: 20 * 60 * 1000,
        onPoll: () => {
          incrementPollCount(taskId);
        },
      });

      if (!pollResult.success) {
        failTask(taskId, pollResult.error || '执行失败');
        message.error(`${taskLabel}失败: ${pollResult.error || '未知错误'}`);
        return null;
      }
      resultData = pollResult.data;
    } else {
      // 同步模式回退（Redis 未启用时）
      resultData = jobData;
    }

    if (!resultData) {
      failTask(taskId, '任务完成但未返回结果');
      message.error('任务完成但未返回结果');
      return null;
    }

    // ===== 跨项目切换校验 =====
    const currentProjectId = get().currentProjectId;
    if (startedProjectId && startedProjectId !== currentProjectId) {
      console.warn(`[reviewEpisodePrompts] 项目已切换(${startedProjectId} -> ${currentProjectId})，放弃结果`);
      failTask(taskId, '项目已切换，结果已放弃');
      message.warning('项目已切换，结果未应用');
      return null;
    }

    // 校验审阅：直接返回审阅报告，由调用方展示
    if (mode === 'review') {
      const report = resultData.report || '';
      if (!report) {
        failTask(taskId, '任务完成但未返回审阅报告');
        message.error('任务完成但未返回审阅报告');
        return null;
      }
      message.success('校验审阅完成');
      completeTask(taskId, { text: '校验审阅完成' });
      return report;
    }

    // 修改提示词：返回修改结果，由调用方展示勾选对比，确认后再调用 applyEpisodePromptChanges 应用
    const changes = resultData.changes || { episodes: [] };
    completeTask(taskId, { text: '修改结果已生成' });
    return changes;
  } catch (error: any) {
    failTask(taskId, error.message || '未知错误');
    console.error(`[reviewEpisodePrompts] ${taskLabel}失败:`, error);
    message.error(`${taskLabel}失败: ${error.message || '未知错误'}`);
    return null;
  } finally {
    set({ isReviewingEpisodes: false });
    loading.hide();
    const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
    if (task && (task.status === 'running' || task.status === 'polling')) {
      removeTask(taskId);
    }
  }
},

/**
 * 应用勾选的片段提示词修改项（按片段/分镜 id 匹配），更新后立即持久化
 */
applyEpisodePromptChanges: async (items: EpisodePromptChangeItem[]) => {
  if (!items.length) return;
  const state = get();

  // 新增/删除片段处理（action=add/delete）
  const addedEpisodes: any[] = [];
  const deletedEpisodeIds = new Set<string>();
  for (const item of items) {
    if (item.action === 'add' && item.episodeData) {
      const raw = item.episodeData as any;
      const rawShots = Array.isArray(raw.shots) ? raw.shots : [];
      const shotDurations = normalizeAddedShotDurations(rawShots, state.episodeMaxDuration || 15);
      const totalShotDuration = shotDurations.reduce((sum, d) => sum + d, 0);
      addedEpisodes.push({
        id: crypto.randomUUID(),
        title: raw.title || '新片段',
        description: raw.description || '',
        model: state.videoModel,
        // 与分镜合计时长保持一致（首尾帧模式按 videoDuration 请求视频时长）
        videoDuration: totalShotDuration || 5,
        videoGenerationMode: 'reference_image',
        deleted: false,
        videoPrompt: raw.videoPrompt || '',
        rawVideoPrompt: raw.videoPrompt || '',
        firstFramePrompt: raw.firstFramePrompt || '',
        lastFramePrompt: raw.lastFramePrompt || '',
        firstLastFrameVideoPrompt: raw.firstLastFrameVideoPrompt || '',
        shots: rawShots.map((s: any, index: number) => ({
          id: crypto.randomUUID(),
          duration: shotDurations[index],
          cameraMovements: Array.isArray(s.cameraMovements) ? s.cameraMovements : ['static'],
          shotType: s.shotType || 'medium',
          cameraAngle: s.cameraAngle || 'eye_level',
          lighting: s.lighting || 'natural',
          mood: s.mood || 'bright',
          prompt: s.prompt || '',
          rawPrompt: s.prompt || '',
          referencePrompt: s.referencePrompt || '',
          rawReferencePrompt: s.referencePrompt || '',
        })),
      });
    } else if (item.action === 'delete') {
      deletedEpisodeIds.add(item.episodeId);
    }
  }

  const episodes = [
    ...state.episodes.map((ep: any) => {
      // 删除片段：软删除标记
      if (deletedEpisodeIds.has(ep.id)) return { ...ep, deleted: true };

      const epFieldUpdates = items.filter((i) => i.episodeId === ep.id && !i.shotId && (i.action === 'update' || !i.action));
      const shotUpdates = items.filter((i) => i.episodeId === ep.id && i.shotId && (i.action === 'update' || !i.action));
      if (!epFieldUpdates.length && !shotUpdates.length) return ep;

      const next = { ...ep };
      for (const u of epFieldUpdates) {
        (next as any)[u.field] = u.newValue;
      }
      if (shotUpdates.length && next.shots?.length) {
        next.shots = next.shots.map((shot: any) => {
          const updates = shotUpdates.filter((i) => i.shotId === shot.id);
          if (!updates.length) return shot;
          const nextShot = { ...shot };
          for (const u of updates) {
            (nextShot as any)[u.field] = u.newValue;
          }
          return nextShot;
        });
      }
      return next;
    }),
    // 新增片段追加到末尾
    ...addedEpisodes,
  ];

  set({ episodes });

  // 立即持久化（localStorage + 云端）
  const projectId = get().currentProjectId || 'default';
  const episodeNumber = get().currentEpisodeNumber ?? 1;
  saveWorkflowStateToLocal(projectId, episodeNumber, { ...state, episodes });
  try {
    await saveToServer({ ...state, episodes }, episodeNumber);
  } catch (e: any) {
    console.warn('[applyEpisodePromptChanges] 云端同步失败（非阻塞）:', e?.message || e);
  }
  message.success(`已应用 ${items.length} 条提示词修改`);
},

parseScript: async (options?: { replace?: boolean }) => {
  const { script, textModel, imageModel } = get();

  const doGenerate = async () => {
    // 记录当前项目ID，用于后续校验防止跨项目数据污染
    const startedProjectId = get().currentProjectId;
    const startedEpisodeNumber = get().currentEpisodeNumber ?? 1;

    // 在 doGenerate 内部清空后续步骤数据，确保 preview dialog 提交后才执行
    set({ isParsingScript: true, episodes: [] });
    const loading = useLoadingStore.getState();
    loading.show({ title: '正在分解剧本...', description: '请稍候，AI 正在解析角色和场景' });
    const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
    const parsePrompt = script?.substring(0, 500) || '解析剧本';
    const taskId = addTask({ type: 'script-parse', name: '解析剧本', status: 'running', prompt: parsePrompt, modelVariant: textModel });
    try {
      const response = await workflowApi.parseScriptApi(script, textModel, undefined, true);

      if (!response.success) {
        failTask(taskId, '提交失败');
        message.error('提交解析任务失败');
        return;
      }

      const jobData = response.data as any;
      let data;

      if (jobData?.jobId) {
        const jobId = jobData.jobId;

        const pollResult = await workflowApi.pollJobStatus(jobId, {
          interval: 3000,
          // 10 分钟：与后端 parseScript 的 600s 超时匹配（推理模型 maxTokens 36000 生成需 300-500s）
          maxWaitTime: 10 * 60 * 1000,
          onPoll: (attempt) => {
            incrementPollCount(taskId);
          },
        });

        if (!pollResult.success) {
          failTask(taskId, pollResult.error || '执行失败');
          message.error(`解析失败: ${pollResult.error || '未知错误'}`);
          return;
        }

        data = pollResult.data;
      } else {
        // 同步模式回退
        data = response.data as any;
      }

      // ===== 续集资产兜底 =====
      // 续集（第2集+）分解时，store 中的项目级角色/场景/道具任一类为空
      // （新建分集未加载、状态被重置等时序问题），都会使下方合并复用失效：
      // 该类资产被全部当作新资产处理（isNew=true、已有图片不复用、
      // 道具在第2集误显示「新增」角标）。因此任一类为空都从服务器重新拉取并
      // 水合图片，且只补空缺的类别，避免覆盖本地未保存的编辑。
      {
        const probe = get();
        const isSequel =
          !!probe.previousEpisodeScript ||
          !!probe.previousEpisodeSummary ||
          (probe.currentEpisodeNumber ?? 1) > 1;
        const missingCharacters = probe.characters.length === 0;
        const missingScenes = probe.scenes.length === 0;
        const missingProps = (probe.props || []).length === 0;
        if (
          isSequel &&
          (missingCharacters || missingScenes || missingProps) &&
          probe.currentProjectId
        ) {
          try {
            const { loadWorkflowFromServer } = await import('./workflowStore.sync.load');
            const loaded = await loadWorkflowFromServer(
              probe.currentProjectId,
              'drama',
              probe.currentEpisodeNumber ?? 1,
            );
            if (loaded) {
              const patch: Record<string, any> = {};
              if (missingCharacters && loaded.characters.length > 0) {
                patch.characters = loaded.characters;
              }
              if (missingScenes && loaded.scenes.length > 0) {
                patch.scenes = loaded.scenes;
              }
              if (missingProps && (loaded.props || []).length > 0) {
                patch.props = loaded.props;
              }
              if (Object.keys(patch).length > 0) {
                set(patch);
                console.log(`[parseScript] 续集资产兜底加载完成: chars=${loaded.characters.length}, scenes=${loaded.scenes.length}, props=${loaded.props?.length || 0}, patch=${Object.keys(patch).join(',')}`);
              }
            }
          } catch (e) {
            console.warn('[parseScript] 续集资产兜底加载失败（按空资产继续）:', e);
          }
        }
      }

      const state = get();

      // 解析出的角色/场景 id 必须是 UUID，才能作为 creator_drama_project_assets 的主键。
      // 后端 LLM 返回的 id 通常是 char-xxx / scene-xxx，这里统一替换为前端生成的 UUID，
      // 同时更新关系网中的 character id 引用。
      const charIdMap = new Map<string, string>();
      data.characters = (data.characters || []).map((c: any) => {
        const newId = crypto.randomUUID();
        if (c?.id) charIdMap.set(c.id, newId);
        return { ...c, id: newId };
      });

      const sceneIdMap = new Map<string, string>();
      data.scenes = (data.scenes || []).map((s: any) => {
        const newId = crypto.randomUUID();
        if (s?.id) sceneIdMap.set(s.id, newId);
        return { ...s, id: newId };
      });

      // 道具 id 同样替换为 UUID（作为 creator_drama_project_assets 主键）
      data.props = (data.props || []).map((p: any) => ({
        ...p,
        id: crypto.randomUUID(),
      }));

      if (data.relationshipNetwork?.relationships) {
        data.relationshipNetwork.relationships = data.relationshipNetwork.relationships.map(
          (rel: any) => ({
            ...rel,
            fromCharacterId: charIdMap.get(rel.fromCharacterId) || rel.fromCharacterId,
            toCharacterId: charIdMap.get(rel.toCharacterId) || rel.toCharacterId,
          }),
        );
      }

      // 应用默认图片模型到角色，并自动生成音色提示词
      const currentEpisodeNumber = get().currentEpisodeNumber ?? 1;
      let charactersWithModel = data.characters.map((c: any) => ({
        ...c,
        model: imageModel,
        voicePrompt: c.voicePrompt || generateVoicePromptFromDescription(c),
      }));

      // 关键修复：LLM 解析结果可能仍把多视图（isPortrait=false）放在 fullBodyImages 中，
      // 需要拆分到 multiViewImages，确保形象照列表只包含 isPortrait=true 的形象照。
      charactersWithModel = charactersWithModel.map((c: any) => {
        const fullBodyImages = c.fullBodyImages || [];
        const existingMultiViews = c.multiViewImages || [];
        const portraits = fullBodyImages.filter((img: any) => img.isPortrait !== false);
        const extraMultiViews = fullBodyImages.filter((img: any) => img.isPortrait === false);
        if (portraits.length === 0 && extraMultiViews.length === 0 && existingMultiViews.length === 0) return c;
        return {
          ...c,
          fullBodyImages: portraits.map((img: any) => ({
            ...img,
            // 形象照名统一补角色名前缀（LLM 续集常漏加，导致跨角色重名/分镜引用错角色）
            name: ensurePortraitNamePrefix(c.name, img.name),
            episodeNumber: img.episodeNumber ?? currentEpisodeNumber,
          })),
          multiViewImages: [...existingMultiViews, ...extraMultiViews],
        };
      });

      // 应用默认图片模型到场景
      let scenesWithModel = data.scenes.map((s: any) => ({
        ...s,
        model: imageModel,
      }));
      // 应用默认图片模型到道具
      let propsWithModel = (data.props || []).map((p: any) => ({
        ...p,
        model: imageModel,
      }));
      // 应用默认图片模型到故事背景
      let eraWithModel = data.era ? {
        ...data.era,
        model: imageModel,
      } : null;

      // ===== 跨项目切换校验 =====
      // 如果用户在此期间切换了项目，不更新当前 workflowStore，避免污染新项目
      const currentProjectId = get().currentProjectId;
      if (startedProjectId && startedProjectId !== currentProjectId) {
        console.warn(`[parseScript] 项目已切换(${startedProjectId} -> ${currentProjectId})，不更新当前 workflowStore`);
        // 将数据保存到原项目的 localStorage，方便用户返回时查看
        const activeCharacterIds = charactersWithModel.map((c: any) => c.id);
        const activeSceneIds = scenesWithModel.map((s: any) => s.id);
        saveWorkflowStateToLocal(startedProjectId, startedEpisodeNumber, {
          characters: charactersWithModel,
          scenes: scenesWithModel,
          era: eraWithModel,
          relationshipNetwork: data.relationshipNetwork || null,
          activeCharacterIds,
          activeSceneIds,
        });
        completeTask(taskId, { text: `剧本解析完成（已保存到原项目）` });
        return;
      }

      // 如果存在上一集数据（previousEpisodeScript 非空 或已有角色数据），进行智能合并
      // replace 为 true 时表示重新分解，直接替换当前数据，不累加
      let mergedRelationshipNetwork = state.relationshipNetwork;
      const nextCurrentStep = get().isSimplifiedMode ? 1 : 2;
      if (!options?.replace && (state.previousEpisodeScript || state.characters.length > 0)) {
        // ===== 角色合并 =====
        // 上一集角色 Map（按名称匹配）
        const prevCharacterMap = new Map(state.characters.map(c => [c.name, c]));

        // 合并：新旧都有的保留并复用上一集已生成的资源，只保留新剧本中存在的，新增新剧本中的
        // 关键修复：characters/scenes 已统一为项目级资产（episode_number=0），跨集共享。
        // 新剧本中未出现的旧角色/场景也必须保留，否则其他分集的 activeCharacterIds/activeSceneIds
        // 会指向已不存在的资产，导致返回旧分集时角色/场景丢失。
        const newCharacterNames = new Set(charactersWithModel.map((c: any) => c.name));
        const mergedCharacters = [
          ...charactersWithModel.map((newChar: any) => {
            const prevChar = prevCharacterMap.get(newChar.name);
            if (prevChar) {
              // 合并形象照：按 name + episodeNumber 去重，保留上一集已有图片，新剧本新增的追加
              // 关键修复：多视图不应进入 fullBodyImages，这里过滤掉 isPortrait=false 的历史数据
              const prevImages = (prevChar.fullBodyImages || []).filter((img: any) => img.isPortrait !== false);
              const newImages = (newChar.fullBodyImages || []).filter((img: any) => img.isPortrait !== false);
              const prevImageMap = new Map(prevImages.map((img: any) => [`${img.name}::${img.episodeNumber ?? 0}`, img]));
              const mergedImages = [...prevImages];
              for (const newImg of newImages) {
                const key = `${newImg.name}::${newImg.episodeNumber ?? 0}`;
                if (!prevImageMap.has(key)) {
                  mergedImages.push(newImg);
                  prevImageMap.set(key, newImg);
                }
              }
              // 角色名称相同：复用上一集已生成的图片资源和 ID，确保跨集 activeCharacterIds 匹配
              // 多视图属于项目级资产，跨集共享，优先保留上一集已生成的多视图
              return {
                ...newChar,
                id: prevChar.id,
                avatarImages: prevChar.avatarImages,
                multiViewImages: prevChar.multiViewImages?.length ? prevChar.multiViewImages : newChar.multiViewImages,
                fullBodyImages: mergedImages.slice(-MAX_PORTRAITS_PER_CHARACTER),
                currentAvatarIndex: prevChar.currentAvatarIndex,
                voicePrompt: newChar.voicePrompt || prevChar.voicePrompt || generateVoicePromptFromDescription(newChar),
                model: prevChar.model || newChar.model,
                isGeneratingAvatar: false,
                isGeneratingViews: false,
                isNew: false,
              };
            }
            return {
              ...newChar,
              voicePrompt: newChar.voicePrompt || generateVoicePromptFromDescription(newChar),
              isNew: true,
            };
          }),
          // 保留上一集中未在新剧本出现的角色（项目级资产跨集共享）
          ...state.characters.filter((prevChar: any) => !newCharacterNames.has(prevChar.name)),
        ];

        // ===== 场景合并 =====
        const prevSceneMap = new Map(state.scenes.map(s => [s.name, s]));
        const newSceneNames = new Set(scenesWithModel.map((s: any) => s.name));
        const mergedScenes = [
          ...scenesWithModel.map((newScene: any) => {
            const prevScene = prevSceneMap.get(newScene.name);
            if (prevScene) {
              // 场景名称相同：复用上一集已生成的图片资源和 ID
              // 关键：imageAssetIds 也必须复用——场景图可能只有 assetId（imageUrls 为空时
              // 前端通过 assetId 解析出 URL），漏掉会导致合并后图片为空
              return {
                ...newScene,
                id: prevScene.id,
                imageUrls: prevScene.imageUrls?.length ? prevScene.imageUrls : newScene.imageUrls,
                imageAssetIds: prevScene.imageAssetIds?.length ? prevScene.imageAssetIds : newScene.imageAssetIds,
                isDerived: prevScene.isDerived ?? newScene.isDerived,
                imagePrompt: prevScene.imagePrompt || newScene.imagePrompt,
                model: prevScene.model || newScene.model,
                isGenerating: false,
                isNew: false,
              };
            }
            return { ...newScene, isNew: true };
          }),
          // 保留上一集中未在新剧本出现的场景（项目级资产跨集共享）
          ...state.scenes.filter((prevScene: any) => !newSceneNames.has(prevScene.name)),
        ];

        // ===== 道具合并 =====（与场景同为项目级资产，同名复用上一集已生成的图片和 ID）
        const prevPropMap = new Map((state.props || []).map((p) => [p.name, p]));
        const newPropNames = new Set(propsWithModel.map((p: any) => p.name));
        const mergedProps = [
          ...propsWithModel.map((newProp: any) => {
            const prevProp = prevPropMap.get(newProp.name);
            if (prevProp) {
              return {
                ...newProp,
                id: prevProp.id,
                imageUrls: prevProp.imageUrls?.length ? prevProp.imageUrls : newProp.imageUrls,
                imageAssetIds: prevProp.imageAssetIds?.length ? prevProp.imageAssetIds : newProp.imageAssetIds,
                imagePrompt: prevProp.imagePrompt || newProp.imagePrompt,
                model: prevProp.model || newProp.model,
                isGenerating: false,
                isNew: false,
              };
            }
            return { ...newProp, isNew: true };
          }),
          // 保留上一集中未在新剧本出现的道具（项目级资产跨集共享）
          ...(state.props || []).filter((prevProp: any) => !newPropNames.has(prevProp.name)),
        ];

        // ===== 关系网合并 =====
        if (data.relationshipNetwork && state.relationshipNetwork) {
          // 获取新剧本中存在的角色名称集合（名称是跨集匹配的可靠键）
          const newCharacterNames = new Set(charactersWithModel.map((c: any) => c.name));

          // 以新剧本的关系网为基础，合并上一集的关系数据
          const newRelationships = (data.relationshipNetwork?.relationships || []);
          const prevRelationships = (state.relationshipNetwork.relationships || [])
            .filter(rel => newCharacterNames.has(rel.fromCharacterName) && newCharacterNames.has(rel.toCharacterName));

          // 用 Map 合并：保留所有涉及当前角色的关系，新剧本中的关系优先（更新描述）
          const relMap = new Map<string, any>();

          // 先加入上一集仍然有效的关系
          for (const rel of prevRelationships) {
            relMap.set(`${rel.fromCharacterName}::${rel.toCharacterName}`, rel);
          }

          // 再用新剧本中的关系更新/补充
          for (const rel of newRelationships) {
            const key = `${rel.fromCharacterName}::${rel.toCharacterName}`;
            if (relMap.has(key)) {
              const existing = relMap.get(key);
              relMap.set(key, { ...existing, description: rel.description || existing.description });
            } else if (newCharacterNames.has(rel.fromCharacterName) && newCharacterNames.has(rel.toCharacterName)) {
              relMap.set(key, rel);
            }
          }

          mergedRelationshipNetwork = {
            ...state.relationshipNetwork,
            description: data.relationshipNetwork?.description || state.relationshipNetwork.description,
            relationships: Array.from(relMap.values()),
          };
        } else if (data.relationshipNetwork) {
          // 上一集没有关系网，直接使用新剧本的
          mergedRelationshipNetwork = data.relationshipNetwork;
        }
        // 否则保留上一集的关系网（mergedRelationshipNetwork 已在开头设为 state.relationshipNetwork）

        // ===== 故事背景：保持与上一集一致 =====
        if (state.era) {
          eraWithModel = state.era;
        }

        charactersWithModel = mergedCharacters;
        scenesWithModel = mergedScenes;
        propsWithModel = mergedProps;

        // active IDs 只包含新剧本中出现的角色/场景
        // 旧角色保留在 characters 数组（项目级跨集共享），但不是当前分集的活跃角色
        const activeCharIds = mergedCharacters
          .filter((c: any) => newCharacterNames.has(c.name))
          .map((c: any) => c.id);
        const activeScIds = mergedScenes
          .filter((s: any) => newSceneNames.has(s.name))
          .map((s: any) => s.id);
        // 道具同理：旧道具保留在 props 数组（项目级跨集共享），活跃 IDs 只含新剧本出现的道具
        const activePropIds = mergedProps
          .filter((p: any) => newPropNames.has(p.name))
          .map((p: any) => p.id);

        // 关键修复：合并后角色 id 可能复用上一集旧 id（同名），
        // 但 relationshipNetwork 中仍引用 parseScript 生成的新 UUID，
        // 导致关系网中的 from/to id 与 activeCharacterIds 不一致。
        // 这里按角色名称重新映射关系引用，确保 id 与合并后的角色一致。
        if (mergedRelationshipNetwork?.relationships) {
          const charIdByName = new Map(mergedCharacters.map((c: any) => [c.name, c.id]));
          mergedRelationshipNetwork = {
            ...mergedRelationshipNetwork,
            relationships: mergedRelationshipNetwork.relationships.map((rel: any) => ({
              ...rel,
              fromCharacterId: charIdByName.get(rel.fromCharacterName) || rel.fromCharacterId,
              toCharacterId: charIdByName.get(rel.toCharacterName) || rel.toCharacterId,
            })),
          };
        }

        // 在合并分支内直接执行 setState，避免变量作用域问题
        set({
          characters: charactersWithModel,
          scenes: scenesWithModel,
          props: propsWithModel,
          era: eraWithModel,
          relationshipNetwork: mergedRelationshipNetwork,
          episodeOutlines: Array.isArray(data.episodeOutlines) ? data.episodeOutlines : [],
          activeCharacterIds: activeCharIds,
          activeSceneIds: activeScIds,
          activePropIds,
          currentStep: nextCurrentStep,
        });
      } else {
        set({
          characters: charactersWithModel,
          scenes: scenesWithModel,
          props: propsWithModel,
          era: eraWithModel,
          relationshipNetwork: data.relationshipNetwork || null,
          episodeOutlines: Array.isArray(data.episodeOutlines) ? data.episodeOutlines : [],
          activeCharacterIds: charactersWithModel.map((c: any) => c.id),
          activeSceneIds: scenesWithModel.map((s: any) => s.id),
          activePropIds: propsWithModel.map((p: any) => p.id),
          currentStep: nextCurrentStep,
        });
      }
      // 手动触发持久化，确保分解数据立即保存
      let projectId = get().currentProjectId;
      if (!projectId) {
        projectId = 'default';
      }
      const episodeNumber = get().currentEpisodeNumber ?? 1;
      // 从 store 读取正确的 active IDs（合并分支已按新剧本过滤，只含当前剧本角色）
      const stateAfterSet = get();
      const activeCharacterIds = stateAfterSet.activeCharacterIds;
      const activeSceneIds = stateAfterSet.activeSceneIds;
      const activePropIds = stateAfterSet.activePropIds;
      console.log('[DEBUG parseScript] saving episode', episodeNumber, 'activeCharacterIds:', activeCharacterIds, 'activeSceneIds:', activeSceneIds, 'activePropIds:', activePropIds, 'chars:', charactersWithModel.length, 'scenes:', scenesWithModel.length, 'props:', propsWithModel.length);
      saveWorkflowStateToLocal(projectId, episodeNumber, {
        ...state,
        characters: charactersWithModel,
        scenes: scenesWithModel,
        props: propsWithModel,
        era: eraWithModel,
        activeCharacterIds,
        activeSceneIds,
        activePropIds,
      });
      completeTask(taskId, { text: `剧本解析完成：${charactersWithModel.length} 个角色，${scenesWithModel.length} 个场景，${propsWithModel.length} 个道具` });
      // 关键修复：parseScript 仅 saveWorkflowStateToLocal 写入本地，缺少云端持久化
      // 导致 creator_drama_project_assets 表中 characters/scenes 为空，跨设备/重载后数据丢失
      // 显式触发云端同步：先 persistWorkflowState（双写 localStorage + 立即 saveToServer）
      if (projectId !== 'default') {
        const stateAfter = get();
        persistWorkflowState(projectId, episodeNumber, {
          ...stateAfter,
          characters: charactersWithModel,
          scenes: scenesWithModel,
          props: propsWithModel,
          era: eraWithModel,
          activeCharacterIds,
          activeSceneIds,
        });
        // 数据已重新生成，清除 SaveGuard 的重置标记（允许后续保存）
        saveGuard.clearResetMark();
        // 立即保存到云端，避免依赖 1s 防抖窗口
        // force：此时 isParsingScript 仍为 true（finally 中才复位），显式保存需绕过进行中拦截
        saveToServer({
          ...stateAfter,
          characters: charactersWithModel,
          scenes: scenesWithModel,
          props: propsWithModel,
          era: eraWithModel,
          activeCharacterIds,
          activeSceneIds,
        }, episodeNumber, { force: true }).catch((e) => {
          console.warn('[parseScript] 云端同步失败:', e);
        });
      }
    } catch (error: any) {
      failTask(taskId, error.message || '解析失败');
      console.error('[parseScript] 解析失败:', error);
      message.error(error?.message || '解析剧本失败，请稍后重试');
    } finally {
      set({ isParsingScript: false });
      loading.hide();
      const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
      if (task && (task.status === 'running' || task.status === 'polling')) {
        removeTask(taskId);
      }
    }
  };

  if (shouldPreview()) {
    return new Promise<void>((resolve, reject) => {
      triggerPreview(
        {
          endpoint: '/api/creator/script/parse',
          body: { script, model: textModel },
        },
        async () => {
          try {
            await doGenerate();
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }

  await doGenerate();
},
  };
}
