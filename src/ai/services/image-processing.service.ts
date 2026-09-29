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
 * 图片处理服务(纯前端版)
 *
 * 对齐后端 shared/processing/image/image-processing.service.ts:
 * 业务语义请求 → UnifiedModelRequest → modelSDK → 厂商 adapter → 图片。
 * 差异:服务端生成后转存 OSS;开源版把图片 blob 化存入本地 imageRepo,
 * 返回本地 objectURL;远程图拉取失败(CORS)时降级直接返回原始 URL。
 */
import { modelSDK } from './model-sdk';
import { imageRepo } from '@/storage/imageRepo';
import type { UnifiedModelRequest } from '@/ai/core/types';

/** 业务语义图片请求(与前端 buildXxxRequestBody 产出的 data 形状一致) */
export interface ImageProcessingRequest {
  modelId: string;
  /** generation / edit / variation / upscale / inpainting */
  type: string;
  data: {
    prompt: string;
    promptType?: string;
    aspectRatio?: string;
    width?: number;
    height?: number;
    numImages?: number;
    negativePrompt?: string;
    sceneMultiView?: boolean;
    referenceImages?: string[];
    referenceImage?: string;
    [key: string]: unknown;
  };
  parameters?: Record<string, unknown>;
  /** 以下为落库上下文(缺省时仅返回图片,不落 imageRepo) */
  projectId?: string;
  projectType?: string;
  assetType?: string;
  episodeNumber?: number;
  preview?: boolean;
}

/** 与后端 ImageProcessingResponse 一致 */
export interface ImageProcessingResponse {
  images: string[];
  assetIds?: string[];
  modelId: string;
  type: string;
  processingTime: number;
  prompt?: string;
  metadata?: Record<string, any>;
}

/** dataURL/base64 → Blob(本地落库用) */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || 'image/png';
  const isBase64 = !!match[2];
  const raw = match[3];
  try {
    if (isBase64) {
      const bin = atob(raw);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(raw)], { type: mime });
  } catch {
    return null;
  }
}

/** 远程 URL → Blob;失败返回 null(CORS 等场景,由调用方降级用原 URL) */
async function urlToBlob(url: string): Promise<Blob | null> {
  if (url.startsWith('data:')) return dataUrlToBlob(url);
  if (!/^https?:\/\//.test(url)) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.blob();
  } catch {
    return null;
  }
}

function mapOperation(type: string): 'generate' | 'edit' | 'variation' | 'upscale' | 'inpaint' {
  switch (type) {
    case 'generation':
      return 'generate';
    case 'edit':
      return 'edit';
    case 'variation':
      return 'variation';
    case 'upscale':
      return 'upscale';
    case 'inpainting':
      return 'inpaint';
    default:
      return 'generate';
  }
}

/**
 * 处理图片生成请求:调用厂商适配器并把产物 blob 化落库
 * @returns images 为可直接展示的 URL(objectURL / 原始 URL / dataURL);
 *          assetIds 为成功落库的资产 id(展示 URL 与 assetIds 一一对应,未落库项对应位为空串)
 */
export async function processImageRequest(request: ImageProcessingRequest): Promise<ImageProcessingResponse> {
  const { modelId, type, data, parameters } = request;

  const sdkRequest: UnifiedModelRequest = {
    modelId,
    taskType: 'image',
    operation: mapOperation(type),
    input: {
      text: data.prompt,
      imageUrls:
        data.referenceImages ||
        (data.referenceImage ? [data.referenceImage] : undefined),
    },
    parameters: {
      ...parameters,
      // 比例用业务语义 aspectRatio(厂商层转 size);width/height 仅为旧厂商兼容过渡
      aspectRatio: data.aspectRatio,
      width: data.width,
      height: data.height,
      numImages: data.numImages,
      negativePrompt: data.negativePrompt,
      promptType: data.promptType,
      sceneMultiView: data.sceneMultiView,
    },
  };

  const response = await modelSDK.process(sdkRequest);

  if (!response.success) {
    throw new Error(response.error?.message || '图片处理失败');
  }

  const allUrls: string[] = (response.data as { urls?: string[] }).urls || [];

  // 本地化:每张图尝试 blob 落库;失败降级为原 URL(不落库)
  const images: string[] = [];
  const assetIds: string[] = [];
  const canPersist = !!request.projectId && !request.preview;

  for (const url of allUrls) {
    const blob = await urlToBlob(url);
    if (canPersist && blob) {
      const assetId = crypto.randomUUID();
      await imageRepo.putBlob(request.projectId!, assetId, blob, {
        assetType: request.assetType || 'generated_image',
        episodeNumber: request.episodeNumber ?? 0,
        remoteUrl: url.startsWith('http') ? url : undefined,
        metadata: { prompt: data.prompt, type },
      });
      const record = await imageRepo.get(request.projectId!, assetId);
      const localUrl = record ? await imageRepo.ensureUrl(assetId, record) : undefined;
      images.push(localUrl || url);
      assetIds.push(assetId);
    } else {
      images.push(url);
      assetIds.push('');
    }
  }

  return {
    images,
    assetIds: assetIds.some(Boolean) ? assetIds : undefined,
    modelId: response.metadata.modelId,
    type,
    processingTime: response.metadata.processingTime,
    prompt: data.prompt,
    metadata: { ...parameters },
  };
}
