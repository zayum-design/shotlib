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
 * 顶栏入口按钮(纯前端版)
 *
 * 原版为用户菜单(个人中心/积分/充值/退出登录);开源版无登录体系,
 * 语义改为「设置」入口:打开内置 SettingsModal(API Key/代理/数据管理)。
 * 组件名与 props 保持不变,消费方零改动。
 */
import { useState } from 'react';
import { Settings } from 'lucide-react';
import { SettingsModal } from './SettingsModal';

interface UserProfileButtonProps {
  onLoginClick?: () => void;
  onHistoryClick?: () => void;
  onSettingsClick?: () => void;
}

export function UserProfileButton({ onSettingsClick }: UserProfileButtonProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => {
          setSettingsOpen(true);
          onSettingsClick?.();
        }}
        title="设置"
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-tertiary/50 border border-border hover:bg-bg-tertiary transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-accent-primary/20 flex items-center justify-center">
          <Settings size={14} className="text-accent-primary" />
        </div>
        <span className="text-sm text-text-secondary">设置</span>
      </button>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
