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

import { useCallback } from 'react';
import type { InstantCharacter, InstantScene } from '@/shared/types/project';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import { message } from '@/shared/utils/message';

const buildAvatarPrompt = (char: InstantCharacter) => {
  return `${char.name}，${char.gender}，${char.appearance}，职业是${char.occupation}。高清头像，正面照，细腻五官。`;
};

export function useInstantAvatarGeneration({
  projectId,
  setCharacters,
  saveCharacters,
  syncSegmentPromptImages,
  scenes,
  selectedImageModel,
  videoApiPreviewMode,
  showApiPreview,
}: {
  projectId: string | undefined;
  setCharacters: React.Dispatch<React.SetStateAction<InstantCharacter[]>>;
  saveCharacters: (next: InstantCharacter[]) => void;
  syncSegmentPromptImages: (chars: InstantCharacter[], scns: InstantScene[]) => void;
  scenes: InstantScene[];
  selectedImageModel: string;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
}) {
  const executeGenerateAvatar = useCallback(
    async (char: InstantCharacter, requestData: { prompt: string; model: string }) => {
      const { prompt, model } = requestData;
      const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
      const taskId = addTask({ type: 'character-avatar', name: `生成头像 - ${char.name}`, status: 'running', prompt, modelVariant: model });

      try {
        setCharacters((prev) =>
          prev.map((c) => (c.id === char.id ? { ...c, isGeneratingAvatar: true } : c))
        );
        const res = await workflowApi.generateAvatarApi(char.id, prompt, model, undefined, undefined, undefined, true);

        if (!res.success) {
          failTask(taskId, '提交失败');
          setCharacters((prev) => {
            const next = prev.map((c) => (c.id === char.id ? { ...c, isGeneratingAvatar: false } : c));
            persistInstantData(projectId, { instantCharacters: next });
            return next;
          });
          return;
        }

        const jobData = res.data as any;
        let urls: string[] = [];

        if (jobData?.jobId) {
          const jobId = jobData.jobId;
          const pollResult = await workflowApi.pollJobStatus<{ avatarUrls?: string[] }>(jobId, {
            interval: 3000,
            maxWaitTime: 5 * 60 * 1000,
            onPoll: () => incrementPollCount(taskId),
          });

          if (!pollResult.success) {
            failTask(taskId, pollResult.error || '执行失败');
            setCharacters((prev) => {
              const next = prev.map((c) => (c.id === char.id ? { ...c, isGeneratingAvatar: false } : c));
              persistInstantData(projectId, { instantCharacters: next });
              return next;
            });
            return;
          }

          urls = pollResult.data?.avatarUrls || [];
        } else {
          urls = (res.data as any)?.avatarUrls || [];
        }

        if (urls.length > 0) {
          message.success('头像生成成功');
          setCharacters((prev) => {
            const next = prev.map((c) =>
              c.id === char.id
                ? {
                    ...c,
                    isGeneratingAvatar: false,
                    avatarImages: urls.map((url) => ({
                      imageUrl: url,
                      // 头像行 asset_key=charId
                      assetId: char.id,
                      name: '头像',
                      isPortrait: true,
                    })),
                    avatar: urls[0] || c.avatar,
                  }
                : c
            );
            persistInstantData(projectId, { instantCharacters: next });
            syncSegmentPromptImages(next, scenes);
            // 同步触发服务器保存，避免仅依赖 2s 防抖导致状态不同步
            saveCharacters(next);
            return next;
          });
          completeTask(taskId, { imageUrls: urls });
        } else {
          throw new Error('未返回有效图片');
        }
      } catch (err: any) {
        failTask(taskId, err?.message || '生成失败');
        message.error(err?.message || '头像生成失败');
        setCharacters((prev) => {
          const next = prev.map((c) => (c.id === char.id ? { ...c, isGeneratingAvatar: false } : c));
          persistInstantData(projectId, { instantCharacters: next });
          return next;
        });
      } finally {
        const task = useTaskQueueStore.getState().tasks.find((t) => t.id === taskId);
        if (task && (task.status === 'running' || task.status === 'polling')) {
          removeTask(taskId);
        }
      }
    },
    [projectId, scenes, syncSegmentPromptImages, saveCharacters]
  );

  const handleGenerateAvatar = useCallback(
    async (char: InstantCharacter) => {
      const prompt = char.avatarPrompt || buildAvatarPrompt(char);
      const model = char.model || selectedImageModel;
      const requestData = { prompt, model };

      if (videoApiPreviewMode) {
        showApiPreview(
          '头像生成请求预览',
          workflowApi.generateAvatarApi(char.id, prompt, model, undefined, undefined, true, true),
          requestData,
          () => executeGenerateAvatar(char, requestData)
        );
        return;
      }

      await executeGenerateAvatar(char, requestData);
    },
    [selectedImageModel, videoApiPreviewMode, showApiPreview, executeGenerateAvatar]
  );

  return {
    executeGenerateAvatar,
    handleGenerateAvatar,
  };
}
