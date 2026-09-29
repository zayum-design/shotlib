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

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { HoverImagePreview, type HoverPreviewState } from '@/shared/components/ui/HoverImagePreview';

interface PromptHtmlDisplayProps {
  html: string;
  className?: string;
}

// 渲染 renderPromptHtml 生成的 HTML，并在 pill 上 hover 时弹出放大预览
export const PromptHtmlDisplay: React.FC<PromptHtmlDisplayProps> = ({
  html,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverPillRef = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState<HoverPreviewState | null>(null);

  // 预览显示期间，在 document 层监听 mousemove，
  // 鼠标一旦离开当前 pill（滑出 pill / 离开容器 / pill 被移除）立即关闭预览。
  useEffect(() => {
    if (!preview) return;
    const handleDocMouseMove = (ev: MouseEvent) => {
      const pill = hoverPillRef.current;
      if (!pill || !document.contains(pill)) {
        hoverPillRef.current = null;
        setPreview(null);
        return;
      }
      const rect = pill.getBoundingClientRect();
      const tol = 2;
      const inside =
        ev.clientX >= rect.left - tol &&
        ev.clientX <= rect.right + tol &&
        ev.clientY >= rect.top - tol &&
        ev.clientY <= rect.bottom + tol;
      if (!inside) {
        hoverPillRef.current = null;
        setPreview(null);
      }
    };
    document.addEventListener('mousemove', handleDocMouseMove);
    return () => document.removeEventListener('mousemove', handleDocMouseMove);
  }, [preview]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 进入 pill 时展示/切换预览；离开由 document 层 mousemove 监听负责。
    const target = e.target as HTMLElement;
    const pill = target.closest('[data-pill-type]') as HTMLElement | null;
    if (!pill) return;
    const src = pill.getAttribute('data-pill-img') || '';
    if (!src) return;
    const name = pill.getAttribute('data-pill-name') || '';
    const type = pill.getAttribute('data-pill-type') as 'role' | 'scene' | 'portrait';
    const rect = pill.getBoundingClientRect();
    hoverPillRef.current = pill;
    setPreview(prev => {
      const nextX = rect.left + rect.width / 2;
      const nextY = rect.top;
      if (prev && prev.src === src && prev.x === nextX && prev.y === nextY) return prev;
      return { src, name, type, x: nextX, y: nextY };
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoverPillRef.current = null;
    setPreview(null);
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        className={className}
        dangerouslySetInnerHTML={{ __html: html }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      <HoverImagePreview preview={preview} />
    </>
  );
};
