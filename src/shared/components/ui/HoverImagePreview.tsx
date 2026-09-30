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

import React from 'react';
import { createPortal } from 'react-dom';

export interface HoverPreviewState {
  src: string;
  name: string;
  type: 'role' | 'scene' | 'portrait';
  x: number;
  y: number;
  /** 图片资产 ID（保留字段，历史数据兼容） */
  assetId?: string;
  // 关键修复：无图时的文字说明（如"角色xxx尚未生成头像"），
  // 让用户清楚知道"@<role> 已解析为该角色，只是该角色还没图"
  text?: string;
}

interface HoverImagePreviewProps {
  preview: HoverPreviewState | null;
  /** 弹出方向，默认 'top'（标签上方） */
  placement?: 'top' | 'bottom';
  /** 边框样式，默认 'default'（统一灰边框），'colored' 按类型着色 */
  variant?: 'default' | 'colored';
  /** 图片尺寸，默认 'sm'。'sm' 用于卡片内预览，'lg' 用于编辑器内预览 */
  size?: 'sm' | 'lg';
  /** 是否显示名称，默认 true */
  showName?: boolean;
}

const borderClass = (type: HoverPreviewState['type'], variant: 'default' | 'colored') => {
  if (variant === 'default') return 'border border-border';
  switch (type) {
    case 'role':
      return 'border-2 border-accent-primary/60';
    case 'portrait':
      return 'border-2 border-purple-500/60';
    case 'scene':
      return 'border-2 border-emerald-500/60';
  }
};

const imgClassName = (type: HoverPreviewState['type'], size: 'sm' | 'lg') => {
  if (type === 'scene') return 'w-[150px] rounded';

  if (size === 'lg') return 'rounded';

  // sm: 卡片内紧凑形状
  switch (type) {
    case 'role':
      return 'w-32 h-32 rounded-full object-cover';
    case 'portrait':
      return 'w-36 rounded object-cover';
    default:
      return 'w-[150px] rounded';
  }
};

const imgStyle = (type: HoverPreviewState['type'], size: 'sm' | 'lg'): React.CSSProperties | undefined => {
  if (type === 'scene') return undefined;

  if (size === 'lg') return { width: 300, height: 220, objectFit: 'contain', display: 'block' };

  if (type === 'portrait') return { aspectRatio: '9 / 16' };

  return undefined;
};

/** 提示词标签悬停大图预览 — Portal 定位，支持上方/下方弹出、着色边框、尺寸切换 */
export const HoverImagePreview: React.FC<HoverImagePreviewProps> = ({
  preview,
  placement = 'top',
  variant = 'default',
  size = 'sm',
  showName = true,
}) => {
  if (!preview) return null;

  const isTop = placement === 'top';

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: preview.x,
        top: isTop ? preview.y - 8 : preview.y,
        transform: isTop ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
    >
      <div
        className={`rounded-xl overflow-hidden shadow-2xl bg-bg-secondary ${borderClass(preview.type, variant)}`}
        style={variant === 'default' ? { padding: '0.5rem', maxWidth: '20rem' } : undefined}
      >
        {/* 关键修复：无 src 但有 text 时，显示纯文字气泡作为降级提示 */}
        {!preview.src && preview.text ? (
          <div className="px-3 py-2 text-sm text-text-primary max-w-[20rem]">
            {preview.text}
          </div>
        ) : (
          <>
            <div className="relative inline-block">
              <img
                src={preview.src}
                alt={preview.name}
                className={imgClassName(preview.type, size)}
                style={imgStyle(preview.type, size)}
              />
            </div>
            {showName && (
              <div className="text-xs text-text-primary text-center mt-1.5 font-medium truncate max-w-[256px]">
                {preview.name}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};
