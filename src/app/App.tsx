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

import { useEffect } from 'react';
import { ConfigProvider, theme as antdTheme, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useLocation } from 'react-router-dom';
import { useThemeStore } from '@/shared/stores/themeStore';
import { useProjectStore } from '@/shared/stores/projectStore';

/**
 * 全局 Provider 宿主:antd 主题(暗/亮) + 中文语境 + message 上下文绑定。
 * 同时负责从 URL 解析 projectId 同步到 projectStore
 * (用 pathname 而非 useParams,避免与 zustand 状态更新竞态)。
 */
export default function App({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  const location = useLocation();

  // /workflow/:projectId 路由 → 同步当前项目 ID
  useEffect(() => {
    const workflowMatch = location.pathname.match(/^\/workflow\/([a-zA-Z0-9-]+)/);
    const instantMatch = location.pathname.match(/^\/instant\/([a-zA-Z0-9-]+)/);
    const projectId = workflowMatch?.[1] || instantMatch?.[1] || null;
    const { currentProjectId, setCurrentProject } = useProjectStore.getState();
    if (projectId !== currentProjectId) {
      setCurrentProject(projectId);
    }
  }, [location.pathname]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#3b82f6',
          borderRadius: 6,
        },
      }}
    >
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
