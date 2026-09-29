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

import { useState } from 'react';
import type {
  InstantSegment,
  InstantCharacter,
  InstantScene,
} from '@/shared/types/project';

/**
 * 集中管理 InstantCreatePage 的所有本地状态。
 */
export function useInstantLocalState() {
  const [characters, setCharacters] = useState<InstantCharacter[]>([]);
  const [scenes, setScenes] = useState<InstantScene[]>([]);
  const [segments, setSegments] = useState<InstantSegment[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [selectedSceneItemId, setSelectedSceneItemId] = useState<string | null>(null);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [multiViewChar, setMultiViewChar] = useState<InstantCharacter | null>(null);

  return {
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
  };
}
