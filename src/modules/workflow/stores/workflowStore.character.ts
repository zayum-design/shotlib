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
import {
  buildGenerateAvatarRequestBody,
  buildGenerateCharacterViewsRequestBody,
  buildRegenerateViewRequestBody,
  buildGenerateCharacterPortraitRequestBody,
} from '../api/characterApi';
import { saveWorkflowStateToLocal, syncEpisodePromptImages } from '../utils/workflowUtils';

// 产品决策:角色多视图/形象照的生成与显示固定 16:9,不随项目比例变化
const CHARACTER_ASSET_ASPECT_RATIO = '16:9';
import { MAX_PORTRAITS_PER_CHARACTER } from '@/shared/types/index';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { localApi } from '@/storage';
import { shouldPreview, triggerPreview, persistWorkflowState } from './workflowStore';
import type { WorkflowState } from './workflowStore';
import { message } from '@/shared/utils/message';

import type { Character, CharacterImage } from '@/shared/types';

type SetFn = StoreApi<WorkflowState>['setState'];
type GetFn = StoreApi<WorkflowState>['getState'];

/**
 * 更新角色的多视图或形象照数组。
 * 根据 isMultiView 选择更新 multiViewImages 还是 fullBodyImages。
 */
function updateCharacterImageArray(
  character: Character,
  index: number,
  updates: Partial<CharacterImage>,
  isMultiView: boolean,
): Character {
  if (isMultiView) {
    const newMultiViewImages = [...(character.multiViewImages || [])];
    newMultiViewImages[index] = { ...newMultiViewImages[index], ...updates };
    return { ...character, multiViewImages: newMultiViewImages };
  }
  const newFullBodyImages = [...(character.fullBodyImages || [])];
  newFullBodyImages[index] = { ...newFullBodyImages[index], ...updates };
  return { ...character, fullBodyImages: newFullBodyImages };
}

export function createCharacterSlice(set: SetFn, get: GetFn) {
  return {
    generateAvatar: async (characterId: string, model?: string) => {
      const character = get().characters.find((c) => c.id === characterId);
      const era = get().era;
      if (!character) return;

      // 不再拼接 artStylePromptHint：step1 选中的"画风"含场景/构图/光影/情绪词汇
      // （如"幽闭空间，封闭构图，压迫感，无处可逃，心理恐惧"），会污染
      // step3 头像（要求纯白背景、面部特写）的一致性，故头像 prompt 直接
      // 使用 character.avatarPrompt，不再追加画风。
      const avatarPromptWithStyle = character.avatarPrompt;
      // globalPrompt 单点：doGenerate 与 triggerPreview 共用
      const filteredGlobalPrompt = era?.globalPrompt && !String(era.globalPrompt).startsWith('undefined') ? era.globalPrompt : undefined;

      const doGenerate = async () => {
        set((state) => ({
          characters: state.characters.map((c) =>
            c.id === characterId ? { ...c, isGeneratingAvatar: true } : c
          ),
        }));
        const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
        const taskId = addTask({ type: 'character-avatar', name: `生成角色头像: ${character.name}`, status: 'running', prompt: avatarPromptWithStyle, modelVariant: model || character.model });

        try {
          const response = await workflowApi.generateAvatarApi(
            characterId,
            avatarPromptWithStyle,
            model || character.model,
            filteredGlobalPrompt,
            undefined,
            undefined,
            true,
				// 角色头像属于项目级资产（episode_number=0），跨集统一
				0
          );

          if (!response.success) {
            failTask(taskId, '提交失败');
            set((state) => ({
              characters: state.characters.map((c) =>
                c.id === characterId ? { ...c, isGeneratingAvatar: false } : c
              ),
            }));
            return;
          }

          const jobData = response.data as any;
          let avatarUrlList: string[] = [];
          let avatarAssetIdList: string[] = [];

          if (jobData?.jobId) {
            const jobId = jobData.jobId;

            const pollResult = await workflowApi.pollJobStatus<workflowApi.GenerateAvatarResponse>(jobId, {
              interval: 3000,
              maxWaitTime: 5 * 60 * 1000,
              onPoll: (attempt) => {
                incrementPollCount(taskId);
              },
            });

            if (!pollResult.success) {
              failTask(taskId, pollResult.error || '执行失败');
              set((state) => ({
                characters: state.characters.map((c) =>
                  c.id === characterId ? { ...c, isGeneratingAvatar: false } : c
                ),
              }));
              return;
            }

            avatarUrlList = pollResult.data?.avatarUrls || [];
            avatarAssetIdList = pollResult.data?.avatarAssetIds || [];
          } else {
            // 同步模式回退
            const syncData = (response.data as any) || {};
            avatarUrlList = syncData.avatarUrls || [];
            avatarAssetIdList = syncData.avatarAssetIds || [];
          }

          if (avatarUrlList.length > 0) {
            // 将 URL 列表转换为 CharacterImage 数组，同时保存资产 ID
            const avatarImages = avatarUrlList.map((url, index) => ({
              assetId: avatarAssetIdList[index] || '',
              imageUrl: url,
              name: '头像',
              isPortrait: true,
            }));

            // 更新角色头像
            const updatedCharacters = get().characters.map((c) =>
              c.id === characterId
                ? { ...c, isGeneratingAvatar: false, avatarImages, currentAvatarIndex: 0, avatarSource: 'generated' as const }
                : c
            );

            // 同步更新所有 episode 提示词中该角色的头像图片
            const newAvatarUrl = avatarUrlList[0];
            const updatedEpisodes = syncEpisodePromptImages(get().episodes, 'role', characterId, newAvatarUrl);

            set({ characters: updatedCharacters, episodes: updatedEpisodes });

            // 手动触发持久化，确保头像URL立即保存
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
              characters: updatedCharacters,
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
            completeTask(taskId, { imageUrls: avatarUrlList });
            message.success(`${character.name} 头像生成完成`);
          } else {
            // 任务成功但返回空头像列表（上游生成失败被中间层吞掉时的兜底）：
            // 必须显式 failTask，否则任务停在 running 被 finally 静默移除，用户看不到失败原因
            failTask(taskId, '生成失败，未返回图片（可能触发内容安全策略，请调整角色描述后重试）');
            message.error(`${character.name} 头像生成失败，未返回图片`);
          }
        } catch (error: any) {
          failTask(taskId, error?.message || '生成失败');
          message.error(error?.message || '头像生成失败');
          set((state) => ({
            characters: state.characters.map((c) =>
              c.id === characterId ? { ...c, isGeneratingAvatar: false } : c
            ),
          }));
        } finally {
          set((state) => ({
            characters: state.characters.map((c) =>
              c.id === characterId ? { ...c, isGeneratingAvatar: false } : c
            ),
          }));
          const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
          if (task && (task.status === 'running' || task.status === 'polling')) {
            removeTask(taskId);
          }
        }
      };

      if (shouldPreview()) {
        triggerPreview(
          {
            endpoint: `/api/creator/character/${characterId}/avatar`,
            // 预览 body 复用 build（与 generateAvatarApi 真实提交一致，仅 preview=true）
            body: buildGenerateAvatarRequestBody(avatarPromptWithStyle, model || character.model, filteredGlobalPrompt, true, true, 0),
          },
          doGenerate
        );
        return;
      }

      await doGenerate();
    },

    /**
     * 生成年龄变体头像（以主头像为参考图走图生图）。
     * 用途：剧本时间跨度大时（角色从30岁到70岁），为每个年龄段生成与主头像
     * 面部一致但呈现目标年龄衰老/年轻化特征的头像，供对应年龄的形象照与视频镜头引用。
     * 生成的变体追加到 avatarImages，name 为「N岁头像」，ageVariant=N，不改动 currentAvatarIndex。
     */
    generateAgeVariantAvatar: async (characterId: string, targetAge: number, model?: string): Promise<{ imageUrl: string; assetId?: string } | null> => {
      const character = get().characters.find((c) => c.id === characterId);
      if (!character) return null;

      // 参考图：主头像（currentAvatarIndex 指向的当前头像）
      const baseAvatarUrl = character.avatarImages?.[character.currentAvatarIndex || 0]?.imageUrl;
      if (!baseAvatarUrl) {
        message.error('请先生成主头像');
        return null;
      }

      // 已有同年龄变体则直接返回（幂等，供 generatePortrait 链式调用）
      const existing = (character.avatarImages || []).find((img) => img.ageVariant === targetAge && img.imageUrl);
      if (existing?.imageUrl) {
        return { imageUrl: existing.imageUrl, assetId: existing.assetId };
      }

      const baseAge = typeof character.age === 'number' ? character.age : parseInt(String(character.age), 10);
      const genderWord = character.gender === '女' ? '女性' : '男性';
      const ageDiffHint = Number.isFinite(baseAge) && targetAge > baseAge
        ? `面部呈现${targetAge}岁自然衰老特征（两鬓花白、皱纹、皮肤松弛）`
        : Number.isFinite(baseAge) && targetAge < baseAge
          ? `面部呈现${targetAge}岁更年轻的特征（皮肤紧致、无皱纹）`
          : `面部呈现${targetAge}岁特征`;
      // 头像 prompt：主头像 avatarPrompt 已含完整五官描述，追加年龄变体指令；
      // 参考图 + 文字双重约束保证"变老但还是同一个人"
      const variantPrompt = `${targetAge}岁${genderWord}，${ageDiffHint}，五官轮廓与参考图保持一致，${character.avatarPrompt}`;

      const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
      const taskId = addTask({ type: 'character-avatar', name: `生成${targetAge}岁头像: ${character.name}`, status: 'running', prompt: variantPrompt, modelVariant: model || character.model });

      try {
        const response = await workflowApi.generateAvatarApi(
          characterId,
          variantPrompt,
          model || character.model,
          undefined,
          undefined,
          undefined,
          true,
          0,
          baseAvatarUrl,
        );

        if (!response.success) {
          failTask(taskId, response.message || '提交失败');
          return null;
        }

        const jobData = response.data as any;
        let avatarUrlList: string[] = [];
        let avatarAssetIdList: string[] = [];

        if (jobData?.jobId) {
          const pollResult = await workflowApi.pollJobStatus<workflowApi.GenerateAvatarResponse>(jobData.jobId, {
            interval: 3000,
            maxWaitTime: 5 * 60 * 1000,
            onPoll: () => incrementPollCount(taskId),
          });
          if (!pollResult.success) {
            failTask(taskId, pollResult.error || '执行失败');
            return null;
          }
          avatarUrlList = pollResult.data?.avatarUrls || [];
          avatarAssetIdList = pollResult.data?.avatarAssetIds || [];
        } else {
          avatarUrlList = jobData?.avatarUrls || [];
          avatarAssetIdList = jobData?.avatarAssetIds || [];
        }

        if (avatarUrlList.length === 0) {
          failTask(taskId, '未返回头像');
          return null;
        }

        const variantImage: CharacterImage = {
          assetId: avatarAssetIdList[0] || '',
          imageUrl: avatarUrlList[0],
          name: `${targetAge}岁头像`,
          isPortrait: true,
          ageVariant: targetAge,
        };
        set((state) => ({
          characters: state.characters.map((c) =>
            c.id === characterId
              ? { ...c, avatarImages: [...(c.avatarImages || []), variantImage] }
              : c
          ),
        }));
        persistWorkflowState(get().currentProjectId, get().currentEpisodeNumber ?? 1);
        completeTask(taskId, { imageUrls: avatarUrlList });
        message.success(`${character.name} ${targetAge}岁头像生成完成`);
        return { imageUrl: avatarUrlList[0], assetId: avatarAssetIdList[0] };
      } catch (error: any) {
        failTask(taskId, error?.message || '生成失败');
        message.error(error?.message || '年龄变体头像生成失败');
        return null;
      } finally {
        const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
        if (task && (task.status === 'running' || task.status === 'polling')) {
          removeTask(taskId);
        }
      }
    },

    generateCharacterViews: async (characterId: string, avatarIndex?: number, model?: string) => {
      const { imageModel, era } = get();

      const character = get().characters.find((c) => c.id === characterId);
      if (!character) return;

      // 获取参考头像URL（使用指定索引或当前默认头像）
      const avatarImgList = character.avatarImages || [];
      const referenceAvatarUrl = avatarImgList.length > 0
        ? avatarImgList[avatarIndex ?? character.currentAvatarIndex ?? 0]?.imageUrl
        : undefined;

      // 直接使用 imagePrompt 作为全身照提示词，不再拼接 character.description
      // 角色简介会污染多视图的生成效果（多视图要求纯白背景、人物站姿）
      const imagePrompt = character.imagePrompt || '';
      // globalPrompt 单点：doGenerate 与 triggerPreview 共用
      const filteredGlobalPrompt = era?.globalPrompt && !String(era.globalPrompt).startsWith('undefined') ? era.globalPrompt : undefined;

      const doGenerate = async () => {
        set((state) => ({
          characters: state.characters.map((c) =>
            c.id === characterId ? { ...c, isGeneratingViews: true } : c
          ),
        }));
        const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
        const taskId = addTask({ type: 'character-views', name: `生成角色全身照: ${character.name}`, status: 'running', prompt: imagePrompt, modelVariant: model || imageModel });

        try {
          console.log(`[generateCharacterViews] 使用参考头像: ${referenceAvatarUrl}`);

          const response = await workflowApi.generateCharacterViewsApi(
            characterId,
            model || imageModel,
            referenceAvatarUrl,
            filteredGlobalPrompt,
            imagePrompt,
            CHARACTER_ASSET_ASPECT_RATIO,
            undefined,
            undefined,
            true,
				// 角色三视图属于项目级资产（episode_number=0），跨集统一
				0
          );

          console.log(`[generateCharacterViews] API响应:`, response);

          if (!response.success) {
            failTask(taskId, '提交失败');
            set((state) => ({
              characters: state.characters.map((c) =>
                c.id === characterId ? { ...c, isGeneratingViews: false } : c
              ),
            }));
            return;
          }

          const jobData = response.data as any;
          let fullBodyUrlList: string[] = [];
          let fullBodyAssetIdList: string[] = [];

          if (jobData?.jobId) {
            const jobId = jobData.jobId;

            const pollResult = await workflowApi.pollJobStatus<workflowApi.GenerateCharacterViewsResponse>(jobId, {
              interval: 3000,
              maxWaitTime: 5 * 60 * 1000,
              onPoll: (attempt) => {
                incrementPollCount(taskId);
              },
            });

            if (!pollResult.success) {
              failTask(taskId, pollResult.error || '执行失败');
              set((state) => ({
                characters: state.characters.map((c) =>
                  c.id === characterId ? { ...c, isGeneratingViews: false } : c
                ),
              }));
              return;
            }

            fullBodyUrlList = (pollResult.data?.fullBodyUrls || []).filter((url) => !!url);
            fullBodyAssetIdList = pollResult.data?.fullBodyAssetIds || [];
          } else {
            // 同步模式回退
            const syncData = (response.data as any) || {};
            fullBodyUrlList = (syncData.fullBodyUrls || []).filter((url: any) => !!url);
            fullBodyAssetIdList = syncData.fullBodyAssetIds || [];
          }

          if (fullBodyUrlList.length > 0) {
            set((state) => ({
              characters: state.characters.map((c) => {
                if (c.id !== characterId) return c;
                const existingMultiViews = c.multiViewImages || [];
                const newMultiView = fullBodyUrlList.map((url, index) => ({
                  assetId: fullBodyAssetIdList[index] || '',
                  imageUrl: url,
                  isGenerating: false,
                  name: '人物多视图',
                  isPortrait: false, // 标记为多视图，不是形象照
                }));
                return {
                  ...c,
                  multiViewImages: newMultiView,
                  isGeneratingViews: false,
                };
              }),
              // 多视图重新生成后，清空该角色在所有 episode 提示词中的图片引用
              episodes: syncEpisodePromptImages(state.episodes, 'role', characterId, ''),
            }));
            completeTask(taskId, { imageUrls: fullBodyUrlList });
            message.success(`${character.name} 人物多视图生成完成`);
          }
        } catch (error: any) {
          failTask(taskId, error?.message || '生成失败');
          message.error(error?.message || '多视图生成失败');
          set((state) => ({
            characters: state.characters.map((c) =>
              c.id === characterId ? { ...c, isGeneratingViews: false } : c
            ),
          }));
        } finally {
          set((state) => ({
            characters: state.characters.map((c) =>
              c.id === characterId ? { ...c, isGeneratingViews: false } : c
            ),
          }));
          const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
          if (task && (task.status === 'running' || task.status === 'polling')) {
            removeTask(taskId);
          }
        }
      };

      if (shouldPreview()) {
        triggerPreview(
          {
            endpoint: `/api/creator/character/${characterId}/views`,
            // 预览 body 复用 build（与 generateCharacterViewsApi 真实提交一致，仅 preview=true）
            body: buildGenerateCharacterViewsRequestBody(model || imageModel, referenceAvatarUrl, filteredGlobalPrompt, imagePrompt, '16:9', true, true, 0),
          },
          doGenerate
        );
        return;
      }

      await doGenerate();
    },

    regenerateFullBody: async (characterId: string, index: number, isMultiView: boolean = false) => {
      const { imageModel, era } = get();
      const character = get().characters.find((c) => c.id === characterId);
      if (!character) return;

      const filteredGlobalPrompt = era?.globalPrompt && !String(era.globalPrompt).startsWith('undefined') ? era.globalPrompt : undefined;
      // args 单点：doGenerate 与 triggerPreview 共用（多视图/形象照固定 16:9）
      const aspectRatio = CHARACTER_ASSET_ASPECT_RATIO;
      const currentEpisodeNumber = get().currentEpisodeNumber ?? 1;
      // 用户提示词参与重生成:优先用该图生成时保存的 prompt(形象照弹窗输入的提示词存在
      // fullBodyImages[index].prompt),缺失才回退角色描述;否则固定模板出图与用户输入无关
      const savedPrompt = isMultiView
        ? character.multiViewImages?.[index]?.prompt
        : character.fullBodyImages?.[index]?.prompt;
      const imagePrompt = (savedPrompt || character.imagePrompt || character.description || undefined) as string | undefined;
      // 形象照重生成必须用形象照模板(REGENERATE 是四视图设定图模板,与形象照语义无关)
      const regenerateTemplate = isMultiView ? ('view' as const) : ('portrait' as const);

      const doGenerate = async () => {
        set((state) => ({
          characters: state.characters.map((c) => {
            if (c.id !== characterId) return c;
            return updateCharacterImageArray(c, index, { isGenerating: true }, isMultiView);
          }),
        }));
        const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
        const fullBodyPrompt = character.imagePrompt || character.description || `生成角色全身照: ${character.name}`;
        const taskName = isMultiView ? `生成角色全身照: ${character.name}` : `生成角色形象照: ${character.name}`;
        const taskId = addTask({ type: isMultiView ? 'character-views' : 'character-fullbody', name: taskName, status: 'running', prompt: fullBodyPrompt, modelVariant: imageModel });

        try {
          const response = await workflowApi.regenerateViewApi(
            characterId,
            index,
            imageModel,
            filteredGlobalPrompt,
            aspectRatio,
            undefined,
            true,
            // 多视图跨集共享；形象照按当前分集隔离
            isMultiView ? 0 : currentEpisodeNumber,
            imagePrompt,
            regenerateTemplate
          );

          if (!response.success) {
            failTask(taskId, '提交失败');
            set((state) => ({
              characters: state.characters.map((c) => {
                if (c.id !== characterId) return c;
                return updateCharacterImageArray(c, index, { isGenerating: false }, isMultiView);
              }),
            }));
            return;
          }

          const jobData = response.data as any;
          let imageUrl: string | undefined;
          let imageAssetId: string | undefined;

          if (jobData?.jobId) {
            const jobId = jobData.jobId;

            const pollResult = await workflowApi.pollJobStatus<workflowApi.RegenerateViewResponse>(jobId, {
              interval: 3000,
              maxWaitTime: 5 * 60 * 1000,
              onPoll: (attempt) => {
                incrementPollCount(taskId);
              },
            });

            if (!pollResult.success) {
              failTask(taskId, pollResult.error || '执行失败');
              set((state) => ({
                characters: state.characters.map((c) => {
                  if (c.id !== characterId) return c;
                  return updateCharacterImageArray(c, index, { isGenerating: false }, isMultiView);
                }),
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
            set((state) => ({
              characters: state.characters.map((c) => {
                if (c.id !== characterId) return c;
                const updates: Partial<CharacterImage> = {
                  imageUrl,
                  assetId: imageAssetId || (isMultiView ? c.multiViewImages?.[index]?.assetId : c.fullBodyImages?.[index]?.assetId) || '',
                  isGenerating: false,
                };
                // 形象照标记当前分集（复用顶部 currentEpisodeNumber 单点）
                if (!isMultiView) {
                  updates.episodeNumber = currentEpisodeNumber;
                }
                return updateCharacterImageArray(c, index, updates, isMultiView);
              }),
            }));
            completeTask(taskId, { imageUrl });
            message.success(`${character.name} ${isMultiView ? '全身照' : '形象照'}生成完成`);
          }
        } catch (error: any) {
          failTask(taskId, error?.message || '生成失败');
          message.error(error?.message || '全身照生成失败');
          set((state) => ({
            characters: state.characters.map((c) => {
              if (c.id !== characterId) return c;
              return updateCharacterImageArray(c, index, { isGenerating: false }, isMultiView);
            }),
          }));
        } finally {
          set((state) => ({
            characters: state.characters.map((c) => {
              if (c.id !== characterId) return c;
              return updateCharacterImageArray(c, index, { isGenerating: false }, isMultiView);
            }),
          }));
          const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
          if (task && (task.status === 'running' || task.status === 'polling')) {
            removeTask(taskId);
          }
        }
      };

      if (shouldPreview()) {
        triggerPreview(
          {
            endpoint: `/api/creator/character/${characterId}/fullbody/${index}`,
            // 预览 body 复用 build（与 regenerateViewApi 真实提交一致，仅 preview=true）
            body: buildRegenerateViewRequestBody(index, imageModel, filteredGlobalPrompt, aspectRatio, true, true, isMultiView ? 0 : currentEpisodeNumber, imagePrompt, regenerateTemplate),
          },
          doGenerate
        );
        return;
      }

      await doGenerate();
    },


    // 生成单张形象照（基于头像）
    generatePortrait: async (characterId: string, portraitPrompt: string, model?: string, name?: string): Promise<{ imageUrl: string; assetId?: string } | null> => {
      const character = get().characters.find((c) => c.id === characterId);
      const era = get().era;
      if (!character) return null;

      const avatarUrl = character.avatarImages?.[character.currentAvatarIndex || 0]?.imageUrl;
      if (!avatarUrl) {
        message.error('请先生成头像');
        return null;
      }

      // 年龄跨度变体：名称含年龄标记（如「张远-70岁病中照」「李勇-40岁居家照」）时，
      // 必须把目标年龄的老化描述注入提示词开头——形象照以头像为参考图，头像锁定的是
      // 角色主年龄的面部特征，prompt 不写明目标年龄则生成结果与主头像零差异（永远不变老）
      const ageMatch = name?.match(/(\d+)\s*岁/);
      let referenceAvatarUrl = avatarUrl;
      if (ageMatch) {
        const targetAge = parseInt(ageMatch[1], 10);
        const baseAge = typeof character.age === 'number' ? character.age : parseInt(String(character.age), 10);
        const genderWord = character.gender === '女' ? '女性' : '男性';
        if (!portraitPrompt.includes(`${targetAge}岁`)) {
          const agingHint = Number.isFinite(baseAge) && targetAge > baseAge
            ? `${targetAge}岁${genderWord}，面部呈现${targetAge}岁自然衰老特征（两鬓花白、皱纹、皮肤松弛），五官轮廓与参考头像保持一致`
            : `${targetAge}岁${genderWord}，五官轮廓与参考头像保持一致`;
          portraitPrompt = `${agingHint}，${portraitPrompt}`;
        }

        // 参考图升级为主头像的对应年龄变体头像：
        // 直接用主头像做参考会锁死面部年龄（图生图对参考图面部特征的保持权重大于文字老化指令），
        // 必须先有该年龄段的头像，形象照参考它才能同时满足「同一个人+正确的年龄」
        const variantAvatar = (character.avatarImages || []).find((img) => img.ageVariant === targetAge && img.imageUrl);
        if (variantAvatar?.imageUrl) {
          referenceAvatarUrl = variantAvatar.imageUrl;
        } else {
          message.info(`正在先生成 ${character.name} 的 ${targetAge} 岁头像…`);
          const variant = await get().generateAgeVariantAvatar(characterId, targetAge, model);
          if (variant?.imageUrl) {
            referenceAvatarUrl = variant.imageUrl;
          }
          // 变体生成失败时回退主头像 + 文字老化指令（尽力而为，不阻断形象照生成）
        }
      }

      const filteredGlobalPrompt = era?.globalPrompt && !String(era.globalPrompt).startsWith('undefined') ? era.globalPrompt : undefined;
      // 形象照按当前分集隔离：doGenerate 与 triggerPreview 共用
      const currentEpisodeNumber = get().currentEpisodeNumber ?? 1;

      const doGenerate = async (): Promise<{ imageUrl: string; assetId?: string } | null> => {
        const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
        const taskId = addTask({ type: 'character-portrait', name: `生成角色形象照: ${character.name}`, status: 'running', prompt: portraitPrompt, modelVariant: model || character.model });

        try {
          const response = await workflowApi.generateCharacterPortraitApi(characterId, {
            avatarUrl: referenceAvatarUrl,
            portraitPrompt,
            model: model || character.model,
            count: 1,
            globalPrompt: filteredGlobalPrompt,
            // 形象照固定 16:9
            aspectRatio: CHARACTER_ASSET_ASPECT_RATIO,
            async: true,
            // 形象照按当前分集隔离
            episodeNumber: currentEpisodeNumber,
          });

          if (!response.success) {
            const errorMsg = response.message || response.error || '提交失败';
            failTask(taskId, errorMsg);
            message.error(errorMsg);
            return null;
          }

          const jobData = response.data as any;
          let portraitUrls: string[] = [];
          let portraitAssetIds: string[] = [];

          if (jobData?.jobId) {
            const jobId = jobData.jobId;
            const pollResult = await workflowApi.pollJobStatus(jobId, {
              interval: 3000,
              maxWaitTime: 5 * 60 * 1000,
              onPoll: () => incrementPollCount(taskId),
            });
            if (!pollResult.success) {
              failTask(taskId, pollResult.error || '生成失败');
              message.error(pollResult.error || '生成失败');
              return null;
            }
            const pollData = (pollResult.data as any) || {};
            portraitUrls = pollData.portraitUrls || [];
            portraitAssetIds = pollData.portraitAssetIds || [];
          } else {
            portraitUrls = jobData?.portraitUrls || [];
            portraitAssetIds = jobData?.portraitAssetIds || [];
          }

          if (portraitUrls.length > 0) {
            completeTask(taskId, { portraitUrls });
            message.success('形象照已生成');
            return { imageUrl: portraitUrls[0], assetId: portraitAssetIds[0] };
          } else {
            failTask(taskId, '未返回形象照');
            message.error('生成失败，未返回形象照');
          }
        } catch (error: any) {
          failTask(taskId, error?.message || '生成失败');
          message.error(error?.message || '生成失败');
        }
        return null;
      };

      if (shouldPreview()) {
        return await triggerPreview(
          {
            endpoint: `/api/creator/character/${characterId}/portrait`,
            // 预览 body 复用 build（与 generateCharacterPortraitApi 真实提交一致，仅 preview=true）
            body: buildGenerateCharacterPortraitRequestBody({
              avatarUrl: referenceAvatarUrl,
              portraitPrompt,
              model: model || character.model,
              count: 1,
              globalPrompt: filteredGlobalPrompt,
              // 形象照固定 16:9,与真实提交一致
              aspectRatio: CHARACTER_ASSET_ASPECT_RATIO,
              preview: true,
              async: true,
              episodeNumber: currentEpisodeNumber,
            }),
          },
          doGenerate
        );
      }

      return await doGenerate();
    },

    // 添加形象照（本地上传或生成后添加）
    addPortraitImages: (characterId: string, images: { imageUrl: string; assetId?: string; prompt?: string; name?: string; episodeNumber?: number }[]) => {
      set((state) => ({
        characters: state.characters.map((c) => {
          if (c.id !== characterId) return c;
          const existingImages = c.fullBodyImages || [];
          const currentEpisodeNumber = get().currentEpisodeNumber ?? 1;
          // 关键修复：先按"已存在空槽位"填充顺序确定每个新图的实际索引，
          // 然后用 actualIndex 自动生成"形象照 1/2/3..."的兜底名，
          // 避免出现多张图片同名（如全部为"形象照"或全部为"真人形象照"）导致无法区分。
          // 已有 name 时优先保留 caller 传入的（如"贵妇套装照"）。
          const targetIndices: number[] = [];
          {
            const emptySlots: number[] = [];
            for (let idx = 0; idx < MAX_PORTRAITS_PER_CHARACTER; idx++) {
              if (!existingImages[idx]?.imageUrl) emptySlots.push(idx);
            }
            for (let n = 0; n < images.length; n++) {
              if (!images[n]?.imageUrl) continue;
              if (emptySlots[n] !== undefined) {
                targetIndices.push(emptySlots[n]);
              } else {
                // 容量已满时追加到末尾（下面会做 9 张上限裁剪）
                targetIndices.push(existingImages.length + n);
              }
            }
          }
          const newImages = images
            .map((img, n) => {
              if (!img.imageUrl) return null;
              const actualIndex = targetIndices[n];
              return {
                assetId: img.assetId || '',
                imageUrl: img.imageUrl,
                isGenerating: false,
                prompt: img.prompt,
                // 关键修复：caller 没传 name 时，按 actualIndex 生成"形象照 1"等唯一名
                name: img.name && img.name.trim() ? img.name : `形象照 ${actualIndex + 1}`,
                isPortrait: true, // 标记为形象照
                // 形象照标记所属分集；若 caller 已指定则优先使用
                episodeNumber: img.episodeNumber ?? currentEpisodeNumber,
              };
            })
            .filter(Boolean) as Array<{ assetId: string; imageUrl: string; isGenerating: false; prompt?: string; name: string; isPortrait: true; episodeNumber: number }>;
          let combinedImages = [...existingImages];
          for (const newImg of newImages) {
            if (!newImg.imageUrl) continue; // 跳过空图片
            const emptyIndex = combinedImages.findIndex((img) => !img.imageUrl);
            if (emptyIndex >= 0) {
              combinedImages[emptyIndex] = newImg;
            } else {
              combinedImages.push(newImg);
            }
          }
          // 限制形象照总数为上限（MAX_PORTRAITS_PER_CHARACTER=9）
          if (combinedImages.length > MAX_PORTRAITS_PER_CHARACTER) {
            combinedImages = combinedImages.slice(0, MAX_PORTRAITS_PER_CHARACTER);
          }
          return {
            ...c,
            fullBodyImages: combinedImages,
          };
        }),
      }));
      const projectId = get().currentProjectId;
      const episodeNumber = get().currentEpisodeNumber ?? 1;
      if (projectId && projectId !== 'default') {
        persistWorkflowState(projectId, episodeNumber);
      }
    },

    // 删除形象照
    removePortraitImage: (characterId: string, index: number) => {
      const projectId = get().currentProjectId;
      const episodeNumber = get().currentEpisodeNumber ?? 1;

      set((state) => ({
        characters: state.characters.map((c) => {
          if (c.id !== characterId) return c;
          const newImages = [...(c.fullBodyImages || [])];
          const removedImage = newImages[index];
          newImages.splice(index, 1);

          // 软删除后端 image_asset 对应记录（异步，失败不阻塞前端状态）
          // 关键修复：image_asset 按创建时的 episode_number 存储，删除时必须使用相同分集号
          if (removedImage?.assetId && projectId && projectId !== 'default') {
            const assetEpisodeNumber = removedImage.episodeNumber ?? episodeNumber;
            localApi.deleteProjectAsset(projectId, 'image_asset', removedImage.assetId, assetEpisodeNumber)
              .then(() => {
                console.log(`[removePortraitImage] 软删除 image_asset 成功: ${removedImage.assetId}`);
              })
              .catch((e) => {
                console.error(`[removePortraitImage] 软删除 image_asset 失败: ${removedImage.assetId}`, e);
              });
          }

          return {
            ...c,
            fullBodyImages: newImages,
          };
        }),
      }));

      if (projectId && projectId !== 'default') {
        persistWorkflowState(projectId, episodeNumber);
      }
    },

  };
}
