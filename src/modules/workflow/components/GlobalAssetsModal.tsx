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
import { Library, XCircle } from 'lucide-react';
import { GlobalAssetsPanel } from '@/modules/workflow/components/GlobalAssetsPanel';

interface GlobalAssetsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 全局项目资产 Modal：跨分集共享的角色、场景与背景设定
 */
export const GlobalAssetsModal: React.FC<GlobalAssetsModalProps> = ({ open, onClose }) => {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="100vw"
      style={{ top: 0, padding: 0, maxWidth: '100vw' }}
      styles={{
        body: { padding: 0, height: '100vh', overflow: 'auto', background: 'var(--bg-primary)' },
        mask: { backgroundColor: 'rgba(0,0,0,0.85)' },
      }}
      closable={false}
      className="global-assets-modal"
      wrapClassName="global-assets-modal-wrap"
      title={null}
    >
      {/* 自定义头部 */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 border-b border-border bg-bg-secondary/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent-primary/20 flex items-center justify-center">
            <Library size={18} className="text-accent-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">项目资产库</h2>
            <p className="text-xs text-text-secondary">跨分集共享的角色、场景与背景设定</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-bg-tertiary hover:bg-accent-primary/20 transition-colors group"
          title="关闭"
        >
          <XCircle size={22} className="text-text-muted group-hover:text-accent-primary transition-colors" />
        </button>
      </div>
      <div className="p-6">
        <GlobalAssetsPanel />
      </div>
    </Modal>
  );
};
