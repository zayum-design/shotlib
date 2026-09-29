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

import { useState } from 'react';
import { Modal, Tag } from 'antd';
import type { DevelopmentCategory, DevelopmentDirection } from '../hooks/useDevelopmentDirections';

interface DevelopmentDirectionModalProps {
  open: boolean;
  onClose: () => void;
  categories: DevelopmentCategory[];
  loading?: boolean;
  onSelect: (category: DevelopmentCategory, direction: DevelopmentDirection) => void;
}

/**
 * 分集发展方向选择弹窗
 * 点击顶部分类后，直接在下方展示该分类下的具体方向
 */
export function DevelopmentDirectionModal({
  open,
  onClose,
  categories,
  loading,
  onSelect,
}: DevelopmentDirectionModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<DevelopmentCategory | null>(null);

  return (
    <Modal
      title="选择分集发展方向"
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
    >
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {loading ? (
          <div className="text-center py-8 text-text-muted">加载中...</div>
        ) : categories.length === 0 ? (
          <div className="text-center py-8 text-text-muted">暂无数据</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {categories.map((category) => {
                const isSelected = selectedCategory?.id === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategory(category)}
                    className={`
                      px-3 py-4 rounded-lg border text-sm font-medium transition-all
                      ${isSelected
                        ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                        : 'bg-bg-tertiary border-border text-text-secondary hover:border-accent-primary hover:text-accent-primary'
                      }
                    `}
                  >
                    {category.name}
                  </button>
                );
              })}
            </div>

            {selectedCategory && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {selectedCategory.name}
                  </span>
                  <span className="text-xs text-text-muted">请选择具体方向</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedCategory.directions.map((direction, idx) => (
                    <button
                      key={direction.id}
                      type="button"
                      onClick={() => onSelect(selectedCategory, direction)}
                      className={`text-left px-4 py-3 rounded-lg border transition-all text-sm ${
                        direction.isEnding
                          ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
                          : 'border-border bg-bg-tertiary text-text-secondary hover:border-accent-primary hover:text-accent-primary'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{idx + 1}. {direction.name}</span>
                        {direction.isEnding && (
                          <Tag color="orange" className="text-xs">大结局</Tag>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
