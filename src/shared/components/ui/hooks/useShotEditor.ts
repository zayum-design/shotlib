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
import type {
  Shot,
  ShotReferenceAsset,
  CameraMovement,
  ShotType,
  CameraAngle,
  LightingType,
  MoodType,
} from '../../../types';
import { generateShotPrompt } from '@/modules/workflow/utils/workflowUtils';
import { stripVideoPromptSuffix } from '@/modules/workflow/stores/workflowStore.episode.utils';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { message } from '../../../utils/message';

const generateId = () => Math.random().toString(36).substring(2, 11);

interface UseShotEditorOptions {
  episodeId: string;
  shots: Shot[];
  updateEpisode: (id: string, data: Partial<unknown>) => void;
  generateShotReferenceImage?: (episodeId: string, shotIndex: number) => Promise<void>;
}

export function useShotEditor({ episodeId, shots, updateEpisode, generateShotReferenceImage }: UseShotEditorOptions) {
  const [isAddingShot, setIsAddingShot] = useState(false);
  const [editingShot, setEditingShot] = useState<Shot | null>(null);

  const [shotDuration, setShotDuration] = useState(12);
  const [shotMovements, setShotMovements] = useState<CameraMovement[]>([]);
  const [shotType, setShotType] = useState<ShotType>('medium');
  const [shotAngle, setShotAngle] = useState<CameraAngle>('eye_level');
  const [shotLighting, setShotLighting] = useState<LightingType>('natural');
  const [shotMood, setShotMood] = useState<MoodType>('bright');
  const [shotPrompt, setShotPrompt] = useState('');
  const [shotReferencePrompt, setShotReferencePrompt] = useState('');
  const [shotReferenceAssets, setShotReferenceAssets] = useState<ShotReferenceAsset[]>([]);

  // 片段时长上限随项目设置(15s/30s,30s 仅长片段模型如 seedance2.5 支持)
  const maxDuration = useWorkflowStore((s) => s.episodeMaxDuration) || 15;
  const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0);
  const remainingDuration = maxDuration - totalDuration;

  const openShotModal = useCallback(
    (shot?: Shot) => {
      if (shot) {
        setEditingShot(shot);
        setShotDuration(shot.duration);
        setShotMovements(shot.cameraMovements);
        setShotType(shot.shotType);
        setShotAngle(shot.cameraAngle);
        setShotLighting(shot.lighting);
        setShotMood(shot.mood);
        // 编辑框中剥离统一约束后缀（提交时由系统重新追加，不在输入框显示）
        setShotPrompt(stripVideoPromptSuffix(shot.prompt));
        setShotReferencePrompt(shot.rawReferencePrompt || '');
        setShotReferenceAssets(shot.referenceAssets || []);
      } else {
        if (remainingDuration <= 0) {
          message.warning(`总时长已达到${maxDuration}秒，无法再添加分镜`);
          return;
        }
        setEditingShot(null);
        setShotDuration(Math.min(remainingDuration, maxDuration));
        setShotMovements([]);
        setShotType('medium');
        setShotAngle('eye_level');
        setShotLighting('natural');
        setShotMood('bright');
        setShotPrompt('');
        setShotReferencePrompt('');
        setShotReferenceAssets([]);
      }
      setIsAddingShot(true);
    },
    [remainingDuration],
  );

  const closeShotModal = useCallback(() => {
    setIsAddingShot(false);
    setShotPrompt('');
    setShotReferenceAssets([]);
  }, []);

  const handleSaveShot = useCallback(() => {
    if (!shotPrompt.trim()) {
      message.warning('请输入分镜提示词');
      return;
    }

    // 保留现有 shot 的衍生/参考图字段（referenceImageUrl、referenceImageAssetId、useReferenceAsFirstFrame、
    // rawPrompt 等），避免编辑提示词保存时重建 shot 导致首帧参考图等字段丢失
    const newShot: Shot = {
      ...(editingShot ?? {}),
      id: editingShot?.id || generateId(),
      duration: shotDuration,
      cameraMovements: shotMovements,
      shotType,
      cameraAngle: shotAngle,
      lighting: shotLighting,
      mood: shotMood,
      prompt: shotPrompt,
      referencePrompt: shotReferencePrompt?.trim() || undefined,
      rawReferencePrompt: shotReferencePrompt?.trim() || undefined,
      referenceAssets: shotReferenceAssets.length > 0 ? shotReferenceAssets : undefined,
    };

    let updatedShots: Shot[];
    if (editingShot) {
      updatedShots = shots.map((s) => (s.id === editingShot.id ? newShot : s));
    } else {
      updatedShots = [...shots, newShot];
    }

    const videoPrompt = updatedShots
      .map((s, i) => `【分镜${i + 1} | ${s.duration}s】${generateShotPrompt(s)}`)
      .join('\n\n');

    updateEpisode(episodeId, { shots: updatedShots, videoPrompt });
    setIsAddingShot(false);
    setShotPrompt('');
    setShotReferenceAssets([]);
    message.success(editingShot ? '分镜已更新' : '分镜已添加');
  }, [
    episodeId,
    shots,
    editingShot,
    shotDuration,
    shotMovements,
    shotType,
    shotAngle,
    shotLighting,
    shotMood,
    shotPrompt,
    shotReferencePrompt,
    shotReferenceAssets,
    updateEpisode,
  ]);

  const handleDeleteShot = useCallback(
    (shotId: string) => {
      const updatedShots = shots.filter((s) => s.id !== shotId);
      const videoPrompt =
        updatedShots.length > 0
          ? updatedShots
              .map((s, i) => `【分镜${i + 1} | ${s.duration}s】${generateShotPrompt(s)}`)
              .join('\n\n')
          : '';

      updateEpisode(episodeId, { shots: updatedShots, videoPrompt });
      message.success('分镜已删除');
    },
    [episodeId, shots, updateEpisode],
  );

  const handleGenerateShotReference = useCallback(
    async (shotIndex: number) => {
      const shot = shots[shotIndex];
      if (!shot) return;
      if (!shot.prompt?.trim() && !shot.referencePrompt?.trim() && !shot.rawReferencePrompt?.trim()) {
        message.warning('分镜提示词为空，无法生成参考图');
        return;
      }
      if (generateShotReferenceImage) {
        await generateShotReferenceImage(episodeId, shotIndex);
      }
    },
    [episodeId, shots, generateShotReferenceImage],
  );

  return {
    isAddingShot,
    setIsAddingShot,
    editingShot,
    shotDuration,
    setShotDuration,
    shotMovements,
    setShotMovements,
    shotType,
    setShotType,
    shotAngle,
    setShotAngle,
    shotLighting,
    setShotLighting,
    shotMood,
    setShotMood,
    shotPrompt,
    setShotPrompt,
    shotReferencePrompt,
    setShotReferencePrompt,
    shotReferenceAssets,
    setShotReferenceAssets,
    totalDuration,
    remainingDuration,
    openShotModal,
    closeShotModal,
    handleSaveShot,
    handleDeleteShot,
    handleGenerateShotReference,
  };
}
