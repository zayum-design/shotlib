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

import { Button, Modal, Tabs } from 'antd';
import { Film, Music } from 'lucide-react';
import React, { useState } from 'react';
import { ImagePreview } from './ImagePreview';
import { localApi } from '@/storage';

interface PreviewRequestModalProps {
  open: boolean;
  data: any;
  onCancel: () => void;
  onSend: () => void;
  /**
   * 可选：把 assetId 解析为可访问 URL。
   * 部分页面本地参数中的参考素材是 assetId（如 generate 的 references / firstFrameAssetId），
   * 预览缩略图时通过该解析器取回真实 URL。
   */
  resolveAssetUrl?: (assetId: string) => string | undefined;
}

// JSON 区块统一样式:完整显示、长字符串自动换行、不省略
const JSON_PRE_CLASS =
  'bg-bg-tertiary rounded-lg p-4 text-xs text-text-secondary font-mono';
const JSON_PRE_STYLE: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
  // 显式清除任何继承下来的省略/裁剪行为
  textOverflow: 'clip',
  WebkitLineClamp: 'unset',
  lineClamp: 'unset',
  overflow: 'visible',
  maxHeight: 'none',
  minHeight: 0,
  height: 'auto',
  display: 'block',
  // 避免任何省略号或裁剪样式从父级继承
  textWrap: 'wrap' as any,
};

/** 参考素材条目 */
interface RefMaterial {
  type: 'image' | 'video' | 'audio';
  url: string;
  label: string;
}

/** URL 形式的参考字段名 -> 素材类型/标签 */
const URL_FIELD_MAP: Array<{ keys: string[]; type: RefMaterial['type']; label: string }> = [
  { keys: ['firstFrameUrl'], type: 'image', label: '首帧' },
  { keys: ['lastFrameUrl'], type: 'image', label: '尾帧' },
  { keys: ['referenceImageUrls', 'referenceImages', 'imageUrls', 'imageUrl'], type: 'image', label: '参考图' },
  { keys: ['referenceVideoUrls', 'referenceVideos', 'videoUrls', 'videoUrl'], type: 'video', label: '参考视频' },
  { keys: ['referenceAudioUrls', 'referenceAudios', 'audioUrls', 'audioUrl'], type: 'audio', label: '参考音频' },
];

/** assetId 形式的参考字段名 -> 素材类型/标签（需 resolveAssetUrl 解析） */
const ASSET_ID_FIELD_MAP: Array<{ keys: string[]; type: RefMaterial['type']; label: string }> = [
  { keys: ['firstFrameAssetId'], type: 'image', label: '首帧' },
  { keys: ['lastFrameAssetId'], type: 'image', label: '尾帧' },
];

const isHttpUrl = (v: unknown): v is string =>
  typeof v === 'string' && /^https?:\/\//.test(v);

/** 厂商合规资产 URL（asset://asset-xxx），需反查为真实图片 URL 才能展示 */
const isAssetUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('asset://');

const VALID_TYPES = new Set(['image', 'video', 'audio']);

/**
 * 递归扫描本地参数 JSON，收集参考素材（URL 直连 + assetId 解析两种形态）。
 * 按 url 去重，保留首次出现的标签。
 * asset:// 合规资产 URL 依次经 resolveAssetUrl（调用方）与合规缓存反查解析。
 */
function collectRefMaterials(
  node: any,
  resolveAssetUrl: PreviewRequestModalProps['resolveAssetUrl'],
  out: RefMaterial[] = [],
  seen: Set<string> = new Set(),
  depth = 0,
): RefMaterial[] {
  if (!node || depth > 12) return out;
  const push = (type: RefMaterial['type'], url: string | undefined, label: string) => {
    if (!url) return;
    // asset:// 合规资产 URL：先走调用方解析器，再从 image_asset.data 合规缓存反查
    let finalUrl = url;
    if (isAssetUrl(finalUrl)) {
      const assetId = finalUrl.slice('asset://'.length);
      finalUrl =
        resolveAssetUrl?.(assetId) ||
        localApi.resolveComplianceAssetUrl(finalUrl) ||
        '';
    }
    if (!isHttpUrl(finalUrl) || seen.has(finalUrl)) return;
    seen.add(finalUrl);
    out.push({ type, url: finalUrl, label });
  };

  if (Array.isArray(node)) {
    for (const item of node) collectRefMaterials(item, resolveAssetUrl, out, seen, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;

  // 形态1：厂商 content 数组项 { type: 'image_url', image_url: { url } }
  if (typeof node.type === 'string' && VALID_TYPES.has(node.type.replace(/_url$/, ''))) {
    const mediaType = node.type.replace(/_url$/, '') as RefMaterial['type'];
    const mediaObj = node[`${mediaType}_url`];
    if (mediaObj && (isHttpUrl(mediaObj.url) || isAssetUrl(mediaObj.url))) {
      const label = mediaType === 'image' ? '参考图' : mediaType === 'video' ? '参考视频' : '参考音频';
      push(mediaType, mediaObj.url, label);
    }
  }

  // 形态2：references 数组项 { type, assetId, name, url? }
  if (typeof node.assetId === 'string' && VALID_TYPES.has(node.type)) {
    push(node.type, node.url ?? resolveAssetUrl?.(node.assetId), node.name || '参考素材');
  }

  for (const [key, value] of Object.entries(node)) {
    // 形态3：URL 字段（字符串或字符串数组，含 asset:// 合规资产 URL）
    const urlField = URL_FIELD_MAP.find((f) => f.keys.includes(key));
    if (urlField) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) if (isHttpUrl(v) || isAssetUrl(v)) push(urlField.type, v, urlField.label);
      continue;
    }
    // 形态4：assetId 字段（需解析器）
    const assetField = ASSET_ID_FIELD_MAP.find((f) => f.keys.includes(key));
    if (assetField && typeof value === 'string') {
      push(assetField.type, resolveAssetUrl?.(value), assetField.label);
      continue;
    }
    if (value && typeof value === 'object') {
      collectRefMaterials(value, resolveAssetUrl, out, seen, depth + 1);
    }
  }
  return out;
}

/** 本地参数 tab 顶部的参考素材预览条 */
const RefMaterialBar: React.FC<{
  materials: RefMaterial[];
  onPreviewImage: (index: number) => void;
  onPlayMedia: (m: RefMaterial) => void;
}> = ({ materials, onPreviewImage, onPlayMedia }) => {
  const imageUrls = materials.filter((m) => m.type === 'image').map((m) => m.url);
  return (
    <div className="mb-3 rounded-lg border border-border bg-bg-tertiary p-3">
      <div className="mb-2 text-xs text-text-muted">参考素材（{materials.length}）</div>
      <div className="flex flex-wrap gap-2">
        {materials.map((m, i) => {
          if (m.type === 'image') {
            const imgIndex = imageUrls.indexOf(m.url);
            return (
              <button
                key={`${m.url}-${i}`}
                type="button"
                onClick={() => onPreviewImage(imgIndex)}
                className="group relative h-16 w-12 overflow-hidden rounded-md border border-border transition-transform hover:scale-105 hover:border-accent-primary"
                title={`${m.label}（点击放大）`}
              >
                <img src={m.url} alt={m.label} className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-0.5 text-[9px] leading-4 text-white">
                  {m.label}
                </span>
              </button>
            );
          }
          return (
            <button
              key={`${m.url}-${i}`}
              type="button"
              onClick={() => onPlayMedia(m)}
              className="group relative flex h-16 w-12 flex-col items-center justify-center gap-1 rounded-md border border-border bg-bg-quaternary transition-transform hover:scale-105 hover:border-accent-primary"
              title={`${m.label}（点击播放）`}
            >
              {m.type === 'video' ? (
                <Film size={18} className="text-text-muted group-hover:text-accent-primary" />
              ) : (
                <Music size={18} className="text-text-muted group-hover:text-accent-primary" />
              )}
              <span className="max-w-full truncate px-0.5 text-[9px] text-text-muted">{m.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const PreviewTabs: React.FC<{
  item: any;
  index?: number;
  resolveAssetUrl?: PreviewRequestModalProps['resolveAssetUrl'];
  onPreviewImage: (images: string[], index: number) => void;
  onPlayMedia: (m: RefMaterial) => void;
}> = ({ item, index, resolveAssetUrl, onPreviewImage, onPlayMedia }) => {
  const hasTabs = item?.local && item?.remote;
  // 本地参数中的参考素材（URL 直连 + assetId 解析）
  const localMaterials = hasTabs ? collectRefMaterials(item.local, resolveAssetUrl) : [];
  const localImageUrls = localMaterials.filter((m) => m.type === 'image').map((m) => m.url);

  return (
    <div className={index !== undefined ? 'mb-4' : ''}>
      {index !== undefined && (
        <div className="text-sm font-medium text-text-primary mb-2">
          请求 {index + 1}
        </div>
      )}
      {hasTabs ? (
        <Tabs
          defaultActiveKey="local"
          items={[
            {
              key: 'local',
              label: '本地参数',
              children: (
                <>
                  {localMaterials.length > 0 && (
                    <RefMaterialBar
                      materials={localMaterials}
                      onPreviewImage={(i) => onPreviewImage(localImageUrls, i)}
                      onPlayMedia={onPlayMedia}
                    />
                  )}
                  <pre className={JSON_PRE_CLASS} style={JSON_PRE_STYLE}>
                    {JSON.stringify(item.local, null, 2)}
                  </pre>
                </>
              ),
            },
            {
              key: 'remote',
              label: '远程参数',
              children: (
                <pre className={JSON_PRE_CLASS} style={JSON_PRE_STYLE}>
                  {JSON.stringify(item.remote, null, 2)}
                </pre>
              ),
            },
          ]}
        />
      ) : (
        <pre className={JSON_PRE_CLASS} style={JSON_PRE_STYLE}>
          {JSON.stringify(item, null, 2)}
        </pre>
      )}
    </div>
  );
};

export const PreviewRequestModal: React.FC<PreviewRequestModalProps> = ({
  open,
  data,
  onCancel,
  onSend,
  resolveAssetUrl,
}) => {
  const isArray = Array.isArray(data);
  const firstItem = isArray ? data[0] : data;

  // 图片放大预览
  const [imgPreviewOpen, setImgPreviewOpen] = useState(false);
  const [imgPreviewIndex, setImgPreviewIndex] = useState(0);
  const [imgPreviewImages, setImgPreviewImages] = useState<string[]>([]);
  // 音视频播放
  const [playingMedia, setPlayingMedia] = useState<RefMaterial | null>(null);

  const handlePreviewImage = (images: string[], index: number) => {
    setImgPreviewImages(images);
    setImgPreviewIndex(index);
    setImgPreviewOpen(true);
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={
        <div className="flex items-center justify-between pr-8">
          <span>请求预览</span>
          {firstItem?.apiDocUrl && (
            <Button
              type="link"
              size="small"
              onClick={() => window.open(firstItem.apiDocUrl, '_blank')}
            >
              API文档
            </Button>
          )}
        </div>
      }
      width={1200}
      zIndex={2000}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button key="send" type="primary" onClick={onSend}>
          发送
        </Button>,
      ]}
    >
      {/* 让 modal 内部整体可滚动,JSON 区块本身完全展开不省略 */}
      <div className="max-h-[75vh] overflow-auto pr-1">
        {isArray ? (
          data.map((item: any, index: number) => (
            <PreviewTabs
              key={index}
              item={item}
              index={index}
              resolveAssetUrl={resolveAssetUrl}
              onPreviewImage={handlePreviewImage}
              onPlayMedia={setPlayingMedia}
            />
          ))
        ) : (
          <PreviewTabs
            item={data}
            resolveAssetUrl={resolveAssetUrl}
            onPreviewImage={handlePreviewImage}
            onPlayMedia={setPlayingMedia}
          />
        )}
      </div>

      {/* 图片放大预览（zIndex 高于请求预览弹窗 2000） */}
      <div onClick={(e) => e.stopPropagation}>
        <ImagePreview
          images={imgPreviewImages}
          visible={imgPreviewOpen}
          currentIndex={imgPreviewIndex}
          onClose={() => setImgPreviewOpen(false)}
          title="参考图"
          zIndex={2200}
        />
      </div>

      {/* 音视频播放弹窗 */}
      <Modal
        open={!!playingMedia}
        onCancel={() => setPlayingMedia(null)}
        title={playingMedia?.label}
        footer={null}
        zIndex={2100}
        destroyOnClose
        width={playingMedia?.type === 'video' ? 720 : 420}
      >
        {playingMedia?.type === 'video' ? (
          <video src={playingMedia.url} controls autoPlay className="w-full rounded-lg" />
        ) : playingMedia?.type === 'audio' ? (
          <audio src={playingMedia.url} controls autoPlay className="w-full" />
        ) : null}
      </Modal>
    </Modal>
  );
};
