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
 * 媒体工具:本地图片与厂商接口之间的格式转换
 *
 * 纯前端场景下用户图片以 blob 存在 IndexedDB,而厂商视频接口
 * (首帧/参考图)接收公网 URL 或 base64 data URL —— 此模块负责:
 * 1. blob ↔ dataURL 互转
 * 2. 超限 dataURL 的 canvas 降采样压缩(base64 体积膨胀 ~33%,厂商多限制 10MB 请求体)
 */

/** 默认压缩阈值:超过 4MB 的 dataURL 触发降采样 */
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/** blob → base64 data URL */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

/** base64 data URL → blob */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)?.[1] || 'image/png';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * 拉取远程/本地 URL 图片并转为 data URL
 * - 已是 data URL 原样返回
 * - blob: URL 直接取 blob
 * - http(s): fetch 转 blob(需图片可访问;跨域失败时抛错由调用方兜底)
 */
export async function urlToDataUrl(url: string): Promise<string> {
  if (!url) return url;
  if (url.startsWith('data:')) return url;
  let blob: Blob;
  if (url.startsWith('blob:')) {
    blob = await (await fetch(url)).blob();
  } else {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`图片拉取失败: HTTP ${resp.status}`);
    blob = await resp.blob();
  }
  return blobToDataUrl(blob);
}

/**
 * 压缩图片 data URL:超过 maxBytes 时按比例降采样重新编码
 * 迭代缩小尺寸直到达标或到达下限(256px),输出 JPEG(透明图用 PNG 保透明)
 */
export async function compressDataUrl(
  dataUrl: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<string> {
  // 快速路径:dataURL 实际字节数(base64 占 4/3)未超限
  const approxBytes = Math.floor((dataUrl.length - dataUrl.indexOf(',')) * 0.75);
  if (approxBytes <= maxBytes) return dataUrl;

  const img = await loadImage(dataUrl);
  const keepAlpha = dataUrl.startsWith('data:image/png') || dataUrl.startsWith('data:image/webp');
  const mime = keepAlpha ? 'image/png' : 'image/jpeg';

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, width, height);
    const out = canvas.toDataURL(mime, keepAlpha ? undefined : 0.85);
    const outBytes = Math.floor((out.length - out.indexOf(',')) * 0.75);
    if (outBytes <= maxBytes) return out;

    // 未达标:尺寸减半继续
    width = Math.max(256, Math.floor(width / 2));
    height = Math.max(256, Math.floor(height / 2));
    if (width <= 256 && height <= 256) return out;
  }
  return dataUrl;
}

/**
 * 统一入口:把任意图片来源(blob:/http(s)/data:)转为可直接发给厂商的 data URL,
 * 超限时自动压缩
 */
export async function ensureImageDataUrl(
  source: string,
  maxBytes?: number,
): Promise<string> {
  const dataUrl = await urlToDataUrl(source);
  return compressDataUrl(dataUrl, maxBytes);
}

/** 批量转换(失败项返回原值,不阻断整批) */
export async function ensureImageDataUrls(
  sources: string[] | undefined,
  maxBytes?: number,
): Promise<string[] | undefined> {
  if (!sources?.length) return sources;
  const results = await Promise.all(
    sources.map(async (s) => {
      try {
        return await ensureImageDataUrl(s, maxBytes);
      } catch {
        return s;
      }
    }),
  );
  return results;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}
