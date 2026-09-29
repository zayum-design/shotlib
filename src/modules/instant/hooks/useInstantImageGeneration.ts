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
import type { InstantCharacter, InstantScene, InstantSegment } from '@/shared/types/project';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { useInstantAvatarPreview } from './useInstantAvatarPreview';
import { useInstantAvatarGeneration } from './useInstantAvatarGeneration';
import { useInstantSceneImageGeneration } from './useInstantSceneImageGeneration';
import { useInstantAvatarModal } from './useInstantAvatarModal';
import { useInstantPortraitDialog } from './useInstantPortraitDialog';
import { useInstantMultiView } from './useInstantMultiView';

interface UseInstantImageGenerationOptions {
  characters: InstantCharacter[];
  setCharacters: React.Dispatch<React.SetStateAction<InstantCharacter[]>>;
  scenes: InstantScene[];
  setScenes: React.Dispatch<React.SetStateAction<InstantScene[]>>;
  saveCharacters: (next: InstantCharacter[]) => void;
  saveScenes: (next: InstantScene[]) => void;
  segments: InstantSegment[];
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  saveSegments: (nextSegments: InstantSegment[]) => void;
  selectedImageModel: string;
  projectId: string | undefined;
  currentProjectAspectRatio?: string;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  syncSegmentPromptImages: (chars: InstantCharacter[], scns: InstantScene[]) => void;
  multiViewChar: InstantCharacter | null;
  setMultiViewChar: React.Dispatch<React.SetStateAction<InstantCharacter | null>>;
}

export function useInstantImageGeneration({
  characters,
  setCharacters,
  scenes,
  setScenes,
  saveCharacters,
  saveScenes,
  segments,
  setSegments,
  saveSegments,
  selectedImageModel,
  projectId,
  currentProjectAspectRatio,
  videoApiPreviewMode,
  showApiPreview,
  syncSegmentPromptImages,
  multiViewChar,
  setMultiViewChar,
}: UseInstantImageGenerationOptions) {
  const workflowStore = useWorkflowStore();

  const {
    executeGenerateAvatar,
    handleGenerateAvatar,
  } = useInstantAvatarGeneration({
    projectId,
    setCharacters,
    saveCharacters,
    syncSegmentPromptImages,
    scenes,
    selectedImageModel,
    videoApiPreviewMode,
    showApiPreview,
  });

  const {
    executeGenerateScene,
    handleGenerateScene,
  } = useInstantSceneImageGeneration({
    projectId,
    scenes,
    setScenes,
    selectedImageModel,
    currentProjectAspectRatio,
    videoApiPreviewMode,
    showApiPreview,
    syncSegmentPromptImages,
    characters,
  });

  const {
    avatarPreviewOpen,
    setAvatarPreviewOpen,
    avatarPreviewChar,
    setAvatarPreviewChar,
    scenePreviewOpen,
    setScenePreviewOpen,
    scenePreviewScene,
    setScenePreviewScene,
    handleOpenAvatarPreview,
    handleOpenScenePreview,
  } = useInstantAvatarPreview();

  const {
    multiViewOpen,
    setMultiViewOpen,
    multiViewIndex,
    setMultiViewIndex,
    viewsPrompt,
    setViewsPrompt,
    viewsModel,
    setViewsModel,
    handleOpenMultiView,
    executeGenerateCharacterViews,
    handleGenerateCharacterViews,
  } = useInstantMultiView({
    projectId,
    selectedImageModel,
    characters,
    setCharacters,
    multiViewChar,
    setMultiViewChar,
    scenes,
    segments,
    syncSegmentPromptImages,
    videoApiPreviewMode,
    showApiPreview,
  });

  const {
    portraitDialogOpen,
    setPortraitDialogOpen,
    portraitDialogTitle,
    setPortraitDialogTitle,
    portraitDialogPrompt,
    setPortraitDialogPrompt,
    portraitDialogModel,
    setPortraitDialogModel,
    portraitDialogChar,
    setPortraitDialogChar,
    portraitDialogIsReset,
    setPortraitDialogIsReset,
    portraitDialogPreviewUrl,
    setPortraitDialogPreviewUrl,
    portraitDialogGenerating,
    setPortraitDialogGenerating,
    openPortraitDialog,
    closePortraitDialog,
    executeGeneratePortrait,
    handleGeneratePortraitInDialog,
    handleConfirmPortraitFromDialog,
    handleDeletePortrait,
    handleDeleteFullBody,
  } = useInstantPortraitDialog({
    projectId,
    selectedImageModel,
    characters,
    setCharacters,
    multiViewChar,
    setMultiViewChar,
    setMultiViewIndex,
    scenes,
    segments,
    setSegments,
  });

  const {
    avatarModalOpen,
    setAvatarModalOpen,
    isGeneratingAvatar,
    setIsGeneratingAvatar,
    avatarPrompt,
    setAvatarPrompt,
    avatarCurrentStep,
    setAvatarCurrentStep,
    avatarSelections,
    setAvatarSelections,
    avatarModel,
    setAvatarModel,
    avatarTargetChar,
    setAvatarTargetChar,
    avatarTotalSteps,
    isAvatarLastStep,
    avatarOptions,
    getAvatarStepOptions,
    handleAvatarSelect,
    buildModalAvatarPrompt,
    handleRandomAvatarPrompt,
    handleGenerateAvatarFromModal,
    resetAvatarModal,
  } = useInstantAvatarModal({
    executeGenerateAvatar,
  });

  // 批量生成角色头像（跳过已有头像或正在生成的）
  // 已移除：该功能随 sidebar 批量生成按钮一起取消

  return {
    // Multi-view
    multiViewOpen,
    setMultiViewOpen,
    multiViewIndex,
    setMultiViewIndex,
    handleOpenMultiView,
    handleGenerateCharacterViews,
    viewsPrompt,
    setViewsPrompt,
    viewsModel,
    setViewsModel,
    // Portrait dialog
    portraitDialogOpen,
    setPortraitDialogOpen,
    portraitDialogTitle,
    setPortraitDialogTitle,
    portraitDialogPrompt,
    setPortraitDialogPrompt,
    portraitDialogModel,
    setPortraitDialogModel,
    portraitDialogChar,
    setPortraitDialogChar,
    portraitDialogIsReset,
    setPortraitDialogIsReset,
    portraitDialogPreviewUrl,
    setPortraitDialogPreviewUrl,
    portraitDialogGenerating,
    setPortraitDialogGenerating,
    openPortraitDialog,
    closePortraitDialog,
    handleGeneratePortraitInDialog,
    handleConfirmPortraitFromDialog,
    handleDeletePortrait,
    handleDeleteFullBody,
    // Avatar preview
    avatarPreviewOpen,
    setAvatarPreviewOpen,
    avatarPreviewChar,
    setAvatarPreviewChar,
    handleOpenAvatarPreview,
    // Scene preview
    scenePreviewOpen,
    setScenePreviewOpen,
    scenePreviewScene,
    setScenePreviewScene,
    handleOpenScenePreview,
    // Avatar modal
    avatarModalOpen,
    setAvatarModalOpen,
    isGeneratingAvatar,
    setIsGeneratingAvatar,
    avatarPrompt,
    setAvatarPrompt,
    avatarCurrentStep,
    setAvatarCurrentStep,
    avatarSelections,
    setAvatarSelections,
    avatarModel,
    setAvatarModel,
    avatarTargetChar,
    setAvatarTargetChar,
    avatarTotalSteps,
    isAvatarLastStep,
    avatarOptions,
    getAvatarStepOptions,
    handleAvatarSelect,
    buildModalAvatarPrompt,
    handleRandomAvatarPrompt,
    handleGenerateAvatarFromModal,
    resetAvatarModal,
    // Generators
    executeGenerateAvatar,
    handleGenerateAvatar,
    executeGenerateScene,
    handleGenerateScene,
  };
}
