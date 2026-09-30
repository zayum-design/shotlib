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

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import ProjectsPage from '@/modules/projects/ProjectsPage';
import SettingsPage from '@/settings/SettingsPage';
import { WorkflowPage } from '@/modules/workflow/pages/WorkflowPage';
import { InstantCreatePage } from '@/modules/instant/pages/InstantCreatePage';
import { GlobalFloatingButtons } from '@/shared/components/ui/GlobalFloatingButtons';
import { GlobalLoading } from '@/shared/components/ui/GlobalLoading';

export default function AppRouter() {
  return (
    <BrowserRouter>
      <App>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/workflow/:projectId" element={<WorkflowPage />} />
          <Route path="/instant" element={<InstantCreatePage />} />
          <Route path="/instant/:projectId" element={<InstantCreatePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {/* 全局浮动按钮:任务队列 + 请求日志面板(所有页面、所有构建可用) */}
        <GlobalFloatingButtons />
        {/* 全局 Loading 覆盖层:各 step 生成(剧本/审阅/分解/批量资产图等)期间的全屏遮罩,参照原项目根节点挂载 */}
        <GlobalLoading />
      </App>
    </BrowserRouter>
  );
}
