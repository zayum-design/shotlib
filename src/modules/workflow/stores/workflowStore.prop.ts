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
 * workflowStore.prop.ts — 道具 slice
 *
 * 道具图生成/重新生成，结构与 workflowStore.scene.ts 对齐（去掉多视角概念）。
 */
import { Modal } from 'antd';
import type { StoreApi } from 'zustand';
import * as workflowApi from '../api/workflowApi';
import { buildGeneratePropImageRequestBody, generatePropImageApi, buildPropFullPrompt, PROP_NUM_IMAGES } from '../api/propApi';
import { getCurrentProjectAspectRatio, saveWorkflowStateToLocal } from '../utils/workflowUtils';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { shouldPreview, triggerPreview } from './workflowStore';
import type { WorkflowState } from './workflowStore';
import { message } from '@/shared/utils/message';

type SetFn = StoreApi<WorkflowState>['setState'];
type GetFn = StoreApi<WorkflowState>['getState'];

/** 解析项目 ID（与 scene slice 同规则） */
function resolveProjectId(get: GetFn): string {
  let projectId = get().currentProjectId;
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
  return projectId;
}

/** 生成完成后手动持久化道具数据（与 scene slice 同结构） */
function persistProps(get: GetFn, updatedProps: any[]) {
  const projectId = resolveProjectId(get);
  const episodeNumber = get().currentEpisodeNumber ?? 1;
  const state = get();
  saveWorkflowStateToLocal(projectId, episodeNumber, {
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
    props: updatedProps,
    era: state.era,
    relationshipNetwork: state.relationshipNetwork,
    previousEpisodeScript: state.previousEpisodeScript,
    episodes: state.episodes,
    textModels: state.textModels,
    imageModels: state.imageModels,
    videoModels: state.videoModels,
  });
}

export function createPropSlice(set: SetFn, get: GetFn) {
  return {
    addProp: (prop: import('@/shared/types').Prop) => {
      if (!prop.id) {
        prop.id = crypto.randomUUID();
      }
      set((state) => ({
        props: [...(state.props || []), prop],
      }));
    },

    generatePropImages: async (propId: string, model?: string) => {
      const prop = (get().props || []).find((p) => p.id === propId);
      const { artStylePromptHint, imageModels } = get();
      if (!prop) return;

      const numImages = PROP_NUM_IMAGES; // 道具固定生成 4 张候选（与场景多视角数量对齐）

      const fullPrompt = buildPropFullPrompt(prop, artStylePromptHint);

      // 比例：env 下发（sceneImageAspectRatio）优先，回退项目比例
      const aspectRatio = get().sceneImageAspectRatio || getCurrentProjectAspectRatio();

      const doGenerate = async () => {

        // 标记道具正在生成图片
        set((state) => ({
          props: (state.props || []).map((p) =>
            p.id === propId ? { ...p, isGenerating: true } : p
          ),
        }));
        const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
        const taskId = addTask({ type: 'scene-image', name: `生成道具图片: ${prop.name}`, status: 'running', prompt: fullPrompt, modelVariant: model || prop.model });

        try {
          console.log(`[generatePropImages] 开始生成道具图片，道具: ${prop.name}，共${numImages}张`);

          const response = await generatePropImageApi(
            fullPrompt,
            model || prop.model || get().imageModel,
            numImages,
            undefined,
            aspectRatio,
            undefined,
            undefined,
          );

          if (!response.success) {
            failTask(taskId, '提交失败');
            message.error('道具图片生成提交失败');
            set((state) => ({
              props: (state.props || []).map((p) =>
                p.id === propId ? { ...p, isGenerating: false } : p
              ),
            }));
            return;
          }

          const jobData = response.data as any;
          let imageUrls: string[] = [];
          let imageAssetIds: string[] = [];

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
              message.error(pollResult.error || '道具图片生成失败，请稍后重试');
              set((state) => ({
                props: (state.props || []).map((p) =>
                  p.id === propId ? { ...p, isGenerating: false } : p
                ),
              }));
              return;
            }

            imageUrls = pollResult.data?.images || [];
            imageAssetIds = pollResult.data?.assetIds || [];
          } else {
            // 同步模式回退
            const syncData = (response.data as any) || {};
            imageUrls = syncData.images || [];
            imageAssetIds = syncData.assetIds || [];
          }

          console.log(`[generatePropImages] 生成完成，共${imageUrls.length}张图片`);

          if (imageUrls.length > 0) {
            const updatedProps = (get().props || []).map((p) =>
              p.id === propId
                ? { ...p, isGenerating: false, imageUrls, imageAssetIds }
                : p
            );

            set({ props: updatedProps });
            persistProps(get, updatedProps);
            completeTask(taskId, { imageUrls });
            message.success(`${prop.name} 道具图片生成完成`);
          } else {
            failTask(taskId, 'API未返回图片');
            message.error('道具图片生成失败，请稍后重试');
            set((state) => ({
              props: (state.props || []).map((p) =>
                p.id === propId ? { ...p, isGenerating: false } : p
              ),
            }));
          }
        } catch (error: any) {
          failTask(taskId, error?.message || '生成失败');
          console.error('[generatePropImages] 生成失败:', error);
          const errMsg = error?.message || String(error);
          if (errMsg.includes('输入图片可能包含真实人物') || errMsg.includes('敏感内容')) {
            Modal.error({
              title: '生成失败',
              content: '输入图片可能包含真实人物或敏感内容，请更换参考图片后再试。',
            });
          } else {
            message.error(errMsg || '道具图片生成失败，请稍后重试');
          }
          set((state) => ({
            props: (state.props || []).map((p) =>
              p.id === propId ? { ...p, isGenerating: false } : p
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
            endpoint: '/api/creator/image-processing/generate',
            body: buildGeneratePropImageRequestBody(
              fullPrompt,
              model || prop.model || get().imageModel,
              numImages,
              undefined,
              aspectRatio,
              true,
            ),
          },
          doGenerate
        );
        return;
      }

      await doGenerate();
    },

    /**
     * 重新生成道具单张图片（替换指定索引）。
     * 道具无多视角概念，直接调用 generatePropImageApi 生成 1 张。
     */
    regeneratePropImage: async (propId: string, index: number) => {
      const prop = (get().props || []).find((p) => p.id === propId);
      const { artStylePromptHint, imageModels } = get();
      if (!prop) return;

      const fullPrompt = buildPropFullPrompt(prop, artStylePromptHint);
      const aspectRatio = get().sceneImageAspectRatio || getCurrentProjectAspectRatio();

      const doGenerate = async () => {

        // 标记指定索引的图片正在生成
        set((state) => ({
          props: (state.props || []).map((p) => {
            if (p.id !== propId) return p;
            const newImageUrls = [...(p.imageUrls || [])];
            newImageUrls[index] = ''; // 清空当前图片
            return { ...p, imageUrls: newImageUrls, isGenerating: true };
          }),
        }));
        const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
        const taskId = addTask({ type: 'scene-image', name: `重新生成道具图片: ${prop.name}`, status: 'running', prompt: fullPrompt, modelVariant: prop.model });

        try {
          const response = await generatePropImageApi(
            fullPrompt,
            prop.model || get().imageModel,
            1,
            undefined,
            aspectRatio,
            undefined,
            undefined,
          );

          if (!response.success) {
            failTask(taskId, '提交失败');
            set((state) => ({
              props: (state.props || []).map((p) =>
                p.id === propId ? { ...p, isGenerating: false } : p
              ),
            }));
            return;
          }

          const jobData = response.data as any;
          let images: string[] = [];
          let imageAssetIds: string[] = [];

          if (jobData?.jobId) {
            const pollResult = await workflowApi.pollJobStatus<workflowApi.GenerateSceneImageResponse>(jobData.jobId, {
              interval: 3000,
              maxWaitTime: 5 * 60 * 1000,
              onPoll: () => incrementPollCount(taskId),
            });

            if (!pollResult.success) {
              failTask(taskId, pollResult.error || '执行失败');
              message.error(pollResult.error || '道具图片重新生成失败');
              set((state) => ({
                props: (state.props || []).map((p) =>
                  p.id === propId ? { ...p, isGenerating: false } : p
                ),
              }));
              return;
            }

            images = pollResult.data?.images || [];
            imageAssetIds = pollResult.data?.assetIds || [];
          } else {
            const syncData = (response.data as any) || {};
            images = syncData.images || [];
            imageAssetIds = syncData.assetIds || [];
          }

          if (images.length > 0) {
            const updatedProps = (get().props || []).map((p) => {
              if (p.id !== propId) return p;
              const newImageUrls = [...(p.imageUrls || [])];
              const newImageAssetIds = [...(p.imageAssetIds || [])];
              newImageUrls[index] = images[0];
              newImageAssetIds[index] = imageAssetIds[0] || '';
              return { ...p, imageUrls: newImageUrls, imageAssetIds: newImageAssetIds, isGenerating: false };
            });

            set({ props: updatedProps });
            persistProps(get, updatedProps);
            completeTask(taskId, { imageUrls: images });
            message.success(`${prop.name} 道具图片已重新生成`);
          } else {
            throw new Error('未返回图片');
          }
        } catch (error: any) {
          failTask(taskId, error?.message || '生成失败');
          console.error('[regeneratePropImage] 生成失败:', error);
          message.error(error?.message || '道具图片重新生成失败');
          set((state) => ({
            props: (state.props || []).map((p) =>
              p.id === propId ? { ...p, isGenerating: false } : p
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
            endpoint: '/api/creator/image-processing/generate',
            body: buildGeneratePropImageRequestBody(
              fullPrompt,
              prop.model || get().imageModel,
              1,
              undefined,
              aspectRatio,
              true,
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
