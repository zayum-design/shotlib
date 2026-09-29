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

/**
 * workflowStore.sync.ts — 后端同步、自动保存、全局事件监听
 *
 * 此文件为聚合入口，实际逻辑已拆分到：
 * - workflowStore.sync.persist.ts — 本地持久化与保存前校验
 * - workflowStore.sync.load.ts     — 从后端加载数据
 * - workflowStore.sync.save.ts     — 后端保存与防抖保存
 * - workflowStore.sync.episode.ts  — 分集后端操作
 */
export {
  persistWorkflowState,
  hasValidWorkflowData,
  isUnsyncedImageUrl,
  hasUnsyncedImages,
} from './workflowStore.sync.persist';

export {
  loadWorkflowFromServer,
  isLoadingFromServer,
} from './workflowStore.sync.load';

export {
  saveToServer,
  saveProjectData,
  saveCharacterSceneAssets,
  saveEpisodeData,
  saveDramaEpisodeToServer,
  cancelDebouncedSave,
  debouncedSave,
  flush,
  getUnsavedChanges,
  markSaved,
  markUnsaved,
  setSaveConflictCallback,
} from './workflowStore.sync.save';

export {
  ensureDramaEpisode,
  loadDramaEpisodeFromServer,
  loadAllEpisodesFromServer,
} from './workflowStore.sync.episode';

// 静态导入用于 beforeunload 同步写 localStorage（纯函数，无循环依赖）
import { extractProjectData, extractEpisodeData } from './workflowStore.storage';
import { getProjectAssetsKey, getEpisodeDataKey, getScriptAssetKey } from '../utils/workflowUtils';
import { userStorage } from '@/shared/utils/userScopedStorage';

// ========== 自动保存机制 ==========
(async () => {
  const { useWorkflowStore } = await import('./workflowStore');
  const loadModule = await import('./workflowStore.sync.load');
  const { markUnsaved, debouncedSave } = await import('./workflowStore.sync.save');

  useWorkflowStore.subscribe(() => {
    // 使用模块命名空间引用，每次读取当前值，避免闭包捕获固定值
    if (loadModule.isLoadingFromServer) return;
    markUnsaved();
    debouncedSave(loadModule.isLoadingFromServer);
  });
})();

// ========== 全局事件监听 ==========
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    // 先阻止默认行为，显示确认对话框
    event.preventDefault();
    // @ts-ignore
    event.returnValue = '';

    // beforeunload 是同步事件，不能使用 async/await
    // 同步写 localStorage 作为备份（使用与 persistWorkflowState 相同的字段结构）
    try {
      const state = (() => {
        try {
          const wfStore = (window as any).__shotlib_workflow_store;
          return wfStore?.getState?.();
        } catch {
          return null;
        }
      })();
      if (!state) return;
      const projectId = state.currentProjectId;
      const episodeNumber = state.currentEpisodeNumber ?? 1;
      if (projectId && projectId !== 'default') {
        try {
          const assetsData = extractProjectData(state);
          assetsData.characters = state.characters;
          assetsData.scenes = state.scenes;
          assetsData.props = state.props;
          const episodeData = extractEpisodeData(state, episodeNumber);
          // 同步写入 localStorage（beforeunload 中不能用 async/IndexedDB）
          // 必须用 userStorage（带用户前缀 sl_u{id}_），与读取方 loadProjectAssetsFromStorage 一致，
          // 否则备份写到无前缀裸 key 永远读不回来
          userStorage.setItem(getProjectAssetsKey(projectId), JSON.stringify(assetsData));
          userStorage.setItem(getEpisodeDataKey(projectId, episodeNumber), JSON.stringify(episodeData));
          if (state.script) {
            userStorage.setItem(getScriptAssetKey(projectId, episodeNumber), JSON.stringify({ script: state.script }));
          }
        } catch (e) {
          console.error('[workflowStore] beforeunload localStorage backup failed:', e);
        }
      }
    } catch (e) {
      console.error('[workflowStore] beforeunload save failed:', e);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // visibilitychange 是异步友好的，浏览器会等待微任务完成后才真正隐藏页面
      (async () => {
        try {
          const { useWorkflowStore } = await import('./workflowStore');
          const state = useWorkflowStore.getState();
          const projectId = state.currentProjectId;
          const episodeNumber = state.currentEpisodeNumber ?? 1;
          if (projectId && projectId !== 'default') {
            const { persistWorkflowState } = await import('./workflowStore.sync.persist');
            const { saveToServer } = await import('./workflowStore.sync.save');
            persistWorkflowState(projectId, episodeNumber, state);
            saveToServer(state, episodeNumber);
          }
        } catch (e) {
          console.error('[workflowStore] visibilitychange save failed:', e);
        }
      })();
    }
  });
}
