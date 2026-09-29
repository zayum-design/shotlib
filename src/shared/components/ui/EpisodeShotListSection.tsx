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
import { Button, Spin, Tabs, Checkbox, Popconfirm } from 'antd';
import { Edit3, Plus, Trash2, Film, Image as ImageIcon, ZoomIn } from 'lucide-react';
import type { Episode, Shot, Character, Scene } from '../../types';
import { generateShotPrompt, renderVisualPrompt } from '@/modules/workflow/utils/workflowUtils';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { HoverImagePreview } from './HoverImagePreview';
import type { HoverPreviewState } from './HoverImagePreview';

interface EpisodeShotListSectionProps {
  episode: Episode;
  shots: Shot[];
  totalDuration: number;
  remainingDuration: number;
  aspectRatioClass: string;
  characters: Character[];
  scenes: Scene[];

  openShotModal: (shot?: Shot) => void;
  openImagePreview: (url: string, title: string) => void;
  handlePromptClick: (e: React.MouseEvent) => void;
  handleGenerateShotReference: (index: number) => void;
  handleDeleteShot: (shotId: string) => void;
  updateEpisode: (id: string, data: Partial<Episode>) => void;
  sanitizeHtml: (html: string) => string;
}

/**
 * 全能参考生成 Tab 内容：分镜列表
 *
 * 所有分镜的提示词统一放在「分镜」Tab，所有分镜的参考图统一放在「参考图」Tab。
 */
export const EpisodeShotListSection: React.FC<EpisodeShotListSectionProps> = ({
  episode,
  shots,
  totalDuration,
  remainingDuration,
  aspectRatioClass,
  characters,
  scenes,
  openShotModal,
  openImagePreview,
  handlePromptClick,
  handleGenerateShotReference,
  handleDeleteShot,
  updateEpisode,
  sanitizeHtml,
}) => {
  const currentEpisodeNumber = useWorkflowStore((state) => state.currentEpisodeNumber);
  const [activeTabKey, setActiveTabKey] = useState('shot');
  // 分镜参考图 hover 悬浮预览态
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);

  // 计算分镜起始时间
  const getShotStartTime = (index: number) =>
    shots.slice(0, index).reduce((sum, s) => sum + s.duration, 0);

  // 时间轴段位（与后端 SHOT_LANGUAGE 镜头合同一致）,随片段时长上限(15s/30s)等比缩放:
  // 15s: 0-3s 建立 / 3-6s 引入 / 6-9s 发展 / 9-12s 高潮 / 12-15s 落点留钩
  // 30s: 0-6s 建立 / 6-12s 引入 / 12-18s 发展 / 18-24s 高潮 / 24-30s 落点留钩
  const maxDuration = useWorkflowStore((s) => s.episodeMaxDuration) || 15;
  const segment = maxDuration / 5;
  const TIMELINE_DUTIES: Array<{ maxStart: number; label: string; className: string }> = [
    { maxStart: segment, label: '建立', className: 'text-sky-400 border-sky-400/40 bg-sky-400/10' },
    { maxStart: segment * 2, label: '引入', className: 'text-cyan-400 border-cyan-400/40 bg-cyan-400/10' },
    { maxStart: segment * 3, label: '发展', className: 'text-amber-400 border-amber-400/40 bg-amber-400/10' },
    { maxStart: segment * 4, label: '高潮', className: 'text-red-400 border-red-400/40 bg-red-400/10' },
    { maxStart: Infinity, label: '落点/留钩', className: 'text-purple-400 border-purple-400/40 bg-purple-400/10' },
  ];
  const getTimelineDuty = (startTime: number) =>
    TIMELINE_DUTIES.find((d) => startTime < d.maxStart) ?? TIMELINE_DUTIES[TIMELINE_DUTIES.length - 1];

  // 空状态：添加分镜入口
  const renderEmptyState = () => (
    <div
      onClick={() => openShotModal()}
      className="bg-bg-tertiary rounded-lg p-4 text-center cursor-pointer hover:bg-bg-tertiary/80 transition-colors"
    >
      <p className="text-sm text-text-muted">点击添加分镜（总时长{maxDuration}秒）</p>
    </div>
  );

  // 单个分镜的操作按钮
  const renderShotActions = (shot: Shot) => (
    <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button
        size="small"
        type="text"
        onClick={() => openShotModal(shot)}
        icon={<Edit3 size={12} />}
        className="text-text-muted hover:text-accent-primary"
      />
      <Popconfirm
        title="确定删除此分镜？"
        onConfirm={() => handleDeleteShot(shot.id)}
        okText="确定"
        cancelText="取消"
      >
        <Button
          size="small"
          type="text"
          icon={<Trash2 size={12} />}
          className="text-text-muted hover:text-red-500"
        />
      </Popconfirm>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 分镜设定头部 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Film size={14} className="text-text-muted" />
          <span className="text-xs text-text-muted">分镜设定</span>
          {shots.length > 0 && (
            <span className={`text-xs ${totalDuration > maxDuration ? 'text-red-500 font-medium' : 'text-accent-primary'}`}>
              ({shots.length}个镜头 · {totalDuration}s / {maxDuration}s{totalDuration > maxDuration ? ' · 超限！请压缩分镜时长' : ''})
            </span>
          )}
        </div>
      </div>

      {/* 分镜 / 参考图 外层 Tabs */}
      <Tabs
        size="small"
        type="card"
        activeKey={activeTabKey}
        onChange={setActiveTabKey}
        defaultActiveKey="shot"
        className="episode-shot-tabs"
        tabBarExtraContent={
          activeTabKey === 'shot' ? (
            <Button
              size="small"
              type="text"
              onClick={() => openShotModal()}
              icon={<Plus size={12} />}
              disabled={remainingDuration <= 0}
              className="border-0"
            >
              增加分镜
            </Button>
          ) : null
        }
        items={[
          {
            key: 'shot',
            label: '分镜',
            children: (
              <div className="space-y-2">
                {shots.length > 0 ? (
                  <div className="space-y-2 max-h-[576px] overflow-y-auto fixed-scrollbar">
                    {shots.map((shot, index) => {
                      const shotStartTime = getShotStartTime(index);
                      const duty = getTimelineDuty(shotStartTime);
                      return (
                        <div
                          key={shot.id}
                          className="bg-bg-tertiary rounded-lg p-3 flex items-start justify-between group"
                        >
                          <div className="flex-1 min-w-0">
                            {/* 分镜编号和时间 */}
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-accent-primary">分镜 {index + 1}</span>
                              <span className="text-xs text-text-muted">
                                {shotStartTime}s - {shotStartTime + shot.duration}s ({shot.duration}s)
                              </span>
                              {/* 时间轴段位徽标（建立/引入/发展/高潮/落点留钩） */}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${duty.className}`}>
                                {duty.label}
                              </span>
                              {index === shots.length - 1 && shots.length > 1 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded border text-text-muted border-text-muted/40">
                                  收尾镜
                                </span>
                              )}
                            </div>
                            {/* 分镜提示词 */}
                            <div
                              className="text-sm text-text-secondary html-content whitespace-pre-wrap break-words rounded-lg bg-bg-secondary p-2 cursor-pointer hover:bg-bg-secondary/80 transition-colors min-h-[60px] max-h-40 overflow-y-auto"
                              onClick={handlePromptClick}
                              dangerouslySetInnerHTML={{
                                __html: sanitizeHtml(renderVisualPrompt(generateShotPrompt(shot), characters, scenes, currentEpisodeNumber))
                              }}
                            />
                          </div>
                          {renderShotActions(shot)}
                        </div>
                      );
                    })}
                  </div>
                ) : renderEmptyState()}
              </div>
            ),
          },
          {
            key: 'reference',
            label: '参考图',
            disabled: true,
            children: shots.length > 0 ? (
              <div className="space-y-2 max-h-[576px] overflow-y-auto fixed-scrollbar">
                {shots.map((shot, index) => (
                  <div
                    key={shot.id}
                    className="bg-bg-tertiary rounded-lg p-3 flex items-start justify-between group"
                  >
                    <div className="flex-1 min-w-0">
                      {/* 分镜编号 */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-accent-primary">分镜 {index + 1}</span>
                      </div>
                      {/* 参考图内容 */}
                      <div className="flex items-start gap-3">
                        {/* 左侧：参考图占位 */}
                        <div className="w-24 flex-shrink-0">
                          <div
                            className={`w-full ${aspectRatioClass} rounded-lg bg-bg-secondary overflow-hidden flex-shrink-0 cursor-pointer relative group/img`}
                            onClick={() => shot.referenceImageUrl && openImagePreview(shot.referenceImageUrl, `分镜 ${index + 1} 参考图`)}
                            onMouseEnter={(e) => {
                              if (!shot.referenceImageUrl) return;
                              setHoverPreview({
                                src: shot.referenceImageUrl,
                                name: `分镜 ${index + 1} 首帧参考图`,
                                type: 'scene',
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                            onMouseMove={(e) => {
                              if (!shot.referenceImageUrl) return;
                              setHoverPreview((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
                            }}
                            onMouseLeave={() => setHoverPreview(null)}
                          >
                            {shot.isGeneratingReferenceImage ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <Spin size="small" />
                              </div>
                            ) : shot.referenceImageUrl ? (
                              <>
                                <img
                                  src={shot.referenceImageUrl}
                                  alt={`分镜 ${index + 1} 参考图`}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                                  <ZoomIn size={20} className="text-white" />
                                </div>
                              </>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-text-muted">
                                <ImageIcon size={20} />
                              </div>
                            )}
                          </div>
                          {shot.referenceImageUrl && (
                            <Checkbox
                              checked={shot.useReferenceAsFirstFrame}
                              onChange={(e) => {
                                const updatedShots = shots.map((s, idx) =>
                                  idx === index ? { ...s, useReferenceAsFirstFrame: e.target.checked } : s
                                );
                                updateEpisode(episode.id, { shots: updatedShots });
                              }}
                              className="mt-1"
                            >
                              <span className="text-[10px] text-text-muted whitespace-nowrap">作为分镜首帧图</span>
                            </Checkbox>
                          )}
                        </div>
                        {/* 右侧：参考图提示词 + 生成按钮 */}
                        <div className="flex-1 min-w-0 flex flex-col gap-1">
                          {/* 参考图提示词预览（仅当已填写时显示） */}
                          {shot.referencePrompt && (
                            <div
                              className="text-sm text-text-secondary html-content whitespace-pre-wrap break-words rounded-lg bg-bg-secondary p-2 max-h-32 overflow-y-auto"
                              onClick={handlePromptClick}
                              dangerouslySetInnerHTML={{
                                __html: sanitizeHtml(renderVisualPrompt(shot.referencePrompt, characters, scenes, currentEpisodeNumber))
                              }}
                            />
                          )}
                          {/* 生成参考图按钮 */}
                          <Button
                            size="small"
                            type="primary"
                            onClick={() => handleGenerateShotReference(index)}
                            loading={shot.isGeneratingReferenceImage}
                            icon={<ImageIcon size={10} />}
                            disabled={!shot.prompt?.trim() && !shot.referencePrompt?.trim() && !shot.rawReferencePrompt?.trim()}
                            className="bg-accent-primary border-0 text-xs w-full mt-1"
                          >
                            {shot.referenceImageUrl ? '重新生成' : '生成参考图'}
                          </Button>
                        </div>
                      </div>
                    </div>
                    {renderShotActions(shot)}
                  </div>
                ))}
              </div>
            ) : renderEmptyState(),
          },
        ]}
      />
      {/* 分镜参考图 hover 悬浮大图预览 */}
      {hoverPreview && <HoverImagePreview preview={hoverPreview} placement="top" size="lg" />}
    </div>
  );
};
