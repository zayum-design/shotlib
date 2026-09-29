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

import React, { useEffect, useState } from 'react';
import { Modal } from 'antd';
import { CheckCircle2, Circle, Download } from 'lucide-react';
import { IMPORT_STEP_LABELS } from '@/modules/workflow/utils/importStepUtils';

interface ImportStepSelectModalProps {
  open: boolean;
  /** 文件中检测到的已完成步数（1-5） */
  stepCount: number;
  /** 文件中的分集数（用于展示，可选） */
  episodeCount?: number;
  onCancel: () => void;
  /** maxStep：导入前 maxStep 步（从第 1 步起连续，不可隔步） */
  onConfirm: (maxStep: number) => void;
}

/**
 * 导入数据步骤选择弹窗
 *
 * 解析导入文件后展示已完成的步骤清单，用户点击某个已完成步骤即选择
 * 导入前 N 步数据（连续导入，天然不可隔步）。
 */
export const ImportStepSelectModal: React.FC<ImportStepSelectModalProps> = ({
  open,
  stepCount,
  episodeCount,
  onCancel,
  onConfirm,
}) => {
  const [selected, setSelected] = useState(stepCount);

  // 每次打开时重置为最大完成步数（默认全量导入）
  useEffect(() => {
    if (open) setSelected(stepCount);
  }, [open, stepCount]);

  const footer = (
    <div className="flex items-center justify-end gap-3">
      <button
        onClick={onCancel}
        className="px-4 py-1.5 rounded-lg text-sm font-medium text-text-secondary border border-border hover:bg-bg-tertiary transition-colors"
      >
        取消
      </button>
      <button
        onClick={() => onConfirm(selected)}
        className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium bg-accent-primary text-white border border-accent-primary/30 hover:bg-accent-primary/80 transition-colors"
      >
        <Download size={14} />
        导入前 {selected} 步数据
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      title="选择导入的步骤"
      footer={footer}
      onCancel={onCancel}
      width={520}
      destroyOnClose
    >
      <div className="space-y-4">
        <div className="text-sm text-text-secondary">
          文件中检测到 <span className="font-semibold text-accent-primary">{stepCount}</span> 个已完成步骤
          {episodeCount && episodeCount > 0 ? (
            <>
              ，共 <span className="font-semibold text-text-primary">{episodeCount}</span> 个分集
            </>
          ) : null}
          。点击某个步骤可选择导入前 N 步的数据（从第 1 步起连续导入，不能隔步）：
        </div>

        <div className="space-y-2">
          {IMPORT_STEP_LABELS.map((step) => {
            const completed = step.id <= stepCount;
            const included = step.id <= selected;
            const isBoundary = step.id === selected;
            return (
              <button
                key={step.id}
                type="button"
                disabled={!completed}
                onClick={() => setSelected(step.id)}
                className={`
                  w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors
                  ${included
                    ? 'border-accent-primary/40 bg-accent-primary/5'
                    : 'border-border bg-bg-tertiary/30'}
                  ${completed ? 'cursor-pointer hover:border-accent-primary/60' : 'cursor-not-allowed opacity-50'}
                `}
              >
                {/* 步骤编号/完成图标 */}
                <div
                  className={`
                    w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold border-2
                    ${included ? 'bg-accent-primary text-white border-accent-primary' : 'bg-bg-tertiary text-text-muted border-border'}
                  `}
                >
                  {completed ? <CheckCircle2 size={14} /> : step.id}
                </div>

                {/* 步骤信息 */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary">
                    第 {step.id} 步 · {step.title}
                  </div>
                  <div className="text-xs text-text-muted truncate">{step.desc}</div>
                </div>

                {/* 状态标签 */}
                <div className="shrink-0 text-xs">
                  {!completed ? (
                    <span className="flex items-center gap-1 text-text-muted">
                      <Circle size={12} />
                      未完成
                    </span>
                  ) : isBoundary ? (
                    <span className="px-2 py-0.5 rounded-full bg-accent-primary text-white font-medium">
                      导入到此步
                    </span>
                  ) : included ? (
                    <span className="text-accent-primary">✓ 已选</span>
                  ) : (
                    <span className="text-text-muted">可追加</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="text-xs text-text-muted bg-bg-tertiary/50 rounded-lg px-3 py-2">
          ⚠️ 确认后仍需两次高危确认：导入将清空当前项目的所有数据，并替换为所选步骤范围内的内容。
        </div>
      </div>
    </Modal>
  );
};
