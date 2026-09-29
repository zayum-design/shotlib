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
import type { InstantSegment, InstantScene, InstantCharacter, CanvasItem } from '@/shared/types/project';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';

const generateScenePrompt = (sceneName: string, charNames: string[]) => {
  if (charNames.length === 0) return '';
  return sceneName ? `${charNames.join('和')}在${sceneName}` : charNames.join('和');
};

interface UseInstantCanvasDropOptions {
  dragDataRef: React.MutableRefObject<{ type: 'character' | 'scene'; refId: string } | null>;
  activeSegmentId: string | null;
  selectedSceneItemId: string | null;
  scenes: InstantScene[];
  characters: InstantCharacter[];
  projectId: string | undefined;
  applySelectedScene: (id: string | null) => void;
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
}

export function useInstantCanvasDrop({
  dragDataRef,
  activeSegmentId,
  selectedSceneItemId,
  scenes,
  characters,
  projectId,
  applySelectedScene,
  setSegments,
}: UseInstantCanvasDropOptions) {
  useEffect(() => {
    const handleNativeDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleNativeDrop = (e: DragEvent) => {
      e.preventDefault();
      if (!activeSegmentId) return;

      let data = dragDataRef.current;
      if (!data) {
        try {
          const raw = e.dataTransfer?.getData('text/plain');
          if (raw) data = JSON.parse(raw);
        } catch {
          // ignore
        }
      }
      if (!data) return;

      if (data.type === 'scene') {
        const scene = scenes.find((s) => s.id === data!.refId);
        const newItem: CanvasItem = {
          id: crypto.randomUUID(),
          type: 'scene',
          refId: data.refId,
          name: scene?.name,
          x: 0,
          y: 0,
          characters: [],
        };
        setSegments((prev) => {
          const next = prev.map((s) =>
            s.id === activeSegmentId
              ? { ...s, canvasItems: [...(s.canvasItems || []), newItem] }
              : s
          );
          if (projectId) {
            persistInstantData(projectId, { instantSegments: next });
          }
          return next;
        });
        // 自动选中新添加的场景
        applySelectedScene(newItem.id);
      } else if (data.type === 'character') {
        // 新布局：查找释放位置是否在场景详情区域内，或默认添加到当前选中的场景
        const target = document
          .elementsFromPoint(e.clientX, e.clientY)
          .find((el) => el.closest('.scene-canvas-item') || el.closest('.scene-detail-content')) as HTMLElement | undefined;
        const sceneItemId =
          target?.closest('.scene-canvas-item')?.getAttribute('data-item-id') ||
          selectedSceneItemId;
        if (!sceneItemId) return;

        const droppedChar = characters.find((c) => c.id === data!.refId);
        if (!droppedChar) return;

        setSegments((prev) => {
          const next = prev.map((s) => {
            if (s.id !== activeSegmentId) return s;
            return {
              ...s,
              canvasItems: (s.canvasItems || []).map((item) => {
                if (item.id !== sceneItemId || item.type !== 'scene') return item;
                if (item.characters?.includes(data!.refId)) return item;
                const nextChars = [...(item.characters || []), data!.refId];
                const scene = scenes.find((sc) => sc.id === item.refId);
                const charNames = nextChars
                  .map((cid) => characters.find((c) => c.id === cid)?.name)
                  .filter(Boolean) as string[];

                // 构建角色标签并追加到提示词
                const tag = `@<role character-id="${droppedChar.id}">${droppedChar.name}</role>`;
                const basePrompt = item.customPrompt || item.generatedPrompt || generateScenePrompt(scene?.name || '', charNames) || '';
                const newPrompt = basePrompt ? `${basePrompt} ${tag}` : tag;

                return {
                  ...item,
                  characters: nextChars,
                  generatedPrompt: generateScenePrompt(scene?.name || '', charNames),
                  customPrompt: newPrompt,
                };
              }),
            };
          });
          if (projectId) {
            persistInstantData(projectId, { instantSegments: next });
          }
          return next;
        });
      }
      dragDataRef.current = null;
    };

    document.addEventListener('dragover', handleNativeDragOver);
    document.addEventListener('drop', handleNativeDrop);
    return () => {
      document.removeEventListener('dragover', handleNativeDragOver);
      document.removeEventListener('drop', handleNativeDrop);
    };
  }, [activeSegmentId, projectId, scenes, characters, selectedSceneItemId, applySelectedScene, setSegments, dragDataRef]);
}
