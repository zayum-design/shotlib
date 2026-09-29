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

import { useState, useEffect } from 'react';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { IMAGE_MODELS } from '@/shared/types/index';

export function useInstantModelSelection() {
  // 图像模型
  const workflowImageModels = useWorkflowStore((state) => state.imageModels);
  const loadWorkflowModels = useWorkflowStore((state) => state.loadModels);
  const imageModels = workflowImageModels.length > 0 ? workflowImageModels : IMAGE_MODELS;
  const [selectedImageModel, setSelectedImageModel] = useState<string>(() => imageModels[0]?.id || 'SDXL');

  // 视频模型
  const workflowVideoModels = useWorkflowStore((state) => state.videoModels);
  const loadWorkflowVideoModels = useWorkflowStore((state) => state.loadModels);
  const videoModels = workflowVideoModels;
  const defaultVideoModel = videoModels.find((m) => !m.disabled)?.id || '';

  // 文本模型（分镜生成用）
  const workflowTextModels = useWorkflowStore((state) => state.textModels);
  const workflowTextModel = useWorkflowStore((state) => state.textModel);
  const textModels = workflowTextModels;

  // 过滤掉 disabled/占位符模型，确保 defaultTextModel 始终有效
  const defaultTextModel = textModels.find((m) => m.id === workflowTextModel && !m.disabled)?.id
    || textModels.find((m) => !m.disabled)?.id
    || 'deepseek';

  useEffect(() => {
    loadWorkflowVideoModels();
  }, [loadWorkflowVideoModels]);

  useEffect(() => {
    loadWorkflowModels();
  }, [loadWorkflowModels]);

  useEffect(() => {
    const validIds = imageModels.map((m) => m.id);
    if (validIds.length > 0 && !validIds.includes(selectedImageModel)) {
      setSelectedImageModel(validIds[0]);
    }
  }, [imageModels, selectedImageModel]);

  return {
    imageModels,
    selectedImageModel,
    setSelectedImageModel,
    videoModels,
    defaultVideoModel,
    textModels,
    defaultTextModel,
  };
}
