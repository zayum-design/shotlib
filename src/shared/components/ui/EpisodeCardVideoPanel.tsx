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
import { Button, Input, Select, Slider, Radio, Tooltip, Spin } from 'antd';
import { Video, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, Play, XCircle, Clock, GitBranch } from 'lucide-react';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { message } from '@/shared/utils/message';
import type { Episode } from '../../types';

interface EpisodeCardVideoPanelProps {
  episode: Episode;
  aspectRatioClass: string;
  currentVideo: { url: string; generationMode?: string } | null;
  allVideos: { url: string; generationMode?: string }[];
  currentVideoIndex: number;
  handlePrevVideo: () => void;
  handleNextVideo: () => void;
  currentGenerationMode: string;
  durationConfig?: { min: number; max: number; default: number };
  handleVideoDurationChange: (duration: number) => void;
  effectiveModelId: string;
  filteredVideoModels: { id: string; name: string; description?: string; disabled?: boolean }[];
  handleVideoModelChange: (model: string) => void;
  totalDuration: number;
  handleGenerate: () => void;
  handleRetryGenerate: () => void;
  videoModels: { id: string; name: string }[];
  updateEpisode: (id: string, data: Partial<Episode>) => void;
}

export const EpisodeCardVideoPanel: React.FC<EpisodeCardVideoPanelProps> = ({
  episode,
  aspectRatioClass,
  currentVideo,
  allVideos,
  currentVideoIndex,
  handlePrevVideo,
  handleNextVideo,
  currentGenerationMode,
  durationConfig,
  handleVideoDurationChange,
  effectiveModelId,
  filteredVideoModels,
  handleVideoModelChange,
  totalDuration,
  handleGenerate,
  handleRetryGenerate,
  videoModels,
  updateEpisode,
}) => {
  // 片段衍生：从 store 取衍生 action（截尾帧→上传→插入新片段）
  const deriveEpisodeFromVideo = useWorkflowStore((s) => s.deriveEpisodeFromVideo);
  const [deriving, setDeriving] = useState(false);
  const handleDerive = async () => {
    setDeriving(true);
    try {
      const result = await deriveEpisodeFromVideo(episode.id);
      if (result) message.success('已在该片段后插入衍生片段');
    } catch (e: any) {
      console.error('[handleDerive] 片段衍生失败:', e);
      message.error(e?.message || '片段衍生失败');
    } finally {
      setDeriving(false);
    }
  };

  // 检查 taskQueueStore 中是否有同一片段的活跃视频任务
  const hasRunningTask = useTaskQueueStore((state) =>
    state.tasks.some((t) =>
      t.type === 'episode-video' &&
      (t.metadata?.episodeId === episode.id || t.metadata?.subId === episode.id) &&
      (t.status === 'running' || t.status === 'polling'),
    ),
  );

  // 该片段当前视频任务的并发队列信息（排队位置/预估耗时，来自后端 VariantConcurrencyGuard）
  const queue = useTaskQueueStore((state) => {
    const t = state.tasks.find(
      (t) =>
        t.type === 'episode-video' &&
        (t.metadata?.episodeId === episode.id || t.metadata?.subId === episode.id) &&
        (t.status === 'running' || t.status === 'polling'),
    );
    return t?.metadata?.queue as {
      state?: 'running' | 'queued' | 'unknown';
      position?: number;
      waitingCount?: number;
      max?: number;
      etaSeconds?: number;
    } | undefined;
  });
  const isQueued = queue?.state === 'queued';

  // 失败状态：videoTaskStatus 为 failed
  const isFailed = episode.videoTaskStatus === 'failed';
  // 中断/超时状态：有 videoTaskId 但没有 videoUrl 且不在生成中，也不是失败
  const isInterrupted = !!episode.videoTaskId && !episode.generatedVideoUrl && !episode.isGenerating && !isFailed;
  const isTimeout = episode.videoTaskStatus === 'timeout';
  const needsRetry = isFailed || isInterrupted || isTimeout;

  // 生成按钮点击处理
  const handleGenerateClick = () => {
    if (isInterrupted || isTimeout) {
      // 中断/超时：继续轮询
      handleRetryGenerate();
    } else {
      // 未生成、已生成或失败：重新生成
      handleGenerate();
    }
  };

  // 确定按钮文案
  const buttonText = episode.isGenerating
    ? '生成中...'
    : needsRetry
      ? '重试'
      : episode.generatedVideoUrl
        ? '重新生成'
        : '生成视频';

  return (
    <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 flex flex-col gap-3">
      {/* 视频预览区 */}
      <div className={`${aspectRatioClass} rounded-lg bg-bg-tertiary overflow-hidden relative`}>
        {episode.isGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-tertiary/90">
            <Spin size="large" />
            <p className="mt-4 text-text-secondary">
              {isQueued && queue?.position
                ? `排队中（第 ${queue.position} 位·共 ${queue.waitingCount ?? 0} 个）`
                : '正在生成视频...'}
            </p>
            {/* 进度条 */}
            <div className="w-48 mt-3">
              <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent-primary to-accent-secondary transition-all duration-500"
                  style={{ width: `${episode.videoGenerationProgress || 0}%` }}
                />
              </div>
              <p className="text-xs text-text-muted mt-2 text-center">
                {Math.round(episode.videoGenerationProgress || 0)}%
              </p>
            </div>
            <p className="text-xs text-text-muted mt-2">
              {isQueued && queue?.etaSeconds
                ? `预计还需约 ${queue.etaSeconds} 秒`
                : '预计需要 2-3 分钟'}
            </p>
          </div>
        ) : currentVideo ? (
          <div className="w-full h-full relative group">
            {/* 视频播放器 */}
            <video
              key={currentVideo.url}
              src={currentVideo.url}
              controls
              className="w-full h-full object-contain"
              poster=""
            />
            {/* 历史视频切换按钮 */}
            {allVideos.length > 1 && (
              <>
                <button
                  onClick={handlePrevVideo}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="上一个视频"
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  onClick={handleNextVideo}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="下一个视频"
                >
                  <ChevronRight size={20} />
                </button>
              </>
            )}
            {/* 视频计数器 */}
            {allVideos.length > 1 && (
              <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                {currentVideoIndex + 1} / {allVideos.length}
              </div>
            )}
            {/* 完成标记 */}
            <div className="absolute top-2 right-2 bg-accent-success text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
              <CheckCircle2 size={12} />
              {currentVideoIndex === 0 ? '最新' : '历史'}
            </div>
            {/* 生成方式标记 */}
            {currentVideo.generationMode && (
              <div className="absolute bottom-2 left-2 bg-bg-secondary/80 text-text-secondary text-xs px-2 py-1 rounded-full">
                {currentVideo.generationMode === 'first_last_frame' ? '首尾帧' : '全能参考'}
              </div>
            )}
          </div>
        ) : isFailed && episode.videoTaskError ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-red-500/10 p-4 text-center">
            <XCircle size={40} className="text-red-400 mb-2 flex-shrink-0" />
            <p className="text-sm text-red-400 font-medium mb-1">视频生成失败</p>
            <p className="text-xs text-red-400/80 break-all line-clamp-4 overflow-hidden">{episode.videoTaskError}</p>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center text-text-muted">
              <Video size={48} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">视频预览区</p>
              <p className="text-xs text-text-secondary mt-1">生成后将在此预览</p>
            </div>
          </div>
        )}
      </div>

      {/* 模型选择和生成按钮 */}
      <div className="space-y-3">
        {/* 首尾帧模式下显示时长选择 */}
        {currentGenerationMode === 'first_last_frame' && (
          <div className="flex flex-col gap-3 bg-bg-tertiary/50 rounded-lg p-3 border border-border/50">
            <div className="flex items-center gap-3 max-md:flex-wrap">
              <span className="text-xs text-text-secondary whitespace-nowrap">视频时长:</span>
              <div className="flex items-center gap-2 flex-1">
                <Slider
                  min={durationConfig?.min ?? 1}
                  max={durationConfig?.max ?? 15}
                  value={episode.videoDuration ?? (durationConfig?.default ?? 5)}
                  onChange={handleVideoDurationChange}
                  className="flex-1 max-w-[200px]"
                  disabled={episode.isGenerating}
                />
                <Input
                  type="number"
                  min={durationConfig?.min ?? 1}
                  max={durationConfig?.max ?? 15}
                  value={episode.videoDuration ?? (durationConfig?.default ?? 5)}
                  onChange={(e) => handleVideoDurationChange(parseInt(e.target.value) || (durationConfig?.default ?? 5))}
                  className="w-14"
                  disabled={episode.isGenerating}
                />
                <span className="text-xs text-text-muted">秒</span>
              </div>
              {durationConfig && (
                <span className="text-xs text-text-muted">
                  支持范围: {durationConfig.min}-{durationConfig.max}秒
                </span>
              )}
            </div>
          </div>
        )}

        {/* 分辨率 + 视频模型 + 积分（无文字标签） */}
        <div className="flex items-center gap-2 mb-2 max-md:flex-wrap">
          <Radio.Group
            value={episode.videoResolution || '720p'}
            onChange={(e) => updateEpisode(episode.id, { videoResolution: e.target.value })}
            size="small"
            disabled={episode.isGenerating}
          >
            <Radio.Button value="720p">720p</Radio.Button>
            <Radio.Button value="1080p">1080p</Radio.Button>
          </Radio.Group>
          <Select
            value={effectiveModelId}
            onChange={handleVideoModelChange}
            options={filteredVideoModels.map((m) => ({
              value: m.id,
              label: (
                <Tooltip title={m.description}>
                  <span className="text-xs">{m.name}</span>
                </Tooltip>
              ),
              disabled: m.disabled,
            }))}
            size="middle"
            disabled={episode.isGenerating}
            popupMatchSelectWidth={false}
          />
          <ModelPriceTag
            model={videoModels.find((m) => m.id === effectiveModelId)}
            duration={currentGenerationMode === 'reference_image' ? totalDuration : episode.videoDuration}
            resolution={episode.videoResolution}
          />
        </div>

        {/* 失败原因提示 */}
        {isFailed && episode.videoTaskError && (
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <XCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span className="break-all">{episode.videoTaskError}</span>
          </div>
        )}

        {/* 生成按钮 */}
        <div className="flex items-center gap-3 max-md:flex-wrap">
          <Button
            type="primary"
            size="large"
            onClick={handleGenerateClick}
            loading={episode.isGenerating}
            icon={needsRetry ? <Play size={18} /> : undefined}
            disabled={episode.isGenerating || (hasRunningTask && !needsRetry)}
            className={`flex-shrink-0 ${
              needsRetry
                ? isFailed
                  ? 'bg-red-500 border-red-500 hover:bg-red-600'
                  : 'bg-yellow-500 border-yellow-500 hover:bg-yellow-600'
                : episode.generatedVideoUrl
                  ? 'bg-accent-success border-accent-success'
                  : 'bg-gradient-to-r from-accent-primary to-accent-secondary border-0'
            }`}
          >
            {buttonText}
          </Button>
          {/* 片段衍生：已生成视频时可一键衍生（截尾帧→插入新片段） */}
          {!!episode.generatedVideoUrl && !episode.isGenerating && (
            <Button
              size="large"
              icon={<GitBranch size={16} />}
              loading={deriving}
              onClick={handleDerive}
              className="flex-shrink-0"
            >
              片段衍生
            </Button>
          )}
          {(isInterrupted || isTimeout) && (
            <Tooltip title="视频生成任务已提交，点击重试可恢复轮询">
              <AlertTriangle size={16} className="text-yellow-500" />
            </Tooltip>
          )}
          {isFailed && (
            <Tooltip title="视频生成失败，点击重试重新生成">
              <XCircle size={16} className="text-red-500" />
            </Tooltip>
          )}
        </div>

        {/* 生成按钮下方：排队状态提醒（仅排队中显示） */}
        {episode.isGenerating && isQueued && queue?.position ? (
          <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
            <Clock size={12} className="flex-shrink-0" />
            <span>
              排队中（第 {queue.position} 位·共 {queue.waitingCount ?? 0} 个）
              {queue?.etaSeconds ? ` · 预计还需约 ${queue.etaSeconds} 秒` : ''}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
};
