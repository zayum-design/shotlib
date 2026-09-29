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
 * workflowStore.batch.ts — 批量操作 Slice
 *
 * 包含：batchGenerateAvatars, batchGeneratePortraits, batchGenerateScenes, batchGenerateProps
 */
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { useLoadingStore } from '@/shared/stores/useLoadingStore';
import { localApi } from '@/storage';
import type { PreviewRequestData } from '@/shared/hooks/usePreviewRequest';
import { buildGenerateAvatarRequestBody, buildGenerateCharacterViewsRequestBody, buildGenerateCharacterPortraitRequestBody } from '../api/characterApi';
import { buildGenerateSceneImageRequestBody, buildSceneFullPrompt } from '../api/sceneApi';
import { buildGeneratePropImageRequestBody, buildPropFullPrompt, PROP_NUM_IMAGES } from '../api/propApi';
import { getCurrentProjectAspectRatio, filterEpisodeProps } from '../utils/workflowUtils';
import { syncWorkflowToCloudApi } from '../api/syncApi';
import { shouldPreview, triggerPreview, setSkipPreview, useWorkflowStore } from './workflowStore';
import { persistWorkflowState } from './workflowStore.sync';
import { MAX_PORTRAITS_PER_CHARACTER } from '@/shared/types/index';
import type { WorkflowState } from './workflowStore';
import { message } from '@/shared/utils/message';

type SetFn = (partial: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>)) => void;
type GetFn = () => WorkflowState;

export interface BatchSliceActions {
  batchGenerateAvatars: (model?: string, options?: { force?: boolean; clearDerived?: boolean }) => Promise<void>;
  batchGeneratePortraits: (model?: string, force?: boolean) => Promise<void>;
  batchGenerateScenes: (model?: string, selectedViews?: number[]) => Promise<void>;
  batchGenerateProps: (model?: string) => Promise<void>;
}

export function createBatchSlice(set: SetFn, get: GetFn): BatchSliceActions {
  /**
   * 清空指定角色的多视图和形象照（保留形象照槽位元数据，仅清 imageUrl/assetId），
   * 并软删除对应的后端 image_asset 记录。
   */
  const clearDerivedImages = (characterIds: string[]) => {
    const idSet = new Set(characterIds);
    const projectId = get().currentProjectId;
    const epNum = get().currentEpisodeNumber ?? 1;

    // 软删除后端 image_asset（与 CharacterCard 单角色清空逻辑一致）
    if (projectId && projectId !== 'default') {
      for (const char of get().characters) {
        if (!idSet.has(char.id)) continue;
        const images = [...(char.multiViewImages || []), ...(char.fullBodyImages || [])];
        for (const img of images) {
          if (img?.assetId) {
            localApi
              .deleteProjectAsset(projectId, 'image_asset', img.assetId, img.episodeNumber ?? epNum)
              .catch((e) => console.error(`[clearDerivedImages] 软删除 image_asset 失败: ${img.assetId}`, e));
          }
        }
      }
    }

    set((s) => ({
      characters: s.characters.map((c) =>
        idSet.has(c.id)
          ? {
              ...c,
              multiViewImages: [],
              fullBodyImages: (c.fullBodyImages || []).map((img) => ({
                ...img,
                imageUrl: '',
                assetId: '',
                isGenerating: false,
              })),
            }
          : c,
      ),
    }));
  };

  return {
    batchGenerateAvatars: async (model?: string, options?: { force?: boolean; clearDerived?: boolean }) => {
      // force：全部角色重新生成头像；clearDerived：同时清空多视图和形象照
      if (options?.force && options?.clearDerived) {
        const chars = get().characters;
        const displayed = get().activeCharacterIds?.length
          ? chars.filter((c) => get().activeCharacterIds.includes(c.id))
          : chars;
        clearDerivedImages(displayed.map((c) => c.id));
      }

      const state = get();
      const { characters, activeCharacterIds, era } = state;

      const displayedCharacters = activeCharacterIds?.length
        ? characters.filter((c) => activeCharacterIds.includes(c.id))
        : characters;

      // force 模式下所有角色都重新生成，否则只补缺
      const targetCharacters = options?.force
        ? displayedCharacters.filter((c) => !c.isGeneratingAvatar)
        : displayedCharacters.filter((c) => !c.avatarImages?.length && !c.isGeneratingAvatar);

      // 收集所有预览请求数据
      const previews: PreviewRequestData[] = [];
      let taskCount = 0;

      for (const char of targetCharacters) {
        // 不再拼接 artStylePromptHint：避免 step1 画风提示词污染头像生成。
        const avatarPromptWithStyle = char.avatarPrompt;
        const filteredGlobalPrompt = era?.globalPrompt && !String(era.globalPrompt).startsWith('undefined') ? era.globalPrompt : undefined;

        previews.push({
          endpoint: `/api/creator/character/${char.id}/avatar`,
          body: buildGenerateAvatarRequestBody(avatarPromptWithStyle, model || char.model, filteredGlobalPrompt, true, true, 0),
        });
        taskCount++;
      }

      if (taskCount === 0) {
        message.info('当前集的所有头像已生成完毕');
        return;
      }

      const doBatch = async () => {
        const loading = useLoadingStore.getState();
        loading.show({ title: '正在批量生成头像...', description: '请稍候，正在为您生成角色头像' });
        setSkipPreview(true);
        try {
          const tasks: Promise<void>[] = [];
          for (const char of targetCharacters) {
            tasks.push(state.generateAvatar(char.id, model).catch(() => {}));
          }

          const { setTaskPanelOpen } = useTaskQueueStore.getState();
          setTaskPanelOpen(true);
          message.success(`已添加 ${taskCount} 个头像生成任务到队列`);

          await Promise.allSettled(tasks);
        } finally {
          setSkipPreview(false);
          loading.hide();
        }
      };

      if (shouldPreview()) {
        triggerPreview(previews, doBatch);
        return;
      }

      await doBatch();
    },

    batchGeneratePortraits: async (model?: string, force?: boolean) => {
      // force：先清空现有的多视图和形象照（含软删除 image_asset），再全量重新生成
      if (force) {
        const chars = get().characters;
        const displayed = get().activeCharacterIds?.length
          ? chars.filter((c) => get().activeCharacterIds.includes(c.id))
          : chars;
        clearDerivedImages(displayed.map((c) => c.id));
      }

      const state = get();
      const { characters, activeCharacterIds, era } = state;
      const currentEpisodeNumber = get().currentEpisodeNumber ?? 1;

      const displayedCharacters = activeCharacterIds?.length
        ? characters.filter((c) => activeCharacterIds.includes(c.id))
        : characters;

      // 判断形象照槽位是否属于当前分集（旧数据无 episodeNumber 时默认属于当前分集）
      const isCurrentEpisodePortrait = (portrait: any) => {
        if (!portrait) return false;
        return portrait.episodeNumber === undefined || portrait.episodeNumber === currentEpisodeNumber;
      };

      // 收集所有预览请求数据
      const previews: PreviewRequestData[] = [];
      let taskCount = 0;

      for (const char of displayedCharacters) {
        if (!char.avatarImages?.length) continue;

        // 多视图（全身照）
        const hasMultiView = char.multiViewImages?.[0]?.imageUrl;
        if (!hasMultiView && !char.isGeneratingViews) {
          // 过滤无效的 globalPrompt（防止 "undefined" 字符串或空值）
          const filteredGlobalPrompt = era?.globalPrompt && !String(era.globalPrompt).startsWith('undefined') ? era.globalPrompt : undefined;
          previews.push({
            endpoint: `/api/creator/character/${char.id}/views`,
            body: buildGenerateCharacterViewsRequestBody(model || char.model, char.avatarImages?.[char.currentAvatarIndex || 0]?.imageUrl, filteredGlobalPrompt, char.imagePrompt || char.description || `生成角色全身照: ${char.name}`, '16:9', true, true, 0),
          });
          taskCount++;
        }

        // 形象照（仅当前分集；遍历全部槽位，上限 MAX_PORTRAITS_PER_CHARACTER=9）
        const emptyPortraitIndices: number[] = [];
        for (let i = 0; i < MAX_PORTRAITS_PER_CHARACTER; i++) {
          const portrait = char.fullBodyImages?.[i];
          if (!portrait?.imageUrl && portrait?.prompt && isCurrentEpisodePortrait(portrait)) {
            emptyPortraitIndices.push(i);
          }
        }
        if (emptyPortraitIndices.length > 0) {
          const filteredGlobalPrompt = era?.globalPrompt && !String(era.globalPrompt).startsWith('undefined') ? era.globalPrompt : undefined;
          for (const i of emptyPortraitIndices) {
            const portrait = char.fullBodyImages![i];
            previews.push({
              endpoint: `/api/creator/character/${char.id}/portrait`,
              body: buildGenerateCharacterPortraitRequestBody({ avatarUrl: char.avatarImages?.[char.currentAvatarIndex || 0]?.imageUrl || '', portraitPrompt: portrait.prompt || '', model: model || char.model, count: 1, globalPrompt: filteredGlobalPrompt, aspectRatio: '9:16', preview: true, async: true, episodeNumber: currentEpisodeNumber }),
            });
          }
          taskCount += emptyPortraitIndices.length;
        }
      }

      if (taskCount === 0) {
        message.info('当前集的形象照和多视图已生成完毕');
        return;
      }

      const doBatchGenerate = async () => {
        const loading = useLoadingStore.getState();
        loading.show({ title: '正在批量生成形象照...', description: '请稍候，正在为您生成角色形象照和多视图' });
        setSkipPreview(true);
        try {
          const tasks: Promise<void>[] = [];
          for (const char of displayedCharacters) {
            if (!char.avatarImages?.length) continue;

            const hasMultiView = char.multiViewImages?.[0]?.imageUrl;
            if (!hasMultiView && !char.isGeneratingViews) {
              tasks.push(state.generateCharacterViews(char.id, undefined, model).catch(() => {}));
            }

            const emptyIndices: number[] = [];
            for (let i = 0; i < MAX_PORTRAITS_PER_CHARACTER; i++) {
              const portrait = char.fullBodyImages?.[i];
              if (!portrait?.imageUrl && portrait?.prompt && isCurrentEpisodePortrait(portrait)) {
                emptyIndices.push(i);
              }
            }
            if (emptyIndices.length > 0) {
              set((s) => ({
                characters: s.characters.map((c) => {
                  if (c.id !== char.id) return c;
                  const newImages = [...(c.fullBodyImages || [])];
                  for (const idx of emptyIndices) {
                    if (newImages[idx]) {
                      newImages[idx] = { ...newImages[idx], isGenerating: true };
                    }
                  }
                  return { ...c, fullBodyImages: newImages };
                }),
              }));

              tasks.push(
                (async () => {
                  for (const i of emptyIndices) {
                    const latestChar = get().characters.find((c) => c.id === char.id);
                    const portrait = latestChar?.fullBodyImages?.[i];
                    if (!portrait?.imageUrl && portrait?.prompt) {
                      try {
                        const result = await state.generatePortrait(char.id, portrait.prompt, model, portrait.name);
                        set((s) => ({
                          characters: s.characters.map((c) => {
                            if (c.id !== char.id) return c;
                            const newImages = [...(c.fullBodyImages || [])];
                            if (newImages[i]) {
                              newImages[i] = { ...newImages[i], imageUrl: result?.imageUrl || '', assetId: result?.assetId || newImages[i]?.assetId || '', isGenerating: false };
                            }
                            return { ...c, fullBodyImages: newImages };
                          }),
                        }));
                      } catch (err: any) {
                        console.error('[batchGeneratePortraits] 形象照生成异常:', err);
                        set((s) => ({
                          characters: s.characters.map((c) => {
                            if (c.id !== char.id) return c;
                            const newImages = [...(c.fullBodyImages || [])];
                            if (newImages[i]) {
                              newImages[i] = { ...newImages[i], isGenerating: false };
                            }
                            return { ...c, fullBodyImages: newImages };
                          }),
                        }));
                      }
                    }
                  }
                })().catch(() => {})
              );
            }
          }

          const { setTaskPanelOpen } = useTaskQueueStore.getState();
          setTaskPanelOpen(true);
          message.success(`已添加 ${taskCount} 个形象照/多视图生成任务到队列`);

          await Promise.allSettled(tasks);

          // 批量生成完成后，异步同步到云端 OSS，更新图片 URL 为永久地址
          const projectId = useWorkflowStore.getState().currentProjectId;
          if (projectId && projectId !== 'default') {
            const syncState = get();
            const workflowData = {
              version: 2,
              projectAssets: {
                characters: syncState.characters,
                scenes: syncState.scenes,
                era: syncState.era,
                relationshipNetwork: syncState.relationshipNetwork,
                agentType: syncState.agentType,
                artStyle: syncState.artStyle,
                artStylePromptHint: syncState.artStylePromptHint,
                skills: syncState.skills,
                textModel: syncState.textModel,
                imageModel: syncState.imageModel,
                videoModel: syncState.videoModel,
                audioAssets: syncState.audioAssets,
              },
              currentEpisodeData: {
                currentStep: syncState.currentStep,
                topic: syncState.topic,
                script: syncState.script,
                previousEpisodeScript: syncState.previousEpisodeScript,
                isSimplifiedMode: syncState.isSimplifiedMode,
                activeCharacterIds: syncState.activeCharacterIds,
                activeSceneIds: syncState.activeSceneIds,
                episodes: syncState.episodes,
              },
            };
            syncWorkflowToCloudApi(projectId, 'aliyun', workflowData)
              .then((response) => {
                if (response.success && response.data?.urlMapping) {
                  const urlMapping = response.data.urlMapping;
                  set((s) => ({
                    characters: s.characters.map((c) => ({
                      ...c,
                      avatarImages: c.avatarImages?.map((img) => ({
                        ...img,
                        imageUrl: img.imageUrl ? (urlMapping[img.imageUrl] || img.imageUrl) : img.imageUrl,
                      })),
                      fullBodyImages: c.fullBodyImages?.map((img) => ({
                        ...img,
                        imageUrl: img.imageUrl ? (urlMapping[img.imageUrl] || img.imageUrl) : img.imageUrl,
                      })),
                    })),
                    scenes: s.scenes.map((sc) => ({
                      ...sc,
                      imageUrls: sc.imageUrls?.map((url) => urlMapping[url] || url),
                    })),
                  }));
                  const epNum = useWorkflowStore.getState().currentEpisodeNumber ?? 1;
                  persistWorkflowState(projectId, epNum);
                  console.log('[batchGeneratePortraits] 云端同步完成，URL 已更新');
                }
              })
              .catch((e) => {
                console.warn('[batchGeneratePortraits] 云端同步失败:', e);
              });
          }
        } finally {
          setSkipPreview(false);
          loading.hide();
        }
      };

      if (shouldPreview()) {
        triggerPreview(previews, doBatchGenerate);
        return;
      }

      await doBatchGenerate();
    },

    batchGenerateScenes: async (model?: string, selectedViews?: number[]) => {
      const state = get();
      const { scenes, activeSceneIds, era } = state;

      const displayedScenes = activeSceneIds?.length
        ? scenes.filter((s) => activeSceneIds.includes(s.id))
        : scenes;

      // 收集所有预览请求数据
      const previews: PreviewRequestData[] = [];
      let taskCount = 0;

      for (const scene of displayedScenes) {
        if (!scene.imageUrls?.length && !scene.isGenerating) {
          const fullPrompt = buildSceneFullPrompt(scene, get().artStylePromptHint);
          const aspectRatio = get().sceneImageAspectRatio || getCurrentProjectAspectRatio();
          const sceneModelConfig = state.imageModels.find((mm) => mm.id === (model || scene.model));
          const sceneMultiView = sceneModelConfig?.supports?.sequential_image_generation;
          previews.push({
            endpoint: '/api/creator/image-processing/generate',
            body: buildGenerateSceneImageRequestBody(
              fullPrompt,
              model || scene.model,
              selectedViews?.length || 1,
              // 场景图使用场景专用风格前缀（不含人物/剧情元素），不回退 globalPrompt
              era?.sceneStylePrompt || undefined,
              aspectRatio,
              undefined,
              sceneMultiView,
              true,
            ),
          });
          taskCount++;
        }
      }

      if (taskCount === 0) {
        message.info('当前集的所有场景图已生成完毕');
        return;
      }


      const doBatchGenerate = async () => {
        const loading = useLoadingStore.getState();
        loading.show({ title: '正在批量生成场景图...', description: '请稍候，正在为您生成场景图片' });
        setSkipPreview(true);
        try {
          const tasks: Promise<void>[] = [];
          for (const scene of displayedScenes) {
            if (!scene.imageUrls?.length && !scene.isGenerating) {
              tasks.push(state.generateSceneImages(scene.id, model, selectedViews).catch(() => {}));
            }
          }

          const { setTaskPanelOpen } = useTaskQueueStore.getState();
          setTaskPanelOpen(true);
          message.success(`已添加 ${taskCount} 个场景图生成任务到队列`);

          await Promise.allSettled(tasks);
        } finally {
          setSkipPreview(false);
          loading.hide();
        }
      };

      if (shouldPreview()) {
        triggerPreview(previews, doBatchGenerate);
        return;
      }

      await doBatchGenerate();
    },

    /**
     * 批量生成道具图（流程与 batchGenerateScenes 一致）：
     * 积分总预检 → 全屏 loading → 并发提交任务队列 → 任务面板自动打开
     */
    batchGenerateProps: async (model?: string) => {
      const state = get();
      // 与 batchGenerateScenes 一致：只处理当前分集活跃道具（旧数据回退按剧本匹配）
      const props = filterEpisodeProps(state.props, state.activePropIds, state.script);

      // 收集所有预览请求数据
      const previews: PreviewRequestData[] = [];
      const pendingProps = props.filter((p) => !p.imageUrls?.length && !p.isGenerating);

      for (const prop of pendingProps) {
        const fullPrompt = buildPropFullPrompt(prop, state.artStylePromptHint);
        const aspectRatio = state.sceneImageAspectRatio || getCurrentProjectAspectRatio();
        previews.push({
          endpoint: '/api/creator/image-processing/generate',
          body: buildGeneratePropImageRequestBody(
            fullPrompt,
            model || prop.model || state.imageModel,
            PROP_NUM_IMAGES,
            undefined,
            aspectRatio,
            true,
          ),
        });
      }

      if (pendingProps.length === 0) {
        message.info('当前集的所有道具图已生成完毕');
        return;
      }


      const doBatchGenerate = async () => {
        const loading = useLoadingStore.getState();
        loading.show({ title: '正在批量生成道具图...', description: '请稍候，正在为您生成道具图片' });
        setSkipPreview(true);
        try {
          const tasks: Promise<void>[] = [];
          for (const prop of pendingProps) {
            tasks.push(state.generatePropImages(prop.id, model).catch(() => {}));
          }

          const { setTaskPanelOpen } = useTaskQueueStore.getState();
          setTaskPanelOpen(true);
          message.success(`已添加 ${pendingProps.length} 个道具图生成任务到队列`);

          await Promise.allSettled(tasks);
        } finally {
          setSkipPreview(false);
          loading.hide();
        }
      };

      if (shouldPreview()) {
        triggerPreview(previews, doBatchGenerate);
        return;
      }

      await doBatchGenerate();
    },
  };
}
