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
import { Button, Select, Spin, Tooltip } from 'antd';
import { Edit3, Image as ImageIcon, ZoomIn } from 'lucide-react';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import type { Episode, Character, Scene } from '../../types';
import { renderVisualPrompt } from '@/modules/workflow/utils/workflowUtils';
import { stripPromptToText } from '@/modules/workflow/stores/workflowStore.episode.utils';
import { useResolvedImageUrl } from '@/modules/workflow/hooks/useWorkflowImageResolver';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';

interface ImageModel {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
}

interface EpisodeFirstLastFrameSectionProps {
  episode: Episode;
  aspectRatioClass: string;
  imageModels: ImageModel[];
  characters: Character[];
  scenes: Scene[];

  handleFrameModelChange: (modelId: string) => void;
  handleLastFrameModelChange: (modelId: string) => void;
  openFirstFrameModal: () => void;
  openLastFrameModal: () => void;
  openFirstLastFramePromptModal: () => void;
  handleGenerateFirstFrame: () => void;
  handleGenerateLastFrame: () => void;

  openImagePreview: (url: string, title: string) => void;
  handlePromptClick: (e: React.MouseEvent) => void;
  sanitizeHtml: (html: string) => string;
}

/**
 * 首尾帧 Tab 内容：首帧 + 尾帧 + 首尾帧视频提示词
 */
export const EpisodeFirstLastFrameSection: React.FC<EpisodeFirstLastFrameSectionProps> = ({
  episode,
  aspectRatioClass,
  imageModels,
  characters,
  scenes,
  handleFrameModelChange,
  handleLastFrameModelChange,
  openFirstFrameModal,
  openLastFrameModal,
  openFirstLastFramePromptModal,
  handleGenerateFirstFrame,
  handleGenerateLastFrame,
  openImagePreview,
  handlePromptClick,
  sanitizeHtml,
}) => {
  const currentEpisodeNumber = useWorkflowStore((state) => state.currentEpisodeNumber);
  const resolvedFirstFrameUrl = useResolvedImageUrl(
    episode.firstFrameImageAssetId,
    episode.firstFrameImageUrl,
  );
  const resolvedLastFrameUrl = useResolvedImageUrl(
    episode.lastFrameImageAssetId,
    episode.lastFrameImageUrl,
  );

  return (
    <div className="space-y-4">
      {/* 首帧区域 */}
      <div className="mb-4 bg-bg-tertiary rounded-lg p-3 p-3 border border-border/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-accent-primary">首帧</span>
            <span className="text-xs text-text-muted">视频开始画面</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">图片模型:</span>
            <Select
              value={episode.frameModel || imageModels[0]?.id}
              onChange={handleFrameModelChange}
              options={imageModels.map((m) => ({
                value: m.id,
                label: (
                  <Tooltip title={m.description}>
                    <span className="text-xs">{m.name}</span>
                  </Tooltip>
                ),
                disabled: m.disabled,
              }))}
              size="small"
              popupMatchSelectWidth={false}
            />
            <ModelPriceTag model={imageModels.find(m => m.id === (episode.frameModel || imageModels[0]?.id))} />
            <Button
              size="small"
              type="text"
              onClick={openFirstFrameModal}
              icon={<Edit3 size={12} />}
              className="text-text-muted hover:text-accent-primary"
            >
              编辑
            </Button>
          </div>
        </div>

        {/* 首帧预览和提示词 */}
        <div className="flex gap-3">
          {/* 左侧：首帧图片预览 */}
          <div
            className={`w-24 ${aspectRatioClass} rounded-lg bg-bg-secondary overflow-hidden flex-shrink-0 cursor-pointer relative group`}
            onClick={() => resolvedFirstFrameUrl && openImagePreview(resolvedFirstFrameUrl, '首帧预览')}
          >
            {episode.isGeneratingFirstFrame ? (
              <div className="w-full h-full flex items-center justify-center">
                <Spin size="small" />
              </div>
            ) : resolvedFirstFrameUrl ? (
              <>
                <img
                  src={resolvedFirstFrameUrl}
                  alt="首帧"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <ZoomIn size={20} className="text-white" />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted">
                <ImageIcon size={24} />
              </div>
            )}
          </div>

          {/* 右侧：首帧提示词显示 + 生成按钮 */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div
              onClick={openFirstFrameModal}
              className="bg-bg-secondary rounded-lg p-2 text-sm text-text-secondary cursor-pointer hover:bg-bg-secondary/80 transition-colors flex-1 overflow-y-auto"
            >
              {episode.firstFramePrompt ? (
                <div
                  className="html-content"
                  onClick={handlePromptClick}
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(renderVisualPrompt(episode.firstFramePrompt, characters, scenes, currentEpisodeNumber))
                  }}
                />
              ) : (
                <span className="text-text-muted">点击设置首帧提示词...</span>
              )}
            </div>
            <Button
              size="small"
              type="primary"
              onClick={handleGenerateFirstFrame}
              loading={episode.isGeneratingFirstFrame}
              icon={<ImageIcon size={12} />}
              disabled={!episode.firstFramePrompt?.trim()}
              className="bg-accent-primary border-0 w-full"
            >
              {resolvedFirstFrameUrl ? '重新生成' : '生成图片'}
            </Button>
          </div>
        </div>
      </div>

      {/* 尾帧区域 */}
      <div className="mb-4 bg-bg-tertiary rounded-lg p-3 p-3 border border-border/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-accent-secondary">尾帧</span>
            <span className="text-xs text-text-muted">视频结束画面</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">图片模型:</span>
            <Select
              value={episode.lastFrameModel || imageModels[0]?.id}
              onChange={handleLastFrameModelChange}
              options={imageModels.map((m) => ({
                value: m.id,
                label: (
                  <Tooltip title={m.description}>
                    <span className="text-xs">{m.name}</span>
                  </Tooltip>
                ),
                disabled: m.disabled,
              }))}
              size="small"
              popupMatchSelectWidth={false}
            />
            <ModelPriceTag model={imageModels.find(m => m.id === (episode.lastFrameModel || imageModels[0]?.id))} />
            <Button
              size="small"
              type="text"
              onClick={openLastFrameModal}
              icon={<Edit3 size={12} />}
              className="text-text-muted hover:text-accent-primary"
            >
              编辑
            </Button>
          </div>
        </div>

        {/* 尾帧预览和提示词 */}
        <div className="flex gap-3">
          {/* 左侧：尾帧图片预览 */}
          <div
            className={`w-24 ${aspectRatioClass} rounded-lg bg-bg-secondary overflow-hidden flex-shrink-0 cursor-pointer relative group`}
            onClick={() => resolvedLastFrameUrl && openImagePreview(resolvedLastFrameUrl, '尾帧预览')}
          >
            {episode.isGeneratingLastFrame ? (
              <div className="w-full h-full flex items-center justify-center">
                <Spin size="small" />
              </div>
            ) : resolvedLastFrameUrl ? (
              <>
                <img
                  src={resolvedLastFrameUrl}
                  alt="尾帧"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <ZoomIn size={20} className="text-white" />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted">
                <ImageIcon size={24} />
              </div>
            )}
          </div>

          {/* 右侧：尾帧提示词显示 + 生成按钮 */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div
              onClick={openLastFrameModal}
              className="bg-bg-secondary rounded-lg p-2 text-sm text-text-secondary cursor-pointer hover:bg-bg-secondary/80 transition-colors flex-1 overflow-y-auto"
            >
              {episode.lastFramePrompt ? (
                <div
                  className="html-content"
                  onClick={handlePromptClick}
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(renderVisualPrompt(episode.lastFramePrompt, characters, scenes, currentEpisodeNumber))
                  }}
                />
              ) : (
                <span className="text-text-muted">点击设置尾帧提示词...</span>
              )}
            </div>
            <Button
              size="small"
              type="primary"
              onClick={handleGenerateLastFrame}
              loading={episode.isGeneratingLastFrame}
              icon={<ImageIcon size={12} />}
              disabled={!episode.lastFramePrompt?.trim()}
              className="bg-accent-secondary border-0 w-full"
            >
              {resolvedLastFrameUrl ? '重新生成' : '生成图片'}
            </Button>
          </div>
        </div>
      </div>

      {/* 首尾帧视频提示词区域 */}
      <div className="mb-4 bg-bg-tertiary rounded-lg p-3 p-3 border border-border/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-accent-primary">首尾帧视频提示词</span>
            <span className="text-xs text-text-muted">用于首尾帧视频生成</span>
          </div>
          <Button
            size="small"
            type="text"
            onClick={openFirstLastFramePromptModal}
            icon={<Edit3 size={12} />}
            className="text-text-muted hover:text-accent-primary"
          >
            编辑
          </Button>
        </div>
        <div
          onClick={openFirstLastFramePromptModal}
          className="bg-bg-secondary rounded-lg p-2 text-sm text-text-secondary cursor-pointer hover:bg-bg-secondary/80 transition-colors min-h-[60px] max-h-32 overflow-y-auto"
        >
          {episode.firstLastFrameVideoPrompt ? (
            <div
              className="html-content"
              onClick={handlePromptClick}
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(renderVisualPrompt(stripPromptToText(episode.firstLastFrameVideoPrompt || ''), characters, scenes, currentEpisodeNumber))
              }}
            />
          ) : (
            <span className="text-text-muted">点击设置首尾帧视频提示词...</span>
          )}
        </div>
      </div>
    </div>
  );
};
