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
 * 片段生成、视频生成、首帧/尾帧 API(纯前端版)
 *
 * - 片段生成:组装过滤后的角色/场景/道具清单 + 上集结尾状态(前端从本地分集数据提取),
 *   调本地 AI 编排 aiModelService.generateEpisodes
 * - 首尾帧:调本地 image-processing(blob 化落库),失败对齐后端返回 {success:false, imageUrl:''}
 * - 视频:调本地 video-processing(提交即返回 taskId,轮询由 store 层 queryVideoTaskStatusApi 驱动)
 * - 视频合成(ffmpeg)为存根:开源版已移除,保留逐段视频下载
 */
import type { Character, Scene, Episode, Prop } from '@/shared/types/index';
import type { ApiResponse } from './types';
import { filterCharacterPortraitsByEpisode } from '../utils/workflowUtils';
import { useWorkflowStore } from '../stores/workflowStore';
import { useProjectStore } from '@/shared/stores/projectStore';
import { aiModelService } from '@/ai/services/ai-model.service';
import { IMAGE_USER_PRIORITY_NOTE } from '@/ai/services/character-image.service';
import { processImageRequest } from '@/ai/services/image-processing.service';
import {
  process as videoProcess,
  processWithFrames as videoProcessWithFrames,
  processWithReferences as videoProcessWithReferences,
  queryTaskStatus as videoQueryTaskStatus,
} from '@/ai/services/video-processing.service';
import { getDefaultModelId, getVariantConfig } from '@/ai/core/model-registry';
import { episodeRepo } from '@/storage/episodeRepo';

function getProjectId(): string | undefined {
  // workflow 页面取 workflowStore；instant 页面不设置 workflowStore，
  // 回退到共享 projectStore 的当前项目（避免上传路径 projectId 段落为 unknown）
  return (
    useWorkflowStore.getState().currentProjectId ??
    useProjectStore.getState().currentProjectId ??
    undefined
  );
}

export interface GenerateEpisodesRequest {
  script: string;
  characters: Character[];
  scenes: Scene[];
  model?: string;
}

export interface GenerateEpisodesResponse {
  episodes: Episode[];
}

/**
 * 从 workflowStore 提取当前分集的事件分桶文本（事件密度防火墙）。
 * 无纲要数据时返回 undefined，后端模板条件块自动移除。
 */
function buildEpisodeOutlineText(episodeNumber?: number): string | undefined {
  const outlines = useWorkflowStore.getState().episodeOutlines;
  if (!Array.isArray(outlines) || outlines.length === 0) return undefined;
  const outline =
    outlines.find((o) => o.episodeNumber === episodeNumber) ?? outlines[0];
  const buckets = outline?.eventBuckets;
  if (!buckets) return undefined;
  const lines: string[] = [];
  const push = (label: string, items?: string[]) => {
    if (Array.isArray(items) && items.length > 0) {
      lines.push(`${label}:`);
      items.forEach((e) => lines.push(`- ${e}`));
    }
  };
  push('thisEpisode（本集可演事件）', buckets.thisEpisode);
  push('reservedForLater（留待后续集，只可埋伏笔不得揭晓）', buckets.reservedForLater);
  push('doNotShowYet（连暗示都不允许）', buckets.doNotShowYet);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * 提取上一集结尾状态（连续性锚点，前端化自后端 resolvePreviousEndingState）。
 * 从本地分集数据中取上一集最后一个片段的尾帧/末镜头描述，拼接为自然语言状态文本。
 * 任何异常都降级为空字符串，不阻断分镜生成。
 */
async function resolvePreviousEndingState(
  projectId: string | undefined,
  episodeNumber: number | undefined,
): Promise<string> {
  if (!projectId || !episodeNumber || episodeNumber <= 1) {
    return '';
  }
  try {
    const listRes = await episodeRepo.list(projectId);
    if (!listRes.success) return '';
    const prevEpisode = listRes.data.find(
      (e) => e.episode_number === episodeNumber - 1,
    );
    if (!prevEpisode) return '';

    const getRes = await episodeRepo.get(prevEpisode.id);
    const fragments = (getRes.data?.episodeData?.data as any)?.episodes;
    if (!Array.isArray(fragments) || fragments.length === 0) return '';

    // 末片段可能是 scene 引用格式（无内联提示词），仅在内联数据可用时提取
    const last = fragments[fragments.length - 1];
    if (!last || typeof last !== 'object' || last.scene_id) return '';

    const parts: string[] = [];
    if (last.title) parts.push(`上集末片段「${last.title}」`);
    if (last.lastFramePrompt) {
      parts.push(`结尾定格画面：${last.lastFramePrompt}`);
    } else if (Array.isArray(last.shots) && last.shots.length > 0) {
      const lastShot = last.shots[last.shots.length - 1];
      if (lastShot?.prompt) parts.push(`结尾镜头：${lastShot.prompt}`);
    }
    if (parts.length === 0) return '';
    const state = parts.join('。');
    console.log(
      `[episodeApi] 已注入第 ${episodeNumber - 1} 集结尾状态（${state.length} 字）`,
    );
    return state;
  } catch (error) {
    console.warn(
      `[episodeApi] 提取上集结尾状态失败，降级为空: ${error instanceof Error ? error.message : error}`,
    );
    return '';
  }
}

/**
 * 根据剧本和角色生成分镜片段(本地 AI 编排,同步调用)
 */
export async function generateEpisodesApi(
  script: string,
  characters: Character[],
  scenes: Scene[],
  model: string = 'deepseek',
  preview?: boolean,
  async?: boolean,
  episodeNumber?: number,
  maxEpisodeDuration?: number,
  props?: Prop[],
): Promise<ApiResponse<GenerateEpisodesResponse>> {
  void preview;
  void async;

  // 按分集过滤形象照，避免片段生成时引用其他分集的形象照
  const episodeCharacters = episodeNumber !== undefined
    ? filterCharacterPortraitsByEpisode(characters, episodeNumber)
    : characters;

  // 过滤字段，只保留模型清单需要的属性
  const filteredCharacters = episodeCharacters.map((c) => {
    // 收集角色的形象照名称，附加到 description 中供 AI 参考
    const portraitNames = (c.fullBodyImages || [])
      .filter((img: any) => img?.name && img?.imageUrl)
      .map((img: any) => img.name);
    const portraitInfo = portraitNames.length > 0
      ? `\n可用形象照: ${portraitNames.join('、')}`
      : '';
    return {
      id: c.id,
      name: c.name,
      description: (c.description || '') + portraitInfo,
      avatarUrl: c.avatarImages?.[c.currentAvatarIndex || 0]?.imageUrl,
      fullBodyUrl: c.multiViewImages?.[0]?.imageUrl,
    };
  });

  const filteredScenes = scenes.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    imageUrl: s.imageUrls?.[0],
  }));

  // 道具清单：分镜提示词通过【道具:名】标记引用，图片 URL 供参考图关联
  const filteredProps = (props || []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    imageUrl: p.resolvedImageUrls?.[0] || p.imageUrls?.[0],
  }));

  try {
    // 连续性锚点：非首集时注入上集结尾状态（读本地分集数据，失败降级为空）
    const previousEndingState = await resolvePreviousEndingState(
      getProjectId(),
      episodeNumber,
    );

    const episodes = await aiModelService.generateEpisodes(
      model || 'deepseek',
      {
        script,
        characters: filteredCharacters,
        scenes: filteredScenes,
        props: filteredProps,
        previousEndingState,
        // 事件分桶：事件密度防火墙，防止提前表演未来情节
        eventBuckets: buildEpisodeOutlineText(episodeNumber) || '',
        // 片段时长上限(秒):15 或 30,30s 仅长片段模型(如 seedance2.5)支持
        maxEpisodeDuration,
      },
    );

    if (!episodes || episodes.length === 0) {
      throw new Error('AI 未返回任何片段，请重试');
    }
    // 与原版 HTTP 反序列化边界等价:AI 层产出 dto 形状,消费方按 shared/types 消费
    return { success: true, data: { episodes: episodes as unknown as Episode[] } };
  } catch (error) {
    console.error('[episodeApi] 生成分镜片段失败:', error);
    return {
      success: false,
      data: { episodes: [] },
      message: error instanceof Error ? error.message : '生成分镜片段失败',
    };
  }
}

// ============ 片段视频生成 API ============

export interface GenerateEpisodeVideoRequest {
  videoPrompt: string;
  model?: string;
}

export interface GenerateEpisodeVideoResponse {
  videoUrl: string;
  videoUrls?: string[];
  taskId?: string;
}

export interface GenerateEpisodeVideoWithFramesRequest {
  videoPrompt: string;
  firstFrameUrl: string;
  lastFrameUrl: string;
  model?: string;
  generateAudio?: boolean;
  ratio?: string;
  duration?: number;
  resolution?: string;
  frames?: number;
  seed?: number;
  cameraFixed?: boolean;
  serviceTier?: string;
  executionExpiresAfter?: number;
  returnLastFrame?: boolean;
  callbackUrl?: string;
  safetyIdentifier?: string;
  draft?: boolean;
  draftTaskId?: string;
  tools?: Array<{ type: string; [key: string]: any }>;
  referenceVideos?: string[];
  referenceAudios?: string[];
}

export interface GenerateEpisodeVideoWithFramesResponse {
  videoUrl: string;
  videoUrls?: string[];
  taskId?: string;
}

export interface GenerateEpisodeVideoWithReferencesRequest {
  videoPrompt: string;
  referenceImageUrls: string[];
  model?: string;
  ratio?: string;
  duration?: number;
  resolution?: string;
  frames?: number;
  seed?: number;
  cameraFixed?: boolean;
  serviceTier?: string;
  executionExpiresAfter?: number;
  returnLastFrame?: boolean;
  callbackUrl?: string;
  safetyIdentifier?: string;
  draft?: boolean;
  draftTaskId?: string;
  tools?: Array<{ type: string; [key: string]: any }>;
  referenceVideos?: string[];
  referenceAudios?: string[];
  /** 音频与图片的映射关系：key 为图片URL，value 为对应音频URL（供 Aliyun wan2.7-r2v 绑定 reference_voice 用） */
  referenceAudioMap?: Record<string, string>;
  /** 第一个分镜的参考图URL（供 VolcEngine 全能参考模式首帧引导语用） */
  firstFrameUrl?: string;
  /** 最后一个分镜的参考图URL（供 VolcEngine 全能参考模式尾帧引导语用） */
  lastFrameUrl?: string;
}

export interface GenerateEpisodeVideoWithReferencesResponse {
  videoUrl: string;
  videoUrls?: string[];
  taskId?: string;
}

// ============ 首帧/尾帧图片生成 API ============

export interface GenerateFrameImageRequest {
  prompt: string;
  model?: string;
  globalPrompt?: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
}

export interface GenerateFrameImageResponse {
  imageUrl: string;
  imageAssetId?: string;
  // 图片生成参数（prompt/type/modelId/steps/cfgScale/seed 等），落盘到 asset.data.metadata
  metadata?: Record<string, any>;
}

/**
 * 生成片段视频(本地编排;开源版恒提交即返回 taskId,由轮询器查询结果)
 */
export async function generateEpisodeVideoApi(
  episodeId: string,
  videoPrompt: string,
  model: string = 'SVD',
  duration: number = 5,
  preview?: boolean,
  async?: boolean,
  timeout?: number,
  ratio?: string,
): Promise<ApiResponse<GenerateEpisodeVideoResponse>> {
  void episodeId;
  void preview;
  void async;
  void timeout;
  const modelId = model || 'SVD';

  try {
    const result = await videoProcess({
      modelId,
      type: 'generation',
      data: {
        modelId,
        prompt: videoPrompt,
        duration: duration || 5,
        ratio, // 透传项目比例，避免模型使用默认值
        fps: 24,
        width: 2560,
        height: 1440,
      },
      projectType: 'drama',
      projectId: getProjectId(),
    });

    return {
      success: true,
      data: {
        videoUrl: result.videoUrl,
        videoUrls: result.videoUrls,
        taskId: result.taskId,
      },
    };
  } catch (error: any) {
    console.error('[episodeApi] 生成视频失败:', error);
    return {
      success: false,
      message: '系统繁忙，请稍后再试',
      data: {
        videoUrl: '',
        taskId: error?.taskId || '',
      },
    };
  }
}

/**
 * 使用首尾帧生成片段视频(本地编排;提交即返回 taskId)
 */
export async function generateEpisodeVideoWithFramesApi(
  episodeId: string,
  videoPrompt: string,
  firstFrameUrl: string,
  lastFrameUrl?: string,
  model: string = '', // 空字符串回退模型注册表的默认视频模型，禁止硬编码模型 ID
  generateAudio: boolean = true,
  ratio: string = 'adaptive',
  duration: number = 15,
  extraParams?: Omit<GenerateEpisodeVideoWithFramesRequest, 'videoPrompt' | 'firstFrameUrl' | 'lastFrameUrl' | 'model' | 'generateAudio' | 'ratio' | 'duration'>,
  async?: boolean,
  timeout?: number,
): Promise<ApiResponse<GenerateEpisodeVideoWithFramesResponse>> {
  void episodeId;
  void async;
  void timeout;
  const modelId = model || getDefaultModelId('video');

  try {
    const result = await videoProcessWithFrames({
      modelId,
      firstFrameUrl,
      lastFrameUrl,
      prompt: videoPrompt,
      generateAudio: generateAudio ?? true,
      ratio: ratio || 'adaptive',
      duration: duration || 5,
      resolution: extraParams?.resolution,
      frames: extraParams?.frames,
      seed: extraParams?.seed,
      referenceVideos: extraParams?.referenceVideos,
      referenceAudios: extraParams?.referenceAudios,
      projectType: 'drama',
      projectId: getProjectId(),
    });

    return {
      success: true,
      data: {
        videoUrl: result.videoUrl,
        videoUrls: result.videoUrls,
        taskId: result.taskId,
      },
    };
  } catch (error: any) {
    console.error('[episodeApi] 使用首尾帧生成视频失败:', error);
    return {
      success: false,
      message: '系统繁忙，请稍后再试',
      data: {
        videoUrl: '',
        taskId: error?.taskId || '',
      },
    };
  }
}

/**
 * 使用全能参考生成片段视频(本地编排;指定模型不支持参考图时回退默认视频模型)
 */
export async function generateEpisodeVideoWithReferencesApi(
  episodeId: string,
  videoPrompt: string,
  referenceImageUrls: string[],
  model: string = '', // 空字符串回退模型注册表的默认视频模型，禁止硬编码模型 ID
  ratio: string = '16:9',
  duration: number = 15,
  extraParams?: Omit<GenerateEpisodeVideoWithReferencesRequest, 'videoPrompt' | 'referenceImageUrls' | 'model' | 'ratio' | 'duration'>,
  async?: boolean,
  timeout?: number,
): Promise<ApiResponse<GenerateEpisodeVideoWithReferencesResponse>> {
  void episodeId;
  void async;
  void timeout;

  let modelId = model || getDefaultModelId('video');
  // 全能参考模式（references_to_video）要求模型支持 reference_image 能力。
  // 通过 model.json 的 supports 能力标志判断，禁止用硬编码模型 ID 列表。
  // 若指定模型不支持参考图，回退到默认视频模型。
  const modelSupports = getVariantConfig(modelId)?.supports as
    | Record<string, any>
    | undefined;
  if (modelSupports && modelSupports.reference_image === false) {
    console.log(
      `[episodeApi] 模型 ${modelId} 不支持全能参考(reference_image)，回退到默认视频模型`,
    );
    modelId = getDefaultModelId('video');
  }

  try {
    const result = await videoProcessWithReferences({
      modelId,
      referenceImageUrls,
      prompt: videoPrompt,
      ratio: ratio || '16:9',
      duration: duration || 15,
      resolution: extraParams?.resolution,
      frames: extraParams?.frames,
      seed: extraParams?.seed,
      referenceVideos: extraParams?.referenceVideos,
      referenceAudios: extraParams?.referenceAudios,
      firstFrameUrl: extraParams?.firstFrameUrl,
      lastFrameUrl: extraParams?.lastFrameUrl,
      parameters: {
        referenceAudioMap: extraParams?.referenceAudioMap,
      },
      projectType: 'drama',
      projectId: getProjectId(),
    });

    return {
      success: true,
      data: {
        videoUrl: result.videoUrl,
        videoUrls: result.videoUrls,
        taskId: result.taskId,
      },
    };
  } catch (error: any) {
    console.error('[episodeApi] 使用全能参考生成视频失败:', error);
    return {
      success: false,
      message: '系统繁忙，请稍后再试',
      data: {
        videoUrl: '',
        taskId: error?.taskId || '',
      },
    };
  }
}

// ============ 视频任务查询 API ============

export interface QueryVideoTaskResponse {
  videoUrl: string;
  videoUrls?: string[];
  taskId: string;
  lastFrameUrl?: string;
  status?: string;
  error?: { code?: string; message?: string };
  createdAt?: number;
  updatedAt?: number;
  seed?: number;
  resolution?: string;
  ratio?: string;
  duration?: number;
  frames?: number;
  framesPerSecond?: number;
  generateAudio?: boolean;
  draft?: boolean;
  draftTaskId?: string;
  serviceTier?: string;
  executionExpiresAfter?: number;
  usage?: {
    completionTokens?: number;
    totalTokens?: number;
    toolUsage?: { webSearch?: number };
  };
}

/**
 * 查询视频生成任务状态(单次查询;轮询节奏由上层 pollVideoTaskStatus 驱动)
 */
export async function queryVideoTaskStatusApi(
  episodeId: string,
  taskId: string,
  modelId?: string,
  projectId?: string,
): Promise<ApiResponse<QueryVideoTaskResponse>> {
  void episodeId;
  void projectId;

  try {
    const result = await videoQueryTaskStatus(taskId, modelId);
    return {
      success: true,
      data: {
        videoUrl: result.videoUrl || '',
        videoUrls: result.videoUrls,
        taskId: taskId,
        lastFrameUrl: result.lastFrameUrl,
        status: result.status,
        error: result.error,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        seed: result.seed,
        resolution: result.resolution,
        ratio: result.ratio,
        duration: result.duration,
        frames: result.frames,
        framesPerSecond: result.framesPerSecond,
        generateAudio: result.generateAudio,
        draft: result.draft,
        draftTaskId: result.draftTaskId,
        serviceTier: result.serviceTier,
        executionExpiresAfter: result.executionExpiresAfter,
        usage: result.usage,
      },
    };
  } catch (error: any) {
    console.error('[episodeApi] 查询任务状态失败:', error);
    return {
      success: false,
      message: '系统繁忙，请稍后再试',
      data: {
        videoUrl: '',
        taskId: taskId,
      },
    };
  }
}

/**
 * 首尾帧图片生成公共实现(对齐后端 generateFirstFrame/generateLastFrame):
 * globalPrompt 前置 + 用户优先注记,失败返回 {success:false, imageUrl:''} 而非抛错。
 */
async function generateFrameImage(
  prompt: string,
  model: string,
  globalPrompt?: string,
  referenceImageUrls?: string[],
  aspectRatio?: string,
  episodeNumber?: number,
): Promise<ApiResponse<GenerateFrameImageResponse>> {
  try {
    const modelId = model || getDefaultModelId('image');
    const finalPrompt = globalPrompt
      ? `${globalPrompt}，${prompt}${IMAGE_USER_PRIORITY_NOTE}`
      : prompt;
    console.log(`[episodeApi] 首尾帧图片生成提示词: ${finalPrompt}`);

    const result = await processImageRequest({
      modelId,
      type: 'generation',
      data: {
        modelId,
        prompt: finalPrompt,
        negativePrompt: '模糊, 低质量, 变形, 丑陋, 不合理的构图',
        aspectRatio,
        numImages: 1,
        referenceImages: referenceImageUrls,
        parameters: {
          steps: 30,
          cfgScale: 7.5,
          seed: Math.floor(Math.random() * 1000000),
        },
      },
      projectType: 'drama',
      projectId: getProjectId(),
      assetType: 'frame_image',
      episodeNumber,
    });

    if (result.images && result.images.length > 0) {
      return {
        success: true,
        data: {
          imageUrl: result.images[0],
          imageAssetId: result.assetIds?.[0],
          // 完整生成参数，作为图片元数据回传，落盘到 asset.data.metadata
          metadata: {
            prompt: result.prompt,
            type: result.type,
            modelId: result.modelId,
            ...result.metadata,
          },
        },
      };
    }
    throw new Error('图片生成失败，未返回图片');
  } catch (error) {
    console.error('[episodeApi] 生成首尾帧图片失败:', error);
    return {
      success: false,
      data: {
        imageUrl: '',
      },
    };
  }
}

/**
 * 构建首帧生成请求体（业务语义 body）。尺寸由 aspectRatio 派生。
 * generateFirstFrameApi 与预览 triggerPreview 共用此函数。
 */
export function buildGenerateFirstFrameRequestBody(
  prompt: string,
  model: string,
  globalPrompt?: string,
  referenceImageUrls?: string[],
  aspectRatio?: string,
  preview?: boolean,
  async?: boolean,
  episodeNumber?: number,
): any {
  return {
    prompt,
    model,
    globalPrompt,
    referenceImageUrls,
    aspectRatio,
    preview,
    async,
    projectId: getProjectId(),
    episodeNumber,
  };
}

/**
 * 生成片段首帧图片(本地编排;图片 blob 化落库)
 */
export async function generateFirstFrameApi(
  episodeId: string,
  prompt: string,
  model: string,
  globalPrompt?: string,
  referenceImageUrls?: string[],
  aspectRatio?: string,
  preview?: boolean,
  async?: boolean,
  episodeNumber?: number,
): Promise<ApiResponse<GenerateFrameImageResponse>> {
  void episodeId;
  return generateFrameImage(
    prompt,
    model,
    globalPrompt,
    referenceImageUrls,
    aspectRatio,
    episodeNumber,
  );
}

/**
 * 构建尾帧生成请求体（业务语义 body）。尺寸由 aspectRatio 派生。
 * generateLastFrameApi 与预览 triggerPreview 共用此函数。
 */
export function buildGenerateLastFrameRequestBody(
  prompt: string,
  model: string,
  globalPrompt?: string,
  referenceImageUrls?: string[],
  aspectRatio?: string,
  preview?: boolean,
  async?: boolean,
  episodeNumber?: number,
): any {
  return {
    prompt,
    model,
    globalPrompt,
    referenceImageUrls,
    aspectRatio,
    preview,
    async,
    projectId: getProjectId(),
    episodeNumber,
  };
}

/**
 * 生成片段尾帧图片(本地编排;图片 blob 化落库)
 */
export async function generateLastFrameApi(
  episodeId: string,
  prompt: string,
  model: string,
  globalPrompt?: string,
  referenceImageUrls?: string[],
  aspectRatio?: string,
  preview?: boolean,
  async?: boolean,
  episodeNumber?: number,
): Promise<ApiResponse<GenerateFrameImageResponse>> {
  void episodeId;
  return generateFrameImage(
    prompt,
    model,
    globalPrompt,
    referenceImageUrls,
    aspectRatio,
    episodeNumber,
  );
}

// ============ 模型列表 API ============


/**
 * 合并当前分集已生成的片段视频为完整短片(存根:开源版已移除服务端 ffmpeg 合成,
 * 请逐段下载片段视频)
 */
export async function composeEpisodeVideosApi(
  segments: Array<{ videoUrl?: string }>,
  projectId?: string,
): Promise<ApiResponse<{ videoUrl: string }>> {
  void segments;
  void projectId;
  return {
    success: false,
    data: { videoUrl: '' },
    message: '开源版已移除服务端视频合成（ffmpeg），请逐段下载片段视频',
  };
}
