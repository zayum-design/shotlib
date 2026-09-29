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
import type { InstantScene, InstantCharacter } from '@/shared/types/project';
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import { message } from '@/shared/utils/message';

export function useInstantSceneImageGeneration({
  projectId,
  scenes,
  setScenes,
  selectedImageModel,
  currentProjectAspectRatio,
  videoApiPreviewMode,
  showApiPreview,
  syncSegmentPromptImages,
  characters,
}: {
  projectId: string | undefined;
  scenes: InstantScene[];
  setScenes: React.Dispatch<React.SetStateAction<InstantScene[]>>;
  selectedImageModel: string;
  currentProjectAspectRatio?: string;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  syncSegmentPromptImages: (chars: InstantCharacter[], scns: InstantScene[]) => void;
  characters: InstantCharacter[];
}) {
  const executeGenerateScene = useCallback(
    async (scene: InstantScene, requestData: { fullPrompt: string; model: string; aspectRatio: string }) => {
      const { fullPrompt, model, aspectRatio } = requestData;
      try {
        setScenes((prev) => prev.map((s) => (s.id === scene.id ? { ...s, isGenerating: true } : s)));
        const res = await workflowApi.generateSceneImageApi(fullPrompt, model, 1, undefined, aspectRatio);
        console.log('[handleGenerateScene] API response:', res);
        const rawImages = (res as any).images || (res as any).data?.images || [];
        const imageUrls = (Array.isArray(rawImages) ? rawImages : []).filter(
          (url: string) => typeof url === 'string' && url.trim().length > 0
        );
        if (imageUrls.length > 0) {
          setScenes((prev) => {
            const next = prev.map((s) =>
              s.id === scene.id
                ? {
                    ...s,
                    isGenerating: false,
                    // 场景行 asset_key=sceneId，合规检查据此定位写入 data.seedance
                    assetId: scene.id,
                    imageUrls,
                    imageUrl: imageUrls[0],
                  }
                : s
            );
            persistInstantData(projectId, { instantScenes: next });
            syncSegmentPromptImages(characters, next);
            return next;
          });
          message.success('场景图片生成成功');
        } else {
          throw new Error('未返回有效图片');
        }
      } catch (err: any) {
        console.error('[handleGenerateScene] error:', err);
        setScenes((prev) => {
          const next = prev.map((s) => (s.id === scene.id ? { ...s, isGenerating: false } : s));
          persistInstantData(projectId, { instantScenes: next });
          return next;
        });
        message.error(err?.message || '场景图片生成失败');
      }
    },
    [projectId, characters, syncSegmentPromptImages]
  );

  const handleGenerateScene = useCallback(
    async (scene: InstantScene) => {
      const model = scene.model || selectedImageModel;
      const sceneDescription = [
        scene.sceneType && `场景类型：${scene.sceneType}`,
        scene.timeOfDay && `时间：${scene.timeOfDay}`,
        scene.atmosphere && `氛围：${scene.atmosphere}`,
        scene.lighting && `光照：${scene.lighting}`,
        scene.weather && `天气：${scene.weather}`,
      ]
        .filter(Boolean)
        .join('，');

      const rawPrompt = scene.prompt ? `${scene.prompt}，${sceneDescription}` : sceneDescription;
      const fullPrompt = rawPrompt
        ? `${rawPrompt}。纯场景空镜，画面中不要出现任何人物、动物、角色、生物、人脸、人体、手部、车辆等具体实体，仅展示环境、空间、建筑、自然背景与氛围。`
        : '';
      const aspectRatio = currentProjectAspectRatio || '16:9';
      const requestData = { fullPrompt, model, aspectRatio };

      if (videoApiPreviewMode) {
        showApiPreview(
          '场景图片生成请求预览',
          workflowApi.generateSceneImageApi(fullPrompt, model, 1, undefined, aspectRatio, undefined, true),
          requestData,
          () => executeGenerateScene(scene, requestData)
        );
        return;
      }

      await executeGenerateScene(scene, requestData);
    },
    [selectedImageModel, currentProjectAspectRatio, videoApiPreviewMode, showApiPreview, executeGenerateScene]
  );

  return {
    executeGenerateScene,
    handleGenerateScene,
  };
}
