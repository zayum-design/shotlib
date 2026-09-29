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
import { Modal, Select, Button, Input, Tooltip } from 'antd';
import { User, Image as ImageIcon, Sparkles } from 'lucide-react';
import VisualPromptEditor from '@/shared/components/ui/VisualPromptEditor';
import type { InstantCharacter, InstantScene } from '@/shared/types/project';

const { TextArea } = Input;

interface TextModelOption {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
}

interface CanvasSceneCreativeModalProps {
  open: boolean;
  onCancel: () => void;
  /** 点击确定：把生成（可编辑后）的片段提示词应用到父页面输入框 */
  onOk: () => void;
  characters: InstantCharacter[];
  scenes: InstantScene[];
  sceneChars: InstantCharacter[];
  scene: InstantScene;
  /** 用户输入的创意描述 */
  ideaPrompt: string;
  onIdeaPromptChange: (value: string) => void;
  /** 文本模型选择 */
  textModels: TextModelOption[];
  textModel: string;
  onTextModelChange: (model: string) => void;
  /** 点击生成片段 */
  onGenerate: () => void;
  generating: boolean;
  /** 生成的片段提示词（已替换为 @<role>/#<scene> 标签，可编辑） */
  generatedPrompt: string;
  onGeneratedPromptChange: (value: string) => void;
}

/**
 * AI 创意弹窗：根据角色 + 场景 + 用户输入的创意描述，
 * 使用文本模型生成片段提示词（角色/场景已转为 @/# 标签，可编辑预览），
 * 确定后应用到父页面的提示词输入框
 */
export const CanvasSceneCreativeModal: React.FC<CanvasSceneCreativeModalProps> = ({
  open,
  onCancel,
  onOk,
  characters,
  scenes,
  sceneChars,
  scene,
  ideaPrompt,
  onIdeaPromptChange,
  textModels,
  textModel,
  onTextModelChange,
  onGenerate,
  generating,
  generatedPrompt,
  onGeneratedPromptChange,
}) => {
  return (
    <Modal
      title="AI 创意"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: !generatedPrompt.trim() }}
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

        {/* 创意描述输入 */}
        <div className="space-y-2">
          <div className="text-xs text-text-muted">输入提示词</div>
          <TextArea
            value={ideaPrompt}
            onChange={(e) => onIdeaPromptChange(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder="描述你想要的片段创意，例如：两人在雨中争吵后相拥和解..."
            maxLength={500}
            showCount
          />
        </div>

        {/* 文本模型选择 + 生成片段按钮 */}
        <div className="flex items-center gap-2">
          <Select
            value={textModel}
            onChange={onTextModelChange}
            options={textModels.map((m) => ({
              value: m.id,
              label: (
                <Tooltip title={m.description}>
                  <span className="text-xs">{m.name}</span>
                </Tooltip>
              ),
              disabled: m.disabled,
            }))}
            size="small"
            className="flex-1 min-w-0"
            popupMatchSelectWidth={false}
          />
          <Button
            type="primary"
            size="small"
            onClick={onGenerate}
            loading={generating}
            disabled={generating || !ideaPrompt.trim()}
            className="bg-accent-primary border-0 flex-shrink-0"
            icon={<Sparkles size={12} />}
          >
            生成片段
          </Button>
        </div>

        {/* 生成的片段提示词（可编辑，@角色/#场景 可预览） */}
        {generatedPrompt && (
          <div className="space-y-1">
            <div className="text-xs text-text-muted">片段提示词（可编辑）</div>
            <VisualPromptEditor
              value={generatedPrompt}
              onChange={onGeneratedPromptChange}
              characters={characters}
              scenes={scenes}
              placeholder="生成的片段提示词，输入 @ 插入角色，输入 # 插入场景..."
              minRows={3}
              maxRows={8}
              hintText="输入 @ 插入角色，输入 # 插入场景"
            />
          </div>
        )}
      </div>
    </Modal>
  );
};
