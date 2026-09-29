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
 * useInstantCharacterGroup.ts — 即时创作角色相关子 hook 聚合
 *
 * 聚合角色编辑、图片生成(头像/形象照/多视图)等能力。
 * (原版的 TTS 发音人预览/变更能力已随后端语音服务一起移除)
 */
import { useInstantCharacterEditor } from './useInstantCharacterEditor';
import { useInstantImageGeneration } from './useInstantImageGeneration';
import type {
  InstantCharacter,
  InstantScene,
  InstantSegment,
} from '@/shared/types/project';

interface UseInstantCharacterGroupOptions {
  characters: InstantCharacter[];
  setCharacters: React.Dispatch<React.SetStateAction<InstantCharacter[]>>;
  saveCharacters: (next: InstantCharacter[]) => void;
  scenes: InstantScene[];
  setScenes: React.Dispatch<React.SetStateAction<InstantScene[]>>;
  saveScenes: (next: InstantScene[]) => void;
  segments: InstantSegment[];
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  saveSegments: (nextSegments: InstantSegment[]) => void;
  selectedImageModel: string;
  projectId: string | undefined;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  syncSegmentPromptImages: (chars: InstantCharacter[], scns: InstantScene[]) => void;
  multiViewChar: InstantCharacter | null;
  setMultiViewChar: React.Dispatch<React.SetStateAction<InstantCharacter | null>>;
}

export function useInstantCharacterGroup({
  characters,
  setCharacters,
  saveCharacters,
  scenes,
  setScenes,
  saveScenes,
  segments,
  setSegments,
  saveSegments,
  selectedImageModel,
  projectId,
  videoApiPreviewMode,
  showApiPreview,
  syncSegmentPromptImages,
  multiViewChar,
  setMultiViewChar,
}: UseInstantCharacterGroupOptions) {
  const characterEditor = useInstantCharacterEditor({
    characters,
    saveCharacters,
    segments,
    saveSegments,
  });

  const imageGeneration = useInstantImageGeneration({
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
    videoApiPreviewMode,
    showApiPreview,
    syncSegmentPromptImages,
    multiViewChar,
    setMultiViewChar,
  });

  return {
    ...characterEditor,
    ...imageGeneration,
  };
}

export type UseInstantCharacterGroupReturn = ReturnType<typeof useInstantCharacterGroup>;
