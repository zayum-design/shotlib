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
 * workflowStore.episode.frame.ts — 片段参考图/首尾帧批量生成 Slice
 *
 * 包含：generateShotReferenceImage, batchGenerateReferenceImages,
 *       batchGenerateEpisodeShotReferences, batchGenerateEpisodeFrames
 */
import type { StoreApi } from 'zustand';
import * as workflowApi from '../api/workflowApi';
import { getCurrentProjectAspectRatio, saveWorkflowStateToLocal, generateShotPrompt, parseFramePrompt, filterCharacterPortraitsByEpisode } from '../utils/workflowUtils';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { shouldPreview, triggerPreview, setSkipPreview } from './workflowStore';
import type { WorkflowState } from './workflowStore';
import { message } from '@/shared/utils/message';

type SetFn = StoreApi<WorkflowState>['setState'];
type GetFn = StoreApi<WorkflowState>['getState'];

export interface EpisodeFrameSliceActions {
  generateShotReferenceImage: (episodeId: string, shotIndex: number, model?: string) => Promise<void>;
  batchGenerateReferenceImages: (model?: string) => Promise<void>;
  batchGenerateEpisodeShotReferences: (episodeId: string, model?: string) => Promise<void>;
  batchGenerateEpisodeFrames: (episodeId: string, model?: string) => Promise<void>;
}

export function createEpisodeFrameSlice(set: SetFn, get: GetFn): EpisodeFrameSliceActions {
  return {
    generateShotReferenceImage: async (episodeId: string, shotIndex: number, model?: string) => {
      const episode = get().episodes.find((e) => e.id === episodeId);
      const era = get().era;
      const scenes = get().scenes;
      const characters = filterCharacterPortraitsByEpisode(get().characters, get().currentEpisodeNumber ?? 1);
      const { imageModel } = get();
      if (!episode) return;

      const shot = episode.shots?.[shotIndex];
      if (!shot) return;

      const fullPrompt = shot.referencePrompt?.trim() || generateShotPrompt(shot);
      if (!fullPrompt.trim()) {
        message.warning('分镜提示词为空，无法生成参考图');
        return;
      }

      const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(
        fullPrompt,
        scenes,
        characters
      );

      const finalPrompt = cleanPrompt;

      const frameModel = model || episode.frameModel || imageModel;
      const frameModelConfig = get().imageModels.find((m) => m.id === frameModel);

      const doGenerate = async () => {
        set((state) => ({
          episodes: state.episodes.map((e) => {
            if (e.id !== episodeId) return e;
            const updatedShots = e.shots ? [...e.shots] : [];
            if (updatedShots[shotIndex]) {
              updatedShots[shotIndex] = { ...updatedShots[shotIndex], isGeneratingReferenceImage: true };
            }
            return { ...e, shots: updatedShots };
          }),
        }));

        const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
        const taskId = addTask({ type: 'shot-reference', name: `生成分镜参考图: 分镜${shotIndex + 1}`, status: 'running', prompt: finalPrompt, modelVariant: frameModel });

        try {
          const response = await workflowApi.generateSceneImageApi(
            finalPrompt,
            frameModel,
            1,
            era?.globalPrompt,
            getCurrentProjectAspectRatio(),
            undefined,
            undefined,
            true,
            referenceImageUrls,
            frameModelConfig?.supports?.sequential_image_generation,
          );

          if (!response.success) {
            failTask(taskId, '提交失败');
            set((state) => ({
              episodes: state.episodes.map((e) => {
                if (e.id !== episodeId) return e;
                const updatedShots = e.shots ? [...e.shots] : [];
                if (updatedShots[shotIndex]) {
                  updatedShots[shotIndex] = { ...updatedShots[shotIndex], isGeneratingReferenceImage: false };
                }
                return { ...e, shots: updatedShots };
              }),
            }));
            return;
          }

          const jobData = response.data as any;
          let imageUrl: string | undefined;

          if (jobData?.jobId) {
            const jobId = jobData.jobId;

            const pollResult = await workflowApi.pollJobStatus<workflowApi.GenerateSceneImageResponse>(jobId, {
              interval: 3000,
              maxWaitTime: 5 * 60 * 1000,
              onPoll: (attempt) => {
                incrementPollCount(taskId);
              },
            });

            if (!pollResult.success) {
              failTask(taskId, pollResult.error || '执行失败');
              set((state) => ({
                episodes: state.episodes.map((e) => {
                  if (e.id !== episodeId) return e;
                  const updatedShots = e.shots ? [...e.shots] : [];
                  if (updatedShots[shotIndex]) {
                    updatedShots[shotIndex] = { ...updatedShots[shotIndex], isGeneratingReferenceImage: false };
                  }
                  return { ...e, shots: updatedShots };
                }),
              }));
              return;
            }

            imageUrl = pollResult.data?.images?.[0];
          } else {
            imageUrl = (response.data as any)?.images?.[0];
          }

          if (imageUrl) {
            const updatedEpisodes = get().episodes.map((e) => {
              if (e.id !== episodeId) return e;
              const updatedShots = e.shots ? [...e.shots] : [];
              if (updatedShots[shotIndex]) {
                updatedShots[shotIndex] = {
                  ...updatedShots[shotIndex],
                  isGeneratingReferenceImage: false,
                  referenceImageUrl: imageUrl,
                };
              }
              return { ...e, shots: updatedShots };
            });

            set({ episodes: updatedEpisodes });

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
            message.success('分镜参考图生成完成');
          }
        } catch (error: any) {
          failTask(taskId, error?.message || '生成失败');
          console.error('[generateShotReferenceImage] 生成失败:', error);
          message.error(error?.message || '分镜参考图生成失败');
          set((state) => ({
            episodes: state.episodes.map((e) => {
              if (e.id !== episodeId) return e;
              const updatedShots = e.shots ? [...e.shots] : [];
              if (updatedShots[shotIndex]) {
                updatedShots[shotIndex] = { ...updatedShots[shotIndex], isGeneratingReferenceImage: false };
              }
              return { ...e, shots: updatedShots };
            }),
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
            endpoint: '/api/creator/image-processing/generate',
            body: workflowApi.buildGenerateSceneImageRequestBody(
              finalPrompt,
              frameModel,
              1,
              era?.globalPrompt,
              getCurrentProjectAspectRatio(),
              referenceImageUrls,
              get().imageModels.find((m) => m.id === frameModel)?.supports?.sequential_image_generation,
              true,
            ),
          },
          doGenerate
        );
        return;
      }

      await doGenerate();
    },

    batchGenerateReferenceImages: async (model?: string) => {
      const { episodes, scenes, era, imageModel } = get();
      const characters = filterCharacterPortraitsByEpisode(get().characters, get().currentEpisodeNumber ?? 1);
      const tasks: Array<() => Promise<void>> = [];
      const previewItems: Array<{ endpoint: string; body: any }> = [];

      for (const episode of episodes) {
        const frameModel = model || episode.frameModel || imageModel;
        if (episode.firstFramePrompt && !episode.firstFrameImageUrl) {
          const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(
            episode.firstFramePrompt,
            scenes,
            characters
          );
          previewItems.push({
            endpoint: `/api/creator/episode/${episode.id}/first-frame`,
              body: workflowApi.buildGenerateFirstFrameRequestBody(
                cleanPrompt,
                frameModel,
                era?.globalPrompt,
                referenceImageUrls,
                getCurrentProjectAspectRatio(),
                true,
                true,
                get().currentEpisodeNumber
              ),
          });
          tasks.push(() => get().generateFirstFrame(episode.id, model));
        }
        if (episode.lastFramePrompt && !episode.lastFrameImageUrl) {
          const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(
            episode.lastFramePrompt,
            scenes,
            characters
          );
          previewItems.push({
            endpoint: `/api/creator/episode/${episode.id}/last-frame`,
              body: workflowApi.buildGenerateLastFrameRequestBody(
                cleanPrompt,
                frameModel,
                era?.globalPrompt,
                referenceImageUrls,
                getCurrentProjectAspectRatio(),
                true,
                true,
                get().currentEpisodeNumber
              ),
          });
          tasks.push(() => get().generateLastFrame(episode.id, model));
        }
        if (episode.shots) {
          episode.shots.forEach((shot, idx) => {
            const refPrompt = shot.referencePrompt?.trim() || generateShotPrompt(shot);
            if (refPrompt && !shot.referenceImageUrl && !shot.isGeneratingReferenceImage) {
              const fullPrompt = shot.referencePrompt?.trim() || generateShotPrompt(shot);
              const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(
                fullPrompt,
                scenes,
                characters
              );
              previewItems.push({
                endpoint: '/api/creator/image-processing/generate',
                body: workflowApi.buildGenerateSceneImageRequestBody(
              cleanPrompt,
              frameModel,
              1,
              era?.globalPrompt,
              getCurrentProjectAspectRatio(),
              referenceImageUrls,
              get().imageModels.find((m) => m.id === frameModel)?.supports?.sequential_image_generation,
              true,
            ),
              });
              tasks.push(() => get().generateShotReferenceImage(episode.id, idx, model));
            }
          });
        }
      }

      if (tasks.length === 0) {
        message.info('所有参考图已生成');
        return;
      }

      const doBatch = async () => {
        message.info(`开始批量生成 ${tasks.length} 张参考图...`);
        setSkipPreview(true);
        try {
          await Promise.allSettled(tasks.map((fn) => fn()));
        } finally {
          setSkipPreview(false);
        }
        message.success('批量生成参考图任务已全部完成');
      };

      if (shouldPreview()) {
        triggerPreview(previewItems, doBatch);
        return;
      }

      await doBatch();
    },

    batchGenerateEpisodeShotReferences: async (episodeId: string, model?: string) => {
      const { scenes, era, imageModel } = get();
      const characters = filterCharacterPortraitsByEpisode(get().characters, get().currentEpisodeNumber ?? 1);
      const episode = get().episodes.find((e) => e.id === episodeId);
      if (!episode) return;

      const frameModel = model || episode.frameModel || imageModel;
      const tasks: Array<() => Promise<void>> = [];
      const previewItems: Array<{ endpoint: string; body: any }> = [];

      if (episode.shots) {
        episode.shots.forEach((shot, idx) => {
          const refPrompt = shot.referencePrompt?.trim() || generateShotPrompt(shot);
          if (refPrompt && !shot.referenceImageUrl && !shot.isGeneratingReferenceImage) {
            const fullPrompt = shot.referencePrompt?.trim() || generateShotPrompt(shot);
            const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(
              fullPrompt,
              scenes,
              characters
            );
            previewItems.push({
              endpoint: '/api/creator/image-processing/generate',
              body: workflowApi.buildGenerateSceneImageRequestBody(
              cleanPrompt,
              frameModel,
              1,
              era?.globalPrompt,
              getCurrentProjectAspectRatio(),
              referenceImageUrls,
              get().imageModels.find((m) => m.id === frameModel)?.supports?.sequential_image_generation,
              true,
            ),
            });
            tasks.push(() => get().generateShotReferenceImage(episodeId, idx, model));
          }
        });
      }

      if (tasks.length === 0) {
        message.info('当前片段所有分镜参考图已生成');
        return;
      }

      const doBatch = async () => {
        message.info(`开始批量生成 ${tasks.length} 张分镜参考图...`);
        setSkipPreview(true);
        try {
          await Promise.allSettled(tasks.map((fn) => fn()));
        } finally {
          setSkipPreview(false);
        }
        message.success('批量生成参考图任务已全部完成');
      };

      if (shouldPreview()) {
        triggerPreview(previewItems, doBatch);
        return;
      }

      await doBatch();
    },

    batchGenerateEpisodeFrames: async (episodeId: string, model?: string) => {
      const { scenes, era, imageModel } = get();
      const characters = filterCharacterPortraitsByEpisode(get().characters, get().currentEpisodeNumber ?? 1);
      const episode = get().episodes.find((e) => e.id === episodeId);
      if (!episode) return;

      const frameModel = model || episode.frameModel || imageModel;
      const tasks: Array<() => Promise<void>> = [];
      const previewItems: Array<{ endpoint: string; body: any }> = [];

      if (episode.firstFramePrompt && !episode.firstFrameImageUrl && !episode.isGeneratingFirstFrame) {
        const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(
          episode.firstFramePrompt,
          scenes,
          characters
        );
        previewItems.push({
          endpoint: `/api/creator/episode/${episodeId}/first-frame`,
              body: workflowApi.buildGenerateFirstFrameRequestBody(
                cleanPrompt,
                frameModel,
                era?.globalPrompt,
                referenceImageUrls,
                getCurrentProjectAspectRatio(),
                true,
                true,
                get().currentEpisodeNumber
              ),
        });
        tasks.push(() => get().generateFirstFrame(episodeId, model));
      }
      if (episode.lastFramePrompt && !episode.lastFrameImageUrl && !episode.isGeneratingLastFrame) {
        const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(
          episode.lastFramePrompt,
          scenes,
          characters
        );
        previewItems.push({
          endpoint: `/api/creator/episode/${episodeId}/last-frame`,
              body: workflowApi.buildGenerateLastFrameRequestBody(
                cleanPrompt,
                frameModel,
                era?.globalPrompt,
                referenceImageUrls,
                getCurrentProjectAspectRatio(),
                true,
                true,
                get().currentEpisodeNumber
              ),
        });
        tasks.push(() => get().generateLastFrame(episodeId, model));
      }

      if (tasks.length === 0) {
        message.info('当前片段首尾帧已生成');
        return;
      }

      const doBatch = async () => {
        message.info(`开始批量生成 ${tasks.length} 张首尾帧图片...`);
        setSkipPreview(true);
        try {
          await Promise.allSettled(tasks.map((fn) => fn()));
        } finally {
          setSkipPreview(false);
        }
        message.success('批量生成首尾帧任务已全部完成');
      };

      if (shouldPreview()) {
        triggerPreview(previewItems, doBatch);
        return;
      }

      await doBatch();
    },
  };
}
