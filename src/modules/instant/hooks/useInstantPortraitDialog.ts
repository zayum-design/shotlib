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
import { Modal } from 'antd';
import type { InstantCharacter, InstantScene, InstantSegment } from '@/shared/types/project';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import { saveInstantToServer } from '@/modules/instant/utils/instantSyncUtils';
import { removePortraitFromSegments } from '@/modules/instant/utils/instantPromptUtils';
import { message } from '@/shared/utils/message';

export function useInstantPortraitDialog({
  projectId,
  selectedImageModel,
  characters,
  setCharacters,
  multiViewChar,
  setMultiViewChar,
  setMultiViewIndex,
  scenes,
  segments,
  setSegments,
}: {
  projectId: string | undefined;
  selectedImageModel: string;
  characters: InstantCharacter[];
  setCharacters: React.Dispatch<React.SetStateAction<InstantCharacter[]>>;
  multiViewChar: InstantCharacter | null;
  setMultiViewChar: React.Dispatch<React.SetStateAction<InstantCharacter | null>>;
  setMultiViewIndex: React.Dispatch<React.SetStateAction<number>>;
  scenes: InstantScene[];
  segments: InstantSegment[];
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
}) {
  const [portraitDialogOpen, setPortraitDialogOpen] = useState(false);
  const [portraitDialogTitle, setPortraitDialogTitle] = useState('');
  const [portraitDialogPrompt, setPortraitDialogPrompt] = useState('');
  const [portraitDialogModel, setPortraitDialogModel] = useState(selectedImageModel);
  const [portraitDialogChar, setPortraitDialogChar] = useState<InstantCharacter | null>(null);
  const [portraitDialogIsReset, setPortraitDialogIsReset] = useState(false);
  const [portraitDialogPreviewUrl, setPortraitDialogPreviewUrl] = useState('');
  const [portraitDialogGenerating, setPortraitDialogGenerating] = useState(false);

  const openPortraitDialog = useCallback((char: InstantCharacter, isReset = false) => {
    setPortraitDialogChar(char);
    setPortraitDialogIsReset(isReset);
    if (isReset) {
      setPortraitDialogTitle(char.portraitPrompt ? `${char.name}形象照` : '');
      setPortraitDialogPrompt(char.portraitPrompt || '');
      setPortraitDialogModel(char.model || selectedImageModel);
    } else {
      setPortraitDialogTitle('');
      setPortraitDialogPrompt('');
      setPortraitDialogModel(char.model || selectedImageModel);
    }
    setPortraitDialogPreviewUrl('');
    setPortraitDialogGenerating(false);
    setPortraitDialogOpen(true);
  }, [selectedImageModel]);

  const closePortraitDialog = useCallback(() => {
    setPortraitDialogOpen(false);
    setPortraitDialogChar(null);
    setPortraitDialogPreviewUrl('');
    setPortraitDialogGenerating(false);
  }, []);

  const executeGeneratePortrait = useCallback(
    async (char: InstantCharacter, requestData: { prompt: string; model: string; avatarUrl: string }) => {
      const { prompt, model, avatarUrl } = requestData;
      const aspectRatio = '16:9';
      const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
      const taskId = addTask({ type: 'character-fullbody', name: `生成形象图 - ${char.name}`, status: 'running', prompt, modelVariant: model });

      try {
        setCharacters((prev) =>
          prev.map((c) => (c.id === char.id ? { ...c, isGeneratingPortrait: true } : c))
        );
        if (multiViewChar?.id === char.id) {
          setMultiViewChar({ ...multiViewChar, isGeneratingPortrait: true });
        }
        const res = await workflowApi.generateCharacterPortraitApi(char.id, {
          avatarUrl,
          portraitPrompt: prompt,
          model,
          count: 1,
          aspectRatio,
          async: true,
        });

        if (!res.success) {
          failTask(taskId, '提交失败');
          setCharacters((prev) => {
            const next = prev.map((c) => (c.id === char.id ? { ...c, isGeneratingPortrait: false } : c));
            persistInstantData(projectId, { instantCharacters: next });
            return next;
          });
          if (multiViewChar?.id === char.id) {
            setMultiViewChar({ ...multiViewChar, isGeneratingPortrait: false });
          }
          return;
        }

        const jobData = res.data as any;
        let urls: string[] = [];

        if (jobData?.jobId) {
          const jobId = jobData.jobId;
          const pollResult = await workflowApi.pollJobStatus<{ portraitUrls?: string[] }>(jobId, {
            interval: 3000,
            maxWaitTime: 5 * 60 * 1000,
            onPoll: () => incrementPollCount(taskId),
          });

          if (!pollResult.success) {
            failTask(taskId, pollResult.error || '执行失败');
            setCharacters((prev) => {
              const next = prev.map((c) => (c.id === char.id ? { ...c, isGeneratingPortrait: false } : c));
              persistInstantData(projectId, { instantCharacters: next });
              return next;
            });
            if (multiViewChar?.id === char.id) {
              setMultiViewChar({ ...multiViewChar, isGeneratingPortrait: false });
            }
            return;
          }

          urls = pollResult.data?.portraitUrls || [];
        } else {
          urls = (res.data as any)?.portraitUrls || [];
        }

        if (urls.length > 0) {
          message.success('形象图生成成功');
          const referenceAvatarId = char.avatarImages?.[0]?.id;

          // instant 项目 image_asset 行由 saveProjectAssets 自动创建，前端提供稳定 id 作为 asset_key
          const newPortraitImages = urls.map((url, index) => ({
            id: `${char.id}-portrait-${Date.now()}-${index}`,
            assetId: `${char.id}-portrait-${Date.now()}-${index}`,
            imageUrl: url,
            name: '形象照',
            referenceAvatarId,
            prompt: requestData.prompt,
            model: requestData.model,
          }));
          setCharacters((prev) => {
            const next = prev.map((c) =>
              c.id === char.id
                ? { ...c, isGeneratingPortrait: false, portraitImages: [...(c.portraitImages || []), ...newPortraitImages] }
                : c
            );
            persistInstantData(projectId, { instantCharacters: next });
            // 立即保存到服务器，确保 image_asset 行被创建
            if (projectId && projectId !== 'default') {
              saveInstantToServer(projectId, {
                instantCharacters: next,
                instantScenes: scenes,
                instantSegments: segments,
              }).catch((e) => {
                console.warn('[useInstantPortraitDialog] 立即保存形象照失败:', e);
              });
            }
            return next;
          });
          if (multiViewChar?.id === char.id) {
            setMultiViewChar((prev) =>
              prev
                ? { ...prev, isGeneratingPortrait: false, portraitImages: [...(prev.portraitImages || []), ...newPortraitImages] }
                : null
            );
          }
          completeTask(taskId, { portraitImages: newPortraitImages });
        } else {
          throw new Error('未返回有效图片');
        }
      } catch (err: any) {
        failTask(taskId, err?.message || '生成失败');
        message.error(err?.message || '形象图生成失败');
        setCharacters((prev) => {
          const next = prev.map((c) => (c.id === char.id ? { ...c, isGeneratingPortrait: false } : c));
          persistInstantData(projectId, { instantCharacters: next });
          return next;
        });
        if (multiViewChar?.id === char.id) {
          setMultiViewChar((prev) => (prev ? { ...prev, isGeneratingPortrait: false } : null));
        }
      } finally {
        const task = useTaskQueueStore.getState().tasks.find((t) => t.id === taskId);
        if (task && (task.status === 'running' || task.status === 'polling')) {
          removeTask(taskId);
        }
      }
    },
    [projectId, multiViewChar, segments, scenes, setCharacters]
  );

  const handleGeneratePortraitInDialog = useCallback(async () => {
    const char = portraitDialogChar;
    if (!char) return;
    const title = portraitDialogTitle.trim();
    if (!title) {
      message.warning('请输入形象照标题');
      return;
    }
    const prompt = portraitDialogPrompt.trim();
    if (!prompt) {
      message.warning('请输入形象图描述');
      return;
    }
    const avatarUrl = char.avatar?.trim() || char.avatarImages?.[0]?.imageUrl;
    if (!avatarUrl) {
      message.warning('请先生成头像，再生成形象图');
      return;
    }
    const model = portraitDialogModel || selectedImageModel;

    setPortraitDialogPreviewUrl('');
    setPortraitDialogGenerating(true);
    const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
    const taskId = addTask({ type: 'character-fullbody', name: `生成形象图 - ${char.name}`, status: 'running', prompt, modelVariant: model });

    try {
      const res = await workflowApi.generateCharacterPortraitApi(char.id, {
        avatarUrl,
        portraitPrompt: prompt,
        model,
        count: 1,
        aspectRatio: '16:9',
        async: true,
      });

      if (!res.success) {
        failTask(taskId, '提交失败');
        return;
      }

      const jobData = res.data as any;
      let urls: string[] = [];

      if (jobData?.jobId) {
        const pollResult = await workflowApi.pollJobStatus<{ portraitUrls?: string[] }>(jobData.jobId, {
          interval: 3000,
          maxWaitTime: 5 * 60 * 1000,
          onPoll: () => incrementPollCount(taskId),
        });

        if (!pollResult.success) {
          failTask(taskId, pollResult.error || '执行失败');
          return;
        }

        urls = pollResult.data?.portraitUrls || [];
      } else {
        urls = (res.data as any)?.portraitUrls || [];
      }

      if (urls.length > 0) {
        const previewPrompt = portraitDialogPrompt.trim();
        const previewModel = portraitDialogModel || selectedImageModel;
        const previewReferenceAvatarId = portraitDialogChar?.avatarImages?.[0]?.id;
        setPortraitDialogPreviewUrl(urls[0]);
        completeTask(taskId, { portraitImages: urls.map((url) => ({ imageUrl: url, name: '形象照', referenceAvatarId: previewReferenceAvatarId, prompt: previewPrompt, model: previewModel })) });
        message.success('形象图生成成功，点击确认添加到列表');
      } else {
        throw new Error('未返回有效图片');
      }
    } catch (err: any) {
      failTask(taskId, err?.message || '生成失败');
      message.error(err?.message || '形象图生成失败');
    } finally {
      setPortraitDialogGenerating(false);
      const task = useTaskQueueStore.getState().tasks.find((t) => t.id === taskId);
      if (task && (task.status === 'running' || task.status === 'polling')) {
        removeTask(taskId);
      }
    }
  }, [portraitDialogChar, portraitDialogTitle, portraitDialogPrompt, portraitDialogModel, selectedImageModel]);

  const handleConfirmPortraitFromDialog = useCallback(async () => {
    const char = portraitDialogChar;
    if (!char || !portraitDialogPreviewUrl) return;

    const prompt = portraitDialogPrompt.trim();
    const model = portraitDialogModel || selectedImageModel;

    const referenceAvatarId = char.avatarImages?.[0]?.id;

    // instant 项目 image_asset 行由 saveProjectAssets 自动创建，前端提供稳定 id 作为 asset_key
    const portraitKey = crypto.randomUUID();
    const newPortraitImage = {
      id: portraitKey,
      assetId: portraitKey,
      imageUrl: portraitDialogPreviewUrl,
      name: portraitDialogTitle.trim() || '形象照',
      referenceAvatarId,
      prompt,
      model,
    };
    const nextChars = characters.map((c) =>
      c.id === char.id
        ? {
            ...c,
            portraitPrompt: prompt,
            model,
            portraitImages: [...(c.portraitImages || []), newPortraitImage],
          }
        : c
    );
    setCharacters(nextChars);
    persistInstantData(projectId, { instantCharacters: nextChars });
    if (multiViewChar?.id === char.id) {
      setMultiViewChar({
        ...multiViewChar,
        portraitPrompt: prompt,
        model,
        portraitImages: [...(multiViewChar.portraitImages || []), newPortraitImage],
      });
    }

    // 立即保存到服务器，确保 image_asset 行被创建
    if (projectId && projectId !== 'default') {
      saveInstantToServer(projectId, {
        instantCharacters: nextChars,
        instantScenes: scenes,
        instantSegments: segments,
      }).catch((e) => {
        console.warn('[useInstantPortraitDialog] 立即保存形象照失败:', e);
      });
    }

    closePortraitDialog();
  }, [portraitDialogChar, portraitDialogPreviewUrl, portraitDialogPrompt, portraitDialogModel, portraitDialogTitle, selectedImageModel, projectId, characters, multiViewChar, closePortraitDialog, segments, scenes]);

  const handleDeletePortrait = useCallback(
    (char: InstantCharacter, index: number) => {
      Modal.confirm({
        title: '删除形象照',
        content: '该形象照将被永久删除，提示词中引用的 @ 形象照也会一并清除。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          const pid = projectId;
          setCharacters((prev) => {
            const next = prev.map((c) => {
              if (c.id !== char.id) return c;
              const nextImages = (c.portraitImages || []).filter((_, i) => i !== index);
              return { ...c, portraitImages: nextImages };
            });
            persistInstantData(pid, { instantCharacters: next });
            return next;
          });
          if (multiViewChar?.id === char.id) {
            setMultiViewChar((prev) =>
              prev
                ? {
                    ...prev,
                    portraitImages: (prev.portraitImages || []).filter((_, i) => i !== index),
                  }
                : null,
            );
          }
          setSegments((prevSegs) => {
            const nextSegs = removePortraitFromSegments(prevSegs, char.id, index);
            if (nextSegs === prevSegs) return prevSegs;
            if (pid) {
              persistInstantData(pid, { instantSegments: nextSegs });
            }
            return nextSegs;
          });
          message.success('已删除形象照');
        },
      });
    },
    [projectId, multiViewChar, setSegments]
  );

  const handleDeleteFullBody = useCallback(
    (char: InstantCharacter, index: number) => {
      Modal.confirm({
        title: '删除多视图',
        content: '该张多视图将被永久删除。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          const pid = projectId;
          setCharacters((prev) => {
            const next = prev.map((c) => {
              if (c.id !== char.id) return c;
              const nextImages = (c.fullBodyImages || []).filter((_, i) => i !== index);
              return { ...c, fullBodyImages: nextImages };
            });
            persistInstantData(pid, { instantCharacters: next });
            return next;
          });
          if (multiViewChar?.id === char.id) {
            const nextImages = (multiViewChar.fullBodyImages || []).filter((_, i) => i !== index);
            setMultiViewChar({ ...multiViewChar, fullBodyImages: nextImages });
            setMultiViewIndex((cur) => Math.min(cur, Math.max(0, nextImages.length - 1)));
          }
          message.success('已删除多视图');
        },
      });
    },
    [projectId, multiViewChar]
  );

  return {
    portraitDialogOpen,
    setPortraitDialogOpen,
    portraitDialogTitle,
    setPortraitDialogTitle,
    portraitDialogPrompt,
    setPortraitDialogPrompt,
    portraitDialogModel,
    setPortraitDialogModel,
    portraitDialogChar,
    setPortraitDialogChar,
    portraitDialogIsReset,
    setPortraitDialogIsReset,
    portraitDialogPreviewUrl,
    setPortraitDialogPreviewUrl,
    portraitDialogGenerating,
    setPortraitDialogGenerating,
    openPortraitDialog,
    closePortraitDialog,
    executeGeneratePortrait,
    handleGeneratePortraitInDialog,
    handleConfirmPortraitFromDialog,
    handleDeletePortrait,
    handleDeleteFullBody,
  };
}
