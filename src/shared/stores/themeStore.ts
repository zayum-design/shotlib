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
import { localApi } from '@/storage';

type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  isLoaded: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  loadFromServer: () => Promise<void>;
  saveToServer: () => Promise<void>;
}

/** 应用主题(持久化到本地偏好;loadFromServer/saveToServer 命名保留以兼容调用点) */
export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'dark',
  isLoaded: false,

  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    set({ theme: newTheme });
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', newTheme);
    }
    get().saveToServer();
  },

  setTheme: (theme) => {
    set({ theme });
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    get().saveToServer();
  },

  loadFromServer: async () => {
    try {
      // localStorage 兜底优先(无登录体系,本地即真相)
      const fallback = typeof localStorage !== 'undefined' ? localStorage.getItem('cc_theme_fallback') : null;
      const response = await localApi.getUserPreference();
      const theme = ((response.success && response.data?.theme) || fallback || get().theme) as Theme;
      set({ theme, isLoaded: true });
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('cc_theme_fallback', theme);
      }
    } catch (e) {
      console.error('[themeStore] load failed:', e);
      set({ isLoaded: true });
    }
  },

  saveToServer: async () => {
    const { theme } = get();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('cc_theme_fallback', theme);
    }
    try {
      await localApi.saveUserPreference({ theme });
    } catch (e) {
      console.error('[themeStore] save failed:', e);
    }
  },
}));
