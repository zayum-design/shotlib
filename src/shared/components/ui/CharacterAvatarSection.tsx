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

import React from 'react';
import { Button, Input, Select, Spin, Tooltip } from 'antd';
import { Image as ImageIcon, ZoomIn, Upload } from 'lucide-react';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import type { Character } from '@/shared/types';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { useResolvedImageUrl } from '@/modules/workflow/hooks/useWorkflowImageResolver';

interface ImageModel {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
}

interface CharacterAvatarSectionProps {
  character: Character;
  firstAvatarIndex: number;
  imageModels: ImageModel[];
  onUpdateCharacter: (id: string, data: Partial<Character>) => void;
  onModelChange: (model: string) => void;
  onGenerateAvatar: () => void;
  onOpenAvatarUpload: () => void;
  onAvatarPreview: () => void;
}

/**
 * 角色头像 + 名称/描述/模型选择/生成按钮（左侧上半部分）
 */
export const CharacterAvatarSection: React.FC<CharacterAvatarSectionProps> = ({
  character,
  firstAvatarIndex,
  imageModels,
  onUpdateCharacter,
  onModelChange,
  onGenerateAvatar,
  onOpenAvatarUpload,
  onAvatarPreview,
}) => {
  // 新增角标：isNew 是项目级标记，仅对第2集+且属于当前分集活跃集的角色显示——
  // 第1集作为首集不应出现「新增」角标，也避免第2集新增角色的角标串到第1集视图
  const { activeCharacterIds, currentEpisodeNumber } = useWorkflowStore();
  const showNewBadge =
    !!character.isNew &&
    (currentEpisodeNumber ?? 1) > 1 &&
    (!activeCharacterIds?.length || activeCharacterIds.includes(character.id));

  const currentAvatarUrl = character.avatarImages?.[firstAvatarIndex]?.imageUrl;
  const resolvedAvatarUrl = useResolvedImageUrl(undefined, currentAvatarUrl);

  return (
    <div className="flex items-start gap-4 mb-4">
      {/* 头像预览 */}
      <div
        className="relative w-24 h-24 rounded-lg overflow-hidden bg-bg-tertiary flex-shrink-0 group cursor-pointer"
        onClick={onAvatarPreview}
      >
        {/* 右上角标签 */}
        <div className="absolute top-1 right-1 z-20 flex flex-col gap-1 items-end">
          {showNewBadge && (
            <span className="px-1.5 py-0.5 bg-accent-primary text-white text-[10px] font-bold rounded shadow-sm">
              新增
            </span>
          )}
        </div>
        {character.avatarSource === 'asset' ? (
          character.avatarImages?.[firstAvatarIndex]?.assetType === 'character' ? (
            <div className="absolute bottom-1 left-1 z-20 px-1.5 py-0.5 bg-emerald-500 text-white text-[10px] font-bold rounded shadow-sm">
              素材
            </div>
          ) : (
            <div className="absolute bottom-1 left-1 z-20 px-1.5 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded shadow-sm">
              真人
            </div>
          )
        ) : character.avatarSource === 'upload' ? (
          <div className="absolute bottom-1 left-1 z-20 px-1.5 py-0.5 bg-blue-500 text-white text-[10px] font-bold rounded shadow-sm">
            上传
          </div>
        ) : character.avatarSource === 'generated' ? (
          <div className="absolute bottom-1 left-1 z-20 px-1.5 py-0.5 bg-purple-500 text-white text-[10px] font-bold rounded shadow-sm">
            虚拟
          </div>
        ) : null}
        {character.isGeneratingAvatar ? (
          <div className="w-full h-full flex items-center justify-center">
            <Spin />
          </div>
        ) : resolvedAvatarUrl ? (
          <>
            <img
              src={resolvedAvatarUrl}
              alt={character.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <ZoomIn size={20} className="text-white" />
            </div>
          </>
        ) : character.gender === '女' ? (
          <div className="w-full h-full flex items-center justify-center text-pink-400">
            <span className="text-3xl">♀</span>
          </div>
        ) : character.gender === '男' ? (
          <div className="w-full h-full flex items-center justify-center text-blue-400">
            <span className="text-3xl">♂</span>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted">
            <ImageIcon size={24} />
          </div>
        )}
      </div>

      {/* 角色信息 */}
      <div className="flex-1 min-w-0 space-y-2">
        <Input
          value={character.name}
          onChange={(e) => onUpdateCharacter(character.id, { name: e.target.value })}
          className="text-base font-semibold bg-transparent border-border"
          placeholder="角色名称"
        />
        <Input
          value={character.description}
          onChange={(e) => onUpdateCharacter(character.id, { description: e.target.value })}
          className="text-sm text-text-secondary bg-transparent border-border"
          placeholder="角色描述"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-muted whitespace-nowrap">图片模型:</span>
          <Select
            value={character.model}
            onChange={onModelChange}
            options={imageModels.map((m) => ({
              value: m.id,
              label: (
                <Tooltip title={m.description}>
                  <span>{m.name}</span>
                </Tooltip>
              ),
              disabled: m.disabled,
            }))}
            size="small" popupMatchSelectWidth={false} />
          <ModelPriceTag model={imageModels.find(m => m.id === character.model)} />
          <Button
            onClick={onGenerateAvatar}
            loading={character.isGeneratingAvatar}
            icon={<ImageIcon size={14} />}
            size="small"
            className="bg-accent-primary text-white"
          >
            {character.avatarImages && character.avatarImages.length > 0 ? '重生成头像' : '生成头像'}
          </Button>
          <Tooltip title="本地上传头像">
            <Button
              onClick={onOpenAvatarUpload}
              icon={<Upload size={14} />}
              size="small"
              className="text-text-secondary border-border"
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
