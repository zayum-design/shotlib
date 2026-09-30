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
 * workflowStore.episode.ts — 片段生成与管理 Slice
 *
 * 包含：generateEpisodes, updateEpisode
 * 通过 createEpisodeVideoSlice / createEpisodeFrameSlice 组合视频/帧生成逻辑
 */
import { Modal } from 'antd';
import type { StoreApi } from 'zustand';
import * as workflowApi from '../api/workflowApi';
import { saveWorkflowStateToLocal } from '../utils/workflowUtils';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { useLoadingStore } from '@/shared/stores/useLoadingStore';
import { shouldPreview, triggerPreview } from './workflowStore';
import type { WorkflowState } from './workflowStore';
import type { Episode } from '@/shared/types/index';
import { message } from '@/shared/utils/message';
import { persistWorkflowState, saveToServer, cancelDebouncedSave } from './workflowStore.sync';
import { convertPromptToHtml, stripPromptToText, injectPortraitMarkers } from './workflowStore.episode.utils';
import { createEpisodeVideoSlice } from './workflowStore.episode.video';
import { createEpisodeFrameSlice } from './workflowStore.episode.frame';
import { createEpisodeDeriveSlice } from './workflowStore.episode.derive';

type SetFn = StoreApi<WorkflowState>['setState'];
type GetFn = StoreApi<WorkflowState>['getState'];

/** 并发保护：防止 generateEpisodes 被快速多次点击触发多次 LLM 调用和数据覆盖 */
let isGenerateEpisodesRunning = false;

export interface EpisodeSliceActions {
  generateEpisodes: () => Promise<void>;
  updateEpisode: (id: string, updates: any) => void;
  // 追加一个空白片段，返回新片段 id（自动持久化）
  addEpisode: () => string;
  // 按 fromIndex -> toIndex 重排片段（自动持久化）
  reorderEpisodes: (fromIndex: number, toIndex: number) => void;
  // 在指定片段后面插入新片段，返回新片段 id（自动持久化）
  insertEpisodeAfter: (afterEpisodeId: string, episode: Episode) => string;
  // 软删除片段（标记 deleted=true，前端不显示但数据保留可恢复）
  removeEpisode: (episodeId: string) => void;
  // 从已生成视频的片段衍生新片段（截尾帧→上传→建场景→插片段），成功返回新片段 id，失败返回 null
  deriveEpisodeFromVideo: (episodeId: string) => Promise<{ newEpisodeId: string } | null>;
  generateEpisodeVideo: (episodeId: string) => Promise<void>;
  getEpisodeVideoPreviewData: (episodeId: string) => { endpoint: string; body: any } | null;
  pollVideoTaskStatus: (episodeId: string, taskId: string, taskQueueTaskId?: string) => Promise<void>;
  checkPendingVideoTasks: () => void;
  resumeBullVideoPolling: (taskQueueTaskId: string, jobId: string, episodeId: string) => void;
  generateShotReferenceImage: (episodeId: string, shotIndex: number, model?: string) => Promise<void>;
  batchGenerateReferenceImages: (model?: string) => Promise<void>;
  batchGenerateEpisodeShotReferences: (episodeId: string, model?: string) => Promise<void>;
  batchGenerateEpisodeFrames: (episodeId: string, model?: string) => Promise<void>;
}

export function createEpisodeSlice(set: SetFn, get: GetFn): EpisodeSliceActions {
  const videoSlice = createEpisodeVideoSlice(set, get);
  const frameSlice = createEpisodeFrameSlice(set, get);
  const deriveSlice = createEpisodeDeriveSlice(set, get);

  return {
    generateEpisodes: async () => {
      const { script, topic, characters, scenes, props, textModel, videoModel, isGeneratingEpisodes } = get();
      if (!script.trim()) return;

      if (isGenerateEpisodesRunning || isGeneratingEpisodes) {
        console.warn('[generateEpisodes] 已有生成任务在运行，跳过重复触发');
        return;
      }
      isGenerateEpisodesRunning = true;

      const episodeNumberAtStart = get().currentEpisodeNumber ?? 1;
      console.log(`[generateEpisodes] START episode=${episodeNumberAtStart}`);

      const doGenerate = async () => {
        const existingEpisodes = get().episodes;

        set({ isGeneratingEpisodes: true, episodes: [] });
        const loading = useLoadingStore.getState();
        loading.show({ title: '正在生成片段...', description: '请稍候，AI 正在将剧本分解为片段' });
        const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
        const episodePrompt = script?.substring(0, 500) || topic || '生成片段';
        const taskId = addTask({ type: 'episode-generate', name: '生成片段', status: 'running', prompt: episodePrompt, modelVariant: textModel });

        try {
          const response = await workflowApi.generateEpisodesApi(script, characters, scenes, textModel, undefined, true, episodeNumberAtStart, get().episodeMaxDuration || 15, props);

          if (!response.success) {
            failTask(taskId, '提交失败');
            message.error('提交生成任务失败');
            return;
          }

          const jobData = response.data as any;
          let data;

          if (jobData?.jobId) {
            const jobId = jobData.jobId;

            const pollResult = await workflowApi.pollJobStatus(jobId, {
              interval: 3000,
              // 15 分钟：后端单模型超时已提升至 600s（32000 token 长文生成约需 5-10 分钟），
              // 5 分钟必超时会掩盖后端真实执行结果
              maxWaitTime: 15 * 60 * 1000,
              onPoll: (attempt) => {
                incrementPollCount(taskId);
              },
            });

            if (!pollResult.success) {
              failTask(taskId, pollResult.error || '执行失败');
              message.error(`生成片段失败: ${pollResult.error || '未知错误'}`);
              return;
            }

            data = pollResult.data;
          } else {
            data = response.data;
          }

          const resultWrapper = data as any;
          if (resultWrapper?.success === false) {
            const errorMsg = resultWrapper?.error || '生成片段失败';
            console.error('[generateEpisodes] 后端返回业务错误:', resultWrapper);
            throw new Error(errorMsg);
          }

          // 将角色名和场景名替换为 HTML 格式的标记
          const rawEpisodes = (data as any)?.episodes || data;
          if (!Array.isArray(rawEpisodes)) {
            console.error('[generateEpisodes] 后端返回的 data.episodes 不是数组:', data);
            throw new Error('生成片段失败：后端返回数据格式错误');
          }
          if (rawEpisodes.length === 0) {
            console.error('[generateEpisodes] 后端返回的 episodes 为空数组:', data);
            throw new Error('生成片段失败：未生成分段');
          }

          const episodesWithHtml = rawEpisodes.map((ep: any, index: number) => {
            const existing = existingEpisodes.find((e) => e.id === ep.id);
            const preservedModel = existing?.model || videoModel;
            const preservedVideoDuration = existing?.videoDuration || ep.videoDuration || 5;
            const preservedFrameModel = existing?.frameModel;
            const preservedVideoGenerationMode = existing?.videoGenerationMode || ep.videoGenerationMode || 'reference_image';
            const preservedFirstFramePrompt = existing?.firstFramePrompt || ep.firstFramePrompt || '';
            const preservedLastFramePrompt = existing?.lastFramePrompt || ep.lastFramePrompt || '';

            // 处理分镜提示词：限制时长 + 机械注入形象照标记（兜底 LLM 漏标）+ 转换标记为 HTML 标签 + 保留原始提示词
            const maxShotDuration = get().episodeMaxDuration || 15;
            const processedShots = ep.shots?.map((shot: any) => {
              const rawPromptWithPortrait = injectPortraitMarkers(shot.prompt || '', characters, episodeNumberAtStart);
              const rawRefWithPortrait = shot.referencePrompt ? injectPortraitMarkers(shot.referencePrompt, characters, episodeNumberAtStart) : '';
              return {
                ...shot,
                duration: Math.min(shot.duration || 1, maxShotDuration),
                prompt: convertPromptToHtml(rawPromptWithPortrait, characters, scenes, props),
                rawPrompt: rawPromptWithPortrait, // 保留原始提示词，供首尾帧回退等下游使用
                referencePrompt: rawRefWithPortrait ? convertPromptToHtml(rawRefWithPortrait, characters, scenes, props) : '',
                rawReferencePrompt: rawRefWithPortrait,
              };
            }) || [];

            // 若后端未返回首帧/尾帧提示词，基于原始分镜提示词构建回退提示词
            // 使用 rawPrompt（原始未转换文本），避免 HTML 标签污染图片 AI 提示词
            let firstFramePrompt = preservedFirstFramePrompt;
            let lastFramePrompt = preservedLastFramePrompt;
            if (!firstFramePrompt && processedShots.length > 0) {
              const rawPrompt = processedShots[0].rawPrompt || processedShots[0].prompt || '';
              firstFramePrompt = `静态画面，${rawPrompt}`;
            }
            if (!lastFramePrompt && processedShots.length > 0) {
              const rawPrompt = processedShots[processedShots.length - 1].rawPrompt || processedShots[processedShots.length - 1].prompt || '';
              lastFramePrompt = `静态画面，${rawPrompt}`;
            }

            // 首尾帧视频生成提示词：仅作文字指导（首/尾帧图片才是参考图），保留纯文本，不做角色/场景标签化
            let firstLastFrameVideoPrompt = ep.firstLastFrameVideoPrompt || '';
            if (firstLastFrameVideoPrompt) {
              firstLastFrameVideoPrompt = stripPromptToText(firstLastFrameVideoPrompt);
            }

            return {
              ...ep,
              model: preservedModel,
              videoDuration: preservedVideoDuration,
              frameModel: preservedFrameModel,
              videoGenerationMode: preservedVideoGenerationMode,
              shots: processedShots,
              firstFramePrompt: firstFramePrompt ? convertPromptToHtml(injectPortraitMarkers(firstFramePrompt, characters, episodeNumberAtStart), characters, scenes, props) : '',
              lastFramePrompt: lastFramePrompt ? convertPromptToHtml(injectPortraitMarkers(lastFramePrompt, characters, episodeNumberAtStart), characters, scenes, props) : '',
              firstLastFrameVideoPrompt,
              htmlPrompt: ep.htmlPrompt || convertPromptToHtml(injectPortraitMarkers(ep.videoPrompt || '', characters, episodeNumberAtStart), characters, scenes, props),
              index,
            };
          });

          set({ episodes: episodesWithHtml, isGeneratingEpisodes: false, composedVideoUrl: '' });

          const projectId = get().currentProjectId;
          if (projectId && projectId !== 'default') {
            persistWorkflowState(projectId, episodeNumberAtStart);
          }

          // 保存到 localStorage（兼容旧 key）
          try {
            const state = get();
            const partialState = {
              currentStep: state.currentStep,
              topic: state.topic,
              script: state.script,
              textModel: state.textModel,
              agentType: state.agentType,
              skills: state.skills,
              imageModel: state.imageModel,
              videoModel: state.videoModel,
              characters: state.characters,
              scenes: state.scenes,
              era: state.era,
              relationshipNetwork: state.relationshipNetwork,
              previousEpisodeScript: state.previousEpisodeScript,
              episodes: episodesWithHtml,
              textModels: state.textModels,
              imageModels: state.imageModels,
              videoModels: state.videoModels,
              activeCharacterIds: state.activeCharacterIds,
              activeSceneIds: state.activeSceneIds,
            };
            saveWorkflowStateToLocal(projectId || 'default', episodeNumberAtStart, partialState);
            console.log(`[generateEpisodes] END saving projectId=${projectId}, episode=${episodeNumberAtStart}, episodesCount=${episodesWithHtml.length}, activeCharIds=${state.activeCharacterIds.length}`);
          } catch (syncErr) {
            console.error('[generateEpisodes] 同步到后端失败:', syncErr);
          }

          // 显式同步到后端，避免依赖 debouncedSave 的延迟（旧版行为恢复）
          try {
            const currentState = get();
            if (projectId && projectId !== 'default') {
              await saveToServer(currentState, episodeNumberAtStart);
              console.log('[generateEpisodes] 已同步到后端');
            }
          } catch (syncErr) {
            console.error('[generateEpisodes] 同步到后端失败:', syncErr);
          }

          // 所有持久化操作完成后才标记任务完成
          completeTask(taskId, { episodes: episodesWithHtml });
        } catch (error: any) {
          console.error('[generateEpisodes] 生成片段失败:', error);
          console.error('[generateEpisodes] 错误堆栈:', error?.stack);
          failTask(taskId, error?.message || '生成失败');
          message.error(error?.message || '生成片段失败');
          set({ isGeneratingEpisodes: false });
        } finally {
          isGenerateEpisodesRunning = false;
          const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
          if (task && (task.status === 'running' || task.status === 'polling')) {
            removeTask(taskId);
          }
          loading.hide();
        }
      };

      if (shouldPreview()) {
        // 预览模式只发送必要字段，避免请求体过大
        const filteredCharacters = characters.map((c) => ({
          id: c.id, name: c.name, description: c.description,
          avatarUrl: c.avatarImages?.[c.currentAvatarIndex || 0]?.imageUrl,
          fullBodyUrl: c.multiViewImages?.[0]?.imageUrl,
        }));
        const filteredScenes = scenes.map((s) => ({
          id: s.id, name: s.name, description: s.description, imageUrl: s.imageUrls?.[0],
        }));
        triggerPreview(
          {
            endpoint: '/api/creator/episode/generate',
            body: { script, characters: filteredCharacters, scenes: filteredScenes, model: textModel },
          },
          doGenerate
        ).catch(() => {
          // 用户取消预览时 doGenerate 不会执行，其 finally 块无法重置并发保护标志，
          // 需在此手动重置，否则后续点击会被误判为"已有生成任务在运行"而静默跳过。
          isGenerateEpisodesRunning = false;
        });
        return;
      }

      await doGenerate();
    },

    updateEpisode: (id: string, updates: any) => {
      set((state) => ({
        episodes: state.episodes.map((ep) =>
          ep.id === id ? { ...ep, ...updates } : ep
        ),
      }));

      // 手动触发持久化，确保分集数据立即保存
      const projectId = get().currentProjectId;
      const episodeNumber = get().currentEpisodeNumber ?? 1;
      if (projectId && projectId !== 'default') {
        const currentState = get();
        saveToServer(currentState, episodeNumber).catch((e: any) => {
          console.error('[updateEpisode] 同步到后端失败:', e);
        });
      }
    },

    // 追加空白片段（返回新片段 id），复用与 updateEpisode 相同的持久化路径
    addEpisode: () => {
      const { episodes, videoModel } = get();
      const newEpisode: Episode = {
        id: crypto.randomUUID(),
        title: `片段${episodes.length + 1}`,
        description: '',
        videoPrompt: '',
        model: videoModel, // 沿用当前默认视频模型
        videoGenerationMode: 'reference_image', // 必填，与默认 tab 一致
        videoDuration: 5, // 必填
        videoResolution: '720p',
        shots: [],
        // 唯一的大 index（= 当前片段数），避免后续中间插入时与现有片段 index 冲突被覆盖
        index: episodes.length,
      };
      set((state) => ({ episodes: [...state.episodes, newEpisode] }));

      const projectId = get().currentProjectId;
      const episodeNumber = get().currentEpisodeNumber ?? 1;
      if (projectId && projectId !== 'default') {
        // 完整保存（项目级+分集级+缓存）+ 取消防抖旧快照竞态，确保新片段可靠持久化、刷新不丢失
        cancelDebouncedSave();
        saveToServer(get(), episodeNumber).then((ok) => {
          console.log('[addEpisode] saveToServer ok=', ok, 'eps=', get().episodes.length);
        }).catch((e: any) => {
          console.error('[addEpisode] 保存失败:', e);
        });
      }
      return newEpisode.id;
    },

    // 按 fromIndex -> toIndex 重排片段，复用与 updateEpisode 相同的持久化路径
    reorderEpisodes: (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      set((state) => {
        const next = [...state.episodes];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return { episodes: next };
      });

      const projectId = get().currentProjectId;
      const episodeNumber = get().currentEpisodeNumber ?? 1;
      if (projectId && projectId !== 'default') {
        saveToServer(get(), episodeNumber).catch((e: any) => {
          console.error('[reorderEpisodes] 同步到后端失败:', e);
        });
      }
    },

    // 在指定片段后面插入新片段，复用与 addEpisode 相同的持久化路径
    insertEpisodeAfter: (afterEpisodeId: string, episode: Episode) => {
      set((state) => {
        const idx = state.episodes.findIndex((e) => e.id === afterEpisodeId);
        if (idx === -1) {
          console.warn('[insertEpisodeAfter] 未找到源片段:', afterEpisodeId, '当前episodes数:', state.episodes.length, 'ids:', state.episodes.map((e) => e.id));
          return state; // 源片段不存在则不插入（防御）
        }
        console.log('[insertEpisodeAfter] 在 index', idx + 1, '处插入新片段:', episode.id);
        const next = [...state.episodes];
        next.splice(idx + 1, 0, episode); // 插到源片段后一位，而非末尾
        return { episodes: next };
      });

      const projectId = get().currentProjectId;
      const episodeNumber = get().currentEpisodeNumber ?? 1;
      if (projectId && projectId !== 'default') {
        // 完整保存（项目级+分集级+缓存）+ 取消防抖旧快照竞态，确保新片段可靠持久化、刷新不丢失
        cancelDebouncedSave();
        saveToServer(get(), episodeNumber).then((ok) => {
          console.log('[insertEpisodeAfter] saveToServer ok=', ok, 'eps=', get().episodes.length);
        }).catch((e: any) => {
          console.error('[insertEpisodeAfter] 保存失败:', e);
        });
      }
      return episode.id;
    },

    // 软删除片段：标记 deleted=true（不从数组移除，后端 scene 行保留、可恢复），复用 updateEpisode 持久化
    removeEpisode: (episodeId: string) => {
      get().updateEpisode(episodeId, { deleted: true });
    },

    // 从 video / frame / derive 子 slice 组合
    ...videoSlice,
    ...frameSlice,
    ...deriveSlice,
  };
}

// 重新导出工具函数和子 slice 类型
export type { EpisodeVideoSliceActions } from './workflowStore.episode.video';
export type { EpisodeFrameSliceActions } from './workflowStore.episode.frame';
export type { EpisodeDeriveSliceActions } from './workflowStore.episode.derive';
export { convertPromptToHtml, buildUniversalReferenceRequest } from './workflowStore.episode.utils';
export type { UniversalReferenceData } from './workflowStore.episode.utils';
