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
 * 后端把工作流数据同步到服务端工作区/OSS 云端(图片换公网 URL、zip 打包下载);
 * 数据全部保存在浏览器 IndexedDB,图片以本地 blob/dataURL 直接使用:
 * - syncWorkflowApi / syncWorkflowToCloudApi:空操作,原样返回数据 + 空 urlMapping
 *   (消费方按 urlMapping 做局部 URL 更新,空映射即恒等变换,天然 no-op)
 * - exportWorkflowZipApi:纯前端打包,目录结构(双 JSON + 语义化附件目录):
 *   workflow-cloud.json(原始远程 URL,便于联网再导入) +
 *   workflow.json(本地版,媒体字段回写为 zip 内 ./ 相对路径) +
 *   characters/avatars|views、scenes、props、frames、shots、
 *   videos/E0N、audios 语义化目录存放全部附件(仅当前项目数据引用的 URL),
 *   整包自包含离线可用;attachments/index.json 为 URL→路径映射
 */
import { fetchRemoteBlob, blobToDataUrl } from '@/ai/core/media';
import { idbGet } from '@/storage/db';
import type { ImageAssetRecord } from '@/storage/types';

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
 * 同步工作流到本地(数据已在本地 IndexedDB,空操作)
 */
export async function syncWorkflowApi(
  _projectId: string,
  _workflowData: Record<string, any>,
  _category?: string
): Promise<SyncWorkflowResponse> {
  return { success: true, message: '数据保存在浏览器本地,无需同步' };
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
    message: '无云端存储,图片直接使用本地数据',
    data: { uploaded: [], failed: [], urlMapping: {}, workflowData },
  };
}

/** 图片内联为 data URL 的单图大小上限(超过则保留原 URL) */
const INLINE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** 本地版内联总预算(字节),超过后剩余图片保留原 URL,防止 JSON 失控 */
const INLINE_TOTAL_BUDGET = 256 * 1024 * 1024;
/** 附件并发下载数 */
const ATTACHMENT_DOWNLOAD_CONCURRENCY = 4;

/** 附件媒体 URL 匹配(http(s) 且带媒体扩展名,query 串忽略,用于结构化之外的兜底收集) */
const MEDIA_URL_RE = /^https?:\/\/\S+?\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|m4v|mp3|wav|aac|m4a|ogg)(\?\S*)?$/i;
/** 图片 URL(下载失败时本地版降级为 data URL 内联) */
const IMAGE_URL_RE = /^https?:\/\/\S+?\.(png|jpe?g|webp|gif|bmp)(\?\S*)?$/i;

/** Blob.type → 真实扩展名(修正历史错误后缀:早期上传视频被兜底成 .png) */
function extFromBlobType(type: string): string | null {
  const t = (type || '').toLowerCase();
  if (!t) return null;
  if (t.includes('jpeg')) return 'jpg';
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  if (t.includes('bmp')) return 'bmp';
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('webm')) return 'webm';
  if (t.includes('quicktime')) return 'mov';
  if (t.includes('m4v')) return 'm4v';
  if (t.includes('mpeg')) return 'mp3';
  if (t.includes('wav')) return 'wav';
  if (t.includes('m4a') || t === 'audio/mp4') return 'm4a';
  if (t.includes('aac')) return 'aac';
  if (t.includes('ogg')) return 'ogg';
  return null;
}

/** 名称转 zip 路径段:前端无拼音库,保留中文(zip 为 UTF-8 文件名),仅清洗路径分隔符与控制字符 */
function slugName(name: unknown, fallback: string): string {
  const cleaned = String(name ?? '').replace(/[\/\\\x00-\x1f]/g, '').trim();
  return (cleaned || fallback).slice(0, 60);
}

interface AttachmentTask {
  /** 远程 URL(http/https);本地资产(assetId 直取 IndexedDB)时为空串 */
  url: string;
  /** 本地图片资产 ID:优先从 IndexedDB 读 blob,无需网络即可保证附件存在 */
  assetId?: string;
  /** zip 内目标路径(语义化目录结构) */
  relPath: string;
  /** 下载成功后回写本地版数据(通常替换为 ./ 相对路径);同一附件多处引用共享,全部回写 */
  applies: Array<(newValue: string) => void>;
}

/**
 * 按目录结构规划 drama 工作流的附件下载任务(仅当前项目数据引用的 URL):
 * - 角色头像 characters/avatars/{名}-avatar[-{i}].png
 * - 多视图/形象照 characters/views/{名}-multiview|fullbody-{i}.png
 * - 场景/道具图 scenes/|props/{名}-scene|prop[-{i}].png
 * - 片段首/尾帧 frames/{片段id}-first|last.png
 * - 片段视频 videos/{E0N}/ep_{n}_{名}[-history-{i}].mp4
 * - 分镜参考图 shots/{片段id}-shot-{i}.png
 * - 音频 audios/audio-{i}.mp3、封面 audios/audio-cover-{i}.png
 */
function planAttachmentTasks(data: Record<string, any>): AttachmentTask[] {
  const tasks: AttachmentTask[] = [];
  const plannedUrls = new Set<string>();
  const usedPaths = new Set<string>();

  const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u);
  const isDataImageUrl = (u: unknown): u is string => typeof u === 'string' && /^data:image\//.test(u);

  const uniquePath = (p: string): string => {
    if (!usedPaths.has(p)) {
      usedPaths.add(p);
      return p;
    }
    const dot = p.lastIndexOf('.');
    const hash = Math.abs([...p].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
    const candidate = dot > 0 ? `${p.slice(0, dot)}-${hash}${p.slice(dot)}` : `${p}-${hash}`;
    usedPaths.add(candidate);
    return candidate;
  };

  const push = (url: string, relPath: string, apply: (v: string) => void, assetId?: string) => {
    // 同一 URL / 同一 assetId 只下载一次;多处引用共享同一路径,全部回写
    const key = url || (assetId ? `asset:${assetId}` : '');
    if (!key) return;
    if (plannedUrls.has(key)) {
      const existing = tasks.find((t) => (url ? t.url === url : t.assetId === assetId));
      existing?.applies.push(apply);
      return;
    }
    plannedUrls.add(key);
    tasks.push({ url, assetId, relPath: uniquePath(relPath), applies: [apply] });
  };

  /** 图片项:远程 URL 按 URL 下载;data URL 直接解码入包;仅有 assetId(本地图)直取 IndexedDB */
  const planImageItem = (
    img: any,
    relPath: string,
    apply: (v: string) => void,
  ) => {
    if (!img || typeof img !== 'object') return;
    if (isHttp(img.imageUrl) || isDataImageUrl(img.imageUrl)) {
      push(img.imageUrl, relPath, apply, typeof img.assetId === 'string' ? img.assetId : undefined);
    } else if (typeof img.assetId === 'string' && img.assetId) {
      push('', relPath, apply, img.assetId);
    }
  };

  // ===== 角色 =====
  const characters: any[] = data.projectAssets?.characters ?? data.characters ?? [];
  characters.forEach((c: any, ci: number) => {
    if (!c) return;
    const slug = slugName(c.name, `char-${ci}`);
    if (isHttp(c.avatar) || isDataImageUrl(c.avatar)) {
      push(c.avatar, `characters/avatars/${slug}-avatar.png`, (v) => { c.avatar = v; });
    }
    (c.avatarImages || []).forEach((img: any, i: number) => {
      planImageItem(img, `characters/avatars/${slug}-avatar-${i}.png`, (v) => { img.imageUrl = v; });
    });
    (c.multiViewImages || []).forEach((img: any, i: number) => {
      planImageItem(img, `characters/views/${slug}-multiview-${i}.png`, (v) => { img.imageUrl = v; });
    });
    (c.fullBodyImages || []).forEach((img: any, i: number) => {
      planImageItem(img, `characters/views/${slug}-fullbody-${i}.png`, (v) => { img.imageUrl = v; });
    });
  });

  // ===== 场景 / 道具 =====
  const planImageArray = (list: any[], kind: 'scene' | 'prop') => {
    const dir = kind === 'scene' ? 'scenes' : 'props';
    list.forEach((item: any, idx: number) => {
      if (!item) return;
      const slug = slugName(item.name, `${kind}-${idx}`);
      if (isHttp(item.imageUrl) || isDataImageUrl(item.imageUrl)) {
        const url = item.imageUrl;
        push(url, `${dir}/${slug}-${kind}.png`, (v) => { item.imageUrl = v; }, typeof item.imageAssetIds?.[0] === 'string' ? item.imageAssetIds[0] : undefined);
      }
      const assetIds: string[] = Array.isArray(item.imageAssetIds) ? item.imageAssetIds : [];
      (item.imageUrls || []).forEach((url: unknown, i: number) => {
        const assetId = typeof assetIds[i] === 'string' ? assetIds[i] : undefined;
        if (isHttp(url) || isDataImageUrl(url)) {
          push(url, `${dir}/${slug}-${kind}-${i}.png`, (v) => { item.imageUrls[i] = v; }, assetId);
        } else if (assetId) {
          push('', `${dir}/${slug}-${kind}-${i}.png`, (v) => { item.imageUrls[i] = v; }, assetId);
        }
      });
    });
  };
  planImageArray(data.projectAssets?.scenes ?? data.scenes ?? [], 'scene');
  planImageArray(data.projectAssets?.props ?? data.props ?? [], 'prop');

  // ===== 音频资产 =====
  const audioAssets: any[] = data.projectAssets?.audioAssets ?? data.audioAssets ?? [];
  audioAssets.forEach((asset: any, i: number) => {
    if (!asset) return;
    if (isHttp(asset.audioUrl)) {
      const url = asset.audioUrl;
      push(url, `audios/audio-${i}.mp3`, (v) => { asset.audioUrl = v; });
    }
    if (isHttp(asset.coverUrl)) {
      const url = asset.coverUrl;
      push(url, `audios/audio-cover-${i}.png`, (v) => { asset.coverUrl = v; });
    }
  });

  // ===== 片段(当前分集 + 全部分集 + 旧格式,仅本项目数据) =====
  const epGroups: { eps: any[]; epNum?: number }[] = [];
  if (Array.isArray(data.currentEpisodeData?.episodes)) {
    epGroups.push({ eps: data.currentEpisodeData.episodes, epNum: Number(data.currentEpisode) || undefined });
  }
  if (data.episodesData && typeof data.episodesData === 'object') {
    for (const [key, epData] of Object.entries(data.episodesData)) {
      if (Array.isArray((epData as any)?.episodes)) {
        epGroups.push({ eps: (epData as any).episodes, epNum: Number(key) || undefined });
      }
    }
  }
  if (Array.isArray(data.episodes)) {
    epGroups.push({ eps: data.episodes });
  }

  epGroups.forEach(({ eps, epNum }) => {
    const videosPrefix = epNum ? `videos/E${String(epNum).padStart(2, '0')}` : 'videos';
    eps.forEach((ep: any, epIndex: number) => {
      if (!ep) return;
      const epId = ep.id || `episode-${epIndex}`;
      const epSlug = slugName(ep.title, epId);
      if (isHttp(ep.firstFrameImageUrl)) {
        const url = ep.firstFrameImageUrl;
        push(url, `frames/${epId}-first.png`, (v) => { ep.firstFrameImageUrl = v; }, ep.firstFrameImageAssetId);
      } else if (typeof ep.firstFrameImageAssetId === 'string' && ep.firstFrameImageAssetId) {
        push('', `frames/${epId}-first.png`, (v) => { ep.firstFrameImageUrl = v; }, ep.firstFrameImageAssetId);
      }
      if (isHttp(ep.lastFrameImageUrl)) {
        const url = ep.lastFrameImageUrl;
        push(url, `frames/${epId}-last.png`, (v) => { ep.lastFrameImageUrl = v; }, ep.lastFrameImageAssetId);
      } else if (typeof ep.lastFrameImageAssetId === 'string' && ep.lastFrameImageAssetId) {
        push('', `frames/${epId}-last.png`, (v) => { ep.lastFrameImageUrl = v; }, ep.lastFrameImageAssetId);
      }
      if (isHttp(ep.generatedVideoUrl)) {
        const url = ep.generatedVideoUrl;
        const ext = url.match(/\.([a-z0-9]+)(\?|$)/i)?.[1] || 'mp4';
        push(url, `${videosPrefix}/ep_${epIndex + 1}_${epSlug}.${ext}`, (v) => { ep.generatedVideoUrl = v; });
      }
      (ep.generatedVideos || []).forEach((video: any, vIdx: number) => {
        if (isHttp(video?.url)) {
          const url = video.url;
          const ext = url.match(/\.([a-z0-9]+)(\?|$)/i)?.[1] || 'mp4';
          push(url, `${videosPrefix}/ep_${epIndex + 1}_${epSlug}-history-${vIdx}.${ext}`, (v) => { video.url = v; });
        }
      });
      (ep.shots || []).forEach((shot: any, shotIndex: number) => {
        if (isHttp(shot?.referenceImageUrl)) {
          const url = shot.referenceImageUrl;
          push(url, `shots/${epId}-shot-${shotIndex}.png`, (v) => { shot.referenceImageUrl = v; }, shot.referenceImageAssetId);
        } else if (typeof shot?.referenceImageAssetId === 'string' && shot.referenceImageAssetId) {
          push('', `shots/${epId}-shot-${shotIndex}.png`, (v) => { shot.referenceImageUrl = v; }, shot.referenceImageAssetId);
        }
      });
    });
  });

  // ===== 兜底:结构化未覆盖的媒体 URL(如即时创作/instant 字段)进 attachments/ =====
  const walkLeftover = (node: unknown) => {
    if (typeof node === 'string') {
      const isMediaString =
        (MEDIA_URL_RE.test(node) && isHttp(node)) || isDataImageUrl(node);
      if (isMediaString && !plannedUrls.has(node)) {
        let base: string;
        try {
          base = decodeURIComponent(new URL(node).pathname.split('/').filter(Boolean).pop() || '');
        } catch {
          base = '';
        }
        const safe = slugName(base, isDataImageUrl(node) ? 'image.png' : 'file');
        push(node, `attachments/${safe}`, (v) => { replaceUrlsIn(data, new Map([[node, v]])); });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walkLeftover);
      return;
    }
    if (node && typeof node === 'object') {
      Object.values(node).forEach(walkLeftover);
    }
  };
  walkLeftover(data);

  return tasks;
}

/** 深度遍历,把命中的 URL 字符串原位替换为替换值 */
function replaceUrlsIn(data: unknown, mapping: Map<string, string>): void {
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (typeof v === 'string' && mapping.has(v)) data[i] = mapping.get(v)!;
      else replaceUrlsIn(v, mapping);
    }
    return;
  }
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const k of Object.keys(record)) {
      const v = record[k];
      if (typeof v === 'string' && mapping.has(v)) record[k] = mapping.get(v)!;
      else replaceUrlsIn(v, mapping);
    }
  }
}

/**
 * 构建本地版数据(对齐):按语义化目录结构把全部附件下载进 zip,
 * 本地版 JSON 中的 URL 回写为 ./ 相对路径;下载失败时图片降级为 data URL
 * 内联(沿用单图/总预算限制),视频等保留原 URL。
 */
async function buildLocalVersion(
  zip: { file(path: string, data: Blob | string): unknown },
  data: Record<string, any>,
  projectId: string,
): Promise<{
  mapping: Record<string, string>;
  downloaded: number;
  failed: number;
  inlined: number;
  planned: number;
  failures: Array<{ target: string; relPath: string; reason: string }>;
}> {
  const tasks = planAttachmentTasks(data);
  const mapping: Record<string, string> = {};
  const stats = { downloaded: 0, failed: 0, inlined: 0, planned: tasks.length };
  const failures: Array<{ target: string; relPath: string; reason: string }> = [];
  if (tasks.length === 0) return { mapping, ...stats, failures };

  /** 附件 → blob:assetId 优先直读 IndexedDB(未配 OSS 的本地图,无需网络);否则按 URL 拉取 */
  const resolveBlob = async (task: AttachmentTask): Promise<Blob> => {
    if (task.assetId) {
      const record = await idbGet<ImageAssetRecord>(`imageasset:${projectId}:${task.assetId}`);
      if (record?.blob) {
        const type = record.mimeType || record.blob.type;
        return type && !record.blob.type ? new Blob([record.blob], { type }) : record.blob;
      }
    }
    if (task.url.startsWith('data:')) {
      const [, base64] = task.url.split(',');
      const mime = task.url.slice(5, task.url.indexOf(';')) || 'image/png';
      const bin = atob(base64 || '');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return fetchRemoteBlob(task.url);
  };
  const mapKey = (task: AttachmentTask): string => task.url || `asset:${task.assetId || task.relPath}`;

  let inlinedBytes = 0;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      if (cursor >= tasks.length) return;
      const task = tasks[cursor++];
      try {
        const blob = await resolveBlob(task);
        let rel = task.relPath;
        // 历史数据修正:URL 后缀与实际媒体类型不符时(如早期视频被上传成 .png),
        // 按 blob.type 在 zip 内改用真实扩展名
        const realExt = extFromBlobType(blob.type);
        if (realExt) {
          const dot = rel.lastIndexOf('.');
          const curExt = dot > 0 ? rel.slice(dot + 1).toLowerCase() : '';
          if (curExt !== realExt) {
            rel = dot > 0 ? `${rel.slice(0, dot)}.${realExt}` : `${rel}.${realExt}`;
          }
        }
        zip.file(rel, blob);
        task.applies.forEach((fn) => fn(`./${rel}`));
        mapping[mapKey(task)] = `./${rel}`;
        stats.downloaded++;
      } catch (e) {
        // 图片下载失败时降级为 data URL 内联,保证本地版自包含;视频等保留原 URL
        const isImage = IMAGE_URL_RE.test(task.url) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(task.relPath);
        if (isImage && inlinedBytes <= INLINE_TOTAL_BUDGET) {
          try {
            const blob = await resolveBlob(task);
            if (blob.type.startsWith('image/') && blob.size <= INLINE_IMAGE_MAX_BYTES) {
              const dataUrl = await blobToDataUrl(blob);
              task.applies.forEach((fn) => fn(dataUrl));
              mapping[mapKey(task)] = dataUrl;
              inlinedBytes += blob.size;
              stats.inlined++;
              continue;
            }
          } catch { /* 内联同样失败,保留原 URL */ }
        }
        stats.failed++;
        const target = (task.url || `asset:${task.assetId}` || '').slice(0, 200);
        const reason = e instanceof Error ? e.message : String(e);
        failures.push({ target, relPath: task.relPath, reason: reason.slice(0, 300) });
        console.warn(`[exportWorkflowZip] 附件下载失败,保留原 URL: ${target}`, e);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(ATTACHMENT_DOWNLOAD_CONCURRENCY, tasks.length) }, worker),
  );
  console.log(
    `[exportWorkflowZip] 本地版附件: 下载 ${stats.downloaded}/${tasks.length}` +
      `${stats.inlined > 0 ? `,内联降级 ${stats.inlined}` : ''}${stats.failed > 0 ? `,失败保留 URL ${stats.failed}` : ''}`,
  );
  return { mapping, ...stats, failures };
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
): Promise<{ planned: number; downloaded: number; failed: number; inlined: number }> {
  void _category;
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  // 云端版:原始数据原样保留(原始远程 URL,联网可直接再导入)
  zip.file('workflow-cloud.json', JSON.stringify(workflowData));
  // 本地版:全部附件按语义化目录结构下载进 zip,JSON 内 URL 回写为 ./ 相对路径
  const local = JSON.parse(JSON.stringify(workflowData));
  const { mapping, downloaded, planned, failed, inlined, failures } = await buildLocalVersion(zip, local, projectId);
  zip.file('workflow.json', JSON.stringify(local));
  // 附件清单:原始 URL/assetId → zip 内路径;失败清单附原因,便于定位
  if (planned > 0) {
    zip.file('attachments/index.json', JSON.stringify({ mapping, failed: failures }, null, 2));
  }
  console.log(
    `[exportWorkflowZip] 附件汇总: 计划 ${planned},成功 ${downloaded},失败 ${failed}` +
      (failed > 0 ? `(详见 attachments/index.json failed 列表)` : ''),
  );

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadBlob(blob, `${projectId}.zip`);
  return { planned, downloaded, failed, inlined };
}
