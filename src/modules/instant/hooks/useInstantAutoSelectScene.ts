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

import { useEffect } from 'react';
import type { InstantSegment } from '@/shared/types/project';

/**
 * 切换片段时，如果当前选中的场景不在新片段中，自动选中第一个场景。
 */
export function useInstantAutoSelectScene({
  activeSegment,
  selectedSceneItemId,
  applySelectedScene,
}: {
  activeSegment: InstantSegment | undefined;
  selectedSceneItemId: string | null;
  applySelectedScene: (id: string | null) => void;
}) {
  const activeSegmentId = activeSegment?.id;
  useEffect(() => {
    if (!activeSegment) return;
    const sceneItems = activeSegment.canvasItems.filter((i) => i.type === 'scene');
    if (sceneItems.length === 0) {
      applySelectedScene(null);
      return;
    }
    const exists = sceneItems.some((i) => i.id === selectedSceneItemId);
    if (!exists) {
      applySelectedScene(sceneItems[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegmentId, selectedSceneItemId, activeSegment, applySelectedScene]);
}
