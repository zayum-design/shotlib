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
import { getCurrentProjectAspectRatio, parseFramePrompt, saveWorkflowStateToLocal, filterCharacterPortraitsByEpisode } from '../utils/workflowUtils';
import { convertPromptToHtml } from './workflowStore.episode.utils';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { localApi } from '@/storage';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { shouldPreview, triggerPreview } from './workflowStore';
import type { WorkflowState } from './workflowStore';
import { message } from '@/shared/utils/message';

type SetFn = StoreApi<WorkflowState>['setState'];
type GetFn = StoreApi<WorkflowState>['getState'];

export function createFrameSlice(set: SetFn, get: GetFn) {
  return {
	generateFirstFrame: async (episodeId: string, model?: string) => {
	  const episode = get().episodes.find((e) => e.id === episodeId);
	  const era = get().era;
	  const scenes = get().scenes;
	  const characters = filterCharacterPortraitsByEpisode(get().characters, get().currentEpisodeNumber ?? 1);

	  if (!episode || !episode.firstFramePrompt?.trim()) return;

	  // 兜底：把提示词统一成带 character-id/scene-id 的标签（firstFramePrompt 可能是纯文本或缺 id 的标签），
	  // 保证 parseFramePrompt 能提取到角色头像/形象照/场景图作为参考图（图上图）
	  const framePromptHtml = convertPromptToHtml(episode.firstFramePrompt || '', characters, scenes, get().props);
	  const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(
	    framePromptHtml,
	    scenes,
	    characters
	  );
	  const frameModel = model || episode.frameModel || get().imageModel;
	  const filteredGlobalPrompt = era?.globalPrompt && !String(era.globalPrompt).startsWith('undefined') ? era.globalPrompt : undefined;

	  const doGenerate = async () => {
	    set((state) => ({
	      episodes: state.episodes.map((e) =>
	        e.id === episodeId ? { ...e, isGeneratingFirstFrame: true } : e
	      ),
	    }));

	    const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
	    const taskId = addTask({ type: 'first-frame', name: '生成首帧图片', status: 'running', prompt: cleanPrompt, modelVariant: frameModel });

	    try {
	      const response = await workflowApi.generateFirstFrameApi(
	        episodeId,
	        cleanPrompt,
	        frameModel,
	        filteredGlobalPrompt,
	        referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
	        getCurrentProjectAspectRatio(),
	        undefined,
	        true,
		get().currentEpisodeNumber
	      );

	      if (!response.success) {
	        failTask(taskId, '提交失败');
	        set((state) => ({
	          episodes: state.episodes.map((e) =>
	            e.id === episodeId ? { ...e, isGeneratingFirstFrame: false } : e
	          ),
	        }));
	        return;
	      }

	      const jobData = response.data as any;
	      let imageUrl: string | undefined;
		let imageAssetId: string | undefined;

	      if (jobData?.jobId) {
	        const jobId = jobData.jobId;

	        const pollResult = await workflowApi.pollJobStatus<workflowApi.GenerateFrameImageResponse>(jobId, {
	          interval: 3000,
	          maxWaitTime: 5 * 60 * 1000,
	          onPoll: (attempt) => {
	            incrementPollCount(taskId);
	          },
	        });

	        if (!pollResult.success) {
	          failTask(taskId, pollResult.error || '执行失败');
	          set((state) => ({
	            episodes: state.episodes.map((e) =>
	              e.id === episodeId ? { ...e, isGeneratingFirstFrame: false } : e
	            ),
	          }));
	          return;
	        }

	        imageUrl = pollResult.data?.imageUrl;
			imageAssetId = pollResult.data?.imageAssetId;
	      } else {
	        // 同步模式回退
	        const syncData = (response.data as any) || {};
			imageUrl = syncData.imageUrl;
			imageAssetId = syncData.imageAssetId;
	      }

	      if (imageUrl) {
	        // 更新首帧图片URL与资产ID
	        const updatedEpisodes = get().episodes.map((e) =>
	          e.id === episodeId
	            ? { ...e, isGeneratingFirstFrame: false, firstFrameImageUrl: imageUrl, firstFrameImageAssetId: imageAssetId }
	            : e
	        );
	        
	        set({ episodes: updatedEpisodes });
	        
	        // 手动触发持久化，确保首帧图片URL立即保存
	        let projectId = get().currentProjectId;
	        const episodeNumber = get().currentEpisodeNumber ?? 1;
	        if (!projectId) {
	          try {
	            const projectStorage = userStorage.getItem('project-storage');
	            if (projectStorage) {
	              const projectData = JSON.parse(projectStorage);
	              projectId = projectData?.state?.currentProjectId || 'default';
	            }
	          } catch (e) {
	            console.error('Failed to read project storage:', e);
	          }
	        }
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
	          episodes: updatedEpisodes,
	          textModels: state.textModels,
	          imageModels: state.imageModels,
	          videoModels: state.videoModels,
	        };
	        saveWorkflowStateToLocal(projectId, episodeNumber, partialState);
	        completeTask(taskId, { imageUrl });
	        message.success('首帧图片生成完成');
	      } else {
	        failTask(taskId, '生成失败，未返回图片');
	        message.error('首帧图片生成失败，未返回有效图片');
	        set((state) => ({
	          episodes: state.episodes.map((e) =>
	            e.id === episodeId ? { ...e, isGeneratingFirstFrame: false } : e
	          ),
	        }));
	      }
	    } catch (error: any) {
	      failTask(taskId, error?.message || '生成失败');
	      message.error(error?.message || '首帧图片生成失败');
	      set((state) => ({
	        episodes: state.episodes.map((e) =>
	          e.id === episodeId ? { ...e, isGeneratingFirstFrame: false } : e
	        ),
	      }));
	    } finally {
	      const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
	      if (task && (task.status === 'running' || task.status === 'polling')) {
	        removeTask(taskId);
	      }
	    }
	  };

	  if (shouldPreview()) {
	    triggerPreview(
	      {
	        endpoint: `/api/creator/episode/${episodeId}/first-frame`,
	        body: workflowApi.buildGenerateFirstFrameRequestBody(
	          cleanPrompt,
	          frameModel,
	          filteredGlobalPrompt,
	          referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
	          getCurrentProjectAspectRatio(),
	          true,
	          true,
	          get().currentEpisodeNumber
	        ),
	      },
	      doGenerate
	    );
	    return;
	  }

	  await doGenerate();
	},

	generateLastFrame: async (episodeId: string, model?: string) => {
	  const episode = get().episodes.find((e) => e.id === episodeId);
	  const era = get().era;
	  const scenes = get().scenes;
	  const characters = filterCharacterPortraitsByEpisode(get().characters, get().currentEpisodeNumber ?? 1);
	  
	  if (!episode || !episode.lastFramePrompt?.trim()) return;

	  // 兜底：把提示词统一成带 id 标签，保证 parseFramePrompt 能提取参考图（图上图，同首帧逻辑）
	  const framePromptHtml = convertPromptToHtml(episode.lastFramePrompt || '', characters, scenes, get().props);
	  const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(
	    framePromptHtml,
	    scenes,
	    characters
	  );
	  const frameModel = model || episode.frameModel || get().imageModel;
	  const filteredGlobalPrompt = era?.globalPrompt && !String(era.globalPrompt).startsWith('undefined') ? era.globalPrompt : undefined;

	  const doGenerate = async () => {
	    set((state) => ({
	      episodes: state.episodes.map((e) =>
	        e.id === episodeId ? { ...e, isGeneratingLastFrame: true } : e
	      ),
	    }));

	    const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
	    const taskId = addTask({ type: 'last-frame', name: '生成尾帧图片', status: 'running', prompt: cleanPrompt, modelVariant: frameModel });

	    try {
	      const response = await workflowApi.generateLastFrameApi(
	        episodeId,
	        cleanPrompt,
	        frameModel,
	        filteredGlobalPrompt,
	        referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
	        getCurrentProjectAspectRatio(),
	        undefined,
	        true,
		get().currentEpisodeNumber
	      );

	      if (!response.success) {
	        failTask(taskId, '提交失败');
	        set((state) => ({
	          episodes: state.episodes.map((e) =>
	            e.id === episodeId ? { ...e, isGeneratingLastFrame: false } : e
	          ),
	        }));
	        return;
	      }

	      const jobData = response.data as any;
	      let imageUrl: string | undefined;
		let imageAssetId: string | undefined;

	      if (jobData?.jobId) {
	        const jobId = jobData.jobId;

	        const pollResult = await workflowApi.pollJobStatus<workflowApi.GenerateFrameImageResponse>(jobId, {
	          interval: 3000,
	          maxWaitTime: 5 * 60 * 1000,
	          onPoll: (attempt) => {
	            incrementPollCount(taskId);
	          },
	        });

	        if (!pollResult.success) {
	          failTask(taskId, pollResult.error || '执行失败');
	          set((state) => ({
	            episodes: state.episodes.map((e) =>
	              e.id === episodeId ? { ...e, isGeneratingLastFrame: false } : e
	            ),
	          }));
	          return;
	        }

	        imageUrl = pollResult.data?.imageUrl;
			imageAssetId = pollResult.data?.imageAssetId;
	      } else {
	        // 同步模式回退
	        const syncData = (response.data as any) || {};
			imageUrl = syncData.imageUrl;
			imageAssetId = syncData.imageAssetId;
	      }

	      if (imageUrl) {
	        // 更新尾帧图片URL与资产ID
	        const updatedEpisodes = get().episodes.map((e) =>
	          e.id === episodeId
	            ? { ...e, isGeneratingLastFrame: false, lastFrameImageUrl: imageUrl, lastFrameImageAssetId: imageAssetId }
	            : e
	        );
	        
	        set({ episodes: updatedEpisodes });
	        
	        // 手动触发持久化，确保尾帧图片URL立即保存
	        let projectId = get().currentProjectId;
	        const episodeNumber = get().currentEpisodeNumber ?? 1;
	        if (!projectId) {
	          try {
	            const projectStorage = userStorage.getItem('project-storage');
	            if (projectStorage) {
	              const projectData = JSON.parse(projectStorage);
	              projectId = projectData?.state?.currentProjectId || 'default';
	            }
	          } catch (e) {
	            console.error('Failed to read project storage:', e);
	          }
	        }
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
	          episodes: updatedEpisodes,
	          textModels: state.textModels,
	          imageModels: state.imageModels,
	          videoModels: state.videoModels,
	        };
	        saveWorkflowStateToLocal(projectId, episodeNumber, partialState);
	        completeTask(taskId, { imageUrl });
	        message.success('尾帧图片生成完成');
	      } else {
	        failTask(taskId, '生成失败，未返回图片');
	        message.error('尾帧图片生成失败，未返回有效图片');
	        set((state) => ({
	          episodes: state.episodes.map((e) =>
	            e.id === episodeId ? { ...e, isGeneratingLastFrame: false } : e
	          ),
	        }));
	      }
	    } catch (error: any) {
	      failTask(taskId, error?.message || '生成失败');
	      message.error(error?.message || '尾帧图片生成失败');
	      set((state) => ({
	        episodes: state.episodes.map((e) =>
	          e.id === episodeId ? { ...e, isGeneratingLastFrame: false } : e
	        ),
	      }));
	    } finally {
	      const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
	      if (task && (task.status === 'running' || task.status === 'polling')) {
	        removeTask(taskId);
	      }
	    }
	  };

	  if (shouldPreview()) {
	    triggerPreview(
	      {
	        endpoint: `/api/creator/episode/${episodeId}/last-frame`,
	        body: workflowApi.buildGenerateLastFrameRequestBody(
	          cleanPrompt,
	          frameModel,
	          filteredGlobalPrompt,
	          referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
	          getCurrentProjectAspectRatio(),
	          true,
	          true,
	          get().currentEpisodeNumber
	        ),
	      },
	      doGenerate
	    );
	    return;
	  }

	  await doGenerate();
	},


  };
}
