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

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback } from 'react';
import type { InstantCharacter, InstantScene, InstantSegment, CanvasItem } from '@/shared/types/project';
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import { saveInstantToServer } from '@/modules/instant/utils/instantSyncUtils';
import { localApi } from '@/storage';
import { readAnyCompliance } from '@/modules/workflow/providers/compliance-factory';
import { message } from '@/shared/utils/message';

/** 从缓存读取图片合规状态 */
const getIsCompliant = (img: any): boolean => {
  if (!img?.assetId) return false;
  const imgData = localApi.getCachedImageData(img.assetId);
  const compliance = imgData ? readAnyCompliance(imgData) : undefined;
  return !!compliance?.isCompliant;
};

export function useInstantVideoCompliance({
  executeGenerateSceneVideo,
  videoApiPreviewMode,
  showApiPreview,
  replaceRequestUrlsWithAssetIds,
  buildAssetIdMapFromCharacters,
  saveCharacters,
  characters,
  scenes,
  segments,
  projectId,
}: {
  executeGenerateSceneVideo: (
    itemId: string,
    requestData: { mode: string; requestBody: any },
    assetIdMap?: Map<string, string>
  ) => Promise<void>;
  videoApiPreviewMode: boolean;
  showApiPreview: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
  replaceRequestUrlsWithAssetIds: (requestData: { mode: string; requestBody: any }, assetIdMap: Map<string, string>) => { mode: string; requestBody: any };
  buildAssetIdMapFromCharacters: (chars: InstantCharacter[], itemId?: string) => Map<string, string>;
  saveCharacters: (next: InstantCharacter[]) => void;
  characters: InstantCharacter[];
  scenes: InstantScene[];
  segments: InstantSegment[];
  projectId: string | undefined;
}) {
  const [complianceDialogOpen, setComplianceDialogOpen] = useState(false);
  const [complianceItemId, setComplianceItemId] = useState('');
  const [complianceRequestData, setComplianceRequestData] = useState<{ mode: string; requestBody: any } | null>(null);

  const hasUncompliantImages = useCallback(
    (itemId: string, canvasItems: CanvasItem[], characters: InstantCharacter[]): boolean => {
      const item = canvasItems.find((i) => i.id === itemId);
      if (!item) return false;

      // 首尾帧模式：只检查首尾帧图是否已合规（参考 EpisodeCard.tsx frameImages 分支）
      if (item.videoGenerationMode === 'first_last_frame') {
        const frames = [
          { imageUrl: item.firstFrameImageUrl, assetKey: item.firstFrameImageAssetId },
          { imageUrl: item.lastFrameImageUrl, assetKey: item.lastFrameImageAssetId },
        ].filter((f) => !!f.imageUrl && !!f.assetKey);
        return frames.some((f) => !getIsCompliant({ assetId: f.assetKey }));
      }

      const usedCharIds = new Set<string>();
      if (item.shots) {
        for (const shot of item.shots) {
          for (const match of shot.prompt.matchAll(/@<role\s+character-id="([^"]+)">/g)) {
            usedCharIds.add(match[1]);
          }
          for (const match of shot.prompt.matchAll(/@<role>([^<]*?)<\/role>/g)) {
            const char = characters.find((c) => c.name === match[1].trim());
            if (char) usedCharIds.add(char.id);
          }
          for (const char of characters) {
            const re = new RegExp(
              `@${char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![^<]*>)`,
              'g'
            );
            if (re.test(shot.prompt)) usedCharIds.add(char.id);
          }
        }
      }

      for (const charId of usedCharIds) {
        const char = characters.find((c) => c.id === charId);
        if (!char) continue;
        // 合规状态从 image_asset.data 缓存读取（assetId 为 image_asset UUID）
        const hasUncompliantAvatar = (char.avatarImages || []).some((img) => img.imageUrl && !getIsCompliant(img));
        const hasUncompliantFullBody = (char.fullBodyImages || []).some((img) => img.imageUrl && !getIsCompliant(img));
        const hasUncompliantPortrait = (char.portraitImages || []).some((img) => img.imageUrl && !getIsCompliant(img));
        if (hasUncompliantAvatar || hasUncompliantFullBody || hasUncompliantPortrait) {
          return true;
        }
      }
      return false;
    },
    []
  );

  // 通用：合规检查后不再修改 character 图片数据（合规状态在 image_asset.data 中）
  // 保留函数以兼容调用方，但不再设置 assetId / isCompliant
  const applyAssetIdToCharacters = useCallback(
    (chars: InstantCharacter[], _imageUrl: string, _assetId: string): InstantCharacter[] => {
      return chars;
    },
    []
  );

  // 批量：本次合规检查全部完成后，统一更新项目状态
  const handleCheckComplete = useCallback(
    async (
      successImages: Array<{
        characterId?: string;
        imageUrl: string;
        assetId?: string; // 火山 AIGC assetId（asset-xxx）
        assetKey?: string; // image_asset 行 UUID
        groupId?: string;
        url?: string;
      }>,
    ) => {
      // 1. 先保存 character 当前状态，确保新生成的 portrait/fullbody 行已持久化到
      //    creator_instant_assets，否则后续 patch seedance 会因找不到行而失败。
      const validImages = successImages.filter(
        (img): img is { characterId: string; imageUrl: string; assetId: string } =>
          !!img.assetId && !!img.characterId,
      );
      const hasValidImages = validImages.length > 0;

      let nextChars = characters;
      for (const img of validImages) {
        nextChars = applyAssetIdToCharacters(nextChars, img.imageUrl, img.assetId);
      }
      if (hasValidImages) {
        saveCharacters(nextChars);
      }

      if (projectId) {
        const saveSuccess = await saveInstantToServer(projectId, {
          instantCharacters: nextChars,
          instantScenes: scenes,
          instantSegments: segments,
        });
        if (!saveSuccess) {
          message.warning('角色数据保存失败，合规信息无法写入。请关闭弹窗后重新点击“生成视频”重试。');
          return;
        }
      }

      // 2. 持久化：把厂商合规结果写入 image_asset.data.seedance（creator_instant_assets），
      //    缓存由 patchImageAssetData 自动更新。这是合规状态唯一真相源，
      //    刷新后由 resolveImageAssets 重新加载缓存恢复。
      if (projectId) {
        console.log('[Instant handleCheckComplete] successImages:', successImages.map((img) => ({ assetId: img.assetId, assetKey: img.assetKey, imageUrl: img.imageUrl, characterId: img.characterId })));
        const valid = successImages.filter((img) => !!img.assetId && !!img.assetKey);
        console.log('[Instant handleCheckComplete] valid count:', valid.length);
        if (valid.length > 0) {
          const { buildSeedanceCompliance } = await import(
            '@/modules/workflow/providers/volcengine/compliance'
          );
          for (const img of valid) {
            try {
              const patch = buildSeedanceCompliance({
                assetId: img.assetId!,
                isCompliant: true,
                groupId: img.groupId,
                url: img.url,
              });
              console.log('[Instant handleCheckComplete] patching assetKey:', img.assetKey);
              const patchResult = await localApi.patchImageAssetData(projectId, img.assetKey!, patch);
              console.log('[Instant handleCheckComplete] patch result:', { assetKey: img.assetKey, patchResult });
              if (!patchResult.success || !patchResult.data?.updated) {
                console.warn('[Instant handleCheckComplete] 合规信息未写入数据库:', { assetKey: img.assetKey, patchResult });
                message.warning(`形象照合规信息保存失败（${img.assetKey}），刷新后可能丢失，请重试`);
              }
            } catch (e) {
              console.warn('[Instant handleCheckComplete] patchImageAssetData 异常:', img.assetKey, e);
            }
          }
        }
      }
    },
    [characters, scenes, segments, projectId, saveCharacters, applyAssetIdToCharacters],
  );

  const handleComplyAndGenerate = useCallback(
    async (assetIdMap: Map<string, string>) => {
      let nextChars = characters;
      if (assetIdMap && assetIdMap.size > 0) {
        assetIdMap.forEach((assetId, imageUrl) => {
          nextChars = applyAssetIdToCharacters(nextChars, imageUrl, assetId);
        });

        saveCharacters(nextChars);

        // 调试：确认合规状态是否已写入 nextChars
        try {
          console.log('[handleComplyAndGenerate] assetIdMap:', Array.from(assetIdMap.entries()));
          console.log('[handleComplyAndGenerate] nextChars sample:', nextChars.map(c => ({ id: c.id, avatarImages: c.avatarImages?.map(img => ({ imageUrl: img.imageUrl, assetId: img.assetId })) })));
        } catch (e) {
          console.log('[handleComplyAndGenerate] log error', e);
        }

        // 合规状态变更后，立即同步到服务器，避免仅依赖防抖保存导致刷新后状态丢失
        if (projectId) {
          const success = await saveInstantToServer(projectId, {
            instantCharacters: nextChars,
            instantScenes: scenes,
            instantSegments: segments,
          });
          console.log('[handleComplyAndGenerate] saveInstantToServer result:', success);
          if (!success) {
            message.warning('合规状态已更新，但自动保存到服务器失败，请稍后手动保存');
          }
        }
      }

      // 构建 imageUrl → 厂商合规 assetId 映射（从 image_asset.data 缓存读取）
      const updatedAssetIdMap = new Map<string, string>();
      for (const char of nextChars) {
        const allImages = [
          ...(char.avatarImages || []),
          ...(char.fullBodyImages || []),
          ...(char.portraitImages || []),
        ];
        for (const img of allImages) {
          if (img.assetId && img.imageUrl) {
            const imgData = localApi.getCachedImageData(img.assetId);
            const compliance = imgData ? readAnyCompliance(imgData) : undefined;
            if (compliance?.assetId) {
              updatedAssetIdMap.set(img.imageUrl, compliance.assetId);
            }
          }
        }
      }

      // 首尾帧模式：合规 patch 完成后从缓存重读首尾帧图合规 assetId（参考 workflowStore.episode.video.ts:223-233）
      if (complianceItemId) {
        const item = segments.flatMap((s) => s.canvasItems).find((i) => i.id === complianceItemId);
        if (item?.videoGenerationMode === 'first_last_frame') {
          for (const f of [
            { assetId: item.firstFrameImageAssetId, imageUrl: item.firstFrameImageUrl },
            { assetId: item.lastFrameImageAssetId, imageUrl: item.lastFrameImageUrl },
          ]) {
            if (!f.assetId || !f.imageUrl || updatedAssetIdMap.has(f.imageUrl)) continue;
            const imgData = localApi.getCachedImageData(f.assetId);
            const compliance = imgData ? readAnyCompliance(imgData) : undefined;
            if (compliance?.assetId) {
              updatedAssetIdMap.set(f.imageUrl, compliance.assetId);
            }
          }
        }
      }

      if (complianceItemId && complianceRequestData) {
        const replacedRequestData = updatedAssetIdMap.size > 0
          ? replaceRequestUrlsWithAssetIds(complianceRequestData, updatedAssetIdMap)
          : complianceRequestData;

        if (videoApiPreviewMode) {
          const { mode, requestBody } = replacedRequestData;
          let previewPromise: Promise<any>;
          if (mode === 'first_last_frame') {
            previewPromise = workflowApi.generateEpisodeVideoWithFramesApi(
              requestBody.episodeId,
              requestBody.videoPrompt,
              requestBody.firstFrameUrl,
              requestBody.lastFrameUrl,
              requestBody.model,
              requestBody.generateAudio,
              requestBody.ratio,
              requestBody.duration,
              { preview: true } as any
            );
          } else {
            previewPromise = workflowApi.generateEpisodeVideoWithReferencesApi(
              requestBody.episodeId,
              requestBody.videoPrompt,
              requestBody.referenceImageUrls,
              requestBody.model,
              requestBody.ratio,
              requestBody.duration,
              { preview: true } as any
            );
          }
          showApiPreview('视频生成请求预览', previewPromise, replacedRequestData, () =>
            executeGenerateSceneVideo(complianceItemId, replacedRequestData, updatedAssetIdMap)
          );
        } else {
          await executeGenerateSceneVideo(complianceItemId, replacedRequestData, updatedAssetIdMap);
        }
      }

      setComplianceDialogOpen(false);
      setComplianceItemId('');
      setComplianceRequestData(null);
    },
    [characters, scenes, segments, projectId, complianceItemId, complianceRequestData, executeGenerateSceneVideo, videoApiPreviewMode, showApiPreview, replaceRequestUrlsWithAssetIds, buildAssetIdMapFromCharacters, saveCharacters]
  );

  return {
    complianceDialogOpen,
    setComplianceDialogOpen,
    complianceItemId,
    setComplianceItemId,
    complianceRequestData,
    setComplianceRequestData,
    hasUncompliantImages,
    handleComplyAndGenerate,
    handleCheckComplete,
  };
}
