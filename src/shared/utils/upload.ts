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
 * 统一上传工具
 *
 * 配置了 OSS 时:File → OSS 直传,返回持久公共 URL,并注册 imageRepo 资产行
 * (assetId 供消费方持久化引用,刷新后可按 assetId 还原)——头像/多视图/形象照等
 * 上传后业务数据直接持有远程地址,云端视频生成可直接拉取参考图。
 * 未配置 OSS / 上传失败时:降级为压缩 data URL 内联返回(原行为),并打警告日志。
 */
import { blobToDataUrl, compressDataUrl } from '@/ai/core/media';
import { uploadBlobToOss } from '@/ai/services/oss-upload.service';
import { settingsRepo, type OssConfig } from '@/storage/settingsRepo';
import { imageRepo } from '@/storage/imageRepo';
import { useLogStore } from '@/shared/stores/logStore';

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
 * OSS 直传 + 落库;返回 null 表示本次不可直传(无 projectId),调用方走降级
 */
async function uploadToOss(
  file: File,
  oss: OssConfig,
  options: UploadOptions,
): Promise<UploadResult | null> {
  const { projectId, assetType, episodeNumber } = options;
  if (!projectId) return null;
  const assetId = crypto.randomUUID();
  const ossUrl = await uploadBlobToOss(
    file,
    oss,
    `shotlib/${projectId}/${assetType || 'upload'}`,
    assetId,
  );
  // 注册 imageRepo 资产行(与生成图片同构:blob + data.ossUrl),支持刷新后按 assetId 还原
  await imageRepo.putBlob(projectId, assetId, file, {
    assetType: assetType || 'upload_image',
    episodeNumber: episodeNumber ?? 0,
    remoteUrl: ossUrl,
    metadata: { source: 'upload', filename: file.name },
  });
  await imageRepo.patchData(projectId, assetId, { ossUrl });
  return { url: ossUrl, filename: file.name, assetId };
}

/**
 * 统一上传文件
 * @param file 文件对象
 * @param moduleName 模块名(仅保留参数兼容)
 * @param category 子分类(同上)
 * @param options projectId / assetType / episodeNumber(OSS 直传与资产落库使用)
 * @returns { url, filename, assetId? };OSS 可用时 url 为持久远程地址
 */
export async function uploadFile(
  file: File,
  moduleName: UploadModule,
  category: string = 'default',
  options: UploadOptions = {},
): Promise<UploadResult> {
  void moduleName;
  void category;

  const { projectId } = options;
  const { oss } = await settingsRepo.get();
  if (oss?.bucket && oss.accessKeyId && oss.accessKeySecret && projectId) {
    try {
      const result = await uploadToOss(file, oss, options);
      if (result) {
        useLogStore.getState().addLog({
          level: 'success',
          source: 'oss',
          url: result.url,
          message: `上传文件已直传 OSS: ${result.url.slice(0, 120)}`,
        });
        return result;
      }
    } catch (e) {
      useLogStore.getState().addLog({
        level: 'error',
        source: 'oss',
        error: e instanceof Error ? e.message : String(e),
        message: `OSS 直传失败,降级为 data URL(远程引用会受限): ${(e as Error).message.slice(0, 150)}`,
      });
    }
  }

  // 降级:File → 压缩 data URL 内联返回(超限时自动降采样,避免超大图塞爆存储)
  const raw = await blobToDataUrl(file);
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
