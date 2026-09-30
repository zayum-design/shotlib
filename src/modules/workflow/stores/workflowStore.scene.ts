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

import { Modal } from 'antd';
import type { StoreApi } from 'zustand';
import * as workflowApi from '../api/workflowApi';
import { buildGenerateSceneImageRequestBody, buildGenerateSceneViewRequestBody } from '../api/sceneApi';
import { parseFramePrompt, saveWorkflowStateToLocal, syncEpisodePromptImages } from '../utils/workflowUtils';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { shouldPreview, triggerPreview } from './workflowStore';
import type { WorkflowState } from './workflowStore';
import { message } from '@/shared/utils/message';

type SetFn = StoreApi<WorkflowState>['setState'];
type GetFn = StoreApi<WorkflowState>['getState'];

export function createSceneSlice(set: SetFn, get: GetFn) {
  return {
regenerateSceneImage: async (sceneId: string, index: number) => {
  const scene = get().scenes.find((s) => s.id === sceneId);
  const era = get().era;
  const { artStylePromptHint } = get();
  if (!scene) return;

  // 只使用场景提示词,不再拼接 location/timeOfDay/season/weather/description 等场景描述字段
  let fullPrompt = scene.imagePrompt || '';

  // 将画风提示词加入场景提示词
  if (artStylePromptHint) {
    fullPrompt = fullPrompt ? `${fullPrompt},${artStylePromptHint}` : artStylePromptHint;
  }

  // 添加纯场景提示词,避免生成人物
  fullPrompt = `${fullPrompt},纯场景画面,无人物,无角色,空镜头,环境特写。画风仅作为整体色调/光影/质感参考，不改变场景本身的结构、空间关系与物体形态，严禁出现融化的时钟、漂浮的物体、不可能几何等艺术家标志性符号`;

  const referenceImageUrl = scene.imageUrls?.find((url, i) => i !== index && !!url);

  // 产品决策:场景图生成固定 16:9(与显示一致,不随项目比例变化);预览与提交共用(args 单点)
  const aspectRatio = '16:9';

  const doGenerate = async () => {

    // 标记指定索引的图片正在生成
    set((state) => ({
      scenes: state.scenes.map((s) => {
        if (s.id !== sceneId) return s;
        const newImageUrls = [...(s.imageUrls || [])];
        newImageUrls[index] = ''; // 清空当前图片
        return { ...s, imageUrls: newImageUrls, isGenerating: true };
      }),
    }));
    const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
    const taskId = addTask({ type: 'scene-image', name: `生成场景图片: ${scene.name}`, status: 'running', prompt: fullPrompt, modelVariant: scene.model });

    try {
      const response = await workflowApi.generateSceneViewApi(
        fullPrompt,
        scene.model,
        index,
        referenceImageUrl,
        era?.sceneStylePrompt || undefined,
        aspectRatio,
        undefined,
        true
      );

      if (!response.success) {
        failTask(taskId, '提交失败');
        set((state) => ({
          scenes: state.scenes.map((s) =>
            s.id === sceneId ? { ...s, isGenerating: false } : s
          ),
        }));
        return;
      }

      const jobData = response.data as any;
      let images: string[] = [];
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
          console.error('[regenerateSceneImage] 生成失败:', pollResult.error);
          message.error(pollResult.error || '场景图片重新生成失败');
          set((state) => ({
            scenes: state.scenes.map((s) =>
              s.id === sceneId ? { ...s, isGenerating: false } : s
            ),
          }));
          return;
        }

        images = pollResult.data?.images || [];
        imageAssetIds = pollResult.data?.assetIds || [];
      } else {
        // 同步模式回退
        const syncData = (response.data as any) || {};
        images = syncData.images || [];
        imageAssetIds = syncData.assetIds || [];
      }

      if (images.length > 0) {
        // 更新场景图片URL与资产ID
        const updatedScenes = get().scenes.map((s) => {
          if (s.id !== sceneId) return s;
          const newImageUrls = [...(s.imageUrls || [])];
          const newImageAssetIds = [...(s.imageAssetIds || [])];
          newImageUrls[index] = images[0];
          newImageAssetIds[index] = imageAssetIds[0] || '';
          return { ...s, imageUrls: newImageUrls, imageAssetIds: newImageAssetIds, isGenerating: false };
        });

        // 同步更新所有 episode 提示词中该场景的图片
        const newSceneImageUrl = updatedScenes.find((s) => s.id === sceneId)?.imageUrls?.[0] || '';
        const updatedEpisodes = syncEpisodePromptImages(get().episodes, 'scene', sceneId, newSceneImageUrl);

        set({ scenes: updatedScenes, episodes: updatedEpisodes });

        // 手动触发持久化，确保场景图片立即保存
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
          scenes: updatedScenes,
          era: state.era,
          relationshipNetwork: state.relationshipNetwork,
          previousEpisodeScript: state.previousEpisodeScript,
          episodes: updatedEpisodes,
          textModels: state.textModels,
          imageModels: state.imageModels,
          videoModels: state.videoModels,
        };
        saveWorkflowStateToLocal(projectId, episodeNumber, partialState);
        completeTask(taskId, { imageUrls: images });
        message.success(`${scene.name} 场景图片已重新生成`);
      } else {
        throw new Error('未返回图片');
      }
    } catch (error: any) {
      failTask(taskId, error?.message || '生成失败');
      console.error('[regenerateSceneImage] 生成失败:', error);
      message.error(error?.message || '场景图片重新生成失败');
      set((state) => ({
        scenes: state.scenes.map((s) =>
          s.id === sceneId ? { ...s, isGenerating: false } : s
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
        body: buildGenerateSceneViewRequestBody(
          fullPrompt,
          scene.model,
          index,
          referenceImageUrl,
          era?.sceneStylePrompt || undefined,
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

generateSceneImages: async (sceneId: string, model?: string, selectedViews?: number[]) => {
  const scene = get().scenes.find((s) => s.id === sceneId);
  const era = get().era;
  const { artStylePromptHint, imageModels } = get();
  if (!scene) return;

  // 默认只生成正面视角（1张）
  const views = selectedViews ?? [0];
  const numImages = views.length;

  // 只使用场景提示词,不再拼接 location/timeOfDay/season/weather/description 等场景描述字段
  let fullPrompt = scene.imagePrompt || '';

  // 将画风提示词加入场景提示词
  if (artStylePromptHint) {
    fullPrompt = fullPrompt ? `${fullPrompt},${artStylePromptHint}` : artStylePromptHint;
  }

  // 添加纯场景提示词,避免生成人物
  fullPrompt = `${fullPrompt},纯场景画面,无人物,无角色,空镜头,环境特写。画风仅作为整体色调/光影/质感参考，不改变场景本身的结构、空间关系与物体形态，严禁出现融化的时钟、漂浮的物体、不可能几何等艺术家标志性符号`;

  // 产品决策:场景图生成固定 16:9(与显示一致,不随项目比例变化);预览与提交共用(args 单点)
  const aspectRatio = '16:9';
  const sceneModelConfig = imageModels.find((m) => m.id === (model || scene.model));
  const sceneMultiView = sceneModelConfig?.supports?.sequential_image_generation;

  const doGenerate = async () => {

    // 标记场景正在生成图片
    set((state) => ({
      scenes: state.scenes.map((s) =>
        s.id === sceneId ? { ...s, isGenerating: true } : s
      ),
    }));
    const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
    const viewNames = views.map(v => ['正面', '左侧', '右侧', '背面'][v]).join('+');
    const taskId = addTask({ type: 'scene-image', name: `生成场景图片: ${scene.name} (${viewNames})`, status: 'running', prompt: fullPrompt, modelVariant: model || scene.model });

    try {
      console.log(`[generateSceneImages] 开始生成场景图片，场景: ${scene.name}，选中视角: ${viewNames}，共${numImages}张`);
      console.log(`[generateSceneImages] 使用模型: ${model || scene.model}`);
      console.log(`[generateSceneImages] 完整提示词: ${fullPrompt}`);

      // 调用多视角生成API
      // 后端会根据模型类型决定使用链式生成（即梦）还是普通生成
      const response = await workflowApi.generateSceneImageApi(
        fullPrompt,
        model || scene.model,
        numImages,
        era?.sceneStylePrompt || undefined,
        aspectRatio,
        undefined,
        undefined,
        true,
        undefined,
        sceneMultiView,
      );

      console.log(`[generateSceneImages] API响应:`, response);

      if (!response.success) {
        failTask(taskId, '提交失败');
        console.warn('[generateSceneImages] 提交失败');
        message.error('场景图片生成提交失败');
        set((state) => ({
          scenes: state.scenes.map((s) =>
            s.id === sceneId ? { ...s, isGenerating: false } : s
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
          console.warn('[generateSceneImages] 执行失败:', pollResult.error);
          message.error(pollResult.error || '场景图片生成失败，请稍后重试');
          set((state) => ({
            scenes: state.scenes.map((s) =>
              s.id === sceneId ? { ...s, isGenerating: false } : s
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

      console.log(`[generateSceneImages] 生成完成，共${imageUrls.length}张图片`);

      if (imageUrls.length > 0) {
        const updatedScenes = get().scenes.map((s) =>
          s.id === sceneId
            ? { ...s, isGenerating: false, imageUrls, imageAssetIds }
            : s
        );

        // 同步更新所有 episode 提示词中该场景的图片
        const newSceneImageUrl = imageUrls[0] || '';
        const updatedEpisodes = syncEpisodePromptImages(get().episodes, 'scene', sceneId, newSceneImageUrl);

        set({ scenes: updatedScenes, episodes: updatedEpisodes });

        // 手动触发持久化，确保场景图片立即保存
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
          scenes: updatedScenes,
          era: state.era,
          relationshipNetwork: state.relationshipNetwork,
          previousEpisodeScript: state.previousEpisodeScript,
          episodes: updatedEpisodes,
          textModels: state.textModels,
          imageModels: state.imageModels,
          videoModels: state.videoModels,
        };
        saveWorkflowStateToLocal(projectId, episodeNumber, partialState);
        completeTask(taskId, { imageUrls });
        message.success(`${scene.name} 场景图片生成完成`);
      } else {
        failTask(taskId, 'API未返回图片');
        console.warn('[generateSceneImages] API未返回图片');
        message.error('场景图片生成失败，请稍后重试');
        set((state) => ({
          scenes: state.scenes.map((s) =>
            s.id === sceneId ? { ...s, isGenerating: false } : s
          ),
        }));
      }
    } catch (error: any) {
      failTask(taskId, error?.message || '生成失败');
      console.error('[generateSceneImages] 生成失败:', error);
      const errMsg = error?.message || String(error);
      if (errMsg.includes('输入图片可能包含真实人物') || errMsg.includes('敏感内容')) {
        Modal.error({
          title: '生成失败',
          content: '输入图片可能包含真实人物或敏感内容，请更换参考图片后再试。',
        });
      } else {
        message.error(errMsg || '场景图片生成失败，请稍后重试');
      }
      set((state) => ({
        scenes: state.scenes.map((s) =>
          s.id === sceneId ? { ...s, isGenerating: false } : s
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
        body: buildGenerateSceneImageRequestBody(
          fullPrompt,
          model || scene.model,
          numImages,
          era?.sceneStylePrompt || undefined,
          aspectRatio,
          undefined,
          sceneMultiView,
          true,
        ),
      },
      doGenerate
    );
    return;
  }

  await doGenerate();
},

addScene: (scene: import('@/shared/types').Scene) => {
  if (!scene.id) {
    scene.id = crypto.randomUUID();
  }
  set((state) => ({
    scenes: [...state.scenes, scene],
  }));
},

  };
}
