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

/**
 * workflowStore.model.ts — 模型管理 Slice
 *
 * 包含：loadModels
 */
import type { ModelConfig } from '@/shared/types/index';
import { TEXT_MODELS, IMAGE_MODELS, VIDEO_MODELS } from '@/shared/types/index';
import * as workflowApi from '../api/workflowApi';
import type { WorkflowState } from './workflowStore';

type SetFn = (partial: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>)) => void;
type GetFn = () => WorkflowState;

export interface ModelSliceActions {
  loadModels: () => Promise<void>;
}

export function createModelSlice(set: SetFn, get: GetFn): ModelSliceActions {
  return {
    loadModels: async () => {
      try {
        const response = await workflowApi.getModelsApi();
        console.log('[loadModels] API 响应:', response);
        if (response.success) {
          const models = response.data.models;
          console.log('[loadModels] 后端返回模型总数:', models.length, '模型列表:', models.map((m: workflowApi.ModelInfo) => `${m.id}(${m.name}, type=${m.type}, enabled=${m.enabled})`).join(', '));
          // 过滤启用的模型（enabled !== false）
          const enabledModels = models.filter((m: workflowApi.ModelInfo) => m.enabled !== false);
          const textModels = enabledModels.filter((m: workflowApi.ModelInfo) => m.type === 'text');
          const imageModels = enabledModels.filter((m: workflowApi.ModelInfo) => m.type === 'image');
          const videoModels = enabledModels.filter((m: workflowApi.ModelInfo) => m.type === 'video');
          const voiceModels = enabledModels.filter((m: workflowApi.ModelInfo) => m.type === 'voice');

          console.log('[loadModels] 过滤后 - text:', textModels.length, 'image:', imageModels.length, 'video:', videoModels.length, 'voice:', voiceModels.length);

          // 转换为 ModelConfig 格式
          const toModelConfig = (modelInfos: workflowApi.ModelInfo[]): ModelConfig[] =>
            modelInfos.map(m => ({
              id: m.id,
              name: m.name,
              type: m.type === 'text' ? 'script' : m.type,
              description: m.description || '',
              duration: m.duration,
              supports: m.supports,
              priceType: m.priceType,
              price: m.price,
              creditPrice: m.creditPrice,
              creditPrice1080p: m.creditPrice1080p,
              provider: m.provider,
              rpm: m.rpm,
              concurrentLimit: m.concurrentLimit,
              ipm: m.ipm,
              recommended: m.recommended,
            }));

          // 如果某个类型没有启用的模型，使用占位符模型
          const finalTextModels = textModels.length > 0 ? toModelConfig(textModels) : [TEXT_MODELS[0]];
          const finalImageModels = imageModels.length > 0 ? toModelConfig(imageModels) : [IMAGE_MODELS[0]];
          const finalVideoModels = videoModels.length > 0 ? toModelConfig(videoModels) : [VIDEO_MODELS[0]];
          const finalVoiceModels = voiceModels.length > 0 ? toModelConfig(voiceModels) : [];

          console.log('[loadModels] 最终设置 - imageModels:', finalImageModels.map(m => `${m.id}(${m.name})`).join(', '));

          // 获取当前选定的模型ID
          const currentState = get();
          // 兜底模型：推荐模型优先，否则列表第一个
          const getDefaultModelId = (modelList: ModelConfig[]) =>
            modelList.find((m) => m.recommended)?.id ??
            (modelList.length > 0 ? modelList[0].id : '');

          // 确定新的选定模型ID：当前ID在新列表中存在则保留（之前选中的优先），否则回退到推荐模型/第一个
          const newTextModel = finalTextModels.some(m => m.id === currentState.textModel)
            ? currentState.textModel
            : getDefaultModelId(finalTextModels);
          const newImageModel = finalImageModels.some(m => m.id === currentState.imageModel)
            ? currentState.imageModel
            : getDefaultModelId(finalImageModels);
          const newVideoModel = finalVideoModels.some(m => m.id === currentState.videoModel)
            ? currentState.videoModel
            : getDefaultModelId(finalVideoModels);
          const newVoiceModel = finalVoiceModels.some(m => m.id === currentState.voiceModel)
            ? currentState.voiceModel
            : getDefaultModelId(finalVoiceModels);

          set({
            textModels: finalTextModels,
            imageModels: finalImageModels,
            videoModels: finalVideoModels,
            voiceModels: finalVoiceModels,
            textModel: newTextModel,
            imageModel: newImageModel,
            videoModel: newVideoModel,
            voiceModel: newVoiceModel,
            // 场景图比例（后端 env 控制，null 表示回退到项目比例）
            sceneImageAspectRatio: response.data.sceneImageAspectRatio ?? null,
          });
        }
      } catch (error) {
        console.error('Failed to load models:', error);
        // 保持默认模型列表
      }
    },
  };
}
