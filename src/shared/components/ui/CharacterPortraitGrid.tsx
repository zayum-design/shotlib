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

import React, { useState } from 'react';
import { Tooltip, Spin, Modal, Input } from 'antd';
import { RefreshCw, Image as ImageIcon, Plus, Trash2, Check } from 'lucide-react';
import type { Character } from '@/shared/types';
import { useResolvedImageUrls } from '@/modules/workflow/hooks/useWorkflowImageResolver';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { localApi } from '@/storage';
import { readAnyCompliance } from '@/modules/workflow/providers/compliance-factory';
import { assetDropTarget, type DraggedProjectAsset } from '@/shared/utils/assetDragDrop';
import { message } from '@/shared/utils/message';

/** 从缓存读取图片合规状态 */
const getIsCompliant = (assetId?: string): boolean => {
  if (!assetId) return false;
  const imgData = localApi.getCachedImageData(assetId);
  const compliance = imgData ? readAnyCompliance(imgData) : undefined;
  return !!compliance?.isCompliant;
};

interface CharacterPortraitGridProps {
  character: Character;
  onOpenPortraitDialog: (actualIndex?: number) => void;
  onRemovePortrait: (actualIndex: number) => void;
  onPreviewPortrait: (actualIndex: number) => void;
}

/**
 * 角色形象照网格：9 张形象照展示 + 添加按钮
 * 按当前分集过滤，只展示属于当前分集的形象照。
 */
export const CharacterPortraitGrid: React.FC<CharacterPortraitGridProps> = ({
  character,
  onOpenPortraitDialog,
  onRemovePortrait,
  onPreviewPortrait,
}) => {
  const currentEpisodeNumber = useWorkflowStore((state) => state.currentEpisodeNumber);
  const updateCharacter = useWorkflowStore((state) => state.updateCharacter);

  // 形象照名称编辑：双击名称进入编辑，点对号（或回车）保存
  const [editingNameIndex, setEditingNameIndex] = useState<number | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

  const handleStartEditName = (actualIndex: number, currentName: string) => {
    setEditingNameIndex(actualIndex);
    setEditingNameValue(currentName);
  };

  const handleSaveName = (actualIndex: number) => {
    const newName = editingNameValue.trim();
    if (!newName) {
      message.warning('形象照名称不能为空');
      return;
    }
    const images = [...(character.fullBodyImages || [])];
    if (!images[actualIndex]) return;
    if (images[actualIndex].name === newName) {
      setEditingNameIndex(null);
      return;
    }
    // 同一角色下形象照名不得重复（名称会用于分镜提示词的形象照引用匹配）
    const duplicated = images.some(
      (img, idx) => idx !== actualIndex && img?.isPortrait !== false && img?.name === newName,
    );
    if (duplicated) {
      message.warning(`已存在同名形象照「${newName}」，请换一个名称`);
      return;
    }
    images[actualIndex] = { ...images[actualIndex], name: newName };
    updateCharacter(character.id, { fullBodyImages: images });
    setEditingNameIndex(null);
    message.success('形象照名称已更新');
  };

  // 从项目资产库拖入替换指定槽位形象照（保留槽位元数据 name/prompt/episodeNumber）
  const handleDropToSlot = (actualIndex: number, asset: DraggedProjectAsset) => {
    const images = [...(character.fullBodyImages || [])];
    if (!images[actualIndex]) return;
    images[actualIndex] = { ...images[actualIndex], assetId: asset.assetId, imageUrl: asset.url, isGenerating: false };
    updateCharacter(character.id, { fullBodyImages: images });
    message.success('已从资产库替换形象照');
  };

  // 从项目资产库拖入到「添加」按钮：追加新形象照槽位
  const handleDropToAdd = (asset: DraggedProjectAsset) => {
    const images = [...(character.fullBodyImages || [])];
    if (images.length >= 9) return;
    images.push({
      assetId: asset.assetId,
      imageUrl: asset.url,
      name: `形象照${images.length + 1}`,
      isPortrait: true,
      isGenerating: false,
      episodeNumber: currentEpisodeNumber,
    } as any);
    updateCharacter(character.id, { fullBodyImages: images });
    message.success('已从资产库添加形象照');
  };


  // 按当前分集过滤形象照，保留真实索引用于回调
  const portraitItems = (character.fullBodyImages || [])
    .map((img, index) => ({ img, actualIndex: index }))
    .filter(({ img }) => {
      // 未标记分集的旧数据默认显示（兼容已有项目）
      return img.episodeNumber === undefined || img.episodeNumber === currentEpisodeNumber;
    });

  // 历史分集的形象照（有图）：仅早于当前分集的可复用到当前分集；
  // 第1集没有历史分集，不展示复用区；后续分集的形象照对当前集是"未来"而非"历史"，也不展示
  // 复用 = 追加一条 episodeNumber=当前分集的副本（共享同一 assetId/imageUrl），
  // 原分集的形象照保持不变；副本即成为本集形象照，视频生成/提示词标记自然可用
  const reusableItems = (character.fullBodyImages || [])
    .map((img, index) => ({ img, actualIndex: index }))
    .filter(({ img }) =>
      img.episodeNumber !== undefined &&
      img.episodeNumber < currentEpisodeNumber &&
      img.isPortrait !== false &&
      !!(img.imageUrl || img.assetId),
    );

  const canAddPortrait = portraitItems.length < 9;

  // 复用历史形象照到当前分集
  const handleReusePortrait = (img: NonNullable<Character['fullBodyImages']>[number]) => {
    const images = [...(character.fullBodyImages || [])];
    if (!canAddPortrait) {
      message.warning('本集形象照已达 9 张上限，请先删除后再复用');
      return;
    }
    const name = img.name || '形象照';
    // 同一角色同一分集下形象照名不得重复（名称用于分镜提示词的形象照引用匹配）
    const duplicated = images.some(
      (x) =>
        x?.isPortrait !== false &&
        x?.name === name &&
        (x.episodeNumber === undefined || x.episodeNumber === currentEpisodeNumber),
    );
    if (duplicated) {
      message.warning(`本集已存在同名形象照「${name}」`);
      return;
    }
    images.push({ ...img, isGenerating: false, episodeNumber: currentEpisodeNumber });
    updateCharacter(character.id, { fullBodyImages: images });
    message.success(`已复用形象照「${name}」到本集`);
  };

  const portraitImages = [...portraitItems, ...reusableItems].map(({ img }) => img);
  const { getUrl } = useResolvedImageUrls(portraitImages.map((img) => img.assetId));

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-text-muted">形象照</span>
        <span className="text-xs text-text-muted">
          ({portraitItems.length}/9)
        </span>
      </div>
      {/* 固定 5 列，条目尺寸不随数量变化 */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
      >
        {portraitItems.map(({ img, actualIndex }, displayIndex) => {
          const resolvedUrl = getUrl(img.assetId) || img.imageUrl || '';
          return (
            <div key={`portrait-${actualIndex}`} className="flex flex-col items-center gap-1 min-w-0">
              <div
                className="relative w-full rounded-lg overflow-hidden bg-bg-tertiary flex-shrink-0 group cursor-pointer border border-border"
                style={{ aspectRatio: '16/9' }}
                onClick={() => resolvedUrl ? onPreviewPortrait(actualIndex) : undefined}
                {...assetDropTarget(['character_image'], '形象照', (asset) => handleDropToSlot(actualIndex, asset))}
              >
                {resolvedUrl && getIsCompliant(img.assetId) && (
                  <Tooltip title="已通过合规检查">
                    <div className="absolute top-1 right-1 z-20 w-3 h-3 bg-cyan-500 text-white rounded-full flex items-center justify-center shadow-sm">
                      <Check size={8} strokeWidth={4} />
                    </div>
                  </Tooltip>
                )}
                {resolvedUrl ? (
                  <img
                    src={resolvedUrl}
                    alt={img.name || `形象照 ${displayIndex + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : img.isGenerating ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
                    <Spin size="small" />
                    <span className="text-xs text-text-muted">生成中...</span>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
                    <ImageIcon size={28} className="text-text-muted" />
                    <span className="text-xs text-text-muted truncate px-1.5 max-w-full">
                      {img.name || '未生成'}
                    </span>
                  </div>
                )}
                {/* hover 操作按钮 */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenPortraitDialog(actualIndex);
                    }}
                    className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/40"
                    title={resolvedUrl ? '重新生成' : '生成图片'}
                  >
                    <RefreshCw size={10} className="text-white" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      Modal.confirm({
                        title: '删除形象照',
                        content: `确定要删除形象照「${img.name || `形象照${displayIndex + 1}`}」吗？`,
                        okText: '删除',
                        okType: 'danger',
                        cancelText: '取消',
                        onOk: () => onRemovePortrait(actualIndex),
                      });
                    }}
                    className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/40"
                    title="删除"
                  >
                    <Trash2 size={10} className="text-white" />
                  </button>
                </div>
              </div>
              {/* 形象照名称：双击进入编辑，对号/回车保存，Esc 取消 */}
              {editingNameIndex === actualIndex ? (
                <div className="flex items-center gap-0.5 w-full">
                  <Input
                    size="small"
                    value={editingNameValue}
                    autoFocus
                    onChange={(e) => setEditingNameValue(e.target.value)}
                    onPressEnter={() => handleSaveName(actualIndex)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingNameIndex(null);
                    }}
                    className="text-xs"
                    maxLength={20}
                  />
                  <button
                    onClick={() => handleSaveName(actualIndex)}
                    className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-primary/20 flex items-center justify-center hover:bg-accent-primary/40"
                    title="保存"
                  >
                    <Check size={12} className="text-accent-primary" />
                  </button>
                </div>
              ) : (
                <span
                  className="text-xs text-text-secondary text-center truncate w-full cursor-text hover:text-accent-primary"
                  title={`${img.name || ''}（双击编辑）`}
                  onDoubleClick={() => handleStartEditName(actualIndex, img.name || `形象照${displayIndex + 1}`)}
                >
                  {img.name || `形象照${displayIndex + 1}`}
                </span>
              )}
            </div>
          );
        })}
        {/* Add 按钮 */}
        {canAddPortrait && (
          <div key="add-portrait" className="flex flex-col items-center gap-1 min-w-0">
            <button
              onClick={() => onOpenPortraitDialog()}
              className="w-full rounded-lg border-2 border-dashed border-border hover:border-accent-primary/60 flex items-center justify-center text-text-muted hover:text-accent-primary transition-colors bg-bg-tertiary/50"
              style={{ aspectRatio: '16/9' }}
              title="添加形象照"
              {...assetDropTarget(['character_image'], '形象照', handleDropToAdd)}
            >
              <Plus size={20} />
            </button>
            <span className="text-xs text-text-muted text-center w-full">添加</span>
          </div>
        )}
      </div>

      {/* 复用历史形象照：其他分集已生成的形象照，一键复制到本集 */}
      {reusableItems.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-text-muted">复用历史形象照</span>
            <span className="text-xs text-text-muted">（{reusableItems.length}）</span>
          </div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
          >
            {reusableItems.map(({ img, actualIndex }) => {
              const resolvedUrl = getUrl(img.assetId) || img.imageUrl || '';
              return (
                <div key={`reusable-${actualIndex}`} className="flex flex-col items-center gap-1 min-w-0">
                  <div
                    className="relative w-full rounded-lg overflow-hidden bg-bg-tertiary flex-shrink-0 group cursor-pointer border border-border"
                    style={{ aspectRatio: '16/9' }}
                    onClick={() => resolvedUrl ? onPreviewPortrait(actualIndex) : undefined}
                  >
                    {/* 来源分集角标 */}
                    <span className="absolute top-1 left-1 z-20 text-[9px] leading-none px-1 py-0.5 rounded bg-black/60 text-white pointer-events-none">
                      第{img.episodeNumber}集
                    </span>
                    {resolvedUrl ? (
                      <img
                        src={resolvedUrl}
                        alt={img.name || '形象照'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon size={28} className="text-text-muted" />
                      </div>
                    )}
                    {/* hover 复用按钮 */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReusePortrait(img);
                        }}
                        className="px-2 h-6 rounded-full bg-accent-primary text-white text-[10px] font-medium flex items-center justify-center hover:bg-accent-primary/85"
                        title="复制此形象照到当前分集"
                      >
                        复用到本集
                      </button>
                    </div>
                  </div>
                  <span className="text-xs text-text-secondary text-center truncate w-full">
                    {img.name || '形象照'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
