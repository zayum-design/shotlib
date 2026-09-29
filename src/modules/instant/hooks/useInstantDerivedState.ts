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

import { useMemo } from 'react';
import type { InstantSegment, InstantScene } from '@/shared/types/project';

/**
 * 从 segments + activeSegmentId 派生出活跃片段、画布项、是否有内容。
 */
export function useInstantDerivedState({
  segments,
  activeSegmentId,
  scenes,
}: {
  segments: InstantSegment[];
  activeSegmentId: string | null;
  scenes: InstantScene[];
}) {
  const activeSegment = useMemo(
    () => segments.find((s) => s.id === activeSegmentId) || segments[0],
    [segments, activeSegmentId]
  );

  const canvasItems = activeSegment?.canvasItems || [];

  const hasContent = scenes.length > 0 || canvasItems.length > 0;

  return {
    activeSegment,
    canvasItems,
    hasContent,
  };
}
