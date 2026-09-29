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

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback } from 'react';
import { message } from 'antd';
import type { InstantSegment, InstantScene, InstantCharacter, CanvasItem } from '@/shared/types/project';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import { localApi } from '@/storage';
import {
  parseFramePrompt,
  wrapPromptWithTags,
  simplifyFramePrompt,
  stripPromptTags,
} from '@/modules/instant/utils/instantPromptUtils';
import {
  buildUniversalReferenceRequest,
  stripFirstLastFramePrompt,
} from '@/modules/instant/utils/instantVideoPromptUtils';

interface UseInstantFirstLastFrameManagerOptions {
  activeSegment: InstantSegment | undefined;
  segments: InstantSegment[];
  saveSegments: (nextSegments: InstantSegment[]) => void;
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  projectId: string | undefined;
  canvasItems: CanvasItem[];
  selectedImageModel: string;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  currentProjectAspectRatio?: string;
  scenes: InstantScene[];
  characters: InstantCharacter[];
}

export function useInstantFirstLastFrameManager({
  activeSegment,
  segments,
  saveSegments,
  setSegments,
  projectId,
  canvasItems,
  selectedImageModel,
  videoApiPreviewMode,
  showApiPreview,
  currentProjectAspectRatio,
  scenes,
  characters,
}: UseInstantFirstLastFrameManagerOptions) {
  const activeSegmentId = activeSegment?.id;
  // 修改首帧提示词
  const handleFirstFramePromptChange = useCallback(
    (itemId: string, value: string) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, firstFramePrompt: value } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  // 修改尾帧提示词
  const handleLastFramePromptChange = useCallback(
    (itemId: string, value: string) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, lastFramePrompt: value } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  // 修改首尾帧视频提示词
  const handleFirstLastFrameVideoPromptChange = useCallback(
    (itemId: string, value: string) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, firstLastFrameVideoPrompt: value } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  // 真正执行首帧图片生成（异步任务队列）
  const executeGenerateFirstFrame = useCallback(
    async (
      itemId: string,
      requestData: { pid: string; finalPrompt: string; model: string; referenceImageUrls: string[]; ratio: string }
    ) => {
      const { pid, finalPrompt, model, referenceImageUrls, ratio } = requestData;
      const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
      const taskId = addTask({ type: 'first-frame', name: '生成首帧图片', status: 'running', prompt: finalPrompt, modelVariant: model });

      try {
        const res = await workflowApi.generateFirstFrameApi(
          pid,
          finalPrompt,
          model,
          undefined,
          referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
          ratio,
          undefined,
          true
        );

        if (!res.success) {
          failTask(taskId, '提交失败');
          setSegments((prev) => {
            const next = prev.map((s) => {
              if (s.id !== activeSegmentId) return s;
              return {
                ...s,
                canvasItems: s.canvasItems.map((it) =>
                  it.id === itemId ? { ...it, isGeneratingFirstFrame: false } : it
                ),
              };
            });
            persistInstantData(projectId, { instantSegments: next });
            return next;
          });
          return;
        }

        const jobData = res.data as any;
        let imageUrl: string | undefined;
        let imageAssetId: string | undefined;
        let metadata: Record<string, any> | undefined;

        if (jobData?.jobId) {
          const jobId = jobData.jobId;
          const pollResult = await workflowApi.pollJobStatus<workflowApi.GenerateFrameImageResponse>(jobId, {
            interval: 3000,
            maxWaitTime: 5 * 60 * 1000,
            onPoll: () => incrementPollCount(taskId),
          });

          if (!pollResult.success) {
            failTask(taskId, pollResult.error || '执行失败');
            setSegments((prev) => {
              const next = prev.map((s) => {
                if (s.id !== activeSegmentId) return s;
                return {
                  ...s,
                  canvasItems: s.canvasItems.map((it) =>
                    it.id === itemId ? { ...it, isGeneratingFirstFrame: false } : it
                  ),
                };
              });
              persistInstantData(projectId, { instantSegments: next });
              return next;
            });
            return;
          }

          imageUrl = pollResult.data?.imageUrl;
          imageAssetId = crypto.randomUUID();
          metadata = pollResult.data?.metadata;
        } else {
          imageUrl = (res.data as any)?.imageUrl;
          imageAssetId = crypto.randomUUID();
          metadata = (res.data as any)?.metadata;
        }

        if (imageUrl) {
          message.success('首帧生成成功');
          setSegments((prev) => {
            const next = prev.map((s) => {
              if (s.id !== activeSegmentId) return s;
              return {
                ...s,
                canvasItems: s.canvasItems.map((it) =>
                  it.id === itemId
                    ? { ...it, isGeneratingFirstFrame: false, firstFrameImageUrl: imageUrl, firstFrameImageAssetId: imageAssetId, firstFrameGenMeta: metadata }
                    : it
                ),
              };
            });
            persistInstantData(projectId, { instantSegments: next });
            return next;
          });
          completeTask(taskId, { imageUrl });
        } else {
          throw new Error('未返回有效图片');
        }
      } catch (err: any) {
        failTask(taskId, err?.message || '生成失败');
        message.error(err?.message || '首帧生成失败');
        setSegments((prev) => {
          const next = prev.map((s) => {
            if (s.id !== activeSegmentId) return s;
            return {
              ...s,
              canvasItems: s.canvasItems.map((it) =>
                it.id === itemId ? { ...it, isGeneratingFirstFrame: false } : it
              ),
            };
          });
          persistInstantData(projectId, { instantSegments: next });
          return next;
        });
      } finally {
        const task = useTaskQueueStore.getState().tasks.find((t) => t.id === taskId);
        if (task && (task.status === 'running' || task.status === 'polling')) {
          removeTask(taskId);
        }
      }
    },
    [activeSegmentId, projectId, projectId]
  );

  // 生成首帧图片
  const handleGenerateFirstFrame = useCallback(
    async (itemId: string) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item || !(projectId)) return;

      const prompt = item.firstFramePrompt || item.customPrompt || item.generatedPrompt || '';
      if (!prompt.trim()) {
        message.warning('首帧提示词为空');
        return;
      }

      const model = item.shotImageModel || selectedImageModel;
      if (!model) {
        message.warning('请选择一个图片模型');
        return;
      }

      // 重新生成首帧：清除旧 image_asset 的合规标记，避免新图误用旧合规 assetId（参考 workflowStore.frame.ts:105-116）
      if (item.firstFrameImageAssetId && projectId) {
        const { buildSeedanceCompliance } = await import(
          '@/modules/workflow/providers/volcengine/compliance'
        );
        localApi
          .patchImageAssetData(projectId, item.firstFrameImageAssetId, buildSeedanceCompliance({ assetId: '', isCompliant: false }))
          .catch((e: any) => console.warn('[generateFirstFrame] 清除旧首帧合规标记失败:', e?.message));
      }

      setSegments((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeSegmentId) return s;
          return {
            ...s,
            canvasItems: s.canvasItems.map((it) =>
              it.id === itemId ? { ...it, isGeneratingFirstFrame: true, firstFrameImageUrl: undefined } : it
            ),
          };
        });
        persistInstantData(projectId, { instantSegments: next });
        return next;
      });

      const pid = projectId;
      if (!pid) return;

      const ratio = currentProjectAspectRatio || '16:9';
      const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(prompt, scenes, characters);
      const finalPrompt = `生成首帧静态画面：${cleanPrompt}`;
      const requestData = { pid, finalPrompt, model, referenceImageUrls, ratio };

      if (videoApiPreviewMode) {
        showApiPreview(
          '首帧生成请求预览',
          workflowApi.generateFirstFrameApi(pid, finalPrompt, model, undefined, referenceImageUrls.length > 0 ? referenceImageUrls : undefined, ratio, true),
          requestData,
          () => executeGenerateFirstFrame(itemId, requestData)
        );
        return;
      }

      await executeGenerateFirstFrame(itemId, requestData);
    },
    [canvasItems, projectId, activeSegmentId, selectedImageModel, scenes, characters, videoApiPreviewMode, showApiPreview, executeGenerateFirstFrame]
  );

  // 真正执行尾帧图片生成（异步任务队列）
  const executeGenerateLastFrame = useCallback(
    async (
      itemId: string,
      requestData: { pid: string; finalPrompt: string; model: string; referenceImageUrls: string[]; ratio: string }
    ) => {
      const { pid, finalPrompt, model, referenceImageUrls, ratio } = requestData;
      const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
      const taskId = addTask({ type: 'last-frame', name: '生成尾帧图片', status: 'running', prompt: finalPrompt, modelVariant: model });

      try {
        const res = await workflowApi.generateLastFrameApi(
          pid,
          finalPrompt,
          model,
          undefined,
          referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
          ratio,
          undefined,
          true
        );

        if (!res.success) {
          failTask(taskId, '提交失败');
          setSegments((prev) => {
            const next = prev.map((s) => {
              if (s.id !== activeSegmentId) return s;
              return {
                ...s,
                canvasItems: s.canvasItems.map((it) =>
                  it.id === itemId ? { ...it, isGeneratingLastFrame: false } : it
                ),
              };
            });
            persistInstantData(projectId, { instantSegments: next });
            return next;
          });
          return;
        }

        const jobData = res.data as any;
        let imageUrl: string | undefined;
        let imageAssetId: string | undefined;
        let metadata: Record<string, any> | undefined;

        if (jobData?.jobId) {
          const jobId = jobData.jobId;
          const pollResult = await workflowApi.pollJobStatus<workflowApi.GenerateFrameImageResponse>(jobId, {
            interval: 3000,
            maxWaitTime: 5 * 60 * 1000,
            onPoll: () => incrementPollCount(taskId),
          });

          if (!pollResult.success) {
            failTask(taskId, pollResult.error || '执行失败');
            setSegments((prev) => {
              const next = prev.map((s) => {
                if (s.id !== activeSegmentId) return s;
                return {
                  ...s,
                  canvasItems: s.canvasItems.map((it) =>
                    it.id === itemId ? { ...it, isGeneratingLastFrame: false } : it
                  ),
                };
              });
              persistInstantData(projectId, { instantSegments: next });
              return next;
            });
            return;
          }

          imageUrl = pollResult.data?.imageUrl;
          imageAssetId = crypto.randomUUID();
          metadata = pollResult.data?.metadata;
        } else {
          imageUrl = (res.data as any)?.imageUrl;
          imageAssetId = crypto.randomUUID();
          metadata = (res.data as any)?.metadata;
        }

        if (imageUrl) {
          message.success('尾帧生成成功');
          setSegments((prev) => {
            const next = prev.map((s) => {
              if (s.id !== activeSegmentId) return s;
              return {
                ...s,
                canvasItems: s.canvasItems.map((it) =>
                  it.id === itemId
                    ? { ...it, isGeneratingLastFrame: false, lastFrameImageUrl: imageUrl, lastFrameImageAssetId: imageAssetId, lastFrameGenMeta: metadata }
                    : it
                ),
              };
            });
            persistInstantData(projectId, { instantSegments: next });
            return next;
          });
          completeTask(taskId, { imageUrl });
        } else {
          throw new Error('未返回有效图片');
        }
      } catch (err: any) {
        failTask(taskId, err?.message || '生成失败');
        message.error(err?.message || '尾帧生成失败');
        setSegments((prev) => {
          const next = prev.map((s) => {
            if (s.id !== activeSegmentId) return s;
            return {
              ...s,
              canvasItems: s.canvasItems.map((it) =>
                it.id === itemId ? { ...it, isGeneratingLastFrame: false } : it
              ),
            };
          });
          persistInstantData(projectId, { instantSegments: next });
          return next;
        });
      } finally {
        const task = useTaskQueueStore.getState().tasks.find((t) => t.id === taskId);
        if (task && (task.status === 'running' || task.status === 'polling')) {
          removeTask(taskId);
        }
      }
    },
    [activeSegmentId, projectId, projectId]
  );

  // 生成尾帧图片
  const handleGenerateLastFrame = useCallback(
    async (itemId: string) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item || !(projectId)) return;

      const prompt = item.lastFramePrompt || item.customPrompt || item.generatedPrompt || '';
      if (!prompt.trim()) {
        message.warning('尾帧提示词为空');
        return;
      }

      const model = item.shotImageModel || selectedImageModel;
      if (!model) {
        message.warning('请选择一个图片模型');
        return;
      }

      // 重新生成尾帧：清除旧 image_asset 的合规标记，避免新图误用旧合规 assetId（参考 workflowStore.frame.ts:105-116）
      if (item.lastFrameImageAssetId && projectId) {
        const { buildSeedanceCompliance } = await import(
          '@/modules/workflow/providers/volcengine/compliance'
        );
        localApi
          .patchImageAssetData(projectId, item.lastFrameImageAssetId, buildSeedanceCompliance({ assetId: '', isCompliant: false }))
          .catch((e: any) => console.warn('[generateLastFrame] 清除旧尾帧合规标记失败:', e?.message));
      }

      setSegments((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeSegmentId) return s;
          return {
            ...s,
            canvasItems: s.canvasItems.map((it) =>
              it.id === itemId ? { ...it, isGeneratingLastFrame: true, lastFrameImageUrl: undefined } : it
            ),
          };
        });
        persistInstantData(projectId, { instantSegments: next });
        return next;
      });

      const pid = projectId;
      if (!pid) return;

      const ratio = currentProjectAspectRatio || '16:9';
      const { prompt: cleanPrompt, referenceImageUrls } = parseFramePrompt(prompt, scenes, characters);
      const finalPrompt = `生成尾帧静态画面：${cleanPrompt}`;
      const requestData = { pid, finalPrompt, model, referenceImageUrls, ratio };

      if (videoApiPreviewMode) {
        showApiPreview(
          '尾帧生成请求预览',
          workflowApi.generateLastFrameApi(pid, finalPrompt, model, undefined, referenceImageUrls.length > 0 ? referenceImageUrls : undefined, ratio, true),
          requestData,
          () => executeGenerateLastFrame(itemId, requestData)
        );
        return;
      }

      await executeGenerateLastFrame(itemId, requestData);
    },
    [canvasItems, projectId, activeSegmentId, selectedImageModel, scenes, characters, videoApiPreviewMode, showApiPreview, executeGenerateLastFrame]
  );

  // 切换视频索引
  const handleVideoIndexChange = useCallback(
    (itemId: string, index: number) => {
      if (!activeSegmentId) return;
      setSegments((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeSegmentId) return s;
          return {
            ...s,
            canvasItems: s.canvasItems.map((it) => {
              if (it.id !== itemId) return it;
              if (!it.videoUrls || index < 0 || index >= it.videoUrls.length) return it;
              return {
                ...it,
                currentVideoIndex: index,
                videoUrl: it.videoUrls[index],
              };
            }),
          };
        });
        persistInstantData(projectId, { instantSegments: next });
        return next;
      });
    },
    [activeSegmentId, projectId, projectId]
  );

  // 批量生成首尾帧（跳过已有图片或正在生成的）
  const handleBatchGenerateFirstLastFrames = useCallback(
    async (itemId: string) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item) return;

      const tasks: Promise<void>[] = [];

      if (!item.firstFrameImageUrl && !item.isGeneratingFirstFrame && item.firstFramePrompt) {
        tasks.push(handleGenerateFirstFrame(itemId));
      }
      if (!item.lastFrameImageUrl && !item.isGeneratingLastFrame && item.lastFramePrompt) {
        tasks.push(handleGenerateLastFrame(itemId));
      }

      if (tasks.length === 0) {
        if (!item.firstFramePrompt && !item.lastFramePrompt) {
          message.info('请先填写首帧或尾帧的提示词');
        } else {
          message.info('首尾帧已有图片或正在生成中');
        }
        return;
      }

      message.info(`开始批量生成首尾帧图片`);
      // 顺序执行避免并发问题
      for (const task of tasks) {
        await task;
      }
    },
    [canvasItems, handleGenerateFirstFrame, handleGenerateLastFrame]
  );

  return {
    handleFirstFramePromptChange,
    handleLastFramePromptChange,
    handleFirstLastFrameVideoPromptChange,
    handleGenerateFirstFrame,
    handleGenerateLastFrame,
    handleVideoIndexChange,
    handleBatchGenerateFirstLastFrames,
  };
}
