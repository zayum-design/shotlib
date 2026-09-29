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
import { CheckCircle2, Library, type LucideIcon } from 'lucide-react';
import { EpisodeSidebarSteps } from '@/modules/workflow/components/EpisodeSidebarSteps';

interface StepDef {
  id: number;
  title: string;
  description: string;
  icon: LucideIcon;
}

interface WorkflowSidebarProps {
  isSimplifiedMode: boolean;
  currentEpisode: number;
  localCurrentStep: number;
  currentStep: number;
  steps: StepDef[];
  script: string;
  hasScriptSplitData: boolean;
  hasEpisodesData: boolean;
  hasGeneratedVideos?: boolean;
  onSimplifiedStepChange: (step: number) => void;
  onStepClick: (stepId: number) => void;
  onOpenGlobalAssets: () => void;
  isSwitchingEpisode?: boolean;
}

/**
 * Workflow 左侧浮动导航组件：根据模式渲染分集导航或 4 步流程导航
 */
export const WorkflowSidebar: React.FC<WorkflowSidebarProps> = ({
  isSimplifiedMode,
  currentEpisode,
  localCurrentStep,
  currentStep,
  steps,
  script,
  hasScriptSplitData,
  hasEpisodesData,
  hasGeneratedVideos,
  onSimplifiedStepChange,
  onStepClick,
  onOpenGlobalAssets,
  isSwitchingEpisode,
}) => {
  const globalAssetsButton = (
    <button
      onClick={onOpenGlobalAssets}
      className={`relative group ${isSimplifiedMode && currentEpisode !== 1 ? '' : 'mt-3'}`}
      title="查看全部项目资产"
    >
      <div className="w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 relative z-10 bg-bg-secondary border border-border shadow-md shadow-black/20 hover:border-accent-primary/50 hover:shadow-accent-primary/20 hover:shadow-lg max-md:w-10 max-md:h-10">
        <Library size={20} className="text-text-secondary group-hover:text-accent-primary transition-colors" />
      </div>
      {/* hover 滑出标签 */}
      <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-bg-secondary border border-border shadow-lg shadow-black/20 whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
        <span className="text-sm font-medium text-text-primary">项目资产库</span>
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-bg-secondary border-l border-b border-border rotate-45" />
      </div>
    </button>
  );

  if (isSimplifiedMode && currentEpisode !== 1) {
    // ===== 简化模式：分集 sidebar =====
    return (
      <div className="fixed left-0 top-1/2 -translate-y-1/2 z-40 ml-2 flex flex-col gap-3 max-md:fixed max-md:bottom-0 max-md:top-auto max-md:left-0 max-md:right-0 max-md:w-full max-md:translate-y-0 max-md:ml-0 max-md:px-3 max-md:py-2 max-md:bg-bg-secondary/95 max-md:backdrop-blur-sm max-md:border-t max-md:border-border max-md:flex-row max-md:justify-center max-md:items-center">
        <EpisodeSidebarSteps
          activeStep={localCurrentStep + 1}
          onStepChange={onSimplifiedStepChange}
          disabled={isSwitchingEpisode}
        />
        {globalAssetsButton}
      </div>
    );
  }

  // ===== 标准模式：4 步流程导航 =====
  return (
    <div className="fixed left-0 top-1/2 -translate-y-1/2 z-40 ml-2 max-md:fixed max-md:bottom-0 max-md:top-auto max-md:left-0 max-md:right-0 max-md:w-full max-md:translate-y-0 max-md:ml-0 max-md:px-3 max-md:py-2 max-md:bg-bg-secondary/95 max-md:backdrop-blur-sm max-md:border-t max-md:border-border">
      <div className="bg-bg-secondary rounded-full pl-4 pr-6 py-4 shadow-lg shadow-black/30 border border-border max-md:inline-flex max-md:flex-row max-md:justify-center max-md:items-center max-md:gap-2 max-md:rounded-full max-md:px-3 max-md:py-2 max-md:shadow-none max-md:border-0">
        <div className="flex flex-col gap-3 max-md:flex-row max-md:gap-2">
          {steps.map((step) => {
            const Icon = step.icon;
            // currentStep 是项目级绝对进度（锁死），localCurrentStep 是当前显示的 panel
            const isActive = localCurrentStep === step.id;
            // Step 0 完成后（script 有值表示剧本生成成功）才算完成
            const isStep0Completed = !!script;
            const isCompleted = step.id === 0 ? isStep0Completed : currentStep > step.id;
            const isPending = step.id === 0
              ? !script && currentStep === 0
              : step.id === 1
                ? !script
                : step.id === 2
                  ? currentStep < step.id && !hasScriptSplitData
                  : step.id === 3
                    ? currentStep < step.id && !hasEpisodesData
                    : step.id === 4
                      ? !hasGeneratedVideos
                      : currentStep < step.id;

            return (
              <button
                key={step.id}
                onClick={() => !isSwitchingEpisode && onStepClick(step.id)}
                disabled={isPending || isSwitchingEpisode}
                className={`relative group ${isSwitchingEpisode ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={step.title}
              >
                {/* 图标容器 */}
                <div className={`
                  w-12 h-12 rounded-full flex items-center justify-center max-md:w-10 max-md:h-10
                  transition-all duration-300 relative z-10
                  ${isActive ? 'bg-accent-primary/20' : isCompleted ? 'bg-accent-success/20' : 'bg-bg-tertiary/50'}
                `}>
                  <Icon size={22} className={isActive ? 'text-accent-primary' : isCompleted ? 'text-accent-success' : 'text-text-muted'} />
                </div>
                {/* 步骤编号徽章 */}
                <div className={`
                  absolute -right-1 -bottom-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border-2 border-bg-secondary
                  ${isActive ? 'bg-accent-primary text-white' : isCompleted ? 'bg-accent-success text-white' : 'bg-bg-tertiary text-text-muted'}
                `}>
                  {isCompleted ? <CheckCircle2 size={10} /> : step.id + 1}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {globalAssetsButton}
    </div>
  );
};
