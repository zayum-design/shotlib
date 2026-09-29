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

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useCallback, useEffect } from 'react';
import type { InstantSegment, InstantCharacter, InstantScene } from '@/shared/types/project';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import { saveInstantToServer } from '@/modules/instant/utils/instantSyncUtils';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';

interface UseInstantSaveManagerOptions {
  projectId: string | undefined;
  characters: InstantCharacter[];
  setCharacters: React.Dispatch<React.SetStateAction<InstantCharacter[]>>;
  scenes: InstantScene[];
  setScenes: React.Dispatch<React.SetStateAction<InstantScene[]>>;
  segments: InstantSegment[];
  setSegments: React.Dispatch<React.SetStateAction<InstantSegment[]>>;
}

export function useInstantSaveManager({
  projectId,
  characters,
  setCharacters,
  scenes,
  setScenes,
  segments,
  setSegments,
}: UseInstantSaveManagerOptions) {
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const lastSavedDataRef = useRef<string>('');

  // refs 保存最新状态，供防抖云保存回调读取（避免闭包陈旧）
  const charactersRef = useRef<InstantCharacter[]>(characters);
  const scenesRef = useRef<InstantScene[]>(scenes);
  const segmentsRef = useRef<InstantSegment[]>(segments);
  charactersRef.current = characters;
  scenesRef.current = scenes;
  segmentsRef.current = segments;

  const markAsSaved = useCallback((chars: InstantCharacter[], scns: InstantScene[], segs: InstantSegment[]) => {
    lastSavedDataRef.current = JSON.stringify({
      instantCharacters: chars,
      instantScenes: scns,
      instantSegments: segs,
    });
  }, []);

  // 防抖云保存（延迟 2s），同时更新保存状态
  const cloudSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerCloudSave = useCallback(() => {
    const pid = projectId;
    if (!pid || pid === 'default') return;
    setSaveStatus('unsaved');

    if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
    cloudSaveTimerRef.current = setTimeout(async () => {
      const data: import('@/shared/types/project').InstantProjectData = {
        instantCharacters: charactersRef.current,
        instantScenes: scenesRef.current,
        instantSegments: segmentsRef.current,
      };
      const currentData = JSON.stringify(data);
      console.log('[triggerCloudSave] 准备保存，characters 数量:', data.instantCharacters.length, 'avatar 样本:', data.instantCharacters[0]?.avatar);
      if (currentData === lastSavedDataRef.current) {
        console.log('[triggerCloudSave] 数据未变化，跳过保存');
        setSaveStatus('saved');
        return;
      }
      setSaveStatus('saving');
      const success = await saveInstantToServer(pid, data);
      if (success) {
        lastSavedDataRef.current = currentData;
        setSaveStatus('saved');
        console.log('[triggerCloudSave] 保存成功');
      } else {
        setSaveStatus('unsaved');
        console.warn('[triggerCloudSave] 保存失败');
      }
    }, 2000);
  }, [projectId]);

  const saveSegments = useCallback(
    (nextSegments: InstantSegment[]) => {
      setSegments(nextSegments);
      const pid = projectId;
      if (pid) {
        persistInstantData(pid, { instantSegments: nextSegments });
        triggerCloudSave();
      }
    },
    [projectId, triggerCloudSave]
  );

  const saveCharacters = useCallback(
    (next: InstantCharacter[]) => {
      setCharacters(next);
      const pid = projectId;
      if (pid) {
        persistInstantData(pid, { instantCharacters: next });
        triggerCloudSave();
      }
    },
    [projectId, triggerCloudSave]
  );

  const saveScenes = useCallback(
    (next: InstantScene[]) => {
      setScenes(next);
      const pid = projectId;
      if (pid) {
        persistInstantData(pid, { instantScenes: next });
        triggerCloudSave();
      }
    },
    [projectId, triggerCloudSave]
  );

  // 云端同步后应用数据：直接更新状态并保存到服务器，不触发额外的自动保存（避免 409 冲突）
  const applyCloudSyncData = useCallback(
    async (data: { instantCharacters?: InstantCharacter[]; instantScenes?: InstantScene[]; instantSegments?: InstantSegment[] }) => {
      const pid = projectId;
      if (!pid) return;

      // 1. 直接更新状态（不走 saveCharacters/saveScenes，避免触发 triggerCloudSave）
      if (data.instantCharacters) {
        setCharacters(data.instantCharacters);
        persistInstantData(pid, { instantCharacters: data.instantCharacters });
      }
      if (data.instantScenes) {
        setScenes(data.instantScenes);
        persistInstantData(pid, { instantScenes: data.instantScenes });
      }
      if (data.instantSegments) {
        setSegments(data.instantSegments);
        persistInstantData(pid, { instantSegments: data.instantSegments });
      }

      // 2. 直接保存到服务器
      const saveData = {
        instantCharacters: data.instantCharacters || charactersRef.current,
        instantScenes: data.instantScenes || scenesRef.current,
        instantSegments: data.instantSegments || segmentsRef.current,
      };
      setSaveStatus('saving');
      const success = await saveInstantToServer(pid, saveData);
      if (success) {
        const currentData = JSON.stringify(saveData);
        lastSavedDataRef.current = currentData;
        setSaveStatus('saved');
        console.log('[applyCloudSyncData] 云端数据已直接保存到服务器');
      } else {
        setSaveStatus('unsaved');
        console.warn('[applyCloudSyncData] 云端数据保存失败');
      }
    },
    [projectId]
  );

  // 数据变更时自动保存到服务器（防抖 2s），并跟踪保存状态
  // 兜底机制：覆盖未走 saveSegments/saveCharacters/saveScenes 的直接 setState 路径
  useEffect(() => {
    const pid = projectId;
    if (!pid || pid === 'default') return;
    // 至少有一项数据才保存，避免空状态覆盖服务器
    const hasData =
      characters.length > 0 || scenes.length > 0 || segments.length > 0;
    if (!hasData) return;

    // 统一使用 instant 前缀格式，与 lastSavedDataRef 保持一致
    const currentData = JSON.stringify({ instantCharacters: characters, instantScenes: scenes, instantSegments: segments });
    if (currentData === lastSavedDataRef.current) {
      console.log('[autoSave] 数据未变化，跳过保存');
      return;
    }

    setSaveStatus('unsaved');

    const timer = setTimeout(async () => {
      // 从 ref 读取最新状态，避免保存闭包中的旧数据
      const latestData = {
        instantCharacters: charactersRef.current,
        instantScenes: scenesRef.current,
        instantSegments: segmentsRef.current,
      };
      const latestDataStr = JSON.stringify(latestData);
      if (latestDataStr === lastSavedDataRef.current) {
        setSaveStatus('saved');
        return;
      }
      setSaveStatus('saving');
      // 调试：检查保存的 segments 中 shots 的 URL
      const shotUrls = segmentsRef.current.flatMap((s) =>
        (s.canvasItems || []).flatMap((item) =>
          (item.shots || []).map((shot) => ({
            shotId: shot.id,
            refUrl: shot.referenceImageUrl,
          }))
        )
      );
      console.log('[autoSave] 准备保存到服务器，shots URL:', shotUrls);

      const success = await saveInstantToServer(pid, latestData);
      if (success) {
        lastSavedDataRef.current = latestDataStr;
        setSaveStatus('saved');
        console.log('[autoSave] 保存成功');
      } else {
        setSaveStatus('unsaved');
        console.warn('[autoSave] 保存失败');
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [characters, scenes, segments, projectId]);

  // 手动保存：立即触发保存到服务器
  const handleManualSave = useCallback(async () => {
    const pid = projectId;
    if (!pid) return;
    setSaveStatus('saving');
    const { addTask, completeTask, failTask } = useTaskQueueStore.getState();
    const taskId = addTask({ type: 'project-save', name: '保存项目', status: 'running' });
    const success = await saveInstantToServer(pid, {
      instantCharacters: characters,
      instantScenes: scenes,
      instantSegments: segments,
    });
    if (success) {
      lastSavedDataRef.current = JSON.stringify({ instantCharacters: characters, instantScenes: scenes, instantSegments: segments });
      setSaveStatus('saved');
      completeTask(taskId, { saved: true });
    } else {
      setSaveStatus('unsaved');
      failTask(taskId, '保存失败');
    }
  }, [characters, scenes, segments, projectId]);

  return {
    saveStatus,
    setSaveStatus,
    saveSegments,
    saveCharacters,
    saveScenes,
    triggerCloudSave,
    handleManualSave,
    applyCloudSyncData,
    markAsSaved,
  };
}
