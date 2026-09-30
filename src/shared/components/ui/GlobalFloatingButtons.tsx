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

import { Terminal, Loader2, Eye, AlignLeft, AlignRight, ListTodo } from 'lucide-react';
import { Switch } from 'antd';
import { LogPanel } from './LogPanel';
import { UserTaskPanel } from './UserTaskPanel';
import { useLogStore } from '../../stores/logStore';
import { useTaskQueueStore } from '../../stores/taskQueueStore';
import { useApiPreviewStore } from '../../stores/apiPreviewStore';
import { usePanelPositionStore } from '../../stores/panelPositionStore';

export function GlobalFloatingButtons() {
  const { logs, setLogPanelOpen } = useLogStore();
  const { tasks, setTaskPanelOpen } = useTaskQueueStore();
  const { apiPreviewEnabled, setApiPreviewEnabled } = useApiPreviewStore();
  const { position, setPosition } = usePanelPositionStore();

  // 本地部署无权限体系:日志/预览工具在开发与部署构建下均可用
  // (预览开关的持久化由设置页 + settingsRepo 负责,这里只展示与切换)
  const showDevTools = true;

  const activeCount = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'running' || t.status === 'polling'
  ).length;
  const totalCount = tasks.length;

  const isLeft = position === 'left';
  const boxPositionClass = isLeft ? 'left-6' : 'right-6';

  // 任务按钮始终显示（所有用户、所有页面）
  const taskButton = (
    <div className="fixed bottom-6 right-6 z-[10001] pointer-events-none">
      <div className="flex items-center gap-2 pointer-events-auto">
        <button
          onClick={() => { useTaskQueueStore.getState().setUserTaskPanelOpen(true); }}
          className={`flex items-center gap-2 px-3 py-2 rounded-full shadow-lg hover:shadow-xl transition-all ${
            activeCount > 0
              ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white animate-pulse'
              : totalCount > 0
                ? 'bg-accent-primary text-white'
                : 'bg-bg-secondary/95 border border-border text-text-primary backdrop-blur-sm'
          }`}
        >
          {activeCount > 0 ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ListTodo size={14} />
          )}
          <span className="text-xs font-medium">任务({totalCount})</span>
        </button>
      </div>
    </div>
  );

  // 开发工具 box（仅开发者/管理员可见，作为额外的叠加层）
  const devToolsBox = showDevTools ? (
    <div className={`fixed bottom-20 ${boxPositionClass} z-[9998] pointer-events-none`}>
      <div className="pointer-events-auto">
        <div className="flex items-center gap-1 pl-1 pr-3 py-1.5 rounded-full bg-bg-secondary/95 border border-border shadow-lg backdrop-blur-sm">
          <button
            onClick={() => setPosition('left')}
            className={`flex items-center justify-center w-7 h-7 rounded-full transition-all ${
              isLeft
                ? 'bg-accent-primary text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary/50'
            }`}
            title="固定在左下角"
          >
            <AlignLeft size={14} />
          </button>

          <div className="w-px h-4 bg-border" />

          <button
            onClick={() => { setLogPanelOpen(true); setTaskPanelOpen(false); }}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-full hover:bg-bg-tertiary/50 transition-all"
          >
            <Terminal size={15} className="text-accent-primary" />
            <span className="text-xs font-medium text-text-primary">日志</span>
            {logs.length > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent-primary text-white text-[10px] font-bold flex items-center justify-center">
                {logs.length > 99 ? '99+' : logs.length}
              </span>
            )}
          </button>

          <div className="w-px h-4 bg-border" />

          <div className="flex items-center gap-1.5 px-2">
            <Eye size={14} className={apiPreviewEnabled ? 'text-accent-primary' : 'text-text-muted'} />
            <span className="text-[11px] text-text-muted">预览</span>
            <Switch
              size="small"
              checked={apiPreviewEnabled}
              onChange={(checked) => setApiPreviewEnabled(checked)}
            />
          </div>

          <div className="w-px h-4 bg-border" />

          <button
            onClick={() => setPosition('right')}
            className={`flex items-center justify-center w-7 h-7 rounded-full transition-all ${
              !isLeft
                ? 'bg-accent-primary text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary/50'
            }`}
            title="固定在右下角"
          >
            <AlignRight size={14} />
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {taskButton}
      {devToolsBox}
      <UserTaskPanel />
      {showDevTools && <LogPanel placement={position} />}
    </>
  );
}
