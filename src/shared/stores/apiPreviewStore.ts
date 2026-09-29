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

interface ApiPreviewState {
  apiPreviewEnabled: boolean;
  setApiPreviewEnabled: (enabled: boolean) => void;
}

export const useApiPreviewStore = create<ApiPreviewState>()(
  persist(
    (set) => ({
      apiPreviewEnabled: true,
      setApiPreviewEnabled: (enabled) => set({ apiPreviewEnabled: enabled }),
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
