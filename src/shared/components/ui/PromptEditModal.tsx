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
import { Modal, Input } from 'antd';
import { VisualPromptEditor } from './VisualPromptEditor';
import type { Character, Scene, ShotReferenceAsset } from '../../types';

interface PromptEditModalProps {
  title: string;
  open: boolean;
  value: string;
  onChange: (v: string) => void;
  onOk: () => void;
  onCancel: () => void;
  characters: Character[];
  scenes: Scene[];
  /** 可引用的参考资产（输入 ! 触发，含道具伪资产等） */
  referenceAssets?: ShotReferenceAsset[];
  placeholder: string;
  withLabel?: boolean;
  /** 纯文本模式：用普通文本框编辑，不支持 @ 角色 / # 场景 插入（用于首尾帧视频提示词等仅需文字指导的场景） */
  plainText?: boolean;
}

/**
 * 通用提示词编辑弹窗：首帧/尾帧/首尾帧视频
 */
export const PromptEditModal: React.FC<PromptEditModalProps> = ({
  title,
  open,
  value,
  onChange,
  onOk,
  onCancel,
  characters,
  scenes,
  referenceAssets,
  placeholder,
  withLabel = false,
  plainText = false,
}) => {
  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={700}
      destroyOnHidden
    >
      <div className="py-4 space-y-4">
        <div>
          {withLabel && (
            <label className="text-sm text-text-secondary mb-2 block">画面描述</label>
          )}
          {plainText ? (
            <Input.TextArea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              autoSize={{ minRows: 6 }}
            />
          ) : (
            <VisualPromptEditor
              value={value}
              onChange={onChange}
              characters={characters}
              scenes={scenes}
              referenceAssets={referenceAssets}
              placeholder={placeholder}
              minRows={6}
            />
          )}
          {!plainText && (
            <p className="text-xs text-text-muted mt-2">
              提示：输入 @ 可快速插入角色标签，输入 # 可快速插入场景标签{referenceAssets?.length ? '，输入 ! 可引用道具' : ''}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
