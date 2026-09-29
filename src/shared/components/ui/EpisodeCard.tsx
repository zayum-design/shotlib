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

import React, { useState, useMemo } from 'react';
import { Card, Button, Input, Spin, Tooltip, Modal, Slider, Checkbox, Popconfirm, Divider, Select, Tabs, Radio } from 'antd';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { Edit3, Play, Video, Plus, Trash2, Film, Image as ImageIcon, ZoomIn, CheckCircle2, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import type { Episode, CameraMovement, ShotType, CameraAngle, LightingType, MoodType } from '../../types';
import { CAMERA_MOVEMENTS, SHOT_TYPES, CAMERA_ANGLES, LIGHTING_TYPES, MOOD_TYPES } from '../../types';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { useResolvedImageUrls } from '@/modules/workflow/hooks/useWorkflowImageResolver';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { useShotEditor } from './hooks/useShotEditor';
import { useFrameEditor } from './hooks/useFrameEditor';
import { useImagePreview } from './hooks/useImagePreview';
import { VisualPromptEditor } from './VisualPromptEditor';
import { ImagePreviewModal } from './ImagePreviewModal';
import { HoverImagePreview, type HoverPreviewState } from './HoverImagePreview';
import { VideoComplianceDialog } from './VideoComplianceDialog';
import { EpisodeCardVideoPanel } from './EpisodeCardVideoPanel';
import { PromptEditModal } from './PromptEditModal';
import { ShotEditModal } from './ShotEditModal';
import { EpisodeShotListSection } from './EpisodeShotListSection';
import { EpisodeFirstLastFrameSection } from './EpisodeFirstLastFrameSection';
import { generateShotPrompt, renderVisualPrompt, filterCharacterPortraitsByEpisode } from '@/modules/workflow/utils/workflowUtils';
import { checkEpisodeVideoCompliance } from '@/modules/workflow/utils/videoComplianceCheck';
import { stripPromptToText } from '@/modules/workflow/stores/workflowStore.episode.utils';
import { getComplianceHelpers, readAnyCompliance } from '@/modules/workflow/providers/compliance-factory';
import { localApi } from '@/storage';
import { useProjectStore } from '../../stores/projectStore';
import { message } from '../../utils/message';

interface EpisodeCardProps {
  episode: Episode;
}

// 净化 HTML，移除危险标签但保留样式标签
const sanitizeHtml = (html: string): string => {
  if (!html) return '';

  // 移除危险标签和事件处理器
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/on\w+\s*=/gi, 'data-blocked=')
    .replace(/javascript:/gi, 'blocked:');
};





export const EpisodeCard: React.FC<EpisodeCardProps> = ({ episode }) => {
  console.log('[EpisodeCard] render episode:', episode?.id, 'title:', episode?.title, 'shots:', episode?.shots?.length, 'videoGenerationMode:', episode?.videoGenerationMode, 'videoDuration:', episode?.videoDuration);

  const [isEditingTitle, setIsEditingTitle] = useState(false);

  // 角色/场景/形象照 hover 预览（fixed 定位，避免被 overflow 裁剪）
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);

  // 视频合规检查对话框状态
  const [complianceDialogOpen, setComplianceDialogOpen] = useState(false);

  // 新增/编辑分镜的状态

  const {
    updateEpisode,
    generateEpisodeVideo,
    generateFirstFrame,
    generateLastFrame,
    generateShotReferenceImage,
    characters,
    scenes,
    props,
    imageModels,
    videoModels,
    currentEpisodeNumber,
    removeEpisode,
  } = useWorkflowStore();

  // 道具伪资产：把有图的道具转为 ShotReferenceAsset（type=image），
  // 注入各提示词编辑器的 ! 下拉；!<ref url="道具图URL" type="image"> 标签
  // 在视频生成（buildUniversalReferenceRequest）与首尾帧生成（parseFramePrompt）中
  // 会被自动收集为参考图，无需改动下游管线
  const propAssetIds = useMemo(
    () => (props || []).flatMap((p) => p.imageAssetIds || []).filter(Boolean) as string[],
    [props],
  );
  const { getUrl: getPropAssetUrl } = useResolvedImageUrls(propAssetIds);
  const propAssets = useMemo(
    () => (props || [])
      .map((p) => {
        const url = (p.imageAssetIds?.[0] ? getPropAssetUrl(p.imageAssetIds[0]) : undefined) || p.imageUrls?.[0] || '';
        return url ? { type: 'image' as const, assetId: url, name: p.name } : null;
      })
      .filter((a): a is { type: 'image'; assetId: string; name: string } => !!a),
    [props, getPropAssetUrl],
  );

  const shots = episode.shots || [];

  // 分镜参考附件中「被提示词实际引用」的图片（!<ref type="image">），
  // 供合规 dialog 审核；assetKey 为 image_asset 行 UUID（历史附件可能缺失）
  const usedShotRefImages = useMemo(() => {
    const allPrompts = [...shots.map((s) => s.prompt || ''), episode.videoPrompt || ''].join(' ');
    const usedUrls = new Set<string>();
    for (const match of allPrompts.matchAll(/!<ref\s+url="([^"]+)"\s+type="image">/g)) {
      usedUrls.add(match[1]);
    }
    if (usedUrls.size === 0) return [];
    const byUrl = new Map<string, { imageUrl: string; imageName: string; assetKey?: string }>();
    for (const s of shots) {
      for (const a of s.referenceAssets || []) {
        if (a.type !== 'image' || !usedUrls.has(a.assetId) || byUrl.has(a.assetId)) continue;
        byUrl.set(a.assetId, { imageUrl: a.assetId, imageName: a.name || '参考附件', assetKey: a.assetKey });
      }
    }
    return [...byUrl.values()];
  }, [shots, episode.videoPrompt]);

  const {
    isAddingShot,
    setIsAddingShot,
    editingShot,
    shotDuration,
    setShotDuration,
    shotMovements,
    setShotMovements,
    shotType,
    setShotType,
    shotAngle,
    setShotAngle,
    shotLighting,
    setShotLighting,
    shotMood,
    setShotMood,
    shotPrompt,
    setShotPrompt,
    shotReferencePrompt,
    setShotReferencePrompt,
    shotReferenceAssets,
    setShotReferenceAssets,
    totalDuration,
    remainingDuration,
    openShotModal,
    handleSaveShot,
    handleDeleteShot,
    handleGenerateShotReference,
  } = useShotEditor({ episodeId: episode.id, shots, updateEpisode, generateShotReferenceImage });

  const {
    isEditingFirstFrame,
    isEditingLastFrame,
    firstFramePromptValue,
    setFirstFramePromptValue,
    lastFramePromptValue,
    setLastFramePromptValue,
    isEditingFirstLastFramePrompt,
    firstLastFrameVideoPromptValue,
    setFirstLastFrameVideoPromptValue,
    openFirstFrameModal,
    handleFirstFrameConfirm,
    handleFirstFrameCancel,
    openLastFrameModal,
    handleLastFrameConfirm,
    handleLastFrameCancel,
    openFirstLastFramePromptModal,
    handleFirstLastFramePromptConfirm,
    handleFirstLastFramePromptCancel,
  } = useFrameEditor({
    episodeId: episode.id,
    firstFramePrompt: episode.firstFramePrompt,
    lastFramePrompt: episode.lastFramePrompt,
    firstLastFrameVideoPrompt: stripPromptToText(episode.firstLastFrameVideoPrompt || ''),
    updateEpisode,
  });

  const {
    previewModalOpen,
    setPreviewModalOpen,
    previewImages,
    previewCurrentIndex,
    previewTitle,
    openImagePreview,
    handlePreviewPrev,
    handlePreviewNext,
  } = useImagePreview();

  // 当前播放的 TTS 音频（避免同时播放多个）
  const currentAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const currentPlayingSpeakerIdRef = React.useRef<string | null>(null);

  // 更新所有同音色按钮的图标状态（speakerKey 为 `custom:<编码后的音频URL>`）
  const updateSpeakerButtons = (speakerKey: string | null, playing: boolean) => {
    if (!speakerKey) return;
    const selector = `[data-tts-custom-url="${speakerKey.slice(7)}"]`;
    const card = document.querySelector('.episode-card-wrapper');
    const buttons = card?.querySelectorAll(selector) || document.querySelectorAll(selector);
    buttons.forEach((btn) => {
      const playIcon = btn.querySelector('.tts-speaker-play') as HTMLElement | null;
      const stopIcon = btn.querySelector('.tts-speaker-stop') as HTMLElement | null;
      if (playIcon) playIcon.style.display = playing ? 'none' : 'inline';
      if (stopIcon) stopIcon.style.display = playing ? 'inline' : 'none';
      if (playing) {
        btn.setAttribute('title', '停止播放');
      } else {
        btn.setAttribute('title', '播放音色');
      }
    });
  };

  // 停止当前播放的音频
  const stopCurrentAudio = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (currentPlayingSpeakerIdRef.current) {
      updateSpeakerButtons(currentPlayingSpeakerIdRef.current, false);
      currentPlayingSpeakerIdRef.current = null;
    }
  };

  // 点击分镜提示词中的喇叭图标播放/停止角色音色
  const handlePromptClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('.tts-speaker-btn') as HTMLElement | null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const customUrl = btn.getAttribute('data-tts-custom-url');
    if (!customUrl) return;
    // 播放键：自定义音色用编码后的音频 URL（区分不同音频）
    const playKey = `custom:${customUrl}`;

    // 如果当前正在播放同一个音色，点击则停止
    if (currentPlayingSpeakerIdRef.current === playKey) {
      stopCurrentAudio();
      return;
    }

    // 停止之前播放的音频
    stopCurrentAudio();

    // 自定义音色直接播放音频地址
    {
      const audio = new Audio(decodeURIComponent(customUrl));
      currentAudioRef.current = audio;
      currentPlayingSpeakerIdRef.current = playKey;
      updateSpeakerButtons(playKey, true);
      audio.onended = () => {
        currentAudioRef.current = null;
        currentPlayingSpeakerIdRef.current = null;
        updateSpeakerButtons(playKey, false);
      };
      audio.play().catch(() => {
        message.error('音频播放失败');
        currentAudioRef.current = null;
        currentPlayingSpeakerIdRef.current = null;
        updateSpeakerButtons(playKey, false);
      });
    }
  };

  // 分镜列表
  // 打开分镜编辑弹窗（新增或编辑）

  // 保存分镜

  // 删除分镜

  // 生成分镜参考图

  const handleTitleChange = (title: string) => {
    updateEpisode(episode.id, { title });
    setIsEditingTitle(false);
  };

  const handleGenerate = async () => {
    try {
      // 合规前置检查（与批量生成共用同一套门禁逻辑，见 videoComplianceCheck.ts）
      const { hasUncompliant } = checkEpisodeVideoCompliance({
        episode,
        characters,
        scenes,
        videoModels,
        currentEpisodeNumber: currentEpisodeNumber ?? 1,
      });
      if (hasUncompliant) {
        // 存在未完成合规入库的图片：打开合规检查对话框
        setComplianceDialogOpen(true);
        return;
      }

      // 正常生成视频
      await generateEpisodeVideo(episode.id);
      // 成功/失败的消息提示已在 generateEpisodeVideo / pollVideoTaskStatus 中处理
    } catch {
      // 错误已在 generateEpisodeVideo 中处理并提示，此处不再重复
    }
  };

  // 合规检查完成后：把厂商合规结果写入 image_asset.data[compliance_key]（厂商隔离），
  // 缓存由 patchImageAssetData 自动更新，通过 bumpImageComplianceVersion 触发 UI 重渲染。
  const handleCheckComplete = async (
    successImages: Array<{
      characterId?: string;
      sceneId?: string;
      imageUrl: string;
      assetId?: string;
      assetKey?: string;
      groupId?: string;
      url?: string;
    }>,
  ) => {
    const validImages = successImages.filter((img) => !!img.assetId && !!img.assetKey);
    // 诊断：被过滤掉的图（assetKey 即 image_asset UUID 缺失，无法写 seedance）
    const skipped = successImages.filter((img) => !img.assetId || !img.assetKey);
    console.log('[handleCheckComplete] successImages=', successImages.length, 'valid=', validImages.length, 'skipped=', skipped.length, {
      valid: validImages.map((v) => ({ type: (v as any).imageType, assetKey: v.assetKey, assetId: v.assetId, imageUrl: v.imageUrl, characterId: v.characterId })),
      skipped: skipped.map((v) => ({ type: (v as any).imageType, assetKey: v.assetKey, assetId: v.assetId, imageUrl: v.imageUrl, characterId: v.characterId })),
    });
    if (validImages.length === 0) return;

    const state = useWorkflowStore.getState();
    const projectId = state.currentProjectId || window.__shotlib_current_project_id;
    // 合规检查是 Seedance 专属：按当前模型 provider 取厂商 helper 构造 data patch
    const provider = videoModels.find((m) => m.id === episode.model)?.provider;
    const helpers = getComplianceHelpers(provider);

    // 1. 持久化：写入 image_asset 行 data.seedance（通用 patch 接口，厂商 key 由 helper 构造）
    if (projectId && helpers) {
      for (const v of validImages) {
        try {
          const patch = helpers.buildCompliancePatch({
            assetId: v.assetId!,
            isCompliant: true,
            groupId: v.groupId,
            url: v.url,
          });
          const res = await localApi.patchImageAssetData(projectId, v.assetKey!, patch);
          console.log('[handleCheckComplete] patchImageAssetData', v.assetKey, '-> updated=', (res as any)?.data?.updated, res);
        } catch (e) {
          console.warn('[EpisodeCard] patchImageAssetData 失败:', v.assetKey, e);
        }
      }
    }

    // 2. 合规状态已写入 image_asset.data（缓存已由 patchImageAssetData 自动更新），
    // 触发 UI 重渲染，订阅 imageComplianceVersion 的组件将从缓存读取最新合规状态
    useWorkflowStore.getState().bumpImageComplianceVersion();
  };

  // 合规检查确认后：构建 passThrough assetIdMap（imageUrl → 火山 assetId）并触发生成视频
  const handleComplianceConfirm = async (
    assetIdMap: Map<string, string>,
    _complianceDetails?: any[],
  ) => {
    console.log('[EpisodeCard] handleComplianceConfirm called with assetIdMap:', assetIdMap?.size);

    // passThrough = 本次检查结果（dialog assetIdMap）∪ 历史已合规图片（从缓存读取）
    const { characters: updatedCharacters } = useWorkflowStore.getState();
    const passThroughMap = new Map<string, string>(assetIdMap || []);
    if (episode.videoGenerationMode === 'first_last_frame') {
      // 首尾帧模式：从缓存读首尾帧合规 assetId 补充
      const frameList = [
        { assetId: episode.firstFrameImageAssetId, imageUrl: episode.firstFrameImageUrl },
        { assetId: episode.lastFrameImageAssetId, imageUrl: episode.lastFrameImageUrl },
      ];
      for (const f of frameList) {
        if (!f.assetId || !f.imageUrl) continue;
        const imgData = localApi.getCachedImageData(f.assetId);
        const compliance = imgData ? readAnyCompliance(imgData) : undefined;
        if (compliance?.assetId && !passThroughMap.has(f.imageUrl)) {
          passThroughMap.set(f.imageUrl, compliance.assetId);
        }
      }
    } else {
      for (const char of updatedCharacters) {
        const allImages = [
          ...(char.avatarImages || []),
          ...(char.multiViewImages || []),
          ...(char.fullBodyImages || []),
        ];
        for (const img of allImages) {
          // 从缓存读取合规状态，取厂商合规 assetId
          const imgData = img.assetId ? localApi.getCachedImageData(img.assetId) : undefined;
          const compliance = imgData ? readAnyCompliance(imgData) : undefined;
          if (compliance?.assetId && img.imageUrl && !passThroughMap.has(img.imageUrl)) {
            passThroughMap.set(img.imageUrl, compliance.assetId);
          }
        }
      }
      // 衍生片段尾帧图：从 shot.referenceImageAssetId 缓存读合规 assetId，
      // 供 buildUniversalReferenceRequest 收集尾帧图时换为 asset://
      for (const s of episode.shots || []) {
        if (!s.useReferenceAsFirstFrame || !s.referenceImageUrl || !s.referenceImageAssetId) continue;
        const imgData = localApi.getCachedImageData(s.referenceImageAssetId);
        const compliance = imgData ? readAnyCompliance(imgData) : undefined;
        if (compliance?.assetId && !passThroughMap.has(s.referenceImageUrl)) {
          passThroughMap.set(s.referenceImageUrl, compliance.assetId);
        }
      }
      // 分镜参考附件图：历史已合规的（assetKey 缓存有合规 assetId）并入 passThroughMap，
      // 本次 dialog 新检查的已由 assetIdMap 带入
      for (const ref of usedShotRefImages) {
        if (!ref.assetKey || passThroughMap.has(ref.imageUrl)) continue;
        const imgData = localApi.getCachedImageData(ref.assetKey);
        const compliance = imgData ? readAnyCompliance(imgData) : undefined;
        if (compliance?.assetId) {
          passThroughMap.set(ref.imageUrl, compliance.assetId);
        }
      }
    }

    // 调用 generateEpisodeVideo 并传入 passThrough assetIdMap
    await generateEpisodeVideo(episode.id, passThroughMap);

    // 关闭合规检查对话框
    setComplianceDialogOpen(false);
  };

  // 继续生成（超时重试）：优先使用 videoTaskId 轮询，若无则查找任务队列继续 Bull 轮询
  const handleRetryGenerate = async () => {
    try {
      updateEpisode(episode.id, { isGenerating: true, videoTaskStatus: 'processing' as const });
      const workflowStore = useWorkflowStore.getState();
      const taskQueueStore = useTaskQueueStore.getState();

      if (episode.videoTaskId) {
        // 有 videoTaskId，直接轮询视频任务状态
        await workflowStore.pollVideoTaskStatus(episode.id, episode.videoTaskId);
      } else {
        // 查找对应的任务（通过 episodeId 在 metadata 中匹配）
        const task = taskQueueStore.tasks.find(
          t => t.metadata?.episodeId === episode.id &&
               t.type === 'episode-video'
        );
        if (task) {
          // 获取 Bull job ID 从 metadata
          const jobId = task.metadata?.jobId || task.metadata?.videoJobId;
          if (jobId) {
            // 关键：轮询循环以「任务状态非 polling」为退出条件，
            // 超时/失败后的任务状态是 failed，直接调 resume 会立即退出——先复位为 polling
            taskQueueStore.updateTask(task.id, {
              status: 'polling',
              error: undefined,
            });
            await workflowStore.resumeBullVideoPolling(
              task.id,        // taskQueueTaskId
              jobId as string, // jobId (Bull Job ID)
              episode.id       // episodeId
            );
          } else {
            message.warning('任务已过期，请重新生成');
            updateEpisode(episode.id, { isGenerating: false, videoTaskStatus: undefined });
          }
        } else {
          // 找不到任务，提示用户重新生成
          message.warning('任务已过期，请重新生成');
          updateEpisode(episode.id, { isGenerating: false, videoTaskStatus: undefined });
        }
      }
    } catch {
      message.error('继续生成失败，请重试');
      updateEpisode(episode.id, { isGenerating: false });
    }
  };

  // 运镜多选变化
  const handleMovementsChange = (checkedValues: string[]) => {
    setShotMovements(checkedValues as CameraMovement[]);
  };

  const handleGenerateFirstFrame = async () => {
    if (!episode.firstFramePrompt?.trim()) {
      message.warning('请先设置首帧提示词');
      return;
    }
    await generateFirstFrame(episode.id);
  };

  const handleGenerateLastFrame = async () => {
    if (!episode.lastFramePrompt?.trim()) {
      message.warning('请先设置尾帧提示词');
      return;
    }
    await generateLastFrame(episode.id);
  };

  // 打开图片预览

  // 预览切换

  // HTML 内容区鼠标事件委托：检测角色/场景/形象照标签 hover，显示 fixed 预览
  const getAssetIdByUrl = (url: string): string | undefined => {
    for (const c of characters) {
      const allImages = [
        ...(c.avatarImages || []),
        ...(c.multiViewImages || []),
        ...(c.fullBodyImages || []),
      ];
      const found = allImages.find((img) => img.imageUrl === url && img.assetId);
      if (found) return found.assetId;
    }
    return undefined;
  };

  const handleHtmlMouseOver = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // 关键修复：同时识别 [data-hover-image]（有图 pill）和外层 span 上的 [data-hover-type]（无图 pill）
    const tag = (target.closest('[data-hover-image]') || target.closest('[data-hover-type]')) as HTMLElement | null;
    if (tag) {
      const src = tag.dataset.hoverImage || '';
      const name = tag.dataset.hoverName || '';
      const type = (tag.dataset.hoverType || 'role') as 'role' | 'scene' | 'portrait';
      const text = tag.dataset.hoverText || '';
      if (src || text) {
        const rect = tag.getBoundingClientRect();
        setHoverPreview({
          src,
          name,
          type,
          // 关键修复：无图时把文字说明传给 hover 预览，让用户看到"为什么没图"
          text: text || undefined,
          x: rect.left + rect.width / 2,
          y: rect.top,
          assetId: src ? getAssetIdByUrl(src) : undefined,
        });
      }
    }
  };

  const handleHtmlMouseMove = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // 关键修复：同上，同时识别两种 pill
    const tag = (target.closest('[data-hover-image]') || target.closest('[data-hover-type]')) as HTMLElement | null;
    if (!tag) {
      setHoverPreview(null);
      return;
    }
    const src = tag.dataset.hoverImage || '';
    const name = tag.dataset.hoverName || '';
    const type = (tag.dataset.hoverType || 'role') as 'role' | 'scene' | 'portrait';
    const text = tag.dataset.hoverText || '';
    if (src || text) {
      const rect = tag.getBoundingClientRect();
      setHoverPreview((prev) => {
        const nextX = rect.left + rect.width / 2;
        const nextY = rect.top;
        if (prev && prev.src === src && prev.text === text && prev.x === nextX && prev.y === nextY) return prev;
        return { src, name, type, text: text || undefined, x: nextX, y: nextY, assetId: src ? getAssetIdByUrl(src) : undefined };
      });
    }
  };

  // 处理帧模型变化
  const handleFrameModelChange = (model: string) => {
    updateEpisode(episode.id, { frameModel: model });
  };

  // 处理尾帧模型变化
  const handleLastFrameModelChange = (model: string) => {
    updateEpisode(episode.id, { lastFrameModel: model });
  };

  // 获取当前视频模型的时长配置
  const currentVideoModel = videoModels.find(m => m.id === episode.model);
  const durationConfig = currentVideoModel?.duration;

  // 获取当前项目的画面比例
  const projectAspectRatio = useProjectStore((s) => {
    const project = s.projects.find((p) => p.id === s.currentProjectId);
    return project?.aspectRatio || '16:9';
  });
  
  // 根据画面比例获取对应的 CSS class
  const getAspectRatioClass = (ratio: string): string => {
    switch (ratio) {
      case '9:16':
        return 'aspect-[9/16]';
      case '21:9':
        return 'aspect-[21/9]';
      case '4:3':
        return 'aspect-[4/3]';
      case '1:1':
        return 'aspect-square';
      case '16:9':
      default:
        return 'aspect-video';
    }
  };
  
  const aspectRatioClass = getAspectRatioClass(projectAspectRatio);

  // 计算当前应该显示的视频列表
  const allVideos = useMemo(() => {
    const generatedVideos = episode.generatedVideos || [];
    return episode.generatedVideoUrl
      ? [{ url: episode.generatedVideoUrl, sequence: generatedVideos.length + 1, createdAt: new Date().toISOString(), generationMode: episode.videoGenerationMode }, ...generatedVideos]
      : generatedVideos;
  }, [episode.generatedVideoUrl, episode.generatedVideos, episode.videoGenerationMode]);
  
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  
  // 当前显示的视频
  const currentVideo = allVideos[currentVideoIndex] || null;
  
  // 切换视频
  const handlePrevVideo = () => {
    if (allVideos.length <= 1) return;
    setCurrentVideoIndex((prev) => (prev === 0 ? allVideos.length - 1 : prev - 1));
  };
  
  const handleNextVideo = () => {
    if (allVideos.length <= 1) return;
    setCurrentVideoIndex((prev) => (prev === allVideos.length - 1 ? 0 : prev + 1));
  };

  // 处理视频模型变化
  const handleVideoModelChange = (model: string) => {
    const newModel = videoModels.find(m => m.id === model);
    const newDurationConfig = newModel?.duration;
    let newVideoDuration = episode.videoDuration ?? newDurationConfig?.default ?? 5;
    if (newDurationConfig) {
      // 如果当前时长不在新模型支持范围内，调整为默认值
      if (newVideoDuration === -1 && !newDurationConfig.allowAuto) {
        newVideoDuration = newDurationConfig.default;
      } else if (newVideoDuration !== -1 && (newVideoDuration < newDurationConfig.min || newVideoDuration > newDurationConfig.max)) {
        newVideoDuration = newDurationConfig.default;
      }
    }
    // 如果新模型不支持全能参考，重置生成方式为首尾帧
    const supportsReferenceImage = !!newModel?.supports?.reference_image;
    const updates: Partial<Episode> = { model, videoDuration: newVideoDuration };
    if (!supportsReferenceImage) {
      updates.videoGenerationMode = 'first_last_frame';
    }
    updateEpisode(episode.id, updates);
  };

  // 按当前生成模式过滤模型列表（依据模型配置 json 的 supports 字段，禁止硬编码）；
  // 项目片段时长上限为 30s 时，仅保留 model.json 中 duration.max >= 30 的长片段模型
  const currentGenerationMode = episode.videoGenerationMode ?? 'reference_image';
  const episodeMaxDuration = useWorkflowStore((s) => s.episodeMaxDuration) || 15;
  const filteredVideoModels = videoModels.filter((m) => {
    if (m.disabled) return false;
    if (episodeMaxDuration > 15 && ((m as any).duration?.max ?? 15) < episodeMaxDuration) return false;
    if (currentGenerationMode === 'reference_image') {
      return m.supports?.reference_image === true;
    }
    return m.supports?.first_frame === true && m.supports?.last_frame === true;
  });

  // 若当前模型不在过滤后的列表中，自动回退到第一个可用模型；否则保持之前选过的
  const effectiveModelId = filteredVideoModels.some((m) => m.id === episode.model)
    ? episode.model
    : (filteredVideoModels.find((m) => !m.disabled)?.id || videoModels.find((m) => !m.disabled)?.id || '');

  // 处理视频生成方式变化：切换时自动校验并回退模型
  const handleVideoGenerationModeChange = (mode: 'first_last_frame' | 'reference_image') => {
    const nextFiltered = videoModels.filter((m) => {
      if (m.disabled) return false;
      if (episodeMaxDuration > 15 && ((m as any).duration?.max ?? 15) < episodeMaxDuration) return false;
      if (mode === 'reference_image') {
        return m.supports?.reference_image === true;
      }
      return m.supports?.first_frame === true && m.supports?.last_frame === true;
    });
    const nextModelId = nextFiltered.some((m) => m.id === episode.model)
      ? episode.model
      : (nextFiltered.find((m) => !m.disabled)?.id || videoModels.find((m) => !m.disabled)?.id || '');
    const updates: Partial<Episode> = { videoGenerationMode: mode };
    if (nextModelId && nextModelId !== episode.model) {
      updates.model = nextModelId;
      // 同步调整时长范围
      const newModel = videoModels.find((m) => m.id === nextModelId);
      const newDurationConfig = newModel?.duration;
      if (newDurationConfig) {
        let newVideoDuration = episode.videoDuration ?? newDurationConfig.default ?? 5;
        if (newVideoDuration === -1 && !newDurationConfig.allowAuto) {
          newVideoDuration = newDurationConfig.default;
        } else if (
          newVideoDuration !== -1 &&
          (newVideoDuration < newDurationConfig.min || newVideoDuration > newDurationConfig.max)
        ) {
          newVideoDuration = newDurationConfig.default;
        }
        updates.videoDuration = newVideoDuration;
      }
    }
    updateEpisode(episode.id, updates);
  };

  // 处理视频时长变化
  const handleVideoDurationChange = (duration: number) => {
    const min = durationConfig?.min ?? 1;
    const max = durationConfig?.max ?? 15;
    const clamped = Math.min(max, Math.max(min, duration));
    updateEpisode(episode.id, { videoDuration: clamped });
  };

  return (
    <>
    <Card className="bg-bg-secondary border-border rounded-xl overflow-hidden"
      onMouseOver={handleHtmlMouseOver}
      onMouseMove={handleHtmlMouseMove}
    >
      {/* 左右两栏布局 */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* 左侧：标题、分镜、提示词、按钮 */}
        <div className="flex-1 min-w-0">
          {/* 头部 */}
          <div className="mb-4">
            <div className="group flex items-center justify-between mb-2">
              {isEditingTitle ? (
                <Input
                  value={episode.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  onBlur={() => setIsEditingTitle(false)}
                  autoFocus
                  className="text-lg font-semibold bg-bg-tertiary border-border"
                />
              ) : (
                <h4
                  onClick={() => setIsEditingTitle(true)}
                  className="text-lg font-semibold text-text-primary cursor-pointer hover:text-accent-primary transition-colors flex items-center gap-2"
                >
                  {episode.title}
                  <Edit3 size={14} className="opacity-0 group-hover:opacity-100" />
                </h4>
              )}

              {/* 删除片段（常驻显示在标题/修改按钮后，二次确认后软删除） */}
              <Popconfirm
                title="确定删除此片段？"
                description="删除后片段不再显示（数据保留，可恢复）"
                onConfirm={() => removeEpisode(episode.id)}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Tooltip title="删除片段">
                  <Button
                    type="text"
                    size="small"
                    icon={<Trash2 size={14} />}
                    className="text-text-muted hover:text-red-500"
                  />
                </Tooltip>
              </Popconfirm>
            </div>

            <p className="text-sm text-text-secondary">{episode.description}</p>
          </div>

          {/* 生成方式 Tabs */}
          <Tabs
            activeKey={currentGenerationMode}
            defaultActiveKey="reference_image"
            onChange={(key) => handleVideoGenerationModeChange(key as 'first_last_frame' | 'reference_image')}
            type="card"
            size="small"
            className="mb-4 episode-generation-tabs"
            items={[
              {
                key: 'reference_image',
                label: '全能参考生成',
                children: (
                  <EpisodeShotListSection
                    episode={episode}
                    shots={shots}
                    totalDuration={totalDuration}
                    remainingDuration={remainingDuration}
                    aspectRatioClass={aspectRatioClass}
                    characters={characters}
                    scenes={scenes}
                    openShotModal={openShotModal}
                    openImagePreview={openImagePreview}
                    handlePromptClick={handlePromptClick}
                    handleGenerateShotReference={handleGenerateShotReference}
                    handleDeleteShot={handleDeleteShot}
                    updateEpisode={updateEpisode}
                    sanitizeHtml={sanitizeHtml}
                  />
                ),
              },
              {
                key: 'first_last_frame',
                label: '首尾帧生成',
                children: (
                  <EpisodeFirstLastFrameSection
                    episode={episode}
                    aspectRatioClass={aspectRatioClass}
                    imageModels={imageModels}
                    characters={characters}
                    scenes={scenes}
                    handleFrameModelChange={handleFrameModelChange}
                    handleLastFrameModelChange={handleLastFrameModelChange}
                    openFirstFrameModal={openFirstFrameModal}
                    openLastFrameModal={openLastFrameModal}
                    openFirstLastFramePromptModal={openFirstLastFramePromptModal}
                    handleGenerateFirstFrame={handleGenerateFirstFrame}
                    handleGenerateLastFrame={handleGenerateLastFrame}
                    openImagePreview={openImagePreview}
                    handlePromptClick={handlePromptClick}
                    sanitizeHtml={sanitizeHtml}
                  />
                ),
              },
            ]}
          />

        </div>

        {/* 右侧：视频预览区 + 生成方式选择和生成按钮 */}
        <EpisodeCardVideoPanel
          episode={episode}
          aspectRatioClass={aspectRatioClass}
          currentVideo={currentVideo}
          allVideos={allVideos}
          currentVideoIndex={currentVideoIndex}
          handlePrevVideo={handlePrevVideo}
          handleNextVideo={handleNextVideo}
          currentGenerationMode={currentGenerationMode}
          durationConfig={durationConfig}
          handleVideoDurationChange={handleVideoDurationChange}
          effectiveModelId={effectiveModelId}
          filteredVideoModels={filteredVideoModels}
          handleVideoModelChange={handleVideoModelChange}
          totalDuration={totalDuration}
          handleGenerate={handleGenerate}
          handleRetryGenerate={handleRetryGenerate}
          videoModels={videoModels}
          updateEpisode={updateEpisode}
        />
      </div>

      {/* 视频提示词编辑弹窗已移除 */}

      {/* 首尾帧视频提示词编辑弹窗 */}
      <PromptEditModal
        title="编辑首尾帧视频提示词"
        open={isEditingFirstLastFramePrompt}
        value={firstLastFrameVideoPromptValue}
        onChange={setFirstLastFrameVideoPromptValue}
        onOk={handleFirstLastFramePromptConfirm}
        onCancel={handleFirstLastFramePromptCancel}
        characters={characters}
        scenes={scenes}
        placeholder="描述首尾帧视频生成的内容..."
        plainText
      />

      {/* 首帧提示词编辑弹窗 */}
      <PromptEditModal
        title="编辑首帧提示词"
        open={isEditingFirstFrame}
        value={firstFramePromptValue}
        onChange={setFirstFramePromptValue}
        onOk={handleFirstFrameConfirm}
        onCancel={handleFirstFrameCancel}
        characters={characters}
        scenes={scenes}
        referenceAssets={propAssets}
        placeholder="描述视频首帧画面内容，输入 @ 插入角色，输入 # 插入场景，输入 ! 引用道具..."
        withLabel
      />

      {/* 尾帧提示词编辑弹窗 */}
      <PromptEditModal
        title="编辑尾帧提示词"
        open={isEditingLastFrame}
        value={lastFramePromptValue}
        onChange={setLastFramePromptValue}
        onOk={handleLastFrameConfirm}
        onCancel={handleLastFrameCancel}
        characters={characters}
        scenes={scenes}
        referenceAssets={propAssets}
        placeholder="描述视频尾帧画面内容，输入 @ 插入角色，输入 # 插入场景，输入 ! 引用道具..."
        withLabel
      />

      {/* 分镜编辑弹窗 */}
      <ShotEditModal
        open={isAddingShot}
        editingShot={editingShot}
        remainingDuration={remainingDuration}
        shotDuration={shotDuration}
        setShotDuration={setShotDuration}
        shotMovements={shotMovements}
        handleMovementsChange={handleMovementsChange}
        shotType={shotType}
        setShotType={setShotType}
        shotAngle={shotAngle}
        setShotAngle={setShotAngle}
        shotLighting={shotLighting}
        setShotLighting={setShotLighting}
        shotMood={shotMood}
        setShotMood={setShotMood}
        shotPrompt={shotPrompt}
        setShotPrompt={setShotPrompt}
        shotReferencePrompt={shotReferencePrompt}
        setShotReferencePrompt={setShotReferencePrompt}
        shotReferenceAssets={shotReferenceAssets}
        setShotReferenceAssets={setShotReferenceAssets}
        characters={characters}
        scenes={scenes}
        propAssets={propAssets}
        onSave={handleSaveShot}
        onCancel={() => {
          setIsAddingShot(false);
          setShotPrompt('');
          setShotReferencePrompt('');
          setShotReferenceAssets([]);
        }}
        sanitizeHtml={sanitizeHtml}
      />
    </Card>

    {/* 角色/场景/形象照 hover 预览 */}
    <HoverImagePreview preview={hoverPreview} />

    {/* 图片预览模态框 */}
    <ImagePreviewModal
      isOpen={previewModalOpen}
      images={previewImages}
      currentIndex={previewCurrentIndex}
      onClose={() => setPreviewModalOpen(false)}
      onPrev={handlePreviewPrev}
      onNext={handlePreviewNext}
      title={previewTitle}
    />

    {/* 视频合规检查对话框 */}
    <VideoComplianceDialog
      open={complianceDialogOpen}
      onClose={() => setComplianceDialogOpen(false)}
      onConfirm={handleComplianceConfirm}
      onCheckComplete={handleCheckComplete}
      characters={
        episode.videoGenerationMode === 'first_last_frame'
          ? []
          : filterCharacterPortraitsByEpisode(characters, currentEpisodeNumber ?? 1).map((char) => ({
              ...char,
              avatarImages: char.avatarImages,
              multiViewImages: char.multiViewImages,
              fullBodyImages: char.fullBodyImages,
            }))
      }
      scenes={
        episode.videoGenerationMode === 'first_last_frame'
          ? undefined
          : scenes
              .filter((s) => s.isDerived)
              .map((s) => ({
                id: s.id,
                name: s.name,
                imageUrls: s.imageUrls,
                imageAssetIds: s.imageAssetIds,
              }))
      }
      frameImages={
        episode.videoGenerationMode === 'first_last_frame'
          ? [
              { imageUrl: episode.firstFrameImageUrl, assetKey: episode.firstFrameImageAssetId, imageName: '首帧' },
              { imageUrl: episode.lastFrameImageUrl, assetKey: episode.lastFrameImageAssetId, imageName: '尾帧' },
            ].filter(
              (f): f is { imageUrl: string; assetKey: string; imageName: string } =>
                !!f.imageUrl && !!f.assetKey,
            )
          : undefined
      }
      episodeId={episode.id}
      shotRefImages={
        episode.videoGenerationMode === 'first_last_frame' ? undefined : usedShotRefImages
      }
      shotPrompts={
        episode.videoGenerationMode === 'first_last_frame'
          ? [
              episode.firstFramePrompt,
              episode.lastFramePrompt,
              episode.firstLastFrameVideoPrompt,
              episode.videoPrompt,
            ].filter((p): p is string => !!p)
          : [
              ...(episode.shots?.map(s => s.prompt) || []),
              episode.videoPrompt,
            ].filter((p): p is string => !!p)
      }
    />
    </>
  );
};
