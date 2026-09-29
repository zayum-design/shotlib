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

import { useState } from 'react';
import { Modal, Tabs, Switch } from 'antd';
import { Settings, Moon } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
  const { theme, setTheme } = useThemeStore();
  const [activeTab, setActiveTab] = useState('basic');

  const isDark = theme === 'dark';

  const handleDarkModeChange = (checked: boolean) => {
    setTheme(checked ? 'dark' : 'light');
  };

  const tabItems = [
    {
      key: 'basic',
      label: '基础设置',
      children: (
        <div className="space-y-6 py-2">
          <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-bg-secondary">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-bg-tertiary/50 flex items-center justify-center">
                <Moon size={20} className="text-indigo-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-primary">默认暗黑模式</div>
                <div className="text-xs text-text-muted">开启后页面将以暗黑模式显示</div>
              </div>
            </div>
            <Switch
              checked={isDark}
              onChange={handleDarkModeChange}
            />
          </div>
        </div>
      ),
    },
  ];

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <Settings size={18} className="text-accent-primary" />
          <span>设置</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        className="settings-tabs"
      />
    </Modal>
  );
};
