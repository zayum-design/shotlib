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
 * 片段视频生成的合规前置检查（单条生成与批量生成共用）
 *
 * 从 EpisodeCard.handleGenerate 提取：判定当前视频模型是否需要合规（厂商 helper），
 * 并检查片段实际用到的角色图片/首尾帧图/衍生场景图是否已完成合规入库。
 * 批量生成也必须先过此检查，否则会绕过合规 dialog 直接提交。
 */
import type { Episode, Character, Scene } from '@/shared/types/index';
import {
  getComplianceHelpers,
  readAnyCompliance,
} from '../providers/compliance-factory';
import { localApi } from '@/storage';

export interface EpisodeVideoComplianceResult {
  /** 当前模型是否需要合规检查（非合规模型直接放行） */
  needsCompliance: boolean;
  /** 是否存在未完成合规入库的图片 */
  hasUncompliant: boolean;
}

export function checkEpisodeVideoCompliance(params: {
  episode: Episode;
  characters: Character[];
  scenes: Scene[];
  videoModels: Array<{ id: string; provider?: string }>;
  currentEpisodeNumber?: number;
  /** 批量生成统一模型时传入，覆盖 episode.model 参与合规判定 */
  modelOverride?: string;
}): EpisodeVideoComplianceResult {
  const {
    episode,
    characters,
    scenes,
    videoModels,
    currentEpisodeNumber,
    modelOverride,
  } = params;

  const modelId = modelOverride || episode.model;
  const currentModel = videoModels.find((m) => m.id === modelId);
  const complianceHelpers = getComplianceHelpers(
    (currentModel as { provider?: string } | undefined)?.provider,
  );
  const needsCompliance =
    complianceHelpers?.isComplianceRequired(currentModel as any) ?? false;
  if (!needsCompliance) {
    return { needsCompliance: false, hasUncompliant: false };
  }

  const isImageCompliant = (img: any): boolean => {
    if (!img?.assetId) return false;
    const imgData = localApi.getCachedImageData(img.assetId);
    const compliance = imgData ? readAnyCompliance(imgData) : undefined;
    return !!compliance?.isCompliant;
  };

  // 首尾帧模式：检查首尾帧图是否已合规入库
  if (episode.videoGenerationMode === 'first_last_frame') {
    const hasUncompliantFrame = [
      {
        assetId: episode.firstFrameImageAssetId,
        imageUrl: episode.firstFrameImageUrl,
      },
      {
        assetId: episode.lastFrameImageAssetId,
        imageUrl: episode.lastFrameImageUrl,
      },
    ].some((f) => {
      if (!f.assetId || !f.imageUrl) return false;
      const imgData = localApi.getCachedImageData(f.assetId);
      const compliance = imgData ? readAnyCompliance(imgData) : undefined;
      return !compliance?.isCompliant;
    });
    return { needsCompliance: true, hasUncompliant: hasUncompliantFrame };
  }

  // 参考图模式：基于 shot prompts 解析实际用到的角色/场景
  const shotPrompts = [
    ...(episode.shots?.map((s) => s.prompt) || []),
    episode.videoPrompt,
  ].filter((p): p is string => !!p);
  const allPrompts = shotPrompts.join(' ');

  const usedCharacterIds = new Set<string>();
  const usedCharacterNames = new Set<string>();
  for (const match of allPrompts.matchAll(/character-id="([^"]+)"/g)) {
    usedCharacterIds.add(match[1]);
  }
  for (const match of allPrompts.matchAll(
    /@<role(?:\s+[^>]*)?>([^<]*?)<\/role>/g,
  )) {
    const name = match[1].trim();
    if (name) usedCharacterNames.add(name);
  }
  for (const match of allPrompts.matchAll(/@([一-龥a-zA-Z0-9_]+)(?![^<]*>)/g)) {
    usedCharacterNames.add(match[1]);
  }

  const usedSceneIds = new Set<string>();
  const usedSceneNames = new Set<string>();
  for (const match of allPrompts.matchAll(/scene-id="([^"]+)"/g)) {
    usedSceneIds.add(match[1]);
  }
  for (const match of allPrompts.matchAll(
    /#<scene(?:\s+[^>]*)?>([^<]*?)<\/scene>/g,
  )) {
    const name = match[1].trim();
    if (name) usedSceneNames.add(name);
  }

  // 实际用到的角色中是否有尚未完成合规入库的图片
  const hasUncompliantVirtualChars = characters.some((c) => {
    // 真人资产库角色不需要重复入库
    if (c.avatarSource === 'asset') return false;
    const charUsed = usedCharacterIds.has(c.id) || usedCharacterNames.has(c.name);
    if (!charUsed) return false;

    const hasUncompliantAvatar = (c.avatarImages || []).some(
      (img) => img.imageUrl && !isImageCompliant(img),
    );
    const hasUncompliantMultiView = (c.multiViewImages || []).some(
      (img) => img.imageUrl && !isImageCompliant(img),
    );
    const hasUncompliantPortrait = (c.fullBodyImages || [])
      .filter(
        (img) =>
          img.episodeNumber === undefined ||
          img.episodeNumber === (currentEpisodeNumber ?? 1),
      )
      .some((img) => img.imageUrl && !isImageCompliant(img));
    return (
      hasUncompliantAvatar || hasUncompliantMultiView || hasUncompliantPortrait
    );
  });

  // 衍生场景图（尾帧）也需合规
  const hasUncompliantDerivedScene = scenes.some((s) => {
    if (!s.isDerived) return false;
    const sceneUsed = usedSceneIds.has(s.id) || usedSceneNames.has(s.name);
    if (!sceneUsed) return false;
    const aid = s.imageAssetIds?.[0];
    if (!aid) return false;
    const imgData = localApi.getCachedImageData(aid);
    const compliance = imgData ? readAnyCompliance(imgData) : undefined;
    return !compliance?.isCompliant;
  });

  // 分镜参考附件（!<ref url="..." type="image"> 标签）：本地上传/素材库选择的图片
  // 与角色图一样必须完成合规入库。assetId 即 URL，assetKey 为 image_asset 行 UUID。
  // 不在 shots referenceAssets 中的 ref URL（如道具伪资产标签）不归本门禁管，保持原行为。
  const usedRefImageUrls = new Set<string>();
  for (const match of allPrompts.matchAll(/!<ref\s+url="([^"]+)"\s+type="image">/g)) {
    usedRefImageUrls.add(match[1]);
  }
  const hasUncompliantRefAsset = [...usedRefImageUrls].some((url) => {
    // 在片段所有分镜的附件中定位该 URL 对应的资产行
    const refAsset = (episode.shots || [])
      .flatMap((s) => s.referenceAssets || [])
      .find((a) => a.type === 'image' && a.assetId === url);
    if (!refAsset) return false; // 道具等伪资产标签，不拦截
    if (!refAsset.assetKey) return true; // 历史数据无资产行，必须走一次合规检查
    const imgData = localApi.getCachedImageData(refAsset.assetKey);
    const compliance = imgData ? readAnyCompliance(imgData) : undefined;
    return !compliance?.isCompliant;
  });

  return {
    needsCompliance: true,
    hasUncompliant: hasUncompliantVirtualChars || hasUncompliantDerivedScene || hasUncompliantRefAsset,
  };
}
