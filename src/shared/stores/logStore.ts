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

export type LogLevel = 'info' | 'success' | 'error' | 'warning';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: string; // 来源，如 'api-request', 'ai-model'
  model?: string; // 模型名称
  vendor?: string; // 模型厂商
  url?: string; // 请求URL
  method?: string; // 请求方法
  request?: unknown; // 请求数据
  response?: unknown; // 响应数据（后端包装格式）
  rawResponse?: unknown; // 原始模型请求返回的 JSON 结果
  error?: unknown; // 错误信息
  message: string; // 简短描述
  duration?: number; // 请求耗时（毫秒）
  pollCount?: number; // 轮询合并计数(同 URL GET 连续调用时累计)
}

interface LogState {
  logs: LogEntry[];
  maxLogs: number;
  isLogPanelOpen: boolean;

  // Actions
  addLog: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  setMaxLogs: (max: number) => void;
  toggleLogPanel: () => void;
  setLogPanelOpen: (open: boolean) => void;
}

export const useLogStore = create<LogState>((set, _get) => ({
  logs: [],
  maxLogs: 100,
  isLogPanelOpen: false,

  addLog: (entry) => {
    const newEntry: LogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      timestamp: Date.now(),
    };

    set((state) => {
      // 新日志插入到头部，确保最新的始终在最上面
      const newLogs = [newEntry, ...state.logs];
      // 限制日志数量，超出时从尾部删除最旧的
      if (newLogs.length > state.maxLogs) {
        newLogs.splice(state.maxLogs);
      }
      return { logs: newLogs };
    });

    // 原始日志落盘:上报本地部署服务的 POST /logs(serve.mjs / vite dev 写入 logs/web/日期/小时.log)
    // 失败静默(非本地部署或服务未启动时 404/网络错),不阻塞 UI
    void fetch('/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newEntry),
    }).catch(() => {});
  },

  clearLogs: () => {
    set({ logs: [] });
  },

  setMaxLogs: (max) => {
    set({ maxLogs: max });
  },

  toggleLogPanel: () => {
    set((state) => ({ isLogPanelOpen: !state.isLogPanelOpen }));
  },

  setLogPanelOpen: (open) => {
    set({ isLogPanelOpen: open });
  },
}));