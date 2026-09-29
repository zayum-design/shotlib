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

/**
 * workflowStore.episode.video.ts — 片段视频生成相关 Slice
 *
 * 包含：generateEpisodeVideo, pollVideoTaskStatus, checkPendingVideoTasks, resumeBullVideoPolling
 */
import { Modal } from 'antd';
import type { StoreApi } from 'zustand';
import * as workflowApi from '../api/workflowApi';
import { getCurrentProjectAspectRatio, saveWorkflowStateToLocal, filterCharacterPortraitsByEpisode } from '../utils/workflowUtils';
import { buildUrl } from '@/shared/config/api';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { useLoadingStore } from '@/shared/stores/useLoadingStore';
import { shouldPreview, triggerPreview } from './workflowStore';
import type { WorkflowState } from './workflowStore';
import { message } from '@/shared/utils/message';
import { buildActingPrefix, buildUniversalReferenceRequest, convertPromptToHtml, withVideoPromptSuffix } from './workflowStore.episode.utils';
import { saveToServer } from './workflowStore.sync';
import { getVideoPromptFormatter } from '../providers/video-prompt-factory';
import { getComplianceHelpers, readAnyCompliance } from '../providers/compliance-factory';
import { localApi } from '@/storage';
import { calcSimulatedProgress, VIDEO_PROGRESS_TICK, VIDEO_PROGRESS_START } from '@/shared/utils/videoProgress';

type SetFn = StoreApi<WorkflowState>['setState'];
type GetFn = StoreApi<WorkflowState>['getState'];

// ===== 视频生成模拟进度计时器 =====
// 后端视频生成是异步任务，真实进度无法获取；前端用基于已耗时间的减速渐近曲线模拟进度，
// 避免进度条长时间停留在 0%（提交后到首次轮询返回约 10s+），提升等待体验。
// 计时器与真实轮询解耦：即使轮询因网络波动暂停，进度条仍持续缓慢增长；
// 任务完成时跳 100%，失败/超时由 isGenerating=false 自动停止计时器。
const VIDEO_PROGRESS_TIMERS = new Map<string, ReturnType<typeof setInterval>>();
// ===== 视频生成重入锁 =====
// 同一 episode 在 doGenerate 执行期间持有，防止重复点击 / 预览等待期间重入导致 doGenerate
// 被多次执行，进而在后端 llm_task 表创建重复的"生成视频"记录
const GENERATING_EPISODES = new Set<string>();
// ===== 轮询重入守卫 =====
// 恢复链路可能从多个入口触发同一任务的轮询（页面挂载 / 数据加载完成 / 任务队列恢复订阅），
// 防止同一任务并发启动多个轮询循环
const ACTIVE_VIDEO_POLLS = new Set<string>();
// 进度算法与常量复用自 @/shared/utils/videoProgress（与 generate 模块视频占位共用同一曲线）

/** 停止指定片段的模拟进度计时器 */
function stopVideoProgressTimer(episodeId: string) {
  const id = VIDEO_PROGRESS_TIMERS.get(episodeId);
  if (id) {
    clearInterval(id);
    VIDEO_PROGRESS_TIMERS.delete(episodeId);
  }
}

/**
 * 视频生成完成后建行到项目资产库
 * （creator_drama_project_assets，category=image_asset，asset_type=episode_video），
 * 返回 url → assetId 映射；建行失败不阻断视频展示（返回空 Map）
 */
async function createEpisodeVideoAssetRows(
  projectId: string | undefined,
  episodeNumber: number,
  urls: string[],
  metadata: Record<string, any>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const validUrls = urls.filter((u) => !!u);
  if (!projectId || projectId === 'default' || validUrls.length === 0) return map;
  try {
    const res = await localApi.createImageAssets(projectId, {
      assets: validUrls.map((url) => ({
        episode_number: episodeNumber,
        asset_type: 'episode_video',
        original_url: url,
        source: 'ai',
        metadata,
      })),
    });
    const rows = (res?.data || []) as any[];
    for (const row of rows) {
      const assetId = row?.asset_key || row?.id;
      const url = row?.data?.original_url;
      if (assetId && url) map.set(url, assetId);
    }
  } catch (e) {
    console.error('[createEpisodeVideoAssetRows] 视频资产建行失败（不影响视频展示）:', e);
  }
  return map;
}

export interface EpisodeVideoSliceActions {
  generateEpisodeVideo: (episodeId: string, assetIdMap?: Map<string, string>) => Promise<void>;
  getEpisodeVideoPreviewData: (episodeId: string) => { endpoint: string; body: any } | null;
  pollVideoTaskStatus: (episodeId: string, taskId: string, taskQueueTaskId?: string) => Promise<void>;
  checkPendingVideoTasks: () => void;
  resumeBullVideoPolling: (taskQueueTaskId: string, jobId: string, episodeId: string) => void;
}

export function createEpisodeVideoSlice(set: SetFn, get: GetFn): EpisodeVideoSliceActions {
  // 视频生成提交 API 超时：后端可能同步等待 Bull 任务，需给足时间
  const VIDEO_GENERATION_API_TIMEOUT = 2 * 60 * 60 * 1000; // 2小时

  /**
   * 启动模拟进度计时器（幂等：已在运行则跳过，保证 Bull→视频任务两阶段进度连续不回退）
   * 计时器检测到任务结束（isGenerating=false 或 progress>=100）会自动停止，避免泄露
   */
  const startVideoProgressTimer = (episodeId: string) => {
    if (VIDEO_PROGRESS_TIMERS.has(episodeId)) return;
    const startTime = Date.now();
    const intervalId = setInterval(() => {
      const ep = get().episodes.find((e) => e.id === episodeId);
      if (!ep || !ep.isGenerating || (ep.videoGenerationProgress ?? 0) >= 100) {
        stopVideoProgressTimer(episodeId);
        return;
      }
      const progress = calcSimulatedProgress((Date.now() - startTime) / 1000);
      set((state) => ({
        episodes: state.episodes.map((e) =>
          e.id === episodeId ? { ...e, videoGenerationProgress: progress } : e
        ),
      }));
    }, VIDEO_PROGRESS_TICK);
    VIDEO_PROGRESS_TIMERS.set(episodeId, intervalId);
  };

  // 任务队列恢复事件驱动：中断的 episode-video 任务被恢复为 polling（或被标记为可恢复 failed）后，
  // 自动触发 checkPendingVideoTasks 路由（启动 Bull/Phase2 轮询）。
  // 避免恢复依赖「数据加载完成 vs 任务队列用户域重载」的先后时序——
  // 此前若任务队列在数据加载后才完成恢复，workflow 侧再无触发点，任务永远悬停
  let recoveryTriggerTimer: ReturnType<typeof setTimeout> | null = null;
  useTaskQueueStore.subscribe((state, prev) => {
    const prevStatusById = new Map(prev.tasks.map((t) => [t.id, t.status]));
    const becameRecoverable = state.tasks.some((t) => {
      if (t.type !== 'episode-video') return false;
      if (prevStatusById.get(t.id) === t.status) return false;
      if (t.status === 'polling') return !!(t.metadata?.videoTaskId || t.metadata?.videoJobId);
      if (t.status === 'failed') {
        return (
          t.error === '页面刷新，任务中断' ||
          t.error === 'Bull 任务轮询超时' ||
          t.error === '任务中断且无法恢复（缺少 jobId/videoTaskId）'
        );
      }
      return false;
    });
    if (!becameRecoverable || recoveryTriggerTimer) return;
    recoveryTriggerTimer = setTimeout(() => {
      recoveryTriggerTimer = null;
      get().checkPendingVideoTasks();
    }, 300);
  });

  return {
    getEpisodeVideoPreviewData: (episodeId: string): { endpoint: string; body: any } | null => {
      const { episodes, characters, scenes } = get();
      const episode = episodes.find((e) => e.id === episodeId);
      if (!episode) return null;

      const generationMode = episode.videoGenerationMode || 'reference_image';
      let previewRequestData: { endpoint: string; body: any } | null = null;

      const videoModels = get().videoModels;
      const currentModelConfig = videoModels.find((m) => m.id === episode.model);
      // 合规判定与资产 URL 构造均由厂商 helper 提供（Seedance 专属，不在此硬编码标志/scheme）
      const complianceHelpers = getComplianceHelpers(currentModelConfig?.provider);
      const needsCompliance = complianceHelpers?.isComplianceRequired(currentModelConfig) ?? false;

      // 构建统一的 assetIdMap：imageUrl → 厂商合规 assetId（从 image_asset.data 缓存读取），
      // 仅含角色头像/形象照/多视图。场景图未经过合规检查（无合规 assetId），不加入此 map，
      // 保持原始 URL 提交。
      const assetIdMap = new Map<string, string>();
      if (needsCompliance) {
        for (const char of characters) {
          for (const img of [
            ...(char.avatarImages || []),
            ...(char.multiViewImages || []),
            ...(char.fullBodyImages || []),
          ]) {
            const imgData = img.assetId ? localApi.getCachedImageData(img.assetId) : undefined;
            const compliance = imgData ? readAnyCompliance(imgData) : undefined;
            if (compliance?.assetId && img.imageUrl && !assetIdMap.has(img.imageUrl)) {
              assetIdMap.set(img.imageUrl, compliance.assetId);
            }
          }
        }
        // 首尾帧图：同样从缓存读合规 assetId，与 doGenerate 的 effectiveAssetIdMap 保持一致，
        // 确保预览 dialog 展示的 firstFrameUrl/lastFrameUrl 与实际提交一致（已替换为厂商 assetId）
        for (const f of [
          { assetId: episode.firstFrameImageAssetId, imageUrl: episode.firstFrameImageUrl },
          { assetId: episode.lastFrameImageAssetId, imageUrl: episode.lastFrameImageUrl },
        ]) {
          if (!f.assetId || !f.imageUrl) continue;
          const imgData = localApi.getCachedImageData(f.assetId);
          const compliance = imgData ? readAnyCompliance(imgData) : undefined;
          if (compliance?.assetId && !assetIdMap.has(f.imageUrl)) {
            assetIdMap.set(f.imageUrl, compliance.assetId);
          }
        }
        // 分镜参考附件图：与 doGenerate 一致，从 assetKey 缓存补 url→合规 assetId
        for (const s of episode.shots || []) {
          for (const a of s.referenceAssets || []) {
            if (a.type !== 'image' || !a.assetKey || !a.assetId) continue;
            const imgData = localApi.getCachedImageData(a.assetKey);
            const compliance = imgData ? readAnyCompliance(imgData) : undefined;
            if (compliance?.assetId && !assetIdMap.has(a.assetId)) {
              assetIdMap.set(a.assetId, compliance.assetId);
            }
          }
        }
      }

      const replaceUrlWithAssetId = (url: string | undefined): string | undefined => {
        if (!needsCompliance || !url || !complianceHelpers) return url;
        return complianceHelpers.resolveReferenceUrl(url, undefined, assetIdMap);
      };

      if (generationMode === 'first_last_frame') {
        let rawPrompt = episode.firstLastFrameVideoPrompt || episode.videoPrompt || '';
        rawPrompt = rawPrompt.replace(/@<role\s+character-id="[^"]+">([^<]*)<img[^>]*><\/role>/g, '$1').replace(/@<role\s+character-id="[^"]+">([^<]*)<\/role>/g, '$1').replace(/#<scene\s+scene-id="[^"]+">([^<]*)<img[^>]*><\/scene>/g, '$1').replace(/#<scene\s+scene-id="[^"]+">([^<]*)<\/scene>/g, '$1').replace(/<img[^>]*>/g, '').replace(/\[图\d+\]/g, '').replace(/\s+/g, ' ').trim();
        // 预览与真实提交一致：统一追加约束后缀（剥离旧后缀防重复）
        const videoPrompt = withVideoPromptSuffix(rawPrompt);
        const selectedModel = videoModels.find((m) => m.id === episode.model);
        const supports = selectedModel?.supports || {};
        const hasFirstFrame = !!supports.first_frame;
        const hasLastFrame = !!supports.last_frame;
        const hasGenerateAudio = !!supports.generate_audio;
        const fallbackModel = videoModels.find((m) => m.supports?.first_frame);
        const frameSupportedModel = hasFirstFrame && selectedModel ? selectedModel.id : fallbackModel?.id || '';
        const videoDuration = episode.videoDuration || 5;
        const canUseLastFrame = episode.lastFrameImageUrl && hasLastFrame;
        const canUseAudio = hasGenerateAudio;

        if (episode.firstFrameImageUrl && canUseLastFrame) {
          previewRequestData = { endpoint: `/api/creator/episode/${episodeId}/video-with-frames`, body: { videoPrompt, firstFrameUrl: replaceUrlWithAssetId(episode.firstFrameImageUrl), lastFrameUrl: replaceUrlWithAssetId(episode.lastFrameImageUrl), model: frameSupportedModel, generateAudio: canUseAudio, ratio: getCurrentProjectAspectRatio(), duration: videoDuration } };
        } else if (episode.firstFrameImageUrl) {
          previewRequestData = { endpoint: `/api/creator/episode/${episodeId}/video-with-frames`, body: { videoPrompt, firstFrameUrl: replaceUrlWithAssetId(episode.firstFrameImageUrl), model: frameSupportedModel, generateAudio: canUseAudio, ratio: getCurrentProjectAspectRatio(), duration: videoDuration } };
        } else {
          previewRequestData = { endpoint: `/api/creator/episode/${episodeId}/video`, body: { videoPrompt, model: frameSupportedModel, duration: videoDuration } };
        }
      } else {
        const currentEpisodeNumber = get().currentEpisodeNumber ?? 1;
        const episodeCharacters = filterCharacterPortraitsByEpisode(characters, currentEpisodeNumber);
        const refData = buildUniversalReferenceRequest(episode, episodeCharacters, scenes, videoModels, getVideoPromptFormatter, assetIdMap, characters, get().episodeMaxDuration || 15, get().props);
        if (refData.referenceImages.length === 0 && refData.referenceAudios.length === 0 && refData.referenceVideos.length === 0) {
          previewRequestData = { endpoint: `/api/creator/episode/${episodeId}/video`, body: { videoPrompt: refData.processedPrompt, model: episode.model, ratio: getCurrentProjectAspectRatio(), duration: refData.totalDuration } };
        } else {
          previewRequestData = { endpoint: `/api/creator/episode/${episodeId}/video-with-references`, body: { videoPrompt: refData.processedPrompt, referenceImageUrls: refData.referenceImages.map(replaceUrlWithAssetId), referenceVideos: refData.referenceVideos.length > 0 ? refData.referenceVideos : undefined, referenceAudios: refData.referenceAudios.length > 0 ? refData.referenceAudios : undefined, referenceAudioMap: Object.keys(refData.referenceAudioMap).length > 0 ? refData.referenceAudioMap : undefined, model: refData.referenceModel, ratio: getCurrentProjectAspectRatio(), duration: refData.totalDuration } };
        }
      }

      return previewRequestData;
    },

    generateEpisodeVideo: async (episodeId: string, assetIdMap?: Map<string, string>) => {
      const { episodes, characters, scenes } = get();
      const episode = episodes.find((e) => e.id === episodeId);
      console.log(`[generateEpisodeVideo] ENTRY episodeId=${episodeId}, found=${!!episode}, mode=${episode?.videoGenerationMode}, model=${episode?.model}, shots=${episode?.shots?.length ?? 0}, assetIdMapSize=${assetIdMap?.size ?? 0}`);
      if (!episode) {
        console.error('[generateEpisodeVideo] episode not found, returning silently');
        return;
      }

      const videoModels = get().videoModels;
      // 片段总时长 30s 时校验视频模型的时长上限（model.json duration.max），不支持则自动回退到可用长片段模型
      const episodeMaxDuration = get().episodeMaxDuration || 15;
      if (episodeMaxDuration > 15) {
        const cfg = videoModels.find((m) => m.id === episode.model);
        if ((cfg?.duration?.max ?? 15) < episodeMaxDuration) {
          const fallback = videoModels.find((m) => !m.disabled && (m.duration?.max ?? 15) >= episodeMaxDuration);
          if (!fallback) {
            message.error('30s 片段仅支持 seedance2.5 模型，请先在片段卡片上切换视频模型');
            return;
          }
          get().updateEpisode(episodeId, { model: fallback.id });
          episode.model = fallback.id;
        }
      }
      const currentModelConfig = videoModels.find((m) => m.id === episode.model);
      // 合规判定与资产 URL 构造均由厂商 helper 提供（Seedance 专属，不在此硬编码标志/scheme）
      const complianceHelpers = getComplianceHelpers(currentModelConfig?.provider);
      const needsCompliance = complianceHelpers?.isComplianceRequired(currentModelConfig) ?? false;

      // 如果外部未传入 assetIdMap，从缓存自动构建 fallback map
      // （imageUrl → 厂商合规 assetId，从 image_asset.data 缓存读取）
      let effectiveAssetIdMap = assetIdMap;
      if (needsCompliance && (!effectiveAssetIdMap || effectiveAssetIdMap.size === 0)) {
        const { characters: allChars } = get();
        effectiveAssetIdMap = new Map<string, string>();
        let totalImgs = 0;
        let withAssetId = 0;
        let cachedImgs = 0;
        let complianceImgs = 0;
        for (const char of allChars) {
          for (const img of [
            ...(char.avatarImages || []),
            ...(char.multiViewImages || []),
            ...(char.fullBodyImages || []),
          ]) {
            totalImgs++;
            if (img.assetId) withAssetId++;
            const imgData = img.assetId ? localApi.getCachedImageData(img.assetId) : undefined;
            if (imgData) cachedImgs++;
            const compliance = imgData ? readAnyCompliance(imgData) : undefined;
            if (compliance?.assetId) complianceImgs++;
            if (compliance?.assetId && img.imageUrl && !effectiveAssetIdMap.has(img.imageUrl)) {
              effectiveAssetIdMap.set(img.imageUrl, compliance.assetId);
            }
          }
        }
        // 首尾帧图：同样从缓存读合规 assetId，供首尾帧模式 firstFrameUrl/lastFrameUrl 替换为 asset://
        for (const f of [
          { assetId: episode.firstFrameImageAssetId, imageUrl: episode.firstFrameImageUrl },
          { assetId: episode.lastFrameImageAssetId, imageUrl: episode.lastFrameImageUrl },
        ]) {
          if (!f.assetId || !f.imageUrl) continue;
          const imgData = localApi.getCachedImageData(f.assetId);
          const compliance = imgData ? readAnyCompliance(imgData) : undefined;
          if (compliance?.assetId && !effectiveAssetIdMap.has(f.imageUrl)) {
            effectiveAssetIdMap.set(f.imageUrl, compliance.assetId);
          }
        }
        // 分镜参考附件图（!<ref type="image">）：assetKey → 缓存合规 assetId，
        // 供 replaceRefAssetTags 把附件 URL 替换为 asset://（合规过一次后再次生成无需重开 dialog）
        for (const s of episode.shots || []) {
          for (const a of s.referenceAssets || []) {
            if (a.type !== 'image' || !a.assetKey || !a.assetId) continue;
            const imgData = localApi.getCachedImageData(a.assetKey);
            const compliance = imgData ? readAnyCompliance(imgData) : undefined;
            if (compliance?.assetId && !effectiveAssetIdMap.has(a.assetId)) {
              effectiveAssetIdMap.set(a.assetId, compliance.assetId);
            }
          }
        }
        console.log(`[generateEpisodeVideo] 缓存诊断: totalImgs=${totalImgs}, withAssetId=${withAssetId}, cachedImgs=${cachedImgs}, complianceImgs=${complianceImgs}, mapSize=${effectiveAssetIdMap.size}`);
        if (effectiveAssetIdMap.size > 0) {
          console.log(`[generateEpisodeVideo] 自动构建 assetIdMap: ${effectiveAssetIdMap.size} 个条目`);
        }
      }

      const replaceUrlWithAssetId = (url: string): string => {
        if (!needsCompliance || !url || !effectiveAssetIdMap || effectiveAssetIdMap.size === 0 || !complianceHelpers) return url;
        return complianceHelpers.resolveReferenceUrl(url, undefined, effectiveAssetIdMap);
      };

      const generationMode = episode.videoGenerationMode || 'reference_image';
      const previewRequestData = get().getEpisodeVideoPreviewData(episodeId);

      const buildUniversalReferenceRequestLocal = (passThroughAssetIdMap?: Map<string, string>) => {
        const currentEpisodeNumber = get().currentEpisodeNumber ?? 1;
        const episodeCharacters = filterCharacterPortraitsByEpisode(characters, currentEpisodeNumber);
        // 优先使用传入的 assetIdMap，其次使用自动构建的 effectiveAssetIdMap
        const finalAssetIdMap = passThroughAssetIdMap || effectiveAssetIdMap;
        return buildUniversalReferenceRequest(episode, episodeCharacters, scenes, videoModels, getVideoPromptFormatter, finalAssetIdMap, characters, get().episodeMaxDuration || 15, get().props);
      };

      const doGenerate = async () => {
        // 重入守卫：同一 episode 同时只允许一个生成流程，避免重复提交导致后端 llm_task 出现重复记录
        if (GENERATING_EPISODES.has(episodeId)) {
          console.log(`[generateEpisodeVideo/doGenerate] episode ${episodeId} 已有生成流程在进行，跳过重复执行`);
          return;
        }
        GENERATING_EPISODES.add(episodeId);

        const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();

        // 查找是否已有该 episode 的视频任务（用于复用 backendId，避免重复创建 LLM 任务）
        const existingTasks = useTaskQueueStore.getState().tasks.filter(
          (t) => t.type === 'episode-video' && (t.metadata?.episodeId === episodeId || t.metadata?.subId === episodeId)
        );
        const latestExistingTask = existingTasks.sort((a, b) => b.createdAt - a.createdAt)[0];
        let taskId: string;
        let backendId: number | undefined;
        const taskStartTime = Date.now();
        if (latestExistingTask && ['running', 'polling'].includes(latestExistingTask.status)) {
          taskId = latestExistingTask.id;
          backendId = latestExistingTask.metadata?.backendId as number | undefined;
          console.log(`[generateEpisodeVideo/doGenerate] 复用中断任务 taskId=${taskId}, backendId=${backendId}`);
        } else {
          taskId = addTask({
            type: 'episode-video',
            name: `生成视频: ${episode.title || '片段'}`,
            status: 'running',
            modelVariant: episode.model,
            metadata: { episodeId, projectId: get().currentProjectId },
          });
        }

        set((state) => ({
          episodes: state.episodes.map((e) => {
            if (e.id !== episodeId) return e;
            const existingHistory = e.generatedVideos || [];
            const currentUrl = e.generatedVideoUrl;
            const newHistory = currentUrl && !existingHistory.some((v) => v.url === currentUrl)
              ? [{ url: currentUrl, sequence: existingHistory.length + 1, createdAt: new Date().toISOString(), timestamp: Date.now(), generationMode: e.videoGenerationMode, assetId: e.generatedVideoAssetId }, ...existingHistory]
              : existingHistory;
            return {
              ...e,
              isGenerating: true,
              generatedVideoUrl: '',
              generatedVideoAssetId: undefined,
              videoTaskId: undefined,
              videoGenerationProgress: VIDEO_PROGRESS_START,
              videoTaskStatus: undefined,
              videoTaskError: undefined,
              generatedVideos: newHistory,
            };
          }),
        }));

        // 提交后立即启动模拟进度计时器，避免提交 API 期间（可能耗时数十秒）进度停留在 0%
        startVideoProgressTimer(episodeId);

        console.log(`[generateEpisodeVideo/doGenerate] START episodeId=${episodeId}, generationMode=${generationMode}, taskId=${taskId}`);

        let response: any;
        let jobId: string | undefined;

        try {
          if (generationMode === 'first_last_frame') {
            const rawPrompt = (episode.firstLastFrameVideoPrompt || episode.videoPrompt || '')
              .replace(/@<role\s+character-id="[^"]+">([^<]*)<img[^>]*><\/role>/g, '$1')
              .replace(/@<role\s+character-id="[^"]+">([^<]*)<\/role>/g, '$1')
              .replace(/#<scene\s+scene-id="[^"]+">([^<]*)<img[^>]*><\/scene>/g, '$1')
              .replace(/#<scene\s+scene-id="[^"]+">([^<]*)<\/scene>/g, '$1')
              .replace(/<img[^>]*>/g, '')
              .replace(/\[图\d+\]/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            // 提交时统一追加约束后缀（剥离旧后缀防重复，含方言禁令），并前置表演指令
            const actingPrefix = buildActingPrefix(characters, episode);
            const videoPrompt = withVideoPromptSuffix(`${actingPrefix}\n\n${rawPrompt}`);
            const selectedModel = videoModels.find((m) => m.id === episode.model);
            const supports = selectedModel?.supports || {};
            const hasFirstFrame = !!supports.first_frame;
            const hasLastFrame = !!supports.last_frame;
            const hasGenerateAudio = !!supports.generate_audio;
            const fallbackModel = videoModels.find((m) => m.supports?.first_frame);
            const frameSupportedModel = hasFirstFrame && selectedModel ? selectedModel.id : fallbackModel?.id || '';
            const videoDuration = episode.videoDuration || 5;
            const canUseLastFrame = episode.lastFrameImageUrl && hasLastFrame;
            const canUseAudio = hasGenerateAudio;

            console.log(`[generateEpisodeVideo/doGenerate] try block ENTER, generationMode=${generationMode}, episode.model=${episode.model}, needsCompliance=${needsCompliance}`);

            if (episode.firstFrameImageUrl && canUseLastFrame) {
              const firstFrameUrl = replaceUrlWithAssetId(episode.firstFrameImageUrl);
              const lastFrameUrl = replaceUrlWithAssetId(episode.lastFrameImageUrl!);
              response = await workflowApi.generateEpisodeVideoWithFramesApi(
                episodeId,
                videoPrompt,
                firstFrameUrl,
                lastFrameUrl,
                frameSupportedModel,
                canUseAudio,
                getCurrentProjectAspectRatio(),
                videoDuration,
                undefined,
                true,
                VIDEO_GENERATION_API_TIMEOUT,
              );
            } else if (episode.firstFrameImageUrl) {
              const firstFrameUrl = replaceUrlWithAssetId(episode.firstFrameImageUrl);
              response = await workflowApi.generateEpisodeVideoWithFramesApi(
                episodeId,
                videoPrompt,
                firstFrameUrl,
                undefined,
                frameSupportedModel,
                canUseAudio,
                getCurrentProjectAspectRatio(),
                videoDuration,
                undefined,
                true,
                VIDEO_GENERATION_API_TIMEOUT,
              );
            } else {
              response = await workflowApi.generateEpisodeVideoApi(
                episodeId,
                videoPrompt,
                frameSupportedModel,
                videoDuration,
                undefined,
                true,
                VIDEO_GENERATION_API_TIMEOUT,
              );
            }
          } else {
            const refData = buildUniversalReferenceRequestLocal(assetIdMap);
            console.log(`[generateEpisodeVideo/doGenerate] buildUniversalReferenceRequest done, referenceModel=${refData.referenceModel}, originalModel=${refData.originalModel}, refImages=${refData.referenceImages.length}, refAudios=${refData.referenceAudios.length}, totalDuration=${refData.totalDuration}`);
            console.log(`[generateEpisodeVideo/doGenerate] processedPrompt(first 200):`, (refData.processedPrompt || '').substring(0, 200));

            if (refData.referenceImages.length === 0 && refData.referenceAudios.length === 0 && refData.referenceVideos.length === 0) {
              console.log(`[generateEpisodeVideo/doGenerate] NO references, calling generateEpisodeVideoApi (plain) with model=${episode.model}`);
              response = await workflowApi.generateEpisodeVideoApi(
                episodeId,
                refData.processedPrompt,
                episode.model,
                refData.totalDuration,
                undefined,
                true,
                VIDEO_GENERATION_API_TIMEOUT,
                getCurrentProjectAspectRatio(),
              );
              console.log(`[generateEpisodeVideo/doGenerate] generateEpisodeVideoApi response:`, response);
            } else {
              console.log('[generateEpisodeVideo] assetIdMap size:', assetIdMap?.size);
              if (assetIdMap) {
                console.log('[generateEpisodeVideo] assetIdMap keys:', Array.from(assetIdMap.keys()));
                console.log('[generateEpisodeVideo] refData.referenceImages:', refData.referenceImages);
              }
              const referenceImageUrls = refData.referenceImages.map(replaceUrlWithAssetId);
              console.log('[generateEpisodeVideo] referenceImageUrls after replace:', referenceImageUrls);
              console.log(`[generateEpisodeVideo/doGenerate] calling generateEpisodeVideoWithReferencesApi, refImageCount=${referenceImageUrls.length}, model=${refData.referenceModel}, ratio=${getCurrentProjectAspectRatio()}, duration=${refData.totalDuration}`);
              response = await workflowApi.generateEpisodeVideoWithReferencesApi(
                episodeId,
                refData.processedPrompt,
                referenceImageUrls,
                refData.referenceModel,
                getCurrentProjectAspectRatio(),
                refData.totalDuration,
                refData.referenceAudios.length > 0 || Object.keys(refData.referenceAudioMap).length > 0 || refData.referenceVideos.length > 0
                  ? {
                      referenceVideos: refData.referenceVideos.length > 0 ? refData.referenceVideos : undefined,
                      referenceAudios: refData.referenceAudios.length > 0 ? refData.referenceAudios : undefined,
                      referenceAudioMap: Object.keys(refData.referenceAudioMap).length > 0 ? refData.referenceAudioMap : undefined,
                    }
                  : undefined,
                true,
                VIDEO_GENERATION_API_TIMEOUT,
              );
              console.log(`[generateEpisodeVideo/doGenerate] generateEpisodeVideoWithReferencesApi response:`, response);
            }
          }

          const responseData = response.data as any;
          jobId = responseData?.jobId;
          // 后端失败响应中也可能保留 taskId（视频实际已提交，超时未返回）
          const fallbackTaskId = responseData?.taskId;

          if (!response.success || (!jobId && !fallbackTaskId && !responseData?.videoUrl)) {
            const errMsg = response.message || '提交失败';
            const err: any = new Error(errMsg);
            err.taskId = fallbackTaskId;
            throw err;
          }

          if (responseData?.videoUrl) {
            // 直接返回视频 URL：建行到项目资产库，通过 assetId 关联
            const videoAssetIds = await createEpisodeVideoAssetRows(
              get().currentProjectId,
              get().currentEpisodeNumber ?? 1,
              [responseData.videoUrl],
              { episodeId, title: episode.title, generationMode: episode.videoGenerationMode, model: episode.model },
            );
            const newVideoAssetId = videoAssetIds.get(responseData.videoUrl);
            const existingVideos = episode.generatedVideos || [];
            const newVideoHistory = episode.generatedVideoUrl
              ? [{ url: episode.generatedVideoUrl, sequence: existingVideos.length + 1, createdAt: new Date().toISOString(), timestamp: Date.now(), generationMode: episode.videoGenerationMode, assetId: episode.generatedVideoAssetId }, ...existingVideos]
              : existingVideos;
            set((state) => ({
              episodes: state.episodes.map((e) =>
                e.id === episodeId
                  ? { ...e, isGenerating: false, generatedVideoUrl: responseData.videoUrl, generatedVideoAssetId: newVideoAssetId, videoGenerationProgress: 100, generatedVideos: newVideoHistory, videoTaskStatus: undefined, videoTaskError: undefined }
                  : e
              ),
            }));
            completeTask(taskId, { videoUrl: responseData.videoUrl }, Date.now() - taskStartTime);
            return;
          }

          // 异步任务：优先使用 taskId（第二阶段轮询）
          const videoTaskId = responseData?.taskId;
          if (videoTaskId) {
            set((state) => ({
              episodes: state.episodes.map((e) =>
                e.id === episodeId
                  ? { ...e, videoTaskId, isGenerating: true }
                  : e
              ),
            }));

            // 将任务标记为 polling，避免 finally 清理；并记录 videoTaskId 供恢复用
            useTaskQueueStore.getState().updateTask(taskId, {
              status: 'polling',
              metadata: { ...useTaskQueueStore.getState().tasks.find(t => t.id === taskId)?.metadata, videoTaskId },
            });

            // 拿到 videoTaskId 后立即持久化到后端，确保页面刷新后可恢复轮询
            try {
              const currentState = get();
              const currentEpisodeNumber = get().currentEpisodeNumber ?? 1;
              saveToServer(currentState, currentEpisodeNumber).catch((e: any) => {
                console.warn(`[generateEpisodeVideo] videoTaskId ${videoTaskId} 持久化失败（非阻塞）:`, e?.message);
              });
            } catch (saveErr: any) {
              console.warn(`[generateEpisodeVideo] videoTaskId ${videoTaskId} 持久化失败（非阻塞）:`, saveErr?.message);
            }

            get().pollVideoTaskStatus(episodeId, videoTaskId, taskId);
            return;
          }

          // Bull 队列：使用 jobId 进入第一阶段轮询
          if (jobId) {
            useTaskQueueStore.getState().updateTask(taskId, {
              status: 'polling',
              metadata: { ...useTaskQueueStore.getState().tasks.find(t => t.id === taskId)?.metadata, videoJobId: jobId },
            });
            get().resumeBullVideoPolling(taskId, jobId, episodeId);
          }
        } catch (error: any) {
          console.error('[generateEpisodeVideo] 视频生成失败:', error);
          const errMsg = error?.message || String(error);
          // 失败但保留了 taskId：说明后端服务端轮询超时但任务仍在生成
          // 转为继续客户端轮询，而非直接标记 failed
          const preservedTaskId = error?.taskId;
          if (preservedTaskId) {
            console.warn(`[generateEpisodeVideo] 后端提交返回失败但携带 taskId=${preservedTaskId}，转为客户端轮询`);
            // 将任务标记为 polling，避免 finally 清理
            useTaskQueueStore.getState().updateTask(taskId, {
              status: 'polling',
              metadata: { ...useTaskQueueStore.getState().tasks.find(t => t.id === taskId)?.metadata, videoTaskId: preservedTaskId },
            });
            set((state) => ({
              episodes: state.episodes.map((e) =>
                e.id === episodeId
                  ? { ...e, videoTaskId: preservedTaskId, isGenerating: true, videoTaskStatus: 'processing' as const, videoTaskError: undefined }
                  : e
              ),
            }));
            get().pollVideoTaskStatus(episodeId, preservedTaskId, taskId);
            return;
          }
          if (errMsg.includes('输入图片可能包含真实人物') || errMsg.includes('敏感内容')) {
            Modal.error({
              title: '生成失败',
              content: '输入图片可能包含真实人物或敏感内容，请更换参考图片后再试。',
            });
          } else {
            message.error(errMsg || '视频生成失败，请稍后重试');
          }
          failTask(taskId, errMsg, Date.now() - taskStartTime);
          set((state) => ({
            episodes: state.episodes.map((e) =>
              e.id === episodeId
                ? { ...e, isGenerating: false, videoGenerationProgress: 0, videoTaskStatus: 'failed' as const, videoTaskError: errMsg }
                : e
            ),
          }));
        } finally {
          const task = useTaskQueueStore.getState().tasks.find(t => t.id === taskId);
          // 只有仍在 running 的任务才需要清理；polling 任务会继续由 pollVideoTaskStatus / resumeBullVideoPolling 管理
          if (task && task.status === 'running') {
            removeTask(taskId);
          }
          // 释放重入锁（提交+启动轮询已完成），后续允许重新生成；
          // 轮询期间由 episode.isGenerating 防止用户重复点击
          GENERATING_EPISODES.delete(episodeId);
        }
      };

      if (shouldPreview() && previewRequestData) {
        triggerPreview(previewRequestData, doGenerate);
        return;
      }

      await doGenerate();
    },

    pollVideoTaskStatus: async (episodeId: string, taskId: string, taskQueueTaskId?: string) => {
      const maxAttempts = 720; // 最多轮询720次 (2小时)
      const interval = 10000; // 每10秒轮询一次
      const pollStartTime = Date.now();

      const episode = get().episodes.find((e) => e.id === episodeId);
      const modelId = episode?.model;

      // 恢复轮询场景（页面刷新后）也启动计时器；幂等，不会打断已在运行的计时器
      startVideoProgressTimer(episodeId);

      // 重入守卫：同一任务的轮询只启动一次
      const pollKey = `${episodeId}:${taskId}`;
      if (ACTIVE_VIDEO_POLLS.has(pollKey)) {
        console.log(`[pollVideoTaskStatus] ${pollKey} 已在轮询中，跳过重复启动`);
        return;
      }
      ACTIVE_VIDEO_POLLS.add(pollKey);

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`[pollVideoTaskStatus] 轮询任务状态: ${taskId}, 第${attempt}次, 模型: ${modelId || '默认'}`);
        if (taskQueueTaskId) {
          try { useTaskQueueStore.getState().incrementPollCount(taskQueueTaskId); } catch {}
        }

        try {
          const response = await Promise.race([
            workflowApi.queryVideoTaskStatusApi(
              episodeId,
              taskId,
              modelId,
              get().currentProjectId,
            ),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('查询任务状态超时')), 15000),
            ),
          ]);

          if (!response.success) {
            throw new Error(response.message || '查询任务状态失败');
          }

          if (response.data.status === 'failed' || response.data.error) {
            throw new Error(response.data.error?.message || '视频生成任务失败');
          }

          const completedStatuses = ['completed', 'success', 'succeeded', 'done'];
          const isCompleted = completedStatuses.includes(response.data.status || '');

          if (response.success && response.data.videoUrl && isCompleted) {
            console.log(`[pollVideoTaskStatus] 视频生成完成: ${response.data.videoUrl}`);
            const currentEpisode = get().episodes.find((e) => e.id === episodeId);
            if (currentEpisode) {
              // 主视频 + 附加视频全部建行到项目资产库，通过 assetId 关联
              const extraUrlsPoll: string[] = response.data.videoUrls?.slice(1) || [];
              const videoAssetIds = await createEpisodeVideoAssetRows(
                get().currentProjectId,
                get().currentEpisodeNumber ?? 1,
                [response.data.videoUrl, ...extraUrlsPoll],
                { episodeId, title: currentEpisode.title, generationMode: currentEpisode.videoGenerationMode, model: currentEpisode.model },
              );
              const existingVideos = currentEpisode.generatedVideos || [];
              let newVideoHistory = currentEpisode.generatedVideoUrl
                ? [{ url: currentEpisode.generatedVideoUrl, sequence: existingVideos.length + 1, createdAt: new Date().toISOString(), timestamp: Date.now(), generationMode: currentEpisode.videoGenerationMode, assetId: currentEpisode.generatedVideoAssetId }, ...existingVideos]
                : existingVideos;
              if (extraUrlsPoll.length > 0) {
                const extraVideos = extraUrlsPoll.map((url: string, idx: number) => ({
                  url,
                  sequence: newVideoHistory.length + idx + 1,
                  createdAt: new Date().toISOString(),
                  timestamp: Date.now(),
                  generationMode: currentEpisode.videoGenerationMode,
                  assetId: videoAssetIds.get(url),
                }));
                newVideoHistory = [...extraVideos, ...newVideoHistory];
              }

              set((state) => ({
                episodes: state.episodes.map((e) =>
                  e.id === episodeId
                    ? { ...e, isGenerating: false, generatedVideoUrl: response.data.videoUrl, generatedVideoAssetId: videoAssetIds.get(response.data.videoUrl), videoGenerationProgress: 100, generatedVideos: newVideoHistory, videoTaskStatus: undefined, videoTaskError: undefined }
                    : e
                ),
              }));
              message.success(`${currentEpisode.title} 视频生成完成`);
            } else {
              set((state) => ({
                episodes: state.episodes.map((e) =>
                  e.id === episodeId
                    ? { ...e, isGenerating: false, generatedVideoUrl: response.data.videoUrl, videoGenerationProgress: 100, videoTaskStatus: undefined, videoTaskError: undefined }
                    : e
                ),
              }));
            }
            if (taskQueueTaskId) {
              try { useTaskQueueStore.getState().completeTask(taskQueueTaskId, { videoUrl: response.data.videoUrl }, Date.now() - pollStartTime); } catch {}
            }
            ACTIVE_VIDEO_POLLS.delete(pollKey);
            return;
          }

          // 进度由独立的模拟计时器（startVideoProgressTimer）平滑更新，轮询循环无需再计算

          await new Promise(resolve => setTimeout(resolve, interval));
        } catch (error: any) {
          console.error(`[pollVideoTaskStatus] 轮询失败:`, error);
          const errMsg = error?.message || String(error);
          const isUnrecoverableError =
            errMsg.includes('输入图片可能包含真实人物') ||
            errMsg.includes('敏感内容') ||
            errMsg.includes('任务失败') ||
            errMsg.includes('查询任务状态失败') ||
            errMsg.includes('任务不存在') ||
            errMsg.includes('不存在') ||
            errMsg.includes('已过期') ||
            errMsg.includes('无效') ||
            errMsg.includes('非法') ||
            errMsg.includes('未找到') ||
            errMsg.includes('aborted') ||
            errMsg.includes('abort') ||
            errMsg.includes('timeout') ||
            errMsg.includes('timed out');

          if (isUnrecoverableError) {
            if (taskQueueTaskId) {
              try { useTaskQueueStore.getState().failTask(taskQueueTaskId, errMsg, Date.now() - pollStartTime); } catch {}
            }
            set((state) => ({
              episodes: state.episodes.map((e) =>
                e.id === episodeId
                  ? { ...e, isGenerating: false, videoGenerationProgress: 0, videoTaskStatus: 'failed' as const, videoTaskError: errMsg }
                  : e
              ),
            }));
            ACTIVE_VIDEO_POLLS.delete(pollKey);
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, interval));
        }
      }

      console.error('[pollVideoTaskStatus] 轮询超时');
      if (taskQueueTaskId) {
        try { useTaskQueueStore.getState().failTask(taskQueueTaskId, '视频生成超时', Date.now() - pollStartTime); } catch {}
      }
      set((state) => ({
        episodes: state.episodes.map((e) =>
          e.id === episodeId
            ? {
                ...e,
                isGenerating: false,
                videoGenerationProgress: 0,
                videoTaskStatus: 'timeout' as const,
                videoTaskError: '视频生成超时，请点击继续生成',
              }
            : e
        ),
      }));
      ACTIVE_VIDEO_POLLS.delete(pollKey);
    },

    checkPendingVideoTasks: () => {
      const { episodes } = get();
      const taskQueueState = useTaskQueueStore.getState();

      const staleGeneratingEpisodes = episodes.filter((e) => {
        if (!e.isGenerating) return false;
        if (e.videoTaskId) return false;
        const hasActiveTask = taskQueueState.tasks.some(
          (t) =>
            t.type === 'episode-video' &&
            (t.metadata?.episodeId === e.id || t.metadata?.subId === e.id) &&
            (t.status === 'running' || t.status === 'polling'),
        );
        return !hasActiveTask;
      });

      if (staleGeneratingEpisodes.length > 0) {
        console.log(`[checkPendingVideoTasks] 修复 ${staleGeneratingEpisodes.length} 个状态不一致的 episode（isGenerating=true 但无活跃任务且无 videoTaskId）`);
        set((state) => ({
          episodes: state.episodes.map((e) =>
            staleGeneratingEpisodes.some((se) => se.id === e.id)
              ? { ...e, isGenerating: false, videoGenerationProgress: 0 }
              : e
          ),
        }));
      }

      const pendingEpisodes = get().episodes.filter(
        (e) => e.videoTaskId && !e.generatedVideoUrl
      );

      // 中断/超时任务恢复（与 pendingEpisodes 是否存在无关，始终执行）：
      // 之前仅在「无 Phase2 待恢复片段」时才走这里，导致有 pending 片段时
      // 「页面刷新中断/轮询超时」的任务永远不会被重新查询——其远端实际已生成
      const recoverInterruptedTasks = () => {
        // 「页面刷新中断」与「Bull 轮询超时」的失败任务都尝试恢复：
        // 超时只代表前端停止轮询，后端 Bull job 可能已完成并产出 taskId
        // 「任务中断且无法恢复」是此前缺少 jobId 被标记的，本轮起可通过 episodeId 反查后端任务恢复
        const interruptedVideoTasks = taskQueueState.tasks.filter(
          (t) => t.type === 'episode-video' && t.status === 'failed' &&
            (t.error === '页面刷新，任务中断' || t.error === 'Bull 任务轮询超时' || t.error === '任务中断且无法恢复（缺少 jobId/videoTaskId）')
        );

        const pollingWithVideoTaskId = taskQueueState.tasks.filter(
          (t) => t.type === 'episode-video' && t.status === 'polling' && t.metadata?.videoTaskId
        );

        const pollingWithOnlyJobId = taskQueueState.tasks.filter(
          (t) => t.type === 'episode-video' && t.status === 'polling'
            && t.metadata?.videoJobId && !t.metadata?.videoTaskId
        );

        if (interruptedVideoTasks.length === 0 && pollingWithVideoTaskId.length === 0 && pollingWithOnlyJobId.length === 0) {
          console.log('[checkPendingVideoTasks] 没有未完成的中断任务');
          return;
        }

        // 关键修复：polling 状态任务与 failed 任务不再互斥早退——
        // 此前只要存在任一 failed 任务，已被任务队列层恢复为 polling 的任务就永远无人接管，
        // 任务抽屉里一直停在「生成中」却没有任何轮询在跑（页面刷新后任务不查询结果的根因）
        if (pollingWithOnlyJobId.length > 0) {
          console.log(`[checkPendingVideoTasks] 发现 ${pollingWithOnlyJobId.length} 个 polling 任务（Bull 队列阶段），启动 Bull 轮询`);
          for (const task of pollingWithOnlyJobId) {
            const jobId = task.metadata?.videoJobId as string;
            const episodeId = task.metadata?.episodeId as string;
            if (!jobId) continue;
            // 恢复 episode 生成状态：Phase 1 阶段 episode 无 videoTaskId，
            // cleanEpisodesAndGetRecovery 会把 isGenerating 重置为 false，
            // 此处需重新置 true，避免右侧视频占位/按钮 loading 在刷新后消失
            //（对齐 phase1Tasks 分支处理）
            set((state) => ({
              episodes: state.episodes.map((e) =>
                e.id === episodeId
                  ? { ...e, isGenerating: true }
                  : e
              ),
            }));
            console.log(`[checkPendingVideoTasks] 启动 resumeBullVideoPolling: taskId=${task.id}, jobId=${jobId}`);
            get().resumeBullVideoPolling(task.id, jobId, episodeId);
          }
        }

        if (pollingWithVideoTaskId.length > 0) {
          console.log(`[checkPendingVideoTasks] 发现 ${pollingWithVideoTaskId.length} 个已恢复 polling 的任务，同步 episode 并进入 Phase 2`);
          for (const task of pollingWithVideoTaskId) {
            const videoTaskId = task.metadata?.videoTaskId as string;
            const episodeId = task.metadata?.episodeId as string;
            if (!videoTaskId || !episodeId) continue;

            set((state) => ({
              episodes: state.episodes.map((e) =>
                e.id === episodeId
                  ? { ...e, videoTaskId, isGenerating: true }
                  : e
              ),
            }));
            console.log(`[checkPendingVideoTasks] 同步 episode=${episodeId} videoTaskId=${videoTaskId}，进入 Phase 2`);
            get().pollVideoTaskStatus(episodeId, videoTaskId, task.id);
          }
        }

        const phase2Tasks = interruptedVideoTasks.filter(t => t.metadata?.videoTaskId);
        const phase1Tasks = interruptedVideoTasks.filter(t => !t.metadata?.videoTaskId && t.metadata?.videoJobId);
        const noIdTasks = interruptedVideoTasks.filter(t => !t.metadata?.videoTaskId && !t.metadata?.videoJobId);

        if (phase2Tasks.length > 0) {
          const { episodes: currentEpisodes } = get();
          let recovered = false;
          for (const task of phase2Tasks) {
            const videoTaskId = task.metadata?.videoTaskId as string;
            const taskEpisodeId = task.metadata?.episodeId as string;
            if (!videoTaskId) continue;

            const matchedEpisode = taskEpisodeId
              ? currentEpisodes.find(e => e.id === taskEpisodeId)
              : currentEpisodes.find(e => task.name.includes(e.title));

            if (matchedEpisode && videoTaskId) {
              taskQueueState.updateTask(task.id, {
                status: 'polling',
                error: undefined,
                metadata: { ...task.metadata, episodeId: matchedEpisode.id, videoTaskId },
              });
              set((state) => ({
                episodes: state.episodes.map((e) =>
                  e.id === matchedEpisode!.id
                    ? { ...e, videoTaskId, isGenerating: true }
                    : e
                ),
              }));
              console.log(`[checkPendingVideoTasks] Phase2 恢复: episode=${matchedEpisode.title} videoTaskId=${videoTaskId}`);
              get().pollVideoTaskStatus(matchedEpisode.id, videoTaskId, task.id);
              recovered = true;
            }
          }

          if (!recovered && currentEpisodes.length === 0) {
            console.log(`[checkPendingVideoTasks] 有 ${phase2Tasks.length} 个 Phase2 中断任务但 episodes 未加载，1s 后重试`);
            setTimeout(() => get().checkPendingVideoTasks(), 1000);
          }
        }

        if (phase1Tasks.length > 0) {
          console.log(`[checkPendingVideoTasks] 发现 ${phase1Tasks.length} 个 Phase1 中断任务（Bull 队列阶段），开始恢复`);
          for (const task of phase1Tasks) {
            const jobId = task.metadata?.videoJobId as string;
            const episodeId = task.metadata?.episodeId as string;
            if (!jobId) continue;

            taskQueueState.updateTask(task.id, {
              status: 'polling',
              error: undefined,
            });

            set((state) => ({
              episodes: state.episodes.map((e) =>
                e.id === episodeId
                  ? { ...e, isGenerating: true }
                  : e
              ),
            }));

            get().resumeBullVideoPolling(task.id, jobId, episodeId);
          }
        }

        // 中断任务缺少 jobId/videoJobId（提交响应返回前页面刷新，jobId 未写入本地），
        // 先通过 episodeId 反查后端 Bull 任务——job 实际存在（甚至可能已完成），找回 jobId 即可恢复
        if (noIdTasks.length > 0) {
          console.log(`[checkPendingVideoTasks] ${noIdTasks.length} 个中断任务缺少 jobId/videoTaskId，尝试按 episodeId 反查后端任务`);
        }
        for (const task of noIdTasks) {
          const taskEpisodeId = (task.metadata?.episodeId as string | undefined)
            || (task.metadata?.subId as string | undefined);
          if (!taskEpisodeId) continue;

          void (async () => {
            const markUnrecoverable = () => {
              // 改写 error，使其不再匹配 interruptedVideoTasks 的过滤条件（避免下次刷新重复进入），
              // 但保留可反查的语义文案；同时复位 episode 生成状态
              taskQueueState.updateTask(task.id, {
                status: 'failed',
                error: '任务已过期（后端无对应任务记录），请重新生成',
              });
              set((state) => ({
                episodes: state.episodes.map((e) =>
                  e.id === taskEpisodeId
                    ? {
                        ...e,
                        isGenerating: false,
                        videoGenerationProgress: 0,
                        videoTaskStatus: 'failed' as const,
                        videoTaskError: '视频生成中断（服务器重启或提交失败），请重新生成',
                      }
                    : e
                ),
              }));
            };

            // 开源版无服务端任务队列，无后端记录可反查，直接按不可恢复处理
            markUnrecoverable();
          })();
        }
      };

      // 先恢复中断/超时任务（重新查询真实结果），再恢复 Phase2 待轮询片段
      recoverInterruptedTasks();

      if (pendingEpisodes.length === 0) return;

      console.log(`[checkPendingVideoTasks] 发现 ${pendingEpisodes.length} 个未完成的视频任务，开始恢复轮询`);

      const failedVideoTasks = taskQueueState.tasks.filter(
        (t) => t.type === 'episode-video' && t.status === 'failed' && t.error === '页面刷新，任务中断'
      );

      const episodeIdToTaskId = new Map<string, string>();
      for (const ft of failedVideoTasks) {
        const metaEpisodeId = ft.metadata?.episodeId as string | undefined;
        if (metaEpisodeId) {
          episodeIdToTaskId.set(metaEpisodeId, ft.id);
        }
      }
      for (const ft of failedVideoTasks) {
        if (ft.metadata?.episodeId) continue;
        for (const ep of pendingEpisodes) {
          if (ft.name.includes(ep.title)) {
            episodeIdToTaskId.set(ep.id, ft.id);
            break;
          }
        }
      }

      console.log(`[checkPendingVideoTasks] 找到 ${failedVideoTasks.length} 个被中断的任务队列条目，匹配到 ${episodeIdToTaskId.size} 个`);

      for (const episode of pendingEpisodes) {
        if (episode.videoTaskId) {
          const recoveredTaskId = episodeIdToTaskId.get(episode.id);

          if (recoveredTaskId) {
            taskQueueState.updateTask(recoveredTaskId, {
              status: 'polling',
              error: undefined,
              metadata: {
                ...taskQueueState.tasks.find(t => t.id === recoveredTaskId)?.metadata,
                episodeId: episode.id,
                videoTaskId: episode.videoTaskId,
              },
            });
            console.log(`[checkPendingVideoTasks] 恢复任务队列条目: ${recoveredTaskId} → episode: ${episode.title}`);
          }

          set((state) => ({
            episodes: state.episodes.map((e) =>
              e.id === episode.id
                ? { ...e, isGenerating: true }
                : e
            ),
          }));

          get().pollVideoTaskStatus(episode.id, episode.videoTaskId, recoveredTaskId || undefined);
        }
      }
    },

    resumeBullVideoPolling: async (taskQueueTaskId: string, jobId: string, episodeId: string) => {
      // 开源版无服务端 Bull 队列(浏览器直连厂商),原版的服务端任务恢复轮询不可达;
      // 保险兜底:一旦被调用,把任务与片段标记为失败,提示重新生成。
      void jobId;
      useTaskQueueStore.getState().updateTask(taskQueueTaskId, {
        status: 'failed',
        error: '任务已过期，请重新生成',
      });
      set((state) => ({
        episodes: state.episodes.map((e) =>
          e.id === episodeId
            ? { ...e, isGenerating: false, videoGenerationProgress: 0, videoTaskStatus: 'failed' as const, videoTaskError: '任务已过期，请重新生成' }
            : e
        ),
      }));
    },
  };
}
