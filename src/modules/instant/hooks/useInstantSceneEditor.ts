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
import type { InstantScene, InstantSegment, InstantCharacter } from '@/shared/types/project';
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import { message } from '@/shared/utils/message';

interface UseInstantSceneEditorOptions {
  scenes: InstantScene[];
  setScenes: React.Dispatch<React.SetStateAction<InstantScene[]>>;
  saveScenes: (next: InstantScene[]) => void;
  selectedImageModel: string;
  projectId: string | undefined;
  segments: InstantSegment[];
  saveSegments: (nextSegments: InstantSegment[]) => void;
  characters: InstantCharacter[];
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  syncSegmentPromptImages: (chars: InstantCharacter[], scns: InstantScene[]) => void;
  currentProjectAspectRatio?: string;
}

export function useInstantSceneEditor({
  scenes,
  setScenes,
  saveScenes,
  selectedImageModel,
  projectId,
  segments,
  saveSegments,
  characters,
  videoApiPreviewMode,
  showApiPreview,
  syncSegmentPromptImages,
  currentProjectAspectRatio,
}: UseInstantSceneEditorOptions) {
  const [editSceneOpen, setEditSceneOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<InstantScene | null>(null);
  const [editSceneName, setEditSceneName] = useState('');
  const [editScenePrompt, setEditScenePrompt] = useState('');
  const [editSceneModel, setEditSceneModel] = useState('');
  const [editSceneConfirmLoading, setEditSceneConfirmLoading] = useState(false);

  const handleEditScene = useCallback(
    (scene: InstantScene) => {
      setEditingScene(scene);
      setEditSceneName(scene.name);
      setEditScenePrompt(scene.prompt);
      setEditSceneModel(scene.model || selectedImageModel);
      setEditSceneOpen(true);
    },
    [selectedImageModel]
  );

  const handleSaveEditScene = useCallback(() => {
    if (!editingScene) return;
    const model = editSceneModel || selectedImageModel;
    const next = scenes.map((s) =>
      s.id === editingScene.id
        ? {
            ...s,
            name: editSceneName.trim(),
            prompt: editScenePrompt.trim(),
            model,
          }
        : s
    );
    saveScenes(next);

    const updatedScene = next.find((s) => s.id === editingScene.id)!;
    setEditingScene(updatedScene);
    setEditSceneOpen(false);
  }, [editingScene, scenes, editSceneName, editScenePrompt, editSceneModel, saveScenes, selectedImageModel]);

  const handleGenerateEditSceneImage = useCallback(() => {
    if (!editingScene) return;
    const model = editSceneModel || selectedImageModel;
    const next = scenes.map((s) =>
      s.id === editingScene.id
        ? {
            ...s,
            name: editSceneName.trim(),
            prompt: editScenePrompt.trim(),
            model,
          }
        : s
    );
    saveScenes(next);

    const updatedScene = next.find((s) => s.id === editingScene.id)!;
    setEditingScene(updatedScene);

    const sceneDescription = [
      updatedScene.sceneType && `场景类型：${updatedScene.sceneType}`,
      updatedScene.timeOfDay && `时间：${updatedScene.timeOfDay}`,
      updatedScene.atmosphere && `氛围：${updatedScene.atmosphere}`,
      updatedScene.lighting && `光照：${updatedScene.lighting}`,
      updatedScene.weather && `天气：${updatedScene.weather}`,
    ]
      .filter(Boolean)
      .join('，');
    const rawPrompt = updatedScene.prompt ? `${updatedScene.prompt}，${sceneDescription}` : sceneDescription;
    const fullPrompt = rawPrompt
      ? `${rawPrompt}。纯场景空镜，画面中不要出现任何人物、动物、角色、生物、人脸、人体、手部、车辆等具体实体，仅展示环境、空间、建筑、自然背景与氛围。`
      : '';
    const aspectRatio = currentProjectAspectRatio || '16:9';

    const doGenerate = async () => {
      setEditSceneConfirmLoading(true);
      try {
        setScenes((prev) => prev.map((s) => (s.id === editingScene.id ? { ...s, isGenerating: true } : s)));
        const res = await workflowApi.generateSceneImageApi(fullPrompt, model, 1, undefined, aspectRatio);
        const rawImages = (res as any).images || (res as any).data?.images || [];
        const imageUrls = (Array.isArray(rawImages) ? rawImages : []).filter(
          (url: string) => typeof url === 'string' && url.trim().length > 0
        );
        if (imageUrls.length > 0) {
          setScenes((prev) => {
            const nextScenes = prev.map((s) =>
              s.id === editingScene.id ? { ...s, isGenerating: false, imageUrls, imageUrl: imageUrls[0] } : s
            );
            const refreshed = nextScenes.find((s) => s.id === editingScene.id);
            if (refreshed) setEditingScene(refreshed);
            persistInstantData(projectId, { instantScenes: nextScenes });
            syncSegmentPromptImages(characters, nextScenes);
            return nextScenes;
          });
          message.success('场景图片生成成功');
        } else {
          throw new Error('未返回有效图片');
        }
      } catch (err: any) {
        setScenes((prev) => {
          const nextScenes = prev.map((s) => (s.id === editingScene.id ? { ...s, isGenerating: false } : s));
          const refreshed = nextScenes.find((s) => s.id === editingScene.id);
          if (refreshed) setEditingScene(refreshed);
          persistInstantData(projectId, { instantScenes: nextScenes });
          return nextScenes;
        });
        message.error(err?.message || '场景图片生成失败');
      } finally {
        setEditSceneConfirmLoading(false);
      }
    };

    if (videoApiPreviewMode) {
      showApiPreview(
        '生成场景图片请求预览',
        workflowApi.generateSceneImageApi(fullPrompt, model, 1, undefined, aspectRatio, undefined, true, true),
        {
          endpoint: '/api/creator/image-processing/generate',
          body: { modelId: model, type: 'generation', data: { prompt: fullPrompt, numImages: 1 } },
        },
        doGenerate
      );
      return;
    }

    doGenerate();
  }, [
    editingScene,
    scenes,
    editSceneName,
    editScenePrompt,
    editSceneModel,
    saveScenes,
    selectedImageModel,
    currentProjectAspectRatio,
    projectId,
    videoApiPreviewMode,
    showApiPreview,
    characters,
    syncSegmentPromptImages,
  ]);

  const handleEditSceneModelChange = useCallback(
    (model: string) => {
      setEditSceneModel(model);
      if (editingScene) {
        const next = scenes.map((s) => (s.id === editingScene.id ? { ...s, model } : s));
        saveScenes(next);
      }
    },
    [editingScene, scenes, saveScenes]
  );

  const handleDeleteScene = useCallback(
    (scene: InstantScene) => {
      Modal.confirm({
        title: '⚠ 确认删除场景？',
        content: `确定要删除场景 "${scene.name}" 吗？\n\n该操作不可恢复，删除后场景图片以及所有引用此场景的片段都将被清理。`,
        okText: '确认删除',
        okButtonProps: { danger: true, size: 'middle' },
        cancelText: '取消',
        cancelButtonProps: { size: 'middle' },
        width: 420,
        centered: true,
        onOk: () => {
          const nextScenes = scenes.filter((s) => s.id !== scene.id);
          saveScenes(nextScenes);
          const nextSegments = segments.map((s) => ({
            ...s,
            canvasItems: (s.canvasItems || []).filter(
              (item) => !(item.type === 'scene' && item.refId === scene.id)
            ),
          }));
          saveSegments(nextSegments);
        },
      });
    },
    [scenes, segments, saveScenes, saveSegments]
  );

  return {
    editSceneOpen,
    setEditSceneOpen,
    editingScene,
    setEditingScene,
    editSceneName,
    setEditSceneName,
    editScenePrompt,
    setEditScenePrompt,
    editSceneModel,
    setEditSceneModel,
    editSceneConfirmLoading,
    setEditSceneConfirmLoading,
    handleEditScene,
    handleSaveEditScene,
    handleGenerateEditSceneImage,
    handleEditSceneModelChange,
    handleDeleteScene,
  };
}
