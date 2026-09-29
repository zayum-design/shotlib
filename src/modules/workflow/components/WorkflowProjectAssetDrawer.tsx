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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer, Segmented, Empty, Spin, Modal } from 'antd';
import { Move, Play, Music, Trash2 } from 'lucide-react';
import { localApi } from '@/storage';
import { ImagePreview } from '@/shared/components/ui/ImagePreview';
import { startAssetDrag, endAssetDrag } from '@/shared/utils/assetDragDrop';
import { message } from '@/shared/utils/message';
import { useWorkflowStore } from '../stores/workflowStore';
import { findAssetReferences, clearAssetReferences } from '../utils/assetReferences';

const PAGE_SIZE = 24;

/** asset_type → 中文分组标签 */
const TYPE_LABELS: Record<string, string> = {
  character_image: '角色',
  scene_image: '场景',
  frame_image: '帧图片',
  episode_video: '视频',
  character_voice: '音色',
};

/** 判断资产类型是否为视频 */
const isVideoType = (assetType: string) => assetType === 'episode_video';

/** 判断资产类型是否为音色（asset_type 以 _voice 结尾，归 voice_asset 分类） */
const isVoiceType = (assetType: string) => assetType.endsWith('_voice');

/**
 * 修复历史乱码文件名：早期上传的中文名被 latin1 误解码入库（如 "å½³é³.mp3"），
 * 展示时按 latin1→utf8 还原；仅当命中乱码特征区间时转换。
 */
const decodeMojibakeName = (name: string): string => {
  if (!name || !/[\u0080-\u00ff]/.test(name)) return name;
  try {
    return decodeURIComponent(escape(name));
  } catch {
    return name;
  }
};

interface AssetItem {
  id: string;
  url: string;
  assetType: string;
  typeLabel: string;
  name?: string;
  episodeNumber?: number;
  createdAt?: string;
}

/** asset_type → 资产行 category（与后端 image-asset.service 的推导规则一致） */
const categoryForAssetType = (assetType: string): string => {
  if (assetType.endsWith('_video')) return 'video_asset';
  if (assetType.endsWith('_voice')) return 'voice_asset';
  return 'image_asset';
};

interface WorkflowProjectAssetDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId?: string;
}

/**
 * 工作流项目资产库抽屉：数据来源于 creator_drama_project_assets 表
 * （category=image_asset 图片 + video_asset 视频），
 * 交互与 instant 页 ProjectAssetDrawer 一致（类型筛选 + 滚动分页 + 点击放大/播放）。
 */
export const WorkflowProjectAssetDrawer: React.FC<WorkflowProjectAssetDrawerProps> = ({
  open,
  onClose,
  projectId,
}) => {
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [imgPreviewOpen, setImgPreviewOpen] = useState(false);
  const [imgPreviewIndex, setImgPreviewIndex] = useState(0);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string>('');
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // mask=false 后 antd 不再提供"点击遮罩关闭"，手动实现点击空白处关闭：
  // mousedown 落在抽屉面板与图片放大预览浮层以外时关闭（拖拽 drop 只有 mouseup，不会误触）
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest('.ant-drawer-content-wrapper, .image-preview-dark, .ant-image-preview-operations, .ant-modal-wrap')) return;
      onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open, onClose]);

  // 抽屉打开时从资产数据表拉取
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setLoading(true);
    localApi
      .listProjectAssets(projectId, 'image_asset,video_asset,voice_asset')
      .then((res) => {
        if (cancelled) return;
        const rows: any[] = Array.isArray(res?.data) ? res.data : [];
        const mapped: AssetItem[] = rows
          .map((row) => {
            const data = row?.data || {};
            const url = data.original_url || data.thumbnail_url;
            if (!url) return null;
            const assetType = data.asset_type || 'other';
            const rawName = data.metadata?.originalname || data.metadata?.name || undefined;
            return {
              id: row.asset_key || row.id,
              url,
              assetType,
              typeLabel: TYPE_LABELS[assetType] || '其他',
              name: rawName ? decodeMojibakeName(rawName) : undefined,
              episodeNumber: row.episode_number,
              createdAt: row.created_at,
            };
          })
          .filter(Boolean) as AssetItem[];
        setItems(mapped);
      })
      .catch((err) => {
        console.warn('[WorkflowProjectAssetDrawer] 加载项目资产失败:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  // 按出现顺序生成筛选选项（全部 + 各类型）
  const filterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.assetType, (counts.get(item.assetType) || 0) + 1);
    }
    const options = [{ label: `全部 ${items.length}`, value: 'all' }];
    for (const [type, count] of counts) {
      options.push({ label: `${TYPE_LABELS[type] || '其他'} ${count}`, value: type });
    }
    return options;
  }, [items]);

  const list = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.assetType === filter)),
    [items, filter],
  );
  const visibleList = list.slice(0, visibleCount);
  // 图片放大预览仅含图片项（视频走播放弹窗、音色走音频弹窗），索引需基于图片子列表计算
  const imageList = useMemo(
    () => list.filter((i) => !isVideoType(i.assetType) && !isVoiceType(i.assetType)),
    [list],
  );

  const handleFilterChange = (v: string | number) => {
    setFilter(String(v));
    setVisibleCount(PAGE_SIZE);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60 && visibleCount < list.length) {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, list.length));
    }
  };

  // 删除资产：软删除数据表记录；若被 step3/step4 引用则二次确认，并在删除后清空引用
  const handleDeleteAsset = (asset: AssetItem) => {
    if (!projectId) return;
    const state = useWorkflowStore.getState();
    const refs = findAssetReferences(
      { assetId: asset.id, url: asset.url, assetType: asset.assetType },
      state,
    );

    const doDelete = async () => {
      try {
        await localApi.deleteProjectAsset(
          projectId,
          categoryForAssetType(asset.assetType),
          asset.id,
          asset.episodeNumber,
        );
        // 重置已经应用的引用为空
        const updates = clearAssetReferences(
          { assetId: asset.id, url: asset.url, assetType: asset.assetType },
          useWorkflowStore.getState(),
        );
        if (updates) useWorkflowStore.setState(updates);
        setItems((prev) => prev.filter((i) => i.id !== asset.id));
        message.success('已删除');
      } catch (e) {
        console.error('[WorkflowProjectAssetDrawer] 删除资产失败:', e);
        message.error('删除失败，请重试');
      }
    };

    if (refs.length > 0) {
      // 二次提醒：资产仍被引用
      Modal.confirm({
        title: '该资产正在被引用',
        content: (
          <div>
            <p className="text-sm mb-2">该资产正被以下位置引用，删除后这些引用将被清空：</p>
            <ul className="text-xs text-text-secondary list-disc pl-4 space-y-1 max-h-40 overflow-auto">
              {refs.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ),
        okText: '仍要删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: doDelete,
      });
    } else {
      Modal.confirm({
        title: '删除资产',
        content: '确认删除该资产？删除后不可恢复。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: doDelete,
      });
    }
  };

  return (
    <Drawer
      title="项目资产库"
      placement="right"
      width={420}
      open={open}
      onClose={onClose}
      // 关键：不能用遮罩——mask 会盖住整页，拖拽落点（角色/场景卡片）全部被遮挡，
      // dragover/drop 事件都落在遮罩上，表现为"拖动没有任何效果"
      mask={false}
      styles={{ body: { padding: 0 } }}
    >
      <div className="flex flex-col h-full">
        {/* 拖放提示 */}
        <div className="px-3 pt-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-xs">
            <Move size={12} className="flex-shrink-0" />
            <span>图片可拖放到角色头像 / 多视图 / 形象照或场景图上替换，音色可拖放到角色音色区域替换，类型需匹配</span>
          </div>
        </div>

        {/* 类型筛选 */}
        <div className="p-3 border-b border-border">
          <Segmented
            value={filter}
            onChange={handleFilterChange}
            block
            options={filterOptions}
          />
        </div>

        {/* 资产列表（滚动分页） */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex justify-center mt-12">
              <Spin />
            </div>
          ) : visibleList.length === 0 ? (
            <Empty description="暂无资产" className="mt-12" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {visibleList.map((asset, idx) => {
                  const isVideo = isVideoType(asset.assetType);
                  const isVoice = isVoiceType(asset.assetType);
                  return (
                    <div
                      key={`${asset.id}-${idx}`}
                      draggable={!isVideo}
                      onDragStart={(e) => {
                        if (isVideo) return;
                        startAssetDrag(e, { assetId: asset.id, url: asset.url, assetType: asset.assetType });
                      }}
                      onDragEnd={endAssetDrag}
                      onClick={() => {
                        if (isVideo) {
                          setVideoPreviewUrl(asset.url);
                          return;
                        }
                        if (isVoice) {
                          setVoicePreviewUrl(asset.url);
                          return;
                        }
                        setImgPreviewIndex(Math.max(0, imageList.indexOf(asset)));
                        setImgPreviewOpen(true);
                      }}
                      className={`relative group rounded-lg overflow-hidden border border-border bg-bg-tertiary hover:border-accent-primary transition-colors ${isVideo ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
                      title={isVideo ? `${asset.typeLabel} · 点击播放` : isVoice ? `${asset.typeLabel} · 点击试听，可拖放到角色音色区域替换` : `${asset.typeLabel} · 可拖放替换（点击放大）`}
                    >
                      {/* object-contain：竖版（9:16）等比例完整显示，不裁切 */}
                      <div className="w-full aspect-square flex items-center justify-center bg-black/20">
                        {isVideo ? (
                          <>
                            <video src={asset.url} preload="metadata" muted className="max-w-full max-h-full object-contain" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
                              <Play size={28} className="text-white/90" fill="currentColor" />
                            </div>
                          </>
                        ) : isVoice ? (
                          <div className="flex flex-col items-center justify-center gap-1 px-1">
                            <Music size={24} className="text-accent-primary" />
                            <span className="text-[10px] text-text-secondary truncate w-full text-center">
                              {asset.name || asset.typeLabel}
                            </span>
                          </div>
                        ) : (
                          <img src={asset.url} alt={asset.typeLabel} className="max-w-full max-h-full object-contain" draggable={false} />
                        )}
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-1 py-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                        {isVideo ? `${asset.typeLabel} · 点击播放` : isVoice ? `${asset.typeLabel} · 点击试听` : `${asset.typeLabel} · 可拖放替换`}
                      </div>
                      {/* 删除按钮（右上角，hover 显示） */}
                      <button
                        type="button"
                        title="删除该资产"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAsset(asset);
                        }}
                        className="absolute top-1 right-1 z-10 w-6 h-6 rounded-full bg-black/60 text-white/90 hover:bg-red-500 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
              {visibleCount < list.length && (
                <div className="text-center text-xs text-text-muted py-3">下拉加载更多...</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 图片放大预览（组内切换，仅图片项） */}
      <ImagePreview
        images={imageList.map((a) => a.url)}
        visible={imgPreviewOpen}
        currentIndex={imgPreviewIndex}
        onClose={() => setImgPreviewOpen(false)}
        title="项目资产"
      />

      {/* 视频播放弹窗 */}
      <Modal
        open={!!videoPreviewUrl}
        footer={null}
        onCancel={() => setVideoPreviewUrl('')}
        centered
        width={720}
        title="视频预览"
        destroyOnHidden
      >
        {videoPreviewUrl && (
          <video src={videoPreviewUrl} controls autoPlay className="w-full max-h-[70vh] object-contain bg-black" />
        )}
      </Modal>

      {/* 音色试听弹窗 */}
      <Modal
        open={!!voicePreviewUrl}
        footer={null}
        onCancel={() => setVoicePreviewUrl('')}
        centered
        width={480}
        title="音色试听"
        destroyOnHidden
      >
        {voicePreviewUrl && (
          <audio src={voicePreviewUrl} controls autoPlay className="w-full" />
        )}
      </Modal>
    </Drawer>
  );
};
