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
 * 新建/修改项目弹窗(参照云端版 CreatePageModals):
 * 新建 = 创作模式选择 + 画面比例 + 项目名称;修改 = 画面比例 + 项目名称
 */
import React from 'react';
import { Modal, Input, Button } from 'antd';
import { FileText, Zap } from 'lucide-react';
import type { AspectRatio } from '@/shared/types/project';

type CreationMode = 'script' | 'instant' | null;

interface CreateProjectModalProps {
  open: boolean;
  onCancel: () => void;
  creationMode: CreationMode;
  handleModeChange: (mode: 'script' | 'instant', checked: boolean) => void;
  aspectRatio: AspectRatio;
  setAspectRatio: (v: AspectRatio) => void;
  newProjectName: string;
  setNewProjectName: (v: string) => void;
  handleCreateProject: () => void;
}

/**
 * 新建项目弹窗：创作模式选择 + 画面比例 + 项目名称
 */
export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  open,
  onCancel,
  creationMode,
  handleModeChange,
  aspectRatio,
  setAspectRatio,
  newProjectName,
  setNewProjectName,
  handleCreateProject,
}) => {
  return (
    <Modal title="新建项目" open={open} onCancel={onCancel} footer={null}>
      <div className="py-4 space-y-6">
        {/* 创作模式选择 */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-3">
            选择创作模式
          </label>
          <div className="grid grid-cols-2 gap-3">
            {/* 剧本模式 */}
            <label
              className={`
                relative flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all
                ${
                  creationMode === 'script'
                    ? 'border-accent-primary bg-accent-primary/5 shadow-sm'
                    : 'border-border/60 bg-bg-secondary hover:border-accent-primary/40 hover:bg-bg-tertiary/30'
                }
              `}
            >
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <FileText size={20} className="text-blue-500" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-text-primary">剧本模式</div>
                <div className="text-xs text-text-muted mt-0.5">剧本 → 分解 → 片段 → 视频</div>
              </div>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  creationMode === 'script'
                    ? 'border-accent-primary bg-accent-primary'
                    : 'border-text-muted/30'
                }`}
              >
                {creationMode === 'script' && (
                  <div className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
              <input
                type="radio"
                name="creationMode"
                value="script"
                checked={creationMode === 'script'}
                onChange={(e) => handleModeChange('script', e.target.checked)}
                className="sr-only"
              />
            </label>

            {/* 即时创作 */}
            <label
              className={`
                relative flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all
                ${
                  creationMode === 'instant'
                    ? 'border-accent-primary bg-accent-primary/5 shadow-sm'
                    : 'border-border/60 bg-bg-secondary hover:border-accent-primary/40 hover:bg-bg-tertiary/30'
                }
              `}
            >
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Zap size={20} className="text-amber-500" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-text-primary">即时创作</div>
                <div className="text-xs text-text-muted mt-0.5">画布模式自由编排</div>
              </div>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  creationMode === 'instant'
                    ? 'border-accent-primary bg-accent-primary'
                    : 'border-text-muted/30'
                }`}
              >
                {creationMode === 'instant' && (
                  <div className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
              <input
                type="radio"
                name="creationMode"
                value="instant"
                checked={creationMode === 'instant'}
                onChange={(e) => handleModeChange('instant', e.target.checked)}
                className="sr-only"
              />
            </label>
          </div>
        </div>

        {/* 画面比例选择 */}
        <AspectRatioSelector
          value={aspectRatio}
          onChange={setAspectRatio}
          name="aspectRatio"
        />

        {/* 项目名称输入 */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            项目名称
          </label>
          <Input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="例如：我的悬疑短剧"
            size="large"
            className="bg-bg-tertiary border-border"
            onPressEnter={handleCreateProject}
          />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button onClick={onCancel}>取消</Button>
        <Button
          type="primary"
          onClick={handleCreateProject}
          disabled={!creationMode}
          className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
        >
          {creationMode === 'instant' ? '开始创作' : '创建项目'}
        </Button>
      </div>
    </Modal>
  );
};

interface EditProjectModalProps {
  editingProject: { id: string; name: string; aspectRatio: AspectRatio } | null;
  onCancel: () => void;
  editAspectRatio: AspectRatio;
  setEditAspectRatio: (v: AspectRatio) => void;
  editProjectName: string;
  setEditProjectName: (v: string) => void;
  handleSaveEdit: () => void;
}

/**
 * 修改项目弹窗
 */
export const EditProjectModal: React.FC<EditProjectModalProps> = ({
  editingProject,
  onCancel,
  editAspectRatio,
  setEditAspectRatio,
  editProjectName,
  setEditProjectName,
  handleSaveEdit,
}) => {
  return (
    <Modal title="修改项目" open={!!editingProject} onCancel={onCancel} footer={null}>
      <div className="py-4 space-y-6">
        <AspectRatioSelector
          value={editAspectRatio}
          onChange={setEditAspectRatio}
          name="editAspectRatio"
        />

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            项目名称
          </label>
          <Input
            value={editProjectName}
            onChange={(e) => setEditProjectName(e.target.value)}
            placeholder="例如：我的悬疑短剧"
            size="large"
            className="bg-bg-tertiary border-border"
            onPressEnter={handleSaveEdit}
          />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button onClick={onCancel}>取消</Button>
        <Button
          type="primary"
          onClick={handleSaveEdit}
          className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
        >
          保存
        </Button>
      </div>
    </Modal>
  );
};

interface AspectRatioSelectorProps {
  value: AspectRatio;
  onChange: (v: AspectRatio) => void;
  name: string;
}

const AspectRatioSelector: React.FC<AspectRatioSelectorProps> = ({ value, onChange, name }) => (
  <div>
    <label className="block text-sm font-medium text-text-secondary mb-3">
      选择画面比例
    </label>
    <div className="grid grid-cols-4 gap-3">
      {(['9:16', '16:9', '1:1', '21:9'] as AspectRatio[]).map((ratio) => (
        <label
          key={ratio}
          className={`
            relative flex flex-col items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all
            ${
              value === ratio
                ? 'border-accent-primary bg-accent-primary/5 shadow-sm'
                : 'border-border/60 bg-bg-secondary hover:border-accent-primary/40 hover:bg-bg-tertiary/30'
            }
          `}
        >
          <div
            className={`
              rounded border-2 transition-all flex items-center justify-center
              ${ratio === '16:9' ? 'w-10 h-6' : ratio === '9:16' ? 'w-5 h-8' : ratio === '1:1' ? 'w-7 h-7' : 'w-12 h-5'}
              ${value === ratio ? 'border-accent-primary bg-accent-primary/10' : 'border-text-muted/30 bg-bg-tertiary/50'}
            `}
          />
          <div className="text-sm font-medium text-text-primary">{ratio}</div>
          <input
            type="radio"
            name={name}
            value={ratio}
            checked={value === ratio}
            onChange={(e) => e.target.checked && onChange(ratio)}
            className="sr-only"
          />
        </label>
      ))}
    </div>
  </div>
);
