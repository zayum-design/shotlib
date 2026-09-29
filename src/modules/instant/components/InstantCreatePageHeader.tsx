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

import React, { useRef, useState } from 'react';
import { Button, Dropdown, Tooltip } from 'antd';
import {
  Film,
  MoreHorizontal,
  MonitorPlay,
  Download,
  Upload,
  Plus,
  Loader2,
  Image as ImageIcon,
  X,
  Folder,
} from 'lucide-react';
import { HoverImagePreview, type HoverPreviewState } from '@/shared/components/ui/HoverImagePreview';
import type { CanvasItem } from '@/shared/types/project';
import type { UseInstantCreatePageReturn } from '../hooks/UseInstantCreatePageReturn';
import { ProjectAssetDrawer } from './ProjectAssetDrawer';
import { message } from '@/shared/utils/message';

interface InstantCreatePageHeaderProps {
  page: UseInstantCreatePageReturn;
  isDragOverHeader: boolean;
  setIsDragOverHeader: (v: boolean) => void;
  dragEnterCounterRef: React.MutableRefObject<number>;
  dragOverIndex: number | null;
  setDragOverIndex: (v: number | null) => void;
  dragOverIndexRef: React.MutableRefObject<number | null>;
  draggedIndexRef: React.MutableRefObject<number | null>;
  sceneHoverPreview: HoverPreviewState | null;
  setSceneHoverPreview: (v: HoverPreviewState | null) => void;
  isSyncing: boolean;
  handleDownloadData: () => Promise<void>;
  handleImportData: () => void;
  handleOpenPreview: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const InstantCreatePageHeader: React.FC<InstantCreatePageHeaderProps> = ({
  page,
  isDragOverHeader,
  setIsDragOverHeader,
  dragEnterCounterRef,
  dragOverIndex,
  setDragOverIndex,
  dragOverIndexRef,
  draggedIndexRef,
  sceneHoverPreview,
  setSceneHoverPreview,
  isSyncing,
  handleDownloadData,
  handleImportData,
  handleOpenPreview,
  fileInputRef,
  handleFileSelected,
}) => {
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  return (
    <>
      <header className="border-b border-border bg-bg-secondary/80 backdrop-blur-sm sticky top-0 z-50 h-16 flex-shrink-0 relative">
        <div className="w-full px-6 h-full">
          <div className="flex items-center justify-between h-full gap-4">
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center">
                  <Film size={20} className="text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-text-primary">
                    {page.activeSegment?.name || '片段'}
                  </h1>
                  <p className="text-xs text-text-muted">
                    {page.currentProject?.name || '未命名项目'}
                  </p>
                </div>
                <Dropdown menu={{ items: page.segmentMenuItems }} placement="bottomLeft">
                  <Button
                    type="text"
                    icon={<MoreHorizontal size={18} />}
                    className="text-text-secondary hover:text-text-primary"
                  />
                </Dropdown>
              </div>
            </div>

            {/* 当前场景图片列表 */}
            <div
              className={`flex-1 min-w-0 flex items-center gap-2 overflow-x-auto no-drag self-stretch rounded-lg transition-colors ${isDragOverHeader ? 'bg-accent-primary/10 ring-2 ring-accent-primary/50' : ''}`}
              onDragEnter={(e) => {
                e.preventDefault();
                dragEnterCounterRef.current += 1;
                setIsDragOverHeader(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                dragEnterCounterRef.current -= 1;
                if (dragEnterCounterRef.current <= 0) {
                  dragEnterCounterRef.current = 0;
                  setIsDragOverHeader(false);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                const container = e.currentTarget;
                const itemElements = Array.from(container.querySelectorAll('[data-scene-item]'));
                const mouseX = e.clientX;
                let targetIndex = 0;
                for (let i = 0; i < itemElements.length; i++) {
                  const rect = (itemElements[i] as HTMLElement).getBoundingClientRect();
                  const centerX = rect.left + rect.width / 2;
                  if (mouseX < centerX) {
                    targetIndex = i;
                    break;
                  }
                  targetIndex = i + 1;
                }
                dragOverIndexRef.current = targetIndex;
                setDragOverIndex(targetIndex);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragEnterCounterRef.current = 0;
                setIsDragOverHeader(false);

                const dragDataSnapshot = page.dragDataRef.current;

                let data: { type: string; itemId?: string; refId?: string } | null = null;
                try {
                  let raw = e.dataTransfer?.getData('text/plain');
                  if (!raw) raw = e.dataTransfer?.getData('Text');
                  if (!raw) raw = e.dataTransfer?.getData('text');
                  if (raw) {
                    data = JSON.parse(raw);
                  }
                } catch {
                  // ignore
                }
                if (!data && dragDataSnapshot) {
                  data = { type: dragDataSnapshot.type, refId: dragDataSnapshot.refId };
                }

                if (data) {
                  if (data.type === 'headerScene' && data.itemId) {
                    page.handleAddToHeader(data.itemId);
                    draggedIndexRef.current = null;
                    dragOverIndexRef.current = null;
                    setDragOverIndex(null);
                    return;
                  }
                  if (data.type === 'scene' && data.refId) {
                    const matchingItems = page.canvasItems.filter(
                      (item): item is CanvasItem & { type: 'scene' } =>
                        item.type === 'scene' && item.refId === data.refId
                    );
                    if (matchingItems.length === 0) {
                      message.warning('当前片段中不存在该场景');
                      draggedIndexRef.current = null;
                      dragOverIndexRef.current = null;
                      setDragOverIndex(null);
                      return;
                    }
                    const targetItem = matchingItems[0];
                    if (!targetItem.videoUrl) {
                      message.warning('生成视频才能拖入');
                      draggedIndexRef.current = null;
                      dragOverIndexRef.current = null;
                      setDragOverIndex(null);
                      return;
                    }
                    page.handleAddToHeader(targetItem.id);
                    draggedIndexRef.current = null;
                    dragOverIndexRef.current = null;
                    setDragOverIndex(null);
                    return;
                  }
                }

                const fromIdx = draggedIndexRef.current;
                const toIdx = dragOverIndexRef.current;
                if (fromIdx !== null && toIdx !== null && fromIdx !== toIdx) {
                  page.handleReorderHeaderItem(fromIdx, toIdx);
                }
                draggedIndexRef.current = null;
                dragOverIndexRef.current = null;
                setDragOverIndex(null);
              }}
            >
              {(() => {
                const headerSceneItems = page.canvasItems
                  .filter((item): item is CanvasItem & { type: 'scene' } => item.type === 'scene' && item.headerOrder !== undefined)
                  .sort((a, b) => (a.headerOrder || 0) - (b.headerOrder || 0));
                const aspectClass =
                  page.currentProject?.aspectRatio === '9:16'
                    ? 'aspect-[9/16]'
                    : page.currentProject?.aspectRatio === '21:9'
                      ? 'aspect-[21/9]'
                      : 'aspect-[16/9]';
                return (
                  <>
                    {headerSceneItems.map((item, index) => {
                      const scene = page.scenes.find((s) => s.id === item.refId);
                      if (!scene) return null;
                      return (
                        <div key={item.id} data-scene-item className="flex items-center gap-2">
                          {dragOverIndex === index && (
                            <div className="w-1 h-10 bg-accent-primary rounded-full flex-shrink-0" />
                          )}
                          <div className="relative group">
                            <div
                              draggable
                              className={`h-10 ${aspectClass} rounded-lg overflow-hidden bg-bg-tertiary flex-shrink-0 border border-border hover:border-accent-primary cursor-grab active:cursor-grabbing ${dragOverIndex === index ? 'ring-2 ring-accent-primary' : ''}`}
                              title={scene.name}
                              onMouseEnter={(e) => {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                if (scene.imageUrl) {
                                  setSceneHoverPreview({
                                    src: scene.imageUrl,
                                    name: scene.name,
                                    type: 'scene',
                                    x: rect.left + rect.width / 2,
                                    y: rect.top,
                                  });
                                }
                              }}
                              onMouseLeave={() => {
                                setSceneHoverPreview(null);
                              }}
                              onClick={() => page.focusOnItem(item.id)}
                              onDragStart={() => {
                                draggedIndexRef.current = index;
                                dragOverIndexRef.current = null;
                                setDragOverIndex(null);
                              }}
                              onDragEnd={() => {
                                draggedIndexRef.current = null;
                                dragOverIndexRef.current = null;
                                setDragOverIndex(null);
                              }}
                            >
                              <div className="w-full h-full relative">
                                {scene.imageUrl ? (
                                  <img
                                    src={scene.imageUrl}
                                    alt={scene.name}
                                    className="w-full h-full object-cover group-hover:brightness-75 transition-all duration-200"
                                    draggable={false}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-bg-tertiary">
                                    <ImageIcon size={14} className="text-text-muted" />
                                  </div>
                                )}
                                <button
                                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 bg-black/50 hover:bg-red-500 backdrop-blur-sm text-white rounded-full ring-1 ring-white/30 shadow-lg cursor-pointer z-10"
                                  title="从标题栏移除"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    page.handleRemoveFromHeader(item.id);
                                  }}
                                >
                                  <X size={12} strokeWidth={2.5} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {dragOverIndex !== null && dragOverIndex === headerSceneItems.length && (
                      <div className="w-1 h-10 bg-accent-primary rounded-full flex-shrink-0" />
                    )}
                  </>
                );
              })()}
            </div>

            <HoverImagePreview preview={sceneHoverPreview} />

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* 保存状态指示器 */}
              <Tooltip title={page.saveStatus === 'unsaved' ? '点击保存' : page.saveStatus === 'saving' ? '保存中...' : '已保存'}>
                {page.saveStatus === 'unsaved' ? (
                  <button
                    onClick={page.handleManualSave}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors bg-amber-500/10 text-amber-600 border border-amber-500/20 hover:bg-amber-500/20 cursor-pointer"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    未保存
                  </button>
                ) : (
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    page.saveStatus === 'saving'
                      ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                      : 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      page.saveStatus === 'saving' ? 'bg-blue-500 animate-pulse' : 'bg-emerald-500'
                    }`} />
                    {page.saveStatus === 'saving' ? '保存中' : '已保存'}
                  </div>
                )}
              </Tooltip>

              <Button icon={<MonitorPlay size={16} />} onClick={handleOpenPreview}>
                预览片段
              </Button>
              <Button
                icon={isSyncing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                onClick={handleDownloadData}
                loading={isSyncing}
              >
                {isSyncing ? '下载中...' : '下载数据'}
              </Button>
              <Button icon={<Upload size={16} />} onClick={handleImportData}>
                导入数据
              </Button>

              <Button type="primary" icon={<Plus size={16} />} onClick={page.handleNewSegment}>
                新建片段
              </Button>

              <Button icon={<Folder size={16} />} onClick={() => setAssetDrawerOpen(true)}>
                项目资产库
              </Button>
              <ProjectAssetDrawer
                open={assetDrawerOpen}
                onClose={() => setAssetDrawerOpen(false)}
                characters={page.characters}
                scenes={page.scenes}
                segments={page.segments}
              />

              {/* 关闭项目（返回短剧项目列表） */}
              <button
                type="button"
                onClick={() => page.navigate('/create/drama')}
                title="关闭项目"
                className="flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
    </>
  );
};
