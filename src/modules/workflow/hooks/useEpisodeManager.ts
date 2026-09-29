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

import { useState, useCallback } from 'react';
import { Modal } from 'antd';
import {
  useWorkflowStore,
  saveToServer,
} from '@/modules/workflow/stores/workflowStore';
import {
  flush as flushSave,
  setEpisodeDataVersion,
} from '@/modules/workflow/stores/workflowStore.sync.save';
import {
  loadWorkflowFromServer,
  type WorkflowLoadResult,
} from '@/modules/workflow/stores/workflowStore.sync.load';
import { localApi } from '@/storage';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { saveGuard } from '@/modules/workflow/utils/workflowSaveGuard';
import { message } from '@/shared/utils/message';

export interface EpisodeManagerOptions {
  setSearchParams?: (
    updater: (prev: URLSearchParams) => URLSearchParams,
    options?: { replace?: boolean },
  ) => void;
}

export function useEpisodeManager(
  projectId: string | undefined,
  options: EpisodeManagerOptions = {},
) {
  const { setSearchParams } = options;
  const [currentEpisode, setCurrentEpisode] = useState(1);
  const [episodeList, setEpisodeList] = useState<number[]>([1]);
  const [episodeIdMap, setEpisodeIdMap] = useState<Record<number, string>>({});
  const [isSwitchingEpisode, setIsSwitchingEpisode] = useState(false);

  const { setCurrentEpisodeNumber } = useWorkflowStore();

  // 获取项目分集列表和当前分集信息
  const getProjectEpisodeInfo = useCallback((pid: string) => {
    try {
      const key = `shotlib_episode_list_${pid}`;
      const saved = userStorage.getItem(key);
      if (saved) {
        return JSON.parse(saved) as {
          episodes: number[];
          currentEpisode: number;
          episodeIdMap?: Record<number, string>;
        };
      }
    } catch (e) {
      console.error('Failed to read episode list:', e);
    }
    return null;
  }, []);

  const saveProjectEpisodeInfo = useCallback(
    (
      pid: string,
      episodes: number[],
      currentEp: number,
      idMap?: Record<number, string>,
    ) => {
      try {
        const key = `shotlib_episode_list_${pid}`;
        userStorage.setItem(
          key,
          JSON.stringify({ episodes, currentEpisode: currentEp, episodeIdMap: idMap }),
        );
      } catch (e) {
        console.error('Failed to save episode list:', e);
      }
    },
    [],
  );

  // 保存指定分集的数据（完整保存：项目级 + 角色/场景 + 分集级）
  const saveEpisodeData = useCallback(
    async (pid: string, episodeNumber: number): Promise<boolean> => {
      const state = useWorkflowStore.getState();
      // 同步全局变量到 store
      useWorkflowStore.setState({
        currentProjectId: pid,
        currentEpisodeNumber: episodeNumber,
      });
      const success = await saveToServer({ ...state, currentProjectId: pid, currentEpisodeNumber: episodeNumber }, episodeNumber);
      if (!success) {
        console.warn(`[useEpisodeManager] 保存第${episodeNumber}集失败`);
      }
      return success;
    },
    [],
  );

  // 从后端加载项目分集列表
  const loadDramaEpisodesFromServer = useCallback(
    async (pid: string): Promise<Record<number, string>> => {
      try {
        const response = await localApi.getDramaEpisodes(pid);
        if (response.success && Array.isArray(response.data)) {
          const dramaEpisodes = response.data as any[];
          const newEpisodeList: number[] = [];
          const newIdMap: Record<number, string> = {};
          for (const ep of dramaEpisodes) {
            newEpisodeList.push(ep.episode_number);
            newIdMap[ep.episode_number] = ep.id;
          }
          if (!newIdMap[1]) {
            console.log('[useEpisodeManager] 后端无第1集，自动创建...');
            try {
              const createRes = await localApi.createDramaEpisode({
                project_id: pid,
                episode_number: 1,
                title: '第1集',
              });
              if (createRes.success && createRes.data?.id) {
                newEpisodeList.unshift(1);
                newIdMap[1] = createRes.data.id;
              }
            } catch (createErr) {
              console.error('[useEpisodeManager] 自动创建第1集失败:', createErr);
            }
          }
          if (newEpisodeList.length > 0) {
            setEpisodeList(newEpisodeList);
            setEpisodeIdMap(newIdMap);
            saveProjectEpisodeInfo(pid, newEpisodeList, currentEpisode, newIdMap);
            return newIdMap;
          }
        }
      } catch (e) {
        console.error('[useEpisodeManager] 从后端加载分集列表失败:', e);
      }
      setEpisodeList([1]);
      setEpisodeIdMap({});
      try {
        const createRes = await localApi.createDramaEpisode({
          project_id: pid,
          episode_number: 1,
          title: '第1集',
        });
        if (createRes.success && createRes.data?.id) {
          const newIdMap = { 1: createRes.data.id };
          setEpisodeIdMap(newIdMap);
          saveProjectEpisodeInfo(pid, [1], 1, newIdMap);
          return newIdMap;
        }
      } catch (createErr) {
        console.error('[useEpisodeManager] 自动创建第1集失败:', createErr);
      }
      saveProjectEpisodeInfo(pid, [1], 1, {});
      return {};
    },
    [currentEpisode, saveProjectEpisodeInfo],
  );

  // ========== 核心：根据实际数据校准 currentStep ==========
  function calibrateCurrentStep(
    currentStep: number,
    episodes: any[],
    activeCharacterIds: any[],
    activeSceneIds: any[],
    isSimplifiedMode: boolean,
  ): number {
    const hasEpisodes = Array.isArray(episodes) && episodes.length > 0;
    const hasActiveCharScene = (activeCharacterIds?.length ?? 0) > 0 || (activeSceneIds?.length ?? 0) > 0;
    const targetForEpisodes = isSimplifiedMode ? 2 : 3;
    const targetForSplit = isSimplifiedMode ? 1 : 2;

    let step = currentStep;
    if (hasEpisodes && step < targetForEpisodes) step = targetForEpisodes;
    else if (hasActiveCharScene && step < targetForSplit) step = targetForSplit;
    return step;
  }

  // ========== 核心：从 WorkflowLoadResult 构建 setState 数据 ==========
  function buildSetStateFromLoadResult(
    result: WorkflowLoadResult,
    pid: string,
    targetEpisode: number,
  ): Record<string, any> {
    // 记录分集数据版本号（保存时作为 expectedVersion 检测跨端冲突）
    setEpisodeDataVersion(result.episodeDataVersion);
    const ep = result.episodeData;
    const isSimplified = ep.isSimplifiedMode ?? (targetEpisode !== 1);
    return {
      // 项目级字段
      ...result.projectData,
      characters: result.characters,
      scenes: result.scenes,
      // 道具同为项目级资产，与角色/场景一同从服务端恢复（复用）
      props: result.props,
      // 分集级字段（显式赋值，防止空 episodeData 时上一集数据残留）
      // currentStep 根据实际数据校准，避免有片段但 step 不可点击
      currentStep: calibrateCurrentStep(
        ep.currentStep ?? 0,
        ep.episodes ?? [],
        ep.activeCharacterIds ?? [],
        ep.activeSceneIds ?? [],
        isSimplified,
      ),
      topic: ep.topic ?? '',
      summary: ep.summary ?? '',
      previousEpisodeScript: targetEpisode === 1 ? '' : (ep.previousEpisodeScript ?? ''),
      previousEpisodeSummary: targetEpisode === 1 ? '' : (ep.previousEpisodeSummary ?? ''),
      previousEpisodeFragments: targetEpisode === 1 ? [] : (ep.previousEpisodeFragments ?? []),
      isEnding: ep.isEnding ?? false,
      isSimplifiedMode: isSimplified,
      activeCharacterIds: ep.activeCharacterIds ?? [],
      activeSceneIds: ep.activeSceneIds ?? [],
      activePropIds: ep.activePropIds ?? [],
      episodes: ep.episodes ?? [],
      composedVideoUrl: ep.composedVideoUrl ?? '',
      script: result.script ?? '',
      // 上下文标识
      currentProjectId: pid,
      currentEpisodeNumber: targetEpisode,
      // 加载状态清零
      isGeneratingScript: false,
      isParsingScript: false,
      isGeneratingEpisodes: false,
    };
  }

  // ========== 核心：视频任务恢复 ==========
  function recoverVideoTasks(result: WorkflowLoadResult, projId: string) {
    if (result.episodesNeedRecovery.length === 0) return;
    console.log(`[episodeManager] 检测到 ${result.episodesNeedRecovery.length} 个片段有未完成的视频任务，自动恢复轮询`);

    for (const { id: epId, videoTaskId } of result.episodesNeedRecovery) {
      setTimeout(async () => {
        const { useTaskQueueStore } = await import('@/shared/stores/taskQueueStore');
        const wfStore = useWorkflowStore;
        const ep = wfStore.getState().episodes.find((e) => e.id === epId);
        if (!ep || ep.videoTaskId !== videoTaskId || ep.generatedVideoUrl) return;

        const tqState = useTaskQueueStore.getState();
        const existingTasks = tqState.tasks.filter(
          (t) => t.type === 'episode-video' && (t.metadata?.episodeId === epId || t.metadata?.subId === epId),
        );
        let taskQueueTaskId: string | undefined;

        if (existingTasks.length > 0) {
          const latestTask = existingTasks.sort((a, b) => b.createdAt - a.createdAt)[0];
          taskQueueTaskId = latestTask.id;
          if (latestTask.status === 'failed') {
            tqState.updateTask(taskQueueTaskId, { status: 'running', error: undefined });
          }
        } else {
          taskQueueTaskId = tqState.addTask({
            type: 'episode-video',
            name: `生成视频: ${ep.title || '片段'}`,
            status: 'running',
            modelVariant: ep.model,
            metadata: { episodeId: epId, projectId: projId, videoTaskId },
          });
        }

        wfStore.getState().pollVideoTaskStatus(epId, videoTaskId, taskQueueTaskId).catch((err: unknown) => {
          console.warn(`[episodeManager] 恢复片段 ${epId} 视频轮询失败:`, err instanceof Error ? err.message : err);
        });
      }, 1000);
    }
  }

  // ========== 切换分集：flush → load → 一次性替换 ==========
  const handleSwitchEpisode = useCallback(
    async (episodeNumber: number) => {
      if (useWorkflowStore.getState().isImporting) {
        message.warning('正在导入中，请稍候');
        return;
      }
      if (episodeNumber === currentEpisode || isSwitchingEpisode) return;

      const pid = projectId;
      if (!pid) return;

      // 冻结 UI
      setIsSwitchingEpisode(true);

      try {
        // 步骤 1：flush 当前分集数据
        const flushed = await flushSave();
        if (!flushed) {
          console.warn('[handleSwitchEpisode] flush 失败，继续切换');
        }

        // 步骤 2：从后端加载目标分集数据
        const result = await loadWorkflowFromServer(pid, 'drama', episodeNumber);

        if (!result) {
          // 后端加载失败，设置空分集状态
          useWorkflowStore.setState({
            currentProjectId: pid,
            currentEpisodeNumber: episodeNumber,
            currentStep: 0,
            topic: '',
            script: '',
            summary: '',
            previousEpisodeScript: '',
            previousEpisodeSummary: '',
            episodes: [],
            composedVideoUrl: '',
            isEnding: false,
            isSimplifiedMode: episodeNumber !== 1,
            activeCharacterIds: [],
            activeSceneIds: [],
            activePropIds: [],
            isGeneratingScript: false,
            isParsingScript: false,
            isGeneratingEpisodes: false,
          });
        } else {
          // 步骤 3：一次性 setState 替换
          useWorkflowStore.setState(buildSetStateFromLoadResult(result, pid, episodeNumber));

          // 恢复视频任务
          recoverVideoTasks(result, pid);

          // 更新 episodeIdMap
          if (Object.keys(result.episodeIdMap).length > 0) {
            setEpisodeIdMap(result.episodeIdMap);
          }
        }

        // 更新本地状态
        setCurrentEpisodeNumber(episodeNumber);
        setCurrentEpisode(episodeNumber);
        saveProjectEpisodeInfo(pid, episodeList, episodeNumber, episodeIdMap);

        // 同步 URL
        try {
          const url = new URL(window.location.href);
          if (episodeNumber === 1) {
            url.searchParams.delete('episode');
          } else {
            url.searchParams.set('episode', String(episodeNumber));
          }
          url.searchParams.set('step', '1');
          url.searchParams.delete('scene');
          url.searchParams.delete('shot');
          window.history.replaceState(window.history.state, '', url.toString());
        } catch (e) {
          console.warn('[handleSwitchEpisode] URL 更新失败:', e);
        }
        setSearchParams?.(
          () => {
            const next = new URLSearchParams(window.location.search);
            if (episodeNumber === 1) {
              next.delete('episode');
            } else {
              next.set('episode', String(episodeNumber));
            }
            next.set('step', '1');
            next.delete('scene');
            next.delete('shot');
            return next;
          },
          { replace: true },
        );

        // 清除 SaveGuard 快照
        saveGuard.clearSnapshot();
      } catch (e) {
        console.error('[handleSwitchEpisode] 切换分集失败:', e);
        message.error('切换分集失败，请重试');
      } finally {
        setTimeout(() => setIsSwitchingEpisode(false), 300);
      }
    },
    [
      currentEpisode,
      isSwitchingEpisode,
      projectId,
      episodeList,
      episodeIdMap,
      saveProjectEpisodeInfo,
      setCurrentEpisodeNumber,
      setSearchParams,
    ],
  );

  // ========== 删除分集：后端软删除 + 重新加载 ==========
  const handleDeleteEpisode = useCallback(
    (episodeNumber: number) => {
      if (useWorkflowStore.getState().isImporting) {
        message.warning('正在导入中，请稍候');
        return;
      }
      if (episodeNumber === 1) {
        message.warning('第1集不能删除');
        return;
      }

      const pid = projectId;
      if (!pid) return;

      // 高危删除二次确认：第一层提醒 → 第二层最终确认
      Modal.confirm({
        title: `确认删除第${episodeNumber}集？`,
        content:
          '⚠️ 高危操作：将永久删除该分集及其所有片段、片段数据、剧本、分集图片、快照和生成任务记录，删除后无法恢复。',
        okText: '继续',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          Modal.confirm({
            title: `再次确认删除第${episodeNumber}集？`,
            content: '这是最后一次确认，删除后该分集所有数据将无法恢复！',
            okText: '确认删除',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: async () => {
              setIsSwitchingEpisode(true);

              try {
                // flush 当前数据
                await flushSave();

                // 后端彻底删除（分集/片段/片段数据/剧本/分集图片/快照/生成任务）
                const eid = episodeIdMap[episodeNumber];
                if (eid) {
                  try {
                    await localApi.deleteDramaEpisode(eid);
                    console.log(`[handleDeleteEpisode] 后端分集已删除: ${eid}`);
                  } catch (e) {
                    console.error('[handleDeleteEpisode] 后端分集删除失败:', e);
                  }
                }

                // 清除该集的 localStorage 缓存
                try {
                  const storageKey = `shotlib_episode_data_${pid}_${episodeNumber}`;
                  userStorage.removeItem(storageKey);
                } catch (e) {
                  console.error('删除分集缓存失败:', e);
                }

                // 更新分集列表
                const newIdMap = { ...episodeIdMap };
                delete newIdMap[episodeNumber];
                setEpisodeIdMap(newIdMap);

                const newEpisodeList = episodeList.filter((ep) => ep !== episodeNumber);
                setEpisodeList(newEpisodeList);

                // 切换到前一集
                const prevEpisode = episodeList.filter((ep) => ep < episodeNumber).pop() || 1;

                // 从后端重新加载目标分集
                const result = await loadWorkflowFromServer(pid, 'drama', prevEpisode);
                if (result) {
                  useWorkflowStore.setState(buildSetStateFromLoadResult(result, pid, prevEpisode));
                  recoverVideoTasks(result, pid);
                } else {
                  useWorkflowStore.setState({
                    currentProjectId: pid,
                    currentEpisodeNumber: prevEpisode,
                    currentStep: 0,
                    topic: '',
                    script: '',
                    summary: '',
                    previousEpisodeScript: '',
                    previousEpisodeSummary: '',
                    episodes: [],
                    composedVideoUrl: '',
                    isEnding: false,
                    isSimplifiedMode: prevEpisode !== 1,
                    activeCharacterIds: [],
                    activeSceneIds: [],
                    activePropIds: [],
                    isGeneratingScript: false,
                    isParsingScript: false,
                    isGeneratingEpisodes: false,
                  });
                }

                setCurrentEpisode(prevEpisode);
                setCurrentEpisodeNumber(prevEpisode);
                saveProjectEpisodeInfo(pid, newEpisodeList, prevEpisode, newIdMap);
                saveGuard.clearSnapshot();
                message.success(`第${episodeNumber}集已删除`);
              } catch (e) {
                console.error('[handleDeleteEpisode] 删除分集失败:', e);
                message.error('删除分集失败');
              } finally {
                setTimeout(() => setIsSwitchingEpisode(false), 300);
              }
            },
          });
        },
      });
    },
    [
      projectId,
      episodeList,
      episodeIdMap,
      saveProjectEpisodeInfo,
      setCurrentEpisodeNumber,
    ],
  );

  // ========== 新建分集：isEnding 校验 + flush → 创建 → 加载 ==========
  const handleCreateNewEpisode = useCallback(async () => {
    if (useWorkflowStore.getState().isImporting) {
      message.warning('正在导入中，请稍候');
      return;
    }
    const pid = projectId;
    if (!pid) {
      message.warning('请先选择项目');
      return;
    }

    const currentState = useWorkflowStore.getState();

    // isEnding 前置校验
    if (currentState.isEnding) {
      message.warning('大结局后不能新建分集');
      return;
    }

    setIsSwitchingEpisode(true);

    try {
      // 步骤 1：flush 当前分集数据
      const flushed = await flushSave();
      if (!flushed) {
        console.warn('[handleCreateNewEpisode] flush 失败，继续创建');
      }

      // 步骤 2：计算新分集号
      const newEpisodeNumber = Math.max(...episodeList, 0) + 1;

      // 步骤 3：后端创建新分集
      let newEpisodeId = '';
      try {
        const response = await localApi.createDramaEpisode({
          project_id: pid,
          episode_number: newEpisodeNumber,
          title: `第${newEpisodeNumber}集`,
        });
        if (response.success && response.data?.id) {
          newEpisodeId = response.data.id;
        } else {
          message.error(`创建分集失败: ${response.message || '未知错误'}`);
          return;
        }
      } catch (e) {
        console.error('[handleCreateNewEpisode] 后端分集创建失败:', e);
        message.error('创建分集失败，请检查网络');
        return;
      }

      // 步骤 4：从后端加载新分集数据（可能是空的）
      const result = await loadWorkflowFromServer(pid, 'drama', newEpisodeNumber);

      if (result) {
        // 一次性 setState 替换
        // 关键：新建分集时不加载 characters/scenes 到 store
        // 角色和场景应在剧本生成→剧本解析后，从资产库匹配或新建
        useWorkflowStore.setState({
          // 项目级字段（保持不变）
          ...result.projectData,
          characters: result.characters,
          scenes: result.scenes,
          // 道具同为项目级资产，新建分集时从服务端恢复（复用）
          props: result.props,
          // 分集级字段初始化
          currentProjectId: pid,
          currentEpisodeNumber: newEpisodeNumber,
          currentStep: 0,
          topic: '',
          script: result.script || '',
          summary: '',
          previousEpisodeSummary: currentState.summary,
          // 续写上下文：保留上一集完整剧本 + 逐片段概述（标题+详细描述），
          // 供下一集剧本生成时还原上一集完整剧情脉络
          previousEpisodeScript: currentState.script || '',
          previousEpisodeFragments: (currentState.episodes || [])
            .filter(
              (e: { deleted?: boolean }) => !e?.deleted,
            )
            .map((e: { title?: string; description?: string }) => ({
              title: e?.title || '',
              description: e?.description || '',
            })),
          episodes: [],  // 新建分集无片段数据，强制为空
          composedVideoUrl: '',
          isEnding: false,
          isSimplifiedMode: true,
          activeCharacterIds: [],
          activeSceneIds: [],
          activePropIds: [],
          isGeneratingScript: false,
          isParsingScript: false,
          isGeneratingEpisodes: false,
        });
      } else {
        // 加载失败，手动构建初始状态
        useWorkflowStore.setState({
          currentProjectId: pid,
          currentEpisodeNumber: newEpisodeNumber,
          currentStep: 0,
          topic: '',
          script: '',
          summary: '',
          previousEpisodeSummary: currentState.summary,
          previousEpisodeScript: currentState.script || '',
          previousEpisodeFragments: (currentState.episodes || [])
            .filter(
              (e: { deleted?: boolean }) => !e?.deleted,
            )
            .map((e: { title?: string; description?: string }) => ({
              title: e?.title || '',
              description: e?.description || '',
            })),
          episodes: [],
          composedVideoUrl: '',
          isEnding: false,
          isSimplifiedMode: true,
          activeCharacterIds: [],
          activeSceneIds: [],
          activePropIds: [],
          isGeneratingScript: false,
          isParsingScript: false,
          isGeneratingEpisodes: false,
        });
      }

      // 步骤 5：保存新分集的初始数据到后端
      const newState = useWorkflowStore.getState();
      await saveToServer(newState, newEpisodeNumber);

      // 步骤 6：更新本地状态和 localStorage
      const newIdMap = { ...episodeIdMap, [newEpisodeNumber]: newEpisodeId };
      const newEpisodeList = [...episodeList, newEpisodeNumber];
      setEpisodeList(newEpisodeList);
      setCurrentEpisode(newEpisodeNumber);
      setEpisodeIdMap(newIdMap);
      setCurrentEpisodeNumber(newEpisodeNumber);
      saveProjectEpisodeInfo(pid, newEpisodeList, newEpisodeNumber, newIdMap);

      // 步骤 7：同步 URL
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('episode', String(newEpisodeNumber));
        url.searchParams.set('step', '1');
        url.searchParams.delete('scene');
        url.searchParams.delete('shot');
        window.history.replaceState(window.history.state, '', url.toString());
      } catch (e) {
        console.warn('[handleCreateNewEpisode] URL 更新失败:', e);
      }

      saveGuard.clearSnapshot();
      message.success(`第${newEpisodeNumber}集创建成功`);
    } catch (e) {
      console.error('[handleCreateNewEpisode] 创建分集失败:', e);
      message.error('创建分集失败');
    } finally {
      setTimeout(() => setIsSwitchingEpisode(false), 300);
    }
  }, [
    projectId,
    episodeList,
    episodeIdMap,
    saveProjectEpisodeInfo,
    setCurrentEpisodeNumber,
  ]);

  return {
    currentEpisode,
    setCurrentEpisode,
    episodeList,
    setEpisodeList,
    episodeIdMap,
    setEpisodeIdMap,
    isSwitchingEpisode,
    loadDramaEpisodesFromServer,
    saveEpisodeData,
    handleSwitchEpisode,
    handleDeleteEpisode,
    handleCreateNewEpisode,
    getProjectEpisodeInfo,
    saveProjectEpisodeInfo,
  };
}
