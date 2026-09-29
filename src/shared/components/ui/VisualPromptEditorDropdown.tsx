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

import React, { useMemo } from 'react';
import { User, Image as ImageIcon, ChevronDown, ChevronRight, Film, Music } from 'lucide-react';
import { getCharImage, getSceneImage, getPortraits, refAssetDisplayName } from './visualPromptEditorUtils';
import { useResolvedImageUrls } from '@/modules/workflow/hooks/useWorkflowImageResolver';
import type { ShotReferenceAsset } from '../../types';

interface VisualPromptEditorDropdownProps {
  dropdownMode: 'role' | 'scene' | 'asset' | 'role_asset' | null;
  dropdownPos: { left: number; top: number };
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  filteredChars: any[];
  filteredScenes: any[];
  characters: any[];
  /** 参考附件（asset 模式列表数据） */
  referenceAssets?: ShotReferenceAsset[];
  /** 过滤后的参考附件 */
  filteredAssets?: ShotReferenceAsset[];
  expandedCharId: string | null;
  setExpandedCharId: (id: string | null) => void;
  insertTag: (type: 'role' | 'scene' | 'portrait' | 'asset', name: string, imageUrl: string, sourceId: string, portraitIdx?: number, assetType?: string) => void;
}

/**
 * VisualPromptEditor 的下拉选择弹层：角色 / 场景 / 形象照 / 参考附件
 */
export const VisualPromptEditorDropdown: React.FC<VisualPromptEditorDropdownProps> = ({
  dropdownMode,
  dropdownPos,
  dropdownRef,
  filteredChars,
  filteredScenes,
  characters,
  referenceAssets,
  filteredAssets,
  expandedCharId,
  setExpandedCharId,
  insertTag,
}) => {
  // 批量解析角色/场景图片资产（优先 assetId，回退 imageUrl）
  const allAssetIds = useMemo(() => {
    const ids: string[] = [];
    filteredChars.forEach((char) => {
      char.avatarImages?.forEach((img: any) => { if (img?.assetId) ids.push(img.assetId); });
      char.multiViewImages?.forEach((img: any) => { if (img?.assetId) ids.push(img.assetId); });
      char.fullBodyImages?.forEach((img: any) => { if (img?.assetId) ids.push(img.assetId); });
    });
    filteredScenes.forEach((scene) => {
      scene.imageAssetIds?.forEach((id: string) => { if (id) ids.push(id); });
    });
    return ids;
  }, [filteredChars, filteredScenes]);
  const { getUrl } = useResolvedImageUrls(allAssetIds);

  const resolveCharImage = (char: any) => {
    const avatarAssetId = char?.avatarImages?.[char?.currentAvatarIndex || 0]?.assetId;
    if (avatarAssetId) return getUrl(avatarAssetId) || getCharImage(char);
    const multiViewAssetId = char?.multiViewImages?.[0]?.assetId;
    if (multiViewAssetId) return getUrl(multiViewAssetId) || getCharImage(char);
    const fullBodyAssetId = char?.fullBodyImages?.[0]?.assetId;
    if (fullBodyAssetId) return getUrl(fullBodyAssetId) || getCharImage(char);
    return getCharImage(char);
  };

  const resolvePortraitImage = (portrait: any) => {
    if (portrait?.assetId) return getUrl(portrait.assetId) || portrait.imageUrl || '';
    return portrait?.imageUrl || '';
  };

  const resolveSceneImage = (scene: any) => {
    if (scene?.imageAssetIds?.[0]) return getUrl(scene.imageAssetIds[0]) || getSceneImage(scene);
    return getSceneImage(scene);
  };

  // 参考附件列表渲染（asset 模式与 role_asset 模式复用）
  const renderAssetItems = () => {
    const assets = filteredAssets || [];
    if (assets.length === 0) {
      return (
        <div className="px-3 py-2 text-sm text-text-muted">
          {(referenceAssets || []).length === 0 ? '请先上传参考附件' : '无匹配附件'}
        </div>
      );
    }
    return assets.map((asset, i) => {
      const displayName = refAssetDisplayName(referenceAssets || [], asset);
      return (
        <div
          key={`${asset.assetId}-${i}`}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            insertTag('asset', displayName, asset.type === 'image' ? asset.assetId : '', asset.assetId, undefined, asset.type);
          }}
          onClick={(e) => {
            e.stopPropagation();
            insertTag('asset', displayName, asset.type === 'image' ? asset.assetId : '', asset.assetId, undefined, asset.type);
          }}
          className="flex items-center gap-3 px-3 py-2 hover:bg-bg-tertiary cursor-pointer"
        >
          {asset.type === 'image' ? (
            <img src={asset.assetId} alt={displayName} className="w-10 h-6 rounded object-cover" />
          ) : (
            <div className="w-10 h-6 rounded bg-amber-500/20 flex items-center justify-center">
              {asset.type === 'video' ? (
                <Film size={14} className="text-amber-600" />
              ) : (
                <Music size={14} className="text-amber-600" />
              )}
            </div>
          )}
          <span className="text-sm text-text-primary flex-1 truncate">{displayName}</span>
          <span className="text-[10px] text-text-muted truncate max-w-[100px]">{asset.name || ''}</span>
        </div>
      );
    });
  };

  return (
    <div
      ref={dropdownRef}
      className="absolute z-50 bg-bg-secondary border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto min-w-[160px]"
      style={{ left: dropdownPos.left, top: dropdownPos.top }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {(dropdownMode === 'role' || dropdownMode === 'role_asset') ? (
        <>
        {filteredChars.length > 0 ? (
          filteredChars.map((char) => {
            const isExpanded = expandedCharId === char.id;
            const portraits = getPortraits(char);
            return (
              <div key={char.id}>
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    insertTag('role', char.name, resolveCharImage(char), char.id);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    insertTag('role', char.name, resolveCharImage(char), char.id);
                  }}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-bg-tertiary cursor-pointer group"
                >
                  {resolveCharImage(char) ? (
                    <img
                      src={resolveCharImage(char)}
                      alt={char.name}
                      className="w-6 h-6 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-accent-primary/20 flex items-center justify-center">
                      <User size={12} className="text-accent-primary" />
                    </div>
                  )}
                  <span className="text-sm text-text-primary flex-1">{char.name}</span>
                  {portraits.length > 0 && (
                    <button
                      className="p-1 rounded hover:bg-bg-secondary opacity-0 group-hover:opacity-100 transition-opacity"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setExpandedCharId(isExpanded ? null : char.id);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedCharId(isExpanded ? null : char.id);
                      }}
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                </div>
                {isExpanded && portraits.map((portrait: any, idx: number) => (
                  <div
                    key={`${char.id}-portrait-${idx}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      insertTag('portrait', portrait.name, resolvePortraitImage(portrait), char.id, idx);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      insertTag('portrait', portrait.name, resolvePortraitImage(portrait), char.id, idx);
                    }}
                    className="flex items-center gap-3 px-3 py-1.5 pl-10 hover:bg-bg-tertiary cursor-pointer"
                  >
                    {resolvePortraitImage(portrait) ? (
                      <img
                        src={resolvePortraitImage(portrait)}
                        alt={portrait.name}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center">
                        <ImageIcon size={10} className="text-purple-400" />
                      </div>
                    )}
                    <span className="text-sm text-text-primary">{portrait.name}</span>
                  </div>
                ))}
              </div>
            );
          })
        ) : (
          <div className="px-3 py-2 text-sm text-text-muted">
            {characters.length === 0 ? '请先添加角色' : '无匹配人物'}
          </div>
        )}
        {dropdownMode === 'role_asset' && (
          <>
            <div className="border-t border-border my-1" />
            <div className="px-3 py-1 text-[10px] text-text-muted">参考附件</div>
            {renderAssetItems()}
          </>
        )}
        </>
      ) : dropdownMode === 'asset' ? (
        renderAssetItems()
      ) : filteredScenes.length > 0 ? (
        filteredScenes.map((scene) => (
          <div
            key={scene.id}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              insertTag('scene', scene.name, resolveSceneImage(scene), scene.id);
            }}
            onClick={(e) => {
              e.stopPropagation();
              insertTag('scene', scene.name, resolveSceneImage(scene), scene.id);
            }}
            className="flex items-center gap-3 px-3 py-2 hover:bg-bg-tertiary cursor-pointer"
          >
            {resolveSceneImage(scene) ? (
              <img
                src={resolveSceneImage(scene)}
                alt={scene.name}
                className="w-10 h-6 rounded object-cover"
              />
            ) : (
              <div className="w-10 h-6 rounded bg-emerald-500/20 flex items-center justify-center">
                <ImageIcon size={14} className="text-emerald-400" />
              </div>
            )}
            <span className="text-sm text-text-primary">{scene.name}</span>
          </div>
        ))
      ) : (
        <div className="px-3 py-2 text-sm text-text-muted">无匹配场景</div>
      )}
    </div>
  );
};
