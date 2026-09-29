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

import { Image } from 'antd';
import { useState } from 'react';

interface ImagePreviewProps {
  /** 图片 URL 数组 */
  images: string[];
  /** 是否显示预览 */
  visible: boolean;
  /** 当前预览的图片索引 */
  currentIndex: number;
  /** 关闭预览回调 */
  onClose: () => void;
  /** 预览标题（用于图片 alt） */
  title?: string;
  /** 预览层 zIndex（在其他弹窗之上使用时需要调高，默认 antd 1000） */
  zIndex?: number;
}

/**
 * 全局统一图片预览组件
 *
 * 基于 Ant Design Image.PreviewGroup 实现，提供与任务历史中一致的
 * 图片放大预览体验：支持缩放、左右箭头切换、键盘导航。
 *
 * 使用方式：在组件中渲染此组件（图片元素会被隐藏，仅提供预览能力），
 * 通过 visible / currentIndex 控制预览开关和当前图片。
 *
 * 示例：
 * ```tsx
 * const [previewOpen, setPreviewOpen] = useState(false);
 * const [previewIndex, setPreviewIndex] = useState(0);
 *
 * // 点击缩略图时打开预览
 * <img src={url} onClick={() => { setPreviewIndex(0); setPreviewOpen(true); }} />
 *
 * // 预览组件（图片隐藏，只提供预览层）
 * <ImagePreview
 *   images={imageUrls}
 *   visible={previewOpen}
 *   currentIndex={previewIndex}
 *   onClose={() => setPreviewOpen(false)}
 *   title="场景图"
 * />
 * ```
 */
export const ImagePreview: React.FC<ImagePreviewProps> = ({
  images,
  visible,
  currentIndex,
  onClose,
  title,
  zIndex,
}) => {
  // current 受控会导致切换失效（rc-image 切换时 current 被回退到 props 值），
  // 内部用 state 管理：每次从关闭切到打开时同步到 currentIndex，切换时 onChange 回写。
  const [internalCurrent, setInternalCurrent] = useState(currentIndex);
  const [lastVisible, setLastVisible] = useState(visible);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) setInternalCurrent(currentIndex);
  }

  if (images.length === 0) return null;

  return (
    <>
      {/* 预览打开时注入全黑背景样式 */}
      {visible && (
        <style>{`
          .image-preview-dark .ant-image-preview-mask {
            background-color: #000 !important;
          }
        `}</style>
      )}
      <div className="hidden">
        <Image.PreviewGroup
          preview={{
            open: visible,
            current: internalCurrent,
            ...(zIndex !== undefined ? { zIndex } : {}),
            onOpenChange: (v) => {
              if (!v) onClose();
            },
            onChange: (cur: number) => setInternalCurrent(cur),
          }}
          classNames={{ popup: { root: 'image-preview-dark' } }}
        >
          {images.map((src, i) => (
            <Image
              key={i}
              src={src}
              alt={`${title || '图片'} ${i + 1}`}
              preview={{ mask: false }}
            />
          ))}
        </Image.PreviewGroup>
      </div>
    </>
  );
};

/**
 * 内联图片预览组
 *
 * 直接在页面上显示缩略图，点击可放大预览，支持组内左右切换。
 * 用于替代原来需要单独写 Image.PreviewGroup + Image 的场景。
 *
 * 示例：
 * ```tsx
 * <InlineImagePreview
 *   images={scene.imageUrls}
 *   imageClassName="h-[200px] w-auto object-contain rounded-lg"
 * />
 * ```
 */
interface InlineImagePreviewProps {
  images: string[];
  imageClassName?: string;
  containerClassName?: string;
  showMask?: boolean;
}

export const InlineImagePreview: React.FC<InlineImagePreviewProps> = ({
  images,
  imageClassName = 'h-[200px] w-auto object-contain rounded-lg border border-border',
  containerClassName = 'flex gap-2 flex-wrap',
  showMask = false,
}) => {
  if (images.length === 0) return null;

  return (
    <>
      <style>{`
        .image-preview-dark .ant-image-preview-mask {
          background-color: #000 !important;
        }
      `}</style>
      <Image.PreviewGroup
        preview={{ rootClassName: 'image-preview-dark' }}
      >
        <div className={containerClassName}>
          {images.map((src, i) => (
            <Image
              key={i}
              src={src}
              alt={`图片 ${i + 1}`}
              className={imageClassName}
              preview={{ mask: showMask }}
            />
          ))}
        </div>
      </Image.PreviewGroup>
    </>
  );
};
