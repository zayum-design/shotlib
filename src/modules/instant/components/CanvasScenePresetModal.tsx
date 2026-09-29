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
import { Modal } from 'antd';
import { User, Image as ImageIcon } from 'lucide-react';
import type { InstantCharacter, InstantScene } from '@/shared/types/project';
import { renderPromptHtml } from '../utils/instantPromptUtils';
import { PromptHtmlDisplay } from './PromptHtmlDisplay';

interface PresetScene {
  id: string;
  name: string;
  template: string;
}

interface CanvasScenePresetModalProps {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  presetScenes: PresetScene[];
  selectedPresetId: string | null;
  onSelectPreset: (id: string) => void;
  previewPrompt: string;
  characters: InstantCharacter[];
  scenes: InstantScene[];
  sceneChars: InstantCharacter[];
  scene: InstantScene;
}

/**
 * 预制场景选择弹窗：根据角色 + 场景 + 预制模板生成提示词
 */
export const CanvasScenePresetModal: React.FC<CanvasScenePresetModalProps> = ({
  open,
  onCancel,
  onOk,
  presetScenes,
  selectedPresetId,
  onSelectPreset,
  previewPrompt,
  characters,
  scenes,
  sceneChars,
  scene,
}) => {
  return (
    <Modal
      title="选择场景模板"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="确定"
      cancelText="取消"
      width={720}
      centered
      destroyOnHidden
    >
      <div className="py-4 space-y-4">
        {/* 当前角色和场景 */}
        <div className="space-y-2">
          <div className="text-xs text-text-muted">当前角色</div>
          <div className="flex flex-wrap gap-2">
            {sceneChars.map((char) => (
              <div key={char.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-tertiary border border-border">
                {char.avatar ? (
                  <img src={char.avatar} alt={char.name} className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-accent-primary/20 flex items-center justify-center">
                    <User size={10} className="text-accent-primary" />
                  </div>
                )}
                <span className="text-xs text-text-primary">{char.name}</span>
              </div>
            ))}
            {sceneChars.length === 0 && (
              <span className="text-xs text-text-muted">暂无角色</span>
            )}
          </div>
          <div className="text-xs text-text-muted mt-2">当前场景</div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-tertiary border border-border inline-flex">
            {scene.imageUrl ? (
              <img src={scene.imageUrl} alt={scene.name} className="w-5 h-5 rounded object-cover" />
            ) : (
              <ImageIcon size={10} className="text-text-muted" />
            )}
            <span className="text-xs text-text-primary">{scene.name}</span>
          </div>
        </div>

        {/* 预制场景网格 */}
        <div className="space-y-2">
          <div className="text-xs text-text-muted">选择场景模板（{presetScenes.length}个）</div>
          <div className="grid grid-cols-4 gap-2">
            {presetScenes.map((preset) => (
              <button
                key={preset.id}
                onClick={() => onSelectPreset(preset.id)}
                className={`p-2 rounded-lg border text-xs font-medium transition-all text-left ${
                  selectedPresetId === preset.id
                    ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                    : 'border-border bg-bg-tertiary text-text-secondary hover:border-accent-primary/50 hover:text-text-primary'
                }`}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* 提示词预览 */}
        {previewPrompt && (
          <div className="space-y-1">
            <div className="text-xs text-text-muted">预览提示词</div>
            <PromptHtmlDisplay
              className="text-xs text-text-secondary whitespace-pre-wrap break-words border border-dashed border-border rounded px-2 py-1 max-h-24 overflow-y-auto"
              html={renderPromptHtml(previewPrompt, characters, scenes)}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};
