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
import { Button, Checkbox, Input, Modal, Radio } from 'antd';
import { ClipboardCheck } from 'lucide-react';
import { useWorkflowStore } from '../stores/workflowStore';
import type { AssetPromptChanges, AssetPromptChangeItem } from '../api/scriptApi';
import { message } from '@/shared/utils/message';

const { TextArea } = Input;

// 提示词字段中文标签
const CHARACTER_FIELD_LABELS: Record<string, string> = {
  imagePrompt: '形象提示词',
  avatarPrompt: '头像提示词',
  voicePrompt: '音色提示词',
};
const SCENE_FIELD_LABEL = '场景图提示词';

/** 待确认的提示词修改项（含旧值，用于对比展示与勾选） */
interface PendingChange extends AssetPromptChangeItem {
  key: string;
  fieldLabel: string;
  oldValue: string;
}

interface AssetPromptReviewButtonProps {
  /** 已生成片段（步骤锁定）或无分解数据时禁用 */
  disabled?: boolean;
}

/**
 * Step3 剧本分解 - 校验修改按钮
 * 对分解后角色/场景的提示词进行校验审阅或修改，
 * 修改结果以勾选列表展示（默认全选），确认后仅应用勾选的修改项
 */
export const AssetPromptReviewButton: React.FC<AssetPromptReviewButtonProps> = ({ disabled }) => {
  const { reviewAssetPrompts, isReviewingAssets, applyAssetPromptChanges } = useWorkflowStore();

  // 选择 dialog 状态（与 step2 一致：radio 点选校验/修改，修改时填写修改要求）
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<'review' | 'modify'>('review');
  const [requirement, setRequirement] = useState('');
  // 校验审阅报告展示
  const [report, setReport] = useState<string | null>(null);
  // 修改结果勾选对比：默认全选，确认后仅应用勾选项
  const [pendingChanges, setPendingChanges] = useState<PendingChange[] | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);

  /** 将后端返回的修改结果扁平化为对比列表（按名称匹配现有资产，过滤无实际变化的字段） */
  const flattenChanges = (changes: AssetPromptChanges): PendingChange[] => {
    const { characters, scenes } = useWorkflowStore.getState();
    const items: PendingChange[] = [];

    for (const c of changes.characters || []) {
      const existing = characters.find((x) => x.name === c.name);
      if (!existing) continue;
      (['imagePrompt', 'avatarPrompt', 'voicePrompt'] as const).forEach((field) => {
        const newValue = c[field];
        const oldValue = (existing[field] as string | undefined) || '';
        if (typeof newValue === 'string' && newValue.trim() && newValue !== oldValue) {
          items.push({
            key: `character:${c.name}:${field}`,
            assetType: 'character',
            name: c.name,
            field,
            fieldLabel: CHARACTER_FIELD_LABELS[field],
            oldValue,
            newValue,
          });
        }
      });
    }

    for (const s of changes.scenes || []) {
      const existing = scenes.find((x) => x.name === s.name);
      const oldValue = existing?.imagePrompt || '';
      if (!existing || typeof s.imagePrompt !== 'string' || !s.imagePrompt.trim() || s.imagePrompt === oldValue) continue;
      items.push({
        key: `scene:${s.name}:imagePrompt`,
        assetType: 'scene',
        name: s.name,
        field: 'imagePrompt',
        fieldLabel: SCENE_FIELD_LABEL,
        oldValue,
        newValue: s.imagePrompt,
      });
    }

    return items;
  };

  const handleOpen = () => {
    setMode('review');
    setRequirement('');
    setModalOpen(true);
  };

  const handleConfirm = async () => {
    if (mode === 'modify' && !requirement.trim()) {
      message.warning('请输入修改要求');
      return;
    }
    const currentMode = mode;
    setModalOpen(false);
    const result = await reviewAssetPrompts(
      currentMode,
      currentMode === 'modify' ? requirement.trim() : undefined,
    );
    if (!result) return;
    // mode=review 时返回审阅报告，弹窗展示
    if (currentMode === 'review') {
      setReport(result as string);
      return;
    }
    // mode=modify 时返回修改结果，展示勾选对比，确认后才应用
    const items = flattenChanges(result as AssetPromptChanges);
    if (items.length === 0) {
      message.info('提示词无需修改');
      return;
    }
    setPendingChanges(items);
    setCheckedKeys(new Set(items.map((i) => i.key)));
  };

  // 按校验报告的建议直接修改提示词（报告作为修改要求走 modify 流程）
  const handleApplyReportSuggestions = async () => {
    if (!report) return;
    const currentReport = report;
    setReport(null);
    const result = await reviewAssetPrompts(
      'modify',
      `请根据以下校验审阅报告中的问题清单和修改建议，对角色/场景提示词进行修改：\n\n${currentReport}`,
    );
    if (!result || typeof result === 'string') return;
    const items = flattenChanges(result);
    if (items.length === 0) {
      message.info('提示词无需修改');
      return;
    }
    setPendingChanges(items);
    setCheckedKeys(new Set(items.map((i) => i.key)));
  };

  const toggleChecked = (key: string, checked: boolean) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  // 确认应用勾选的修改项
  const handleApplyChecked = async () => {
    if (!pendingChanges) return;
    const selected = pendingChanges.filter((i) => checkedKeys.has(i.key));
    if (selected.length === 0) {
      message.warning('请至少勾选一项修改');
      return;
    }
    setIsApplying(true);
    try {
      await applyAssetPromptChanges(selected);
      setPendingChanges(null);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <>
      <Button
        size="small"
        disabled={disabled}
        onClick={handleOpen}
        loading={isReviewingAssets}
        icon={<ClipboardCheck size={14} />}
        className="border-border text-text-muted hover:text-accent-primary"
      >
        校验修改
      </Button>

      {/* 校验/修改选择弹窗（与 step2 一致） */}
      <Modal
        title="校验修改提示词"
        open={modalOpen}
        onOk={handleConfirm}
        onCancel={() => setModalOpen(false)}
        okText={mode === 'modify' ? '开始修改' : '开始校验'}
        cancelText="取消"
        confirmLoading={isReviewingAssets}
        destroyOnHidden
      >
        <div className="space-y-4 py-2">
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={[
              { value: 'review', label: '校验审阅' },
              { value: 'modify', label: '修改提示词' },
            ]}
            optionType="button"
            buttonStyle="solid"
          />
          {mode === 'review' ? (
            <p className="text-sm text-text-muted">
              根据剧本对分解后角色和场景的提示词进行合理性二次校验审阅，输出审阅报告（剧本一致性、人物区分度、场景准确性、提示词质量等）。
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-text-muted">
                按你填写的修改要求对角色/场景提示词进行修改，修改结果会逐条展示对比，勾选确认后才应用。
              </p>
              <TextArea
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="请输入修改要求，例如：把所有角色的形象提示词统一为写实风格..."
                maxLength={500}
                showCount
              />
            </div>
          )}
        </div>
      </Modal>

      {/* 校验审阅报告展示弹窗 */}
      <Modal
        title="提示词校验审阅报告"
        open={report !== null}
        onCancel={() => setReport(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setReport(null)}>
              关闭
            </Button>
            <Button
              type="primary"
              loading={isReviewingAssets}
              onClick={handleApplyReportSuggestions}
              className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
            >
              按建议修改提示词
            </Button>
          </div>
        }
        width={720}
      >
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-text-secondary py-2">
          {report}
        </div>
      </Modal>

      {/* 修改结果勾选对比弹窗：默认全选，确认后仅应用勾选项 */}
      <Modal
        title="提示词修改对比"
        open={pendingChanges !== null}
        onCancel={() => !isApplying && setPendingChanges(null)}
        footer={
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">
              已勾选 {checkedKeys.size} / {pendingChanges?.length || 0} 项
            </span>
            <div className="flex gap-2">
              <Button onClick={() => setPendingChanges(null)} disabled={isApplying}>
                放弃修改
              </Button>
              <Button
                type="primary"
                loading={isApplying}
                onClick={handleApplyChecked}
                className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
              >
                确认修改
              </Button>
            </div>
          </div>
        }
        width={860}
        maskClosable={false}
      >
        <div className="max-h-[60vh] overflow-y-auto py-2 space-y-3">
          {pendingChanges?.map((item) => (
            <div key={item.key} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={checkedKeys.has(item.key)}
                  onChange={(e) => toggleChecked(item.key, e.target.checked)}
                />
                <span className="text-sm font-medium text-text-primary">
                  {item.assetType === 'character' ? '角色' : '场景'}：{item.name}
                </span>
                <span className="text-xs text-text-muted">· {item.fieldLabel}</span>
              </div>
              <div className="ml-6 space-y-1.5 text-xs leading-relaxed">
                <div className="rounded bg-red-500/10 text-red-500 px-2 py-1.5 whitespace-pre-wrap break-all">
                  - {item.oldValue || '（空）'}
                </div>
                <div className="rounded bg-green-500/10 text-green-500 px-2 py-1.5 whitespace-pre-wrap break-all">
                  + {item.newValue}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
};
