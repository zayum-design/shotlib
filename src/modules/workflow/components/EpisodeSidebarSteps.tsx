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

import { FileText, Layers, Film, Combine } from 'lucide-react';
import { useWorkflowStore } from '../stores/workflowStore';
import { getEpisodeVideoUrl } from '../utils/workflowUtils';

export type SimplifiedPanel = 'script' | 'split' | 'shots' | 'compose';

interface EpisodeSidebarStepsProps {
  activeStep: number;      // 1, 2, 3
  onStepChange: (step: number) => void;
  disabled?: boolean;
}

export const EpisodeSidebarSteps: React.FC<EpisodeSidebarStepsProps> = ({
  activeStep,
  onStepChange,
  disabled = false,
}) => {
  // 从 store 获取数据用于判断步骤是否可点击
  const activeCharacterIds = useWorkflowStore((state) => state.activeCharacterIds);
  const activeSceneIds = useWorkflowStore((state) => state.activeSceneIds);
  const episodes = useWorkflowStore((state) => state.episodes);

  // Step 2 (剧本分解) 可点击条件：有活跃角色/场景（即本集剧本已解析产生角色/场景数据）
  // 使用 active IDs 而非 characters/scenes 全量，避免新建分集时误判为可点击
  const isStep2Clickable = (activeCharacterIds?.length ?? 0) > 0 || (activeSceneIds?.length ?? 0) > 0;
  // Step 3 (片段列表) 可点击条件：本集已生成片段数据。
  // 注意：此处不再依赖项目级 currentStep——简化模式下 currentStep 的校准目标（有片段时为 2）
  // 与本组件要求的 >= 3 不一致，会导致生成片段后 step3 仍被禁用。
  // episodes 有数据已隐含"完成了剧本分解并生成了片段"，无需额外门控。
  const isStep3Clickable = (episodes?.length ?? 0) > 0;
  // Step 4 (视频合成) 可点击条件：本集至少一个片段已生成视频（与第1集 step5 判定一致）
  const isStep4Clickable = (episodes || []).some((ep) => !ep.deleted && !!getEpisodeVideoUrl(ep));

  const panels = [
    { step: 1, title: '剧本续写', icon: FileText, clickable: true },
    { step: 2, title: '剧本分解', icon: Layers, clickable: isStep2Clickable },
    { step: 3, title: '片段列表', icon: Film, clickable: isStep3Clickable },
    { step: 4, title: '视频合成', icon: Combine, clickable: isStep4Clickable },
  ];

  return (
    <div>
      <div className="bg-bg-secondary rounded-full pl-4 pr-6 py-4 shadow-lg shadow-black/30 border border-border max-md:inline-flex max-md:flex-row max-md:justify-center max-md:items-center max-md:gap-2 max-md:rounded-full max-md:px-3 max-md:py-2 max-md:shadow-none max-md:border-0">
        <div className="flex flex-col gap-3 max-md:flex-row max-md:gap-2">
          {panels.map((panel) => {
            const Icon = panel.icon;
            const isActive = activeStep === panel.step;

            return (
              <button
                key={panel.step}
                onClick={() => !disabled && panel.clickable && onStepChange(panel.step)}
                disabled={disabled || !panel.clickable}
                className={`relative group ${disabled || !panel.clickable ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                title={panel.title}
              >
                {/* 图标容器 */}
                <div
                  className={`
                    w-12 h-12 rounded-full flex items-center justify-center max-md:w-10 max-md:h-10
                    transition-all duration-300 relative z-10
                    ${isActive ? 'bg-accent-primary/20' : 'bg-bg-tertiary/50 hover:bg-bg-tertiary'}
                    ${!panel.clickable ? 'opacity-60' : ''}
                  `}
                >
                  <Icon
                    size={22}
                    className={isActive ? 'text-accent-primary' : 'text-text-muted'}
                  />
                </div>
                {/* 步骤编号徽章 */}
                <div
                  className={`
                    absolute -right-1 -bottom-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border-2 border-bg-secondary
                    ${isActive ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-muted'}
                  `}
                >
                  {panel.step}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
