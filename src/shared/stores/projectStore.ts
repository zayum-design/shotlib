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
import type { Project, ProjectCategory, ProjectType, AspectRatio } from '../types/project';
import { localApi } from '@/storage';

// 全局项目 ID 声明(保留与原项目一致的全局变量约定,workflow/instant 模块按需读取)
declare global {
  interface Window {
    __shotlib_current_project_id?: string;
    __shotlib_current_episode_number?: number;
  }
}

/** 将仓储项目记录映射为前端 Project */
function mapProject(p: any): Project {
  return {
    id: p.id,
    name: p.name,
    category: p.category as ProjectCategory,
    type: (p.type || 'script') as ProjectType,
    aspectRatio: (p.aspect_ratio || p.aspectRatio || '16:9') as AspectRatio,
    deletedAt: p.deleted_at,
    episodeCount: p.episode_count,
    totalDuration: p.total_duration,
    coverUrl: p.cover_url,
    description: p.description,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

type ProjectState = {
  projects: Project[];
  trashedProjects: Project[];
  currentProjectId: string | null;
  isLoading: boolean;

  init: () => Promise<void>;
  createProject: (name: string, category: ProjectCategory, type: ProjectType, aspectRatio?: AspectRatio) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'aspectRatio'>>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  restoreProject: (id: string) => Promise<void>;
  purgeProject: (id: string) => Promise<void>;
  loadTrashedProjects: () => Promise<void>;
  setCurrentProject: (id: string | null) => void;
  getCurrentProject: () => Project | undefined;
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  trashedProjects: [],
  currentProjectId: null,
  isLoading: false,

  init: async () => {
    set({ isLoading: true });
    try {
      const res = await localApi.getProjects('active');
      if (res.success) {
        const projects = (res.data || []).map(mapProject);
        set({ projects });
      }
    } catch (e) {
      console.error('[projectStore] init failed:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  createProject: async (name, category, type, aspectRatio) => {
    const id = crypto.randomUUID();
    const res = await localApi.createProject({
      id,
      name,
      category,
      type,
      aspect_ratio: aspectRatio || '16:9',
    });
    if (!res.success) {
      throw new Error(res.message || '创建项目失败');
    }
    const project = mapProject(res.data);
    set({ projects: [...get().projects, project], currentProjectId: project.id });
    return project;
  },

  updateProject: async (id, updates) => {
    const res = await localApi.updateProject(id, {
      name: updates.name,
      aspect_ratio: updates.aspectRatio,
    });
    if (!res.success) {
      throw new Error(res.message || '更新项目失败');
    }
    set({
      projects: get().projects.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    });
  },

  deleteProject: async (id) => {
    const res = await localApi.deleteProject(id);
    if (!res.success) {
      throw new Error(res.message || '删除项目失败');
    }
    const target = get().projects.find((p) => p.id === id);
    set({
      projects: get().projects.filter((p) => p.id !== id),
      trashedProjects: target ? [...get().trashedProjects, { ...target, deletedAt: new Date().toISOString() }] : get().trashedProjects,
      currentProjectId: get().currentProjectId === id ? null : get().currentProjectId,
    });
  },

  restoreProject: async (id) => {
    const res = await localApi.restoreProject(id);
    if (!res.success) {
      throw new Error(res.message || '恢复项目失败');
    }
    const target = get().trashedProjects.find((p) => p.id === id);
    set({
      trashedProjects: get().trashedProjects.filter((p) => p.id !== id),
      projects: target ? [...get().projects, { ...target, deletedAt: null }] : get().projects,
    });
  },

  purgeProject: async (id) => {
    const res = await localApi.purgeProject(id);
    if (!res.success) {
      throw new Error(res.message || '彻底删除失败');
    }
    set({ trashedProjects: get().trashedProjects.filter((p) => p.id !== id) });
  },

  loadTrashedProjects: async () => {
    const res = await localApi.getProjects('trashed');
    if (res.success) {
      set({ trashedProjects: (res.data || []).map(mapProject) });
    }
  },

  setCurrentProject: (id) => {
    set({ currentProjectId: id });
    if (typeof window !== 'undefined') {
      window.__shotlib_current_project_id = id || undefined;
    }
  },

  getCurrentProject: () => {
    const { projects, currentProjectId } = get();
    return projects.find((p) => p.id === currentProjectId);
  },
}));
