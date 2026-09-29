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

import { useState, useCallback } from 'react';
import type { InstantCharacter, InstantScene, InstantSegment } from '@/shared/types/project';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import { saveInstantToServer } from '@/modules/instant/utils/instantSyncUtils';
import { message } from '@/shared/utils/message';

const buildImagePrompt = (char: InstantCharacter) => {
  return `${char.name}，${char.gender}，${char.appearance}，性格${char.personality}，职业是${char.occupation}。全身照。`;
};

export function useInstantMultiView({
  projectId,
  selectedImageModel,
  characters,
  setCharacters,
  multiViewChar,
  setMultiViewChar,
  scenes,
  segments,
  syncSegmentPromptImages,
  videoApiPreviewMode,
  showApiPreview,
}: {
  projectId: string | undefined;
  selectedImageModel: string;
  characters: InstantCharacter[];
  setCharacters: React.Dispatch<React.SetStateAction<InstantCharacter[]>>;
  multiViewChar: InstantCharacter | null;
  setMultiViewChar: React.Dispatch<React.SetStateAction<InstantCharacter | null>>;
  scenes: InstantScene[];
  segments: InstantSegment[];
  syncSegmentPromptImages: (chars: InstantCharacter[], scns: InstantScene[]) => void;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
}) {
  const [multiViewOpen, setMultiViewOpen] = useState(false);
  const [multiViewIndex, setMultiViewIndex] = useState(0);

  const [viewsPrompt, setViewsPrompt] = useState('');
  const [viewsModel, setViewsModel] = useState(selectedImageModel);

  const handleOpenMultiView = useCallback((char: InstantCharacter) => {
    setMultiViewChar(char);
    setMultiViewIndex(0);
    setViewsPrompt(char.imagePrompt || buildImagePrompt(char));
    setViewsModel(char.model || selectedImageModel);
    setMultiViewOpen(true);
  }, [selectedImageModel, setMultiViewChar]);

  const executeGenerateCharacterViews = useCallback(
    async (
      char: InstantCharacter,
      requestData: { model: string; referenceAvatarUrl: string; imagePrompt: string; aspectRatio: string }
    ) => {
      const { model, referenceAvatarUrl, imagePrompt, aspectRatio } = requestData;
      const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
      const taskId = addTask({ type: 'character-views', name: `生成多视图 - ${char.name}`, status: 'running', prompt: imagePrompt, modelVariant: model });

      try {
        setCharacters((prev) =>
          prev.map((c) => (c.id === char.id ? { ...c, isGeneratingViews: true } : c))
        );
        if (multiViewChar?.id === char.id) {
          setMultiViewChar({ ...multiViewChar, isGeneratingViews: true });
        }
        const res = await workflowApi.generateCharacterViewsApi(
          char.id,
          model,
          referenceAvatarUrl,
          undefined,
          imagePrompt,
          aspectRatio,
          undefined,
          undefined,
          true
        );

        if (!res.success) {
          failTask(taskId, '提交失败');
          setCharacters((prev) => {
            const next = prev.map((c) => (c.id === char.id ? { ...c, isGeneratingViews: false } : c));
            persistInstantData(projectId, { instantCharacters: next });
            return next;
          });
          if (multiViewChar?.id === char.id) {
            setMultiViewChar({ ...multiViewChar, isGeneratingViews: false });
          }
          return;
        }

        const jobData = res.data as any;
        let urls: string[] = [];

        if (jobData?.jobId) {
          const jobId = jobData.jobId;
          const pollResult = await workflowApi.pollJobStatus<{ fullBodyUrls?: string[] }>(jobId, {
            interval: 3000,
            maxWaitTime: 5 * 60 * 1000,
            onPoll: () => incrementPollCount(taskId),
          });

          if (!pollResult.success) {
            failTask(taskId, pollResult.error || '执行失败');
            setCharacters((prev) => {
              const next = prev.map((c) => (c.id === char.id ? { ...c, isGeneratingViews: false } : c));
              persistInstantData(projectId, { instantCharacters: next });
              return next;
            });
            if (multiViewChar?.id === char.id) {
              setMultiViewChar({ ...multiViewChar, isGeneratingViews: false });
            }
            return;
          }

          urls = pollResult.data?.fullBodyUrls || [];
        } else {
          urls = (res.data as any)?.fullBodyUrls || [];
        }

        if (urls.length > 0) {
          message.success('多视图生成成功');
          const referenceAvatarId = char.avatarImages?.[0]?.id;
          // 复用现有 fullbody 的 asset_key（如有），实现重新生成 upsert 替换；
          // 首次生成则用固定 key
          const existingFullBody = char.fullBodyImages || [];
          const newFullBodyImages = urls.map((url, index) => {
            const stableKey =
              existingFullBody[index]?.id || `${char.id}-fullbody-${index}`;
            return {
              id: stableKey,
              assetId: stableKey,
              imageUrl: url,
              name: '全身照',
              isPortrait: false,
              referenceAvatarId,
              prompt: requestData.imagePrompt,
              model: requestData.model,
            };
          });
          const next = characters.map((c) =>
            c.id === char.id ? { ...c, isGeneratingViews: false, fullBodyImages: newFullBodyImages } : c
          );
          setCharacters(next);
          persistInstantData(projectId, { instantCharacters: next });
          syncSegmentPromptImages(next, scenes);
          if (multiViewChar?.id === char.id) {
            setMultiViewChar({ ...multiViewChar, isGeneratingViews: false, fullBodyImages: newFullBodyImages });
          }
          completeTask(taskId, { imageUrls: urls });
          // 立即同步到服务器（不等防抖），配合固定 asset_key 实现 upsert 替换，确保刷新后为新图
          if (projectId) {
            saveInstantToServer(projectId, { instantCharacters: next, instantScenes: scenes, instantSegments: segments }).catch((e) => {
              console.warn('[useInstantMultiView] 立即保存失败', e);
            });
          }
        } else {
          throw new Error('未返回有效图片');
        }
      } catch (err: any) {
        failTask(taskId, err?.message || '生成失败');
        message.error(err?.message || '多视图生成失败');
        setCharacters((prev) => {
          const next = prev.map((c) => (c.id === char.id ? { ...c, isGeneratingViews: false } : c));
          persistInstantData(projectId, { instantCharacters: next });
          return next;
        });
        if (multiViewChar?.id === char.id) {
          setMultiViewChar({ ...multiViewChar, isGeneratingViews: false });
        }
      } finally {
        const task = useTaskQueueStore.getState().tasks.find((t) => t.id === taskId);
        if (task && (task.status === 'running' || task.status === 'polling')) {
          removeTask(taskId);
        }
      }
    },
    [projectId, characters, multiViewChar, syncSegmentPromptImages, scenes, segments]
  );

  const handleGenerateCharacterViews = useCallback(
    async (char: InstantCharacter) => {
      const model = viewsModel || selectedImageModel;
      const avatarUrl = char.avatar?.trim() || char.avatarImages?.[0]?.imageUrl;
      const referenceAvatarUrl = avatarUrl?.trim() || '';
      const imagePrompt = viewsPrompt.trim() || char.imagePrompt || buildImagePrompt(char);
      const aspectRatio = '16:9';
      if (!referenceAvatarUrl) {
        message.warning('请先生成头像，再生成全身照');
        return;
      }

      const nextChars = characters.map((c) =>
        c.id === char.id ? { ...c, imagePrompt, model } : c
      );
      setCharacters(nextChars);
      persistInstantData(projectId, { instantCharacters: nextChars });
      if (multiViewChar?.id === char.id) {
        setMultiViewChar({ ...multiViewChar, imagePrompt, model });
      }

      const requestData = { model, referenceAvatarUrl, imagePrompt, aspectRatio };

      if (videoApiPreviewMode) {
        showApiPreview(
          '多视图生成请求预览',
          workflowApi.generateCharacterViewsApi(char.id, model, referenceAvatarUrl, undefined, imagePrompt, aspectRatio, undefined, true, true),
          requestData,
          () => executeGenerateCharacterViews(char, requestData)
        );
        return;
      }

      await executeGenerateCharacterViews(char, requestData);
    },
    [viewsModel, viewsPrompt, selectedImageModel, projectId, videoApiPreviewMode, showApiPreview, executeGenerateCharacterViews, characters, multiViewChar]
  );

  return {
    multiViewOpen,
    setMultiViewOpen,
    multiViewIndex,
    setMultiViewIndex,
    viewsPrompt,
    setViewsPrompt,
    viewsModel,
    setViewsModel,
    handleOpenMultiView,
    executeGenerateCharacterViews,
    handleGenerateCharacterViews,
  };
}
