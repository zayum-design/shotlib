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
import { Modal } from 'antd';
import type { InstantCharacter, InstantScene, InstantSegment } from '@/shared/types/project';

interface UseInstantCharacterEditorOptions {
  characters: InstantCharacter[];
  saveCharacters: (next: InstantCharacter[]) => void;
  segments: InstantSegment[];
  saveSegments: (nextSegments: InstantSegment[]) => void;
}

export function useInstantCharacterEditor({
  characters,
  saveCharacters,
  segments,
  saveSegments,
}: UseInstantCharacterEditorOptions) {
  // editingChar 保留：供角色编辑弹窗回填使用
  const [editingChar, setEditingChar] = useState<InstantCharacter | null>(null);

  const handleDeleteCharacter = useCallback(
    (char: InstantCharacter) => {
      Modal.confirm({
        title: '⚠ 确认删除角色？',
        content: `确定要删除角色 "${char.name}" 吗？\n\n该操作不可恢复，删除后该角色的头像、形象照、多视图以及所有引用此角色的片段都将被清理。`,
        okText: '确认删除',
        okButtonProps: { danger: true, size: 'middle' },
        cancelText: '取消',
        cancelButtonProps: { size: 'middle' },
        width: 420,
        centered: true,
        onOk: () => {
          const nextChars = characters.filter((c) => c.id !== char.id);
          saveCharacters(nextChars);
          const nextSegments = segments.map((s) => ({
            ...s,
            canvasItems: (s.canvasItems || []).map((item) =>
              item.type === 'scene'
                ? { ...item, characters: (item.characters || []).filter((id) => id !== char.id) }
                : item
            ),
          }));
          saveSegments(nextSegments);
        },
      });
    },
    [characters, segments, saveCharacters, saveSegments]
  );

  return {
    editingChar,
    setEditingChar,
    handleDeleteCharacter,
  };
}
