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
 * assetReferences.ts — 项目资产引用检查与清理
 *
 * 项目资产库删除资产时使用：
 * - findAssetReferences：扫描 step3（角色/场景）与 step4（片段/分镜）中对该资产的引用
 * - clearAssetReferences：将引用位置重置为空（保留名称/提示词等元数据），返回 store 局部更新
 */
import type { Character, Episode, Scene } from '@/shared/types';

export interface AssetRef {
  assetId: string;
  url: string;
  assetType: string;
}

interface WorkflowSlice {
  characters: Character[];
  scenes: Scene[];
  episodes: Episode[];
}

const matchId = (asset: AssetRef, id?: string) => !!id && id === asset.assetId;
const matchUrl = (asset: AssetRef, url?: string) => !!url && url === asset.url;
const matchImg = (asset: AssetRef, img?: { assetId?: string; imageUrl?: string }) =>
  !!img && (matchId(asset, img.assetId) || matchUrl(asset, img.imageUrl));

/** 扫描 step3/step4 中对该资产的引用，返回人类可读的引用位置列表 */
export function findAssetReferences(asset: AssetRef, state: WorkflowSlice): string[] {
  const refs: string[] = [];

  for (const c of state.characters || []) {
    const imageRefs: string[] = [];
    if ((c.avatarImages || []).some((img) => matchImg(asset, img))) imageRefs.push('头像');
    if ((c.multiViewImages || []).some((img) => matchImg(asset, img))) imageRefs.push('多视图');
    if ((c.fullBodyImages || []).some((img) => matchImg(asset, img))) imageRefs.push('形象照');
    if (imageRefs.length > 0) refs.push(`角色「${c.name}」的${imageRefs.join('、')}`);
    if (
      matchUrl(asset, c.voiceUrl) ||
      (c.characterAudios || []).some((a) => matchUrl(asset, a.cosUrl))
    ) {
      refs.push(`角色「${c.name}」的音色`);
    }
  }

  for (const s of state.scenes || []) {
    if (
      (s.imageAssetIds || []).includes(asset.assetId) ||
      (s.imageUrls || []).some((u) => matchUrl(asset, u)) ||
      (s.resolvedImageUrls || []).some((u) => matchUrl(asset, u))
    ) {
      refs.push(`场景「${s.name}」的场景图`);
    }
  }

  (state.episodes || []).forEach((ep, idx) => {
    const label = `片段${idx + 1}${ep.title ? `「${ep.title}」` : ''}`;
    if (matchId(asset, ep.firstFrameImageAssetId) || matchUrl(asset, ep.firstFrameImageUrl)) {
      refs.push(`${label}的首帧图`);
    }
    if (matchId(asset, ep.lastFrameImageAssetId) || matchUrl(asset, ep.lastFrameImageUrl)) {
      refs.push(`${label}的尾帧图`);
    }
    if (
      matchId(asset, ep.generatedVideoAssetId) ||
      matchUrl(asset, ep.generatedVideoUrl) ||
      (ep.generatedVideos || []).some((v) => matchId(asset, v.assetId) || matchUrl(asset, v.url))
    ) {
      refs.push(`${label}的生成视频`);
    }
    (ep.shots || []).forEach((shot, shotIdx) => {
      if (
        matchId(asset, shot.referenceImageAssetId) ||
        matchUrl(asset, shot.referenceImageUrl) ||
        (shot.referenceAssets || []).some((r) => matchId(asset, r.assetId))
      ) {
        refs.push(`${label}分镜${shotIdx + 1}的参考素材`);
      }
    });
  });

  return refs;
}

/**
 * 将该资产在 step3/step4 中的引用重置为空（保留名称/提示词等元数据）。
 * 返回 store 局部更新对象；无引用时返回 null。
 */
export function clearAssetReferences(
  asset: AssetRef,
  state: WorkflowSlice,
): Partial<WorkflowSlice> | null {
  let touched = false;

  const clearImg = <T extends { assetId?: string; imageUrl?: string }>(img: T): T => {
    if (!matchImg(asset, img)) return img;
    touched = true;
    return { ...img, assetId: '', imageUrl: '', isGenerating: false };
  };

  const characters = (state.characters || []).map((c) => {
    const next: Character = {
      ...c,
      avatarImages: (c.avatarImages || []).map(clearImg),
      multiViewImages: (c.multiViewImages || []).map(clearImg),
      fullBodyImages: (c.fullBodyImages || []).map(clearImg),
    };
    if (matchUrl(asset, c.voiceUrl)) {
      touched = true;
      next.voiceUrl = '';
    }
    if ((c.characterAudios || []).some((a) => matchUrl(asset, a.cosUrl))) {
      touched = true;
      next.characterAudios = (c.characterAudios || []).filter((a) => !matchUrl(asset, a.cosUrl));
    }
    return next;
  });

  const scenes = (state.scenes || []).map((s) => {
    const hit =
      (s.imageAssetIds || []).includes(asset.assetId) ||
      (s.imageUrls || []).some((u) => matchUrl(asset, u)) ||
      (s.resolvedImageUrls || []).some((u) => matchUrl(asset, u));
    if (!hit) return s;
    touched = true;
    return {
      ...s,
      imageAssetIds: (s.imageAssetIds || []).filter((id) => id !== asset.assetId),
      imageUrls: (s.imageUrls || []).filter((u) => !matchUrl(asset, u)),
      resolvedImageUrls: (s.resolvedImageUrls || []).filter((u) => !matchUrl(asset, u)),
    };
  });

  const episodes = (state.episodes || []).map((ep) => {
    const next: Episode = { ...ep };
    if (matchId(asset, ep.firstFrameImageAssetId) || matchUrl(asset, ep.firstFrameImageUrl)) {
      touched = true;
      next.firstFrameImageAssetId = '';
      next.firstFrameImageUrl = '';
    }
    if (matchId(asset, ep.lastFrameImageAssetId) || matchUrl(asset, ep.lastFrameImageUrl)) {
      touched = true;
      next.lastFrameImageAssetId = '';
      next.lastFrameImageUrl = '';
    }
    if (matchId(asset, ep.generatedVideoAssetId) || matchUrl(asset, ep.generatedVideoUrl)) {
      touched = true;
      next.generatedVideoAssetId = '';
      next.generatedVideoUrl = '';
    }
    if ((ep.generatedVideos || []).some((v) => matchId(asset, v.assetId) || matchUrl(asset, v.url))) {
      touched = true;
      next.generatedVideos = (ep.generatedVideos || []).filter(
        (v) => !matchId(asset, v.assetId) && !matchUrl(asset, v.url),
      );
    }
    next.shots = (ep.shots || []).map((shot) => {
      const hitImg = matchId(asset, shot.referenceImageAssetId) || matchUrl(asset, shot.referenceImageUrl);
      const hitAssets = (shot.referenceAssets || []).some((r) => matchId(asset, r.assetId));
      if (!hitImg && !hitAssets) return shot;
      touched = true;
      return {
        ...shot,
        ...(hitImg ? { referenceImageAssetId: '', referenceImageUrl: '', useReferenceAsFirstFrame: false } : {}),
        referenceAssets: (shot.referenceAssets || []).filter((r) => !matchId(asset, r.assetId)),
      };
    });
    return next;
  });

  return touched ? { characters, scenes, episodes } : null;
}
