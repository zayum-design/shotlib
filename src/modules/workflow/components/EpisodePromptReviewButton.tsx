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
import type { EpisodePromptChanges, EpisodePromptChangeItem } from '../api/scriptApi';
import { message } from '@/shared/utils/message';

const { TextArea } = Input;

// 提示词字段中文标签
const EPISODE_FIELD_LABELS: Record<string, string> = {
  videoPrompt: '视频提示词',
  firstFramePrompt: '首帧提示词',
  lastFramePrompt: '尾帧提示词',
  firstLastFrameVideoPrompt: '首尾帧视频提示词',
};
const SHOT_FIELD_LABELS: Record<string, string> = {
  prompt: '分镜提示词',
  referencePrompt: '参考图提示词',
};

/** 待确认的片段提示词修改项（含旧值与展示位置，用于对比展示与勾选） */
interface PendingEpisodeChange extends EpisodePromptChangeItem {
  key: string;
  /** 展示位置，如 "片段 2 · 视频提示词" / "片段 2 · 分镜 3 · 分镜提示词" */
  locationLabel: string;
  fieldLabel: string;
  oldValue: string;
}

/** 对比归一化：剥离 <img> 标签/[图N]/多余空白后再比较。
 * 防止 LLM 输出丢 <img> 标签或空白差异被误判为"修改"（diff 视图 ± 两行看似相同的假象） */
const normalizeForCompare = (v: string): string =>
  (v || '')
    .replace(/<img[^>]*>/g, '')
    .replace(/\[图\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

interface EpisodePromptReviewButtonProps {
  /** 无片段数据时禁用 */
  disabled?: boolean;
}

/**
 * Step4 片段生成 - 校验修改按钮
 * 对片段/分镜提示词进行校验审阅或修改，
 * 修改结果以勾选列表展示（默认全选），确认后仅应用勾选的修改项
 */
export const EpisodePromptReviewButton: React.FC<EpisodePromptReviewButtonProps> = ({ disabled }) => {
  const { reviewEpisodePrompts, isReviewingEpisodes, applyEpisodePromptChanges } = useWorkflowStore();

  // 选择 dialog 状态（与 step2/step3 一致：radio 点选校验/修改，修改时填写修改要求）
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<'review' | 'modify'>('review');
  const [requirement, setRequirement] = useState('');
  // 校验审阅报告展示
  const [report, setReport] = useState<string | null>(null);
  // 修改结果勾选对比：默认全选，确认后仅应用勾选项
  const [pendingChanges, setPendingChanges] = useState<PendingEpisodeChange[] | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);

  /** 将后端返回的修改结果扁平化为对比列表（按 id 匹配现有片段/分镜，过滤无实际变化的字段） */
  const flattenChanges = (changes: EpisodePromptChanges): PendingEpisodeChange[] => {
    const { episodes } = useWorkflowStore.getState();
    const items: PendingEpisodeChange[] = [];

    for (const ep of changes.episodes || []) {
      const epIndex = episodes.findIndex((x) => x.id === ep.id);
      const existing = epIndex >= 0 ? episodes[epIndex] : undefined;

      // 新增片段（__new__ 前缀或未匹配到现有片段的对象）
      if (!existing) {
        if (ep.title || ep.description) {
          items.push({
            key: `add:${ep.id}`,
            episodeId: ep.id,
            action: 'add',
            episodeData: ep as unknown as Record<string, unknown>,
            field: 'prompt',
            locationLabel: `新增片段 · ${ep.title || '未命名'}`,
            fieldLabel: '新片段（含分镜与首尾帧提示词）',
            oldValue: '',
            newValue: ep.description || ep.title || '',
          });
        }
        continue;
      }

      // 删除片段
      if (ep.deleted) {
        items.push({
          key: `delete:${ep.id}`,
          episodeId: ep.id,
          action: 'delete',
          field: 'prompt',
          locationLabel: `删除片段 ${epIndex + 1} · ${existing.title || ''}`,
          fieldLabel: '删除',
          oldValue: existing.description || existing.title || '',
          newValue: '',
        });
        continue;
      }

      const epLabel = `片段 ${epIndex + 1}`;

      // 片段级字段
      (Object.keys(EPISODE_FIELD_LABELS) as (keyof typeof EPISODE_FIELD_LABELS)[]).forEach((field) => {
        const newValue = ep[field as keyof typeof ep] as string | undefined;
        const oldValue = ((existing as any)[field] as string | undefined) || '';
        if (typeof newValue === 'string' && newValue.trim() && normalizeForCompare(newValue) !== normalizeForCompare(oldValue)) {
          items.push({
            key: `episode:${ep.id}:${field}`,
            episodeId: ep.id,
            field: field as PendingEpisodeChange['field'],
            locationLabel: `${epLabel} · ${existing.title || ''}`,
            fieldLabel: EPISODE_FIELD_LABELS[field],
            oldValue,
            newValue,
          });
        }
      });

      // 分镜级字段
      for (const shot of ep.shots || []) {
        const shotIndex = (existing.shots || []).findIndex((s) => s.id === shot.id);
        const existingShot = shotIndex >= 0 ? existing.shots![shotIndex] : undefined;
        if (!existingShot) continue;
        (Object.keys(SHOT_FIELD_LABELS) as (keyof typeof SHOT_FIELD_LABELS)[]).forEach((field) => {
          const newValue = shot[field as keyof typeof shot] as string | undefined;
          const oldValue = ((existingShot as any)[field] as string | undefined) || '';
          if (typeof newValue === 'string' && newValue.trim() && normalizeForCompare(newValue) !== normalizeForCompare(oldValue)) {
            items.push({
              key: `shot:${shot.id}:${field}`,
              episodeId: ep.id,
              shotId: shot.id,
              field: field as PendingEpisodeChange['field'],
              locationLabel: `${epLabel} · 分镜 ${shotIndex + 1}`,
              fieldLabel: SHOT_FIELD_LABELS[field],
              oldValue,
              newValue,
            });
          }
        });
      }
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
    // 防重复提交：弹窗关闭动画期间 onOk 可被快速双击二次触发（会产生两个队列任务、扣两次积分）
    if (useWorkflowStore.getState().isReviewingEpisodes) return;
    const currentMode = mode;
    setModalOpen(false);
    const result = await reviewEpisodePrompts(
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
    const items = flattenChanges(result as EpisodePromptChanges);
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
    const result = await reviewEpisodePrompts(
      'modify',
      `请根据以下校验审阅报告中的问题清单和修改建议，对片段/分镜提示词进行修改：\n\n${currentReport}`,
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
      await applyEpisodePromptChanges(selected);
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
        loading={isReviewingEpisodes}
        icon={<ClipboardCheck size={14} />}
        className="border-border text-text-muted hover:text-accent-primary"
      >
        校验修改
      </Button>

      {/* 校验/修改选择弹窗（与 step2/step3 一致） */}
      <Modal
        title="校验修改提示词"
        open={modalOpen}
        onOk={handleConfirm}
        onCancel={() => setModalOpen(false)}
        okText={mode === 'modify' ? '开始修改' : '开始校验'}
        cancelText="取消"
        confirmLoading={isReviewingEpisodes}
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
              根据剧本对片段/分镜提示词进行合理性二次校验审阅，输出审阅报告（剧本一致性、人物一致性、画面可拍性、视频提示词质量、片段连贯性等）。
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-text-muted">
                按你填写的修改要求对片段/分镜提示词进行修改，修改结果会逐条展示对比，勾选确认后才应用。
              </p>
              <TextArea
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="请输入修改要求，例如：把所有视频提示词的运镜改得更丰富一些..."
                maxLength={500}
                showCount
              />
            </div>
          )}
        </div>
      </Modal>

      {/* 校验审阅报告展示弹窗 */}
      <Modal
        title="片段提示词校验审阅报告"
        open={report !== null}
        onCancel={() => setReport(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setReport(null)}>
              关闭
            </Button>
            <Button
              type="primary"
              loading={isReviewingEpisodes}
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
        title="片段提示词修改对比"
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
                  {item.locationLabel}
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
