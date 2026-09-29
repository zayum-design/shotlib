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
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { MoreVertical, Image as ImageIcon } from 'lucide-react';
import type { CanvasItem } from '@/shared/types/project';

interface InstantCreateSceneSiderProps {
  canvasItems: CanvasItem[];
  scenes: { id: string; name: string; imageUrl?: string }[];
  selectedSceneItemId: string | null;
  currentProjectAspectRatio?: string;
  focusOnItem: (itemId: string) => void;
  handleOpenItemRename: (itemId: string) => void;
  handleDeleteCanvasItem: (itemId: string) => void;
}

export const InstantCreateSceneSider: React.FC<InstantCreateSceneSiderProps> = ({
  canvasItems,
  scenes,
  selectedSceneItemId,
  currentProjectAspectRatio,
  focusOnItem,
  handleOpenItemRename,
  handleDeleteCanvasItem,
}) => {
  const sceneItems = canvasItems.filter((item): item is CanvasItem & { type: 'scene' } => item.type === 'scene');

  return (
    <div className="w-48 bg-bg-secondary border-r border-border overflow-y-auto flex-shrink-0 p-2 min-h-0">
      {sceneItems.map((item, index) => {
        const scene = scenes.find((s) => s.id === item.refId);
        if (!scene) return null;
        const isActive = item.id === selectedSceneItemId;
        const aspectRatio = currentProjectAspectRatio || '16:9';
        const sceneImgClass =
          aspectRatio === '9:16'
            ? 'w-8 aspect-[9/16]'
            : aspectRatio === '21:9'
              ? 'w-16 aspect-[21/9]'
              : 'w-12 aspect-[16/9]';
        return (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => {
              const data = { type: 'headerScene' as const, itemId: item.id };
              e.dataTransfer.clearData();
              e.dataTransfer.setData('text/plain', JSON.stringify(data));
              e.dataTransfer.setData('Text', JSON.stringify(data));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            className={`cursor-grab active:cursor-grabbing rounded-lg p-2 mb-2 border transition-all ${
              isActive
                ? 'bg-accent-primary/10 border-accent-primary'
                : 'bg-bg-tertiary border-border hover:border-accent-primary/50'
            }`}
            onClick={() => focusOnItem(item.id)}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-text-secondary">场次 {index + 1}</span>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'rename',
                      label: '重命名',
                      onClick: () => handleOpenItemRename(item.id),
                    },
                    {
                      key: 'delete',
                      label: '删除场次',
                      danger: true,
                      onClick: () => handleDeleteCanvasItem(item.id),
                    },
                  ] as MenuProps['items'],
                }}
                placement="bottomRight"
                trigger={['click']}
              >
                <Button
                  size="small"
                  type="text"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  icon={<MoreVertical size={12} />}
                  className="text-text-secondary hover:text-text-primary -mr-1 -mt-1 h-4 w-4 p-0"
                />
              </Dropdown>
            </div>
            <div className="flex items-center gap-2">
              {scene.imageUrl ? (
                <img
                  src={scene.imageUrl}
                  alt={scene.name}
                  className={`rounded overflow-hidden object-cover flex-shrink-0 ${sceneImgClass}`}
                  draggable={false}
                />
              ) : (
                <div className={`rounded bg-bg-primary flex items-center justify-center flex-shrink-0 ${sceneImgClass}`}>
                  <ImageIcon size={14} className="text-text-muted" />
                </div>
              )}
              <span className="text-sm text-text-primary truncate">{item.name || scene.name}</span>
            </div>
          </div>
        );
      })}
      {sceneItems.length === 0 && (
        <div className="text-xs text-text-muted text-center py-8 flex flex-col items-center gap-2">
          <ImageIcon size={24} className="opacity-40" />
          <span>没有任何场景</span>
          <span className="text-[10px]">请从左侧拖入场景</span>
        </div>
      )}
    </div>
  );
};
