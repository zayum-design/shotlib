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
 * 工作流同步 API
 *
 * 原版把工作流数据同步到服务端工作区/OSS 云端(图片换公网 URL、zip 打包下载);
 * 开源版数据全部保存在浏览器 IndexedDB,图片以本地 blob/dataURL 直接使用:
 * - syncWorkflowApi / syncWorkflowToCloudApi:空操作,原样返回数据 + 空 urlMapping
 *   (消费方按 urlMapping 做局部 URL 更新,空映射即恒等变换,天然 no-op)
 * - exportWorkflowZipApi:纯前端打包(zip 内 2 个 JSON:workflow-cloud.json 远程版 /
 *   workflow.json 本地版内联 data URL),与云端版导出产物结构一致
 */
import { fetchRemoteBlob, blobToDataUrl } from '@/ai/core/media';

export interface SyncWorkflowRequest {
  workflowData: Record<string, any>;
}

export interface SyncWorkflowResponse {
  success: boolean;
  message: string;
  data?: {
    workflowPath: string;
    filesPath: string;
    savedImages: string[];
  };
}

/**
 * 同步工作流到本地(开源版数据已在本地 IndexedDB,空操作)
 */
export async function syncWorkflowApi(
  _projectId: string,
  _workflowData: Record<string, any>,
  _category?: string
): Promise<SyncWorkflowResponse> {
  return { success: true, message: '开源版数据保存在浏览器本地,无需同步' };
}

export interface SyncWorkflowToCloudRequest {
  provider: 'amazon' | 'aliyun';
  workflowData: Record<string, any>;
}

export interface SyncWorkflowToCloudResponse {
  success: boolean;
  message: string;
  data?: {
    uploaded: string[];
    failed: string[];
    urlMapping?: Record<string, string>;
    workflowData?: Record<string, any>;
  };
}

/**
 * 同步工作流到云端(存根:原样返回数据 + 空 urlMapping,消费方 patch 逻辑退化为恒等)
 */
export async function syncWorkflowToCloudApi(
  _projectId: string,
  _provider: 'amazon' | 'aliyun',
  workflowData: Record<string, any>,
  _category?: string
): Promise<SyncWorkflowToCloudResponse> {
  return {
    success: true,
    message: '开源版无云端存储,图片直接使用本地数据',
    data: { uploaded: [], failed: [], urlMapping: {}, workflowData },
  };
}

/** 图片内联为 data URL 的单图大小上限(超过则保留原 URL) */
const INLINE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** 本地版内联总预算(字节),超过后剩余图片保留原 URL,防止 JSON 失控 */
const INLINE_TOTAL_BUDGET = 256 * 1024 * 1024;

/** 深度遍历,把 JSON 中所有图片 http(s) URL 收集为去重列表 */
function collectImageUrls(data: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof data === 'string') {
    if (/^https?:\/\/\S+\.(png|jpe?g|webp|gif|bmp)(\?\S*)?$/i.test(data)) out.add(data);
    return out;
  }
  if (Array.isArray(data)) {
    data.forEach((item) => collectImageUrls(item, out));
    return out;
  }
  if (data && typeof data === 'object') {
    Object.values(data).forEach((v) => collectImageUrls(v, out));
  }
  return out;
}

/** 深度遍历,把命中的 URL 字符串原位替换为替换值 */
function replaceUrls(data: unknown, mapping: Map<string, string>): void {
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (typeof v === 'string' && mapping.has(v)) data[i] = mapping.get(v)!;
      else replaceUrls(v, mapping);
    }
    return;
  }
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const k of Object.keys(record)) {
      const v = record[k];
      if (typeof v === 'string' && mapping.has(v)) record[k] = mapping.get(v)!;
      else replaceUrls(v, mapping);
    }
  }
}

/**
 * 构建本地版数据:把云版中的图片 http(s) URL 内联为 data URL(自包含单文件,
 * 离线可导入)。单图超限/拉取失败保留原 URL;视频等大文件一律保留 URL。
 */
async function buildLocalVersion(data: Record<string, any>): Promise<Record<string, any>> {
  const local = JSON.parse(JSON.stringify(data));
  const imageUrls = collectImageUrls(local);
  if (imageUrls.size === 0) return local;

  const mapping = new Map<string, string>();
  let inlinedBytes = 0;
  let inlinedCount = 0;
  for (const url of imageUrls) {
    if (inlinedBytes > INLINE_TOTAL_BUDGET) {
      console.warn(`[exportWorkflowZip] 内联预算已用尽(${inlinedCount} 张),剩余图片保留远程 URL`);
      break;
    }
    try {
      const blob = await fetchRemoteBlob(url);
      if (!blob.type.startsWith('image/') || blob.size > INLINE_IMAGE_MAX_BYTES) continue;
      const dataUrl = await blobToDataUrl(blob);
      mapping.set(url, dataUrl);
      inlinedBytes += blob.size;
      inlinedCount++;
    } catch (e) {
      console.warn(`[exportWorkflowZip] 图片内联失败,保留原 URL: ${url.slice(0, 100)}`, e);
    }
  }
  replaceUrls(local, mapping);
  console.log(`[exportWorkflowZip] 本地版已内联 ${inlinedCount}/${imageUrls.size} 张图片`);
  return local;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 导出工作流为 zip 打包文件(与云端版一致的 2 个 JSON):
 * - workflow-cloud.json 远程版:图片字段为 OSS/远程 URL,体积小,联网环境可直接再导入
 * - workflow.json 本地版:图片内联为 data URL,自包含单文件,离线可导入
 */
export async function exportWorkflowZipApi(
  projectId: string,
  workflowData: Record<string, any>,
  _category?: string
): Promise<void> {
  void _category;
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  zip.file('workflow-cloud.json', JSON.stringify(workflowData));
  const localVersion = await buildLocalVersion(workflowData);
  zip.file('workflow.json', JSON.stringify(localVersion));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadBlob(blob, `${projectId}.zip`);
}
