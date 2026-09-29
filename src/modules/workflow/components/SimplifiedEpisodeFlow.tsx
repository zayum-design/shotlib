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

import React, { useState, useMemo } from 'react';
import { Button, Input, Select, Tooltip, Modal } from 'antd';
import { Sparkles, FileText, Layers, Play, Clapperboard, Combine, Loader2, RotateCcw, Compass, Flame } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWorkflowStore } from '../stores/workflowStore';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { SimplifiedScriptSplit } from './SimplifiedScriptSplit';
import { ScriptReviewButton } from './ScriptReviewButton';
import { AssetPromptReviewButton } from './AssetPromptReviewButton';
import { EpisodePromptReviewButton } from './EpisodePromptReviewButton';
import { DevelopmentDirectionModal } from './DevelopmentDirectionModal';
import type { SimplifiedPanel } from './EpisodeSidebarSteps';
import { message } from '@/shared/utils/message';
import { useDevelopmentDirections, type DevelopmentCategory, type DevelopmentDirection } from '../hooks/useDevelopmentDirections';
import { useAgentTypes } from '../hooks/useAgentTypes';
import { WorkflowStep } from './WorkflowContainer';
import { EpisodeGenerate } from './steps/EpisodeGenerate';
import { VideoCompose } from './steps/VideoCompose';

const { TextArea } = Input;

interface SimplifiedEpisodeFlowProps {
  activePanel?: SimplifiedPanel;
  onPanelChange?: (panel: SimplifiedPanel) => void;
  activeSceneId?: string;
  onSceneChange?: (sceneId: string) => void;
}

const SimplifiedEpisodeFlowInner: React.FC<SimplifiedEpisodeFlowProps> = ({
  activePanel = 'script',
  onPanelChange,
  activeSceneId,
  onSceneChange,
}) => {
  const {
    topic,
    script,
    summary,
    isGeneratingScript,
    isParsingScript,
    isGeneratingEpisodes,
    episodes,
    generateScript,
    generateEpisodes,
    parseScript,
    setTopic,
    setScript,
    setSummary,
    textModel,
    textModels,
    setTextModel,
    isEnding,
    setIsEnding,
    agentType,
    artStyle,
    resetAfterStep1,
    activeCharacterIds,
    activeSceneIds,
  } = useWorkflowStore();

  // 简化模式：用是否已解析出活跃角色或场景来判断
  const isParsed = (activeCharacterIds?.length ?? 0) > 0 || (activeSceneIds?.length ?? 0) > 0;

  const { categories: directionCategories, isLoading: loadingDirections } = useDevelopmentDirections();
  const [directionModalOpen, setDirectionModalOpen] = useState(false);
  const { agentTypes } = useAgentTypes();

  // 第2集+ 的剧本生成使用上一集继承的配置：默认取当前主风格下的第一个子风格
  const defaultSubStyle = useMemo(() => {
    const currentAgentType = agentTypes.find((t) => t.id === agentType);
    return currentAgentType?.subStyles?.[0]?.id;
  }, [agentTypes, agentType]);

  const handleGenerateScript = async () => {
    if (!topic.trim()) {
      message.warning('请输入话题或故事方向');
      return;
    }
    await generateScript(defaultSubStyle, artStyle);
  };

  const handleRegenerateStory = () => {
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
      onOk: async () => {
        resetAfterStep1();
        await generateScript(defaultSubStyle, artStyle, true);
      },
    });
  };

  const handleRegenerateScriptOnly = () => {
    if (!topic.trim()) {
      message.warning('请输入话题或故事方向');
      return;
    }
    Modal.confirm({
      title: '确认重新生成剧本？',
      content: '将基于当前故事梗概重新生成剧本，已解析的角色/场景/片段数据会被清空，此操作不可恢复。',
      okText: '确认重新生成',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        resetAfterStep1();
        await generateScript(defaultSubStyle, artStyle, false);
      },
    });
  };

  const handleParseOnly = async () => {
    if (!script.trim()) {
      message.warning('剧本内容不能为空');
      return;
    }
    await parseScript();
    onPanelChange?.('split');
  };

  const handleDirectionClick = (_category: DevelopmentCategory, direction: DevelopmentDirection) => {
    setTopic(direction.name);
    setIsEnding(direction.isEnding);
    message.info(direction.isEnding ? '已选择大结局方向' : '已选择分集发展方向');
    setDirectionModalOpen(false);
  };

  // ===== 发展方向选择弹窗 =====
  const directionModal = (
    <DevelopmentDirectionModal
      open={directionModalOpen}
      onClose={() => setDirectionModalOpen(false)}
      categories={directionCategories}
      loading={loadingDirections}
      onSelect={handleDirectionClick}
    />
  );

  // ===== 面板1: 剧本续写 =====
  if (activePanel === 'script') {
    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-bg-secondary rounded-xl border border-border p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center">
                <FileText size={20} className="text-accent-primary" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-text-primary">剧本续写</h3>
                <p className="text-sm text-text-secondary">基于上一集剧情生成下一集剧本</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">剧本模型:</span>
              <Select
                value={textModel}
                onChange={setTextModel}
                disabled={isGeneratingScript}
                options={(textModels || []).map((m) => ({
                  value: m.id,
                  label: (
                    <Tooltip title={m.description}>
                      <span>{m.name}</span>
                    </Tooltip>
                  ),
                  disabled: m.disabled,
                }))}
                size="small" popupMatchSelectWidth={false}
              />
              <ModelPriceTag model={(textModels || []).find(m => m.id === textModel)} />
              {/* 校验修改剧本：与第1集 step2 步骤头部同一功能（无剧本或已分解后禁用） */}
              <ScriptReviewButton disabled={!script || isParsed} />
              {script && (
                <Button
                  size="small"
                  disabled={isParsed}
                  onClick={handleRegenerateStory}
                  loading={isGeneratingScript}
                  icon={<Sparkles size={12} />}
                  className="text-text-muted hover:text-accent-primary ml-2"
                >
                  重新生成故事
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-text-secondary">
                  主题或故事方向
                </label>
                <Button
                  type="text"
                  size="small"
                  icon={<Compass size={14} />}
                  loading={loadingDirections}
                  onClick={() => {
                    setDirectionModalOpen(true);
                  }}
                  className="text-text-muted hover:text-accent-primary"
                >
                  发展方向
                </Button>
              </div>
              <TextArea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例如：上一集结尾的悬念揭晓，主角面临新的挑战..."
                autoSize={{ minRows: 3, maxRows: 6 }}
                className="bg-bg-tertiary border-border rounded-lg"
              />
              {isEnding && (
                <div className="mt-2 text-xs text-amber-500 flex items-center gap-1">
                  <Flame size={12} />
                  <span>已标记为「大结局」，生成剧本时将作为最终集收尾</span>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              {!script && (
                <Button
                  type="primary"
                  size="large"
                  onClick={handleGenerateScript}
                  loading={isGeneratingScript}
                  disabled={isGeneratingScript}
                  icon={<Sparkles size={18} />}
                  className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
                >
                  {isGeneratingScript ? '正在生成剧本...' : '生成剧本'}
                </Button>
              )}
            </div>

            {script && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text-secondary">
                    故事梗概
                  </label>
                  <span className="text-xs text-text-muted">{summary.length} 字符</span>
                </div>

                <TextArea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  disabled={isParsingScript}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  className="bg-bg-tertiary border-border rounded-lg text-sm leading-relaxed"
                  placeholder="故事梗概（需逐幕/逐节拍概括，能直接反映剧本正文内容）..."
                />

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text-secondary">
                    生成的剧本
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">{script.length} 字符</span>
                    <span className="text-xs text-text-muted">剧本模型:</span>
                    <Select
                      value={textModel}
                      onChange={setTextModel}
                      disabled={isParsed}
                      options={textModels.map((m) => ({
                        value: m.id,
                        label: (
                          <Tooltip title={m.description}>
                            <span>{m.name}</span>
                          </Tooltip>
                        ),
                        disabled: m.disabled,
                      }))}
                      size="small" popupMatchSelectWidth={false}
                    />
                    <ModelPriceTag model={textModels.find(m => m.id === textModel)} />
                    <Button
                      size="small"
                      disabled={isParsed}
                      onClick={handleRegenerateScriptOnly}
                      loading={isGeneratingScript}
                      icon={<RotateCcw size={12} />}
                      className="text-text-muted hover:text-accent-primary"
                    >
                      重新生成剧本
                    </Button>
                  </div>
                </div>

                <TextArea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  disabled={isParsingScript}
                  autoSize={{ minRows: 10, maxRows: 24 }}
                  className="bg-bg-tertiary border-border rounded-lg font-mono text-sm leading-relaxed"
                />

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button
                    type="primary"
                    size="large"
                    onClick={handleParseOnly}
                    loading={isParsingScript}
                    disabled={isParsingScript}
                    icon={<Play size={18} />}
                    className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
                  >
                    {isParsingScript ? '正在解析剧本...' : '下一步：解析剧本'}
                  </Button>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
        {directionModal}
      </div>
    );
  }

  // ===== 面板2: 剧本分解 =====
  if (activePanel === 'split') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="bg-bg-secondary rounded-xl border border-border p-6 mb-6">
          <div className="flex items-center justify-between gap-3 max-md:flex-col max-md:items-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent-secondary/20 flex items-center justify-center">
                <Layers size={20} className="text-accent-secondary" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-text-primary">剧本分解</h3>
                <p className="text-sm text-text-secondary">
                  检查本集与上一集复用的角色、场景和道具，确认后生成片段
                </p>
              </div>
            </div>
            {/* 校验修改角色/场景提示词：与第1集 step3 步骤头部同一功能（已生成片段后锁定禁用） */}
            <AssetPromptReviewButton disabled={episodes.length > 0 || !isParsed} />
          </div>
        </div>
        <SimplifiedScriptSplit onNext={() => onPanelChange?.('shots')} />
        {directionModal}
      </motion.div>
    );
  }

  // ===== 面板3: 片段生成（与第1集 step4 保持同一样式） =====
  if (activePanel === 'shots') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <WorkflowStep
          stepNumber={3}
          title="片段生成"
          description="生成片段视频提示词"
          status="active"
          isActive={true}
          stepIcon={<Clapperboard size={20} />}
          customIcon={isGeneratingEpisodes ? <Loader2 size={20} className="animate-spin" /> : undefined}
          extra={
            <div className="flex items-center gap-2">
              {/* 校验修改片段/分镜提示词：与第1集 step4 步骤头部同一功能（无片段时禁用） */}
              <EpisodePromptReviewButton disabled={episodes.length === 0} />
              <Button
                type="primary"
                size="small"
                onClick={() => {
                  if (episodes.length === 0) {
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
                {episodes.length === 0 ? '生成片段' : '重新生成'}
              </Button>
            </div>
          }
        >
          <EpisodeGenerate
            initialEpisodeId={activeSceneId}
            onTabChange={(episodeId) => onSceneChange?.(episodeId)}
            onNextStep={() => onPanelChange?.('compose')}
          />
        </WorkflowStep>
        {directionModal}
      </motion.div>
    );
  }

  // ===== 面板4: 视频合成（与第1集 step5 一致） =====
  if (activePanel === 'compose') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <WorkflowStep
          stepNumber={4}
          title="视频合成"
          description="合并片段视频为完整短片"
          status="active"
          isActive={true}
          stepIcon={<Combine size={20} />}
        >
          <VideoCompose />
        </WorkflowStep>
        {directionModal}
      </motion.div>
    );
  }

  // 未知面板
  return directionModal;
};

export const SimplifiedEpisodeFlow = React.memo(SimplifiedEpisodeFlowInner);