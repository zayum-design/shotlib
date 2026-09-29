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
 * exportImport.ts — 项目数据导出/导入
 *
 * 导出:单个项目的全部数据(项目行 + 分集 + 数据 + 资产 + 图片 base64 内联)为 JSON 文件
 * 导入:恢复为本地数据(生成新项目 id,避免与现有项目冲突)
 */
import { idbGet, idbKeys, idbSet } from './db';
import { projectRepo } from './projectRepo';
import { episodeRepo } from './episodeRepo';
import { assetRepo } from './assetRepo';
import { imageRepo } from './imageRepo';
import type { DramaEpisode, DramaEpisodeData, ProjectAsset, ImageAssetRecord } from './types';

export interface ProjectExportBundle {
  format: 'shotlib-project';
  version: 1;
  exportedAt: string;
  project: unknown;
  episodes: { episode: DramaEpisode; data: DramaEpisodeData | null }[];
  assetBundles: ProjectAsset[];
  assetRows: ProjectAsset[];
  imageAssets: (ImageAssetRecord & { blobBase64?: string })[];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string): Blob {
  const [meta, payload] = base64.split(',');
  const mime = meta.match(/data:(.*?);/)?.[1] || 'application/octet-stream';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportProject(projectId: string): Promise<ProjectExportBundle> {
  const project = await projectRepo.get(projectId);
  if (!project) throw new Error('项目不存在');
  const episodes = (await idbGet<DramaEpisode[]>(`episode:${projectId}`)) || [];
  const episodeBundle: { episode: DramaEpisode; data: DramaEpisodeData | null }[] = [];
  for (const ep of episodes) {
    const data = (await idbGet<DramaEpisodeData>(`episodedata:${projectId}:${ep.id}`)) || null;
    episodeBundle.push({ episode: ep, data });
  }
  const assetBundles: ProjectAsset[] = [];
  for (const key of await idbKeys(`assets:${projectId}:`)) {
    const record = await idbGet<ProjectAsset>(key);
    if (record) assetBundles.push(record);
  }
  const assetRows = ((await idbGet<ProjectAsset[]>(`assetrows:${projectId}`)) || []) as ProjectAsset[];
  const imageAssets: (ImageAssetRecord & { blobBase64?: string })[] = [];
  for (const key of await idbKeys(`imageasset:${projectId}:`)) {
    const record = await idbGet<ImageAssetRecord>(key);
    if (!record) continue;
    imageAssets.push({
      ...record,
      blobBase64: record.blob ? await blobToBase64(record.blob) : undefined,
      blob: undefined,
    });
  }
  return {
    format: 'shotlib-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    episodes: episodeBundle,
    assetBundles,
    assetRows,
    imageAssets,
  };
}

export async function importProject(bundle: ProjectExportBundle): Promise<ApiResultLike> {
  if (bundle?.format !== 'shotlib-project') {
    return { success: false, message: '文件格式不正确' };
  }
  const oldId = (bundle.project as { id: string }).id;
  const newId = crypto.randomUUID();
  const idMap = new Map<string, string>();

  // 图片资产先导入(分集数据引用 assetId)
  for (const img of bundle.imageAssets || []) {
    const newAssetId = crypto.randomUUID();
    idMap.set(img.id, newAssetId);
    await idbSet(`imageasset:${newId}:${newAssetId}`, {
      ...img,
      id: newAssetId,
      projectId: newId,
      blob: img.blobBase64 ? base64ToBlob(img.blobBase64) : undefined,
      blobBase64: undefined,
    });
  }
  const remapAssetRefs = (obj: any): any => {
    if (typeof obj === 'string') return obj;
    if (Array.isArray(obj)) return obj.map(remapAssetRefs);
    if (obj && typeof obj === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) {
        // 常见 assetId 引用字段统一重映射
        if (typeof v === 'string' && /assetId$|assetKey$/.test(k) && idMap.has(v)) {
          out[k] = idMap.get(v);
        } else {
          out[k] = remapAssetRefs(v);
        }
      }
      return out;
    }
    return obj;
  };

  // 项目行
  await idbSet('projects', [
    ...((await idbGet<any[]>('projects')) || []),
    { ...(bundle.project as any), id: newId, status: 'active' },
  ]);

  // 分集
  const episodes: DramaEpisode[] = [];
  for (const { episode, data } of bundle.episodes || []) {
    const newEpisodeId = crypto.randomUUID();
    idMap.set(episode.id, newEpisodeId);
    episodes.push({ ...episode, id: newEpisodeId, project_id: newId });
    if (data) {
      await idbSet(`episodedata:${newId}:${newEpisodeId}`, {
        ...data,
        id: `${newEpisodeId}:data`,
        episode_id: newEpisodeId,
        project_id: newId,
        data: remapAssetRefs(data.data),
      } satisfies DramaEpisodeData);
    }
  }
  await idbSet(`episode:${newId}`, episodes);

  // 资产
  for (const record of bundle.assetBundles || []) {
    const key = record.episode_number !== undefined
      ? `assets:${newId}:${record.category}:ep${record.episode_number}`
      : `assets:${newId}:${record.category}`;
    await idbSet(key, { ...record, id: crypto.randomUUID(), project_id: newId, data: remapAssetRefs(record.data) });
  }
  if (bundle.assetRows?.length) {
    await idbSet(
      `assetrows:${newId}`,
      bundle.assetRows.map((r) => ({
        ...r,
        id: crypto.randomUUID(),
        project_id: newId,
        data: remapAssetRefs(r.data),
      })),
    );
  }
  return { success: true, projectId: newId };
}

interface ApiResultLike {
  success: boolean;
  projectId?: string;
  message?: string;
}
