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
import type { InstantCharacter, InstantScene } from '@/shared/types/project';

export function useInstantAvatarPreview() {
  const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false);
  const [avatarPreviewChar, setAvatarPreviewChar] = useState<InstantCharacter | null>(null);

  const [scenePreviewOpen, setScenePreviewOpen] = useState(false);
  const [scenePreviewScene, setScenePreviewScene] = useState<InstantScene | null>(null);

  const handleOpenAvatarPreview = useCallback((char: InstantCharacter) => {
    setAvatarPreviewChar(char);
    setAvatarPreviewOpen(true);
  }, []);

  const handleOpenScenePreview = useCallback((scene: InstantScene) => {
    setScenePreviewScene(scene);
    setScenePreviewOpen(true);
  }, []);

  return {
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
  };
}
