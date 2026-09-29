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
import { Drawer, Button, Card, Tag, Empty, Image } from 'antd';
import { motion } from 'framer-motion';
import {
  X,
  Clock,
  Calendar,
  Loader2,
  CheckCircle,
  AlertCircle,
  FileText,
  Image as ImageIcon,
  Video,
  ListTodo,
  Music,
  Download,
  RefreshCw,
  Square,
} from 'lucide-react';
import { useTaskQueueStore, type TaskEntry, type TaskType, type TaskStatus } from '../../stores/taskQueueStore';
import { message } from '../../utils/message';

const taskStatusColors: Record<TaskStatus, string> = {
  pending: 'default',
  running: 'processing',
  polling: 'blue',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

const taskStatusLabels: Record<TaskStatus, string> = {
  pending: '等待中',
  running: '执行中',
  polling: '生成中…',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const taskTypeLabels: Record<string, string> = {
  'script-generate': '剧本生成',
  'script-parse': '剧本解析',
  'character-avatar': '角色头像',
  'character-views': '角色多视图',
  'character-fullbody': '角色全身图',
  'character-portrait': '角色形象照',
  'character-expand': '角色扩图',
  'scene-image': '场景图像',
  'episode-generate': '片段生成',
  'episode-video': '片段视频',
  'first-frame': '首帧生成',
  'last-frame': '尾帧生成',
  'frame-expand': '首帧/尾帧扩图',
  'shot-reference': '分镜参考图',
  'shot-generation': '分镜生成',
  'music-generate': '音乐生成',
  'lyrics-generate': '歌词生成',
  'mv2-script': 'MV2剧本',
  'mv2-asset-prompts': 'MV2资产提示词',
  'mv2-analyze-lyrics': 'MV2歌词分析',
  'mv2-avatar': 'MV2头像',
  'mv2-portrait': 'MV2形象照',
  'mv2-views': 'MV2多视图',
  'mv2-scene': 'MV2场景',
  'mv2-shot': 'MV2分镜图',
  'mv2-video': 'MV2视频',
  'voice-design': '音色设计',
  'canvas-image': '画布图片',
  'canvas-text': '画布文本',
  'canvas-video': '画布视频',
  'canvas-audio': '画布音频',
};

/** 根据任务类型推导媒体类别 */
function getTaskMediaType(type: TaskType): 'text' | 'image' | 'video' | 'audio' {
  if (type.includes('video')) return 'video';
  if (type.includes('voice') || type.includes('audio')) return 'audio';
  if (
    type.includes('avatar') ||
    type.includes('scene') ||
    type.includes('frame') ||
    type.includes('shot') ||
    type.includes('portrait') ||
    type.includes('views') ||
    type.includes('fullbody') ||
    type.includes('expand') ||
    type.includes('image')
  ) {
    return 'image';
  }
  return 'text';
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
};

/** 截断文本到指定长度 */
function truncateText(text: string, maxLen = 200): string {
  if (!text || text.length <= maxLen) return text || '';
  return text.slice(0, maxLen) + '...';
}

/** 从 result 中提取可展示的内容 */
function extractResultContent(result: unknown): {
  kind: 'image' | 'video' | 'audio' | 'text' | 'none';
  urls?: string[];
  text?: string;
} {
  if (!result || typeof result !== 'object') return { kind: 'none' };
  const r = result as Record<string, unknown>;

  // 后端存储的通用资源地址（优先检查）
  if (Array.isArray(r._resourceUrls) && r._resourceUrls.length > 0) {
    const urls = r._resourceUrls as string[];
    const first = urls[0];
    if (first?.match(/\.(mp4|mov|avi|webm)$/i)) {
      return { kind: 'video', urls };
    }
    if (first?.match(/\.(mp3|wav|aac|ogg|m4a)$/i)) {
      return { kind: 'audio', urls };
    }
    return { kind: 'image', urls };
  }

  // 图片
  if (Array.isArray(r.portraitImages) && r.portraitImages.length > 0) {
    return { kind: 'image', urls: (r.portraitImages as any[]).map((img) => img.imageUrl || img).filter(Boolean) as string[] };
  }
  if (Array.isArray(r.imageUrls) && r.imageUrls.length > 0) {
    return { kind: 'image', urls: r.imageUrls as string[] };
  }
  if (typeof r.imageUrl === 'string' && r.imageUrl) {
    return { kind: 'image', urls: [r.imageUrl] };
  }
  if (typeof r.url === 'string' && r.url && (r.url.endsWith('.png') || r.url.endsWith('.jpg') || r.url.endsWith('.jpeg') || r.url.endsWith('.webp'))) {
    return { kind: 'image', urls: [r.url] };
  }

  // 视频
  if (Array.isArray(r.videoUrls) && r.videoUrls.length > 0) {
    return { kind: 'video', urls: r.videoUrls as string[] };
  }
  if (typeof r.videoUrl === 'string' && r.videoUrl) {
    return { kind: 'video', urls: [r.videoUrl] };
  }

  // 音频
  if (Array.isArray(r.audioUrls) && r.audioUrls.length > 0) {
    return { kind: 'audio', urls: r.audioUrls as string[] };
  }
  if (typeof r.audioUrl === 'string' && r.audioUrl) {
    return { kind: 'audio', urls: [r.audioUrl] };
  }

  // 文本
  if (typeof r.script === 'string' && r.script) {
    return { kind: 'text', text: r.script };
  }
  if (typeof r.text === 'string' && r.text) {
    return { kind: 'text', text: r.text };
  }
  if (typeof r.content === 'string' && r.content) {
    return { kind: 'text', text: r.content };
  }
  if (typeof r.dialogue === 'string' && r.dialogue) {
    return { kind: 'text', text: r.dialogue };
  }

  return { kind: 'none' };
}

// ==================== 任务卡片 ====================

interface TaskCardProps {
  task: TaskEntry;
}

const TaskCard: React.FC<TaskCardProps> = ({ task }) => {
  const { removeTask, retryVideoTaskHandler, cancelTask } = useTaskQueueStore();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const isActive = task.status === 'pending' || task.status === 'running' || task.status === 'polling';
  const resultContent = task.status === 'completed' ? extractResultContent(task.result) : { kind: 'none' as const };

  // 并发队列信息（来自后端 VariantConcurrencyGuard，仅在排队/生成阶段存在）
  const q = task.metadata?.queue as {
    state?: 'running' | 'queued' | 'unknown';
    position?: number;
    waitingCount?: number;
    max?: number;
    etaSeconds?: number;
  } | undefined;
  const isQueued = q?.state === 'queued';
  const isGenerating = q?.state === 'running';
  const queueLabel: string | null = isQueued && q?.position
    ? `排队中（第${q.position}位·共${q.waitingCount ?? 0}个）`
    : isGenerating
      ? '生成中…'
      : null;
  const queueColor: string | null = isQueued ? 'warning' : isGenerating ? 'processing' : null;

  // 仅「未提交模型」的任务可取消：pending（未开始）或并发守卫排队中（queued）
  const canCancel = task.status === 'pending' || isQueued;

  const handleCancel = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      const result = await cancelTask(task.id);
      if (!result.success) {
        message.warning(result.message);
        return;
      }
      message.success(result.message);
      // drama 片段视频任务：复位卡片的生成中状态，避免取消后按钮一直 loading
      const episodeId = task.metadata?.episodeId as string | undefined;
      if (episodeId) {
        try {
          const { useWorkflowStore } = await import(
            '@/modules/workflow/stores/workflowStore'
          );
          useWorkflowStore.getState().updateEpisode(episodeId, {
            isGenerating: false,
            videoGenerationProgress: 0,
            videoTaskStatus: undefined,
          });
        } catch {
          // 非 drama 上下文或 store 未加载时忽略
        }
      }
    } finally {
      setIsCancelling(false);
    }
  };

  const canRetryVideo =
    task.status === 'failed' &&
    task.type.includes('video') &&
    retryVideoTaskHandler &&
    !!(
      task.metadata?.subId ||
      task.metadata?.jobId ||
      task.metadata?.videoJobId ||
      task.metadata?.videoTaskId
    );

  const handleRetry = async () => {
    if (!retryVideoTaskHandler || isRetrying) return;
    setIsRetrying(true);
    try {
      await retryVideoTaskHandler(task);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="bg-bg-secondary border-border mb-3 hover:border-border-active transition-all">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* 状态图标 */}
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                isQueued
                  ? 'bg-orange-500/20 text-orange-500'
                  : isActive
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : task.status === 'completed'
                      ? 'bg-green-500/20 text-green-500'
                      : 'bg-red-500/20 text-red-500'
              }`}
            >
              {isActive ? (
                isQueued ? (
                  <Clock size={16} />
                ) : (
                  <Loader2 size={16} className="animate-spin" />
                )
              ) : task.status === 'completed' ? (
                <CheckCircle size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              {/* 名称 + 标签 */}
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-sm font-medium text-text-primary truncate">{task.name}</span>
                <Tag color={queueColor ?? taskStatusColors[task.status]} className="text-xs px-1.5 py-0">
                  {queueLabel ?? taskStatusLabels[task.status]}
                </Tag>
                <Tag color="purple" className="text-xs px-1.5 py-0">
                  {taskTypeLabels[task.type] || task.type}
                </Tag>
                {task.modelVariant && (
                  <Tag color="blue" className="text-xs px-1.5 py-0" title={`使用模型: ${task.modelVariant}`}>
                    {task.modelVariant}
                  </Tag>
                )}
              </div>

              {/* 时间 */}
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                  <Calendar size={11} />
                  {formatDate(task.createdAt)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {formatTime(task.createdAt)}
                </span>
                {isQueued && q?.etaSeconds ? (
                  <span className="flex items-center gap-1 text-orange-400">
                    <Clock size={11} />
                    预计还需约 {q.etaSeconds}s
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {canCancel && (
            <Button
              type="text"
              size="small"
              danger
              loading={isCancelling}
              icon={<Square size={13} />}
              className="flex-shrink-0"
              onClick={handleCancel}
              title="取消排队中的任务（未提交模型，不会计费）"
            >
              取消
            </Button>
          )}

          {canRetryVideo && (
            <Button
              type="text"
              size="small"
              loading={isRetrying}
              icon={<RefreshCw size={14} />}
              className="text-text-secondary hover:text-accent-primary flex-shrink-0"
              onClick={handleRetry}
              title="重新生成或继续轮询查询结果"
            >
              重试
            </Button>
          )}

          <Button
            type="text"
            size="small"
            icon={<X size={14} />}
            className="text-text-muted hover:text-text-primary flex-shrink-0"
            onClick={() => removeTask(task.id)}
          />
        </div>

        {/* 提示词（视频生成任务不显示） */}
        {(task.prompt || task.name) && !task.type.includes('video') && (
          <div className="mt-2 text-xs text-text-secondary bg-bg-tertiary rounded-lg p-2">
            <span className="text-text-muted mr-1">提示词:</span>
            {task.prompt || task.name}
          </div>
        )}

        {/* 生成结果 */}
        {task.status === 'failed' && task.error && (
          <div className="mt-2 text-xs text-accent-error bg-accent-error/10 p-2 rounded-lg">
            {task.error}
          </div>
        )}

        {task.status === 'completed' && resultContent.kind === 'image' && resultContent.urls && (
          <div className="mt-2 flex gap-2 flex-wrap">
            <Image.PreviewGroup>
              {resultContent.urls.map((url, idx) => (
                <Image
                  key={idx}
                  src={url}
                  alt={`结果 ${idx + 1}`}
                  className="max-w-[100px] w-auto h-auto object-contain rounded-lg border border-border"
                  preview={{ mask: false }}
                />
              ))}
            </Image.PreviewGroup>
          </div>
        )}

        {task.status === 'completed' && resultContent.kind === 'video' && resultContent.urls && (
          <div className="mt-2 space-y-2">
            {resultContent.urls.map((url, idx) => (
              <video
                key={idx}
                src={url}
                controls
                className="h-40 w-auto max-w-full rounded-lg bg-bg-tertiary"
                preload="metadata"
              />
            ))}
          </div>
        )}

        {task.status === 'completed' && resultContent.kind === 'audio' && resultContent.urls && (
          <div className="mt-2 space-y-2">
            {resultContent.urls.map((url, idx) => (
              <div key={idx} className="space-y-1">
                <audio
                  src={url}
                  controls
                  className="w-full rounded-lg"
                  preload="metadata"
                />
                <div className="flex justify-end">
                  <Button
                    size="small"
                    type="text"
                    icon={<Download size={14} />}
                    onClick={() => {
                      fetch(url)
                        .then(r => r.blob())
                        .then(blob => {
                          const a = document.createElement('a');
                          a.href = URL.createObjectURL(blob);
                          a.download = `音色_${task.name}_${idx + 1}.mp3`;
                          a.click();
                          URL.revokeObjectURL(a.href);
                        })
                        .catch(() => message.error('下载失败'));
                    }}
                  >
                    下载音频
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {task.status === 'completed' && resultContent.kind === 'text' && resultContent.text && (
          <div className="mt-2 text-xs text-text-secondary bg-bg-tertiary rounded-lg p-2 whitespace-pre-wrap">
            {truncateText(resultContent.text)}
          </div>
        )}

        {task.status === 'completed' && resultContent.kind === 'none' && (
          <div className="mt-2 text-xs text-text-muted">已完成</div>
        )}
      </Card>
    </motion.div>
  );
};

// ==================== 主组件 ====================

type MediaFilter = 'all' | 'text' | 'image' | 'video' | 'audio';

export const UserTaskPanel: React.FC = () => {
  const { tasks, isUserTaskPanelOpen, setUserTaskPanelOpen, clearCompleted, clearAll } = useTaskQueueStore();
  const [filter, setFilter] = useState<MediaFilter>('all');

  const filteredTasks = useMemo(() => {
    return tasks
      .filter((task) => {
        if (filter === 'all') return true;
        return getTaskMediaType(task.type) === filter;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [tasks, filter]);

  const counts = useMemo(() => {
    const total = tasks.length;
    const text = tasks.filter((t) => getTaskMediaType(t.type) === 'text').length;
    const image = tasks.filter((t) => getTaskMediaType(t.type) === 'image').length;
    const video = tasks.filter((t) => getTaskMediaType(t.type) === 'video').length;
    const audio = tasks.filter((t) => getTaskMediaType(t.type) === 'audio').length;
    return { total, text, image, video, audio };
  }, [tasks]);

  const filterButtons: { key: MediaFilter; label: string; icon: React.ReactNode; count: number }[] = [
    { key: 'all', label: '全部', icon: <ListTodo size={14} />, count: counts.total },
    { key: 'text', label: '文本', icon: <FileText size={14} />, count: counts.text },
    { key: 'image', label: '图片', icon: <ImageIcon size={14} />, count: counts.image },
    { key: 'video', label: '视频', icon: <Video size={14} />, count: counts.video },
    { key: 'audio', label: '音频', icon: <Music size={14} />, count: counts.audio },
  ];

  return (
    <Drawer
      title={
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-primary/20 to-accent-secondary/20 flex items-center justify-center">
            <ListTodo size={18} className="text-accent-primary" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-text-primary">生成任务历史</h3>
            <p className="text-xs text-text-muted">查看所有生成任务的提示词与结果</p>
          </div>
        </div>
      }
      placement="left"
      size={960}
      open={isUserTaskPanelOpen}
      onClose={() => setUserTaskPanelOpen(false)}
      zIndex={10000}
      className="[&_.ant-drawer-content]:bg-bg-primary [&_.ant-drawer-wrapper-body]:bg-bg-primary [&_.ant-drawer-body]:bg-bg-primary [&_.ant-drawer-header]:bg-bg-secondary [&_.ant-drawer-title]:text-text-primary [&_.ant-drawer-close]:text-text-muted [&_.ant-drawer-mask]:bg-black/60"
    >
      <div className="h-full flex flex-col">
        {/* 筛选栏 */}
        <div className="mb-4 p-3 bg-bg-secondary rounded-lg border border-border">
          <div className="flex items-center gap-2">
            {filterButtons.map((btn) => (
              <button
                key={btn.key}
                onClick={() => setFilter(btn.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  filter === btn.key
                    ? 'bg-accent-primary text-white'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-tertiary/80'
                }`}
              >
                {btn.icon}
                {btn.label}
                <span className={`ml-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] flex items-center justify-center ${
                  filter === btn.key ? 'bg-white/20 text-white' : 'bg-bg-secondary text-text-muted'
                }`}>
                  {btn.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 任务列表 */}
        <div className="flex-1 overflow-auto pr-1">
          {filteredTasks.length === 0 ? (
            <Empty
              description={
                <div className="py-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg-tertiary flex items-center justify-center">
                    <ListTodo size={32} className="text-text-muted" />
                  </div>
                  <h4 className="text-text-primary mb-2">暂无任务</h4>
                  <p className="text-text-secondary text-sm">
                    {tasks.length === 0 ? '尚未记录任何生成任务' : '没有匹配该类型的任务'}
                  </p>
                </div>
              }
            />
          ) : (
            <div className="space-y-1">
              {filteredTasks.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">共 {tasks.length} 个任务</span>
          <div className="flex items-center gap-2">
            <Button
              type="text"
              size="small"
              danger
              disabled={!tasks.some((t) => t.status === 'completed')}
              onClick={clearCompleted}
            >
              清除已完成
            </Button>
            <Button
              type="text"
              size="small"
              danger
              disabled={tasks.length === 0}
              onClick={clearAll}
            >
              清除全部
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
};
