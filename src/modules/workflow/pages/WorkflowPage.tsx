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

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Modal, message } from 'antd';
import { WorkflowPageHeader } from '@/modules/workflow/components/WorkflowPageHeader';
import { WorkflowEpisodeTabs } from '@/modules/workflow/components/WorkflowEpisodeTabs';
import { WorkflowMainContent } from '@/modules/workflow/components/WorkflowMainContent';
import { GlobalAssetsModal } from '@/modules/workflow/components/GlobalAssetsModal';
import { useWorkflowStore, setWorkflowPreviewRequestCallback, loadWorkflowFromServer as loadFromServer, setSaveConflictCallback, getUnsavedChanges } from '@/modules/workflow/stores/workflowStore';
import { flush as flushSave, clearEpisodeDataVersion } from '@/modules/workflow/stores/workflowStore.sync.save';
import { loadWorkflowFromCache } from '@/modules/workflow/stores/workflowStore.storage';
import { saveGuard } from '@/modules/workflow/utils/workflowSaveGuard';
import { getEpisodeVideoUrl } from '@/modules/workflow/utils/workflowUtils';
import { useEpisodeManager } from '@/modules/workflow/hooks/useEpisodeManager';
import { useWorkflowSync } from '@/modules/workflow/hooks/useWorkflowSync';
import { useWorkflowNavigation } from '@/modules/workflow/hooks/useWorkflowNavigation';
import { useWorkflowImport } from '@/modules/workflow/hooks/useWorkflowImport';
import { usePreviewRequest } from '@/shared/hooks/usePreviewRequest';
import { PreviewRequestModal } from '@/shared/components/ui/PreviewRequestModal';
import { useProjectStore } from '@/shared/stores/projectStore';
import { useApiPreviewStore } from '@/shared/stores/apiPreviewStore';

import { FileText, Film, Layers, Clapperboard, Combine } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const steps = [
  {
    id: 0,
    title: '剧本输入',
    description: '输入话题或上传剧本文件',
    icon: FileText,
  },
  {
    id: 1,
    title: '剧本编辑',
    description: '查看与编辑生成的剧本',
    icon: Film,
  },
  {
    id: 2,
    title: '剧本分解',
    description: '解析角色、场景与故事背景',
    icon: Layers,
  },
  {
    id: 3,
    title: '片段生成',
    description: '生成片段视频提示词',
    icon: Clapperboard,
  },
  {
    id: 4,
    title: '视频合成',
    description: '合并片段视频为完整短片',
    icon: Combine,
  },
];

export function WorkflowPage() {
  const {
    currentStep, setCurrentStep, textModel, setTextModel, script,
    parseScript, isParsingScript, isGeneratingScript, generateEpisodes,
    isGeneratingEpisodes, episodes, textModels, loadModels, resetLoadingStates,
    checkPendingVideoTasks,
    characters, scenes, isSimplifiedMode, setSimplifiedMode,
    activeCharacterIds, activeSceneIds,
    currentProjectId: storeProjectId,
    setCurrentProjectId: setStoreProjectId,
    setCurrentEpisodeNumber: setStoreEpisodeNumber,
  } = useWorkflowStore();

  // 导入锁状态（用于 UI 守卫）
  const isImporting = useWorkflowStore((s) => s.isImporting);
  const { currentProjectId, getCurrentProject, init: initProjectStore } = useProjectStore();
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string }>();
  const { projectId: paramProjectId } = params;
  const [searchParams, setSearchParams] = useSearchParams();
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;

  // Hooks 提取的分集管理、同步和导航逻辑
  const projectId = paramProjectId || currentProjectId || undefined;

  // 从 URL 初始化 currentEpisode（仅在首次渲染时执行一次）
  const urlEpisodeParam = searchParams.get('episode');
  const initialEpisode = urlEpisodeParam ? parseInt(urlEpisodeParam, 10) : 1;

  // 供 URL episode 监听 effect 使用的 episode 参数（提取到 effect 外部以满足 ESLint 依赖检查）
  const urlEpisodeParamForEffect = searchParams.get('episode');

  // 跟踪挂载状态，防止首次渲染时 URL sync effect 覆盖 URL 参数
  const isInitialMount = useRef(true);

  // 标记是否为用户主动点击分集 Tab 触发的切换，避免 URL 监听 effect 重复处理
  const isUserSwitchingEpisodeRef = useRef(false);

  // 标记 URL episode 监听 effect 的首次挂载，避免与主加载 effect 重复加载
  const isUrlEpisodeSyncInitialMount = useRef(true);

  const {
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
  } = useEpisodeManager(projectId, { setSearchParams });

  const {
    localCurrentStep,
    setLocalCurrentStep,
    activeSceneId,
    setActiveSceneId,
    stepToPanel,
    handleSimplifiedStepChange,
    handleSceneChange,
  } = useWorkflowNavigation(currentEpisode);

  const {
    isSyncing,
    handleDownloadData,
    buildCompleteProjectData,
  } = useWorkflowSync(projectId);

  const onDownloadData = useCallback(() => {
    handleDownloadData(episodeList, currentEpisode, episodeIdMap, setEpisodeList, setEpisodeIdMap, setCurrentEpisode);
  }, [handleDownloadData, episodeList, currentEpisode, episodeIdMap, setEpisodeList, setEpisodeIdMap, setCurrentEpisode]);

  // 保存状态：saved | saving | unsaved
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');

  // 转无限画布流程状态
  // 注册保存冲突回调
  useEffect(() => {
    setSaveConflictCallback((message) => {
      Modal.confirm({
        title: '保存冲突',
        content: message,
        okText: '强制覆盖',
        cancelText: '刷新重试',
        onOk: () => {
          const pid = useWorkflowStore.getState().currentProjectId;
          if (pid) {
            // 强制覆盖：清除本地版本基准，本次保存不带 expectedVersion，直接覆盖服务端
            clearEpisodeDataVersion();
            saveEpisodeData(pid, currentEpisode);
          }
        },
        onCancel: () => {
          window.location.reload();
        },
      });
    });
  }, [currentEpisode, saveEpisodeData]);

  // 定期轮询未保存状态
  useEffect(() => {
    const interval = setInterval(() => {
      const unsaved = getUnsavedChanges();
      setSaveStatus(unsaved ? 'unsaved' : 'saved');
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // 同步当前项目/分集标识到 workflowStore，替代 window 全局变量
  useEffect(() => {
    if (projectId && projectId !== 'default' && projectId !== storeProjectId) {
      setStoreProjectId(projectId);
    }
  }, [projectId, storeProjectId, setStoreProjectId]);

  useEffect(() => {
    setStoreEpisodeNumber(currentEpisode);
  }, [currentEpisode, setStoreEpisodeNumber]);

  // 根据当前分集强制同步简化模式：第2集+强制简化模式
  useEffect(() => {
    const expected = currentEpisode !== 1;
    if (isSimplifiedMode !== expected) {
      setSimplifiedMode(expected);
    }
  }, [currentEpisode, isSimplifiedMode, setSimplifiedMode]);

  // 同步 episode 到 URL
  // 关键修复：切换/新建分集时重置 step 为 1，并删除 scene/shot
  // 首次挂载时跳过，防止覆盖 URL 中已有的 episode/step 参数
  // 使用 ref 保存 setSearchParams，避免 URL 变化导致 setSearchParams 引用变化而误触发
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // 分集切换时强制重置 step 为 1，并清除 scene/shot
    // 同时使用 router 和原生 history，确保 URL 在所有场景下都同步
    try {
      const url = new URL(window.location.href);
      if (currentEpisode === 1) {
        url.searchParams.delete('episode');
      } else {
        url.searchParams.set('episode', String(currentEpisode));
      }
      url.searchParams.set('step', '1');
      url.searchParams.delete('scene');
      url.searchParams.delete('shot');
      window.history.replaceState(window.history.state, '', url.toString());
    } catch (e) {
      console.warn('[WorkflowPage] 原生 history URL 更新失败:', e);
    }
    setSearchParamsRef.current(() => {
      // 使用 window.location.search 作为基准，避免 React Router 的 prev 参数为旧值
      const next = new URLSearchParams(window.location.search);
      if (currentEpisode === 1) {
        next.delete('episode');
      } else {
        next.set('episode', String(currentEpisode));
      }
      next.set('step', '1');
      next.delete('scene');
      next.delete('shot');
      return next;
    }, { replace: true });
  }, [currentEpisode]);

  // 监听 URL episode 参数变化（浏览器前进/后退、地址栏直接修改），同步 currentEpisode 并加载数据
  // 分集切换时统一重置 step 为 1
  useEffect(() => {
    // 跳过首次挂载（由主加载 effect 处理）
    if (isUrlEpisodeSyncInitialMount.current) {
      isUrlEpisodeSyncInitialMount.current = false;
      return;
    }
    if (!projectId) return;
    if (isSwitchingEpisode) return;

    // 如果刚刚由用户点击 Tab 触发切换，handleSwitchEpisode 已处理，这里跳过避免重复
    if (isUserSwitchingEpisodeRef.current) {
      isUserSwitchingEpisodeRef.current = false;
      return;
    }

    const targetEpisode = urlEpisodeParamForEffect ? parseInt(urlEpisodeParamForEffect, 10) : 1;

    if (targetEpisode !== currentEpisode) {
      console.log(`[WorkflowPage] URL episode 参数变化: ${currentEpisode} -> ${targetEpisode}`);
      handleSwitchEpisode(targetEpisode);
    }
  }, [urlEpisodeParamForEffect, currentEpisode, projectId, isSwitchingEpisode, handleSwitchEpisode]);

  // 全局资产面板显示状态
  const [showGlobalAssets, setShowGlobalAssets] = useState(false);



  // Preview 请求管理(开源版:原版通过服务端 /preview 端点预览 prompt 组装结果,已随后端移除)
  const fetchPreview = async (endpoint: string, body: Record<string, unknown>) => {
    void endpoint;
    void body;
    throw new Error('开源版不支持服务端 API 预览(依赖自建后端),可在设置中关闭「API 预览」');
  };

  const { apiPreviewEnabled } = useApiPreviewStore();

  const {
    isOpen: previewOpen,
    data: previewData,
    previewRequest,
    handleSend: handlePreviewSend,
    handleCancel: handlePreviewCancel,
  } = usePreviewRequest({
    enabled: apiPreviewEnabled,
    fetchPreview,
  });

  // 注册 previewRequest 回调到 workflowStore
  useEffect(() => {
    setWorkflowPreviewRequestCallback(previewRequest);
  }, [previewRequest]);

  // 加载模型列表
  useEffect(() => {
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 渲染时状态快照日志
  useEffect(() => {
    console.log('[WorkflowPage] RENDER 状态快照:', {
      currentStep,
      scriptLen: script?.length ?? 0,
      charactersLen: characters?.length ?? 0,
      scenesLen: scenes?.length ?? 0,
      episodesLen: episodes?.length ?? 0,
      isSimplifiedMode,
      currentEpisode,
      episodeList,
      currentProjectId,
      paramProjectId,
    });
  });

  // 从后端加载项目分集列表，自动创建缺失的第1集
  // 返回最终的 episodeIdMap

  // 组件挂载时重置所有加载状态，防止中断后状态卡住
  useEffect(() => {
    resetLoadingStates();
  }, [resetLoadingStates]);

  // 获取项目分集列表和当前分集信息


  // 保存指定分集的数据（v2：同时保存项目资产和分集数据到 localStorage + 后端）
  // 返回是否成功

  // 从指定分集的 key 加载数据到 workflowStore（v2：加载项目资产 + 分集数据）

  // 跟踪上一次的项目ID，用于检测项目切换
  const prevProjectIdRef = useRef<string | null>(null);

  // 同步项目ID到全局变量，用于workflowStore存储隔离
  // 同时从 localStorage 恢复数据（本地数据为真相源，优先加载）
  useEffect(() => {
    const load = async () => {
      // 加载项目列表（直接访问 workflow URL 时 CreatePage 不会被渲染，需要在这里初始化）
      await initProjectStore();

      // 如果 URL 中带有 projectId，校验该项目是否存在于用户项目列表中
      if (paramProjectId) {
        const allProjects = useProjectStore.getState().projects;
        const projectExists = allProjects.some((p) => p.id === paramProjectId);
        if (!projectExists) {
          console.warn(`[WorkflowPage] 项目不存在: ${paramProjectId}，跳转回项目列表`);
          message.error('项目不存在或已被删除');
          useWorkflowStore.getState().clearStore();
          // 清理该项目的浏览器缓存
          try {
            const keyFragments = [
              `shotlib_workflow_${paramProjectId}`,
              `shotlib_episode_list_${paramProjectId}`,
            ];
            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && keyFragments.some((frag) => key.includes(frag))) {
                keysToRemove.push(key);
              }
            }
            for (const key of keysToRemove) {
              localStorage.removeItem(key);
            }
          } catch (e) {
            console.warn('[WorkflowPage] 清理项目缓存失败:', e);
          }
          navigate('/create/drama', { replace: true });
          return;
        }
      }

      // 优先使用 URL 参数中的 projectId
      const projectId = paramProjectId || currentProjectId;
      if (!projectId) return;

      // 项目切换检测：不再使用 reset()，而是通过 loadWorkflowFromServer 覆盖
      const previousProjectId = prevProjectIdRef.current;
      const isProjectSwitch = previousProjectId && previousProjectId !== 'default' && previousProjectId !== projectId;

      // 导入期间阻止项目切换：弹窗确认后释放导入锁并中止导入
      if (isProjectSwitch && useWorkflowStore.getState().isImporting) {
        Modal.confirm({
          title: '导入尚未完成',
          content: '当前正在导入数据，切换项目可能导致数据丢失。是否确认切换？',
          okText: '确认切换',
          okType: 'danger',
          cancelText: '取消',
          onOk: () => {
            // 释放导入锁，后续导入操作会因项目校验失败而中止
            useWorkflowStore.getState().setIsImporting(false);
            console.warn('[WorkflowPage] 导入期间用户确认切换项目，已释放导入锁');
          },
          onCancel: () => {
            // 用户取消切换，恢复 prevProjectIdRef 阻止项目切换逻辑执行
            prevProjectIdRef.current = previousProjectId;
          },
        });
        return;
      }

      prevProjectIdRef.current = projectId;
      setStoreProjectId(projectId);

      // 如果项目切换，先 flush 旧项目数据
      if (isProjectSwitch) {
        console.log(`[WorkflowPage] 项目切换: ${previousProjectId} -> ${projectId}，flush 旧数据`);
        await flushSave();
      }

      // 尝试读取该项目的分集信息
      const episodeInfo = getProjectEpisodeInfo(projectId);
      const hasValidIdMap = episodeInfo && episodeInfo.episodeIdMap && Object.keys(episodeInfo.episodeIdMap).length > 0;

      // 确定目标分集号
      const targetEpisode = urlEpisodeParam ? initialEpisode : currentEpisode;

      if (episodeInfo && hasValidIdMap && Array.isArray(episodeInfo.episodes) && episodeInfo.episodes.length > 0) {
        setEpisodeList(episodeInfo.episodes);
        setEpisodeIdMap(episodeInfo.episodeIdMap || {});
        setCurrentEpisode(targetEpisode);
      } else {
        const loadedIdMap = await loadDramaEpisodesFromServer(projectId);
        setCurrentEpisode(targetEpisode);
        if (Object.keys(loadedIdMap).length > 0) {
          setEpisodeIdMap(loadedIdMap);
        }
      }

      // 先从缓存读取（秒开）
      const cachedData = await loadWorkflowFromCache(projectId, targetEpisode);
      if (cachedData && Object.keys(cachedData).length > 0) {
        useWorkflowStore.setState({
          ...cachedData,
          currentProjectId: projectId,
          currentEpisodeNumber: targetEpisode,
          isSimplifiedMode: targetEpisode !== 1,
          // 第1集特殊处理
          previousEpisodeScript: targetEpisode === 1 ? '' : (cachedData.previousEpisodeScript ?? ''),
          previousEpisodeSummary: targetEpisode === 1 ? '' : (cachedData.previousEpisodeSummary ?? ''),
        });
        console.log('[WorkflowPage] 从缓存加载完成（秒开）');
      }

      // 从后端加载最新数据覆盖
      console.log('[WorkflowPage] 开始调用 loadWorkflowFromServer...');
      const result = await loadFromServer(projectId, 'drama', targetEpisode);
      if (result) {
        useWorkflowStore.setState({
          ...result.projectData,
          characters: result.characters,
          scenes: result.scenes,
          props: result.props,
          ...result.episodeData,
          // 旧数据无 activePropIds 时显式置空，防止上一分集/项目的活跃ID残留导致道具被错误过滤
          activePropIds: result.episodeData.activePropIds ?? [],
          script: result.script,
          currentProjectId: projectId,
          currentEpisodeNumber: targetEpisode,
          isSimplifiedMode: targetEpisode !== 1,
          previousEpisodeScript: targetEpisode === 1 ? '' : (result.episodeData.previousEpisodeScript ?? ''),
          previousEpisodeSummary: targetEpisode === 1 ? '' : (result.episodeData.previousEpisodeSummary ?? ''),
          isGeneratingScript: false,
          isParsingScript: false,
          isGeneratingEpisodes: false,
        });
        console.log('[WorkflowPage] 后端数据加载完成，已覆盖缓存数据');

        // URL step 参数控制当前显示的 panel
        const latestSearchParams = new URLSearchParams(window.location.search);
        const urlStep = latestSearchParams.get('step');
        if (urlStep !== null) {
          let stepFromUrl = parseInt(urlStep, 10);
          const isSimplified = targetEpisode !== 1;
          // 简化模式共 4 步，超出钳制到最后一步（视频合成）
          if (isSimplified && stepFromUrl > 4) {
            stepFromUrl = 4;
          }
          const targetStep = stepFromUrl - 1;
          setLocalCurrentStep(targetStep);
        }

        // 关键修复：数据加载完成后恢复未完成的视频生成轮询。
        // 挂载后 500ms 的 checkPendingVideoTasks 早于异步数据加载完成（episodes 仍为空），
        // 会漏掉 Phase1(Bull jobId)/Phase2(videoTaskId) 任务——直接刷新落在第2集时
        // 任务永远无法恢复（第1集正常是因为通常经 Tab 切换进入，切换路径有 recoverVideoTasks）
        useWorkflowStore.getState().checkPendingVideoTasks();
      } else {
        // 后端加载失败且无缓存数据：项目可能不存在或后端不可用
        console.warn('[WorkflowPage] 后端加载失败，检查项目是否存在...');
        const cachedDataExists = cachedData && Object.keys(cachedData).length > 0;
        if (cachedDataExists) {
          // 后端不可用但缓存有数据：同样恢复未完成的视频任务轮询
          useWorkflowStore.getState().checkPendingVideoTasks();
        }
        if (!cachedDataExists) {
          // 校验项目是否存在于项目列表中
          const allProjects = useProjectStore.getState().projects;
          const projectExists = allProjects.some((p) => p.id === projectId);
          if (!projectExists) {
            console.warn(`[WorkflowPage] 项目 ${projectId} 不存在，跳转回项目列表`);
            message.error('项目不存在或已被删除');
            useWorkflowStore.getState().clearStore();
            // 清理该项目的浏览器缓存，防止残留数据占用存储空间
            try {
              const keyFragments = [
                `shotlib_workflow_${projectId}`,
                `shotlib_episode_list_${projectId}`,
              ];
              const keysToRemove: string[] = [];
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && keyFragments.some((frag) => key.includes(frag))) {
                  keysToRemove.push(key);
                }
              }
              for (const key of keysToRemove) {
                localStorage.removeItem(key);
              }
            } catch (e) {
              console.warn('[WorkflowPage] 清理项目缓存失败:', e);
            }
            navigate('/create/drama', { replace: true });
            return;
          } else {
            // 项目存在但加载失败，可能是后端临时不可用
            message.warning('项目数据加载失败，请稍后重试');
          }
        }
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramProjectId, currentProjectId]);

  // 项目切换时重置所有加载状态
  useEffect(() => {
    resetLoadingStates();
  }, [currentProjectId, resetLoadingStates]);

  // 页面加载后检查未完成的视频任务（刷新后恢复轮询）
  // 同时根据实际数据校准 currentStep（只在组件挂载时执行一次）
  useEffect(() => {
    // 延迟一点执行，确保 persist 数据已恢复
    const timer = setTimeout(() => {
      console.log('[WorkflowPage] 挂载后检查状态...');
      checkPendingVideoTasks();

      // 根据实际数据校准 currentStep，确保与数据状态一致
      const state = useWorkflowStore.getState();
      const isSimplified = state.isSimplifiedMode;
      const targetForEpisodes = isSimplified ? 2 : 3;
      const targetForParse = isSimplified ? 1 : 2;
      console.log(`[WorkflowPage] 挂载后检查: episodes=${state.episodes?.length ?? 0}, chars=${state.characters?.length ?? 0}, scenes=${state.scenes?.length ?? 0}, currentStep=${state.currentStep}, isSimplified=${isSimplified}`);
      if ((state.episodes?.length ?? 0) > 0 && state.currentStep < targetForEpisodes) {
        console.log(`[WorkflowPage] 有片段数据，自动校准 currentStep 到 ${targetForEpisodes}`);
        setCurrentStep(targetForEpisodes);
      } else if (((state.characters?.length ?? 0) > 0 || (state.scenes?.length ?? 0) > 0) && state.currentStep < targetForParse) {
        console.log(`[WorkflowPage] 有剧本分解数据，自动校准 currentStep 到 ${targetForParse}`);
        setCurrentStep(targetForParse);
      }
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在组件挂载时执行

  const currentProject = getCurrentProject();

  // 文件导入 hook（封装上传 JSON 数据的全部逻辑）
  const { fileInputRef, handleFileChange, importStepModal } = useWorkflowImport({
    projectId: paramProjectId || currentProjectId || undefined,
    currentEpisode,
    setEpisodeList,
    setEpisodeIdMap,
    setCurrentEpisode,
    saveEpisodeData,
    saveProjectEpisodeInfo,
    resetLoadingStates,
  });

  // 判断剧本分解是否有数据（基于活跃角色/场景，而非全部项目级角色/场景）
  // 新建分集时 characters/scenes 为项目级数据但 active IDs 为空，不应显示 step2 有数据
  const hasScriptSplitData = (activeCharacterIds?.length ?? 0) > 0 || (activeSceneIds?.length ?? 0) > 0;
  // 判断是否有片段数据（第4步可点击的条件）
  // 判断是否有片段数据（需要已到片段生成步骤，避免新建分集误判）
  const hasEpisodesData = (episodes?.length ?? 0) > 0 && currentStep >= 3;
  // 判断是否有已生成的片段视频（第5步视频合成可点击的条件，与 step4 判定逻辑一致）
  const hasGeneratedVideos = (episodes || []).some((ep) => !ep.deleted && !!getEpisodeVideoUrl(ep));

  const getStepStatus = (stepId: number) => {
    if (stepId < currentStep) return 'completed';
    if (stepId === currentStep) return 'active';
    return 'pending';
  };

  const handleStepClick = (stepId: number) => {
    // sidebar 点击仅切换当前显示 panel，不修改 currentStep
    const canNavigate = stepId <= currentStep
      || (stepId === 1 && !!script)
      || (stepId === 2 && hasScriptSplitData)
      || (stepId === 3 && hasEpisodesData)
      || (stepId === 4 && hasGeneratedVideos);
    if (canNavigate) {
      // 进入 step5 时推进项目级进度，使 sidebar 前 4 步显示为已完成（绿色）
      if (stepId === 4) setCurrentStep(4);
      setLocalCurrentStep(stepId);
      // 同步 step 到 URL（URL 从1开始）
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('step', String(stepId + 1));
        return next;
      }, { replace: true });
    }
  };

  const handleBackToProjects = async () => {
    console.log('[handleBackToProjects] 点击返回按钮');
    const projectId = paramProjectId || currentProjectId;
    if (projectId) {
      try {
        // 清除 SaveGuard 重置标记，确保返回时的主动保存不会被阻止
        saveGuard.clearResetMark();
        const saved = await saveEpisodeData(projectId, currentEpisode);
        if (!saved) {
          console.warn('[WorkflowPage] 返回前保存失败，停留在当前页面');
          message.error('返回前保存失败，请重试');
          return;
        }
        saveProjectEpisodeInfo(projectId, episodeList, currentEpisode, episodeIdMap);
      } catch (e) {
        console.error('[WorkflowPage] 返回前保存失败:', e);
        message.error('返回前保存失败，请重试');
        return;
      }
    }
    navigate('/create/drama');
  };

  // 切换分集

  // 删除分集

  // 新建分集

  // 构建完整项目数据（包含所有分集）

  // 下载数据：先自动同步到云端，再打包下载 zip（包含 workflow-cloud.json）

  // 将后端返回的云端 workflowData 应用到本地状态（更新资产 URL 为云端地址）

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <WorkflowPageHeader
        projectName={currentProject?.name}
        projectId={projectId}
        saveStatus={saveStatus}
        onSaveClick={() => saveEpisodeData(currentProjectId!, currentEpisode)}
        onBack={handleBackToProjects}
        fileInputRef={fileInputRef}
        onFileChange={handleFileChange}
        onDownloadData={onDownloadData}
        isSyncing={isSyncing}
        isImporting={isImporting}
      />

      {/* 分集 Tab 栏 */}
      <WorkflowEpisodeTabs
        episodeList={episodeList}
        currentEpisode={currentEpisode}
        isSwitchingEpisode={isSwitchingEpisode}
        episodesCount={episodes?.length ?? 0}
        onSwitchEpisode={(ep) => {
          isUserSwitchingEpisodeRef.current = true;
          handleSwitchEpisode(ep);
        }}
        onDeleteEpisode={handleDeleteEpisode}
        onCreateNewEpisode={handleCreateNewEpisode}
      />

      {/* Main Content */}
      <WorkflowMainContent
        isSimplifiedMode={isSimplifiedMode}
        currentEpisode={currentEpisode}
        steps={steps}
        currentStep={currentStep}
        localCurrentStep={localCurrentStep}
        setLocalCurrentStep={setLocalCurrentStep}
        getStepStatus={getStepStatus}
        onStepClick={handleStepClick}
        script={script}
        hasScriptSplitData={hasScriptSplitData}
        hasEpisodesData={hasEpisodesData}
        hasGeneratedVideos={hasGeneratedVideos}
        episodesCount={episodes?.length ?? 0}
        isSwitchingEpisode={isSwitchingEpisode}
        textModel={textModel}
        setTextModel={setTextModel}
        textModels={textModels}
        isGeneratingScript={isGeneratingScript}
        isParsingScript={isParsingScript}
        isGeneratingEpisodes={isGeneratingEpisodes}
        parseScript={parseScript}
        generateEpisodes={generateEpisodes}
        stepToPanel={stepToPanel}
        handleSimplifiedStepChange={handleSimplifiedStepChange}
        activeSceneId={activeSceneId}
        setActiveSceneId={setActiveSceneId}
        handleSceneChange={handleSceneChange}
        onOpenGlobalAssets={() => setShowGlobalAssets(true)}
        setSearchParams={setSearchParams}
      />

      {/* 请求预览 Modal */}
      <PreviewRequestModal
        open={previewOpen}
        data={previewData}
        onCancel={handlePreviewCancel}
        onSend={handlePreviewSend}
      />

      {/* 全局资产全屏 Modal */}
      <GlobalAssetsModal
        open={showGlobalAssets}
        onClose={() => setShowGlobalAssets(false)}
      />

      {/* 导入数据步骤选择弹窗 */}
      {importStepModal}

    </div>
  );
}
