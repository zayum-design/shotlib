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

import { useState, useRef, useEffect } from 'react';
import type { InstantSegment } from '@/shared/types/project';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';

interface UseInstantCanvasDragOptions {
  activeSegmentId: string | null;
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
  projectId: string | undefined;
}

export function useInstantCanvasDrag({
  activeSegmentId,
  setSegments,
  projectId,
}: UseInstantCanvasDragOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setOffset] = useState({ x: 0, y: 0 });
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const offsetStartRef = useRef({ x: 0, y: 0 });
  const itemDragStartRef = useRef({ x: 0, y: 0 });
  const itemStartPosRef = useRef({ x: 0, y: 0 });

  // 全局拖拽 + 自动平移
  useEffect(() => {
    if (!isDraggingCanvas && !draggingItemId) return;

    const handleMove = (e: MouseEvent) => {
      if (draggingItemId) {
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;

          // 边界自动平移
          const edgeThreshold = 60;
          const panSpeed = 8;
          let panDx = 0,
            panDy = 0;
          if (mouseX < edgeThreshold) panDx = panSpeed;
          if (mouseX > rect.width - edgeThreshold) panDx = -panSpeed;
          if (mouseY < edgeThreshold) panDy = panSpeed;
          if (mouseY > rect.height - edgeThreshold) panDy = -panSpeed;

          if (panDx !== 0 || panDy !== 0) {
            setOffset((prev) => ({ x: prev.x + panDx, y: prev.y + panDy }));
            itemDragStartRef.current = {
              x: itemDragStartRef.current.x + panDx,
              y: itemDragStartRef.current.y + panDy,
            };
          }
        }

        const dx = e.clientX - itemDragStartRef.current.x;
        const dy = e.clientY - itemDragStartRef.current.y;
        setSegments((prevSegments) =>
          prevSegments.map((s) => {
            if (s.id !== activeSegmentId) return s;
            return {
              ...s,
              canvasItems: (s.canvasItems || []).map((item) =>
                item.id === draggingItemId
                  ? { ...item, x: itemStartPosRef.current.x + dx, y: itemStartPosRef.current.y + dy }
                  : item
              ),
            };
          })
        );
        return;
      }

      if (isDraggingCanvas) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        setOffset({
          x: offsetStartRef.current.x + dx,
          y: offsetStartRef.current.y + dy,
        });
      }
    };

    const handleUp = () => {
      if (draggingItemId && projectId) {
        setSegments((prev) => {
          persistInstantData(projectId, { instantSegments: prev });
          return prev;
        });
      }
      setIsDraggingCanvas(false);
      setDraggingItemId(null);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingCanvas, draggingItemId, activeSegmentId, projectId, setSegments]);

  return {
    containerRef,
    isDraggingCanvas,
    setIsDraggingCanvas,
    draggingItemId,
    setDraggingItemId,
    dragStartRef,
    offsetStartRef,
    itemDragStartRef,
    itemStartPosRef,
  };
}
