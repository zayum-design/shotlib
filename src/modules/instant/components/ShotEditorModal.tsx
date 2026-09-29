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

import React from 'react';
import { Modal, Slider, Input, Checkbox, Select, Divider } from 'antd';
import { Tooltip } from 'antd';
import VisualPromptEditor from '@/shared/components/ui/VisualPromptEditor';
import type { Shot } from '@/shared/types/index';
import { generateShotPrompt, generateShotPromptPreview } from '../utils/instantPromptUtils';
import {
  CAMERA_MOVEMENTS,
  SHOT_TYPES,
  CAMERA_ANGLES,
  LIGHTING_TYPES,
  MOOD_TYPES,
} from '@/shared/types/index';
import type { InstantCharacter, InstantScene } from '@/shared/types/project';

interface ShotEditorModalProps {
  open: boolean;
  editingShot: Shot | null;
  shotDuration: number;
  shotMovements: string[];
  shotType: string;
  shotAngle: string;
  shotLighting: string;
  shotMood: string;
  shotPrompt: string;
  characters: InstantCharacter[];
  scenes: InstantScene[];
  onDurationChange: (v: number) => void;
  onMovementsChange: (v: string[]) => void;
  onTypeChange: (v: string) => void;
  onAngleChange: (v: string) => void;
  onLightingChange: (v: string) => void;
  onMoodChange: (v: string) => void;
  onPromptChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /** 分镜总时长上限（秒，15 或 30），控制时长滑杆上限 */
  maxShotDuration?: number;
}

export const ShotEditorModal: React.FC<ShotEditorModalProps> = ({
  open,
  editingShot,
  shotDuration,
  shotMovements,
  shotType,
  shotAngle,
  shotLighting,
  shotMood,
  shotPrompt,
  characters,
  scenes,
  onDurationChange,
  onMovementsChange,
  onTypeChange,
  onAngleChange,
  onLightingChange,
  onMoodChange,
  onPromptChange,
  onSave,
  onCancel,
  maxShotDuration = 15,
}) => {
  return (
    <Modal
      title={editingShot ? '编辑分镜' : '新增分镜'}
      open={open}
      onOk={onSave}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={800}
      destroyOnHidden
    >
      <div className="py-4">
        <div className="flex gap-6">
          {/* 左侧：配置项 */}
          <div className="w-1/2 space-y-3">
            {/* 时长 */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0">时长</label>
              <div className="flex items-center gap-2 flex-1">
                <Slider min={1} max={maxShotDuration} value={shotDuration} onChange={onDurationChange} className="flex-1" />
                <Input
                  type="number"
                  min={1}
                  max={maxShotDuration}
                  value={shotDuration}
                  onChange={(e) => onDurationChange(Math.min(maxShotDuration, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-14"
                />
                <span className="text-sm text-text-muted w-4">秒</span>
              </div>
            </div>

            {/* 运镜方式 */}
            <div className="flex items-start gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0 pt-1">运镜方式</label>
              <Checkbox.Group
                value={shotMovements}
                onChange={(vals) => onMovementsChange(vals as string[])}
                className="flex flex-wrap gap-x-3 gap-y-1 flex-1"
              >
                {CAMERA_MOVEMENTS.map((movement) => (
                  <Checkbox key={movement.id} value={movement.id}>
                    <Tooltip title={movement.description}>
                      <span className="text-xs">{movement.name}</span>
                    </Tooltip>
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </div>

            {/* 镜头类型 */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0">镜头类型</label>
              <Select
                value={shotType}
                onChange={(val) => onTypeChange(val)}
                options={SHOT_TYPES.map((s) => ({ value: s.id, label: s.name }))}
                className="flex-1"
              />
            </div>

            {/* 摄像机角度 */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0">摄像机角度</label>
              <Select
                value={shotAngle}
                onChange={(val) => onAngleChange(val)}
                options={CAMERA_ANGLES.map((a) => ({ value: a.id, label: a.name }))}
                className="flex-1"
              />
            </div>

            {/* 灯光设定 */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0">灯光设定</label>
              <Select
                value={shotLighting}
                onChange={(val) => onLightingChange(val)}
                options={LIGHTING_TYPES.map((l) => ({ value: l.id, label: l.name }))}
                className="flex-1"
              />
            </div>

            {/* 氛围 */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0">氛围</label>
              <Select
                value={shotMood}
                onChange={(val) => onMoodChange(val)}
                options={MOOD_TYPES.map((m) => ({ value: m.id, label: m.name }))}
                className="flex-1"
              />
            </div>
          </div>

          {/* 右侧：提示词和对白 */}
          <div className="w-1/2 space-y-3">
            <div>
              <label className="text-sm text-text-secondary mb-2 block">
                分镜提示词 <span className="text-red-500">*</span>
              </label>
              <VisualPromptEditor
                value={shotPrompt}
                onChange={onPromptChange}
                characters={characters}
                scenes={scenes}
                placeholder="描述此分镜的具体内容、动作、表情等，输入 @ 插入角色，输入 # 插入场景..."
                minRows={4}
              />
            </div>
            {/* 对白已嵌入 prompt 中，不再单独编辑 */}
          </div>
        </div>

        {/* 预览区 */}
        <Divider className="my-4" />
        <div className="bg-bg-tertiary rounded-lg p-3">
          <p className="text-xs text-text-muted mb-1">预览</p>
          <div className="text-sm text-text-secondary whitespace-pre-wrap break-words">
            {shotPrompt
              ? generateShotPromptPreview({
                  id: '',
                  duration: shotDuration,
                  cameraMovements: shotMovements as any[],
                  shotType: shotType as any,
                  cameraAngle: shotAngle as any,
                  lighting: shotLighting as any,
                  mood: shotMood as any,
                  prompt: shotPrompt,
                })
              : '请输入分镜提示词...'}
          </div>
        </div>
      </div>
    </Modal>
  );
};
