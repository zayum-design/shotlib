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
 * imageRepo.ts — 图片资产仓储(blob 注册表 + objectURL 缓存)
 *
 * 本地化核心:生成的图片以 Blob 存 IndexedDB(`imageasset:{projectId}:{assetId}`),
 * 主数据(角色/场景/片段行)只引用 assetId;展示层通过 resolve 换取 objectURL。
 *
 * objectURL 生命周期:
 * - 内部 Map 缓存 assetId → objectURL,resolve 命中直接复用
 * - 项目切换时 revokeAll()(组件切换项目时调用)
 * - 单图重新生成/删除时 revoke 单个
 */
import { idbGet, idbSet, idbDel, idbKeys } from './db';
import { stripBase64Fields } from './serialize';
import type { ImageAssetRecord, ApiResult } from './types';

/** 缓存中存放本地地址的保留键(对齐原 service 层行为) */
export const LOCAL_URL_CACHE_KEY = '__local_url';

/** image_asset.data 运行时缓存:assetId → data(合规状态等由调用方读取) */
const imageDataCache = new Map<string, Record<string, any>>();

/** objectURL 缓存:assetId → blob URL(跨项目共享,项目切换时统一 revoke) */
const objectUrlCache = new Map<string, string>();

function nowIso(): string {
  return new Date().toISOString();
}

function recordKey(projectId: string, assetId: string): string {
  return `imageasset:${projectId}:${assetId}`;
}

export const imageRepo = {
  // ---------- objectURL 管理 ----------

  /** 获取已缓存的 objectURL(未缓存返回 undefined,同步) */
  peekUrl(assetId: string): string | undefined {
    return objectUrlCache.get(assetId);
  },

  /** 为记录建立 objectURL 并缓存(blob 记录优先,否则用 originalUrl/remoteUrl) */
  async ensureUrl(assetId: string, record: ImageAssetRecord): Promise<string | undefined> {
    const cached = objectUrlCache.get(assetId);
    if (cached) return cached;
    let url: string | undefined;
    if (record.blob) {
      url = URL.createObjectURL(record.blob);
      objectUrlCache.set(assetId, url);
    } else {
      url = record.originalUrl || record.remoteUrl || record.data?.original_url || undefined;
      if (url) objectUrlCache.set(assetId, url);
    }
    return url;
  },

  /** 回收单个 assetId 的 objectURL(删除/重新生成后调用) */
  revoke(assetId: string): void {
    const url = objectUrlCache.get(assetId);
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
    objectUrlCache.delete(assetId);
  },

  /** 项目切换时回收全部 blob objectURL(防止长会话内存泄漏) */
  revokeAll(): void {
    for (const [id, url] of objectUrlCache) {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
      objectUrlCache.delete(id);
    }
  },

  // ---------- data 缓存(对齐原 localApi 行为) ----------

  getCachedImageData(assetId: string): Record<string, any> | undefined {
    return imageDataCache.get(assetId);
  },

  clearProjectCache(): void {
    imageDataCache.clear();
  },

  invalidateCachedImageData(assetId: string): void {
    imageDataCache.delete(assetId);
  },

  /** 缓存快照(合规反查等扫描场景用) */
  getCacheEntries(): [string, Record<string, any>][] {
    return Array.from(imageDataCache.entries());
  },

  // ---------- CRUD ----------

  /** 批量注册图片资产行(素材库/上传场景;生成的图片走 putBlob) */
  async create(projectId: string, req: { assets: any[] }): Promise<ApiResult<ImageAssetRecord[]>> {
    const created: ImageAssetRecord[] = [];
    for (const asset of req.assets) {
      const id = asset.id || crypto.randomUUID();
      const record: ImageAssetRecord = {
        id,
        projectId,
        episodeNumber: asset.episode_number ?? 0,
        assetType: asset.asset_type || 'image',
        originalUrl: asset.original_url,
        remoteUrl: asset.remote_url,
        status: asset.status || 'ready',
        metadata: asset.metadata,
        data: asset.data || {},
        createdAt: nowIso(),
      };
      await idbSet(recordKey(projectId, id), record);
      imageDataCache.set(id, { ...record.data });
      created.push(record);
    }
    return { success: true, data: created };
  },

  /** AI 生成图片落库:blob + 元信息一体写入(供 ai 层生成成功后调用) */
  async putBlob(
    projectId: string,
    assetId: string,
    blob: Blob,
    extra?: Partial<Pick<ImageAssetRecord, 'assetType' | 'episodeNumber' | 'metadata' | 'data' | 'remoteUrl'>>,
  ): Promise<ApiResult<ImageAssetRecord>> {
    const existing = (await idbGet<ImageAssetRecord>(recordKey(projectId, assetId))) || null;
    if (existing) imageRepo.revoke(assetId);
    const record: ImageAssetRecord = {
      id: assetId,
      projectId,
      episodeNumber: extra?.episodeNumber ?? existing?.episodeNumber ?? 0,
      assetType: extra?.assetType || existing?.assetType || 'generated_image',
      blob,
      mimeType: blob.type,
      remoteUrl: extra?.remoteUrl ?? existing?.remoteUrl,
      status: 'ready',
      metadata: extra?.metadata ?? existing?.metadata,
      data: { ...existing?.data, ...extra?.data },
      createdAt: existing?.createdAt || nowIso(),
    };
    await idbSet(recordKey(projectId, assetId), record);
    imageDataCache.set(assetId, { ...record.data });
    return { success: true, data: record };
  },

  async get(projectId: string, assetId: string): Promise<ImageAssetRecord | undefined> {
    return idbGet<ImageAssetRecord>(recordKey(projectId, assetId));
  },

  async remove(projectId: string, assetId: string): Promise<void> {
    imageRepo.revoke(assetId);
    imageDataCache.delete(assetId);
    await idbDel(recordKey(projectId, assetId));
  },

  /** 批量解析 assetId → 可展示 URL(签名对齐原 resolveImageAssets) */
  async resolve(
    projectId: string,
    req: { asset_ids: string[] },
  ): Promise<ApiResult<Record<string, { url: string; thumbnailUrl?: string; status: string; assetType: string; metadata?: Record<string, any>; data?: Record<string, any> }>>> {
    const result: Record<string, { url: string; thumbnailUrl?: string; status: string; assetType: string; metadata?: Record<string, any>; data?: Record<string, any> }> = {};
    for (const assetId of req.asset_ids) {
      if (!assetId) continue;
      const record = await idbGet<ImageAssetRecord>(recordKey(projectId, assetId));
      if (!record) continue;
      const url = await imageRepo.ensureUrl(assetId, record);
      if (!url) continue;
      result[assetId] = {
        url,
        status: record.status,
        assetType: record.assetType,
        metadata: record.metadata,
        data: record.data,
      };
      // 对齐原 service:解析时填充 data 缓存 + 本地地址保留键
      if (record.data || url) {
        imageDataCache.set(assetId, {
          ...imageDataCache.get(assetId),
          ...record.data,
          ...(url ? { [LOCAL_URL_CACHE_KEY]: url } : {}),
        });
      }
    }
    return { success: true, data: result };
  },

  /** 列出项目图片资产(签名对齐原 listImageAssets) */
  async list(projectId: string, filters?: { episode_number?: number; asset_type?: string }): Promise<
    ApiResult<{ id: string; original_url: string; thumbnail_url?: string; asset_type: string; status: string; metadata?: Record<string, any> }[]>
  > {
    const prefix = `imageasset:${projectId}:`;
    const all = await idbKeys(prefix);
    const list: { id: string; original_url: string; thumbnail_url?: string; asset_type: string; status: string; metadata?: Record<string, any> }[] = [];
    for (const key of all) {
      const record = await idbGet<ImageAssetRecord>(key);
      if (!record) continue;
      if (filters?.episode_number !== undefined && (record.episodeNumber ?? 0) !== filters.episode_number) continue;
      if (filters?.asset_type && record.assetType !== filters.asset_type) continue;
      list.push({
        id: record.id,
        original_url: record.originalUrl || record.remoteUrl || '',
        asset_type: record.assetType,
        status: record.status,
        metadata: record.metadata,
      });
    }
    return { success: true, data: list };
  },

  /** 上传本地文件为图片资产(签名对齐原 uploadImageAsset,formData 含 file 字段) */
  async upload(projectId: string, formData: FormData): Promise<ApiResult<{ assetId: string; url: string; filename: string }>> {
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return { success: false, data: undefined as unknown as { assetId: string; url: string; filename: string }, message: 'formData 中缺少 file 字段' };
    }
    const assetId = crypto.randomUUID();
    await imageRepo.putBlob(projectId, assetId, file, {
      assetType: 'upload_image',
      metadata: { source: 'upload', filename: file.name },
      data: { original_url: file.name },
    });
    const record = (await idbGet<ImageAssetRecord>(recordKey(projectId, assetId)))!;
    const url = await imageRepo.ensureUrl(assetId, record);
    return { success: true, data: { assetId, url: url || '', filename: file.name } };
  },

  /** 合并 patch 到记录 data(签名对齐原 patchImageAssetData) */
  async patchData(projectId: string, assetKey: string, patch: Record<string, any>): Promise<ApiResult<{ updated: boolean }>> {
    const record = await idbGet<ImageAssetRecord>(recordKey(projectId, assetKey));
    if (!record) {
      return { success: false, data: { updated: false }, message: '图片资产不存在' };
    }
    const cleaned = { ...record.data, ...stripBase64Fields(patch) };
    record.data = cleaned;
    await idbSet(recordKey(projectId, assetKey), record);
    imageDataCache.set(assetKey, { ...imageDataCache.get(assetKey), ...cleaned });
    return { success: true, data: { updated: true } };
  },

  /** 项目级联删除时按项目清理 */
  async purgeByProject(projectId: string): Promise<void> {
    const prefix = `imageasset:${projectId}:`;
    const all = await idbKeys(prefix);
    for (const key of all) {
      const assetId = key.slice(prefix.length);
      imageRepo.revoke(assetId);
      imageDataCache.delete(assetId);
      await idbDel(key);
    }
  },
};
