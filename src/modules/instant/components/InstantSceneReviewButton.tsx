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
import * as workflowApi from '@/modules/workflow/api/workflowApi';
import type { EpisodePromptChanges, EpisodePromptChangeItem } from '@/modules/workflow/api/scriptApi';
import type { CanvasItem, InstantCharacter, InstantScene } from '@/shared/types/project';
import { useTaskQueueStore } from '@/shared/stores/taskQueueStore';
import { useLoadingStore } from '@/shared/stores/useLoadingStore';
import { message } from '@/shared/utils/message';

const { TextArea } = Input;

// 提示词字段中文标签（与剧本工作流 Step4 校验修改保持一致）
const EPISODE_FIELD_LABELS: Record<string, string> = {
  videoPrompt: '场景提示词',
  firstFramePrompt: '首帧提示词',
  lastFramePrompt: '尾帧提示词',
  firstLastFrameVideoPrompt: '首尾帧视频提示词',
};
const SHOT_FIELD_LABELS: Record<string, string> = {
  prompt: '分镜提示词',
  referencePrompt: '参考图提示词',
};

/** 待确认的提示词修改项（含旧值与展示位置，用于对比展示与勾选） */
interface PendingChange extends EpisodePromptChangeItem {
  key: string;
  locationLabel: string;
  fieldLabel: string;
  oldValue: string;
}

interface InstantSceneReviewButtonProps {
  item: CanvasItem;
  scene: InstantScene;
  characters: InstantCharacter[];
  /** 使用的文本模型（场次分镜文本模型） */
  textModel: string;
  /** 无可校验内容时禁用 */
  disabled?: boolean;
  /** 勾选确认后由父组件把修改应用回 canvasItems 并持久化 */
  onApplyChanges: (itemId: string, items: EpisodePromptChangeItem[]) => void;
}

/**
 * 即时创作 - 场次详情的校验修改按钮（与剧本生成短剧 Step4 分镜生成的校验修改一致）
 * 对当前场次的场景/首帧/尾帧/分镜提示词进行校验审阅或修改，
 * 修改结果以勾选列表展示（默认全选），确认后仅应用勾选的修改项
 */
export const InstantSceneReviewButton: React.FC<InstantSceneReviewButtonProps> = ({
  item,
  scene,
  characters,
  textModel,
  disabled,
  onApplyChanges,
}) => {
  const [isReviewing, setIsReviewing] = useState(false);
  // 选择 dialog 状态（radio 点选校验/修改，修改时填写修改要求）
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<'review' | 'modify'>('review');
  const [requirement, setRequirement] = useState('');
  // 校验审阅报告展示
  const [report, setReport] = useState<string | null>(null);
  // 修改结果勾选对比：默认全选，确认后仅应用勾选项
  const [pendingChanges, setPendingChanges] = useState<PendingChange[] | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);

  /** 将后端返回的修改结果扁平化为对比列表（按 id 匹配当前场次/分镜，过滤无实际变化的字段） */
  const flattenChanges = (changes: EpisodePromptChanges): PendingChange[] => {
    const items: PendingChange[] = [];
    const itemLabel = `场次 ${item.name || scene.name || ''}`;

    for (const ep of changes.episodes || []) {
      if (ep.id !== item.id) continue;

      // 场次级字段
      (Object.keys(EPISODE_FIELD_LABELS) as (keyof typeof EPISODE_FIELD_LABELS)[]).forEach((field) => {
        const newValue = ep[field as keyof typeof ep] as string | undefined;
        // videoPrompt 对应场次的 customPrompt ?? generatedPrompt
        const oldValue =
          field === 'videoPrompt'
            ? item.customPrompt ?? item.generatedPrompt ?? ''
            : item[field as 'firstFramePrompt' | 'lastFramePrompt' | 'firstLastFrameVideoPrompt'] || '';
        if (typeof newValue === 'string' && newValue.trim() && newValue !== oldValue) {
          items.push({
            key: `episode:${ep.id}:${field}`,
            episodeId: ep.id,
            field: field as PendingChange['field'],
            locationLabel: itemLabel,
            fieldLabel: EPISODE_FIELD_LABELS[field],
            oldValue,
            newValue,
          });
        }
      });

      // 分镜级字段
      for (const shot of ep.shots || []) {
        const shotIndex = (item.shots || []).findIndex((s) => s.id === shot.id);
        const existingShot = shotIndex >= 0 ? item.shots![shotIndex] : undefined;
        if (!existingShot) continue;
        (Object.keys(SHOT_FIELD_LABELS) as (keyof typeof SHOT_FIELD_LABELS)[]).forEach((field) => {
          const newValue = shot[field as keyof typeof shot] as string | undefined;
          const oldValue = existingShot[field as 'prompt' | 'referencePrompt'] || '';
          if (typeof newValue === 'string' && newValue.trim() && newValue !== oldValue) {
            items.push({
              key: `shot:${shot.id}:${field}`,
              episodeId: ep.id,
              shotId: shot.id,
              field: field as PendingChange['field'],
              locationLabel: `${itemLabel} · 分镜 ${shotIndex + 1}`,
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

  /** 调用后端 review-episodes 接口（异步队列 + 轮询），返回审阅报告或修改结果 */
  const runReview = async (
    currentMode: 'review' | 'modify',
    currentRequirement?: string,
  ): Promise<string | EpisodePromptChanges | null> => {
    // 即时创作没有完整剧本，用场次内容描述作为校验上下文
    const scriptContext = item.customPrompt ?? item.generatedPrompt ?? scene.prompt ?? '';
    if (!scriptContext.trim() && !(item.shots || []).length) {
      message.warning('暂无可校验的提示词内容');
      return null;
    }

    // 仅保留提示词相关字段（避免图片/视频等大字段撑爆请求体）
    const episodePayload = [
      {
        id: item.id,
        title: item.name || scene.name,
        description: scene.prompt,
        videoPrompt: item.customPrompt ?? item.generatedPrompt,
        firstFramePrompt: item.firstFramePrompt,
        lastFramePrompt: item.lastFramePrompt,
        firstLastFrameVideoPrompt: item.firstLastFrameVideoPrompt,
        shots: (item.shots || []).map((shot) => ({
          id: shot.id,
          prompt: shot.prompt,
          referencePrompt: shot.referencePrompt,
        })),
      },
    ];
    // 角色清单（名称 + id + 形象照名列表）：供后端校验/修正 @<portrait> 标签的 character-id 归属
    // 注意与剧本生成短剧严格区分：instant 模式的 portrait-index 对应 portraitImages 数组
    // （见 instantPromptUtils），后端统一从 fullBodyImages 读取形象照名列表，故按 portraitImages 顺序填入
    const characterPayload = (characters || []).map((c) => ({
      id: c.id,
      name: c.name,
      fullBodyImages: (c.portraitImages || []).map((img) => ({ name: img?.name })),
    }));

    const taskLabel = currentMode === 'modify' ? '修改分镜提示词' : '校验审阅分镜提示词';
    setIsReviewing(true);
    const loading = useLoadingStore.getState();
    loading.show({ title: `正在${taskLabel}...`, description: '请稍候，这可能需要一分钟左右' });
    const { addTask, completeTask, failTask, incrementPollCount, removeTask } = useTaskQueueStore.getState();
    const taskId = addTask({
      type: 'episode-review',
      name: taskLabel,
      status: 'running',
      prompt: currentRequirement || scriptContext.substring(0, 200),
      modelVariant: textModel,
    });

    try {
      const enqueueResponse = await workflowApi.reviewEpisodesApi(
        scriptContext, episodePayload, characterPayload, currentMode, currentRequirement, textModel, true,
      );

      if (!enqueueResponse.success) {
        failTask(taskId, '提交任务失败');
        message.error('提交任务失败');
        return null;
      }

      let resultData: { mode: 'review' | 'modify'; report?: string; changes?: EpisodePromptChanges } | undefined;
      const jobData = enqueueResponse.data as
        | ({ jobId?: string } & { mode?: 'review' | 'modify'; report?: string; changes?: EpisodePromptChanges })
        | undefined;
      if (jobData?.jobId) {
        message.info(`${taskLabel}任务已提交，正在排队处理...`);
        const pollResult = await workflowApi.pollJobStatus<{ mode: 'review' | 'modify'; report?: string; changes?: EpisodePromptChanges }>(jobData.jobId, {
          interval: 2000,
          maxWaitTime: 10 * 60 * 1000,
          onPoll: () => {
            incrementPollCount(taskId);
          },
        });
        if (!pollResult.success) {
          failTask(taskId, pollResult.error || '执行失败');
          message.error(`${taskLabel}失败: ${pollResult.error || '未知错误'}`);
          return null;
        }
        resultData = pollResult.data;
      } else {
        // 同步模式回退（Redis 未启用时）
        resultData = jobData as { mode: 'review' | 'modify'; report?: string; changes?: EpisodePromptChanges } | undefined;
      }

      if (!resultData) {
        failTask(taskId, '任务完成但未返回结果');
        message.error('任务完成但未返回结果');
        return null;
      }

      if (currentMode === 'review') {
        const reportText = resultData.report || '';
        if (!reportText) {
          failTask(taskId, '任务完成但未返回审阅报告');
          message.error('任务完成但未返回审阅报告');
          return null;
        }
        message.success('校验审阅完成');
        completeTask(taskId, { text: '校验审阅完成' });
        return reportText;
      }

      const changes = resultData.changes || { episodes: [] };
      completeTask(taskId, { text: '修改结果已生成' });
      return changes;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误';
      failTask(taskId, errMsg);
      console.error(`[InstantSceneReview] ${taskLabel}失败:`, error);
      message.error(`${taskLabel}失败: ${errMsg}`);
      return null;
    } finally {
      setIsReviewing(false);
      loading.hide();
      const task = useTaskQueueStore.getState().tasks.find((t) => t.id === taskId);
      if (task && (task.status === 'running' || task.status === 'polling')) {
        removeTask(taskId);
      }
    }
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
    const result = await runReview(currentMode, currentMode === 'modify' ? requirement.trim() : undefined);
    if (!result) return;
    if (currentMode === 'review') {
      setReport(result as string);
      return;
    }
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
    const result = await runReview(
      'modify',
      `请根据以下校验审阅报告中的问题清单和修改建议，对场次/分镜提示词进行修改：\n\n${currentReport}`,
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
      onApplyChanges(item.id, selected);
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
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleOpen}
        loading={isReviewing}
        icon={<ClipboardCheck size={12} />}
        className="border-border text-text-muted hover:text-accent-primary text-xs"
      >
        校验修改
      </Button>

      {/* 校验/修改选择弹窗（与剧本工作流 Step4 一致） */}
      <Modal
        title="校验修改提示词"
        open={modalOpen}
        onOk={handleConfirm}
        onCancel={() => setModalOpen(false)}
        okText={mode === 'modify' ? '开始修改' : '开始校验'}
        cancelText="取消"
        confirmLoading={isReviewing}
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
              根据场次内容对场景/首帧/尾帧/分镜提示词进行合理性二次校验审阅，输出审阅报告（内容一致性、人物一致性、画面可拍性、提示词质量等）。
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-text-muted">
                按你填写的修改要求对场景/分镜提示词进行修改，修改结果会逐条展示对比，勾选确认后才应用。
              </p>
              <TextArea
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder="请输入修改要求，例如：把所有分镜提示词的运镜改得更丰富一些..."
                maxLength={500}
                showCount
              />
            </div>
          )}
        </div>
      </Modal>

      {/* 校验审阅报告展示弹窗 */}
      <Modal
        title="场次提示词校验审阅报告"
        open={report !== null}
        onCancel={() => setReport(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setReport(null)}>
              关闭
            </Button>
            <Button
              type="primary"
              loading={isReviewing}
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
        title="场次提示词修改对比"
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
          {pendingChanges?.map((change) => (
            <div key={change.key} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={checkedKeys.has(change.key)}
                  onChange={(e) => toggleChecked(change.key, e.target.checked)}
                />
                <span className="text-sm font-medium text-text-primary">
                  {change.locationLabel}
                </span>
                <span className="text-xs text-text-muted">· {change.fieldLabel}</span>
              </div>
              <div className="ml-6 space-y-1.5 text-xs leading-relaxed">
                <div className="rounded bg-red-500/10 text-red-500 px-2 py-1.5 whitespace-pre-wrap break-all">
                  - {change.oldValue || '（空）'}
                </div>
                <div className="rounded bg-green-500/10 text-green-500 px-2 py-1.5 whitespace-pre-wrap break-all">
                  + {change.newValue}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
};
