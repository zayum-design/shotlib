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

import React, { useState } from 'react';
import { Spin } from 'antd';
import { Image as ImageIcon, ChevronLeft, ChevronRight, X, Bookmark } from 'lucide-react';
import type { CanvasItem, InstantScene } from '@/shared/types/project';
import { createLocalAsset } from '@/shared/api/userMaterialApi';
import { message } from '@/shared/utils/message';

interface CanvasSceneVideoPanelProps {
  item: CanvasItem;
  scene: InstantScene;
  canvasAspectClass: string;
  videoControl: React.ReactNode;
  onVideoIndexChange: (itemId: string, index: number) => void;
  onDismissVideoError?: (itemId: string) => void; // 清除错误提示
}

/**
 * Canvas 场景卡片右侧：视频/场景图预览 + 控制
 */
export const CanvasSceneVideoPanel: React.FC<CanvasSceneVideoPanelProps> = ({
  item,
  scene,
  canvasAspectClass,
  videoControl,
  onVideoIndexChange,
  onDismissVideoError,
}) => {
  const [isAddingVideoToLibrary, setIsAddingVideoToLibrary] = useState(false);

  // 将当前生成视频添加到个人素材库
  const handleAddVideoToLibrary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.videoUrl) return;
    setIsAddingVideoToLibrary(true);
    try {
      // 构造素材库 data：写入生成视频的提示词及相关元数据
      const data = {
        prompt: item.customPrompt || item.generatedPrompt || '',
        videoModel: item.videoModel,
        videoGenerationMode: item.videoGenerationMode,
        videoDuration: item.videoDuration,
        videoResolution: item.videoResolution,
        shots: item.shots?.map((s) => ({ prompt: s.prompt })) || [],
        sceneName: scene.name,
      };
      const res = await createLocalAsset(item.videoUrl, 'video', scene.name || '生成视频', undefined, data);
      if (res.success && res.data) {
        message.success('已添加到个人素材库');
      } else {
        message.error(res.message || '添加失败');
      }
    } catch (err: any) {
      message.error(err?.message || '添加失败');
    } finally {
      setIsAddingVideoToLibrary(false);
    }
  };

  return (
    <div className="flex flex-col flex-shrink-0 gap-2 w-[307px]">
      {item.videoUrl && !item.isGeneratingVideo ? (
        <div
          className={`rounded-lg bg-bg-tertiary overflow-hidden relative group ${canvasAspectClass}`}
        >
          <video
            src={item.videoUrl}
            controls
            className="w-full h-full object-contain"
            onMouseDown={(e) => e.stopPropagation()}
          />
          {/* 添加到素材库按钮 */}
          <button
            onClick={handleAddVideoToLibrary}
            disabled={isAddingVideoToLibrary}
            title="添加到我的素材库"
            className="absolute top-2 right-2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto"
          >
            {isAddingVideoToLibrary ? (
              <Spin size="small" />
            ) : (
              <Bookmark size={16} />
            )}
          </button>
          {/* 多个视频切换箭头 */}
          {item.videoUrls && item.videoUrls.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const currentIndex = item.currentVideoIndex || 0;
                  const prevIndex = currentIndex > 0 ? currentIndex - 1 : item.videoUrls!.length - 1;
                  onVideoIndexChange(item.id, prevIndex);
                }}
                className="absolute left-2 top-1/2 transform -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors z-10"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const currentIndex = item.currentVideoIndex || 0;
                  const nextIndex = currentIndex < item.videoUrls!.length - 1 ? currentIndex + 1 : 0;
                  onVideoIndexChange(item.id, nextIndex);
                }}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors z-10"
              >
                <ChevronRight size={16} />
              </button>
              <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 px-2 py-1 rounded-full bg-black/50 text-white text-xs">
                {(item.currentVideoIndex || 0) + 1} / {item.videoUrls.length}
              </div>
            </>
          )}
        </div>
      ) : scene.imageUrl ? (
        <div
          className={`rounded-lg bg-bg-tertiary overflow-hidden relative ${canvasAspectClass}`}
        >
          <img src={scene.imageUrl} alt={scene.name} className="w-full h-full object-cover" />
          {item.isGeneratingVideo && (
            <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
              <div className="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-white">视频生成中...</span>
            </div>
          )}
          {!item.isGeneratingVideo && item.videoGenerationFailed && (
            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
              <span className="text-base text-red-400 font-medium">生成失败</span>
              <span className="text-xs text-white/80">请点击下方按钮重试</span>
            </div>
          )}
        </div>
      ) : (
        <div
          className={`rounded-lg bg-bg-tertiary flex flex-col items-center justify-center gap-2 ${canvasAspectClass}`}
        >
          {item.isGeneratingVideo ? (
            <>
              <div className="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-text-muted">视频生成中...</span>
            </>
          ) : item.videoGenerationFailed ? (
            <>
              <span className="text-base text-red-400 font-medium">生成失败</span>
              <span className="text-xs text-text-muted">请点击下方按钮重试</span>
            </>
          ) : (
            <ImageIcon size={24} className="text-text-muted" />
          )}
        </div>
      )}
      {videoControl}

      {/* 错误信息提示（可关闭） */}
      {item.videoGenerationFailed && item.videoGenerationError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-start gap-2">
          <span className="text-red-400 text-xs flex-1 break-all">{item.videoGenerationError}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismissVideoError?.(item.id);
            }}
            className="text-red-400 hover:text-red-300 flex-shrink-0 transition-colors"
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
