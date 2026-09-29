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

import React, { useMemo, useRef, useState } from 'react';
import { Drawer, Segmented, Empty } from 'antd';
import { Film, Music, Play } from 'lucide-react';
import { collectProjectAssets, type ProjectAsset, type ProjectAssetType } from '../utils/collectProjectAssets';
import { ImagePreview } from '@/shared/components/ui/ImagePreview';
import type { InstantCharacter, InstantScene, InstantSegment } from '@/shared/types/project';

const PAGE_SIZE = 24;

interface ProjectAssetDrawerProps {
  open: boolean;
  onClose: () => void;
  characters: InstantCharacter[];
  scenes: InstantScene[];
  segments: InstantSegment[];
}

/**
 * 项目资产库抽屉：展示当前项目内所有图片/视频/音频资产，支持类型筛选与滚动分页载入。
 */
export const ProjectAssetDrawer: React.FC<ProjectAssetDrawerProps> = ({
  open,
  onClose,
  characters,
  scenes,
  segments,
}) => {
  const [filter, setFilter] = useState<ProjectAssetType>('image');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [imgPreviewOpen, setImgPreviewOpen] = useState(false);
  const [imgPreviewIndex, setImgPreviewIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const assets = useMemo(
    () => collectProjectAssets({ characters, scenes, segments }),
    [characters, scenes, segments],
  );

  const list = assets[filter];
  const visibleList = list.slice(0, visibleCount);

  const handleFilterChange = (v: ProjectAssetType) => {
    setFilter(v);
    setVisibleCount(PAGE_SIZE);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60 && visibleCount < list.length) {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, list.length));
    }
  };

  const handleClick = (asset: ProjectAsset, index: number) => {
    if (asset.type === 'image') {
      setImgPreviewIndex(index);
      setImgPreviewOpen(true);
    } else if (asset.type === 'video') {
      window.open(asset.url, '_blank');
    } else {
      // 音频：直接播放
      new Audio(asset.url).play().catch(() => {});
    }
  };

  return (
    <Drawer
      title="项目资产库"
      placement="right"
      width={420}
      open={open}
      onClose={onClose}
      styles={{ body: { padding: 0 } }}
    >
      <div className="flex flex-col h-full">
        {/* 类型筛选 */}
        <div className="p-3 border-b border-border">
          <Segmented
            value={filter}
            onChange={(v) => handleFilterChange(v as ProjectAssetType)}
            block
            options={[
              { label: `图片 ${assets.image.length}`, value: 'image' },
              { label: `视频 ${assets.video.length}`, value: 'video' },
              { label: `音频 ${assets.audio.length}`, value: 'audio' },
            ]}
          />
        </div>

        {/* 资产列表（滚动分页） */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3">
          {visibleList.length === 0 ? (
            <Empty description="暂无资产" className="mt-12" />
          ) : (
            <>
              <div className={filter === 'image' ? 'grid grid-cols-3 gap-2' : 'flex flex-col gap-2'}>
                {visibleList.map((asset, idx) => (
                  <div
                    key={`${asset.url}-${idx}`}
                    onClick={() => handleClick(asset, idx)}
                    className="relative group cursor-pointer rounded-lg overflow-hidden border border-border bg-bg-tertiary hover:border-accent-primary transition-colors"
                    title={asset.source}
                  >
                    {asset.type === 'image' ? (
                      <img src={asset.url} alt={asset.name} className="w-full aspect-square object-cover" />
                    ) : (
                      <div className="flex items-center gap-2 p-2">
                        <div className="w-12 h-12 rounded bg-bg-secondary flex items-center justify-center shrink-0">
                          {asset.type === 'video' ? (
                            <Film size={20} className="text-accent-primary" />
                          ) : (
                            <Music size={20} className="text-accent-primary" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-text-primary truncate">{asset.name}</div>
                          <div className="text-xs text-text-muted truncate">{asset.source}</div>
                        </div>
                        {asset.type === 'video' && <Play size={16} className="text-text-muted shrink-0" />}
                      </div>
                    )}
                    {asset.type === 'image' && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-1 py-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                        {asset.source}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {visibleCount < list.length && (
                <div className="text-center text-xs text-text-muted py-3">下拉加载更多...</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 图片放大预览（组内切换） */}
      <ImagePreview
        images={list.map((a) => a.url)}
        visible={imgPreviewOpen}
        currentIndex={imgPreviewIndex}
        onClose={() => setImgPreviewOpen(false)}
        title="项目资产"
      />
    </Drawer>
  );
};
