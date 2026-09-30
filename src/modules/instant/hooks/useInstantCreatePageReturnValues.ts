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

import type {
  InstantCharacter,
  InstantScene,
  InstantSegment,
  Project,
} from '@/shared/types/project';
import type { Shot } from '@/shared/types/index';
import type { EpisodePromptChangeItem } from '@/modules/workflow/api/scriptApi';

/**
 * 将各子 hook 的结果字段组装为 useInstantCreatePage 的最终返回值。
 * 这是一个纯映射函数，不含任何逻辑。
 */
export function useInstantCreatePageReturnValues({
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
  imageModels,
  selectedImageModel,
  setSelectedImageModel,
  videoModels,
  defaultVideoModel,
  textModels,
  defaultTextModel,
  handleShotTextModelChange,
  handleShotMaxDurationChange,
  handleShotImageModelChange,
  dragDataRef,
  handleNewSegment,
  handleRenameSegment,
  handleDeleteSegment,
  switchSegment,
  saveCharacters,
  saveScenes,
  saveSegments,
  applyCloudSyncData,
  segmentMenuItems,
  renameModalOpen,
  setRenameModalOpen,
  renameValue,
  setRenameValue,
  itemRenameModalOpen,
  setItemRenameModalOpen,
  itemRenameValue,
  setItemRenameValue,
  itemRenameId,
  handleOpenItemRename,
  handleSaveItemRename,
  characterDialogOpen,
  setCharacterDialogOpen,
  handleCreateCharacter,
  sceneDialogOpen,
  setSceneDialogOpen,
  handleCreateScene,
  editingChar,
  setEditingChar,
  handleDeleteCharacter,
  editSceneOpen,
  setEditSceneOpen,
  editingScene,
  editSceneName,
  setEditSceneName,
  editScenePrompt,
  setEditScenePrompt,
  editSceneModel,
  setEditSceneModel,
  editSceneConfirmLoading,
  handleEditScene,
  handleSaveEditScene,
  handleGenerateEditSceneImage,
  handleEditSceneModelChange,
  handleDeleteScene,
  multiViewOpen,
  setMultiViewOpen,
  multiViewChar,
  setMultiViewChar,
  multiViewIndex,
  setMultiViewIndex,
  handleOpenMultiView,
  handleGenerateCharacterViews,
  viewsPrompt,
  setViewsPrompt,
  viewsModel,
  setViewsModel,
  portraitDialogOpen,
  portraitDialogTitle,
  setPortraitDialogTitle,
  portraitDialogPrompt,
  setPortraitDialogPrompt,
  portraitDialogModel,
  setPortraitDialogModel,
  portraitDialogChar,
  portraitDialogIsReset,
  portraitDialogPreviewUrl,
  portraitDialogGenerating,
  openPortraitDialog,
  closePortraitDialog,
  handleGeneratePortraitInDialog,
  handleConfirmPortraitFromDialog,
  handleDeletePortrait,
  handleDeleteFullBody,
  avatarPreviewOpen,
  setAvatarPreviewOpen,
  avatarPreviewChar,
  handleOpenAvatarPreview,
  handleGenerateAvatar,
  avatarModalOpen,
  setAvatarModalOpen,
  isGeneratingAvatar,
  avatarCurrentStep,
  setAvatarCurrentStep,
  avatarSelections,
  setAvatarSelections,
  avatarPrompt,
  setAvatarPrompt,
  isAvatarLastStep,
  avatarTotalSteps,
  avatarModel,
  setAvatarModel,
  getAvatarStepOptions,
  handleAvatarSelect,
  buildModalAvatarPrompt,
  handleRandomAvatarPrompt,
  handleGenerateAvatarFromModal,
  resetAvatarModal,
  avatarOptions,
  scenePreviewOpen,
  setScenePreviewOpen,
  scenePreviewScene,
  handleOpenScenePreview,
  handleGenerateScene,
  editPromptOpen,
  setEditPromptOpen,
  editingSceneItem,
  setEditingSceneItem,
  handleEditScenePrompt,
  handleSaveScenePrompt,
  handleScenePromptChange,
  handleApplyReviewChanges,
  shotModalOpen,
  setShotModalOpen,
  editingShotItemId,
  editingShot,
  setEditingShot,
  shotDuration,
  setShotDuration,
  editingShotMaxDuration,
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
  openShotModal,
  handleSaveShot,
  handleDeleteShot,
  handleGenerateShotReferenceImage,
  handleBatchGenerateShotReferenceImages,
  handleBatchGenerateFirstLastFrames,
  handleGenerateShots,
  previewOpen,
  setPreviewOpen,
  previewData,
  handlePreviewConfirm,
  showApiPreview,
  video,
  handleGenerateSceneVideo,
  handleRetrySceneVideo,
  executeGenerateSceneVideo,
  handleVideoGenerationModeChange,
  handleSceneVideoModelChange,
  handleVideoDurationChange,
  handleVideoResolutionChange,
  handleFirstFramePromptChange,
  handleLastFramePromptChange,
  handleFirstLastFrameVideoPromptChange,
  handleGenerateFirstFrame,
  handleGenerateLastFrame,
  handleVideoIndexChange,
  preview,
  handleDeleteCanvasItem,
  handleEditCanvasItemName,
  handleToggleMinimize,
  handleReorderCanvasItem,
  handleAddToHeader,
  handleRemoveFromHeader,
  handleReorderHeaderItem,
  handleRemoveCharacterFromScene,
  handleDismissVideoError,
  canvasAspectClass,
  hasContent,
  focusOnItem,
  containerRef,
  saveStatus,
  handleManualSave,
}: {
  navigate: ReturnType<typeof import('react-router-dom').useNavigate>;
  projectId: string | undefined;
  currentProject: Project | undefined;
  characters: InstantCharacter[];
  scenes: InstantScene[];
  segments: InstantSegment[];
  activeSegmentId: string | null;
  activeSegment: InstantSegment | undefined;
  canvasItems: import('@/shared/types/project').CanvasItem[];
  selectedSceneItemId: string | null;
  applySelectedScene: (id: string | null) => void;
  imageModels: any;
  selectedImageModel: string;
  setSelectedImageModel: (v: string) => void;
  videoModels: any[];
  defaultVideoModel: string;
  textModels: any[];
  defaultTextModel: string;
  handleShotTextModelChange: (itemId: string, model: string) => void;
  handleShotMaxDurationChange: (itemId: string, seconds: number) => void;
  handleShotImageModelChange: (itemId: string, model: string) => void;
  dragDataRef: React.MutableRefObject<{ type: 'character' | 'scene'; refId: string } | null>;
  handleNewSegment: () => void;
  handleRenameSegment: () => void;
  handleDeleteSegment: () => void;
  switchSegment: (id: string | null) => void;
  saveCharacters: (chars: InstantCharacter[]) => void;
  saveScenes: (scenes: InstantScene[]) => void;
  saveSegments: (segs: InstantSegment[]) => void;
  applyCloudSyncData: (data: any) => Promise<void>;
  segmentMenuItems: any;
  renameModalOpen: boolean;
  setRenameModalOpen: (v: boolean) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  itemRenameModalOpen: boolean;
  setItemRenameModalOpen: (v: boolean) => void;
  itemRenameValue: string;
  setItemRenameValue: (v: string) => void;
  itemRenameId: string | null;
  handleOpenItemRename: (itemId: string) => void;
  handleSaveItemRename: () => void;
  characterDialogOpen: boolean;
  setCharacterDialogOpen: (v: boolean) => void;
  handleCreateCharacter: (character: any) => void;
  sceneDialogOpen: boolean;
  setSceneDialogOpen: (v: boolean) => void;
  handleCreateScene: (scene: any) => void;
  // editingChar 保留：供角色编辑弹窗回填使用
  editingChar: InstantCharacter | null;
  setEditingChar: React.Dispatch<React.SetStateAction<InstantCharacter | null>>;
  handleDeleteCharacter: (char: InstantCharacter) => void;
  editSceneOpen: boolean;
  setEditSceneOpen: (v: boolean) => void;
  editingScene: InstantScene | null;
  editSceneName: string;
  setEditSceneName: (v: string) => void;
  editScenePrompt: string;
  setEditScenePrompt: (v: string) => void;
  editSceneModel: string;
  setEditSceneModel: (v: string) => void;
  editSceneConfirmLoading: boolean;
  handleEditScene: (scene: InstantScene) => void;
  handleSaveEditScene: () => void;
  handleGenerateEditSceneImage: () => void;
  handleEditSceneModelChange: (model: string) => void;
  handleDeleteScene: (scene: InstantScene) => void;
  multiViewOpen: boolean;
  setMultiViewOpen: (v: boolean) => void;
  multiViewChar: InstantCharacter | null;
  setMultiViewChar: React.Dispatch<React.SetStateAction<InstantCharacter | null>>;
  multiViewIndex: number;
  setMultiViewIndex: (v: number | ((p: number) => number)) => void;
  handleOpenMultiView: (char: InstantCharacter) => void;
  handleGenerateCharacterViews: (char: InstantCharacter) => Promise<void>;
  viewsPrompt: string;
  setViewsPrompt: (v: string) => void;
  viewsModel: string;
  setViewsModel: (v: string) => void;
  portraitDialogOpen: boolean;
  portraitDialogTitle: string;
  setPortraitDialogTitle: (v: string) => void;
  portraitDialogPrompt: string;
  setPortraitDialogPrompt: (v: string) => void;
  portraitDialogModel: string;
  setPortraitDialogModel: (v: string) => void;
  portraitDialogChar: InstantCharacter | null;
  portraitDialogIsReset: boolean;
  portraitDialogPreviewUrl: string;
  portraitDialogGenerating: boolean;
  openPortraitDialog: (char: InstantCharacter, isReset?: boolean) => void;
  closePortraitDialog: () => void;
  handleGeneratePortraitInDialog: () => Promise<void>;
  handleConfirmPortraitFromDialog: () => void;
  handleDeletePortrait: (char: InstantCharacter, index: number) => void;
  handleDeleteFullBody: (char: InstantCharacter, index: number) => void;
  avatarPreviewOpen: boolean;
  setAvatarPreviewOpen: (v: boolean) => void;
  avatarPreviewChar: InstantCharacter | null;
  handleOpenAvatarPreview: (char: InstantCharacter) => void;
  handleGenerateAvatar: (char: InstantCharacter) => void;
  avatarModalOpen: boolean;
  setAvatarModalOpen: (v: boolean) => void;
  isGeneratingAvatar: boolean;
  avatarCurrentStep: number;
  setAvatarCurrentStep: (step: number) => void;
  avatarSelections: string[];
  setAvatarSelections: (selections: string[]) => void;
  avatarPrompt: string;
  setAvatarPrompt: (v: string) => void;
  isAvatarLastStep: boolean;
  avatarTotalSteps: number;
  avatarModel: string;
  setAvatarModel: (v: string) => void;
  getAvatarStepOptions: (stepIndex: number, selections: string[]) => string[];
  handleAvatarSelect: (value: string) => void;
  buildModalAvatarPrompt: () => string;
  handleRandomAvatarPrompt: () => void;
  handleGenerateAvatarFromModal: () => Promise<void>;
  resetAvatarModal: () => void;
  avatarOptions: any;
  scenePreviewOpen: boolean;
  setScenePreviewOpen: (v: boolean) => void;
  scenePreviewScene: InstantScene | null;
  handleOpenScenePreview: (scene: InstantScene) => void;
  handleGenerateScene: (scene: InstantScene) => Promise<void>;
  editPromptOpen: boolean;
  setEditPromptOpen: (v: boolean) => void;
  editingSceneItem: { itemId: string; prompt: string } | null;
  setEditingSceneItem: (v: any) => void;
  handleEditScenePrompt: (itemId: string) => void;
  handleSaveScenePrompt: () => void;
  handleScenePromptChange: (itemId: string, value: string) => void;
  handleApplyReviewChanges: (itemId: string, items: EpisodePromptChangeItem[]) => void;
  shotModalOpen: boolean;
  setShotModalOpen: (v: boolean) => void;
  editingShotItemId: string | null;
  editingShot: Shot | null;
  setEditingShot: (shot: Shot | null) => void;
  shotDuration: number;
  setShotDuration: (v: number) => void;
  editingShotMaxDuration: number;
  shotMovements: string[];
  setShotMovements: (v: string[]) => void;
  shotType: string;
  setShotType: (v: string) => void;
  shotAngle: string;
  setShotAngle: (v: string) => void;
  shotLighting: string;
  setShotLighting: (v: string) => void;
  shotMood: string;
  setShotMood: (v: string) => void;
  shotPrompt: string;
  setShotPrompt: (v: string) => void;
  openShotModal: (itemId: string, shot?: Shot) => void;
  handleSaveShot: () => void;
  handleDeleteShot: (itemId: string, shotId: string) => void;
  handleGenerateShotReferenceImage: (itemId: string, shotIndex: number) => Promise<void>;
  handleBatchGenerateShotReferenceImages: (itemId: string) => Promise<void>;
  handleBatchGenerateFirstLastFrames: (itemId: string) => Promise<void>;
  handleGenerateShots: (itemId: string) => Promise<void>;
  previewOpen: boolean;
  setPreviewOpen: (v: boolean) => void;
  previewData: any;
  handlePreviewConfirm: () => void;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  video: any;
  handleGenerateSceneVideo: (itemId: string) => Promise<void>;
  handleRetrySceneVideo: (itemId: string) => Promise<void>;
  executeGenerateSceneVideo: (itemId: string, requestData: any) => Promise<void>;
  handleVideoGenerationModeChange: (itemId: string, mode: any) => void;
  handleSceneVideoModelChange: (itemId: string, model: string) => void;
  handleVideoDurationChange: (itemId: string, duration: number) => void;
  handleVideoResolutionChange: (itemId: string, resolution: '720p' | '1080p') => void;
  handleFirstFramePromptChange: (itemId: string, value: string) => void;
  handleLastFramePromptChange: (itemId: string, value: string) => void;
  handleFirstLastFrameVideoPromptChange: (itemId: string, value: string) => void;
  handleGenerateFirstFrame: (itemId: string) => Promise<void>;
  handleGenerateLastFrame: (itemId: string) => Promise<void>;
  handleVideoIndexChange: (itemId: string, index: number) => void;
  preview: any;
  handleDeleteCanvasItem: (itemId: string) => void;
  handleEditCanvasItemName: (itemId: string, name: string) => void;
  handleToggleMinimize: (itemId: string) => void;
  handleReorderCanvasItem: (fromIndex: number, toIndex: number) => void;
  handleAddToHeader: (itemId: string) => void;
  handleRemoveFromHeader: (itemId: string) => void;
  handleReorderHeaderItem: (fromIndex: number, toIndex: number) => void;
  handleRemoveCharacterFromScene: (sceneItemId: string, charRefId: string) => void;
  handleDismissVideoError: (itemId: string) => void;
  canvasAspectClass: string;
  hasContent: boolean;
  focusOnItem: (itemId: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  saveStatus: 'saved' | 'saving' | 'unsaved';
  handleManualSave: () => Promise<void>;
}) {
  return {
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
    setSelectedSceneItemId: applySelectedScene,
    imageModels,
    selectedImageModel,
    setSelectedImageModel,
    videoModels,
    defaultVideoModel,
    textModels,
    defaultTextModel,
    handleShotTextModelChange,
    handleShotMaxDurationChange,
    handleShotImageModelChange,
    dragDataRef,
    handleNewSegment,
    handleRenameSegment,
    handleDeleteSegment,
    setActiveSegmentId: switchSegment,
    saveCharacters,
    saveScenes,
    saveSegments,
    applyCloudSyncData,
    segmentMenuItems,
    renameModalOpen,
    setRenameModalOpen,
    renameValue,
    setRenameValue,
    itemRenameModalOpen,
    setItemRenameModalOpen,
    itemRenameValue,
    setItemRenameValue,
    itemRenameId,
    handleOpenItemRename,
    handleSaveItemRename,
    characterDialogOpen,
    setCharacterDialogOpen,
    handleCreateCharacter,
    sceneDialogOpen,
    setSceneDialogOpen,
    handleCreateScene,
    editingChar,
    setEditingChar,
    handleDeleteCharacter,
    editSceneOpen,
    setEditSceneOpen,
    editingScene,
    editSceneName,
    setEditSceneName,
    editScenePrompt,
    setEditScenePrompt,
    editSceneModel,
    setEditSceneModel,
    editSceneConfirmLoading,
    handleEditScene,
    handleSaveEditScene,
    handleGenerateEditSceneImage,
    handleEditSceneModelChange,
    handleDeleteScene,
    multiViewOpen,
    setMultiViewOpen,
    multiViewChar,
    setMultiViewChar,
    multiViewIndex,
    setMultiViewIndex,
    handleOpenMultiView,
    handleGenerateCharacterViews,
    viewsPrompt,
    setViewsPrompt,
    viewsModel,
    setViewsModel,
    portraitDialogOpen,
    portraitDialogTitle,
    setPortraitDialogTitle,
    portraitDialogPrompt,
    setPortraitDialogPrompt,
    portraitDialogModel,
    setPortraitDialogModel,
    portraitDialogChar,
    portraitDialogIsReset,
    portraitDialogPreviewUrl,
    portraitDialogGenerating,
    openPortraitDialog,
    closePortraitDialog,
    handleGeneratePortraitInDialog,
    handleConfirmPortraitFromDialog,
    handleDeletePortrait,
    handleDeleteFullBody,
    avatarPreviewOpen,
    setAvatarPreviewOpen,
    avatarPreviewChar,
    handleOpenAvatarPreview,
    handleGenerateAvatar,
    avatarModalOpen,
    setAvatarModalOpen,
    isGeneratingAvatar,
    avatarCurrentStep,
    setAvatarCurrentStep,
    avatarSelections,
    setAvatarSelections,
    avatarPrompt,
    setAvatarPrompt,
    isAvatarLastStep,
    avatarTotalSteps,
    avatarModel,
    setAvatarModel,
    getAvatarStepOptions,
    handleAvatarSelect,
    buildAvatarPrompt: buildModalAvatarPrompt,
    handleRandomAvatarPrompt,
    handleGenerateAvatarFromModal,
    resetAvatarModal,
    avatarPresetOptions: avatarOptions,
    scenePreviewOpen,
    setScenePreviewOpen,
    scenePreviewScene,
    handleOpenScenePreview,
    handleGenerateScene,
    editPromptOpen,
    setEditPromptOpen,
    editingSceneItem,
    setEditingSceneItem,
    handleEditScenePrompt,
    handleSaveScenePrompt,
    handleScenePromptChange,
    handleApplyReviewChanges,
    shotModalOpen,
    setShotModalOpen,
    editingShotItemId,
    editingShot,
    setEditingShot,
    shotDuration,
    setShotDuration,
    editingShotMaxDuration,
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
    openShotModal,
    handleSaveShot,
    handleDeleteShot,
    handleGenerateShotReferenceImage,
    handleBatchGenerateShotReferenceImages,
    handleBatchGenerateFirstLastFrames,
    handleGenerateShots,
    previewOpen,
    setPreviewOpen,
    previewData,
    handlePreviewConfirm,
    showApiPreview,
    ...video,
    handleGenerateSceneVideo,
    handleRetrySceneVideo,
    executeGenerateSceneVideo,
    handleVideoGenerationModeChange,
    handleSceneVideoModelChange,
    handleVideoDurationChange,
    handleVideoResolutionChange,
    handleFirstFramePromptChange,
    handleLastFramePromptChange,
    handleFirstLastFrameVideoPromptChange,
    handleGenerateFirstFrame,
    handleGenerateLastFrame,
    handleVideoIndexChange,
    ...preview,
    handleDeleteCanvasItem,
    handleEditCanvasItemName,
    handleToggleMinimize,
    handleReorderCanvasItem,
    handleAddToHeader,
    handleRemoveFromHeader,
    handleReorderHeaderItem,
    handleRemoveCharacterFromScene,
    handleDismissVideoError,
    canvasAspectClass,
    hasContent,
    focusOnItem,
    containerRef,
    saveStatus,
    handleManualSave,
  };
}
