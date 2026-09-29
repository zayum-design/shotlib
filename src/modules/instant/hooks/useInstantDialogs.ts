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

import { useState, useCallback } from 'react';
import type { NewCharacter } from '@/modules/instant/components/CreateCharacterDialog';
import type { NewScene } from '@/modules/instant/components/CreateSceneDialog';
import type { InstantCharacter, InstantScene } from '@/shared/types/project';

export function useInstantDialogs({
  characters,
  saveCharacters,
  scenes,
  saveScenes,
}: {
  characters: InstantCharacter[];
  saveCharacters: (next: InstantCharacter[]) => void;
  scenes: InstantScene[];
  saveScenes: (next: InstantScene[]) => void;
}) {
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false);
  const [sceneDialogOpen, setSceneDialogOpen] = useState(false);

  const handleCreateCharacter = useCallback(
    (character: NewCharacter) => {
      const next = [...characters, character];
      saveCharacters(next);
      setCharacterDialogOpen(false);
    },
    [characters, saveCharacters]
  );

  const handleCreateScene = useCallback(
    (scene: NewScene) => {
      const next = [...scenes, scene];
      saveScenes(next);
      setSceneDialogOpen(false);
    },
    [scenes, saveScenes]
  );

  return {
    characterDialogOpen,
    setCharacterDialogOpen,
    sceneDialogOpen,
    setSceneDialogOpen,
    handleCreateCharacter,
    handleCreateScene,
  };
}
