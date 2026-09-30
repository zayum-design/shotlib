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
import { useState, useCallback } from 'react';
import type { InstantSegment, InstantCharacter, InstantScene, CanvasItem } from '@/shared/types/project';
import type { ModelConfig } from '@/shared/types/index';
import { useTaskQueueStore, canSubmitForVariant } from '@/shared/stores/taskQueueStore';
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import { useInstantVideoRequestBuilder } from './useInstantVideoRequestBuilder';
import { message } from '@/shared/utils/message';

interface UseInstantVideoGenerationOptions {
  activeSegment: InstantSegment | undefined;
  activeSegmentId: string | null;
  segments: InstantSegment[];
  saveSegments: (nextSegments: InstantSegment[]) => void;
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  characters: InstantCharacter[];
  scenes: InstantScene[];
  projectId: string | undefined;
  canvasItems: CanvasItem[];
  videoModels: ModelConfig[];
  defaultVideoModel: string;
  selectedImageModel: string;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  currentProjectAspectRatio?: string;
  saveCharacters: (next: InstantCharacter[]) => void;
}

export function useInstantVideoGeneration({
  activeSegment,
  activeSegmentId,
  segments,
  saveSegments,
  setSegments,
  characters,
  scenes,
  projectId,
  canvasItems,
  videoModels,
  defaultVideoModel,
  selectedImageModel,
  videoApiPreviewMode,
  showApiPreview,
  currentProjectAspectRatio,
  saveCharacters,
}: UseInstantVideoGenerationOptions) {
  const {
    buildVideoRequest,
  } = useInstantVideoRequestBuilder({
    canvasItems,
    projectId,
    scenes,
    defaultVideoModel,
    videoModels,
    characters,
    currentProjectAspectRatio,
  });

  /**
   * 标记某个场次的视频生成成功：写入 videoUrl、清空 videoJobId/videoTaskId。
   */
  const succeedVideo = useCallback(
    (itemId: string, videoUrl: string, queueTaskId: string) => {
      const { completeTask } = useTaskQueueStore.getState();
      message.success('视频生成成功');
      setSegments((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeSegmentId) return s;
          return {
            ...s,
            canvasItems: s.canvasItems.map((it) => {
              if (it.id !== itemId) return it;
              const existingUrls = it.videoUrls || [];
              return {
                ...it,
                isGeneratingVideo: false,
                videoGenerationFailed: false,
                videoGenerationError: undefined,
                videoUrl,
                videoUrls: [videoUrl, ...existingUrls],
                currentVideoIndex: 0,
                videoJobId: undefined,
                videoTaskId: undefined,
              };
            }),
          };
        });
        persistInstantData(projectId, { instantSegments: next });
        return next;
      });
      completeTask(queueTaskId, { videoUrl });
    },
    [activeSegmentId, projectId, setSegments]
  );

  /**
   * 标记某个场次的视频生成失败：保留 videoJobId/videoTaskId 以便后续重试轮询。
   */
  const failVideo = useCallback(
    (itemId: string, error: string, queueTaskId: string) => {
      const { failTask } = useTaskQueueStore.getState();
      failTask(queueTaskId, error);
      // 不再弹 toast，改为在界面上持久显示（见 CanvasSceneVideoPanel）
      setSegments((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeSegmentId) return s;
          return {
            ...s,
            canvasItems: s.canvasItems.map((it) =>
              it.id === itemId
                ? { ...it, isGeneratingVideo: false, videoGenerationFailed: true, videoGenerationError: error }
                : it
            ),
          };
        });
        persistInstantData(projectId, { instantSegments: next });
        return next;
      });
    },
    [activeSegmentId, projectId, setSegments]
  );

  /**
   * 轮询外部视频平台任务（阿里云/火山等）。
   */
  const pollExternalVideoTask = useCallback(
    async (queueTaskId: string, itemId: string, videoTaskId: string, modelId?: string) => {
      const pid = projectId;
      if (!pid) {
        failVideo(itemId, '缺少项目ID', queueTaskId);
        return;
      }

      const { incrementPollCount } = useTaskQueueStore.getState();
      const maxAttempts = 120;
      const pollInterval = 5000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        incrementPollCount(queueTaskId);
        try {
          const statusRes = await workflowApi.queryVideoTaskStatusApi(pid, videoTaskId, modelId, pid);
          if (statusRes.success && statusRes.data?.videoUrl) {
            succeedVideo(itemId, statusRes.data.videoUrl, queueTaskId);
            return;
          }
          if (statusRes.data?.status === 'failed' || statusRes.data?.error) {
            failVideo(itemId, statusRes.data?.error?.message || '视频生成失败', queueTaskId);
            return;
          }
        } catch (pollErr: any) {
          if (pollErr?.message?.includes('失败')) {
            failVideo(itemId, pollErr.message, queueTaskId);
            return;
          }
          console.warn(`[pollExternalVideoTask] attempt ${attempt} error:`, pollErr?.message);
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      failVideo(itemId, '视频生成超时', queueTaskId);
    },
    [projectId, failVideo, succeedVideo]
  );

  /**
   * BFF 任务完成后转换为外部视频平台任务继续轮询。
   */
  const transitionToExternalAndPoll = useCallback(
    async (queueTaskId: string, itemId: string, videoTaskId: string, modelId?: string) => {
      setSegments((prev) => {
        const next = prev.map((s) =>
          s.id !== activeSegmentId
            ? s
            : {
                ...s,
                canvasItems: s.canvasItems.map((it) =>
                  it.id === itemId
                    ? {
                        ...it,
                        videoJobId: undefined,
                        videoTaskId,
                        isGeneratingVideo: true,
                        videoGenerationFailed: false,
                      }
                    : it
                ),
              }
        );
        persistInstantData(projectId, { instantSegments: next });
        return next;
      });

      // 同步更新任务元数据，方便任务抽屉重试时定位
      const state = useTaskQueueStore.getState();
      const task = state.tasks.find((t) => t.id === queueTaskId);
      if (task) {
        state.updateTask(queueTaskId, {
          metadata: { ...task.metadata, videoJobId: undefined, videoTaskId },
        });
      }

      await pollExternalVideoTask(queueTaskId, itemId, videoTaskId, modelId);
    },
    [activeSegmentId, projectId, setSegments, pollExternalVideoTask]
  );

  /**
   * 轮询 BFF 异步任务（pollJobStatus）。
   */
  const pollBffJob = useCallback(
    async (queueTaskId: string, itemId: string, jobId: string, modelId?: string) => {
      try {
        const { incrementPollCount } = useTaskQueueStore.getState();
        const pollResult = await workflowApi.pollJobStatus<{ videoUrl?: string; taskId?: string }>(
          jobId,
          {
            interval: 5000,
            maxWaitTime: 10 * 60 * 1000,
            onPoll: (_attempt, _state, queue) => {
            incrementPollCount(queueTaskId);
            if (queue) {
              const t = useTaskQueueStore.getState().tasks.find((x) => x.id === queueTaskId);
              useTaskQueueStore.getState().updateTask(queueTaskId, {
                metadata: { ...t?.metadata, queue },
              });
            }
          },
          }
        );

        if (!pollResult.success) {
          failVideo(itemId, pollResult.error || '视频生成失败', queueTaskId);
          return;
        }

        const resultData = pollResult.data as any;
        if (resultData?.videoUrl) {
          succeedVideo(itemId, resultData.videoUrl, queueTaskId);
        } else if (resultData?.taskId) {
          await transitionToExternalAndPoll(queueTaskId, itemId, resultData.taskId, modelId);
        } else {
          failVideo(itemId, resultData?.error || '未返回视频URL', queueTaskId);
        }
      } catch (err: any) {
        failVideo(itemId, err?.message || '轮询失败', queueTaskId);
      }
    },
    [failVideo, succeedVideo, transitionToExternalAndPoll]
  );

  const executeGenerateSceneVideo = useCallback(
    async (itemId: string, requestData: { mode: string; requestBody: any }) => {
      // 参考图直接使用图片自身 URL 提交，请求体不再做任何替换
      const { mode: effectiveMode, requestBody: effectiveBody } = requestData;

      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegmentId) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((it) =>
            it.id === itemId
              ? { ...it, isGeneratingVideo: true, videoGenerationFailed: false, videoGenerationError: undefined, videoTaskId: undefined, videoJobId: undefined }
              : it
          ),
        };
      });
      setSegments(nextSegments);
      persistInstantData(projectId, { instantSegments: nextSegments });

      // 视频模型并发限制检查
      const maxConcurrent = videoModels.find((m) => m.id === effectiveBody.model)?.concurrentLimit || 5;
      if (!canSubmitForVariant(effectiveBody.model, maxConcurrent)) {
        const modelConfig = videoModels.find((m) => m.id === effectiveBody.model);
        message.warning(`模型 ${modelConfig?.name || effectiveBody.model} 已达到最大并发数 ${maxConcurrent}，请等待任务完成后再试`);
        return;
      }

      const { addTask, updateTask, removeTask } = useTaskQueueStore.getState();
      const taskId = addTask({
        type: 'episode-video',
        name: '生成场景视频',
        status: 'running',
        prompt: effectiveBody.videoPrompt,
        modelVariant: effectiveBody.model,
        metadata: { subId: itemId, projectId },
      });

      try {
        let res: any;

        if (effectiveMode === 'first_last_frame') {
          res = await workflowApi.generateEpisodeVideoWithFramesApi(
            effectiveBody.episodeId,
            effectiveBody.videoPrompt,
            effectiveBody.firstFrameUrl,
            effectiveBody.lastFrameUrl,
            effectiveBody.model,
            effectiveBody.generateAudio,
            effectiveBody.ratio,
            effectiveBody.duration,
            { resolution: effectiveBody.resolution },
            true
          );
        } else {
          res = await workflowApi.generateEpisodeVideoWithReferencesApi(
            effectiveBody.episodeId,
            effectiveBody.videoPrompt,
            effectiveBody.referenceImageUrls,
            effectiveBody.model,
            effectiveBody.ratio,
            effectiveBody.duration,
            {
              referenceAudios: effectiveBody.referenceAudios,
              referenceAudioMap: effectiveBody.referenceAudioMap,
              resolution: effectiveBody.resolution,
            } as any,
            true
          );
        }

        if (!res.success) {
          const errMsg = (res as any)?.message || (res as any)?.error || '视频生成提交失败';
          failVideo(itemId, errMsg, taskId);
          return;
        }

        const jobData = res.data as any;
        console.log('[executeGenerateSceneVideo] API res:', res, 'jobData:', jobData);

        if (jobData?.jobId) {
          const jobId = jobData.jobId;
          console.log('[executeGenerateSceneVideo] polling jobId:', jobId);

          setSegments((prev) => {
            const next = prev.map((s) => {
              if (s.id !== activeSegmentId) return s;
              return {
                ...s,
                canvasItems: s.canvasItems.map((it) =>
                  it.id === itemId ? { ...it, videoJobId: jobId } : it
                ),
              };
            });
            persistInstantData(projectId, { instantSegments: next });
            return next;
          });

          const state = useTaskQueueStore.getState();
          const currentTask = state.tasks.find((t) => t.id === taskId);
          updateTask(taskId, {
            status: 'polling',
            metadata: { ...currentTask?.metadata, subId: itemId, projectId, videoJobId: jobId },
          });

          await pollBffJob(taskId, itemId, jobId, effectiveBody.model);
          return;
        }

        const syncVideoUrl = res.data?.videoUrl;
        if (syncVideoUrl) {
          console.log('[executeGenerateSceneVideo] videoUrl from sync:', syncVideoUrl);
          succeedVideo(itemId, syncVideoUrl, taskId);
        } else {
          failVideo(itemId, '未返回视频URL', taskId);
        }
      } catch (err: any) {
        failVideo(itemId, err?.message || '生成失败', taskId);
      } finally {
        const task = useTaskQueueStore.getState().tasks.find((t) => t.id === taskId);
        if (task && (task.status === 'running' || task.status === 'polling')) {
          removeTask(taskId);
        }
      }
    },
    [segments, activeSegmentId, projectId, videoModels, failVideo, succeedVideo, pollBffJob]
  );

  const handleGenerateSceneVideo = useCallback(
    async (itemId: string) => {
      const requestData = buildVideoRequest(itemId);
      if (!requestData) return;

      const finalRequestData = requestData;

      if (videoApiPreviewMode) {
        const { mode, requestBody } = finalRequestData;
        let previewPromise: Promise<any>;
        if (mode === 'first_last_frame') {
          previewPromise = workflowApi.generateEpisodeVideoWithFramesApi(
            requestBody.episodeId,
            requestBody.videoPrompt,
            requestBody.firstFrameUrl,
            requestBody.lastFrameUrl,
            requestBody.model,
            requestBody.generateAudio,
            requestBody.ratio,
            requestBody.duration,
            { preview: true } as any
          );
        } else {
          previewPromise = workflowApi.generateEpisodeVideoWithReferencesApi(
            requestBody.episodeId,
            requestBody.videoPrompt,
            requestBody.referenceImageUrls,
            requestBody.model,
            requestBody.ratio,
            requestBody.duration,
            { preview: true } as any
          );
        }
        showApiPreview('视频生成请求预览', previewPromise, finalRequestData, () =>
          executeGenerateSceneVideo(itemId, finalRequestData)
        );
      } else {
        await executeGenerateSceneVideo(itemId, finalRequestData);
      }
    },
    [buildVideoRequest, videoApiPreviewMode, showApiPreview, executeGenerateSceneVideo]
  );

  /**
   * 重试场景视频生成。严格按服务端任务真实状态分发，避免「失败」与「中断」混淆：
   * - 已判失败（state=failed）→ 清除旧任务 ID，走完整重新提交（重建请求体 + 预览）。
   *   反复轮询一个已 failed 的 job 只会拿到同一个失败结果，且不会重建请求体/触发预览。
   * - 中断仍在运行（waiting/active/delayed）→ 恢复轮询，避免重复提交导致重复扣费。
   * - 已完成 → 直接领取结果；若返回外部 taskId 则转外部任务继续轮询。
   * - 无可恢复任务 ID / 查询异常 → 兜底重新生成。
   */
  const handleRetrySceneVideo = useCallback(
    async (itemId: string) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item || item.isGeneratingVideo) return;

      const jobId = item.videoJobId;
      const taskId = item.videoTaskId;
      const modelId = item.videoModel || defaultVideoModel;

      // 既无 BFF job 也无外部 task：直接重新生成
      if (!jobId && !taskId) {
        await handleGenerateSceneVideo(itemId);
        return;
      }

      // 进入轮询态（清除失败标记，便于恢复轮询期间的 UI 表现）
      setSegments((prev) => {
        const next = prev.map((s) =>
          s.id !== activeSegmentId
            ? s
            : {
                ...s,
                canvasItems: s.canvasItems.map((it) =>
                  it.id === itemId
                    ? { ...it, isGeneratingVideo: true, videoGenerationFailed: false, videoGenerationError: undefined }
                    : it
                ),
              }
        );
        persistInstantData(projectId, { instantSegments: next });
        return next;
      });

      const { tasks, addTask, updateTask, removeTask } = useTaskQueueStore.getState();
      const existingTask = tasks.find(
        (t) => t.type === 'episode-video' && t.metadata?.subId === itemId && t.status === 'failed'
      );
      let queueTaskId: string;
      if (existingTask) {
        updateTask(existingTask.id, { status: 'polling', error: undefined });
        queueTaskId = existingTask.id;
      } else {
        queueTaskId = addTask({
          type: 'episode-video',
          name: '重试生成场景视频',
          status: 'polling',
          modelVariant: modelId,
          metadata: { subId: itemId, projectId },
        });
      }

      // 已判失败：清除旧任务 ID 并走完整重新提交（重建请求体 + 预览）
      const discardAndRegenerate = async (reason: string) => {
        console.log(`[handleRetrySceneVideo] 任务已失败(${reason})，清除旧 ID 并重新生成 itemId=${itemId}`);
        removeTask(queueTaskId);
        setSegments((prev) => {
          const next = prev.map((s) =>
            s.id !== activeSegmentId
              ? s
              : {
                  ...s,
                  canvasItems: s.canvasItems.map((it) =>
                    it.id === itemId
                      ? { ...it, videoJobId: undefined, videoTaskId: undefined }
                      : it
                  ),
                }
          );
          persistInstantData(projectId, { instantSegments: next });
          return next;
        });
        await handleGenerateSceneVideo(itemId);
      };

      try {
        if (jobId) {
          // 单次查询 BFF job 真实状态，严格区分 failed / interrupted
          const res = await workflowApi.getJobStatusApi(jobId);
          const job = res.data;
          if (!res.success || !job) {
            await discardAndRegenerate('状态查询失败');
            return;
          }
          if (job.state === 'completed') {
            const resultData = job.result?.success ? job.result.data : null;
            if (resultData?.videoUrl) {
              succeedVideo(itemId, resultData.videoUrl, queueTaskId);
              return;
            }
            if (resultData?.taskId) {
              await transitionToExternalAndPoll(queueTaskId, itemId, resultData.taskId, modelId);
              return;
            }
            await discardAndRegenerate('完成但无结果');
            return;
          }
          if (job.state === 'failed') {
            await discardAndRegenerate(job.failedReason || '任务失败');
            return;
          }
          // waiting/active/delayed：中断仍在运行 → 恢复轮询
          console.log(`[handleRetrySceneVideo] 任务仍在运行(state=${job.state})，恢复轮询 itemId=${itemId}`);
          await pollBffJob(queueTaskId, itemId, jobId, modelId);
          return;
        }

        // 外部平台任务
        if (taskId) {
          if (!projectId) {
            await discardAndRegenerate('缺少项目ID');
            return;
          }
          const statusRes = await workflowApi.queryVideoTaskStatusApi(projectId, taskId, modelId, projectId);
          if (statusRes.success && statusRes.data?.videoUrl) {
            succeedVideo(itemId, statusRes.data.videoUrl, queueTaskId);
            return;
          }
          if (statusRes.data?.status === 'failed' || statusRes.data?.error) {
            await discardAndRegenerate(statusRes.data?.error?.message || '外部任务失败');
            return;
          }
          // 仍在运行 → 恢复轮询
          console.log(`[handleRetrySceneVideo] 外部任务仍在运行，恢复轮询 itemId=${itemId}`);
          await pollExternalVideoTask(queueTaskId, itemId, taskId, modelId);
          return;
        }
      } catch (err: any) {
        console.warn('[handleRetrySceneVideo] 状态查询异常，降级重新生成:', err?.message);
        await discardAndRegenerate('查询异常');
      }
    },
    [canvasItems, activeSegmentId, projectId, defaultVideoModel, handleGenerateSceneVideo, pollBffJob, pollExternalVideoTask, succeedVideo, transitionToExternalAndPoll]
  );

  const handleVideoGenerationModeChange = useCallback(
    (itemId: string, mode: 'first_last_frame' | 'reference_image') => {
      if (!activeSegment) return;
      const item = activeSegment.canvasItems.find((i) => i.id === itemId);
      if (!item) return;

      const filteredModels = videoModels.filter((m) => {
        if (m.disabled) return false;
        if (mode === 'reference_image') {
          return m.supports?.reference_image === true;
        }
        return m.supports?.first_frame === true && m.supports?.last_frame === true;
      });

      const currentModelId = item.videoModel || defaultVideoModel;
      const needsSwitch = !filteredModels.some((m) => m.id === currentModelId);
      const newModelId = needsSwitch ? filteredModels.find((m) => !m.disabled)?.id : currentModelId;

      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((it) =>
            it.id === itemId
              ? {
                  ...it,
                  videoGenerationMode: mode,
                  ...(newModelId ? { videoModel: newModelId } : {}),
                }
              : it
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments, videoModels, defaultVideoModel]
  );

  return {
    buildVideoRequest,
    executeGenerateSceneVideo,
    handleGenerateSceneVideo,
    handleRetrySceneVideo,
    handleVideoGenerationModeChange,
  };
}
