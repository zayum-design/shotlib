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
import type { Shot } from '@/shared/types/index';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { useLoadingStore } from '@/shared/stores/useLoadingStore';
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import {
  stripPromptTags,
  wrapPromptWithTags,
  simplifyFramePrompt,
  denestPromptTags,
  convertPortraitAnnotations,
} from '@/modules/instant/utils/instantPromptUtils';
import { parseShotsFromText } from '@/modules/workflow/api/shotApi';
import { generateShotPrompt, parseFramePrompt } from '@/modules/instant/utils/instantPromptUtils';
import { message } from '@/shared/utils/message';

interface UseInstantShotManagerOptions {
  activeSegmentId: string | null;
  activeSegment: InstantSegment | undefined;
  segments: InstantSegment[];
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  saveSegments: (nextSegments: InstantSegment[]) => void;
  characters: InstantCharacter[];
  scenes: InstantScene[];
  projectId: string | undefined;
  canvasItems: CanvasItem[];
  selectedImageModel: string;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  defaultTextModel: string;
  currentProjectAspectRatio?: string;
}

export function useInstantShotManager({
  activeSegmentId,
  activeSegment,
  segments,
  setSegments,
  saveSegments,
  characters,
  scenes,
  projectId,
  canvasItems,
  selectedImageModel,
  videoApiPreviewMode,
  showApiPreview,
  defaultTextModel,
  currentProjectAspectRatio,
}: UseInstantShotManagerOptions) {
  const [shotModalOpen, setShotModalOpen] = useState(false);
  const [editingShotItemId, setEditingShotItemId] = useState<string | null>(null);
  const [editingShot, setEditingShot] = useState<Shot | null>(null);
  const [shotDuration, setShotDuration] = useState(3);
  const [shotMovements, setShotMovements] = useState<string[]>([]);
  const [shotType, setShotType] = useState('medium');
  const [shotAngle, setShotAngle] = useState('eye_level');
  const [shotLighting, setShotLighting] = useState('natural');
  const [shotMood, setShotMood] = useState('bright');
  const [shotPrompt, setShotPrompt] = useState('');

  // 真正执行分镜生成（异步任务队列）
  const executeGenerateShots = useCallback(
    async (
      itemId: string,
      requestData: {
        sceneName: string;
        prompt: string;
        characters: Array<{ id: string; name: string; description: string; avatarUrl?: string }>;
        model: string;
        maxDuration?: number;
      }
    ) => {
      const { sceneName, prompt, characters: sceneCharsReq, model, maxDuration } = requestData;
      const { addTask, completeTask, failTask, incrementPollCount } = useTaskQueueStore.getState();
      const taskId = addTask({ type: 'shot-generation', name: '生成分镜', status: 'running', prompt, modelVariant: model });

      // 全局 loading（与校验修改一致），整个生成/轮询期间展示
      const loading = useLoadingStore.getState();
      loading.show({ title: '正在生成分镜...', description: '请稍候，这可能需要一分钟左右' });

      // 统一提示词处理链：剥离标签 -> 形象照标注转 @<portrait> 标签 -> 角色/场景名包标签
      const stripAndConvert = (raw: string) =>
        convertPortraitAnnotations(stripPromptTags(raw || ''), characters);

      try {
        const res = await workflowApi.generateSceneShotsApi(sceneName, prompt, sceneCharsReq, model, undefined, true, maxDuration);
        const jobData = res.data as any;

        if (jobData?.jobId) {
          // 异步模式：轮询任务状态
          const jobId = jobData.jobId;
          const pollResult = await workflowApi.pollJobStatus<{ text?: string }>(jobId, {
            onPoll: () => {
              incrementPollCount(taskId);
              const task = useTaskQueueStore.getState().tasks.find((t) => t.id === taskId);
              if (task?.status === 'cancelled') {
                throw new Error('用户取消');
              }
            },
          });

          if (!pollResult.success) {
            failTask(taskId, pollResult.error || '执行失败');
            setSegments((prev) => {
              const next = prev.map((s) => {
                if (s.id !== activeSegmentId) return s;
                return {
                  ...s,
                  canvasItems: s.canvasItems.map((it) =>
                    it.id === itemId ? { ...it, isGeneratingShots: false } : it
                  ),
                };
              });
              persistInstantData(projectId, { instantSegments: next });
              return next;
            });
            return;
          }

          const text = pollResult.data?.text || '';
          const parsedData = parseShotsFromText(text);

          if (parsedData.shots && parsedData.shots.length > 0) {
            message.success(`已生成 ${parsedData.shots.length} 个分镜及提示词`);
            console.log('[executeGenerateShots] characters:', characters.map(c => ({ id: c.id, name: c.name, avatar: c.avatar })));
            console.log('[executeGenerateShots] scenes:', scenes.map(s => ({ id: s.id, name: s.name })));
            setSegments((prev) => {
              const next = prev.map((s) => {
                if (s.id !== activeSegmentId) return s;
                return {
                  ...s,
                  canvasItems: s.canvasItems.map((it) =>
                    it.id === itemId
                      ? {
                          ...it,
                          shots: parsedData.shots.map((shot: any) => {
                            const converted = stripAndConvert(shot.prompt || '');
                            const wrapped = wrapPromptWithTags(converted, characters, scenes);
                            console.log('[executeGenerateShots] shot prompt:', { raw: shot.prompt, stripped: converted, wrapped });
                            return { ...shot, prompt: wrapped };
                          }),
                          isGeneratingShots: false,
                          firstFramePrompt:
                            wrapPromptWithTags(simplifyFramePrompt(stripAndConvert(parsedData.firstFramePrompt || '')), characters, scenes) ||
                            it.firstFramePrompt,
                          lastFramePrompt:
                            wrapPromptWithTags(simplifyFramePrompt(stripAndConvert(parsedData.lastFramePrompt || '')), characters, scenes) ||
                            it.lastFramePrompt,
                          firstLastFrameVideoPrompt:
                            wrapPromptWithTags(stripAndConvert(parsedData.firstLastFrameVideoPrompt || ''), characters, scenes) ||
                            it.firstLastFrameVideoPrompt,
                        }
                      : it
                  ),
                };
              });
              persistInstantData(projectId, { instantSegments: next });
              return next;
            });
            completeTask(taskId, { text: `生成了 ${parsedData.shots.length} 个分镜` });
          } else {
            throw new Error('生成分镜失败，未返回数据');
          }
        } else {
          // 同步回退（Redis 未启用时）
          const data = res.data as any;
          if (data?.shots && data.shots.length > 0) {
            message.success(`已生成 ${data.shots.length} 个分镜及提示词`);
            setSegments((prev) => {
              const next = prev.map((s) => {
                if (s.id !== activeSegmentId) return s;
                return {
                  ...s,
                  canvasItems: s.canvasItems.map((it) =>
                    it.id === itemId
                      ? {
                          ...it,
                          shots: data.shots.map((shot: any) => {
                            const converted = stripAndConvert(shot.prompt || '');
                            const wrapped = wrapPromptWithTags(converted, characters, scenes);
                            return { ...shot, prompt: wrapped };
                          }),
                          isGeneratingShots: false,
                          firstFramePrompt:
                            wrapPromptWithTags(simplifyFramePrompt(stripAndConvert(data.firstFramePrompt || '')), characters, scenes) ||
                            it.firstFramePrompt,
                          lastFramePrompt:
                            wrapPromptWithTags(simplifyFramePrompt(stripAndConvert(data.lastFramePrompt || '')), characters, scenes) ||
                            it.lastFramePrompt,
                          firstLastFrameVideoPrompt:
                            wrapPromptWithTags(stripAndConvert(data.firstLastFrameVideoPrompt || ''), characters, scenes) ||
                            it.firstLastFrameVideoPrompt,
                        }
                      : it
                  ),
                };
              });
              persistInstantData(projectId, { instantSegments: next });
              return next;
            });
            completeTask(taskId, { text: `生成了 ${data.shots.length} 个分镜` });
          } else {
            throw new Error('生成分镜失败，未返回数据');
          }
        }
      } catch (err: any) {
        failTask(taskId, err?.message || '生成分镜失败');
        message.error(err?.message || '生成分镜失败');
        setSegments((prev) => {
          const next = prev.map((s) => {
            if (s.id !== activeSegmentId) return s;
            return {
              ...s,
              canvasItems: s.canvasItems.map((it) =>
                it.id === itemId ? { ...it, isGeneratingShots: false } : it
              ),
            };
          });
          persistInstantData(projectId, { instantSegments: next });
          return next;
        });
      } finally {
        loading.hide();
      }
    },
    [activeSegmentId, characters, scenes, projectId]
  );


  // 生成分镜（AI 自动生成）
  const handleGenerateShots = useCallback(
    async (itemId: string) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item || !(projectId)) return;
      const scene = scenes.find((s) => s.id === item.refId);
      if (!scene) return;

      const sceneChars = (item.characters || [])
        .map((cid) => characters.find((c) => c.id === cid))
        .filter(Boolean) as InstantCharacter[];

      if (sceneChars.length === 0) {
        message.warning('请先在左侧为场景添加人物');
        return;
      }

      const prompt = item.customPrompt ?? item.generatedPrompt ?? scene.prompt ?? '';
      if (!prompt.trim()) {
        message.warning('请先设置场景提示词');
        return;
      }

      // 标记生成分镜中
      setSegments((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeSegmentId) return s;
          return {
            ...s,
            canvasItems: s.canvasItems.map((it) =>
              it.id === itemId ? { ...it, isGeneratingShots: true } : it
            ),
          };
        });
        persistInstantData(projectId, { instantSegments: next });
        return next;
      });

      const requestData = {
        sceneName: scene.name,
        prompt,
        characters: sceneChars.map((c) => {
          // 角色有形象照时附加清单，AI 据此标注形象照并省略服装描述
          // （模板规则 5/13：装束由形象照参考图承载，文字描述会与参考图冲突）
          const portraitNames = (c.portraitImages || [])
            .filter((img) => img?.name && img?.imageUrl)
            .map((img) => img.name);
          const portraitInfo = portraitNames.length > 0
            ? `\n可用形象照: ${portraitNames.join('、')}`
            : '';
          return {
            id: c.id,
            name: c.name,
            description: `${c.gender}，${c.appearance}，${c.personality}`.replace(/，$/, '') + portraitInfo,
            avatarUrl: c.avatar || c.avatarImages?.[0]?.imageUrl,
          };
        }),
        model: item.shotTextModel || defaultTextModel,
        // 分镜总时长上限：15 或 30（30 仅长片段模型如 seedance2.5 支持）
        maxDuration: item.shotMaxDuration === 30 ? 30 : 15,
      };

      if (videoApiPreviewMode) {
        showApiPreview(
          '分镜生成请求预览',
          workflowApi.generateSceneShotsApi(scene.name, prompt, requestData.characters, requestData.model, true, undefined, requestData.maxDuration),
          requestData,
          () => executeGenerateShots(itemId, requestData)
        );
        return;
      }

      await executeGenerateShots(itemId, requestData);
    },
    [canvasItems, projectId, scenes, characters, activeSegmentId, videoApiPreviewMode, showApiPreview, executeGenerateShots]
  );


  // 打开分镜编辑弹窗
  const openShotModal = useCallback(
    (itemId: string, shot?: Shot) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item) return;
      const existingShots = item.shots || [];
      const totalDuration = existingShots.reduce((sum, s) => sum + s.duration, 0);

      setEditingShotItemId(itemId);
      if (shot) {
        // 编辑模式
        setEditingShot(shot);
        setShotDuration(shot.duration);
        setShotMovements(shot.cameraMovements);
        setShotType(shot.shotType);
        setShotAngle(shot.cameraAngle);
        setShotLighting(shot.lighting);
        setShotMood(shot.mood);
        setShotPrompt(shot.prompt);
      } else {
        // 新增模式（时长上限跟随该场景卡片的 15s/30s 选择）
        const maxTotal = item.shotMaxDuration === 30 ? 30 : 15;
        if (totalDuration >= maxTotal) {
          message.warning(`总时长已达到${maxTotal}秒，无法再添加分镜`);
          return;
        }
        setEditingShot(null);
        setShotDuration(Math.min(maxTotal - totalDuration, 5));
        setShotMovements([]);
        setShotType('medium');
        setShotAngle('eye_level');
        setShotLighting('natural');
        setShotMood('bright');
        setShotPrompt('');
      }
      setShotModalOpen(true);
    },
    [canvasItems]
  );


  // 保存分镜
  const handleSaveShot = useCallback(() => {
    if (!editingShotItemId || !activeSegment) return;
    const item = canvasItems.find((i) => i.id === editingShotItemId);
    if (!item) return;

    if (!shotPrompt.trim()) {
      message.warning('请输入分镜提示词');
      return;
    }

    const newShot: Shot = {
      id: editingShot?.id || crypto.randomUUID(),
      duration: shotDuration,
      cameraMovements: shotMovements as any[],
      shotType: shotType as any,
      cameraAngle: shotAngle as any,
      lighting: shotLighting as any,
      mood: shotMood as any,
      prompt: denestPromptTags(shotPrompt),
    };

    const existingShots = item.shots || [];
    let updatedShots: Shot[];
    if (editingShot) {
      updatedShots = existingShots.map((s) => (s.id === editingShot.id ? newShot : s));
    } else {
      updatedShots = [...existingShots, newShot];
    }

    // 更新 segments
    const nextSegments = segments.map((s) => {
      if (s.id !== activeSegment.id) return s;
      return {
        ...s,
        canvasItems: s.canvasItems.map((it) =>
          it.id === editingShotItemId ? { ...it, shots: updatedShots } : it
        ),
      };
    });
    saveSegments(nextSegments);
    setShotModalOpen(false);
    message.success(editingShot ? '分镜已更新' : '分镜已添加');
  }, [
    editingShotItemId,
    activeSegment,
    canvasItems,
    shotPrompt,
    shotDuration,
    shotMovements,
    shotType,
    shotAngle,
    shotLighting,
    shotMood,
    editingShot,
    segments,
    saveSegments,
  ]);


  // 删除分镜
  const handleDeleteShot = useCallback(
    (itemId: string, shotId: string) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item) return;
      const updatedShots = (item.shots || []).filter((s) => s.id !== shotId);

      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegmentId) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((it) =>
            it.id === itemId ? { ...it, shots: updatedShots } : it
          ),
        };
      });
      saveSegments(nextSegments);
      message.success('分镜已删除');
    },
    [canvasItems, activeSegmentId, segments, saveSegments]
  );


  // 生成分镜参考图
  const handleGenerateShotReferenceImage = useCallback(
    async (itemId: string, shotIndex: number) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item) return;
      const shot = item.shots?.[shotIndex];
      if (!shot) return;

      const fullPrompt = generateShotPrompt(shot);
      if (!fullPrompt.trim()) {
        message.warning('分镜提示词为空，无法生成参考图');
        return;
      }

      // 解析提示词中的角色/场景标签，提取参考图片并清理提示词
      const { prompt: cleanPrompt } = parseFramePrompt(fullPrompt, scenes, characters);
      const aspectRatio = currentProjectAspectRatio || '16:9';
      const model = item.shotImageModel || selectedImageModel;

      const doGenerate = async () => {
        // 标记指定分镜正在生成参考图（使用函数式更新避免并发覆盖）
        setSegments((prevSegments) => {
          const nextSegments = prevSegments.map((s) => {
            if (s.id !== activeSegmentId) return s;
            return {
              ...s,
              canvasItems: s.canvasItems.map((it) => {
                if (it.id !== itemId) return it;
                const updatedShots = it.shots ? [...it.shots] : [];
                if (updatedShots[shotIndex]) {
                  updatedShots[shotIndex] = { ...updatedShots[shotIndex], isGeneratingReferenceImage: true };
                }
                return { ...it, shots: updatedShots };
              }),
            };
          });
          const pid = projectId;
          if (pid) {
            persistInstantData(pid, { instantSegments: nextSegments });
          }
          return nextSegments;
        });

        const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
        const taskId = addTask({ type: 'shot-reference', name: `生成分镜参考图: 分镜${shotIndex + 1}`, status: 'running', prompt: cleanPrompt, modelVariant: model });

        try {
          const res = await workflowApi.generateSceneImageApi(cleanPrompt, model, 1, undefined, aspectRatio, undefined, undefined, true);

          if (!res.success) {
            failTask(taskId, '提交失败');
            setSegments((prevSegments) => {
              const nextSegments = prevSegments.map((s) => {
                if (s.id !== activeSegmentId) return s;
                return {
                  ...s,
                  canvasItems: s.canvasItems.map((it) => {
                    if (it.id !== itemId) return it;
                    const updatedShots = it.shots ? [...it.shots] : [];
                    if (updatedShots[shotIndex]) {
                      updatedShots[shotIndex] = { ...updatedShots[shotIndex], isGeneratingReferenceImage: false };
                    }
                    return { ...it, shots: updatedShots };
                  }),
                };
              });
              const pid = projectId;
              if (pid) {
                persistInstantData(pid, { instantSegments: nextSegments });
              }
              return nextSegments;
            });
            return;
          }

          const jobData = res.data as any;
          let imageUrl: string | undefined;

          if (jobData?.jobId) {
            const jobId = jobData.jobId;
            const pollResult = await workflowApi.pollJobStatus<{ images?: string[]; imageUrl?: string }>(jobId, {
              interval: 3000,
              maxWaitTime: 5 * 60 * 1000,
              onPoll: () => incrementPollCount(taskId),
            });

            if (!pollResult.success) {
              failTask(taskId, pollResult.error || '执行失败');
              setSegments((prevSegments) => {
                const nextSegments = prevSegments.map((s) => {
                  if (s.id !== activeSegmentId) return s;
                  return {
                    ...s,
                    canvasItems: s.canvasItems.map((it) => {
                      if (it.id !== itemId) return it;
                      const updatedShots = it.shots ? [...it.shots] : [];
                      if (updatedShots[shotIndex]) {
                        updatedShots[shotIndex] = { ...updatedShots[shotIndex], isGeneratingReferenceImage: false };
                      }
                      return { ...it, shots: updatedShots };
                    }),
                  };
                });
                const pid = projectId;
                if (pid) {
                  persistInstantData(pid, { instantSegments: nextSegments });
                }
                return nextSegments;
              });
              return;
            }

            imageUrl = pollResult.data?.imageUrl || pollResult.data?.images?.[0];
          } else {
            imageUrl = (res.data as any)?.imageUrl || (res.data as any)?.images?.[0];
          }

          if (imageUrl) {
            setSegments((prevSegments) => {
              const nextSegments = prevSegments.map((s) => {
                if (s.id !== activeSegmentId) return s;
                return {
                  ...s,
                  canvasItems: s.canvasItems.map((it) => {
                    if (it.id !== itemId) return it;
                    const updatedShots = it.shots ? [...it.shots] : [];
                    if (updatedShots[shotIndex]) {
                      updatedShots[shotIndex] = {
                        ...updatedShots[shotIndex],
                        isGeneratingReferenceImage: false,
                        referenceImageUrl: imageUrl,
                      };
                    }
                    return { ...it, shots: updatedShots };
                  }),
                };
              });
              const pid = projectId;
              if (pid) {
                persistInstantData(pid, { instantSegments: nextSegments });
              }
              return nextSegments;
            });
            message.success('分镜参考图生成完成');
            completeTask(taskId, { imageUrl });
          } else {
            throw new Error('未返回有效图片');
          }
        } catch (err: any) {
          failTask(taskId, err?.message || '生成失败');
          setSegments((prevSegments) => {
            const nextSegments = prevSegments.map((s) => {
              if (s.id !== activeSegmentId) return s;
              return {
                ...s,
                canvasItems: s.canvasItems.map((it) => {
                  if (it.id !== itemId) return it;
                  const updatedShots = it.shots ? [...it.shots] : [];
                  if (updatedShots[shotIndex]) {
                    updatedShots[shotIndex] = { ...updatedShots[shotIndex], isGeneratingReferenceImage: false };
                  }
                  return { ...it, shots: updatedShots };
                }),
              };
            });
            const pid = projectId;
            if (pid) {
              persistInstantData(pid, { instantSegments: nextSegments });
            }
            return nextSegments;
          });
          message.error(err?.message || '分镜参考图生成失败');
        } finally {
          const task = useTaskQueueStore.getState().tasks.find((t) => t.id === taskId);
          if (task && (task.status === 'running' || task.status === 'polling')) {
            removeTask(taskId);
          }
        }
      };

      if (videoApiPreviewMode) {
        showApiPreview(
          '生成分镜参考图请求预览',
          workflowApi.generateSceneImageApi(cleanPrompt, model, 1, undefined, aspectRatio, undefined, true, true),
          {
            endpoint: '/api/creator/image-processing/generate',
            body: { modelId: model, type: 'generation', data: { prompt: cleanPrompt, numImages: 1 } },
          },
          doGenerate
        );
        return;
      }

      await doGenerate();
    },
    [canvasItems, activeSegmentId, scenes, characters, currentProjectAspectRatio || '16:9', projectId, selectedImageModel, videoApiPreviewMode, showApiPreview]
  );


  // 批量生成分镜参考图（跳过已有参考图或正在生成的）
  const handleBatchGenerateShotReferenceImages = useCallback(
    async (itemId: string) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item || !item.shots || item.shots.length === 0) {
        message.info('暂无分镜');
        return;
      }
      const targets = item.shots
        .map((shot, index) => ({ shot, index }))
        .filter(({ shot }) => !shot.referenceImageUrl && !shot.isGeneratingReferenceImage);
      if (targets.length === 0) {
        message.info('所有分镜已有参考图或正在生成中');
        return;
      }
      message.info(`开始批量生成 ${targets.length} 个分镜的参考图`);
      for (const { index } of targets) {
        await handleGenerateShotReferenceImage(itemId, index);
      }
    },
    [canvasItems, handleGenerateShotReferenceImage]
  );


  return {
    shotModalOpen,
    setShotModalOpen,
    editingShotItemId,
    setEditingShotItemId,
    editingShot,
    setEditingShot,
    shotDuration,
    setShotDuration,
    shotMovements,
    setShotMovements,
    shotType,
    setShotType,
    shotAngle,
    setShotAngle,
    shotLighting,
    setShotLighting,
    shotMood,
    setShotMood,
    shotPrompt,
    setShotPrompt,
    // 当前编辑分镜所在场景卡片的总时长上限（15/30），供分镜编辑弹窗的时长上限使用
    editingShotMaxDuration: (() => {
      const item = canvasItems.find((i) => i.id === editingShotItemId);
      return item?.shotMaxDuration === 30 ? 30 : 15;
    })(),
    handleGenerateShots,
    openShotModal,
    handleSaveShot,
    handleDeleteShot,
    handleGenerateShotReferenceImage,
    handleBatchGenerateShotReferenceImages,
  };
}
