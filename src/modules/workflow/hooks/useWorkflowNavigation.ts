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

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkflowStore, setScriptGeneratedCallback } from '@/modules/workflow/stores/workflowStore';
import type { SimplifiedPanel } from '@/modules/workflow/components/EpisodeSidebarSteps';

export function useWorkflowNavigation(currentEpisode: number) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentStep, episodes, isSimplifiedMode } = useWorkflowStore();

  // 使用 ref 保存 setSearchParams，避免 effect 因 setSearchParams 引用变化而误触发
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;
  const prevEpisodeRef = useRef(currentEpisode);
  const prevSearchParamsRef = useRef<string | null>(null);

  const [localCurrentStep, setLocalCurrentStep] = useState(() => {
    const s = searchParams.get('step');
    if (s === null) return currentStep;
    const urlStep = parseInt(s, 10);
    // 简化模式（第2集+）共 4 步，超出钳制到最后一步（视频合成）
    if (currentEpisode >= 2 && urlStep > 4) return 3;
    return Math.max(0, urlStep - 1);
  });

  const [activeShotIndex, setActiveShotIndex] = useState(() => {
    const s = searchParams.get('shot');
    return s !== null ? parseInt(s, 10) - 1 : 0;
  });

  const [activeSceneId, setActiveSceneId] = useState<string>(() => {
    return searchParams.get('scene') || '';
  });

  const stepToPanel = useCallback((step: number): SimplifiedPanel => {
    if (step >= 4) return 'compose';
    if (step >= 3) return 'shots';
    if (step >= 2) return 'split';
    return 'script';
  }, []);

  const handleSimplifiedStepChange = useCallback(
    (step: number) => {
      const newStep0Based = step - 1;
      setLocalCurrentStep(newStep0Based);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('step', String(step));
          if (step < 3) {
            next.delete('scene');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleSceneChange = useCallback(
    (sceneId: string) => {
      setActiveSceneId(sceneId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (sceneId) {
            next.set('scene', sceneId);
            next.delete('shot');
          } else {
            next.delete('scene');
            next.delete('shot');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // currentStep 为分集级数据进度标识，不再同步到 localCurrentStep；
  // sidebar 点击仅切换面板（localCurrentStep），不修改 currentStep。

  // 监听分集变化和 URL step 变化，同步 localCurrentStep。
  // 关键修复：
  // 1. 分集变化时，强制重置 step 为 1，不再保留原 URL 中的 step。
  // 2. 同一分集内 URL step 变化时（浏览器前进/后退），同步 localCurrentStep。
  // 3. 使用 ref 保存 setSearchParams 和上一次 searchParams，避免 URL 变化导致 setSearchParams 引用变化而误触发。
  useEffect(() => {
    const currentSearchStr = searchParams.toString();

    if (prevEpisodeRef.current !== currentEpisode) {
      // 分集发生变化：只更新 prevEpisodeRef，不在这里重置 step。
      // 显式的分集切换（handleSwitchEpisode / handleCreateNewEpisode）和 WorkflowPage 的
      // currentEpisode effect 已经负责重置 step=1 并清除 scene/shot。
      // 此处再做一次重置会与点击片段 tab 时设置 scene 参数的操作产生竞态，
      // 导致刚生成片段后点击片段 2 被错误跳回 Step 1。
      prevEpisodeRef.current = currentEpisode;
      prevSearchParamsRef.current = currentSearchStr;
      return;
    }

    // 首次挂载：仅记录 searchParams，避免重复处理
    if (prevSearchParamsRef.current === null) {
      prevSearchParamsRef.current = currentSearchStr;
      return;
    }

    // 分集未变，但 searchParams 变了（例如浏览器前进/后退仅修改 step）
    if (prevSearchParamsRef.current === currentSearchStr) return;
    prevSearchParamsRef.current = currentSearchStr;

    const urlStep = searchParams.get('step');
    if (urlStep !== null) {
      let stepFromUrl = parseInt(urlStep, 10);
      // 简化模式（第2集+）共 4 步，超出钳制到最后一步
      if (isSimplifiedMode && stepFromUrl > 4) {
        stepFromUrl = 4;
      }
      setLocalCurrentStep(Math.max(0, stepFromUrl - 1));
    }
  }, [currentEpisode, isSimplifiedMode, searchParams]);

  // 监听面板切换，重置 shot 索引
  useEffect(() => {
    if (isSimplifiedMode && currentEpisode !== 1) {
      const panel = stepToPanel(localCurrentStep + 1);
      if (panel !== 'shots') {
        setActiveShotIndex(0);
      }
    }
  }, [localCurrentStep, isSimplifiedMode, currentEpisode, stepToPanel]);

  // episodes 加载后，根据 scene/shot 参数初始化 activeSceneId
  useEffect(() => {
    if (episodes && episodes.length > 0) {
      const sceneParam = searchParams.get('scene');
      if (sceneParam) {
        const shotIndex = episodes.findIndex((ep) => ep.id === sceneParam);
        if (shotIndex >= 0) {
          setActiveShotIndex(shotIndex);
          setActiveSceneId(sceneParam);
        }
      } else {
        const shotParam = searchParams.get('shot');
        if (shotParam) {
          const shotIndex = parseInt(shotParam, 10) - 1;
          if (shotIndex >= 0 && shotIndex < episodes.length) {
            const episode = episodes[shotIndex];
            setActiveShotIndex(shotIndex);
            setActiveSceneId(episode.id);
          }
        }
      }
    }
  }, [episodes, searchParams]);

  // 使用 ref 保存最新状态，供全局回调使用
  const localCurrentStepRef = useRef(localCurrentStep);

  useEffect(() => {
    localCurrentStepRef.current = localCurrentStep;
  }, [localCurrentStep]);

  // 注册剧本生成成功回调：自动跳转到 step2（1-based URL step = 2）
  useEffect(() => {
    setScriptGeneratedCallback(() => {
      if (localCurrentStepRef.current === 1) return;
      setLocalCurrentStep(1);
      setSearchParamsRef.current(
        () => {
          const next = new URLSearchParams(window.location.search);
          next.set('step', '2');
          return next;
        },
        { replace: true },
      );
    });
    return () => setScriptGeneratedCallback(null);
  }, []);

  return {
    localCurrentStep,
    setLocalCurrentStep,
    activeShotIndex,
    setActiveShotIndex,
    activeSceneId,
    setActiveSceneId,
    stepToPanel,
    handleSimplifiedStepChange,
    handleSceneChange,
    searchParams,
    setSearchParams,
  };
}
