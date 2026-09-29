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

import { useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useProjectStore } from '@/shared/stores/projectStore';

import type { UseInstantCreatePageReturn } from './UseInstantCreatePageReturn';
import { useInstantPreview } from './useInstantPreview';
import { useInstantVideo } from './useInstantVideo';
import { useInstantApiPreview } from './useInstantApiPreview';
import { useInstantModelSelection } from './useInstantModelSelection';
import { useInstantSaveManager } from './useInstantSaveManager';
import { useInstantVideoTaskRecovery } from './useInstantVideoTaskRecovery';
import { useInstantNavigation } from './useInstantNavigation';
import { useInstantProjectInit } from './useInstantProjectInit';
import { useInstantDataLoader } from './useInstantDataLoader';
import { useInstantSyncSegmentImages } from './useInstantSyncSegmentImages';
import { useInstantDialogs } from './useInstantDialogs';
import { useInstantCanvasAspect } from './useInstantCanvasAspect';
import { useInstantCanvasDrag } from './useInstantCanvasDrag';
import { useInstantCanvasDrop } from './useInstantCanvasDrop';
import { useInstantShotManager } from './useInstantShotManager';
import { useInstantSegmentManager } from './useInstantSegmentManager';
import { useInstantAutoSelectScene } from './useInstantAutoSelectScene';
import { useInstantLocalState } from './useInstantLocalState';
import { useInstantDerivedState } from './useInstantDerivedState';
import { useInstantFocus } from './useInstantFocus';
import { useInstantCharacterGroup } from './useInstantCharacterGroup';
import { useInstantSceneGroup } from './useInstantSceneGroup';
import { useInstantVideoGroup } from './useInstantVideoGroup';
import { useInstantCreatePageReturnValues } from './useInstantCreatePageReturnValues';

export const useInstantCreatePage = (): UseInstantCreatePageReturn => {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentProject = useProjectStore((state) =>
    state.projects.find((p) => p.id === state.currentProjectId)
  );
  const setCurrentProject = useProjectStore((state) => state.setCurrentProject);
  const initProjectStore = useProjectStore((state) => state.init);
  const resolvedProjectId = currentProject?.id || projectId;

  const localState = useInstantLocalState();
  const {
    characters,
    setCharacters,
    scenes,
    setScenes,
    segments,
    setSegments,
    activeSegmentId,
    setActiveSegmentId,
    selectedSceneItemId,
    setSelectedSceneItemId,
    renameModalOpen,
    setRenameModalOpen,
    renameValue,
    setRenameValue,
    multiViewChar,
    setMultiViewChar,
  } = localState;

  const saveManager = useInstantSaveManager({
    projectId: resolvedProjectId,
    characters,
    setCharacters,
    scenes,
    setScenes,
    segments,
    setSegments,
  });
  const { saveStatus, handleManualSave, applyCloudSyncData, markAsSaved } = saveManager;

  const dialogs = useInstantDialogs({
    characters,
    saveCharacters: saveManager.saveCharacters,
    scenes,
    saveScenes: saveManager.saveScenes,
  });

  const preview = useInstantPreview();
  const video = useInstantVideo();
  const apiPreview = useInstantApiPreview();

  const dragDataRef = useRef<{ type: 'character' | 'scene'; refId: string } | null>(null);

  const { canvasAspectClass } = useInstantCanvasAspect(currentProject?.aspectRatio);
  const modelSelection = useInstantModelSelection();

  useInstantProjectInit({ projectId, setCurrentProject, initProjectStore });
  useInstantDataLoader({
    projectId,
    setSearchParams,
    setCharacters,
    setScenes,
    setSegments,
    setActiveSegmentId,
    setSelectedSceneItemId,
    markAsSaved,
  });

  useInstantVideoTaskRecovery({
    segments,
    setSegments,
    projectId: resolvedProjectId,
    defaultVideoModel: modelSelection.defaultVideoModel,
  });

  const { switchSegment, applySelectedScene } = useInstantNavigation({
    setActiveSegmentId,
    setSelectedSceneItemId,
    setSearchParams,
  });

  const { activeSegment, canvasItems, hasContent } = useInstantDerivedState({
    segments,
    activeSegmentId,
    scenes,
  });

  useInstantAutoSelectScene({ activeSegment, selectedSceneItemId, applySelectedScene });

  const { syncSegmentPromptImages } = useInstantSyncSegmentImages({
    projectId: resolvedProjectId,
    setSegments,
  });

  const segmentManager = useInstantSegmentManager({
    segments,
    saveSegments: saveManager.saveSegments,
    switchSegment,
    activeSegment,
    renameValue,
    setRenameValue,
    setRenameModalOpen,
  });

  const characterGroup = useInstantCharacterGroup({
    characters,
    setCharacters,
    saveCharacters: saveManager.saveCharacters,
    scenes,
    setScenes,
    saveScenes: saveManager.saveScenes,
    segments,
    setSegments,
    saveSegments: saveManager.saveSegments,
    selectedImageModel: modelSelection.selectedImageModel,
    projectId: resolvedProjectId,
    videoApiPreviewMode: video.apiPreviewMode,
    showApiPreview: apiPreview.showApiPreview,
    syncSegmentPromptImages,
    multiViewChar,
    setMultiViewChar,
  });

  const sceneGroup = useInstantSceneGroup({
    scenes,
    setScenes,
    saveScenes: saveManager.saveScenes,
    segments,
    setSegments,
    saveSegments: saveManager.saveSegments,
    characters,
    activeSegment,
    activeSegmentId,
    selectedSceneItemId,
    applySelectedScene,
    selectedImageModel: modelSelection.selectedImageModel,
    projectId: resolvedProjectId,
    videoApiPreviewMode: video.apiPreviewMode,
    showApiPreview: apiPreview.showApiPreview,
    syncSegmentPromptImages,
    canvasItems,
    videoModels: modelSelection.videoModels,
    currentProjectAspectRatio: currentProject?.aspectRatio,
  });

  const videoGroup = useInstantVideoGroup({
    activeSegment,
    activeSegmentId,
    segments,
    setSegments,
    saveSegments: saveManager.saveSegments,
    characters,
    scenes,
    projectId: resolvedProjectId,
    canvasItems,
    videoModels: modelSelection.videoModels,
    defaultVideoModel: modelSelection.defaultVideoModel,
    selectedImageModel: modelSelection.selectedImageModel,
    videoApiPreviewMode: video.apiPreviewMode,
    showApiPreview: apiPreview.showApiPreview,
    currentProjectAspectRatio: currentProject?.aspectRatio,
    saveCharacters: saveManager.saveCharacters,
  });

  const shotManager = useInstantShotManager({
    activeSegmentId,
    activeSegment,
    segments,
    setSegments,
    saveSegments: saveManager.saveSegments,
    characters,
    scenes,
    projectId: resolvedProjectId,
    canvasItems,
    selectedImageModel: modelSelection.selectedImageModel,
    videoApiPreviewMode: video.apiPreviewMode,
    showApiPreview: apiPreview.showApiPreview,
    defaultTextModel: modelSelection.defaultTextModel,
    currentProjectAspectRatio: currentProject?.aspectRatio,
  });

  const { containerRef } = useInstantCanvasDrag({
    activeSegmentId,
    setSegments,
    projectId: resolvedProjectId,
  });
  const { focusOnItem } = useInstantFocus(applySelectedScene);

  useInstantCanvasDrop({
    dragDataRef,
    activeSegmentId,
    selectedSceneItemId,
    scenes,
    characters,
    projectId: resolvedProjectId,
    applySelectedScene,
    setSegments,
  });

  return useInstantCreatePageReturnValues({
    navigate,
    projectId,
    currentProject,
    characters,
    scenes,
    segments,
    activeSegmentId,
    activeSegment,
    canvasItems,
    selectedSceneItemId,
    applySelectedScene,
    imageModels: modelSelection.imageModels,
    selectedImageModel: modelSelection.selectedImageModel,
    setSelectedImageModel: modelSelection.setSelectedImageModel,
    videoModels: modelSelection.videoModels,
    defaultVideoModel: modelSelection.defaultVideoModel,
    textModels: modelSelection.textModels,
    defaultTextModel: modelSelection.defaultTextModel,
    dragDataRef,
    handleNewSegment: segmentManager.handleNewSegment,
    handleRenameSegment: segmentManager.handleRenameSegment,
    handleDeleteSegment: segmentManager.handleDeleteSegment,
    switchSegment,
    saveCharacters: saveManager.saveCharacters,
    saveScenes: saveManager.saveScenes,
    saveSegments: saveManager.saveSegments,
    applyCloudSyncData,
    segmentMenuItems: segmentManager.segmentMenuItems,
    renameModalOpen,
    setRenameModalOpen,
    renameValue,
    setRenameValue,
    characterDialogOpen: dialogs.characterDialogOpen,
    setCharacterDialogOpen: dialogs.setCharacterDialogOpen,
    handleCreateCharacter: dialogs.handleCreateCharacter,
    sceneDialogOpen: dialogs.sceneDialogOpen,
    setSceneDialogOpen: dialogs.setSceneDialogOpen,
    handleCreateScene: dialogs.handleCreateScene,
    ...characterGroup,
    multiViewChar,
    setMultiViewChar,
    ...sceneGroup,
    ...videoGroup,
    shotModalOpen: shotManager.shotModalOpen,
    setShotModalOpen: shotManager.setShotModalOpen,
    editingShotItemId: shotManager.editingShotItemId,
    editingShot: shotManager.editingShot,
    setEditingShot: shotManager.setEditingShot,
    shotDuration: shotManager.shotDuration,
    setShotDuration: shotManager.setShotDuration,
    editingShotMaxDuration: shotManager.editingShotMaxDuration,
    shotMovements: shotManager.shotMovements,
    setShotMovements: shotManager.setShotMovements,
    shotType: shotManager.shotType,
    setShotType: shotManager.setShotType,
    shotAngle: shotManager.shotAngle,
    setShotAngle: shotManager.setShotAngle,
    shotLighting: shotManager.shotLighting,
    setShotLighting: shotManager.setShotLighting,
    shotMood: shotManager.shotMood,
    setShotMood: shotManager.setShotMood,
    shotPrompt: shotManager.shotPrompt,
    setShotPrompt: shotManager.setShotPrompt,
    openShotModal: shotManager.openShotModal,
    handleSaveShot: shotManager.handleSaveShot,
    handleDeleteShot: shotManager.handleDeleteShot,
    handleGenerateShotReferenceImage: shotManager.handleGenerateShotReferenceImage,
    handleBatchGenerateShotReferenceImages: shotManager.handleBatchGenerateShotReferenceImages,
    handleGenerateShots: shotManager.handleGenerateShots,
    previewOpen: apiPreview.previewOpen,
    setPreviewOpen: apiPreview.setPreviewOpen,
    previewData: apiPreview.previewData,
    handlePreviewConfirm: apiPreview.handlePreviewConfirm,
    showApiPreview: apiPreview.showApiPreview,
    video,
    preview,
    canvasAspectClass,
    hasContent,
    focusOnItem,
    containerRef,
    saveStatus,
    handleManualSave,
  });
};
