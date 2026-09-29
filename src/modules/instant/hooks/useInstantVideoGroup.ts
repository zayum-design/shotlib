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
 * useInstantVideoGroup.ts — 即时创作视频生成相关子 hook 聚合
 *
 * 聚合场景视频生成、首尾帧管理、合规检查等能力。
 */
import { useInstantVideoGeneration } from './useInstantVideoGeneration';
import { useInstantFirstLastFrameManager } from './useInstantFirstLastFrameManager';
import type {
  InstantCharacter,
  InstantScene,
  InstantSegment,
  CanvasItem,
} from '@/shared/types/project';
import type { ModelConfig } from '@/shared/types/index';

interface UseInstantVideoGroupOptions {
  activeSegment: InstantSegment | undefined;
  activeSegmentId: string | null;
  segments: InstantSegment[];
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  saveSegments: (nextSegments: InstantSegment[]) => void;
  characters: InstantCharacter[];
  scenes: InstantScene[];
  projectId: string | undefined;
  canvasItems: CanvasItem[];
  videoModels: ModelConfig[];
  defaultVideoModel: string;
  selectedImageModel: string;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  currentProjectAspectRatio?: string;
  saveCharacters: (next: InstantCharacter[]) => void;
}

export function useInstantVideoGroup({
  activeSegment,
  activeSegmentId,
  segments,
  setSegments,
  saveSegments,
  characters,
  scenes,
  projectId,
  canvasItems,
  videoModels,
  defaultVideoModel,
  selectedImageModel,
  videoApiPreviewMode,
  showApiPreview,
  currentProjectAspectRatio,
  saveCharacters,
}: UseInstantVideoGroupOptions) {
  const videoGeneration = useInstantVideoGeneration({
    activeSegment,
    activeSegmentId,
    segments,
    saveSegments,
    setSegments,
    characters,
    scenes,
    projectId,
    canvasItems,
    videoModels,
    defaultVideoModel,
    selectedImageModel,
    videoApiPreviewMode,
    showApiPreview,
    currentProjectAspectRatio,
    saveCharacters,
  });

  const firstLastFrameManager = useInstantFirstLastFrameManager({
    activeSegment,
    segments,
    saveSegments,
    setSegments,
    projectId,
    canvasItems,
    selectedImageModel,
    videoApiPreviewMode,
    showApiPreview,
    currentProjectAspectRatio,
    scenes,
    characters,
  });

  return {
    ...videoGeneration,
    ...firstLastFrameManager,
  };
}

export type UseInstantVideoGroupReturn = ReturnType<typeof useInstantVideoGroup>;
