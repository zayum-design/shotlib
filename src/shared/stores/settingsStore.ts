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

export type RemoteStorageProvider = 'amazon' | 'aliyun' | null;

interface SettingsState {
  remoteStorage: RemoteStorageProvider;
  isLoaded: boolean;
  setRemoteStorage: (provider: RemoteStorageProvider) => void;
  loadFromServer: () => Promise<void>;
  saveToServer: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  remoteStorage: null,
  isLoaded: false,

  setRemoteStorage: (provider) => {
    set({ remoteStorage: provider });
    // 自动保存到后端
    get().saveToServer();
  },

  loadFromServer: async () => {
    try {
      const response = await localApi.getUserPreference();
      if (response.success && response.data?.settings) {
        const settings = response.data.settings;
        set({
          remoteStorage: settings.remoteStorage || null,
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch (e) {
      console.error('[settingsStore] load failed:', e);
      set({ isLoaded: true });
    }
  },

  saveToServer: async () => {
    const { remoteStorage } = get();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('cc_settings_fallback', JSON.stringify({ remoteStorage }));
    }
    try {
      await localApi.saveUserPreference({
        settings: { remoteStorage },
      });
    } catch (e) {
      console.error('[settingsStore] save failed:', e);
    }
  },
}));
