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

import { useState, useMemo } from 'react';
import { Drawer, Tabs, Button, Tag, Empty, Tooltip, Modal } from 'antd';
import { History, Image, Video, Music, Copy, Clock, X, Eye } from 'lucide-react';
import { getGeneratedAssetsHistory, type GeneratedAssetRecord } from '../../utils/generatedAssetsHistory';
import { message } from '../../utils/message';

const CATEGORY_LABELS: Record<string, string> = {
  drama: '短剧',
  music: '音乐',
  instant: '即时创作',
};

const CATEGORY_COLORS: Record<string, string> = {
  drama: 'purple',
  music: 'green',
  instant: 'orange',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  image: <Image size={16} />,
  video: <Video size={16} />,
  audio: <Music size={16} />,
  music: <Music size={16} />,
};

const TYPE_LABELS: Record<string, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  music: '音乐',
};

const TYPE_COLOR_CLASSES: Record<string, { bg: string; text: string; tag: string }> = {
  image: { bg: 'bg-cyan-500/10', text: 'text-cyan-500', tag: 'cyan' },
  video: { bg: 'bg-red-500/10', text: 'text-red-500', tag: 'red' },
  audio: { bg: 'bg-orange-500/10', text: 'text-orange-500', tag: 'orange' },
  music: { bg: 'bg-green-500/10', text: 'text-green-500', tag: 'green' },
};

interface GeneratedAssetsHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
}

export const GeneratedAssetsHistoryDrawer: React.FC<GeneratedAssetsHistoryDrawerProps> = ({
  open,
  onClose,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [previewRecord, setPreviewRecord] = useState<GeneratedAssetRecord | null>(null);

  const allRecords = useMemo(() => {
    return getGeneratedAssetsHistory().sort((a, b) => b.createdAt - a.createdAt);
  }, [open]);

  const filteredRecords = useMemo(() => {
    if (activeCategory === 'all') return allRecords;
    return allRecords.filter((r) => r.category === activeCategory);
  }, [allRecords, activeCategory]);

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      message.success('地址已复制');
    }).catch(() => {
      message.error('复制失败');
    });
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const counts = useMemo(() => {
    const c = { all: allRecords.length, drama: 0, music: 0, instant: 0 };
    for (const r of allRecords) {
      if (r.category in c) c[r.category as keyof typeof c]++;
    }
    return c;
  }, [allRecords]);

  const tabItems = [
    { key: 'all', label: `全部 (${counts.all})` },
    { key: 'drama', label: `短剧 (${counts.drama})` },
    { key: 'music', label: `音乐 (${counts.music})` },
    { key: 'instant', label: `即时创作 (${counts.instant})` },
  ];

  return (
    <Drawer
      title={
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-primary/20 to-accent-secondary/20 flex items-center justify-center">
            <History size={18} className="text-accent-primary" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-text-primary">生成资产历史记录</h3>
            <p className="text-xs text-text-muted">所有通过大模型生成的附件</p>
          </div>
        </div>
      }
      placement="right"
      width={560}
      open={open}
      onClose={onClose}
      className="[&_.ant-drawer-content]:bg-bg-primary [&_.ant-drawer-wrapper-body]:bg-bg-primary [&_.ant-drawer-body]:bg-bg-primary [&_.ant-drawer-header]:bg-bg-secondary [&_.ant-drawer-title]:text-text-primary [&_.ant-drawer-close]:text-text-muted"
    >
      <div className="h-full flex flex-col">
        <Tabs
          activeKey={activeCategory}
          onChange={setActiveCategory}
          items={tabItems}
          className="mb-4"
        />

        <div className="flex-1 overflow-auto pr-1">
          {filteredRecords.length === 0 ? (
            <Empty
              description={
                <div className="py-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg-tertiary flex items-center justify-center">
                    <History size={32} className="text-text-muted" />
                  </div>
                  <h4 className="text-text-primary mb-2">暂无历史记录</h4>
                  <p className="text-text-secondary text-sm">
                    同步到云端后，AI 生成的资产将自动记录在这里
                  </p>
                </div>
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredRecords.map((record) => (
                <AssetRecordCard
                  key={record.id}
                  record={record}
                  onCopy={() => handleCopyUrl(record.cloudUrl)}
                  onPreview={() => setPreviewRecord(record)}
                  formatTime={formatTime}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 预览 Modal */}
      <Modal
        open={!!previewRecord}
        onCancel={() => setPreviewRecord(null)}
        footer={null}
        centered
        width="auto"
        styles={{ body: { padding: 0, background: 'transparent' } }}
        closable={false}
        mask={{ closable: true }}
      >
        {previewRecord && (
          <div className="relative rounded-xl overflow-hidden bg-black">
            {previewRecord.type === 'image' && (
              <img
                src={previewRecord.cloudUrl}
                alt="预览"
                className="max-w-[80vw] max-h-[70vh] object-contain mx-auto cursor-zoom-in"
                onClick={() => {
                  // 在新标签页打开原图，实现进一步放大
                  window.open(previewRecord.cloudUrl, '_blank');
                }}
              />
            )}
            {previewRecord.type === 'video' && (
              <video
                src={previewRecord.cloudUrl}
                controls
                autoPlay
                className="max-w-[80vw] max-h-[70vh] mx-auto"
              />
            )}
            {(previewRecord.type === 'audio' || previewRecord.type === 'music') && (
              <div className="w-[360px] p-10 flex flex-col items-center justify-center bg-bg-secondary">
                <Music size={64} className="text-accent-primary mb-6" />
                <audio src={previewRecord.cloudUrl} controls className="w-full" />
                <p className="mt-4 text-sm text-text-secondary text-center line-clamp-2">
                  {previewRecord.prompt || '无提示词'}
                </p>
              </div>
            )}
            <button
              onClick={() => setPreviewRecord(null)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/40 text-white hover:bg-black/60 flex items-center justify-center z-10"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </Modal>
    </Drawer>
  );
};

const AssetRecordCard: React.FC<{
  record: GeneratedAssetRecord;
  onCopy: () => void;
  onPreview: () => void;
  formatTime: (t: number) => string;
}> = ({ record, onCopy, onPreview, formatTime }) => {
  const colors = TYPE_COLOR_CLASSES[record.type] || TYPE_COLOR_CLASSES.image;

  return (
    <div className="bg-bg-secondary rounded-lg border border-border p-3 hover:border-accent-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`w-7 h-7 rounded-md ${colors.bg} ${colors.text} flex items-center justify-center`}>
            {TYPE_ICONS[record.type]}
          </div>
          <Tag color={CATEGORY_COLORS[record.category]}>{CATEGORY_LABELS[record.category]}</Tag>
          <Tag color={colors.tag}>{TYPE_LABELS[record.type]}</Tag>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Tooltip title="查看">
            <Button
              type="text"
              size="small"
              icon={<Eye size={14} />}
              onClick={onPreview}
              className="text-text-muted hover:!text-accent-primary"
            />
          </Tooltip>
          <Tooltip title="复制云端地址">
            <Button
              type="text"
              size="small"
              icon={<Copy size={14} />}
              onClick={onCopy}
              className="text-text-muted hover:!text-accent-primary"
            />
          </Tooltip>
        </div>
      </div>

      <div className="text-sm text-text-primary mb-1.5 line-clamp-2 break-all">
        {record.prompt || '无提示词'}
      </div>

      <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
        <span className="flex items-center gap-1">
          <Clock size={12} />
          {formatTime(record.createdAt)}
        </span>
        {record.modelId && (
          <span className="bg-bg-tertiary px-1.5 py-0.5 rounded text-text-secondary">
            {record.modelId}
          </span>
        )}
      </div>
    </div>
  );
};
