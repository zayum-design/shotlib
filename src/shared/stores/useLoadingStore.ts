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
}

interface LoadingActions {
  show: (options?: { title?: string; description?: string; showProgress?: boolean }) => void;
  hide: () => void;
  setProgress: (progress: number) => void;
  setDescription: (description: string) => void;
}

export const useLoadingStore = create<LoadingState & LoadingActions>((set) => ({
  isOpen: false,
  title: '处理中...',
  description: '',
  progress: 0,
  showProgress: false,

  show: (options) =>
    set({
      isOpen: true,
      title: options?.title ?? '处理中...',
      description: options?.description ?? '',
      progress: 0,
      showProgress: options?.showProgress ?? false,
    }),

  hide: () =>
    set({
      isOpen: false,
      title: '处理中...',
      description: '',
      progress: 0,
      showProgress: false,
    }),

  setProgress: (progress) => set({ progress: Math.min(100, Math.max(0, progress)) }),
  setDescription: (description) => set({ description }),
}));
