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

import { Button, Input, Modal, Select, Tooltip } from 'antd';
import { ArrowRight, RotateCcw, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWorkflowStore } from '../../stores/workflowStore';
import { ScriptReviewButton } from '../ScriptReviewButton';
import { message } from '@/shared/utils/message';
import { ModelPriceTag } from '@/shared/utils/modelPrice';

const { TextArea } = Input;

interface ScriptReviewProps {
  onStepChange?: (step: number) => void;
}

export const ScriptReview: React.FC<ScriptReviewProps> = ({ onStepChange }) => {
  const {
    script,
    summary,
    currentStep,
    setScript,
    setSummary,
    setCurrentStep,
    setTextModel,
    textModel,
    textModels,
    parseScript,
    isParsingScript,
    generateScript,
    isGeneratingScript,
    topic,
    resetAfterStep1,
    activeCharacterIds,
    artStyle,
  } = useWorkflowStore();

  // 按当前分集活跃ID判断是否已解析
  // 无 active IDs 时：currentStep >= 2 说明是旧数据/导入数据（回退兼容）；否则（新分集）未解析
  const hasParsedCharacters = activeCharacterIds?.length > 0
    || currentStep >= 2;

  // 第3步完成后锁定（剧本已分解，不可编辑剧本，操作按钮全部禁用）
  const isLocked = hasParsedCharacters;

  const handleNext = () => {
    if (!script.trim()) {
      message.warning('剧本内容不能为空');
      return;
    }
    setCurrentStep(2);
    onStepChange?.(2);
    // 如果已经有剧本分解结果（角色数据存在），则不再重新提交分解
    if (!hasParsedCharacters) {
      setTimeout(() => parseScript(), 100);
    }
  };

  const handleRegenerateScriptOnly = () => {
    if (!topic.trim()) {
      message.warning('请输入话题或上传剧本');
      return;
    }
    Modal.confirm({
      title: '确认重新生成剧本？',
      content: '将基于当前故事梗概重新生成剧本，已解析的角色、场景、故事背景以及已生成的片段数据会被清空，此操作不可恢复。',
      okText: '确认重新生成',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        resetAfterStep1();
        setTimeout(() => generateScript(undefined, artStyle, false), 0);
      },
    });
  };

  // 校验/修改剧本功能已提取为共享组件 ScriptReviewButton（步骤头部与本步骤共用）

  const handleBackToInput = () => {
    setCurrentStep(0);
    onStepChange?.(0);
  };

  if (!script) {
    return (
      <div className="text-center py-12 text-text-muted">
        <FileText size={48} className="mx-auto mb-4 opacity-50" />
        <p>请先在步骤1生成剧本</p>
        <Button
          type="primary"
          className="mt-4 bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
          onClick={handleBackToInput}
        >
          返回步骤1
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        {isLocked && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-sm">
            <FileText size={16} />
            <span>剧本已分解，当前步骤锁定不可编辑。如需修改请返回步骤1重新生成剧本。</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-text-secondary">
            故事梗概
          </label>
          <span className="text-xs text-text-muted">{summary.length} 字符</span>
        </div>

        <TextArea
          value={summary}
          onChange={(e) => !isLocked && setSummary(e.target.value)}
          autoSize={{ minRows: 4, maxRows: 8 }}
          readOnly={isLocked}
          className={`bg-bg-tertiary border-border rounded-lg text-sm leading-relaxed ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
          placeholder="故事梗概（需逐幕/逐节拍概括，能直接反映剧本正文内容）..."
        />

        <div className="flex items-center justify-between max-md:flex-col max-md:items-start max-md:gap-2">
          <label className="text-sm font-medium text-text-secondary">
            生成的剧本
          </label>
          <div className="flex items-center gap-3 max-md:flex-wrap max-md:gap-2">
            <span className="text-xs text-text-muted">{script.length} 字符</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">剧本模型:</span>
              <Select
                value={textModel}
                onChange={setTextModel}
                disabled={isLocked}
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
              <ScriptReviewButton disabled={isLocked} />
              <Button
                size="small"
                disabled={isLocked}
                onClick={handleRegenerateScriptOnly}
                loading={isGeneratingScript}
                icon={<RotateCcw size={12} />}
                className="text-text-muted hover:text-accent-primary"
              >
                重新生成剧本
              </Button>
            </div>
          </div>
        </div>

        <TextArea
          value={script}
          onChange={(e) => !isLocked && setScript(e.target.value)}
          autoSize={{ minRows: 12, maxRows: 24 }}
          readOnly={isLocked}
          className={`bg-bg-tertiary border-border rounded-lg font-mono text-sm leading-relaxed ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
          placeholder="剧本内容..."
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-between pt-4 border-t border-border max-md:flex-wrap max-md:gap-2"
      >
        <Button
          size="large"
          onClick={handleBackToInput}
          className="border-border hover:border-accent-primary"
        >
          返回上一步
        </Button>
        <Button
          type="primary"
          size="large"
          onClick={handleNext}
          loading={isParsingScript}
          icon={<ArrowRight size={18} />}
          iconPlacement="end"
          className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
        >
          下一步：剧本分解
        </Button>
      </motion.div>

    </div>
  );
};
