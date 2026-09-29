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
 * 视频处理服务(纯前端版)
 *
 * 对齐后端 shared/processing/video/video-processing.service.ts:
 * - 四种生成 mode(text/image/frames/references_to_video)组装 UnifiedModelRequest
 * - 统一追加反 AI 味指令与视频禁止项(VIDEO_NEGATIVES.md,前 20 字指纹防重复追加)
 * - 差异:开源版恒为「提交即返回 taskId,由上层轮询器查询」的 CLIENT_SIDE 语义,
 *   替代后端 SERVER_SIDE 同步等待;queryTaskStatus 为单次查询(轮询由前端驱动)
 */
import { findProviderByVariantId } from '@/ai/core/model-registry';
import { getDefaultModelId, getVariantConfig } from '@/ai/core/model-registry';
import { submitVideoTask, getVideoAdapter } from '@/ai/core/task-runner';
import type { VideoTaskHandle } from '@/ai/core/task-runner';
import type { UnifiedModelRequest, TaskQueryResponse } from '@/ai/core/types';
import { ModelException } from '@/ai/core/exceptions';
import { promptLoader } from '@/ai/prompts/prompt-loader';

export type VideoGenerationMode =
  | 'text_to_video'
  | 'image_to_video'
  | 'frames_to_video'
  | 'references_to_video';

/** 统一视频生成请求(与后端 UnifiedVideoRequest 对齐,去掉轮询/积分/转存字段) */
export interface UnifiedVideoRequest {
  modelId: string;
  mode: VideoGenerationMode;
  prompt: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  duration?: number;
  ratio?: string;
  resolution?: string;
  seed?: number;
  generateAudio?: boolean;
  parameters?: Record<string, any>;
}

/** 业务语义视频请求(operation 'generate',与后端 VideoProcessingRequest 对齐) */
export interface VideoProcessingRequest {
  modelId: string;
  type: string;
  data: {
    prompt?: string;
    inputImage?: string;
    inputVideo?: string;
    ratio?: string;
    duration?: number;
    [key: string]: unknown;
  };
  parameters?: Record<string, unknown>;
  projectId?: string;
  projectType?: string;
}

/** 首尾帧视频请求(与后端 VideoWithFramesRequest 对齐,零 OSS/积分字段) */
export interface VideoWithFramesRequest {
  modelId: string;
  firstFrameUrl: string;
  lastFrameUrl?: string;
  prompt: string;
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
  tools?: Array<{ type: string; [key: string]: any }>;
  referenceVideos?: string[];
  referenceAudios?: string[];
  projectType?: string;
  projectId?: string;
}

/** 全能参考视频请求(与后端 VideoWithReferencesRequest 对齐) */
export interface VideoWithReferencesRequest {
  modelId: string;
  referenceImageUrls: string[];
  prompt: string;
  ratio?: string;
  duration?: number;
  resolution?: string;
  frames?: number;
  seed?: number;
  cameraFixed?: boolean;
  serviceTier?: string;
  executionExpiresAfter?: number;
  returnLastFrame?: boolean;
  tools?: Array<{ type: string; [key: string]: any }>;
  referenceVideos?: string[];
  referenceAudios?: string[];
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  parameters?: Record<string, any>;
  projectType?: string;
  projectId?: string;
}

/** 与后端 VideoProcessingResponse 一致(taskId 由提交即返回,videoUrl 需轮询后才有值) */
export interface VideoProcessingResponse {
  videoUrl: string;
  videoUrls?: string[];
  taskId?: string;
  modelId: string;
  type: string;
  processingTime: number;
  tokens?: unknown;
  metadata?: Record<string, unknown>;
}

/** 反 AI 味指令缓存:undefined=未加载,''=加载失败(优雅降级不追加) */
let antiAiDirective: string | undefined;
/** 视频禁止项缓存:undefined=未加载,''=加载失败(优雅降级不追加) */
let videoNegatives: string | undefined;

/**
 * 加载视频生成禁止项(VIDEO_NEGATIVES.md),
 * 剥离 Markdown 标题/加粗记号后得到可直接追加的纯文本约束。
 */
function loadVideoNegatives(): string {
  const raw = promptLoader
    .loadPromptTemplate('', 'drama/video-negatives')
    .trim();
  if (!raw) return '';
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith('#') && // 去掉 Markdown 标题
        !/^-{3,}$/.test(line), // 去掉分隔线
    )
    .map((line) => line.replace(/\*\*/g, '')) // 去掉加粗记号
    .join('\n');
}

/**
 * 为视频生成 prompt 追加反 AI 味系统指令与视频禁止项(全局统一出口统一追加)。
 * 各以指令前 20 字为指纹防重复追加(重试/上游已拼接时不叠加)。
 */
function withAntiAiDirective(prompt: string): string {
  if (!prompt) return prompt;
  if (antiAiDirective === undefined) {
    antiAiDirective = promptLoader
      .loadPromptTemplate('', 'video/anti-ai-suffix')
      .trim();
  }
  if (videoNegatives === undefined) {
    videoNegatives = loadVideoNegatives();
  }
  let result = prompt;
  if (antiAiDirective) {
    const marker = antiAiDirective.slice(0, 20);
    if (!result.includes(marker)) {
      result = `${result}\n${antiAiDirective}`;
    }
  }
  if (videoNegatives) {
    const marker = videoNegatives.slice(0, 20);
    if (!result.includes(marker)) {
      result = `${result}\n${videoNegatives}`;
    }
  }
  return result;
}

/** 提交视频任务并返回「待轮询」响应(开源版统一 CLIENT_SIDE 语义) */
async function submitForPolling(
  request: UnifiedModelRequest,
  type: string,
  parameters?: Record<string, unknown>,
): Promise<VideoProcessingResponse> {
  const handle: VideoTaskHandle = await submitVideoTask(request);
  return {
    videoUrl: '',
    videoUrls: undefined,
    taskId: handle.taskId,
    modelId: request.modelId,
    type,
    processingTime: 0,
    metadata: parameters,
  };
}

/**
 * 统一生成入口:按 mode 组装 UnifiedModelRequest 后提交(对齐后端 generate 的四种 case)。
 * 开源版恒提交即返回 taskId,由调用方通过 queryTaskStatus 轮询。
 */
export async function generate(
  request: UnifiedVideoRequest,
): Promise<VideoProcessingResponse> {
  const { modelId, mode } = request;
  // 全局统一追加反 AI 味指令(覆盖全部 mode)
  const prompt = withAntiAiDirective(request.prompt);

  let sdkRequest: UnifiedModelRequest;

  switch (mode) {
    case 'frames_to_video':
      sdkRequest = {
        modelId,
        taskType: 'video',
        operation: 'frames_to_video',
        input: {
          text: prompt,
          firstFrameUrl: request.firstFrameUrl,
          lastFrameUrl: request.lastFrameUrl,
          referenceAudioUrls: request.referenceAudioUrls,
        },
        parameters: {
          duration: request.duration,
          ratio: request.ratio,
          resolution: request.resolution,
          seed: request.seed,
          generateAudio: request.generateAudio,
          ...request.parameters,
        },
      };
      break;

    case 'references_to_video':
      sdkRequest = {
        modelId,
        taskType: 'video',
        operation: 'references_to_video',
        input: {
          text: prompt,
          referenceImageUrls: request.referenceImageUrls,
          referenceVideoUrls: request.referenceVideoUrls,
          referenceAudioUrls: request.referenceAudioUrls,
          firstFrameUrl: request.firstFrameUrl,
          lastFrameUrl: request.lastFrameUrl,
        },
        parameters: {
          duration: request.duration,
          ratio: request.ratio,
          resolution: request.resolution,
          seed: request.seed,
          ...request.parameters,
        },
      };
      break;

    case 'image_to_video':
      sdkRequest = {
        modelId,
        taskType: 'video',
        operation: 'image_to_video',
        input: {
          text: prompt,
          firstFrameUrl:
            request.firstFrameUrl || request.referenceImageUrls?.[0],
        },
        parameters: {
          duration: request.duration,
          ...request.parameters,
        },
      };
      break;

    case 'text_to_video':
    default:
      sdkRequest = {
        modelId,
        taskType: 'video',
        operation: 'text_to_video',
        input: { text: prompt },
        parameters: {
          duration: request.duration,
          ratio: request.ratio,
          resolution: request.resolution,
          ...request.parameters,
        },
      };
      break;
  }

  return submitForPolling(sdkRequest, 'generation', request.parameters);
}

/**
 * 通用视频处理(operation 'generate';对齐后端 process 的组装)
 */
export async function process(
  request: VideoProcessingRequest,
): Promise<VideoProcessingResponse> {
  const parameters = {
    ...request.parameters,
    // 透传 ratio/duration 到模型 SDK(火山引擎需要显式指定比例)
    ratio: request.data.ratio,
    duration: request.data.duration,
  };
  const sdkRequest: UnifiedModelRequest = {
    modelId: request.modelId,
    taskType: 'video',
    operation: 'generate',
    input: {
      text: withAntiAiDirective(request.data.prompt || ''),
      imageUrl: request.data.inputImage,
      videoUrl: request.data.inputVideo,
    },
    parameters,
  };
  return submitForPolling(sdkRequest, request.type, request.parameters);
}

/** 使用首尾帧生成视频(对齐后端 processWithFrames) */
export async function processWithFrames(
  request: VideoWithFramesRequest,
): Promise<VideoProcessingResponse> {
  return generate({
    modelId: request.modelId,
    mode: 'frames_to_video',
    prompt: request.prompt,
    firstFrameUrl: request.firstFrameUrl,
    lastFrameUrl: request.lastFrameUrl,
    generateAudio: request.generateAudio,
    ratio: request.ratio,
    duration: request.duration,
    resolution: request.resolution,
    seed: request.seed,
    parameters: {
      referenceVideos: request.referenceVideos,
      referenceAudios: request.referenceAudios,
    },
  });
}

/** 使用全能参考生成视频(对齐后端 processWithReferences) */
export async function processWithReferences(
  request: VideoWithReferencesRequest,
): Promise<VideoProcessingResponse> {
  return generate({
    modelId: request.modelId,
    mode: 'references_to_video',
    prompt: request.prompt,
    referenceImageUrls: request.referenceImageUrls,
    referenceVideoUrls: request.referenceVideos,
    referenceAudioUrls: request.referenceAudios,
    firstFrameUrl: request.firstFrameUrl,
    lastFrameUrl: request.lastFrameUrl,
    ratio: request.ratio,
    duration: request.duration,
    resolution: request.resolution,
    seed: request.seed,
    parameters: request.parameters,
  });
}

/**
 * 单次查询视频任务状态(轮询由前端驱动;对齐后端 queryTaskStatus 返回形状,
 * 去 OSS 转存,失败原因统一为笼统提示,不暴露厂商细节)
 */
export async function queryTaskStatus(
  taskId: string,
  modelId?: string,
): Promise<Record<string, any>> {
  const actualModelId = modelId || getDefaultModelId('video');
  const providerId = findProviderByVariantId(actualModelId);
  if (!providerId) {
    throw new ModelException(
      `未知模型: ${actualModelId}`,
      'MODEL_NOT_FOUND',
      400,
      false,
    );
  }
  const adapter = getVideoAdapter(providerId);
  const response = (await adapter.query(
    taskId,
    actualModelId,
  )) as TaskQueryResponse;

  const urls: string[] = (response.data.urls as string[] | undefined) || [];
  const extra = (response.data.extra || {}) as Record<string, unknown>;
  const rawError = extra.error;
  return {
    videoUrl: urls[0] || '',
    videoUrls: urls.length > 1 ? urls : undefined,
    lastFrameUrl: extra.lastFrameUrl,
    status: response.data.status,
    tokens: response.metadata?.tokens,
    ...extra,
    error: rawError ? { message: '系统繁忙，请稍后再试' } : undefined,
  };
}
