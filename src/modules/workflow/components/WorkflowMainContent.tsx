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
import { Select, Tooltip, Button, Modal } from 'antd';
import { FileText, Film, Layers, Clapperboard, Combine, Sparkles, Loader2, type LucideIcon } from 'lucide-react';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { WorkflowStep } from '@/modules/workflow/components/WorkflowContainer';
import { ScriptInput } from '@/modules/workflow/components/steps/ScriptInput';
import { ScriptReview } from '@/modules/workflow/components/steps/ScriptReview';
import { ScriptSplit } from '@/modules/workflow/components/steps/ScriptSplit';
import { EpisodeGenerate } from '@/modules/workflow/components/steps/EpisodeGenerate';
import { VideoCompose } from '@/modules/workflow/components/steps/VideoCompose';
import { SimplifiedEpisodeFlow } from '@/modules/workflow/components/SimplifiedEpisodeFlow';
import type { SimplifiedPanel } from '@/modules/workflow/components/EpisodeSidebarSteps';
import { WorkflowSidebar } from '@/modules/workflow/components/WorkflowSidebar';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { AssetPromptReviewButton } from '@/modules/workflow/components/AssetPromptReviewButton';
import { EpisodePromptReviewButton } from '@/modules/workflow/components/EpisodePromptReviewButton';
import { ScriptReviewButton } from '@/modules/workflow/components/ScriptReviewButton';
import { message } from '@/shared/utils/message';

interface StepDef {
  id: number;
  title: string;
  description: string;
  icon: LucideIcon;
}

interface TextModel {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
}

interface WorkflowMainContentProps {
  // 模式
  isSimplifiedMode: boolean;
  currentEpisode: number;

  // Steps 定义与状态
  steps: StepDef[];
  currentStep: number;
  localCurrentStep: number;
  setLocalCurrentStep: (step: number) => void;
  getStepStatus: (stepId: number) => 'completed' | 'active' | 'pending';
  onStepClick: (stepId: number) => void;

  // 文本数据
  script: string;
  hasScriptSplitData: boolean;
  hasEpisodesData: boolean;
  hasGeneratedVideos: boolean;
  episodesCount: number;

  // 模型选择
  textModel: string;
  setTextModel: (m: string) => void;
  textModels: TextModel[];

  // 加载状态
  isGeneratingScript: boolean;
  isParsingScript: boolean;
  isGeneratingEpisodes: boolean;

  // 操作
  parseScript: (opts: { replace: boolean }) => void;
  generateEpisodes: () => void;

  // 简化模式
  stepToPanel: (step: number) => SimplifiedPanel;
  handleSimplifiedStepChange: (step: number) => void;
  activeSceneId: string;
  setActiveSceneId: (id: string) => void;
  handleSceneChange: (sceneId: string) => void;

  // 全局资产
  onOpenGlobalAssets: () => void;

  // URL search params
  setSearchParams: (
    nextInit: (prev: URLSearchParams) => URLSearchParams,
    options?: { replace?: boolean },
  ) => void;

  // 分集切换中（sidebar 需要禁用，避免异步加载完成前点击被覆盖）
  isSwitchingEpisode?: boolean;
}

/**
 * Workflow 主内容区：根据模式渲染简化模式或 4 步标准模式
 */
export const WorkflowMainContent: React.FC<WorkflowMainContentProps> = ({
  isSimplifiedMode,
  currentEpisode,
  steps,
  currentStep,
  localCurrentStep,
  setLocalCurrentStep,
  getStepStatus,
  onStepClick,
  script,
  hasScriptSplitData,
  hasEpisodesData,
  hasGeneratedVideos,
  episodesCount,
  textModel,
  setTextModel,
  textModels,
  isGeneratingScript,
  isParsingScript,
  isGeneratingEpisodes,
  parseScript,
  generateEpisodes,
  stepToPanel,
  handleSimplifiedStepChange,
  activeSceneId,
  setActiveSceneId,
  handleSceneChange,
  onOpenGlobalAssets,
  setSearchParams,
  isSwitchingEpisode,
}) => {
  const { generateScript, resetAfterStep1, topic, artStyle, setCurrentStep } = useWorkflowStore();

  const handleRegenerateStoryFromHeader = () => {
    if (!topic.trim()) {
      message.warning('请输入话题或故事方向');
      return;
    }
    Modal.confirm({
      title: '确认重新生成故事？',
      content: '将根据话题重新生成新的故事梗概和剧本，现有梗概、剧本、已解析的角色/场景/片段数据都会被清空，此操作不可恢复。',
      okText: '确认重新生成',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        resetAfterStep1();
        setTimeout(() => generateScript(undefined, artStyle, true), 0);
      },
    });
  };

  return (
    <main className="w-full px-6 py-8 min-h-0 flex-1 max-md:px-3 max-md:py-4 max-md:pb-28">
      {isSimplifiedMode && currentEpisode !== 1 ? (
        // ===== 简化模式：第2集+（左侧 sidebar + 右侧内容） =====
        <div className="flex gap-8 max-md:flex-col max-md:gap-4">
          <WorkflowSidebar
            isSimplifiedMode={isSimplifiedMode}
            currentEpisode={currentEpisode}
            localCurrentStep={localCurrentStep}
            currentStep={currentStep}
            steps={steps}
            script={script}
            hasScriptSplitData={hasScriptSplitData}
            hasEpisodesData={hasEpisodesData}
            hasGeneratedVideos={hasGeneratedVideos}
            onSimplifiedStepChange={handleSimplifiedStepChange}
            onStepClick={onStepClick}
            onOpenGlobalAssets={onOpenGlobalAssets}
            isSwitchingEpisode={isSwitchingEpisode}
          />

          {/* 右侧内容区 */}
          {/* min-w-0：允许 flex 子项收缩，内部宽内容（如片段时间线）在容器内滚动而非撑开页面 */}
          <div className="flex-1 min-w-0 pl-24 max-md:pl-0">
            <SimplifiedEpisodeFlow
              activePanel={stepToPanel(localCurrentStep + 1)}
              onPanelChange={(panel) => {
                const step = panel === 'compose' ? 4 : panel === 'shots' ? 3 : panel === 'split' ? 2 : 1;
                handleSimplifiedStepChange(step);
              }}
              activeSceneId={activeSceneId}
              onSceneChange={handleSceneChange}
            />
          </div>
        </div>
      ) : (
        // ===== 标准模式：第1集（4步流程） =====
        <div className="flex gap-8 max-md:flex-col max-md:gap-4">
          <WorkflowSidebar
            isSimplifiedMode={isSimplifiedMode}
            currentEpisode={currentEpisode}
            localCurrentStep={localCurrentStep}
            currentStep={currentStep}
            steps={steps}
            script={script}
            hasScriptSplitData={hasScriptSplitData}
            hasEpisodesData={hasEpisodesData}
            hasGeneratedVideos={hasGeneratedVideos}
            onSimplifiedStepChange={handleSimplifiedStepChange}
            onStepClick={onStepClick}
            onOpenGlobalAssets={onOpenGlobalAssets}
            isSwitchingEpisode={isSwitchingEpisode}
          />

          {/* 右侧内容区 */}
          {/* min-w-0：允许 flex 子项收缩，内部宽内容（如片段时间线）在容器内滚动而非撑开页面 */}
          <div className="flex-1 min-w-0 pl-24 max-md:pl-0">
            {/* Step 1: 剧本输入 */}
            {localCurrentStep === 0 && (
              <WorkflowStep
                stepNumber={1}
                title={steps[0].title}
                description={steps[0].description}
                status={getStepStatus(0)}
                isActive={true}
                extra={
                  <div className="flex items-center gap-2 max-md:flex-wrap">
                    <span className="text-xs text-text-muted">剧本模型:</span>
                    <Select
                      value={textModel}
                      onChange={setTextModel}
                      disabled={!!script}
                      options={(textModels || []).map((m) => ({
                        value: m.id,
                        label: (
                          <Tooltip title={m.description}>
                            <span>{m.name}</span>
                          </Tooltip>
                        ),
                        disabled: m.disabled,
                      }))}
                      size="small" popupMatchSelectWidth={false} />
                    <ModelPriceTag model={(textModels || []).find(m => m.id === textModel)} />
                  </div>
                }
                stepIcon={<FileText size={20} />}
                customIcon={isGeneratingScript ? <Loader2 size={20} className="animate-spin" /> : undefined}
              >
                <ScriptInput onStepChange={setLocalCurrentStep} />
              </WorkflowStep>
            )}

            {/* Step 2: 剧本编辑 */}
            {localCurrentStep === 1 && (
              <WorkflowStep
                stepNumber={2}
                title={steps[1].title}
                description={steps[1].description}
                status={getStepStatus(1)}
                isActive={true}
                extra={
                  <div className="flex items-center gap-3 max-md:flex-wrap max-md:gap-2">
                    <div className="flex items-center gap-2 max-md:flex-wrap">
                      <span className="text-xs text-text-muted">剧本模型:</span>
                      <Select
                        value={textModel}
                        onChange={setTextModel}
                        options={textModels.map((m) => ({
                          value: m.id,
                          label: (
                            <Tooltip title={m.description}>
                              <span>{m.name}</span>
                            </Tooltip>
                          ),
                          disabled: m.disabled,
                        }))}

                        size="small" popupMatchSelectWidth={false} />
                      <ModelPriceTag model={textModels.find(m => m.id === textModel)} />
                    </div>
                    {/* 校验修改剧本：第2集+ 同样可用（分解后锁定禁用） */}
                    <ScriptReviewButton disabled={!script || currentStep >= 2} />
                    <Button
                      size="small"
                      disabled={currentStep >= 2}
                      onClick={handleRegenerateStoryFromHeader}
                      loading={isGeneratingScript}
                      icon={<Sparkles size={14} />}
                      className="text-text-muted hover:text-accent-primary border-border"
                    >
                      重新生成故事
                    </Button>
                  </div>
                }
                stepIcon={<Film size={20} />}
                customIcon={isGeneratingScript ? <Loader2 size={20} className="animate-spin" /> : undefined}
              >
                <ScriptReview onStepChange={setLocalCurrentStep} />
              </WorkflowStep>
            )}

            {/* Step 3: 剧本分解 */}
            {localCurrentStep === 2 && (
              <WorkflowStep
                stepNumber={3}
                title={steps[2].title}
                description={steps[2].description}
                status={getStepStatus(2)}
                isActive={true}
                extra={
                  <div className="flex items-center gap-3 max-md:flex-wrap max-md:gap-2">
                    {/* 剧本模型选择 */}
                    <div className="flex items-center gap-2 max-md:flex-wrap">
                      <span className="text-xs text-text-muted">剧本模型:</span>
                      <Select
                        value={textModel}
                        onChange={setTextModel}
                        options={textModels.map((m) => ({
                          value: m.id,
                          label: (
                            <Tooltip title={m.description}>
                              <span>{m.name}</span>
                            </Tooltip>
                          ),
                          disabled: m.disabled,
                        }))}

                        size="small" popupMatchSelectWidth={false} />
                      <ModelPriceTag model={textModels.find(m => m.id === textModel)} />
                    </div>

                    {/* 校验修改按钮：对分解后角色/场景的提示词进行校验和修改（已生成片段后锁定禁用） */}
                    <AssetPromptReviewButton disabled={episodesCount > 0 || !hasScriptSplitData} />

                    {/* 重新解析按钮：已生成片段时点击跳转 step4，否则触发重新分解 */}
                    <Button
                      size="small"
                      onClick={() => {
                        if (episodesCount > 0) {
                          // 已生成片段：直接跳转 step4（不依赖 currentStep 校准状态）
                          setLocalCurrentStep(3);
                          setSearchParams(prev => {
                            const next = new URLSearchParams(prev);
                            next.set('step', '4');
                            return next;
                          }, { replace: true });
                          return;
                        }
                        Modal.confirm({
                          title: '确认重新分解剧本？',
                          content: '重新分解剧本将清空已生成的片段数据，此操作不可恢复。',
                          okText: '确认重新分解',
                          cancelText: '取消',
                          okButtonProps: { danger: true },
                          onOk: () => {
                            setTimeout(() => parseScript({ replace: true }), 0);
                          },
                        });
                      }}
                      loading={isParsingScript}
                      className="border-border"
                    >
                      {episodesCount > 0 ? '已生成片段' : '重新分解'}
                    </Button>
                  </div>
                }
                stepIcon={<Layers size={20} />}
                customIcon={isParsingScript ? <Loader2 size={20} className="animate-spin" /> : undefined}
              >
                <ScriptSplit onStepChange={setLocalCurrentStep} />
              </WorkflowStep>
            )}

            {/* Step 4: 片段生成 */}
            {localCurrentStep === 3 && (
              <WorkflowStep
                stepNumber={4}
                title={steps[3].title}
                description={steps[3].description}
                status={getStepStatus(3)}
                isActive={true}
                extra={
                  <div className="flex items-center gap-3 max-md:flex-wrap max-md:gap-2">
                    {/* 剧本模型选择 */}
                    <div className="flex items-center gap-2 max-md:flex-wrap">
                      <span className="text-xs text-text-muted">剧本模型:</span>
                      <Select
                        value={textModel}
                        onChange={setTextModel}
                        options={textModels.map((m) => ({
                          value: m.id,
                          label: (
                            <Tooltip title={m.description}>
                              <span>{m.name}</span>
                            </Tooltip>
                          ),
                          disabled: m.disabled,
                        }))}

                        size="small" popupMatchSelectWidth={false} />
                      <ModelPriceTag model={textModels.find(m => m.id === textModel)} />
                    </div>
                    {/* 校验修改按钮：对片段/分镜提示词进行校验和修改（无片段时禁用） */}
                    <EpisodePromptReviewButton disabled={episodesCount === 0} />
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => {
                        if (episodesCount === 0) {
                          generateEpisodes();
                          return;
                        }
                        Modal.confirm({
                          title: '确认重新生成片段？',
                          content: '重新生成片段将清空已有的片段数据（包括生成的视频），此操作不可恢复。',
                          okText: '确认重新生成',
                          cancelText: '取消',
                          okButtonProps: { danger: true },
                          onOk: () => {
                            setTimeout(() => generateEpisodes(), 0);
                          },
                        });
                      }}
                      loading={isGeneratingEpisodes}
                      icon={<Sparkles size={14} />}
                      className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
                    >
                      {episodesCount === 0 ? '生成片段' : '重新生成'}
                    </Button>
                  </div>
                }
                stepIcon={<Clapperboard size={20} />}
                customIcon={isGeneratingEpisodes ? <Loader2 size={20} className="animate-spin" /> : undefined}
              >
                <EpisodeGenerate
                  initialEpisodeId={activeSceneId}
                  onTabChange={(episodeId) => {
                    setActiveSceneId(episodeId);
                    setSearchParams(prev => {
                      const next = new URLSearchParams(prev);
                      next.set('scene', episodeId);
                      return next;
                    }, { replace: true });
                  }}
                  onNextStep={() => {
                    // 推进项目级进度，sidebar 前 4 步显示为已完成
                    setCurrentStep(4);
                    setLocalCurrentStep(4);
                    setSearchParams(prev => {
                      const next = new URLSearchParams(prev);
                      next.set('step', '5');
                      return next;
                    }, { replace: true });
                  }}
                />
              </WorkflowStep>
            )}

            {/* Step 5: 视频合成 */}
            {localCurrentStep === 4 && (
              <WorkflowStep
                stepNumber={5}
                title={steps[4].title}
                description={steps[4].description}
                status={getStepStatus(4)}
                isActive={true}
                stepIcon={<Combine size={20} />}
              >
                <VideoCompose />
              </WorkflowStep>
            )}
          </div>
        </div>
      )}

      {/* 底部提示 */}
      {!isSimplifiedMode && (
        <div className="mt-8 text-center text-sm text-text-muted max-md:mt-4">
          当前进度: 第 {currentStep + 1} 步 / 共 {steps.length} 步
        </div>
      )}
    </main>
  );
};
