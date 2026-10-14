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

interface LoadingState {
  isOpen: boolean;
  title: string;
  description: string;
  progress: number;
  showProgress: boolean;
  /** 深度思考过程行（流式生成时逐行追加） */
  thinkingLines: string[];
}

interface LoadingActions {
  show: (options?: { title?: string; description?: string; showProgress?: boolean }) => void;
  hide: () => void;
  setProgress: (progress: number) => void;
  setDescription: (description: string) => void;
  /** 追加一行思考过程（超上限时丢弃最早行，保留最近 80 行） */
  appendThinkingLine: (line: string) => void;
  clearThinking: () => void;
}

const MAX_THINKING_LINES = 80;

export const useLoadingStore = create<LoadingState & LoadingActions>((set) => ({
  isOpen: false,
  title: '处理中...',
  description: '',
  progress: 0,
  showProgress: false,
  thinkingLines: [],

  show: (options) =>
    set({
      isOpen: true,
      title: options?.title ?? '处理中...',
      description: options?.description ?? '',
      progress: 0,
      showProgress: options?.showProgress ?? false,
      thinkingLines: [],
    }),

  hide: () =>
    set({
      isOpen: false,
      title: '处理中...',
      description: '',
      progress: 0,
      showProgress: false,
      thinkingLines: [],
    }),

  setProgress: (progress) => set({ progress: Math.min(100, Math.max(0, progress)) }),
  setDescription: (description) => set({ description }),

  appendThinkingLine: (line) =>
    set((state) => {
      const next = [...state.thinkingLines, line];
      return { thinkingLines: next.length > MAX_THINKING_LINES ? next.slice(next.length - MAX_THINKING_LINES) : next };
    }),

  clearThinking: () => set({ thinkingLines: [] }),
}));
