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

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Modal } from 'antd';
import { Play, Pause, SkipBack, SkipForward, MonitorPlay, Image as ImageIcon } from 'lucide-react';

interface PreviewVideo {
  videoUrl: string;
  sceneName: string;
  imageUrl?: string;
}

interface VideoPreviewModalProps {
  open: boolean;
  videos: PreviewVideo[];
  aspectRatio?: string;
  onClose: () => void;
}

export const VideoPreviewModal: React.FC<VideoPreviewModalProps> = ({
  open,
  videos,
  aspectRatio = '16:9',
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activePlayer, setActivePlayer] = useState<'A' | 'B'>('A');
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoDurations, setVideoDurations] = useState<number[]>([]);
  const [totalProgress, setTotalProgress] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const videoATargetIndex = useRef(0);
  const videoBTargetIndex = useRef(0);
  const rafRef = useRef<number>(0);
  const activePlayerRef = useRef(activePlayer);
  const currentIndexRef = useRef(currentIndex);
  const isPlayingRef = useRef(isPlaying);
  const durationsRef = useRef(videoDurations);

  // 同步 ref
  useEffect(() => { activePlayerRef.current = activePlayer; }, [activePlayer]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { durationsRef.current = videoDurations; }, [videoDurations]);

  const totalDuration = useMemo(
    () => videoDurations.reduce((sum, d) => sum + (d || 0), 0),
    [videoDurations]
  );

  // 获取当前/非活跃的 video 元素
  const getActiveVideo = useCallback(() => {
    return activePlayerRef.current === 'A' ? videoARef.current : videoBRef.current;
  }, []);

  const getInactiveVideo = useCallback(() => {
    return activePlayerRef.current === 'A' ? videoBRef.current : videoARef.current;
  }, []);

  // 计算某个视频索引之前的累计时长
  const getAccumulatedTime = useCallback((index: number) => {
    let total = 0;
    for (let i = 0; i < index; i++) {
      total += durationsRef.current[i] || 0;
    }
    return total;
  }, []);

  // 更新总进度
  const updateTotalProgress = useCallback(() => {
    const video = getActiveVideo();
    if (!video) return;
    const accumulated = getAccumulatedTime(currentIndexRef.current);
    setTotalProgress(accumulated + video.currentTime);
  }, [getActiveVideo, getAccumulatedTime]);

  // RAF 更新进度
  useEffect(() => {
    if (!isPlaying || !open) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      updateTotalProgress();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, open, updateTotalProgress]);

  // 预加载指定索引的视频到非活跃播放器
  const preloadVideo = useCallback((targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= videos.length) return;
    const inactive = getInactiveVideo();
    if (inactive) {
      inactive.src = videos[targetIndex].videoUrl;
      inactive.load();
      if (activePlayerRef.current === 'A') {
        videoBTargetIndex.current = targetIndex;
      } else {
        videoATargetIndex.current = targetIndex;
      }
    }
  }, [videos, getInactiveVideo]);

  // 切换到指定视频（无缝切换）
  const switchToVideo = useCallback((targetIndex: number, seekTime: number = 0) => {
    if (targetIndex < 0 || targetIndex >= videos.length) return;
    if (isTransitioning) return;

    setIsTransitioning(true);
    const nextPlayer = activePlayerRef.current === 'A' ? 'B' : 'A';
    const nextRef = nextPlayer === 'A' ? videoARef : videoBRef;
    const nextVideo = nextRef.current;
    if (!nextVideo) {
      setIsTransitioning(false);
      return;
    }

    // 记录目标索引
    if (nextPlayer === 'A') {
      videoATargetIndex.current = targetIndex;
    } else {
      videoBTargetIndex.current = targetIndex;
    }

    // 如果目标视频已经在非活跃播放器中且可以播放，直接切换
    const canSwitch = nextVideo.src === videos[targetIndex].videoUrl && nextVideo.readyState >= 3;

    const doSwitch = () => {
      if (seekTime > 0) nextVideo.currentTime = seekTime;
      nextVideo.play().catch(() => setIsPlaying(false));
      setActivePlayer(nextPlayer);
      activePlayerRef.current = nextPlayer;
      setCurrentIndex(targetIndex);
      currentIndexRef.current = targetIndex;
      setIsPlaying(true);
      isPlayingRef.current = true;
      setIsTransitioning(false);

      // 预加载下一个
      preloadVideo(targetIndex + 1);
    };

    if (canSwitch) {
      doSwitch();
    } else {
      nextVideo.src = videos[targetIndex].videoUrl;
      if (seekTime > 0) nextVideo.currentTime = seekTime;
      nextVideo.play().catch(() => setIsPlaying(false));
      const onCanPlay = () => {
        nextVideo.removeEventListener('canplay', onCanPlay);
        doSwitch();
      };
      nextVideo.addEventListener('canplay', onCanPlay);
      // 超时 fallback
      setTimeout(() => {
        nextVideo.removeEventListener('canplay', onCanPlay);
        doSwitch();
      }, 500);
    }
  }, [videos, isTransitioning, preloadVideo]);

  // 处理视频结束
  const handleVideoEnded = useCallback(() => {
    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex >= videos.length) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      return;
    }
    switchToVideo(nextIndex);
  }, [videos.length, switchToVideo]);

  // 处理视频加载元数据
  const handleLoadedMetadata = useCallback((player: 'A' | 'B', duration: number) => {
    const idx = player === 'A' ? videoATargetIndex.current : videoBTargetIndex.current;
    if (idx < 0 || idx >= videos.length) return;
    setVideoDurations(prev => {
      if (prev[idx] === duration) return prev;
      const next = [...prev];
      next[idx] = duration;
      return next;
    });
  }, [videos.length]);

  // 打开预览时初始化
  useEffect(() => {
    if (!open) {
      setIsPlaying(false);
      setCurrentIndex(0);
      setActivePlayer('A');
      setTotalProgress(0);
      setVideoDurations([]);
      activePlayerRef.current = 'A';
      currentIndexRef.current = 0;
      isPlayingRef.current = false;
      if (videoARef.current) {
        videoARef.current.pause();
        videoARef.current.src = '';
      }
      if (videoBRef.current) {
        videoBRef.current.pause();
        videoBRef.current.src = '';
      }
      return;
    }

    if (videos.length === 0) return;

    // 初始化：video A 播放第一个，video B 预加载第二个
    const init = () => {
      const va = videoARef.current;
      const vb = videoBRef.current;
      if (!va) return;

      va.src = videos[0].videoUrl;
      va.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
      isPlayingRef.current = true;

      if (vb && videos.length > 1) {
        vb.src = videos[1].videoUrl;
        vb.load();
      }
    };

    // 延迟一点确保 DOM 已挂载
    const timer = setTimeout(init, 100);
    return () => clearTimeout(timer);
  }, [open, videos]);

  // 播放/暂停
  const handlePlayPause = useCallback(() => {
    const video = getActiveVideo();
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [getActiveVideo]);

  // 上一个
  const handlePrev = useCallback(() => {
    if (currentIndex <= 0) return;
    switchToVideo(currentIndex - 1);
  }, [currentIndex, switchToVideo]);

  // 下一个
  const handleNext = useCallback(() => {
    if (currentIndex >= videos.length - 1) return;
    switchToVideo(currentIndex + 1);
  }, [currentIndex, videos.length, switchToVideo]);

  // 拖动总进度条
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = parseFloat(e.target.value);

    // 找到目标视频索引和偏移
    let accumulated = 0;
    let targetIndex = 0;
    let targetOffset = 0;

    for (let i = 0; i < durationsRef.current.length; i++) {
      const dur = durationsRef.current[i] || 0;
      if (targetTime < accumulated + dur || i === durationsRef.current.length - 1) {
        targetIndex = i;
        targetOffset = Math.max(0, targetTime - accumulated);
        break;
      }
      accumulated += dur;
    }

    // 如果在当前视频内，直接 seek
    if (targetIndex === currentIndexRef.current) {
      const video = getActiveVideo();
      if (video) {
        video.currentTime = targetOffset;
        setTotalProgress(targetTime);
      }
      return;
    }

    // 切换到目标视频
    switchToVideo(targetIndex, targetOffset);
    setTotalProgress(targetTime);
  }, [switchToVideo, getActiveVideo]);

  // 点击列表项切换
  const handleSelectVideo = useCallback((index: number) => {
    switchToVideo(index);
  }, [switchToVideo]);

  // 格式化时间
  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const currentVideo = videos[currentIndex];
  const thumbWidth = aspectRatio === '9:16' ? 56 : 96;
  const thumbHeight = aspectRatio === '9:16' ? 100 : aspectRatio === '21:9' ? 41 : 54;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="片段预览"
      width={960}
      footer={null}
      centered
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
    >
      <div className="bg-bg-primary">
        {/* 视频播放区 - 双 video 无缝切换 */}
        <div
          className="relative bg-black flex items-center justify-center overflow-hidden"
          style={{ minHeight: 400 }}
        >
          {videos.length > 0 ? (
            <>
              <video
                ref={videoARef}
                className={`w-full max-h-[70vh] object-contain transition-opacity duration-300 ${
                  activePlayer === 'A' ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ position: activePlayer === 'A' ? 'relative' : 'absolute', inset: 0 }}
                onEnded={activePlayer === 'A' ? handleVideoEnded : undefined}
                onLoadedMetadata={(e) => handleLoadedMetadata('A', e.currentTarget.duration)}
                onClick={handlePlayPause}
                controls={false}
                playsInline
                preload="auto"
              />
              <video
                ref={videoBRef}
                className={`w-full max-h-[70vh] object-contain transition-opacity duration-300 ${
                  activePlayer === 'B' ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ position: activePlayer === 'B' ? 'relative' : 'absolute', inset: 0 }}
                onEnded={activePlayer === 'B' ? handleVideoEnded : undefined}
                onLoadedMetadata={(e) => handleLoadedMetadata('B', e.currentTarget.duration)}
                onClick={handlePlayPause}
                controls={false}
                playsInline
                preload="auto"
              />
            </>
          ) : (
            <div className="text-text-muted flex flex-col items-center justify-center py-20">
              <MonitorPlay size={48} className="mb-3 opacity-40" />
              <p>暂无可预览的视频</p>
            </div>
          )}

          {/* 中央播放按钮（暂停时显示） */}
          {videos.length > 0 && !isPlaying && (
            <button
              onClick={handlePlayPause}
              className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors z-10"
            >
              <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                <Play size={28} className="text-text-primary ml-1" />
              </div>
            </button>
          )}
        </div>

        {/* 控制栏 */}
        {videos.length > 0 && currentVideo && (
          <div className="px-4 py-3 border-t border-border">
            {/* 场景名称 */}
            <div className="text-sm text-text-primary mb-2 truncate">
              {currentVideo.sceneName}
            </div>

            {/* 总进度条 */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs text-text-secondary w-14 text-right tabular-nums">
                {formatTime(totalProgress)}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(totalDuration, 0.1)}
                step={0.1}
                value={Math.min(totalProgress, totalDuration)}
                onChange={handleSeek}
                className="flex-1 h-1.5 rounded-full accent-accent-primary cursor-pointer"
              />
              <span className="text-xs text-text-secondary w-14 tabular-nums">
                {formatTime(totalDuration)}
              </span>
            </div>

            {/* 播放控制按钮 */}
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={handlePrev}
                disabled={currentIndex === 0}
                className="w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <SkipBack size={20} />
              </button>
              <button
                onClick={handlePlayPause}
                className="w-11 h-11 rounded-full bg-accent-primary text-white flex items-center justify-center hover:bg-accent-secondary transition-colors"
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
              </button>
              <button
                onClick={handleNext}
                disabled={currentIndex >= videos.length - 1}
                className="w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <SkipForward size={20} />
              </button>
            </div>
          </div>
        )}

        {/* 视频列表 */}
        {videos.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <div className="text-xs text-text-secondary mb-2">
              播放列表 ({currentIndex + 1} / {videos.length})
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {videos.map((v, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSelectVideo(idx)}
                  className={`flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                    idx === currentIndex
                      ? 'border-accent-primary ring-2 ring-accent-primary/30'
                      : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                  style={{ width: thumbWidth, height: thumbHeight }}
                >
                  {v.imageUrl ? (
                    <img
                      src={v.imageUrl}
                      alt={v.sceneName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-bg-tertiary flex items-center justify-center">
                      <ImageIcon size={14} className="text-text-muted" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
