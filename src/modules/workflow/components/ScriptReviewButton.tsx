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
import { Button, Input, Modal, Radio } from 'antd';
import { ClipboardCheck } from 'lucide-react';
import { useWorkflowStore } from '../stores/workflowStore';
import { diffScriptLines, collapseUnchangedLines } from '../utils/scriptDiffUtils';
import { message } from '@/shared/utils/message';

const { TextArea } = Input;

interface ScriptReviewButtonProps {
  disabled?: boolean;
}

/**
 * 「校验修改剧本」按钮（含完整弹窗流程）：
 * 校验审阅 → 报告展示 → 可按建议直接修改；修改剧本 → 差异对比 → 确认后应用。
 * 从 ScriptReview 步骤提取为共享组件，供步骤2正文与步骤头部（第2集+ 重新生成故事旁）复用。
 */
export const ScriptReviewButton: React.FC<ScriptReviewButtonProps> = ({ disabled }) => {
  const {
    script,
    reviewScript,
    isReviewingScript,
    applyModifiedScript,
  } = useWorkflowStore();

  // 校验/修改剧本 dialog 状态
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState<'review' | 'modify'>('review');
  const [reviewRequirement, setReviewRequirement] = useState('');
  // 校验审阅报告展示
  const [reviewReport, setReviewReport] = useState<string | null>(null);
  // 修改差异对比：修改成功后暂存新旧剧本，确认后才应用
  const [pendingDiff, setPendingDiff] = useState<{ oldScript: string; newScript: string } | null>(null);
  const [isApplyingDiff, setIsApplyingDiff] = useState(false);

  const handleOpenReviewModal = () => {
    if (!script.trim()) {
      message.warning('剧本内容为空，无法校验或修改');
      return;
    }
    setReviewMode('review');
    setReviewRequirement('');
    setReviewModalOpen(true);
  };

  const handleConfirmReview = async () => {
    if (reviewMode === 'modify' && !reviewRequirement.trim()) {
      message.warning('请输入修改要求');
      return;
    }
    const mode = reviewMode;
    const oldScript = script;
    setReviewModalOpen(false);
    const result = await reviewScript(
      mode,
      mode === 'modify' ? reviewRequirement.trim() : undefined,
    );
    if (!result) return;
    // mode=review 时返回审阅报告，弹窗展示
    if (mode === 'review') {
      setReviewReport(result);
    } else {
      // mode=modify 时返回新剧本，先展示差异对比，确认后才应用
      setPendingDiff({ oldScript, newScript: result });
    }
  };

  // 按校验报告的建议直接修改剧本（报告作为修改要求走 modify 流程）
  const handleApplyReviewSuggestions = async () => {
    if (!reviewReport) return;
    const report = reviewReport;
    const oldScript = script;
    setReviewReport(null);
    const newScript = await reviewScript(
      'modify',
      `请根据以下校验审阅报告中的问题清单和修改建议，对剧本进行修改：\n\n${report}`,
    );
    if (newScript) {
      // 展示差异对比，确认后才应用
      setPendingDiff({ oldScript, newScript });
    }
  };

  // 确认应用修改后的剧本
  const handleConfirmApplyDiff = async () => {
    if (!pendingDiff) return;
    setIsApplyingDiff(true);
    try {
      await applyModifiedScript(pendingDiff.newScript);
      setPendingDiff(null);
    } finally {
      setIsApplyingDiff(false);
    }
  };

  // 差异对比数据（修改成功后暂存的新旧剧本）
  const diffLines = pendingDiff
    ? diffScriptLines(pendingDiff.oldScript, pendingDiff.newScript)
    : [];
  const addedCount = diffLines.filter((l) => l.type === 'add').length;
  const deletedCount = diffLines.filter((l) => l.type === 'del').length;
  const collapsedDiffItems = collapseUnchangedLines(diffLines);

  return (
    <>
      <Button
        size="small"
        disabled={disabled}
        onClick={handleOpenReviewModal}
        loading={isReviewingScript}
        icon={<ClipboardCheck size={12} />}
        className="text-text-muted hover:text-accent-primary"
      >
        校验修改剧本
      </Button>

      {/* 校验/修改剧本选择弹窗 */}
      <Modal
        title="校验修改剧本"
        open={reviewModalOpen}
        onOk={handleConfirmReview}
        onCancel={() => setReviewModalOpen(false)}
        okText={reviewMode === 'modify' ? '开始修改' : '开始校验'}
        cancelText="取消"
        confirmLoading={isReviewingScript}
        destroyOnHidden
      >
        <div className="space-y-4 py-2">
          <Radio.Group
            value={reviewMode}
            onChange={(e) => setReviewMode(e.target.value)}
            options={[
              { value: 'review', label: '校验审阅' },
              { value: 'modify', label: '修改剧本' },
            ]}
            optionType="button"
            buttonStyle="solid"
          />
          {reviewMode === 'review' ? (
            <p className="text-sm text-text-muted">
              根据故事梗概对当前剧本进行合理性二次校验审阅，输出审阅报告（梗概一致性、剧情逻辑、人物一致性、节奏等）。
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-text-muted">
                按你填写的修改要求对当前剧本进行修改，修改完成后会展示新旧剧本差异，确认后才替换当前剧本。
              </p>
              <TextArea
                value={reviewRequirement}
                onChange={(e) => setReviewRequirement(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="请输入修改要求，例如：把第二幕的冲突加强，让女主更主动..."
                maxLength={500}
                showCount
              />
            </div>
          )}
        </div>
      </Modal>

      {/* 校验审阅报告展示弹窗 */}
      <Modal
        title="剧本校验审阅报告"
        open={reviewReport !== null}
        onCancel={() => setReviewReport(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setReviewReport(null)}>
              关闭
            </Button>
            <Button
              type="primary"
              loading={isReviewingScript}
              onClick={handleApplyReviewSuggestions}
              className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
            >
              按建议修改剧本
            </Button>
          </div>
        }
        width={720}
      >
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-text-secondary py-2">
          {reviewReport}
        </div>
      </Modal>

      {/* 修改差异对比弹窗：确认后才应用新剧本 */}
      <Modal
        title="剧本修改差异对比"
        open={pendingDiff !== null}
        onCancel={() => !isApplyingDiff && setPendingDiff(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPendingDiff(null)} disabled={isApplyingDiff}>
              放弃修改
            </Button>
            <Button
              type="primary"
              loading={isApplyingDiff}
              onClick={handleConfirmApplyDiff}
              className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
            >
              确认修改
            </Button>
          </div>
        }
        width={860}
        maskClosable={false}
      >
        <div className="py-2 space-y-3">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-text-muted">共 {addedCount + deletedCount} 行变更：</span>
            <span className="text-green-500">+ {addedCount} 行新增</span>
            <span className="text-red-500">- {deletedCount} 行删除</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border font-mono text-xs leading-relaxed">
            {collapsedDiffItems.map((item, index) => {
              if (item.type === 'collapsed') {
                return (
                  <div
                    key={index}
                    className="px-3 py-1 text-center text-text-muted bg-bg-tertiary/60 select-none"
                  >
                    ⋯ {item.collapsedCount} 行未变更 ⋯
                  </div>
                );
              }
              if (item.type === 'add') {
                return (
                  <div key={index} className="px-3 py-0.5 bg-green-500/10 text-green-500 whitespace-pre-wrap break-all">
                    + {item.text}
                  </div>
                );
              }
              if (item.type === 'del') {
                return (
                  <div key={index} className="px-3 py-0.5 bg-red-500/10 text-red-500 line-through whitespace-pre-wrap break-all">
                    - {item.text}
                  </div>
                );
              }
              return (
                <div key={index} className="px-3 py-0.5 text-text-muted whitespace-pre-wrap break-all">
                  {'  '}{item.text}
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
};
