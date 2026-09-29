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

import { Plus, X, Film, Music, Image as ImageIcon, Loader2, Check, AlertTriangle } from 'lucide-react';
import { useState, useRef } from 'react';
import type { ReferenceAsset, GenerateMode, ReferenceType } from '../types';

// 纯前端版:不再依赖 generate 会话 store。
// 工作流分镜附件的 assetId 本身就是 URL;generate 页的内部 ID 解析已随服务端移除。

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

interface OpenUploadDialogButtonProps {
  uploading: boolean;
  onClick: () => void;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
}

/** 打开上传弹窗的按钮（与剧本角色本地上传弹窗一致） */
const OpenUploadDialogButton = ({
  uploading,
  onClick,
  className,
  size = 'sm',
}: OpenUploadDialogButtonProps) => (
  <button
    type="button"
    disabled={uploading}
    onClick={onClick}
    className={cn(
      'flex items-center justify-center rounded-lg border border-dashed border-border bg-bg-tertiary text-text-muted transition-colors hover:border-accent-primary hover:text-accent-primary',
      size === 'xs' ? 'h-5 w-5' : size === 'sm' ? 'w-10 aspect-[9/16]' : 'h-12 w-12',
      className,
    )}
  >
    {uploading ? (
      <div className={cn('animate-pulse rounded bg-bg-quaternary', size === 'xs' ? 'h-3 w-3' : size === 'sm' ? 'h-5 w-5' : 'h-6 w-6')} />
    ) : (
      <Plus size={size === 'xs' ? 12 : size === 'sm' ? 18 : 20} />
    )}
  </button>
);

interface ThumbProps {
  asset: ReferenceAsset;
  index: number;
  size?: 'sm' | 'md';
  className?: string;
  style?: React.CSSProperties;
  onPreview: (index: number) => void;
  onRemove: (index: number) => void;
}

/** 判断 assetId 是否本身就是可直接加载的 URL（工作流分镜附件直接用 URL 作为 assetId） */
function isDirectUrl(value: string): boolean {
  return /^(https?:)?\/\//.test(value) || value.startsWith('/') || value.startsWith('data:') || value.startsWith('blob:');
}

/** 单个参考图缩略图 */
const Thumb = ({ asset, index, size = 'sm', className, style, onPreview, onRemove }: ThumbProps) => {
  // generate 页面的 assetId 是内部 ID，经 assetUrlMap 解析为 URL；
  // 工作流分镜附件的 assetId 本身就是 URL，不在 assetUrlMap 中，直接使用
  const assetUrl = isDirectUrl(asset.assetId) ? asset.assetId : '';
  const compliance = undefined as string | undefined;
  return (
  <div
    className={cn(
      'group/thumb relative cursor-pointer rounded-lg border border-border bg-bg-tertiary shadow-sm transition-all duration-200 hover:scale-105 hover:border-accent-primary/30 hover:shadow-md',
      size === 'sm' ? 'w-10 aspect-[3/4]' : 'w-12 aspect-[3/4]',
      className,
    )}
    style={style}
    onClick={(e) => {
      e.stopPropagation();
      onPreview(index);
    }}
    title={asset.name || `${asset.type}${index + 1}`}
  >
    {/* 内层 overflow-hidden 保证图片圆角，外层 overflow-visible 让删除按钮可超出 */}
    <div className="h-full w-full overflow-hidden rounded-lg">
      {asset.type === 'image' ? (
        <img src={assetUrl} alt={`参考${index + 1}`} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-bg-quaternary">
          {asset.type === 'video' ? (
            <Film size={size === 'sm' ? 14 : 16} className="text-text-muted" />
          ) : (
            <Music size={size === 'sm' ? 14 : 16} className="text-text-muted" />
          )}
          <span className={cn('max-w-full truncate px-1 text-text-muted', size === 'sm' ? 'text-[8px]' : 'text-[9px]')}>
            {asset.name || asset.type}
          </span>
        </div>
      )}
    </div>
    {/* 合规检查状态角标（图片）：checking 转圈 / success 勾 / failed 叹号 */}
    {asset.type === 'image' && compliance === 'checking' && (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-0.5 rounded-lg bg-black/40">
        <Loader2 size={14} className="animate-spin text-white" />
        <span className="text-[8px] leading-none text-white/90">合规审查中</span>
      </div>
    )}
    {asset.type === 'image' && compliance === 'success' && (
      <div className="absolute -left-1 -top-1 z-10 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-green-500 text-white shadow">
        <Check size={7} />
      </div>
    )}
    {asset.type === 'image' && compliance === 'failed' && (
      <div
        className="absolute -left-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white shadow"
        title="合规检查未通过"
      >
        <AlertTriangle size={9} />
      </div>
    )}
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove(index);
      }}
      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/thumb:opacity-100"
    >
      <X size={10} />
    </button>
  </div>
  );
};

interface ReferenceThumbnailsProps {
  references: ReferenceAsset[];
  maxCount: number;
  uploading: boolean;
  /** 当前上传的资源类型，用于显示对应 loading 占位 */
  uploadingType?: ReferenceType | null;
  mode: GenerateMode;
  onRemove: (index: number) => void;
  onPreview: (index: number) => void;
  /** 点击添加按钮：打开 AvatarUploadDialog */
  onOpenAvatarUpload: () => void;
  /** 拖入生成结果：新增到全能参考 */
  onDropReference?: (asset: ReferenceAsset) => void;
  /** 拖入生成结果：替换指定索引参考 */
  onReplaceReference?: (index: number, asset: ReferenceAsset) => void;
  /** 拖拽素材进入输入框时强制展开浮动面板（不要求鼠标在参考列表上） */
  forceExpand?: boolean;
}

/** 上传中占位（按图片/视频/音频显示对应图标） */
const LoadingPlaceholder = ({
  type,
  size = 'sm',
  style,
}: {
  type?: ReferenceType | null;
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
}) => {
  const iconSize = size === 'sm' ? 16 : 20;
  return (
    <div
      className={cn(
        'flex animate-pulse items-center justify-center rounded-lg border border-border bg-bg-tertiary',
        size === 'sm' ? 'w-10 aspect-[3/4]' : 'w-12 aspect-[3/4]',
      )}
      style={style}
    >
      {type === 'video' ? (
        <Film size={iconSize} className="text-text-muted" />
      ) : type === 'audio' ? (
        <Music size={iconSize} className="text-text-muted" />
      ) : (
        <ImageIcon size={iconSize} className="text-text-muted" />
      )}
    </div>
  );
};

/** 解析拖拽数据 */
function parseGenerateResultDrop(e: React.DragEvent): { assetId: string; type: ReferenceType } | null {
  e.preventDefault();
  const raw = e.dataTransfer.getData('application/x-generate-result');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { assetId: string; type: ReferenceType };
    return parsed.assetId ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 即梦风格的参考图缩略图折叠/展开组件。
 * - 无图：输入框内左侧显示一个虚线边框的 "+" 上传位
 * - 多图：默认堆叠在输入框左侧（后面的图只露出左侧边缘）
 * - hover 或拖拽时弹出浮动面板，在上一层水平展开所有参考图，不撑开输入框宽度
 * - 拖拽可替换已有参考，也可拖到 "+" 上新增
 */
export const ReferenceThumbnails = ({
  references,
  maxCount,
  uploading,
  uploadingType,
  mode,
  onRemove,
  onPreview,
  onOpenAvatarUpload,
  onDropReference,
  onReplaceReference,
  forceExpand,
}: ReferenceThumbnailsProps) => {
  const hasRefs = references.length > 0;
  const canAdd = references.length < maxCount;
  const [dragCount, setDragCount] = useState(0);
  const [dragOverIndex, setDragOverIndex] = useState<number | 'add' | null>(null);
  const isExpanded = dragCount > 0 || !!forceExpand;
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    if (!onDropReference && !onReplaceReference) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const applyDrop = (e: React.DragEvent, target: 'add' | number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCount(0);
    setDragOverIndex(null);
    const parsed = parseGenerateResultDrop(e);
    if (!parsed) return;
    const asset: ReferenceAsset = { ...parsed, name: '生成结果' };

    if (target === 'add') {
      if (!canAdd || !onDropReference) return;
      onDropReference(asset);
    } else {
      if (!onReplaceReference) return;
      onReplaceReference(target, asset);
    }
  };

  if (!hasRefs) {
    return (
      <div
        ref={containerRef}
        onDragOver={handleDragOver}
        onDragEnter={() => setDragCount((c) => c + 1)}
        onDragLeave={() => {
          setDragCount((c) => Math.max(0, c - 1));
          setDragOverIndex(null);
        }}
        onDrop={(e) => applyDrop(e, 'add')}
        className={cn(
          'rounded-xl transition-colors',
          dragCount > 0 && 'bg-accent-primary/10 ring-1 ring-accent-primary/30',
        )}
      >
        <OpenUploadDialogButton uploading={uploading} onClick={onOpenAvatarUpload} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragEnter={() => setDragCount((c) => c + 1)}
      onDragLeave={(e) => {
        // 只有真正离开容器时才重置，进入子元素时不减计数
        if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
          setDragCount(0);
          setDragOverIndex(null);
        }
      }}
      onDrop={(e) => {
        // 如果未落在具体目标上，默认新增
        if (dragOverIndex === null) {
          applyDrop(e, 'add');
        } else {
          setDragCount(0);
          setDragOverIndex(null);
        }
      }}
      className={cn(
        'group relative flex shrink-0 items-center gap-1 py-1 rounded-xl transition-colors',
        dragCount > 0 && 'bg-accent-primary/10 ring-1 ring-accent-primary/30',
      )}
    >
      {mode === 'video' && (
        <span className="mr-1 shrink-0 text-xs text-text-muted">参考</span>
      )}

      {/* 默认堆叠态（在文档流中，不展开） */}
      <div className="relative flex items-center">
        {references.map((ref, i) => (
          <Thumb
            key={`stack-${ref.assetId}-${i}`}
            asset={ref}
            index={i}
            className={cn(
              'transition-all duration-200',
              i === 0 ? 'ml-0' : '-ml-7',
            )}
            style={{ zIndex: references.length - i }}
            onPreview={onPreview}
            onRemove={onRemove}
          />
        ))}
        {uploading && (
          <LoadingPlaceholder type={uploadingType} size="sm" style={{ zIndex: 0 }} />
        )}
        {canAdd && (
          <OpenUploadDialogButton
            uploading={uploading}
            onClick={onOpenAvatarUpload}
            size="xs"
            className="absolute -right-1.5 -bottom-1.5 z-10 rounded-full border-border bg-bg-secondary shadow-sm"
          />
        )}
      </div>

      {/* hover/拖拽 浮动展开面板：浮在上一层，不影响输入框宽度 */}
      <div
        className={cn(
          'absolute left-0 top-0 z-50 flex origin-left items-center gap-2 rounded-xl border border-border bg-bg-secondary p-2 shadow-theme-lg transition-all duration-300 ease-out pointer-events-none -translate-y-1 scale-95 opacity-0',
          'group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100',
          isExpanded && 'pointer-events-auto translate-y-0 scale-100 opacity-100',
        )}
      >
        {references.map((ref, i) => (
          <div
            key={`exp-${ref.assetId}-${i}`}
            onDragOver={handleDragOver}
            onDragEnter={(e) => {
              e.stopPropagation();
              setDragOverIndex(i);
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              if (dragOverIndex === i) setDragOverIndex(null);
            }}
            onDrop={(e) => applyDrop(e, i)}
            className={cn(
              'rounded-lg transition-all',
              dragOverIndex === i && 'ring-2 ring-accent-primary ring-offset-1 ring-offset-bg-secondary scale-105',
            )}
          >
            <Thumb
              asset={ref}
              index={i}
              size="md"
              onPreview={onPreview}
              onRemove={onRemove}
            />
          </div>
        ))}
        {uploading && <LoadingPlaceholder type={uploadingType} size="md" />}
        {canAdd && (
          <div
            onDragOver={handleDragOver}
            onDragEnter={(e) => {
              e.stopPropagation();
              setDragOverIndex('add');
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              if (dragOverIndex === 'add') setDragOverIndex(null);
            }}
            onDrop={(e) => applyDrop(e, 'add')}
            className={cn(
              'rounded-lg transition-all',
              dragOverIndex === 'add' && 'ring-2 ring-accent-primary ring-offset-1 ring-offset-bg-secondary scale-105',
            )}
          >
            <OpenUploadDialogButton
              uploading={uploading}
              onClick={onOpenAvatarUpload}
              size="md"
            />
          </div>
        )}
      </div>
    </div>
  );
};
