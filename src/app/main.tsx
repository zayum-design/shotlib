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

import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppRouter from './AppRouter.tsx'
import { useThemeStore } from '@/shared/stores/themeStore'
import { useProjectStore } from '@/shared/stores/projectStore'

// ========== 控制台日志开关(运行时,由 .env 的 VITE_DEBUG_LOG 控制) ==========
if (import.meta.env.VITE_DEBUG_LOG !== 'true') {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
}

// ========== 在 React 渲染前初始化主题(避免闪烁) ==========
(function initThemeBeforeRender() {
  const fallback = typeof localStorage !== 'undefined'
    ? localStorage.getItem('cc_theme_fallback')
    : null;
  const theme = fallback === 'light' || fallback === 'dark' ? fallback : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
})();

// 主题初始化:同步本地偏好到 store
const ThemeInitializer = () => {
  const { isLoaded } = useThemeStore();

  useEffect(() => {
    if (isLoaded) return;
    const fallback = typeof localStorage !== 'undefined'
      ? localStorage.getItem('cc_theme_fallback')
      : null;
    if (fallback === 'light' || fallback === 'dark') {
      useThemeStore.setState({ theme: fallback, isLoaded: true });
    } else {
      useThemeStore.getState().loadFromServer();
    }
  }, [isLoaded]);

  return null;
};

// 项目列表初始化
const ProjectInitializer = () => {
  useEffect(() => {
    useProjectStore.getState().init();
    useProjectStore.getState().loadTrashedProjects();
  }, []);

  return null;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeInitializer />
    <ProjectInitializer />
    <AppRouter />
  </StrictMode>,
)
