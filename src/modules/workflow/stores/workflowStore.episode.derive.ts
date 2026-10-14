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
 * workflowStore.episode.derive.ts — 片段衍生子 Slice
 *
 * 核心能力：
 * 1. deriveEpisodeFromVideo — 从已生成视频的片段一键衍生：浏览器截取视频尾帧落库，
 *    在该片段后插入一个"全能参考生成"片段（含 5s 分镜，标记 isDerivative，
 *    生成时以上一片段视频作 reference_video 视频延长接续）。
 * 2. prepareDerivativeFirstFrame — 「衍生片段」开关的生成前置：截取上一片段视频尾帧，
 *    记录到当前片段的 firstFrameImageUrl/AssetId，供下游识别衍生关系。
 *
 * 开源版截帧（替代原服务端 ffmpeg）：fetchRemoteBlob 把视频拉为本地 blob（直连失败
 * 自动经代理，规避跨域），blob URL 同源无 canvas 污染问题 → <video> seek 到结尾 →
 * canvas 截帧 → imageRepo 落库（配置 OSS 时同步直传拿持久地址）。
 */
import type { StoreApi } from 'zustand';
import type { Episode, Shot, Scene } from '@/shared/types/index';
import { fetchRemoteBlob } from '@/ai/core/media';
import { imageRepo } from '@/storage/imageRepo';
import { uploadImageAssetToOss } from '@/ai/services/oss-upload.service';
import { message } from '@/shared/utils/message';
import type { WorkflowState } from './workflowStore';

type SetFn = StoreApi<WorkflowState>['setState'];
type GetFn = StoreApi<WorkflowState>['getState'];

/** 衍生场景标签内文字/命名用的源片段序号（1 起，按未删除片段列表位置） */
function deriveLabelOf(index: number): string {
  return `片段${index + 1}`;
}

/**
 * 浏览器截取视频尾帧并落库（开源版替代后端 ffmpeg 截帧）：
 * 视频 → blob（代理兜底）→ blob URL 同源加载 → seek 尾帧 → canvas → PNG blob →
 * imageRepo 注册（配置 OSS 时直传换持久地址）。失败返回 null（含用户提示）。
 */
async function captureLastFrameAsset(
  videoUrl: string,
  projectId: string,
): Promise<{ assetId: string; url: string } | null> {
  let blobUrl: string | undefined;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  try {
    // 拉取为本地 blob 再加载：绕开跨域视频的 canvas 污染限制（直连失败自动走代理）
    const blob = await fetchRemoteBlob(videoUrl);
    blobUrl = URL.createObjectURL(blob);
    video.src = blobUrl;

    // 等待元数据就绪并 seek 到结尾（留 0.05s 余量避免停在黑帧）
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('视频加载失败（格式或地址不可用）'));
    });
    const seekTo = Math.max(0, (video.duration || 0) - 0.05);
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error('视频定位尾帧失败'));
      video.currentTime = seekTo;
    });

    // canvas 截帧（视频尺寸对齐）
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('画布初始化失败');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frameBlob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('截帧编码失败'))), 'image/png'),
    );

    // 落库：imageRepo 注册资产行（配置 OSS 时直传换持久公共地址）
    const assetId = crypto.randomUUID();
    const file = new File([frameBlob], `derive_frame_${assetId}.png`, { type: 'image/png' });
    await imageRepo.putBlob(projectId, assetId, file, {
      assetType: 'generated_image',
      episodeNumber: 0,
      metadata: { source: 'derive_last_frame', videoUrl },
    });
    let url = '';
    const ossUrl = await uploadImageAssetToOss(frameBlob, projectId, 'generated_image', assetId);
    if (ossUrl) {
      await imageRepo.patchData(projectId, assetId, { ossUrl });
      url = ossUrl;
    }
    return { assetId, url };
  } catch (e) {
    console.error('[captureLastFrameAsset] 截取视频尾帧失败:', e);
    message.error(`截取视频尾帧失败: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    video.removeAttribute('src');
  }
}

export interface EpisodeDeriveSliceActions {
  /** 从已生成视频的片段衍生新片段（截尾帧→落库→建场景→插片段），成功返回新片段 id，失败返回 null */
  deriveEpisodeFromVideo: (episodeId: string) => Promise<{ newEpisodeId: string } | null>;
  /**
   * 衍生片段生成前置：截上一片段视频尾帧，记录到当前片段 firstFrameImageUrl/AssetId。
   * 幂等：firstFrameImageAssetId 已存在 → 直接返回 true；失败返回 false（调用方应中止生成）。
   */
  prepareDerivativeFirstFrame: (episodeId: string) => Promise<boolean>;
}

export function createEpisodeDeriveSlice(set: SetFn, get: GetFn): EpisodeDeriveSliceActions {
  void set; // 本 slice 只读取与调用其它 action，不直接 set
  return {
    deriveEpisodeFromVideo: async (episodeId: string) => {
      const { episodes, currentProjectId } = get();
      const srcEp = episodes.find((e) => e.id === episodeId);
      const videoUrl = srcEp?.generatedVideoUrl;
      if (!srcEp || !videoUrl) {
        message.warning('该片段还没有已生成的视频');
        return null;
      }

      // 源片段编号（1 起），用于场景/片段命名
      const visible = episodes.filter((e) => !e.deleted);
      const x = visible.findIndex((e) => e.id === episodeId) + 1;

      if (!currentProjectId || currentProjectId === 'default') {
        message.error('项目上下文无效，无法截取尾帧');
        return null;
      }
      const captured = await captureLastFrameAsset(videoUrl, currentProjectId);
      if (!captured) return null;
      const { assetId, url } = captured;

      // 建衍生场景（本地持久化，场景管理界面过滤 isDerived 不显示）
      const sceneName = `${deriveLabelOf(x - 1)}视频尾帧 参考场景`;
      const derivedScene: Scene = {
        id: crypto.randomUUID(),
        name: sceneName,
        description: '片段衍生自动创建',
        location: '',
        timeOfDay: '',
        season: '',
        weather: '',
        imagePrompt: '',
        model: '',
        imageUrls: [url],
        imageAssetIds: [assetId],
        isDerived: true,
        isNew: true,
      } as unknown as Scene;
      get().addScene(derivedScene);

      // 组装新片段（全能参考生成，含 1 个 5s 分镜）：
      // 衍生关系仅通过 isDerivative + firstFrameImageUrl/AssetId 标记，
      // 由下游识别并以上一片段视频作 reference_video（视频延长接续）提交。
      const derivedShot: Shot = {
        id: crypto.randomUUID(),
        duration: 5,
        cameraMovements: [],
        shotType: 'medium',
        cameraAngle: 'eye_level',
        lighting: 'natural',
        mood: 'bright',
        prompt: '延续上一片段的剧情与画面风格。',
        rawPrompt: '延续上一片段的剧情与画面风格。',
      } as unknown as Shot;
      const newEpisode: Episode = {
        id: crypto.randomUUID(),
        title: `${deriveLabelOf(x - 1)}衍生`,
        description: '',
        videoPrompt: '',
        model: srcEp.model,
        videoGenerationMode: 'reference_image',
        videoDuration: 5,
        videoResolution: srcEp.videoResolution ?? '720p',
        shots: [derivedShot],
        // 标记衍生片段：生成时提交上一片段视频作 reference_video（视频延长接续）
        isDerivative: true,
        firstFrameImageUrl: url,
        firstFrameImageAssetId: assetId,
        // 关键：唯一的大 index（= 当前片段数），避免中间插入时与现有片段的 index 冲突
        index: get().episodes.length,
      } as unknown as Episode;
      console.log('[deriveEpisodeFromVideo] 创建衍生片段:', {
        srcEpisodeId: episodeId, srcIndex: x, newEpisodeId: newEpisode.id,
        derivedSceneId: derivedScene.id,
        firstFrameImageAssetId: newEpisode.firstFrameImageAssetId,
        firstFrameImageUrl: newEpisode.firstFrameImageUrl,
      });
      get().insertEpisodeAfter(episodeId, newEpisode);
      // 标记为新建的衍生片段（tab 上方浮动「片段N衍生」角标，由 store.lastNewDerivedEpisode 读取）
      get().markNewDerivedEpisode?.(newEpisode.id);

      return { newEpisodeId: newEpisode.id };
    },

    prepareDerivativeFirstFrame: async (episodeId: string) => {
      const { episodes, currentProjectId } = get();
      const visible = episodes.filter((e) => !e.deleted);
      const idx = visible.findIndex((e) => e.id === episodeId);
      const ep = visible[idx];
      if (!ep) return false;
      if (idx <= 0) {
        message.warning('第一个片段没有上一片段可承接，无法使用衍生模式');
        return false;
      }
      const prevEp = visible[idx - 1];
      const videoUrl = prevEp.generatedVideoUrl;
      if (!videoUrl) {
        message.warning('该片段开启了衍生模式，请先生成上一个视频');
        return false;
      }

      // 幂等检查：已截取过尾帧并写入 firstFrameImageAssetId → 直接使用
      if (ep.firstFrameImageAssetId) {
        console.log('[prepareDerivativeFirstFrame] 已存在衍生首帧资产，跳过重复截取:', episodeId);
        return true;
      }
      if (!currentProjectId || currentProjectId === 'default') {
        message.error('项目上下文无效，无法截取尾帧');
        return false;
      }

      // 截上一片段视频尾帧并落库
      const captured = await captureLastFrameAsset(videoUrl, currentProjectId);
      if (!captured) return false;
      const { assetId, url } = captured;

      // 建衍生场景（本地持久化，场景管理界面过滤 isDerived 不显示）
      const label = deriveLabelOf(idx - 1); // 上一片段的编号
      const derivedScene: Scene = {
        id: crypto.randomUUID(),
        name: `${label}视频尾帧 参考场景`,
        description: '衍生片段自动创建',
        location: '',
        timeOfDay: '',
        season: '',
        weather: '',
        imagePrompt: '',
        model: '',
        imageUrls: [url],
        imageAssetIds: [assetId],
        isDerived: true,
        isNew: true,
      } as unknown as Scene;
      get().addScene(derivedScene);

      // 仅记录 firstFrameImageUrl/AssetId 供下游识别衍生关系
      get().updateEpisode(episodeId, {
        firstFrameImageUrl: url,
        firstFrameImageAssetId: assetId,
      });
      console.log('[prepareDerivativeFirstFrame] 已准备衍生首帧:', {
        episodeId, prevEpisodeId: prevEp.id, derivedSceneId: derivedScene.id,
      });
      return true;
    },
  };
}
