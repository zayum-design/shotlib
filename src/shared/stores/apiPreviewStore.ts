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
import { persist } from 'zustand/middleware';
import { settingsRepo } from '@/storage';

interface ApiPreviewState {
  apiPreviewEnabled: boolean;
  setApiPreviewEnabled: (enabled: boolean) => void;
  /** 从 settingsRepo 同步初始状态(默认 false) */
  syncFromSettings: () => Promise<void>;
}

export const useApiPreviewStore = create<ApiPreviewState>()(
  persist(
    (set) => ({
      apiPreviewEnabled: false,
      setApiPreviewEnabled: (enabled) => {
        set({ apiPreviewEnabled: enabled });
        // 与 settingsRepo 保持一致,设置页开关和 store 双向同步
        void settingsRepo.save({ showPreviewRequestDialog: enabled });
      },
      syncFromSettings: async () => {
        const s = await settingsRepo.get();
        set({ apiPreviewEnabled: s.showPreviewRequestDialog === true });
      },
    }),
    {
      name: 'shotlib_api_preview_enabled',
      partialize: (state) => ({ apiPreviewEnabled: state.apiPreviewEnabled }),
    },
  ),
);

/** 非 React 环境获取 preview 状态 */
export function getApiPreviewEnabled(): boolean {
  return useApiPreviewStore.getState().apiPreviewEnabled;
}

/** 非 React 环境设置 preview 状态 */
export function setApiPreviewEnabled(enabled: boolean): void {
  useApiPreviewStore.getState().setApiPreviewEnabled(enabled);
}

/** 非 React 环境从 settingsRepo 同步 */
export function syncApiPreviewFromSettings(): Promise<void> {
  return useApiPreviewStore.getState().syncFromSettings();
}
