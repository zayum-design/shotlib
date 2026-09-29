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

import { Card, Input } from 'antd';
import { Globe, Calendar, MapPin, Users, Sparkles } from 'lucide-react';
import type { Era } from '../../types';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { useState } from 'react';

interface EraDisplayProps {
  era: Era;
}

export const EraDisplay: React.FC<EraDisplayProps> = ({ era }) => {
  const { updateEra } = useWorkflowStore();
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);

  const handleFieldChange = (field: keyof Era, value: string) => {
    updateEra({ [field]: value });
  };

  return (
    <Card className="bg-bg-secondary border-border rounded-xl overflow-hidden">
      {/* 时代头部 */}
      <div className="flex items-start gap-4 mb-4">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-accent-primary/20 to-accent-secondary/20 flex items-center justify-center flex-shrink-0">
          <Globe size={32} className="text-accent-primary" />
        </div>
        <div className="flex-1">
          <Input
            value={era.name}
            onChange={(e) => handleFieldChange('name', e.target.value)}
            className="text-xl font-bold bg-transparent border-border mb-1"
            placeholder="时代名称"
          />
          <Input.TextArea
            value={era.description}
            onChange={(e) => handleFieldChange('description', e.target.value)}
            className="text-sm text-text-secondary bg-transparent border-border"
            placeholder="时代描述"
            autoSize={{ minRows: 2, maxRows: 3 }}
          />
        </div>
      </div>

      {/* 时代属性 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="flex items-center gap-3 text-sm bg-bg-tertiary rounded-lg p-3">
          <Calendar size={16} className="text-accent-warning flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-text-muted block">年份</span>
            <Input
              value={era.year}
              onChange={(e) => handleFieldChange('year', e.target.value)}
              className="bg-transparent border-0 p-0 text-sm"
              placeholder="如：2020年代"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm bg-bg-tertiary rounded-lg p-3">
          <MapPin size={16} className="text-accent-info flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-text-muted block">地理背景</span>
            <Input
              value={era.location}
              onChange={(e) => handleFieldChange('location', e.target.value)}
              className="bg-transparent border-0 p-0 text-sm"
              placeholder="如：中国一线城市"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm bg-bg-tertiary rounded-lg p-3 lg:col-span-2">
          <Users size={16} className="text-accent-success flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-text-muted block">社会背景</span>
            <Input.TextArea
              value={era.socialBackground}
              onChange={(e) => handleFieldChange('socialBackground', e.target.value)}
              className="bg-transparent border-0 p-0 text-sm"
              placeholder="社会背景描述"
              autoSize={{ minRows: 1, maxRows: 2 }}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm bg-bg-tertiary rounded-lg p-3">
          <Sparkles size={16} className="text-accent-secondary flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-text-muted block">文化特征</span>
            <Input
              value={era.culturalFeatures}
              onChange={(e) => handleFieldChange('culturalFeatures', e.target.value)}
              className="bg-transparent border-0 p-0 text-sm"
              placeholder="文化特征"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm bg-bg-tertiary rounded-lg p-3">
          <Globe size={16} className="text-accent-primary flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-text-muted block">视觉风格</span>
            <Input
              value={era.visualStyle}
              onChange={(e) => handleFieldChange('visualStyle', e.target.value)}
              className="bg-transparent border-0 p-0 text-sm"
              placeholder="视觉风格"
            />
          </div>
        </div>
      </div>

      {/* 故事全局提示词 */}
      <div className="mt-4">
        <label className="text-xs text-text-muted mb-1 block">故事全局提示词</label>
        {isEditingPrompt ? (
          <Input.TextArea
            value={era.globalPrompt}
            onChange={(e) => handleFieldChange('globalPrompt', e.target.value)}
            onBlur={() => setIsEditingPrompt(false)}
            autoFocus
            autoSize={{ minRows: 2, maxRows: 4 }}
            className="bg-bg-tertiary border-border text-sm"
          />
        ) : (
          <div
            onClick={() => setIsEditingPrompt(true)}
            className="bg-bg-tertiary rounded p-2 text-sm text-text-secondary cursor-pointer hover:bg-bg-tertiary/80 transition-colors"
          >
            <span className="truncate block">{era.globalPrompt}</span>
          </div>
        )}
      </div>
    </Card>
  );
};
