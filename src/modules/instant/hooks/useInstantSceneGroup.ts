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
 * useInstantSceneGroup.ts — 即时创作场景与画布项管理子 hook 聚合
 *
 * 聚合场景编辑、画布项管理等能力。
 */
import { useInstantSceneEditor } from './useInstantSceneEditor';
import { useInstantCanvasItemManager } from './useInstantCanvasItemManager';
import type {
  InstantCharacter,
  InstantScene,
  InstantSegment,
  CanvasItem,
} from '@/shared/types/project';
import type { ModelConfig } from '@/shared/types/index';

interface UseInstantSceneGroupOptions {
  scenes: InstantScene[];
  setScenes: React.Dispatch<React.SetStateAction<InstantScene[]>>;
  saveScenes: (next: InstantScene[]) => void;
  segments: InstantSegment[];
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  saveSegments: (nextSegments: InstantSegment[]) => void;
  characters: InstantCharacter[];
  activeSegment: InstantSegment | undefined;
  activeSegmentId: string | null;
  selectedSceneItemId: string | null;
  applySelectedScene: (id: string | null) => void;
  selectedImageModel: string;
  projectId: string | undefined;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  syncSegmentPromptImages: (chars: InstantCharacter[], scns: InstantScene[]) => void;
  canvasItems: CanvasItem[];
  videoModels: ModelConfig[];
  currentProjectAspectRatio?: string;
}

export function useInstantSceneGroup({
  scenes,
  setScenes,
  saveScenes,
  segments,
  setSegments,
  saveSegments,
  characters,
  activeSegment,
  activeSegmentId,
  selectedSceneItemId,
  applySelectedScene,
  selectedImageModel,
  projectId,
  videoApiPreviewMode,
  showApiPreview,
  syncSegmentPromptImages,
  canvasItems,
  videoModels,
  currentProjectAspectRatio,
}: UseInstantSceneGroupOptions) {
  const sceneEditor = useInstantSceneEditor({
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
  });

  const canvasItemManager = useInstantCanvasItemManager({
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
  });

  return {
    ...sceneEditor,
    ...canvasItemManager,
  };
}

export type UseInstantSceneGroupReturn = ReturnType<typeof useInstantSceneGroup>;
