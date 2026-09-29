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

import { useCallback } from 'react';
import type { InstantCharacter, InstantScene, InstantSegment } from '@/shared/types/project';
import { refreshSegmentsPromptImageUrls } from '@/modules/instant/utils/instantPromptUtils';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';

export function useInstantSyncSegmentImages({
  projectId,
  setSegments,
}: {
  projectId: string | undefined;
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
}) {
  const syncSegmentPromptImages = useCallback(
    (latestChars: InstantCharacter[], latestScenes: InstantScene[]) => {
      const pid = projectId;
      setSegments((prevSegs) => {
        const nextSegs = refreshSegmentsPromptImageUrls(prevSegs, latestChars, latestScenes);
        if (nextSegs === prevSegs) return prevSegs;
        if (pid) {
          persistInstantData(pid, { instantSegments: nextSegs });
        }
        return nextSegs;
      });
    },
    [projectId, setSegments]
  );

  return { syncSegmentPromptImages };
}
