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
import type { MenuProps } from 'antd';
import type { InstantSegment } from '@/shared/types/project';
import { message } from '@/shared/utils/message';

const createEmptySegment = (name: string): InstantSegment => ({
  id: crypto.randomUUID(),
  name,
  canvasItems: [],
  connections: [],
});

interface UseInstantSegmentManagerOptions {
  segments: InstantSegment[];
  saveSegments: (nextSegments: InstantSegment[]) => void;
  switchSegment: (id: string | null) => void;
  activeSegment: InstantSegment | undefined;
  renameValue: string;
  setRenameValue: (v: string) => void;
  setRenameModalOpen: (v: boolean) => void;
}

export function useInstantSegmentManager({
  segments,
  saveSegments,
  switchSegment,
  activeSegment,
  renameValue,
  setRenameValue,
  setRenameModalOpen,
}: UseInstantSegmentManagerOptions) {
  const handleNewSegment = useCallback(() => {
    const nextIndex = segments.length + 1;
    const newSegment = createEmptySegment(`片段${nextIndex}`);
    const next = [...segments, newSegment];
    saveSegments(next);
    switchSegment(newSegment.id);
  }, [segments, saveSegments, switchSegment]);

  const handleRenameSegment = useCallback(() => {
    if (!activeSegment || !renameValue.trim()) {
      setRenameModalOpen(false);
      return;
    }
    const next = segments.map((s) =>
      s.id === activeSegment.id ? { ...s, name: renameValue.trim() } : s
    );
    saveSegments(next);
    setRenameModalOpen(false);
  }, [activeSegment, renameValue, segments, saveSegments, setRenameModalOpen]);

  const handleDeleteSegment = useCallback(() => {
    if (!activeSegment) return;
    if (segments.length <= 1) {
      message.warning('至少保留一个片段');
      return;
    }
    const next = segments.filter((s) => s.id !== activeSegment.id);
    saveSegments(next);
    switchSegment(next[0].id);
  }, [activeSegment, segments, saveSegments, switchSegment]);

  const segmentMenuItems: MenuProps['items'] = [
    {
      key: 'rename',
      label: '重命名',
      onClick: () => {
        if (activeSegment) {
          setRenameValue(activeSegment.name);
          setRenameModalOpen(true);
        }
      },
    },
    {
      key: 'delete',
      label: '删除',
      onClick: handleDeleteSegment,
    },
  ];

  return {
    handleNewSegment,
    handleRenameSegment,
    handleDeleteSegment,
    segmentMenuItems,
  };
}
