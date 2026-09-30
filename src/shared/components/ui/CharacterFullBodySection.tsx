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
import { Button, Select, Tooltip, Spin } from 'antd';
import { RefreshCw, Image as ImageIcon, ZoomIn, Upload } from 'lucide-react';
import type { Character } from '@/shared/types';
import { FULL_BODY_LABELS } from '@/shared/types';
import { useResolvedImageUrl } from '@/modules/workflow/hooks/useWorkflowImageResolver';

interface ImageModel {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
}

interface CharacterFullBodySectionProps {
  character: Character;
  fullBodyImage: Character['fullBodyImages'] extends (infer U)[] | undefined ? U : never;
  hasFullBody: boolean;
  isGeneratingFullBody: boolean;
  imageModels: ImageModel[];
  selectedViewsModel: string;
  setSelectedViewsModel: (v: string) => void;
  fullbodyFileInputRef: React.RefObject<HTMLInputElement | null>;
  onGenerateViews: () => void;
  onRegenerateFullBody: () => void;
  onFullbodyUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFullBodyPreview: () => void;
}

/**
 * 角色右侧全身照区：图片展示 + 模型选择 + 操作按钮
 */
export const CharacterFullBodySection: React.FC<CharacterFullBodySectionProps> = ({
  character,
  fullBodyImage,
  hasFullBody,
  isGeneratingFullBody,
  imageModels,
  selectedViewsModel,
  setSelectedViewsModel,
  fullbodyFileInputRef,
  onGenerateViews,
  onRegenerateFullBody,
  onFullbodyUpload,
  onFullBodyPreview,
}) => {
  const resolvedFullBodyUrl = useResolvedImageUrl(fullBodyImage?.assetId, fullBodyImage?.imageUrl);
  const hasFullBodyResolved = !!resolvedFullBodyUrl;

  return (
    <>
      <div
        className="aspect-video w-full rounded-lg bg-bg-tertiary overflow-hidden relative cursor-pointer border border-border group"
        onClick={() => hasFullBodyResolved && onFullBodyPreview()}
      >
        {isGeneratingFullBody ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 z-10">
            <Spin size="default" />
            <span className="mt-2 text-xs text-white">生成中...</span>
          </div>
        ) : hasFullBodyResolved ? (
          <>            <img
              src={resolvedFullBodyUrl}
              alt={FULL_BODY_LABELS[0]}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <ZoomIn size={24} className="text-white" />
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
            <ImageIcon size={32} className="mb-1 opacity-50" />
            <span className="text-xs">暂无全身照</span>
          </div>
        )}

        {/* 悬浮重新生成按钮 */}
        {hasFullBodyResolved && !isGeneratingFullBody && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRegenerateFullBody();
            }}
            className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
            title="重新生成"
          >
            <RefreshCw size={12} className="text-white" />
          </button>
        )}

        {/* 图片内部底部悬浮标题 */}
        <div className="absolute bottom-0 left-0 right-0 px-2 py-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <span className="text-sm font-medium text-white drop-shadow">{FULL_BODY_LABELS[0]}</span>
        </div>
      </div>

      {/* 图片下方：模型下拉框 + 操作按钮（两行） */}
      <div className="flex flex-col gap-2 mt-2.5">
        <Select
          value={selectedViewsModel}
          onChange={(v) => setSelectedViewsModel(v)}
          options={imageModels.map((m) => ({
            value: m.id,
            label: (
              <Tooltip title={m.description}>
                <span>{m.name}</span>
              </Tooltip>
            ),
            disabled: m.disabled,
          }))}
          size="small"
          popupMatchSelectWidth={false}
          style={{ minWidth: 90 }}
        />
        <div className="flex items-center gap-2">
          <Button
            type="text"
            size="small"
            onClick={onGenerateViews}
            loading={character.isGeneratingViews}
            disabled={!character.avatarImages || character.avatarImages.length === 0}
            className="text-accent-primary hover:text-accent-primary/80 px-3 h-[24px] py-0 border border-border flex-1 text-xs"
            title={character.avatarImages && character.avatarImages.length > 0
              ? '使用当前头像作为参考生成全身照'
              : '请先生成头像'}
          >
            {hasFullBody ? '重新生成' : '生成多视图'}
          </Button>
          <Button
            size="small"
            onClick={() => fullbodyFileInputRef.current?.click()}
            icon={<Upload size={12} />}
            className="flex-1 text-xs"
          >
            本地上传
          </Button>
        </div>
        <input
          type="file"
          accept="image/*"
          ref={fullbodyFileInputRef}
          onChange={onFullbodyUpload}
          className="hidden"
        />
      </div>
    </>
  );
};
