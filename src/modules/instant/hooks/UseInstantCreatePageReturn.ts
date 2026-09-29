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

import type { MenuProps } from 'antd';
import type {
  InstantSegment,
  InstantCharacter,
  InstantScene,
  Project,
} from '@/shared/types/project';
import { IMAGE_MODELS, type Shot, type ModelConfig, type ShotReferenceAsset } from '@/shared/types/index';
import type { PresetOptions } from '@/modules/workflow/hooks/useDramaPresets';
import type { NewCharacter } from '@/modules/instant/components/CreateCharacterDialog';
import type { NewScene } from '@/modules/instant/components/CreateSceneDialog';
import type { EpisodePromptChangeItem } from '@/modules/workflow/api/scriptApi';

export interface UseInstantCreatePageReturn {
  // Navigation & project
  navigate: ReturnType<typeof import('react-router-dom').useNavigate>;
  projectId: string | undefined;
  currentProject: Project | undefined;

  // Core data
  characters: InstantCharacter[];
  scenes: InstantScene[];
  segments: InstantSegment[];
  activeSegmentId: string | null;
  activeSegment: InstantSegment | undefined;
  canvasItems: import('@/shared/types/project').CanvasItem[];
  selectedSceneItemId: string | null;
  setSelectedSceneItemId: (id: string | null) => void;
  saveCharacters: (chars: InstantCharacter[]) => void;
  saveScenes: (scenes: InstantScene[]) => void;
  saveSegments: (segs: InstantSegment[]) => void;
  applyCloudSyncData: (data: {
    instantCharacters?: InstantCharacter[];
    instantScenes?: InstantScene[];
    instantSegments?: InstantSegment[];
  }) => Promise<void>;

  // Model selection
  imageModels: typeof IMAGE_MODELS;
  selectedImageModel: string;
  setSelectedImageModel: (v: string) => void;
  videoModels: ModelConfig[];
  defaultVideoModel: string;
  textModels: ModelConfig[];
  defaultTextModel: string;
  handleShotTextModelChange: (itemId: string, model: string) => void;
  handleShotMaxDurationChange: (itemId: string, seconds: number) => void;
  handleShotImageModelChange: (itemId: string, model: string) => void;
  handleGenerateShotReferenceImage: (itemId: string, shotIndex: number) => Promise<void>;

  // Batch shot/first-last-frame generation
  handleBatchGenerateShotReferenceImages: (itemId: string) => Promise<void>;
  handleBatchGenerateFirstLastFrames: (itemId: string) => Promise<void>;

  // Drag data ref (for sidebar drag-and-drop)
  dragDataRef: React.MutableRefObject<
    { type: 'character' | 'scene'; refId: string } | null
  >;

  // Segment actions
  handleNewSegment: () => void;
  handleRenameSegment: () => void;
  handleDeleteSegment: () => void;
  setActiveSegmentId: (id: string | null) => void;
  segmentMenuItems: MenuProps['items'];

  // Rename modal
  renameModalOpen: boolean;
  setRenameModalOpen: (v: boolean) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;

  // Canvas item rename modal
  itemRenameModalOpen: boolean;
  setItemRenameModalOpen: (v: boolean) => void;
  itemRenameValue: string;
  setItemRenameValue: (v: string) => void;
  itemRenameId: string | null;
  handleOpenItemRename: (itemId: string) => void;
  handleSaveItemRename: () => void;

  // Character dialog
  characterDialogOpen: boolean;
  setCharacterDialogOpen: (v: boolean) => void;
  handleCreateCharacter: (character: NewCharacter) => void;

  // Scene dialog
  sceneDialogOpen: boolean;
  setSceneDialogOpen: (v: boolean) => void;
  handleCreateScene: (scene: NewScene) => void;

  // Character delete action
  handleDeleteCharacter: (char: InstantCharacter) => void;

  // Edit scene modal
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

  // Multi-view modal
  multiViewOpen: boolean;
  setMultiViewOpen: (v: boolean) => void;
  multiViewChar: InstantCharacter | null;
  setMultiViewChar: React.Dispatch<React.SetStateAction<InstantCharacter | null>>;
  multiViewIndex: number;
  setMultiViewIndex: (v: number | ((p: number) => number)) => void;
  handleOpenMultiView: (char: InstantCharacter) => void;
  handleGenerateCharacterViews: (char: InstantCharacter) => Promise<void>;

  // Portrait dialog
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

  // Multi-view controls
  viewsPrompt: string;
  setViewsPrompt: (v: string) => void;
  viewsModel: string;
  setViewsModel: (v: string) => void;

  // Avatar preview modal
  avatarPreviewOpen: boolean;
  setAvatarPreviewOpen: (v: boolean) => void;
  avatarPreviewChar: InstantCharacter | null;
  handleOpenAvatarPreview: (char: InstantCharacter) => void;
  handleGenerateAvatar: (char: InstantCharacter) => void;

  // Avatar generation modal (MV-style multi-step)
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
  buildAvatarPrompt: () => string;
  handleRandomAvatarPrompt: () => void;
  handleGenerateAvatarFromModal: () => Promise<void>;
  resetAvatarModal: () => void;
  avatarPresetOptions: PresetOptions;

  // Scene preview modal
  scenePreviewOpen: boolean;
  setScenePreviewOpen: (v: boolean) => void;
  scenePreviewScene: InstantScene | null;
  handleOpenScenePreview: (scene: InstantScene) => void;
  handleGenerateScene: (scene: InstantScene) => Promise<void>;

  // Scene prompt edit modal
  editPromptOpen: boolean;
  setEditPromptOpen: (v: boolean) => void;
  editingSceneItem: { itemId: string; prompt: string } | null;
  setEditingSceneItem: (
    v:
      | { itemId: string; prompt: string }
      | null
      | ((prev: { itemId: string; prompt: string } | null) => { itemId: string; prompt: string } | null)
  ) => void;
  handleEditScenePrompt: (itemId: string) => void;
  handleSaveScenePrompt: () => void;
  handleScenePromptChange: (itemId: string, value: string) => void;
  handleApplyReviewChanges: (itemId: string, items: EpisodePromptChangeItem[]) => void;
  handleSceneReferenceAssetsChange: (itemId: string, assets: ShotReferenceAsset[]) => void;

  // Shot modal
  shotModalOpen: boolean;
  setShotModalOpen: (v: boolean) => void;
  editingShotItemId: string | null;
  editingShot: Shot | null;
  shotDuration: number;
  setShotDuration: (v: number) => void;
  editingShotMaxDuration: number; // 当前编辑分镜所在场景的总时长上限（15/30）
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
  handleGenerateShots: (itemId: string) => Promise<void>;
  setEditingShot: (shot: Shot | null) => void;

  // Video generation
  apiPreviewMode: boolean;
  setApiPreviewMode: (v: boolean) => void;
  previewOpen: boolean;
  setPreviewOpen: (v: boolean) => void;
  previewTitle: string;
  previewData: any;
  handlePreviewConfirm: () => void;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  videoPreviewOpen: boolean;
  setVideoPreviewOpen: (v: boolean) => void;
  videoPreviewData: any;
  videoPreviewItemId: string | null;
  // Compliance
  complianceDialogOpen: boolean;
  setComplianceDialogOpen: (v: boolean) => void;
  complianceItemId: string;
  handleComplyAndGenerate: (assetIdMap: Map<string, string>) => Promise<void>;
  handleCheckComplete: (successImages: Array<{ characterId?: string; imageUrl: string; assetId?: string }>) => Promise<void>;
  handleGenerateSceneVideo: (itemId: string) => Promise<void>;
  handleRetrySceneVideo: (itemId: string) => Promise<void>;
  executeGenerateSceneVideo: (
    itemId: string,
    requestData: { mode: string; requestBody: any }
  ) => Promise<void>;
  handleVideoGenerationModeChange: (
    itemId: string,
    mode: 'first_last_frame' | 'reference_image'
  ) => void;
  handleSceneVideoModelChange: (itemId: string, model: string) => void;
  handleVideoDurationChange: (itemId: string, duration: number) => void;
  handleVideoResolutionChange: (itemId: string, resolution: '720p' | '1080p') => void;
  handleFirstFramePromptChange: (itemId: string, value: string) => void;
  handleLastFramePromptChange: (itemId: string, value: string) => void;
  handleFirstLastFrameVideoPromptChange: (itemId: string, value: string) => void;
  handleGenerateFirstFrame: (itemId: string) => Promise<void>;
  handleGenerateLastFrame: (itemId: string) => Promise<void>;
  handleVideoIndexChange: (itemId: string, index: number) => void;

  // Image preview
  previewModalOpen: boolean;
  setPreviewModalOpen: (v: boolean) => void;
  previewImages: string[];
  previewCurrentIndex: number;
  setPreviewCurrentIndex: (v: number | ((p: number) => number)) => void;
  openImagePreview: (imageUrl: string, title: string) => void;
  openSceneImagesPreview: (images: string[], title: string, startIndex?: number) => void;
  openSceneGridModal: (images: string[], title: string) => void;
  sceneGridModalOpen: boolean;
  setSceneGridModalOpen: (v: boolean) => void;
  sceneGridImages: string[];
  sceneGridTitle: string;

  // Canvas actions
  handleDeleteCanvasItem: (itemId: string) => void;
  handleEditCanvasItemName: (itemId: string, name: string) => void;
  handleToggleMinimize: (itemId: string) => void;
  handleReorderCanvasItem: (fromIndex: number, toIndex: number) => void;
  handleAddToHeader: (itemId: string) => void;
  handleRemoveFromHeader: (itemId: string) => void;
  handleReorderHeaderItem: (fromIndex: number, toIndex: number) => void;
  handleRemoveCharacterFromScene: (sceneItemId: string, charRefId: string) => void;
  handleDismissVideoError: (itemId: string) => void;

  // Aspect ratio class
  canvasAspectClass: string;

  // Content check
  hasContent: boolean;

  // Focus
  focusOnItem: (itemId: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;

  // Save status
  saveStatus: 'saved' | 'saving' | 'unsaved';
  handleManualSave: () => Promise<void>;
}
