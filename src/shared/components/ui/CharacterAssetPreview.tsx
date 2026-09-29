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

import { useEffect, useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Spin } from 'antd';
import type { Character } from '@/shared/types';
import { useAssetImageResolver } from '@/modules/workflow/hooks/useAssetImageResolver';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { localApi } from '@/storage';
import { readAnyCompliance } from '@/modules/workflow/providers/compliance-factory';

/** 从 localApi 缓存读取图片合规状态 */
const getIsCompliant = (img: any): boolean => {
  if (!img?.assetId) return false;
  const imgData = localApi.getCachedImageData(img.assetId);
  const compliance = imgData ? readAnyCompliance(imgData) : undefined;
  return !!compliance?.isCompliant;
};

interface CharacterAssetPreviewProps {
  character: Character;
  projectId?: string;
  onPreview: (images: string[], index: number, title: string) => void;
}

/**
 * 角色资产预览卡片——剧本分解确认弹窗中使用
 *
 * 展示：头像 + 名称/简介 + 多视图(16:9) + 形象照(9:16)
 * 未生成时显示"待生成"占位，生成中显示 Spin。
 * 图片优先从 assetId 解析，解析失败时回退到已缓存的 imageUrl。
 */
export const CharacterAssetPreview: React.FC<CharacterAssetPreviewProps> = ({
  character,
  projectId,
  onPreview,
}) => {
  const currentEpisodeNumber = useWorkflowStore((state) => state.currentEpisodeNumber);
  const portraitSlots = (character.fullBodyImages || [])
    .filter((img) => img.episodeNumber === undefined || img.episodeNumber === currentEpisodeNumber);
  const hasAnyPortrait = portraitSlots.some((img) => img.imageUrl || img.isGenerating);
  const avatarImg = character.avatarImages?.[0];
  const multiViewImg = character.multiViewImages?.[0];

  const { resolve, getUrl } = useAssetImageResolver({ projectId });

  // 收集所有需要解析的 assetId
  const assetIds = useMemo(() => {
    const ids: string[] = [];
    if (avatarImg?.assetId) ids.push(avatarImg.assetId);
    if (multiViewImg?.assetId) ids.push(multiViewImg.assetId);
    for (const slot of portraitSlots) {
      if (slot.assetId) ids.push(slot.assetId);
    }
    return ids;
  }, [avatarImg, multiViewImg, portraitSlots]);

  useEffect(() => {
    if (assetIds.length > 0) {
      resolve(assetIds).catch((e) => console.warn('[CharacterAssetPreview] 解析图片失败:', e));
    }
  }, [assetIds, resolve]);

  // 优先使用解析后的 URL，未解析成功则回退到 imageUrl
  const avatarUrl = getUrl(avatarImg?.assetId) || avatarImg?.imageUrl || '';
  const multiViewUrl = getUrl(multiViewImg?.assetId) || multiViewImg?.imageUrl || '';
  const resolvedPortraitSlots = portraitSlots.map((slot) => ({
    ...slot,
    resolvedUrl: getUrl(slot.assetId) || slot.imageUrl || '',
  }));

  return (
    <div className="bg-bg-tertiary rounded-lg p-3 space-y-2">
      {/* 第一行：头像 + 名称 + 简介 */}
      <div className="flex items-start gap-3">
        {avatarUrl ? (
          <div className="relative flex-shrink-0">
            <img
              src={avatarUrl}
              alt={`${character.name}头像`}
              className="w-14 h-14 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => onPreview([avatarUrl], 0, `${character.name} - 头像`)}
            />
            {getIsCompliant(avatarImg) && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-accent-success rounded-full flex items-center justify-center shadow-sm">
                <CheckCircle2 size={12} className="text-white" />
              </div>
            )}
            {character.avatarSource === 'asset' ? (
              <div className="absolute -bottom-1 -left-1 px-1 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded shadow-sm">
                真人
              </div>
            ) : character.avatarSource === 'upload' ? (
              <div className="absolute -bottom-1 -left-1 px-1 py-0.5 bg-blue-500 text-white text-[10px] font-bold rounded shadow-sm">
                上传
              </div>
            ) : character.avatarSource === 'generated' ? (
              <div className="absolute -bottom-1 -left-1 px-1 py-0.5 bg-purple-500 text-white text-[10px] font-bold rounded shadow-sm">
                虚拟
              </div>
            ) : null}
          </div>
        ) : (
          <div className="w-14 h-14 rounded bg-bg-secondary flex-shrink-0 flex items-center justify-center text-[10px] text-text-muted">
            待生成
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary truncate">{character.name}</div>
          <div className="text-xs text-text-secondary line-clamp-2 mt-0.5">
            {character.description || '暂无描述'}
          </div>
        </div>
      </div>

      {/* 第二行：多视图(16:9) + 形象照(9:16) */}
      <div className="flex items-start gap-2">
        {/* 多视图 */}
        <div className="flex-shrink-0">
          <div className="text-[10px] text-text-muted mb-1">多视图</div>
          {multiViewUrl ? (
            <div className="relative">
              <img
                src={multiViewUrl}
                alt={`${character.name}多视图`}
                className="h-20 aspect-video object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() =>
                  onPreview([multiViewUrl], 0, `${character.name} - 多视图`)
                }
              />
              {getIsCompliant(multiViewImg) && (
                <div className="absolute top-0 right-0 w-5 h-5 bg-accent-success rounded-full flex items-center justify-center shadow-sm">
                  <CheckCircle2 size={12} className="text-white" />
                </div>
              )}
            </div>
          ) : (
            <div
              className="h-20 bg-bg-secondary rounded flex items-center justify-center text-[10px] text-text-muted"
              style={{ aspectRatio: '16/9' }}
            >
              待生成
            </div>
          )}
        </div>

        {/* 形象照 */}
        {hasAnyPortrait ? (
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-text-muted mb-1">形象照</div>
            <div className="flex gap-1.5 flex-wrap">
              {resolvedPortraitSlots.map((slot, idx) => {
                if (slot.resolvedUrl) {
                  return (
                    <div key={idx} className="relative">
                      <img
                        src={slot.resolvedUrl}
                        alt={`${character.name}形象照${idx + 1}`}
                        className="h-20 aspect-[9/16] object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => {
                          const urls = resolvedPortraitSlots
                            .filter((s) => s.resolvedUrl)
                            .map((s) => s.resolvedUrl);
                          const imageIdx =
                            resolvedPortraitSlots.slice(0, idx + 1).filter((s) => s.resolvedUrl).length - 1;
                          onPreview(urls, imageIdx, `${character.name} - 形象照`);
                        }}
                      />
                      {getIsCompliant(slot) && (
                        <div className="absolute top-0 right-0 w-5 h-5 bg-accent-success rounded-full flex items-center justify-center shadow-sm">
                          <CheckCircle2 size={12} className="text-white" />
                        </div>
                      )}
                    </div>
                  );
                }
                if (slot.isGenerating) {
                  return (
                    <div
                      key={idx}
                      className="h-20 aspect-[9/16] bg-bg-secondary rounded flex items-center justify-center"
                    >
                      <Spin size="small" />
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1">
            <div className="text-[10px] text-text-muted mb-1">形象照</div>
            <div className="h-20 aspect-[9/16] bg-bg-secondary rounded flex items-center justify-center text-[10px] text-text-muted">
              待生成
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
