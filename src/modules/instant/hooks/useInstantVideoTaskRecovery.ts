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
import { useEffect, useRef } from 'react';
import type { InstantSegment } from '@/shared/types/project';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import { message } from '@/shared/utils/message';

interface UseInstantVideoTaskRecoveryOptions {
  segments: InstantSegment[];
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  projectId: string | undefined;
  defaultVideoModel: string | undefined;
}

export function useInstantVideoTaskRecovery({
  segments,
  setSegments,
  projectId,
  defaultVideoModel,
}: UseInstantVideoTaskRecoveryOptions) {
  const resumedVideoTasksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pid = projectId;
    if (!pid) return;
    if (segments.length === 0) return;

    console.log('[resumeVideoTask] effect triggered, segments:', segments.length, 'pid:', pid);

    // 清理已不再 pending 的恢复标记(任务完成 / 用户重新发起生成)
    const activeTaskIds = new Set<string>();
    segments.forEach((seg) => {
      seg.canvasItems.forEach((item) => {
        if (item.videoTaskId && !item.videoUrl) {
          activeTaskIds.add(item.videoTaskId);
        }
        if (item.videoJobId && !item.videoUrl) {
          activeTaskIds.add(item.videoJobId);
        }
      });
    });
    console.log('[resumeVideoTask] active pending taskIds:', Array.from(activeTaskIds));
    console.log('[resumeVideoTask] resumed ref before cleanup:', Array.from(resumedVideoTasksRef.current));
    Array.from(resumedVideoTasksRef.current).forEach((taskId) => {
      if (!activeTaskIds.has(taskId)) {
        resumedVideoTasksRef.current.delete(taskId);
      }
    });

    // 恢复外部视频平台任务(videoTaskId)
    segments.forEach((seg) => {
      seg.canvasItems.forEach((item) => {
        const taskId = item.videoTaskId;
        console.log('[resumeVideoTask] checking item', item.id, 'taskId:', taskId, 'videoUrl:', item.videoUrl, 'isGeneratingVideo:', item.isGeneratingVideo);
        if (!taskId) return;
        if (item.videoUrl) return;
        // 已经失败的记录不自动恢复，留给用户手动重试
        if (item.videoGenerationFailed) return;
        // 已经在生成中(executeGenerateSceneVideo 内的 inline 轮询持有此任务)
        if (item.isGeneratingVideo) {
          console.log('[resumeVideoTask] skip item', item.id, 'because isGeneratingVideo is true');
          return;
        }
        if (resumedVideoTasksRef.current.has(taskId)) {
          console.log('[resumeVideoTask] skip item', item.id, 'because taskId already in ref');
          return;
        }

        console.log('[resumeVideoTask] resuming external polling for item', item.id, 'taskId:', taskId);
        resumedVideoTasksRef.current.add(taskId);

        const segmentId = seg.id;
        const itemId = item.id;
        const modelId = item.videoModel || defaultVideoModel || undefined;

        // 恢复 UI 生成中状态(仅内存,刷新后会再次进入此恢复流程)
        setSegments((prev) =>
          prev.map((s) =>
            s.id !== segmentId
              ? s
              : {
                  ...s,
                  canvasItems: s.canvasItems.map((it) =>
                    it.id === itemId
                      ? { ...it, isGeneratingVideo: true, videoGenerationFailed: false }
                      : it
                  ),
                }
          )
        );

        const { addTask, completeTask, failTask, incrementPollCount, removeTask } =
          useTaskQueueStore.getState();
        // 清理该 item 在队列里遗留的旧视频任务（刷新前中断的"继续生成场景视频"，
        // 以及被全局 recoverInterruptedTasks 恢复但无人轮询的"生成场景视频"僵尸），
        // 避免每次刷新都新增一条导致历史重复堆积：instant 页每个 item 同一时刻只保留 1 个任务
        useTaskQueueStore.getState().tasks
          .filter((t) => t.type === 'episode-video' && t.metadata?.subId === itemId)
          .forEach((t) => removeTask(t.id));
        const queueTaskId = addTask({
          type: 'episode-video',
          name: '继续生成场景视频',
          status: 'polling',
          modelVariant: modelId,
          metadata: { subId: itemId, projectId: pid, videoTaskId: taskId },
        });
        console.log('[resumeVideoTask] added external task to queue:', queueTaskId);

        let attempt = 0;
        const maxAttempts = 120;
        const pollInterval = 5000;

        const stillPending = () => resumedVideoTasksRef.current.has(taskId);

        const markFailed = (errMsg: string) => {
          console.warn('[resumeVideoTask] markFailed for', itemId, 'reason:', errMsg);
          resumedVideoTasksRef.current.delete(taskId);
          failTask(queueTaskId, errMsg);
          message.error(errMsg);
          setSegments((prev) => {
            const next = prev.map((s) =>
              s.id !== segmentId
                ? s
                : {
                    ...s,
                    canvasItems: s.canvasItems.map((it) =>
                      it.id === itemId && it.videoTaskId === taskId
                        ? {
                            ...it,
                            isGeneratingVideo: false,
                            videoGenerationFailed: true,
                            videoTaskId: undefined,
                          }
                        : it
                    ),
                  }
            );
            persistInstantData(pid, { instantSegments: next });
            return next;
          });
        };

        const markSucceeded = (videoUrl: string) => {
          console.log('[resumeVideoTask] markSucceeded for', itemId, 'videoUrl:', videoUrl);
          resumedVideoTasksRef.current.delete(taskId);
          message.success('视频生成成功');
          setSegments((prev) => {
            const next = prev.map((s) =>
              s.id !== segmentId
                ? s
                : {
                    ...s,
                    canvasItems: s.canvasItems.map((it) => {
                      if (it.id !== itemId || it.videoTaskId !== taskId) return it;
                      const existingUrls = it.videoUrls || [];
                      return {
                        ...it,
                        isGeneratingVideo: false,
                        videoGenerationFailed: false,
                        videoUrl,
                        videoUrls: [videoUrl, ...existingUrls],
                        currentVideoIndex: 0,
                        videoTaskId: undefined,
                      };
                    }),
                  }
            );
            persistInstantData(pid, { instantSegments: next });
            return next;
          });
          completeTask(queueTaskId);
        };

        const poll = async () => {
          if (!stillPending()) {
            console.log('[resumeVideoTask] poll aborted for', itemId, 'taskId:', taskId, 'no longer pending');
            return;
          }
          attempt++;
          incrementPollCount(queueTaskId);
          console.log('[resumeVideoTask] polling attempt', attempt, 'for', itemId, 'taskId:', taskId, 'modelId:', modelId);

          if (attempt > maxAttempts) {
            markFailed('视频生成超时');
            return;
          }

          try {
            const res = await workflowApi.queryVideoTaskStatusApi(pid, taskId, modelId, pid);
            console.log('[resumeVideoTask] query result for', itemId, ':', JSON.stringify({ success: res.success, status: res.data?.status, videoUrl: res.data?.videoUrl, error: res.data?.error }));
            if (!stillPending()) return;

            if (res.success && res.data?.videoUrl) {
              markSucceeded(res.data.videoUrl);
              return;
            }

            if (res.data?.status === 'failed' || res.data?.error) {
              markFailed(res.data?.error?.message || '视频生成失败');
              return;
            }
          } catch (err: any) {
            // 单次轮询异常忽略,继续重试
            console.warn(`[resumeVideoTask] attempt ${attempt} error:`, err?.message);
          }

          setTimeout(poll, pollInterval);
        };

        // 立即开始轮询
        poll();
      });
    });

    // 恢复 BFF 任务(videoJobId)
    segments.forEach((seg) => {
      seg.canvasItems.forEach((item) => {
        const jobId = item.videoJobId;
        if (!jobId) return;
        if (item.videoUrl) return;
        if (item.isGeneratingVideo) return;
        // 已经失败的记录不自动恢复，留给用户手动重试
        if (item.videoGenerationFailed) return;
        if (resumedVideoTasksRef.current.has(jobId)) return;

        console.log('[resumeVideoTask] resuming BFF job polling for item', item.id, 'jobId:', jobId);
        resumedVideoTasksRef.current.add(jobId);

        const segmentId = seg.id;
        const itemId = item.id;

        // 恢复 UI 生成中状态
        setSegments((prev) =>
          prev.map((s) =>
            s.id !== segmentId
              ? s
              : {
                  ...s,
                  canvasItems: s.canvasItems.map((it) =>
                    it.id === itemId
                      ? { ...it, isGeneratingVideo: true, videoGenerationFailed: false }
                      : it
                  ),
                }
          )
        );

        const modelId = item.videoModel || defaultVideoModel || undefined;
        const { addTask, completeTask, failTask, incrementPollCount, removeTask } =
          useTaskQueueStore.getState();
        // 清理该 item 遗留的旧视频任务（同 videoTaskId 分支），避免刷新后历史重复堆积
        useTaskQueueStore.getState().tasks
          .filter((t) => t.type === 'episode-video' && t.metadata?.subId === itemId)
          .forEach((t) => removeTask(t.id));
        const queueTaskId = addTask({
          type: 'episode-video',
          name: '继续生成场景视频',
          status: 'polling',
          modelVariant: modelId,
          metadata: { subId: itemId, projectId: pid, videoJobId: jobId },
        });
        console.log('[resumeVideoTask] added BFF task to queue:', queueTaskId);

        const stillPending = () => resumedVideoTasksRef.current.has(jobId);

        const markBffFailed = (errMsg: string) => {
          console.warn('[resumeVideoTask] BFF markFailed for', itemId, 'reason:', errMsg);
          resumedVideoTasksRef.current.delete(jobId);
          failTask(queueTaskId, errMsg);
          message.error(errMsg);
          setSegments((prev) => {
            const next = prev.map((s) =>
              s.id !== segmentId
                ? s
                : {
                    ...s,
                    canvasItems: s.canvasItems.map((it) =>
                      it.id === itemId && it.videoJobId === jobId
                        ? {
                            ...it,
                            isGeneratingVideo: false,
                            videoGenerationFailed: true,
                            videoJobId: undefined,
                          }
                        : it
                    ),
                  }
            );
            persistInstantData(pid, { instantSegments: next });
            return next;
          });
        };

        const markBffSucceeded = (videoUrl: string) => {
          console.log('[resumeVideoTask] BFF markSucceeded for', itemId, 'videoUrl:', videoUrl);
          resumedVideoTasksRef.current.delete(jobId);
          message.success('视频生成成功');
          setSegments((prev) => {
            const next = prev.map((s) =>
              s.id !== segmentId
                ? s
                : {
                    ...s,
                    canvasItems: s.canvasItems.map((it) => {
                      if (it.id !== itemId || it.videoJobId !== jobId) return it;
                      const existingUrls = it.videoUrls || [];
                      return {
                        ...it,
                        isGeneratingVideo: false,
                        videoGenerationFailed: false,
                        videoUrl,
                        videoUrls: [videoUrl, ...existingUrls],
                        currentVideoIndex: 0,
                        videoJobId: undefined,
                      };
                    }),
                  }
            );
            persistInstantData(pid, { instantSegments: next });
            return next;
          });
          completeTask(queueTaskId);
        };

        const transitionToExternal = (taskId: string) => {
          console.log('[resumeVideoTask] BFF job completed, transitioning to external task', taskId);
          resumedVideoTasksRef.current.delete(jobId);
          resumedVideoTasksRef.current.add(taskId);
          // 继续轮询外部任务(复用上面的逻辑)
          setSegments((prev) => {
            const next = prev.map((s) =>
              s.id !== segmentId
                ? s
                : {
                    ...s,
                    canvasItems: s.canvasItems.map((it) =>
                      it.id === itemId
                        ? { ...it, videoJobId: undefined, videoTaskId: taskId }
                        : it
                    ),
                  }
            );
            persistInstantData(pid, { instantSegments: next });
            return next;
          });
        };

        (async () => {
          let attempt = 0;
          const maxAttempts = 120;
          const pollInterval = 5000;

          while (stillPending()) {
            attempt++;
            incrementPollCount(queueTaskId);
            console.log('[resumeVideoTask] BFF polling attempt', attempt, 'for', itemId, 'jobId:', jobId);

            if (attempt > maxAttempts) {
              markBffFailed('视频生成超时');
              return;
            }

            try {
              const state = await workflowApi.pollJobStatus(jobId, {
                interval: pollInterval,
                maxWaitTime: 10 * 60 * 1000,
              });

              if (!stillPending()) {
                console.log('[resumeVideoTask] BFF poll aborted for', itemId, 'jobId:', jobId);
                return;
              }

              if (state.success) {
                const resultData = state.data as any;
                if (resultData?.videoUrl) {
                  markBffSucceeded(resultData.videoUrl);
                  return;
                }
                if (resultData?.taskId) {
                  transitionToExternal(resultData.taskId);
                  return;
                }
                markBffFailed(resultData?.error || '视频生成失败');
                return;
              } else {
                markBffFailed(state.error || '视频生成失败');
                return;
              }
            } catch (err: any) {
              console.error('[resumeVideoTask] BFF poll exception for', itemId, ':', err);
              if (stillPending()) {
                markBffFailed(err?.message || '视频生成失败');
              }
              return;
            }
          }
        })();
      });
    });
  }, [segments, projectId, defaultVideoModel]);
}
