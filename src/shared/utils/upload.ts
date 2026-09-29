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
 * 统一上传工具(开源版本地化实现)
 *
 * 原版把文件上传到自建服务端 + OSS,返回公网 URL;
 * 开源版无后端,改为:File → 压缩 data URL 直接内联返回。
 * 消费方(头像/场景/道具/分镜参考图上传)拿到 url 后照常使用,零改动;
 * data URL 可直接作为参考图传给支持 base64 的厂商接口(见 README「已知限制」)。
 */
import { blobToDataUrl, compressDataUrl } from '@/ai/core/media';

export type UploadModule = 'drama' | 'music' | 'novel' | 'workspace' | 'infinite-canvas';

export interface UploadResult {
  url: string;
  filename: string;
  assetId?: string;
}

export interface UploadOptions {
  projectId?: string;
  assetType?: string;
  episodeNumber?: number;
}

/**
 * 统一上传文件(本地化)
 * @param file 文件对象
 * @param moduleName 模块名(开源版仅保留参数兼容,不再区分服务端目录)
 * @param category 子分类(同上)
 * @param options 可选:projectId / assetType / episodeNumber(开源版忽略)
 * @returns { url: data URL, filename }
 */
export async function uploadFile(
  file: File,
  moduleName: UploadModule,
  category: string = 'default',
  options: UploadOptions = {},
): Promise<UploadResult> {
  void moduleName;
  void category;
  void options;

  const raw = await blobToDataUrl(file);
  // 超限时自动降采样压缩,避免超大图直接塞进请求体/IndexedDB
  const dataUrl = await compressDataUrl(raw);
  return { url: dataUrl, filename: file.name };
}

/**
 * 批量上传文件
 */
export async function uploadFiles(
  files: File[],
  moduleName: UploadModule,
  category: string = 'default',
  options: UploadOptions = {},
): Promise<UploadResult[]> {
  return Promise.all(files.map((file) => uploadFile(file, moduleName, category, options)));
}
