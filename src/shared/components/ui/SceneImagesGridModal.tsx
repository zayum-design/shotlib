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

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface SceneImagesGridModalProps {
  isOpen: boolean;
  images: string[];
  title?: string;
  aspectRatio?: string;
  onClose: () => void;
}

export const SceneImagesGridModal: React.FC<SceneImagesGridModalProps> = ({
  isOpen,
  images,
  onClose,
  title,
  aspectRatio = '16:9',
}) => {
  const aspectClass =
    aspectRatio === '9:16'
      ? 'aspect-[9/16]'
      : aspectRatio === '21:9'
        ? 'aspect-[21/9]'
        : 'aspect-[16/9]';
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [isOpen, onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen || images.length === 0) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
          onClick={onClose}
        >
          {/* 背景遮罩 */}
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" />

          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X size={24} className="text-white" />
          </button>

          {/* 标题 */}
          {title && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <span className="text-white/80 text-sm bg-black/50 px-3 py-1 rounded-full">
                {title}
              </span>
            </div>
          )}

          {/* 图片网格 */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative w-[90vw] max-w-6xl flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-4 gap-3 w-full h-full items-center">
              {images.map((img, index) => (
                <div
                  key={index}
                  className={`rounded-xl overflow-hidden bg-bg-secondary border border-border hover:border-accent-primary/50 transition-colors h-full w-full ${aspectClass}`}
                >
                  <img
                    src={img}
                    alt={`${title || '场景'} ${index + 1}`}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                </div>
              ))}
            </div>
          </motion.div>

          {/* 底部提示 */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-xs">
            ESC 关闭
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
