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

import React, { useMemo, useState } from 'react';
import { Button, Modal } from 'antd';
import { Download, Film, ListVideo, Play, Sparkles, Video } from 'lucide-react';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import {
  getCurrentProjectAspectRatio,
  getEpisodeVideoUrl,
} from '@/modules/workflow/utils/workflowUtils';

const aspectClass = (r: string) =>
  r === '9:16' ? 'aspect-[9/16]' : r === '1:1' ? 'aspect-square' : 'aspect-video';

/** 右侧片段预览宽度：竖屏限制窄一些，避免按宽度放大后高度超出视口 */
const previewWidthClass = (r: string) =>
  r === '9:16' ? 'lg:w-[360px]' : r === '1:1' ? 'lg:w-[552px]' : 'lg:w-[768px]';

/** 弹窗宽度：竖屏用小宽度弹窗，横屏才用宽弹窗 */
const seqModalWidth = (r: string) => (r === '9:16' ? 480 : r === '1:1' ? 768 : 1248);

/**
 * Step 5：视频合成。
 * 当前分集已生成的片段视频按顺序排列（点击单段预览），至少一个片段就绪后即可合并，
 * 合并结果在下方预览（参照 mv2 TimelineStep）。
 */
export const VideoCompose: React.FC = () => {
  const { episodes: rawEpisodes, composedVideoUrl, isComposing, composeEpisodeVideos } = useWorkflowStore();

  // 与 step4 一致：过滤软删除片段并按 id 去重
  const episodes = useMemo(() => {
    const seen = new Set<string>();
    return (rawEpisodes || []).filter((ep) => {
      if (ep.deleted) return false;
      if (!ep.id || seen.has(ep.id)) return false;
      seen.add(ep.id);
      return true;
    });
  }, [rawEpisodes]);

  const aspectRatio = getCurrentProjectAspectRatio();
  const readyIndexes = episodes
    .map((ep, i) => (getEpisodeVideoUrl(ep) ? i : -1))
    .filter((i) => i >= 0);
  const hasCompleted = readyIndexes.length > 0;

  // 已就绪片段列表（合并预览 / 合并用，保持时间线顺序）
  const readySegments = useMemo(
    () =>
      episodes
        .map((ep, i) => ({ url: getEpisodeVideoUrl(ep), title: ep.title, index: i }))
        .filter((s) => s.url),
    [episodes],
  );

  // 合并预览：多片段连续播放
  const [seqOpen, setSeqOpen] = useState(false);
  const [seqIdx, setSeqIdx] = useState(0);
  const openSeqPreview = () => {
    setSeqIdx(0);
    setSeqOpen(true);
  };

  // 成片结果弹窗：合并成功后自动弹出，也可点击「查看成片」再次打开
  const [resultOpen, setResultOpen] = useState(false);
  const handleCompose = async () => {
    await composeEpisodeVideos();
    if (useWorkflowStore.getState().composedVideoUrl) setResultOpen(true);
  };

  // 默认预览第一个已就绪的片段
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const activePreviewIdx = previewIdx ?? readyIndexes[0] ?? 0;
  const previewEp = episodes[activePreviewIdx];
  const previewUrl = previewEp ? getEpisodeVideoUrl(previewEp) : '';

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row gap-4">
        {/* 片段时间线：min-w-0 让 flex 子项可收缩，片段超出时容器内横向滚动而非撑开页面 */}
        <div className="flex-1 min-w-0 rounded-xl border border-border bg-bg-tertiary/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-text-primary">
              <Film size={18} className="text-accent-primary" />
              <span className="text-sm font-medium">
                片段时间线（共 {episodes.length} 个片段，已就绪 {readyIndexes.length} 个）
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={!hasCompleted}
                onClick={openSeqPreview}
                icon={<ListVideo size={14} />}
                className="border-border"
              >
                合并预览
              </Button>
              {composedVideoUrl && (
                <Button
                  onClick={() => setResultOpen(true)}
                  icon={<Play size={14} />}
                  className="border-border"
                >
                  查看成片
                </Button>
              )}
              <Button
                type="primary"
                loading={isComposing}
                disabled={!hasCompleted}
                onClick={handleCompose}
                icon={<Sparkles size={14} />}
                className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
              >
                {composedVideoUrl ? '重新合并' : '合并视频'}
              </Button>
            </div>
          </div>

          {/* 时间线轨道：点击已就绪片段可预览 */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {episodes.map((ep, i) => {
              const url = getEpisodeVideoUrl(ep);
              return (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => url && setPreviewIdx(i)}
                  disabled={!url}
                  title={url ? `预览片段 ${i + 1}` : `片段 ${i + 1} 尚未生成视频`}
                  className={`flex-shrink-0 w-32 rounded-lg overflow-hidden border-2 transition-all disabled:opacity-50 ${
                    activePreviewIdx === i ? 'border-accent-primary' : 'border-transparent'
                  }`}
                >
                  <div className={`${aspectClass(aspectRatio)} bg-bg-tertiary relative group`}>
                    {url ? (
                      <>
                        <video
                          src={url}
                          muted
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-cover"
                        />
                        {/* hover 播放图标，提示可点击预览 */}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play size={22} className="text-white" />
                        </span>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-muted">
                        <Video size={20} />
                      </div>
                    )}
                    <span className="absolute top-1 left-1 px-1 rounded bg-black/60 text-white text-[10px]">
                      #{i + 1}
                    </span>
                  </div>
                  <div className="px-1.5 py-1 bg-bg-secondary text-center">
                    <span className="text-[10px] text-text-muted block truncate">
                      {ep.title || `片段 ${i + 1}`}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {url
                        ? '✓ 就绪'
                        : ep.isGenerating
                          ? '生成中'
                          : '待生成'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 片段预览（固定宽度） */}
        {previewUrl && (
          <div className={`w-full ${previewWidthClass(aspectRatio)} flex-shrink-0 rounded-xl border border-border bg-bg-tertiary/30 p-4`}>
            <p className="text-xs text-text-muted mb-2">
              片段 #{activePreviewIdx + 1} 预览{previewEp?.title ? `（${previewEp.title}）` : ''}
            </p>
            <div
              className={`${aspectClass(aspectRatio)} w-full rounded overflow-hidden bg-black`}
            >
              <video
                key={previewUrl}
                src={previewUrl}
                controls
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        )}
      </div>

      {!hasCompleted && (
        <p className="text-center text-sm text-text-muted">
          请先在第4步完成至少一个片段的视频生成
        </p>
      )}

      {/* 合并预览：按时间线顺序连续播放所有已就绪片段 */}
      <Modal
        open={seqOpen}
        onCancel={() => setSeqOpen(false)}
        footer={null}
        centered
        destroyOnHidden
        width={seqModalWidth(aspectRatio)}
        title={`合并预览（${seqIdx + 1} / ${readySegments.length}）`}
      >
        {readySegments[seqIdx] && (
          <div className="space-y-3">
            <div className={`${aspectClass(aspectRatio)} w-full rounded overflow-hidden bg-black`}>
              <video
                key={readySegments[seqIdx].url}
                src={readySegments[seqIdx].url}
                controls
                autoPlay
                className="w-full h-full object-contain"
                onEnded={() => {
                  // 当前片段播完自动跳下一段
                  if (seqIdx < readySegments.length - 1) setSeqIdx(seqIdx + 1);
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted truncate">
                片段 #{readySegments[seqIdx].index + 1}
                {readySegments[seqIdx].title ? `（${readySegments[seqIdx].title}）` : ''}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  disabled={seqIdx === 0}
                  onClick={() => setSeqIdx(seqIdx - 1)}
                >
                  上一段
                </Button>
                <Button
                  size="small"
                  disabled={seqIdx >= readySegments.length - 1}
                  onClick={() => setSeqIdx(seqIdx + 1)}
                >
                  下一段
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
      {/* 成片结果：合并成功后弹出，与合并预览同一弹窗样式 */}
      <Modal
        open={resultOpen && !!composedVideoUrl}
        onCancel={() => setResultOpen(false)}
        footer={null}
        centered
        destroyOnHidden
        width={seqModalWidth(aspectRatio)}
        title="合并成片"
      >
        {composedVideoUrl && (
          <div className="space-y-3">
            <div className={`${aspectClass(aspectRatio)} w-full rounded overflow-hidden bg-black`}>
              <video
                src={composedVideoUrl}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex items-center justify-between">
              <a
                href={composedVideoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent-primary hover:underline"
              >
                在新窗口打开
              </a>
              <Button
                size="small"
                icon={<Download size={14} />}
                href={composedVideoUrl}
                download="video.mp4"
              >
                下载视频
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
