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

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Empty, Progress, Tabs, Radio, Select, Tooltip } from 'antd';
import { Clapperboard, Download, Play, Copy, Film, Square, Plus, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWorkflowStore, setSkipPreview, shouldPreview, triggerPreview } from '../../stores/workflowStore';
import { useProjectStore } from '@/shared/stores/projectStore';
import { EpisodeCard } from '@/shared/components/ui/EpisodeCard';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { concurrentBatchExecute } from '@/shared/utils/concurrentBatch';
import { message } from '@/shared/utils/message';
import { getEpisodeVideoUrl } from '../../utils/workflowUtils';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface EpisodeGenerateProps {
  onTabChange?: (episodeId: string, index: number) => void;
  initialEpisodeId?: string;
  /** 跳转到下一步（视频合成） */
  onNextStep?: () => void;
}

/** 可拖拽排序的片段 tab 包裹器（基于 @dnd-kit useSortable，自动处理让位动画与拖动跟随） */
const SortableTabWrapper: React.FC<{
  id: string;
  showNewBadge?: boolean;
  children: React.ReactNode;
}> = ({ id, showNewBadge, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: 'relative',
        cursor: 'grab',
      }}
    >
      {showNewBadge && (
        <span className="absolute -top-1.5 -right-1.5 z-20 text-[9px] font-bold leading-none px-1.5 py-0.5 rounded-full bg-red-500 text-white shadow pointer-events-none">新</span>
      )}
      {children}
    </div>
  );
};

export const EpisodeGenerate: React.FC<EpisodeGenerateProps> = ({ onTabChange, initialEpisodeId, onNextStep }) => {
  const {
    characters,
    scenes,
    episodes: rawEpisodes,
    videoModels: allVideoModels,
    episodeMaxDuration,
    generateEpisodeVideo,
    getEpisodeVideoPreviewData,
    addEpisode,
    reorderEpisodes,
    activeCharacterIds,
    activeSceneIds,
    currentEpisodeNumber,
  } = useWorkflowStore();

  // 按片段总时长过滤视频模型：30s 仅保留 model.json 中 duration.max >= 30 的长片段模型
  const videoModels = useMemo(() => {
    const maxTotal = episodeMaxDuration === 30 ? 30 : 15;
    if (maxTotal <= 15) return allVideoModels;
    return allVideoModels.filter((m) => (m.duration?.max ?? 15) >= maxTotal);
  }, [allVideoModels, episodeMaxDuration]);

  // 防御：按 id 去重 + 过滤软删除（deleted）片段，避免重复 id 导致 tab 异常，且已删除片段不显示/不导出/不参与批量
  const episodes = useMemo(() => {
    const seen = new Set<string>();
    return (rawEpisodes || []).filter((ep) => {
      if (ep.deleted) return false;
      if (!ep.id || seen.has(ep.id)) return false;
      seen.add(ep.id);
      return true;
    });
  }, [rawEpisodes]);

  // 按当前分集活跃ID过滤（兼容旧数据）
  const displayedCharacters = activeCharacterIds?.length
    ? characters.filter(c => activeCharacterIds.includes(c.id))
    : characters;
  const displayedScenes = activeSceneIds?.length
    ? scenes.filter(s => activeSceneIds.includes(s.id))
    : scenes;

  const aspectRatio = useProjectStore((s) => {
    const project = s.projects.find((p) => p.id === s.currentProjectId);
    return project?.aspectRatio || '16:9';
  });
  
  const [activeEpisodeTab, setActiveEpisodeTab] = useState<string>(() => {
    if (initialEpisodeId && episodes.some(ep => ep.id === initialEpisodeId)) {
      return initialEpisodeId;
    }
    return episodes.length > 0 ? episodes[0].id : '';
  });

  // 当前会话新增的片段 id（用于显示 new 角标，仅内存态、不持久化）
  const [newEpisodeIds, setNewEpisodeIds] = useState<Set<string>>(new Set());

  // 片段 tab 拖拽排序（@dnd-kit）：PointerSensor 移动 5px 才触发拖动，避免误触发点击切换
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const episodeIds = useMemo(() => episodes.map((e) => e.id), [episodes]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const from = episodeIds.indexOf(String(active.id));
        const to = episodeIds.indexOf(String(over.id));
        if (from !== -1 && to !== -1) reorderEpisodes(from, to);
      }
    },
    [episodeIds, reorderEpisodes]
  );
  const handleDragCancel = useCallback(() => setActiveDragId(null), []);

  // 包装 setActiveEpisodeTab，在 tab 变化时同步 shot 到 URL
  const handleTabChange = useCallback((tabId: string) => {
    setActiveEpisodeTab(tabId);
    const index = episodes.findIndex(ep => ep.id === tabId);
    if (index !== -1) {
      onTabChange?.(tabId, index + 1);
    }
  }, [episodes, onTabChange]);

  // 添加空白片段并自动切换到新 tab
  const handleAddEpisode = useCallback(() => {
    const newId = addEpisode();
    setActiveEpisodeTab(newId);
    setNewEpisodeIds((prev) => new Set(prev).add(newId));
    onTabChange?.(newId, episodes.length + 1);
  }, [addEpisode, episodes.length, onTabChange]);

  // 判断是否可以导出剪映草稿（所有片段都有生成的视频）
  const canExportToJianYing = episodes.every(
    ep => ep.generatedVideoUrl || (ep.generatedVideos?.length ?? 0) > 0
  );

  // 导出剪映草稿(开源版禁用:原版由服务端生成剪映草稿包,已随后端移除)
  const handleExportToJianYing = async () => {
    void canExportToJianYing;
    void episodes;
    message.warning('开源版不支持导出剪映草稿(需服务端支持),请逐段下载片段视频');
  };

  // 批量生成控制
  const abortBatchRef = useRef<AbortController | null>(null);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);  // 批量生成统一使用的视频模型（默认第一个可用模型，videoModels 异步加载后兜底赋值）
  const [batchVideoModel, setBatchVideoModel] = useState<string>('');
  useEffect(() => {
    // 当前选择仍可用（含 30s 过滤后的列表）则保持，否则回退到第一个可用模型
    if (batchVideoModel && videoModels.some((m) => m.id === batchVideoModel && !m.disabled)) return;
    const first = videoModels.find((m) => !m.disabled);
    if (first?.id && first.id !== batchVideoModel) setBatchVideoModel(first.id);
  }, [videoModels, batchVideoModel]);

  // 批量执行（预览确认通过后调用）
  const executeBatchGenerate = useCallback(async () => {
    const ungeneratedEpisodes = episodes.filter(ep => !ep.generatedVideoUrl);
    if (ungeneratedEpisodes.length === 0) return;
    // 批量统一未生成片段的视频模型为下拉框选择的模型
    // （首尾帧/参考图/纯文本三种模式均基于 episode.model 解析，故覆盖 model 即可统一）
    if (batchVideoModel) {
      ungeneratedEpisodes.forEach((ep) => {
        if (ep.model !== batchVideoModel) {
          useWorkflowStore.getState().updateEpisode(ep.id, { model: batchVideoModel });
        }
      });
    }
    abortBatchRef.current = new AbortController();
    setIsBatchGenerating(true);
    setSkipPreview(true);
    const { setTaskPanelOpen } = useTaskQueueStore.getState();
    setTaskPanelOpen(true);
    message.success(`已添加 ${ungeneratedEpisodes.length} 个视频生成任务到队列，将按各模型并发数处理`);
    try {
      // 并发提交：按选中的批量模型分组、按其 concurrentLimit 滑动窗口（soft 限流，
      // 防瞬间打爆 BFF）。所有片段投入后端队列；真正的"同时生成数 ≤ concurrentLimit"
      // 由后端 VariantConcurrencyGuard（仅 Bull processor 内 acquire）保证。
      await concurrentBatchExecute(
        ungeneratedEpisodes,
        (ep) => batchVideoModel || ep.model,
        async (ep) => {
          if (abortBatchRef.current?.signal.aborted) return;
          await generateEpisodeVideo(ep.id);
        },
        videoModels,
      );
    } finally {
      setSkipPreview(false);
      setIsBatchGenerating(false);
      abortBatchRef.current = null;
    }
  }, [episodes, batchVideoModel, videoModels, generateEpisodeVideo]);

  // 批量生成所有片段视频
  const handleBatchGenerate = async () => {
    const ungeneratedEpisodes = episodes.filter(ep => !ep.generatedVideoUrl);
    if (ungeneratedEpisodes.length === 0) {
      message.warning('所有片段视频已生成');
      return;
    }

    // 收集所有片段的预览请求数据
    const previewItems: Array<{ endpoint: string; body: any }> = [];
    for (const episode of ungeneratedEpisodes) {
      const data = getEpisodeVideoPreviewData(episode.id);
      if (data) {
        previewItems.push(data);
      }
    }

    if (shouldPreview() && previewItems.length > 0) {
      triggerPreview(previewItems, executeBatchGenerate);
      return;
    }

    await executeBatchGenerate();
  };

  // 停止批量生成
  const handleStopBatchGenerate = () => {
    abortBatchRef.current?.abort();
    setIsBatchGenerating(false);
    message.info('已停止批量生成');
  };

  // 复制所有提示词
  const handleCopyAllPrompts = () => {
    const prompts = episodes.map(ep =>
      `【${ep.title}】\n视频提示词: ${ep.videoPrompt}\n使用模型: ${ep.model}`
    ).join('\n\n');

    navigator.clipboard.writeText(prompts).then(() => {
      message.success('所有提示词已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  };

  // 导出提示词为文本文件
  const handleExportPrompts = () => {
    const content = episodes.map(ep =>
      `【${ep.title}】\n描述: ${ep.description}\n视频提示词: ${ep.videoPrompt}\n使用模型: ${ep.model}\n状态: ${ep.generatedVideoUrl ? '已生成视频' : '待生成'}`
    ).join('\n\n' + '─'.repeat(50) + '\n\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `片段提示词_${new Date().toLocaleDateString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('提示词已导出');
  };

  // 当片段数据变化时，确保当前选中的tab有效
  // 注意：此 useEffect 必须在所有 early return 之前调用，避免不同渲染次数导致 React error #310
  // 优先使用 initialEpisodeId（URL scene 参数），不存在时再回退到第一个片段
  useEffect(() => {
    if (episodes.length === 0) return;
    if (episodes.some(ep => ep.id === activeEpisodeTab)) return;

    const target = initialEpisodeId && episodes.some(ep => ep.id === initialEpisodeId)
      ? initialEpisodeId
      : episodes[0].id;
    if (target !== activeEpisodeTab) {
      setActiveEpisodeTab(target);
    }
  }, [episodes, activeEpisodeTab, initialEpisodeId]);

  if (displayedCharacters.length === 0 && displayedScenes.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="请先完成剧本分解"
        className="text-text-muted"
      />
    );
  }

  // 统计信息（与 step5 判定一致：当前视频或历史视频均算已生成）
  const generatedCount = episodes.filter(ep => !!getEpisodeVideoUrl(ep)).length;
  const totalCount = episodes.length;
  const progressPercent = totalCount > 0 ? Math.round((generatedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* 片段列表 */}
      {episodes.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-4"
        >
          {/* 统计和操作栏 */}
          <div className="bg-bg-tertiary rounded-lg p-4 max-md:p-3">
            <div className="flex items-center justify-between mb-4 max-md:flex-col max-md:items-start max-md:gap-3">
              <div className="flex items-center gap-4">
                <Clapperboard size={24} className="text-accent-primary" />
                <div>
                  <span className="text-text-primary font-medium">
                    共 {totalCount} 个片段
                  </span>
                  <span className="text-text-secondary ml-2">
                    （已生成 {generatedCount} 个视频）
                  </span>
                  {/* 非首集：分镜生成已自动参考上集结尾状态（后端连续性锚点） */}
                  {currentEpisodeNumber > 1 && (
                    <Tooltip title="本集分镜生成时已自动注入上一集的结尾定格状态，保证集间画面连续">
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border text-accent-primary border-accent-primary/40 bg-accent-primary/10 cursor-help">
                        已参考上集结尾状态
                      </span>
                    </Tooltip>
                  )}
                </div>
              </div>

              <div className="flex gap-2 max-md:w-full">
                <Button
                  size="small"
                  onClick={handleCopyAllPrompts}
                  icon={<Copy size={14} />}
                  className="bg-bg-secondary border-border"
                >
                  复制提示词
                </Button>
                <Button
                  size="small"
                  onClick={handleExportPrompts}
                  icon={<Download size={14} />}
                  className="bg-bg-secondary border-border"
                >
                  导出提示词
                </Button>
                <Button
                  size="small"
                  onClick={handleExportToJianYing}
                  icon={<Download size={14} />}
                  disabled={!canExportToJianYing}
                  className="bg-bg-secondary border-border"
                >
                  导出剪映草稿
                </Button>
              </div>
            </div>

            {/* 进度条 */}
            <Progress
              percent={progressPercent}
              strokeColor={{ from: '#6366f1', to: '#8b5cf6' }}
              trailColor="#2e2e3d"
              size="small"
            />

            {/* 项目画面比例 */}
            <div className="flex items-center gap-3 mt-4 pb-3 border-b border-border/50 max-md:flex-wrap">
              <span className="text-sm text-text-secondary">项目画面比例:</span>
              <Radio.Group value={aspectRatio} disabled>
                <Radio.Button value="16:9">16:9</Radio.Button>
                <Radio.Button value="9:16">9:16</Radio.Button>
                <Radio.Button value="21:9">21:9</Radio.Button>
                <Radio.Button value="1:1">1:1</Radio.Button>
              </Radio.Group>
            </div>

            {/* 批量操作 */}
            <div className="flex items-center justify-between mt-4 max-md:flex-col max-md:items-start max-md:gap-3">
              <div className="flex items-center gap-3 max-md:flex-wrap">
                <span className="text-sm text-text-secondary">
                  {generatedCount === totalCount
                    ? '✓ 所有片段视频已生成完成'
                    : `还有 ${totalCount - generatedCount} 个片段待生成视频`}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">分辨率：</span>
                  <Radio.Group
                    value={episodes[0]?.videoResolution || '720p'}
                    onChange={(e) => {
                      const resolution = e.target.value;
                      episodes.forEach((ep) => {
                        useWorkflowStore.getState().updateEpisode(ep.id, { videoResolution: resolution });
                      });
                    }}
                    size="small"
                    disabled={episodes.some(ep => ep.isGenerating)}
                  >
                    <Radio.Button value="720p">720p</Radio.Button>
                    <Radio.Button value="1080p">1080p</Radio.Button>
                  </Radio.Group>
                </div>
              </div>
              <div className="flex items-center gap-2 max-md:w-full max-md:flex-wrap">
                <Select
                  size="small"
                  value={batchVideoModel}
                  onChange={setBatchVideoModel}
                  popupMatchSelectWidth={false}
                  className="w-40 max-md:w-full"
                  options={videoModels.map((m) => ({
                    value: m.id,
                    label: <span className="text-xs">{m.name}</span>,
                    disabled: m.disabled,
                  }))}
                />
                {isBatchGenerating ? (
                  <Button
                    type="primary"
                    danger
                    onClick={handleStopBatchGenerate}
                    icon={<Square size={16} />}
                    className="bg-red-500 border-0"
                  >
                    停止生成
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    onClick={handleBatchGenerate}
                    disabled={!batchVideoModel || generatedCount === totalCount || episodes.some(ep => ep.isGenerating)}
                    loading={episodes.some(ep => ep.isGenerating)}
                    icon={<Play size={16} />}
                    className="bg-accent-success border-0"
                  >
                    批量生成视频
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* 片段 Tabs */}
          <div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
          <SortableContext items={episodeIds} strategy={horizontalListSortingStrategy}>
          <Tabs
            key={episodes.map((e) => e.id).join(',')}
            activeKey={activeEpisodeTab}
            onChange={handleTabChange}
            className="episode-tabs"
            type="card"
            renderTabBar={(props, DefaultTabBar) => (
              <DefaultTabBar {...props}>
                {(node: React.ReactNode) => {
                  const episodeId = String((node as React.ReactElement).key ?? '');
                  return (
                    <SortableTabWrapper key={episodeId} id={episodeId} showNewBadge={newEpisodeIds.has(episodeId)}>
                      {node}
                    </SortableTabWrapper>
                  );
                }}
              </DefaultTabBar>
            )}
            tabBarExtraContent={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddEpisode}
                  title="添加片段"
                  className="w-7 h-7 rounded-full flex items-center justify-center bg-accent-primary text-white hover:bg-accent-primary/85 shadow-sm transition-all cursor-pointer"
                >
                  <Plus size={14} />
                </button>
              </div>
            }
            items={episodes.map((episode, index) => ({
              key: episode.id,
              label: (
                <div className="flex items-center gap-2">
                  <Film size={14} />
                  <span>片段{index + 1}</span>
                  {episode.generatedVideoUrl && (
                    <span className="w-2 h-2 rounded-full bg-accent-success" />
                  )}
                </div>
              ),
              children: (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full"
                >
                  <EpisodeCard episode={episode} />
                </motion.div>
              ),
            }))}
          />
          </SortableContext>
          <DragOverlay>
            {activeDragId ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border border-accent-primary rounded shadow-lg">
                <Film size={14} />
                <span>{episodes.find((e) => e.id === activeDragId)?.title || '片段'}</span>
              </div>
            ) : null}
          </DragOverlay>
          </DndContext>
          </div>

          {/* 下一步：至少一个片段视频已生成即可进入视频合成 */}
          {generatedCount > 0 && onNextStep && (
            <div className="flex justify-end pt-2">
              <Button
                type="primary"
                size="large"
                onClick={onNextStep}
                icon={<ArrowRight size={16} />}
                className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
              >
                下一步：视频合成
              </Button>
            </div>
          )}
        </motion.div>
      ) : (
        <div className="text-center py-12 text-text-muted">
          <Clapperboard size={48} className="mx-auto mb-4 opacity-50" />
          <p>点击上方按钮生成片段</p>
        </div>
      )}

    </div>
  );
};
