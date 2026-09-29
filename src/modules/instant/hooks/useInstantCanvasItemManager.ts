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
import type { InstantSegment, InstantScene, InstantCharacter, CanvasItem } from '@/shared/types/project';
import type { ModelConfig, ShotReferenceAsset } from '@/shared/types/index';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import type { EpisodePromptChangeItem } from '@/modules/workflow/api/scriptApi';
import { message } from '@/shared/utils/message';

const generateScenePrompt = (sceneName: string, charNames: string[]) => {
  if (charNames.length === 0) return '';
  return sceneName ? `${charNames.join('和')}在${sceneName}` : charNames.join('和');
};

interface UseInstantCanvasItemManagerOptions {
  activeSegment: InstantSegment | undefined;
  activeSegmentId: string | null;
  segments: InstantSegment[];
  saveSegments: (nextSegments: InstantSegment[]) => void;
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  scenes: InstantScene[];
  characters: InstantCharacter[];
  selectedSceneItemId: string | null;
  applySelectedScene: (id: string | null) => void;
  projectId: string | undefined;
  canvasItems: CanvasItem[];
  videoModels: ModelConfig[];
}

export function useInstantCanvasItemManager({
  activeSegment,
  activeSegmentId,
  segments,
  saveSegments,
  setSegments,
  scenes,
  characters,
  selectedSceneItemId,
  applySelectedScene,
  projectId,
  canvasItems,
  videoModels,
}: UseInstantCanvasItemManagerOptions) {
  // 编辑场次名称
  const [itemRenameModalOpen, setItemRenameModalOpen] = useState(false);
  const [itemRenameValue, setItemRenameValue] = useState('');
  const [itemRenameId, setItemRenameId] = useState<string | null>(null);

  // 编辑场景提示词
  const [editPromptOpen, setEditPromptOpen] = useState(false);
  const [editingSceneItem, setEditingSceneItem] = useState<{ itemId: string; prompt: string } | null>(null);

  const handleDeleteCanvasItem = useCallback(
    (itemId: string) => {
      if (!activeSegment) return;
      Modal.confirm({
        title: '确认删除？',
        content: '永久删除，不可恢复。',
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => {
          const sceneItems = activeSegment.canvasItems.filter((i) => i.type === 'scene');
          const deletedIndex = sceneItems.findIndex((i) => i.id === itemId);
          const next = segments.map((s) =>
            s.id === activeSegment.id
              ? { ...s, canvasItems: (s.canvasItems || []).filter((i) => i.id !== itemId) }
              : s
          );
          saveSegments(next);
          // 如果删除的是当前选中的场景，自动切换到下一个或上一个
          if (selectedSceneItemId === itemId) {
            const remaining = sceneItems.filter((i) => i.id !== itemId);
            if (remaining.length > 0) {
              const nextIndex = Math.min(deletedIndex, remaining.length - 1);
              applySelectedScene(remaining[nextIndex]?.id || null);
            } else {
              applySelectedScene(null);
            }
          }
        },
      });
    },
    [activeSegment, segments, saveSegments, selectedSceneItemId, applySelectedScene]
  );

  // 编辑场次名称
  const handleEditCanvasItemName = useCallback(
    (itemId: string, name: string) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, name: name.trim() || undefined } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  // 打开场次重命名弹窗
  const handleOpenItemRename = useCallback(
    (itemId: string) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item) return;
      const scene = scenes.find((s) => s.id === item.refId);
      setItemRenameId(itemId);
      setItemRenameValue(item.name || scene?.name || '');
      setItemRenameModalOpen(true);
    },
    [canvasItems, scenes]
  );

  // 保存场次重命名
  const handleSaveItemRename = useCallback(() => {
    if (!itemRenameId) return;
    handleEditCanvasItemName(itemRenameId, itemRenameValue);
    setItemRenameModalOpen(false);
    setItemRenameId(null);
    setItemRenameValue('');
  }, [itemRenameId, itemRenameValue, handleEditCanvasItemName]);

  // 切换场景卡片最小化/恢复
  const handleToggleMinimize = useCallback(
    (itemId: string) => {
      if (!activeSegment) return;
      const next = segments.map((s) =>
        s.id === activeSegment.id
          ? {
              ...s,
              canvasItems: s.canvasItems.map((i) =>
                i.id === itemId ? { ...i, isMinimized: !i.isMinimized } : i
              ),
            }
          : s
      );
      saveSegments(next);
    },
    [activeSegment, segments, saveSegments]
  );

  // 重新排序画布项
  const handleReorderCanvasItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      setSegments((prevSegments) => {
        const currentActiveSegment = prevSegments.find((s) => s.id === activeSegmentId) || prevSegments[0];
        if (!currentActiveSegment) return prevSegments;
        const sceneItems = currentActiveSegment.canvasItems.filter((i) => i.type === 'scene');
        if (fromIndex < 0 || fromIndex >= sceneItems.length || toIndex < 0 || toIndex >= sceneItems.length) return prevSegments;
        const itemToMove = sceneItems[fromIndex];
        const remainingItems = sceneItems.filter((_, i) => i !== fromIndex);
        const reorderedSceneItems = [
          ...remainingItems.slice(0, toIndex),
          itemToMove,
          ...remainingItems.slice(toIndex),
        ];
        // 将排序后的场景项替换回原来的位置，保持非场景项不变
        let sceneIdx = 0;
        const next = prevSegments.map((s) => {
          if (s.id !== currentActiveSegment.id) return s;
          return {
            ...s,
            canvasItems: s.canvasItems.map((item) => {
              if (item.type === 'scene') {
                return reorderedSceneItems[sceneIdx++];
              }
              return item;
            }),
          };
        });
        if (projectId) {
          persistInstantData(projectId, { instantSegments: next });
        }
        return next;
      });
    },
    [activeSegmentId, projectId]
  );

  // 添加场次到header
  const handleAddToHeader = useCallback(
    (itemId: string) => {
      setSegments((prevSegments) => {
        const currentActiveSegment = prevSegments.find((s) => s.id === activeSegmentId) || prevSegments[0];
        if (!currentActiveSegment) return prevSegments;

        const item = currentActiveSegment.canvasItems.find((i) => i.id === itemId);
        if (!item || item.type !== 'scene') return prevSegments;

        if (!item.videoUrl) {
          message.warning('生成视频才能拖入');
          return prevSegments;
        }

        // 如果已经在header中，不重复添加
        if (item.headerOrder !== undefined) {
          return prevSegments;
        }

        const headerItems = currentActiveSegment.canvasItems
          .filter((i) => i.type === 'scene' && i.headerOrder !== undefined)
          .sort((a, b) => (a.headerOrder || 0) - (b.headerOrder || 0));
        const maxOrder = headerItems.length > 0
          ? Math.max(...headerItems.map((i) => i.headerOrder || 0))
          : -1;

        const next = prevSegments.map((s) => {
          if (s.id !== currentActiveSegment.id) return s;
          return {
            ...s,
            canvasItems: s.canvasItems.map((i) =>
              i.id === itemId ? { ...i, headerOrder: maxOrder + 1 } : i
            ),
          };
        });

        if (projectId) {
          persistInstantData(projectId, { instantSegments: next });
        }
        return next;
      });
    },
    [activeSegmentId, projectId]
  );

  // 从header中移除场次
  const handleRemoveFromHeader = useCallback(
    (itemId: string) => {
      setSegments((prevSegments) => {
        const currentActiveSegment = prevSegments.find((s) => s.id === activeSegmentId) || prevSegments[0];
        if (!currentActiveSegment) return prevSegments;

        const next = prevSegments.map((s) => {
          if (s.id !== currentActiveSegment.id) return s;
          // 移除目标item的headerOrder，并重新排序剩余header items
          const updatedItems = s.canvasItems.map((i) =>
            i.id === itemId ? { ...i, headerOrder: undefined } : i
          );
          const headerItems = updatedItems
            .filter((i) => i.type === 'scene' && i.headerOrder !== undefined)
            .sort((a, b) => (a.headerOrder || 0) - (b.headerOrder || 0));
          // 重新分配连续的order
          headerItems.forEach((item, idx) => {
            const target = updatedItems.find((i) => i.id === item.id);
            if (target) {
              target.headerOrder = idx;
            }
          });
          return { ...s, canvasItems: updatedItems };
        });

        if (projectId) {
          persistInstantData(projectId, { instantSegments: next });
        }
        return next;
      });
    },
    [activeSegmentId, projectId]
  );

  // 重新排序header中的场次
  const handleReorderHeaderItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      setSegments((prevSegments) => {
        const currentActiveSegment = prevSegments.find((s) => s.id === activeSegmentId) || prevSegments[0];
        if (!currentActiveSegment) return prevSegments;

        const headerItems = currentActiveSegment.canvasItems
          .filter((i): i is CanvasItem & { type: 'scene' } => i.type === 'scene' && i.headerOrder !== undefined)
          .sort((a, b) => (a.headerOrder || 0) - (b.headerOrder || 0));

        if (fromIndex < 0 || fromIndex >= headerItems.length || toIndex < 0 || toIndex >= headerItems.length) {
          return prevSegments;
        }

        const itemToMove = headerItems[fromIndex];
        const remainingItems = headerItems.filter((_, i) => i !== fromIndex);
        const reorderedItems = [
          ...remainingItems.slice(0, toIndex),
          itemToMove,
          ...remainingItems.slice(toIndex),
        ];

        const next = prevSegments.map((s) => {
          if (s.id !== currentActiveSegment.id) return s;
          return {
            ...s,
            canvasItems: s.canvasItems.map((item) => {
              if (item.type === 'scene' && item.headerOrder !== undefined) {
                const newIndex = reorderedItems.findIndex((i) => i.id === item.id);
                if (newIndex !== -1) {
                  return { ...item, headerOrder: newIndex };
                }
              }
              return item;
            }),
          };
        });

        if (projectId) {
          persistInstantData(projectId, { instantSegments: next });
        }
        return next;
      });
    },
    [activeSegmentId, projectId]
  );

  const handleRemoveCharacterFromScene = useCallback(
    (sceneItemId: string, charRefId: string) => {
      if (!activeSegment) return;
      setSegments((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeSegment.id) return s;
          return {
            ...s,
            canvasItems: (s.canvasItems || []).map((item) => {
              if (item.id !== sceneItemId || item.type !== 'scene') return item;
              const nextChars = (item.characters || []).filter((id) => id !== charRefId);
              const scene = scenes.find((sc) => sc.id === item.refId);
              const charNames = nextChars
                .map((cid) => characters.find((c) => c.id === cid)?.name)
                .filter(Boolean) as string[];
              // 从 customPrompt 中移除被删除角色的标签
              let updatedCustomPrompt = item.customPrompt;
              if (updatedCustomPrompt) {
                const tagRegex = new RegExp(
                  `@<role\\s+character-id="${charRefId}"[^>]*>[^<]*(?:<img[^>]*>)?</role>`,
                  'g'
                );
                updatedCustomPrompt = updatedCustomPrompt.replace(tagRegex, '').replace(/\s+/g, ' ').trim();
              }

              return {
                ...item,
                characters: nextChars,
                generatedPrompt: charNames.length > 0 ? generateScenePrompt(scene?.name || '', charNames) : '',
                customPrompt: updatedCustomPrompt,
              };
            }),
          };
        });
        if (projectId) {
          persistInstantData(projectId, { instantSegments: next });
        }
        return next;
      });
    },
    [activeSegment, projectId, scenes, characters]
  );

  // 编辑场景提示词
  const handleEditScenePrompt = useCallback(
    (itemId: string) => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item) return;
      const prompt = item.customPrompt ?? item.generatedPrompt ?? '';
      setEditingSceneItem({ itemId, prompt });
      setEditPromptOpen(true);
    },
    [canvasItems]
  );

  const handleSaveScenePrompt = useCallback(() => {
    if (!editingSceneItem || !activeSegment) return;
    const nextSegments = segments.map((s) => {
      if (s.id !== activeSegment.id) return s;
      return {
        ...s,
        canvasItems: s.canvasItems.map((item) =>
          item.id === editingSceneItem.itemId ? { ...item, customPrompt: editingSceneItem.prompt } : item
        ),
      };
    });
    saveSegments(nextSegments);
    setEditPromptOpen(false);
    setEditingSceneItem(null);
  }, [editingSceneItem, activeSegment, segments, saveSegments]);

  // 直接修改场景提示词（无需弹窗）
  const handleScenePromptChange = useCallback(
    (itemId: string, value: string) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, customPrompt: value } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  // 修改场景描述提示词的参考附件（上传的图片/视频/音频）
  const handleSceneReferenceAssetsChange = useCallback(
    (itemId: string, assets: ShotReferenceAsset[]) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, referenceAssets: assets } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  // 应用校验修改确认后的提示词修改项（场次级字段 + 分镜字段，按 id 匹配）
  const handleApplyReviewChanges = useCallback(
    (itemId: string, items: EpisodePromptChangeItem[]) => {
      if (!activeSegment || !items.length) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) => {
            if (item.id !== itemId) return item;
            const next = { ...item };
            // 场次级字段：videoPrompt 对应 customPrompt（优先于 generatedPrompt 的展示字段）
            for (const u of items.filter((i) => !i.shotId)) {
              if (u.field === 'videoPrompt') next.customPrompt = u.newValue;
              else if (u.field === 'firstFramePrompt') next.firstFramePrompt = u.newValue;
              else if (u.field === 'lastFramePrompt') next.lastFramePrompt = u.newValue;
              else if (u.field === 'firstLastFrameVideoPrompt') next.firstLastFrameVideoPrompt = u.newValue;
            }
            // 分镜级字段
            const shotUpdates = items.filter((i) => i.shotId);
            if (shotUpdates.length && next.shots?.length) {
              next.shots = next.shots.map((shot) => {
                const updates = shotUpdates.filter((i) => i.shotId === shot.id);
                if (!updates.length) return shot;
                const nextShot = { ...shot };
                for (const u of updates) {
                  if (u.field === 'prompt') nextShot.prompt = u.newValue;
                  else if (u.field === 'referencePrompt') nextShot.referencePrompt = u.newValue;
                }
                return nextShot;
              });
            }
            return next;
          }),
        };
      });
      saveSegments(nextSegments);
      message.success(`已应用 ${items.length} 条提示词修改`);
    },
    [activeSegment, segments, saveSegments]
  );

  // 修改场景视频时长
  const handleVideoDurationChange = useCallback(
    (itemId: string, duration: number) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, videoDuration: duration } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  // 修改场景视频分辨率
  const handleVideoResolutionChange = useCallback(
    (itemId: string, resolution: '720p' | '1080p') => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, videoResolution: resolution } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  // 修改场景视频模型
  const handleSceneVideoModelChange = useCallback(
    (itemId: string, model: string) => {
      if (!activeSegment) return;
      const newModel = videoModels.find((m) => m.id === model);
      const newDurationConfig = newModel?.duration;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) => {
            if (item.id !== itemId) return item;
            let newVideoDuration = item.videoDuration ?? newDurationConfig?.default ?? 5;
            if (newDurationConfig) {
              // 如果当前时长不在新模型支持范围内，调整为默认值
              if (newVideoDuration === -1 && !newDurationConfig.allowAuto) {
                newVideoDuration = newDurationConfig.default;
              } else if (
                newVideoDuration !== -1 &&
                (newVideoDuration < newDurationConfig.min || newVideoDuration > newDurationConfig.max)
              ) {
                newVideoDuration = newDurationConfig.default;
              }
            }
            return { ...item, videoModel: model, videoDuration: newVideoDuration };
          }),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments, videoModels]
  );

  // 修改分镜生成文本模型
  const handleShotTextModelChange = useCallback(
    (itemId: string, model: string) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, shotTextModel: model } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  // 修改分镜总时长上限（15 或 30 秒；30 仅长片段模型如 seedance2.5 支持）
  const handleShotMaxDurationChange = useCallback(
    (itemId: string, seconds: number) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, shotMaxDuration: seconds === 30 ? 30 : 15 } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  const handleShotImageModelChange = useCallback(
    (itemId: string, model: string) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, shotImageModel: model } : item
          ),
        };
      });
      saveSegments(nextSegments);
    },
    [activeSegment, segments, saveSegments]
  );

  // 清除视频生成错误提示
  const handleDismissVideoError = useCallback(
    (itemId: string) => {
      if (!activeSegment) return;
      const nextSegments = segments.map((s) => {
        if (s.id !== activeSegment.id) return s;
        return {
          ...s,
          canvasItems: s.canvasItems.map((item) =>
            item.id === itemId ? { ...item, videoGenerationError: undefined } : item
          ),
        };
      });
      if (projectId) {
        persistInstantData(projectId, { instantSegments: nextSegments });
      }
      saveSegments(nextSegments);
    },
    [activeSegment, projectId, segments, saveSegments]
  );

  return {
    // States
    itemRenameModalOpen,
    setItemRenameModalOpen,
    itemRenameValue,
    setItemRenameValue,
    itemRenameId,
    setItemRenameId,
    editPromptOpen,
    setEditPromptOpen,
    editingSceneItem,
    setEditingSceneItem,
    // Handlers
    handleDeleteCanvasItem,
    handleEditCanvasItemName,
    handleOpenItemRename,
    handleSaveItemRename,
    handleToggleMinimize,
    handleReorderCanvasItem,
    handleAddToHeader,
    handleRemoveFromHeader,
    handleReorderHeaderItem,
    handleRemoveCharacterFromScene,
    handleEditScenePrompt,
    handleSaveScenePrompt,
    handleScenePromptChange,
    handleSceneReferenceAssetsChange,
    handleApplyReviewChanges,
    handleVideoDurationChange,
    handleVideoResolutionChange,
    handleSceneVideoModelChange,
    handleShotTextModelChange,
    handleShotMaxDurationChange,
    handleShotImageModelChange,
    handleDismissVideoError,
  };
}
