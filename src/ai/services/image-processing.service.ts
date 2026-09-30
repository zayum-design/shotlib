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
import { fetchRemoteBlob, blobToDataUrl, compressDataUrl } from '@/ai/core/media';
import { uploadImageAssetToOss } from './oss-upload.service';
import { settingsRepo } from '@/storage/settingsRepo';
import { useLogStore } from '@/shared/stores/logStore';
import type { UnifiedModelRequest } from '@/ai/core/types';

/**
 * 规范化发往厂商的参考图:
 * - data:/http(s):原样(厂商可直接使用)
 * - blob:(本地 objectURL,刷新后 hydrate 会把 state 里的 URL 还原成这种):
 *   1. 反查 assetId → 已上传 OSS 的持久 URL(请求体小,厂商直接拉取)
 *   2. 反查不到则读本地 Blob 转 base64 data URL(超 4MB 自动压缩)
 * 不规范化时火山等厂商会报 "invalid url specified"。
 */
async function normalizeReferenceImage(projectId: string | undefined, url: string): Promise<string> {
  if (!url || url.startsWith('data:') || /^https?:\/\//.test(url)) return url;
  if (!url.startsWith('blob:')) return url;

  if (projectId) {
    const assetId = imageRepo.findAssetIdByObjectUrl(url);
    if (assetId) {
      const record = await imageRepo.get(projectId, assetId);
      const ossUrl = record?.data?.ossUrl;
      if (typeof ossUrl === 'string' && /^https?:\/\//.test(ossUrl)) return ossUrl;
    }
  }

  // 兜底:本地 Blob → data URL(压缩控制请求体)
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await compressDataUrl(await blobToDataUrl(blob));
  } catch {
    return url;
  }
}

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

/** 远程 URL → Blob;失败返回 null(由调用方降级用原 URL) */
async function urlToBlob(url: string): Promise<Blob | null> {
  if (url.startsWith('data:')) return dataUrlToBlob(url);
  if (!/^https?:\/\//.test(url)) return null;
  try {
    // fetchRemoteBlob:直连优先,厂商对象存储 CORS 拦截时自动经代理重试
    return await fetchRemoteBlob(url);
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

  // 参考图规范化(blob: 本地引用 → OSS URL / data URL),避免厂商 "invalid url"
  const rawRefs = data.referenceImages || (data.referenceImage ? [data.referenceImage] : undefined);
  const normalizedRefs = rawRefs
    ? await Promise.all(rawRefs.map((u) => normalizeReferenceImage(request.projectId, u)))
    : undefined;

  const sdkRequest: UnifiedModelRequest = {
    modelId,
    taskType: 'image',
    operation: mapOperation(type),
    input: {
      text: data.prompt,
      imageUrls: normalizedRefs,
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

  // OSS 状态一次性检查并入日志(未配置仅提示一次,不随图片数刷屏)
  const { oss } = await settingsRepo.get();
  const ossEnabled = !!oss?.bucket && !!oss.accessKeyId && !!oss.accessKeySecret;
  if (canPersist) {
    useLogStore.getState().addLog({
      level: ossEnabled ? 'info' : 'warning',
      source: 'oss',
      message: ossEnabled
        ? `OSS 已启用(${oss!.bucket}),生成的图片将立即上传`
        : 'OSS 未配置或配置不完整,图片仅存浏览器本地(厂商 URL 会过期);请在设置页或 CLI 配置后刷新页面',
    });
  }

  for (const url of allUrls) {
    const blob = await urlToBlob(url);
    if (canPersist && !blob) {
      // 落库失败意味着刷新后该图无法从 imageRepo 恢复(角色图剥 URL 后必丢)
      console.warn('[processImageRequest] 图片 blob 落库失败,该图将无法在刷新后恢复(检查代理/网络):', url.slice(0, 120));
    }
    if (canPersist && blob) {
      const assetId = crypto.randomUUID();
      await imageRepo.putBlob(request.projectId!, assetId, blob, {
        assetType: request.assetType || 'generated_image',
        episodeNumber: request.episodeNumber ?? 0,
        remoteUrl: url.startsWith('http') ? url : undefined,
        metadata: { prompt: data.prompt, type },
      });

      // OSS 持久化:配置了 OSS 时立即上传,业务数据引用持久公网 URL——
      // 厂商产物 URL 有过期时限(TOS 24h 等),后续视频生成以图片 URL 作参考图会失效。
      // 注意顺序:先上传并写入 data.ossUrl,之后 ensureUrl 才会解析出 OSS 地址
      // (若先 ensureUrl 会生成 blob: objectURL 并缓存,后续解析永远命中 blob)
      let persistUrl = url;
      if (ossEnabled) {
        try {
          const ossUrl = await uploadImageAssetToOss(
            blob,
            request.projectId!,
            request.assetType || 'generated_image',
            assetId,
          );
          if (ossUrl) {
            persistUrl = ossUrl;
            await imageRepo.patchData(request.projectId!, assetId, { ossUrl });
            useLogStore.getState().addLog({
              level: 'success',
              source: 'oss',
              url: ossUrl,
              message: `图片已上传 OSS: ${ossUrl.slice(0, 120)}`,
            });
          }
        } catch (e) {
          useLogStore.getState().addLog({
            level: 'error',
            source: 'oss',
            error: e instanceof Error ? e.message : String(e),
            message: `OSS 上传失败,降级为本地 blob URL(刷新后仅本地可见,远程引用会过期): ${(e as Error).message.slice(0, 150)}`,
          });
        }
      }

      images.push(persistUrl);
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
