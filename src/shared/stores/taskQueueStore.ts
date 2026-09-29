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

import { create } from 'zustand';
import { userStorage } from '../utils/userScopedStorage';

const STORAGE_KEY = 'shotlib_task_queue';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 小时后清理已完成/失败任务

/** 从 result 中提取资源 URL 列表 */
function extractResourceUrls(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;

  // 优先使用已有的 _resourceUrls
  if (Array.isArray(r._resourceUrls) && r._resourceUrls.length > 0) {
    return r._resourceUrls as string[];
  }

  const urls: string[] = [];
  if (Array.isArray(r.portraitImages) && r.portraitImages.length > 0) {
    urls.push(...(r.portraitImages as any[]).map((img) => img.imageUrl || img).filter(Boolean));
  }
  if (Array.isArray(r.imageUrls)) urls.push(...(r.imageUrls as string[]));
  if (typeof r.imageUrl === 'string' && r.imageUrl) urls.push(r.imageUrl);
  if (typeof r.url === 'string' && r.url) urls.push(r.url);
  if (Array.isArray(r.videoUrls)) urls.push(...(r.videoUrls as string[]));
  if (typeof r.videoUrl === 'string' && r.videoUrl) urls.push(r.videoUrl);
  if (Array.isArray(r.audioUrls)) urls.push(...(r.audioUrls as string[]));
  if (typeof r.audioUrl === 'string' && r.audioUrl) urls.push(r.audioUrl);

  return urls.filter(Boolean);
}

/** 从 localStorage 恢复任务列表（经 userStorage 按用户隔离，避免换账号后读到其他用户的任务） */
function loadPersistedTasks(): TaskEntry[] {
  try {
    const raw = userStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: TaskEntry[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const now = Date.now();
    return parsed
      .filter((t) => {
        // 过期清理：已完成/失败超 24h 丢弃
        if (
          (t.status === 'completed' || t.status === 'failed') &&
          now - t.updatedAt > MAX_AGE_MS
        ) {
          return false;
        }
        return true;
      })
      .map((t) => {
        // 刷新后 running/polling 中断，标记为失败
        if (t.status === 'running' || t.status === 'polling') {
          return { ...t, status: 'failed' as TaskStatus, error: '页面刷新，任务中断', updatedAt: now };
        }
        // 刷新后 pending 也标记为失败（无执行上下文）
        if (t.status === 'pending') {
          return { ...t, status: 'failed' as TaskStatus, error: '页面刷新，排队任务取消', updatedAt: now };
        }
        return t;
      });
  } catch {
    return [];
  }
}

/** 保存任务到 localStorage（经 userStorage 按用户隔离） */
function saveTasksToLocalStorage(tasks: TaskEntry[]) {
  try {
    userStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {}
}

export type TaskType =
  | 'script-generate'
  | 'script-parse'
  | 'script-review'
  | 'asset-review'
  | 'episode-review'
  | 'character-avatar'
  | 'character-views'
  | 'character-fullbody'
  | 'character-portrait'
  | 'character-expand'
  | 'scene-image'
  | 'episode-generate'
  | 'episode-video'
  | 'first-frame'
  | 'last-frame'
  | 'frame-expand'
  | 'shot-reference'
  | 'shot-generation'
  | 'music-generate'
  | 'lyrics-generate'
  | 'mv2-script'
  | 'mv2-asset-prompts'
  | 'mv2-analyze-lyrics'
  | 'mv2-avatar'
  | 'mv2-portrait'
  | 'mv2-views'
  | 'mv2-scene'
  | 'mv2-shot'
  | 'mv2-video'
  | 'voice-design'
  | 'project-save'
  | 'ad2-brief'
  | 'ad2-analyze'
  | 'ad2-image'
  | 'ad2-video'
  | 'generate-image'
  | 'generate-video'
  | 'canvas-image'
  | 'canvas-text'
  | 'canvas-video'
  | 'canvas-audio';

export type TaskStatus = 'pending' | 'running' | 'polling' | 'completed' | 'failed' | 'cancelled';

export interface TaskEntry {
  id: string;
  type: TaskType;
  name: string; // 任务名称，如"生成剧本: xxx"
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  progress?: number; // 0-100
  pollCount: number; // 轮询次数
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>; // 额外信息，如 jobId, episodeId 等
  modelVariant?: string; // 模型 variant ID，用于并发控制
  prompt?: string; // 生成提示词
}

interface TaskQueueState {
  tasks: TaskEntry[];
  isTaskPanelOpen: boolean;
  isUserTaskPanelOpen: boolean;
  /** 视频任务重试回调（由具体页面注册，例如即时创作页） */
  retryVideoTaskHandler?: (task: TaskEntry) => void | Promise<void>;

  // Actions
  addTask: (task: Omit<TaskEntry, 'id' | 'createdAt' | 'updatedAt' | 'pollCount'>) => string;
  updateTask: (id: string, updates: Partial<Omit<TaskEntry, 'id' | 'createdAt'>>) => void;
  completeTask: (id: string, result?: unknown, durationMs?: number) => void;
  failTask: (id: string, error: string, durationMs?: number) => void;
  removeTask: (id: string) => void;
  /** 取消队列中尚未提交模型的任务（pending 或并发守卫排队中）；返回是否取消成功 */
  cancelTask: (id: string) => Promise<{ success: boolean; message: string }>;
  clearCompleted: () => void;
  clearAll: () => void;
  incrementPollCount: (id: string) => void;
  toggleTaskPanel: () => void;
  setTaskPanelOpen: (open: boolean) => void;
  setUserTaskPanelOpen: (open: boolean) => void;
  setRetryVideoTaskHandler: (handler?: (task: TaskEntry) => void | Promise<void>) => void;
}

/** 根据任务类型推断项目类型 */
function inferProjectType(type: TaskType): string {
  if (type.startsWith('drama-')) return 'drama';
  if (type.startsWith('music-') || type === 'lyrics-generate') return 'music';
  if (type.startsWith('mv2-')) return 'mv2';
  if (type.startsWith('novel-')) return 'novel';
  if (type.startsWith('canvas-')) return 'infinite-canvas';
  // drama 核心类型（不以 drama- 开头但属于 drama 项目）
  if (
    type === 'script-generate' || type === 'script-parse' || type === 'script-review' || type === 'asset-review' || type === 'episode-review' ||
    type.startsWith('character-') || type.startsWith('scene-') ||
    type.startsWith('episode-') || type.startsWith('shot-') ||
    type === 'first-frame' || type === 'last-frame' || type === 'frame-expand' ||
    type === 'voice-design'
  ) return 'drama';
  return 'unknown';
}

export const useTaskQueueStore = create<TaskQueueState>((set, get) => ({
  tasks: loadPersistedTasks(),
  isTaskPanelOpen: false,
  isUserTaskPanelOpen: false,

  addTask: (task) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const now = Date.now();
    const newTask: TaskEntry = {
      ...task,
      id,
      createdAt: now,
      updatedAt: now,
      pollCount: 0,
    };
    set((state) => ({ tasks: [...state.tasks, newTask] }));

    // 开源版：任务仅保存在浏览器本地（localStorage），不再同步后端任务历史
    return id;
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t
      ),
    }));
  },

  completeTask: (id, result, durationMs) => {
    void durationMs; // 开源版无后端任务历史,耗时不再上报
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? { ...t, status: 'completed' as TaskStatus, result, updatedAt: Date.now(), progress: 100 }
          : t
      ),
    }));
  },

  failTask: (id, error, durationMs) => {
    void durationMs; // 开源版无后端任务历史,耗时不再上报
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? { ...t, status: 'failed' as TaskStatus, error, updatedAt: Date.now() }
          : t
      ),
    }));
  },

  removeTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    }));
  },

  cancelTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return { success: false, message: '任务不存在' };

    // 仅允许取消「未提交模型」的任务：pending（未开始）或并发守卫排队中（queued）
    const queueInfo = task.metadata?.queue as { state?: string } | undefined;
    const isCancellable =
      task.status === 'pending' || queueInfo?.state === 'queued';
    if (!isCancellable) {
      return { success: false, message: '任务已开始生成，无法取消' };
    }

    // 本地标记取消：轮询循环以 status !== 'polling' 为终止条件，自动停止
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? { ...t, status: 'cancelled' as TaskStatus, updatedAt: Date.now() }
          : t,
      ),
    }));

    return { success: true, message: '任务已取消' };
  },

  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.status !== 'completed'),
    }));
  },

  clearAll: () => {
    set({ tasks: [] });
  },

  incrementPollCount: (id) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? { ...t, pollCount: t.pollCount + 1, updatedAt: Date.now(), status: 'polling' as TaskStatus }
          : t
      ),
    }));
  },

  toggleTaskPanel: () => {
    set((state) => ({ isTaskPanelOpen: !state.isTaskPanelOpen }));
  },

  setTaskPanelOpen: (open) => {
    set({ isTaskPanelOpen: open });
  },

  setUserTaskPanelOpen: (open) => {
    set({ isUserTaskPanelOpen: open });
  },

  setRetryVideoTaskHandler: (handler) => {
    set({ retryVideoTaskHandler: handler });
  },
}));

// 每次 tasks 变化自动持久化到 localStorage
useTaskQueueStore.subscribe((state) => {
  saveTasksToLocalStorage(state.tasks);
});

// 便捷 hook：获取活跃任务数量
export const useActiveTaskCount = () =>
  useTaskQueueStore((state) => state.tasks.filter((t) => t.status === 'pending' || t.status === 'running' || t.status === 'polling').length);

/** 获取指定 variant 正在运行/轮询中的任务数（并发占用） */
export function getRunningCountByVariant(variantId: string): number {
  return useTaskQueueStore.getState().tasks.filter(
    (t) => t.modelVariant === variantId && (t.status === 'running' || t.status === 'polling'),
  ).length;
}

/** 检查 variant 是否还能提交新任务 */
export function canSubmitForVariant(variantId: string, maxConcurrency: number): boolean {
  return getRunningCountByVariant(variantId) < maxConcurrency;
}

/** 获取指定 variant 的活跃任务数 */
export const useVariantActiveCount = (variantId: string) =>
  useTaskQueueStore((state) =>
    state.tasks.filter(
      (t) => t.modelVariant === variantId && (t.status === 'pending' || t.status === 'running' || t.status === 'polling'),
    ).length,
  );
