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

import type { InstantProjectData } from '@/shared/types/project';
import { userStorage } from '@/shared/utils/userScopedStorage';

// 即时创作数据与 workflowStore 共享同一个 key，字段名加前缀避免冲突
const getInstantDataKey = (projectId: string) =>
  `shotlib_workflow_drama_instant_${projectId}`;

// 标记本地存在尚未同步到服务器的修改
const getInstantDirtyKey = (projectId: string) =>
  `shotlib_workflow_drama_instant_dirty_${projectId}`;

/** 标记本地数据为脏（存在未同步到服务器的修改）— 使用时间戳，便于检测保存期间的新修改 */
export const markInstantDirty = (projectId: string | undefined) => {
  if (!projectId) return;
  try {
    userStorage.setItem(getInstantDirtyKey(projectId), String(Date.now()));
  } catch (e) {
    console.error('Failed to mark instant data dirty:', e);
  }
};

/** 清除本地脏标记（服务器保存成功后调用） */
export const clearInstantDirty = (projectId: string | undefined) => {
  if (!projectId) return;
  try {
    userStorage.removeItem(getInstantDirtyKey(projectId));
  } catch (e) {
    console.error('Failed to clear instant data dirty flag:', e);
  }
};

/** 读取当前脏标记的时间戳，用于保存前后比对（无脏标记返回 null） */
export const readInstantDirtyMark = (projectId: string | undefined): string | null => {
  if (!projectId) return null;
  try {
    return userStorage.getItem(getInstantDirtyKey(projectId));
  } catch (e) {
    console.error('Failed to read instant data dirty mark:', e);
    return null;
  }
};

/** 仅当脏标记未变化时清除（保存期间用户未做新修改）— 防止竞态导致数据丢失 */
export const clearInstantDirtyIfUnchanged = (
  projectId: string | undefined,
  expectedMark: string | null,
) => {
  if (!projectId) return;
  try {
    const current = userStorage.getItem(getInstantDirtyKey(projectId));
    if (current === expectedMark) {
      userStorage.removeItem(getInstantDirtyKey(projectId));
    }
  } catch (e) {
    console.error('Failed to clear instant data dirty flag:', e);
  }
};

/** 判断本地数据是否脏（即是否存在未同步到服务器的修改） */
export const isInstantDirty = (projectId: string | undefined): boolean => {
  if (!projectId) return false;
  try {
    return !!userStorage.getItem(getInstantDirtyKey(projectId));
  } catch (e) {
    console.error('Failed to read instant data dirty flag:', e);
    return false;
  }
};

export const loadInstantData = (
  projectId: string | undefined
): InstantProjectData | null => {
  if (!projectId) return null;
  try {
    const raw = userStorage.getItem(getInstantDataKey(projectId));
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load instant data:', e);
  }
  return null;
};

export const saveInstantData = (
  projectId: string | undefined,
  data: InstantProjectData
) => {
  if (!projectId) return;
  try {
    const key = getInstantDataKey(projectId);
    // 合并而不是覆盖，保留 workflowStore 等其他数据
    const existingRaw = userStorage.getItem(key);
    const existing = existingRaw ? JSON.parse(existingRaw) : {};
    const merged = { ...existing, ...data };
    const cleaned = cleanGeneratingState(merged);
    userStorage.setItem(key, JSON.stringify(cleaned));
    markInstantDirty(projectId);
  } catch (e) {
    console.error('Failed to save instant data:', e);
  }
};

// 清理临时生成状态（不应持久化到 localStorage）
// 使用 any 类型以保留 workflowStore 的其他字段
export const cleanGeneratingState = (data: any): any => ({
  ...data,
  instantCharacters: (data.instantCharacters || []).map((c: any) => ({
    ...c,
    isGeneratingAvatar: false,
    isGeneratingViews: false,
  })),
  instantScenes: (data.instantScenes || []).map((s: any) => ({
    ...s,
    isGenerating: false,
  })),
  instantSegments: (data.instantSegments || []).map((s: any) => ({
    ...s,
    canvasItems: (s.canvasItems || []).map((item: any) => ({
      ...item,
      isGeneratingVideo: false,
      isGeneratingShots: false,
      isGeneratingFirstFrame: false,
      isGeneratingLastFrame: false,
    })),
  })),
});

export const persistInstantData = (
  projectId: string | undefined,
  patch: Partial<InstantProjectData>
) => {
  if (!projectId) return;
  try {
    const key = getInstantDataKey(projectId);
    const existingRaw = userStorage.getItem(key);
    const existing: InstantProjectData = existingRaw
      ? JSON.parse(existingRaw)
      : { instantCharacters: [], instantScenes: [], instantSegments: [] };
    const merged = { ...existing, ...patch };
    // 保存前清理临时生成状态
    const cleaned = cleanGeneratingState(merged);
    userStorage.setItem(key, JSON.stringify(cleaned));
    markInstantDirty(projectId);
  } catch (e) {
    console.error('Failed to persist instant data:', e);
  }
};

