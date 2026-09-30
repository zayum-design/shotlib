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
import type { InstantCharacter, InstantScene, CanvasItem } from '@/shared/types/project';
import type { ModelConfig } from '@/shared/types/index';
import {
  buildUniversalReferenceRequest,
  stripFirstLastFramePrompt,
} from '@/modules/instant/utils/instantVideoPromptUtils';

export function useInstantVideoRequestBuilder({
  canvasItems,
  projectId,
  scenes,
  defaultVideoModel,
  videoModels,
  characters,
  currentProjectAspectRatio,
}: {
  canvasItems: CanvasItem[];
  projectId: string | undefined;
  scenes: InstantScene[];
  defaultVideoModel: string;
  videoModels: ModelConfig[];
  characters: InstantCharacter[];
  currentProjectAspectRatio?: string;
}) {
  const buildVideoRequest = useCallback(
    (itemId: string): { mode: string; requestBody: any } | null => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item || !projectId) return null;
      const scene = scenes.find((s) => s.id === item.refId);
      if (!scene) return null;

      const prompt = item.customPrompt ?? item.generatedPrompt ?? scene.prompt ?? '';
      if (!prompt.trim()) {
        message.warning('提示词不能为空');
        return null;
      }

      const mode = item.videoGenerationMode || 'reference_image';
      const ratio = currentProjectAspectRatio || '16:9';

      let model = item.videoModel || defaultVideoModel;
      if (!model) {
        message.warning('请选择一个视频模型');
        return null;
      }
      let modelConfig = videoModels.find((m) => m.id === model);
      let modelName = modelConfig?.name || model;

      // 分镜总时长 30s 时校验视频模型的时长上限（model.json duration.max）
      const maxShotDuration = item.shotMaxDuration === 30 ? 30 : 15;
      if (maxShotDuration > 15 && (modelConfig?.duration?.max ?? 15) < maxShotDuration) {
        // 自动回退到第一个支持 30s 的模型（与卡片下拉框过滤逻辑一致）
        const fallback = videoModels.find((m) => !m.disabled && (m.duration?.max ?? 15) >= maxShotDuration);
        if (!fallback) {
          message.warning('30s 片段仅支持 seedance2.5 模型，请先在下方切换视频模型');
          return null;
        }
        model = fallback.id;
        modelConfig = fallback;
        modelName = fallback.name;
      }
      const supportsFirstLastFrame = modelConfig?.supports?.first_frame === true && modelConfig?.supports?.last_frame === true;
      const supportsReferenceImage = modelConfig?.supports?.reference_image === true;

      if (mode === 'first_last_frame') {
        if (!supportsFirstLastFrame) {
          message.warning(`当前模型「${modelName}」不支持首尾帧生成，请选择支持首尾帧的模型`);
          return null;
        }
      } else {
        if (!supportsReferenceImage) {
          message.warning(
            `当前模型「${modelName}」不支持全能参考生成。请切换至"首尾帧生成"标签页，或选择支持全能参考的模型`
          );
          return null;
        }
      }

      if (mode === 'first_last_frame') {
        if (!item.firstFrameImageUrl) {
          message.warning('请先生成首帧图片');
          return null;
        }
        const framePrompt = item.firstLastFrameVideoPrompt || prompt;
        const cleanPrompt = stripFirstLastFramePrompt(framePrompt);
        return {
          mode: 'first_last_frame',
          requestBody: {
            episodeId: projectId,
            videoPrompt: cleanPrompt,
            firstFrameUrl: item.firstFrameImageUrl,
            lastFrameUrl: item.lastFrameImageUrl,
            model,
            generateAudio: true,
            ratio,
            duration: item.videoDuration ?? 5,
            resolution: item.videoResolution || '720p',
          },
        };
      } else {
        if (!item.shots || item.shots.length === 0) {
          message.warning('请先生成分镜提示词');
          return null;
        }

        const shotPrompts = item.shots
          .map((shot, idx) => `【分镜${idx + 1}|${shot.duration}s】${shot.prompt}`)
          .join('\n');

        const refData = buildUniversalReferenceRequest({
          shots: item.shots,
          videoPrompt: shotPrompts,
          characters,
          scenes,
          model,
          videoModels,
        });

        if (refData.referenceImages.length === 0) {
          message.warning('分镜中未找到可用的参考图片，请先生成角色或场景图片');
          return null;
        }

        return {
          mode: 'reference_image',
          requestBody: {
            episodeId: projectId,
            videoPrompt: refData.processedPrompt,
            referenceImageUrls: refData.referenceImages,
            referenceAudios: refData.referenceAudios.length > 0 ? refData.referenceAudios : undefined,
            referenceAudioMap: Object.keys(refData.referenceAudioMap).length > 0 ? refData.referenceAudioMap : undefined,
            model: refData.referenceModel,
            ratio,
            duration: refData.totalDuration,
            resolution: item.videoResolution || '720p',
          },
        };
      }
    },
    [canvasItems, projectId, scenes, defaultVideoModel, videoModels, characters, currentProjectAspectRatio]
  );

  return {
    buildVideoRequest,
  };
}
