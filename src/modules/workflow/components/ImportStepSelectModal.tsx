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

import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from 'antd';
import { CheckCircle2, Circle, Download, Film, Videotape } from 'lucide-react';
import { IMPORT_STEP_LABELS, type EpisodeStepOption } from '@/modules/workflow/utils/importStepUtils';

/** 每集选择的步骤：分集号 → 导入到第几步（1-5，连续） */
export type ImportSelection = Record<number, number>;

interface ImportStepSelectModalProps {
  open: boolean;
  /** 文件中检测到的各分集步骤选项 */
  episodes: EpisodeStepOption[];
  /** 旧格式（平铺单集）：无可选分集，仅展示单集步骤选择 */
  isLegacy?: boolean;
  onCancel: () => void;
  /** selection：分集号 → 该集导入的最大步数 */
  onConfirm: (selection: ImportSelection) => void;
}

/**
 * 导入数据弹窗：分集多选 + 每集步骤选择
 *
 * 解析导入文件后展示各分集及其检测到的完成步骤；
 * 每集可勾选是否导入、并独立选择导入到第几步（从第 1 步起连续，不可隔步）。
 */
export const ImportStepSelectModal: React.FC<ImportStepSelectModalProps> = ({
  open,
  episodes,
  isLegacy = false,
  onCancel,
  onConfirm,
}) => {
  // 勾选的分集（默认全选）
  const [checked, setChecked] = useState<Set<number>>(new Set());
  // 每集选择的导入步数（默认该集的最大完成步数）
  const [steps, setSteps] = useState<Record<number, number>>({});

  // 每次打开时重置：全选分集，各集默认导入到其最大完成步数
  useEffect(() => {
    if (!open) return;
    setChecked(new Set(episodes.map((e) => e.episodeNumber)));
    setSteps(Object.fromEntries(episodes.map((e) => [e.episodeNumber, e.stepCount])));
  }, [open, episodes]);

  const allChecked = episodes.length > 0 && checked.size === episodes.length;
  const checkedCount = useMemo(
    () => episodes.filter((e) => checked.has(e.episodeNumber)).length,
    [episodes, checked],
  );

  const toggleEpisode = (n: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(episodes.map((e) => e.episodeNumber)));
  };

  /** 统一步数：应用到所有勾选分集（不超过各集检测到的最大步数） */
  const applyStepToAll = (step: number) => {
    setSteps((prev) => {
      const next = { ...prev };
      for (const e of episodes) {
        if (checked.has(e.episodeNumber)) {
          next[e.episodeNumber] = Math.min(step, e.stepCount);
        }
      }
      return next;
    });
  };

  const setEpisodeStep = (n: number, step: number) => {
    setSteps((prev) => ({ ...prev, [n]: step }));
  };

  const handleConfirm = () => {
    const selection: ImportSelection = {};
    for (const e of episodes) {
      if (checked.has(e.episodeNumber)) {
        selection[e.episodeNumber] = Math.min(steps[e.episodeNumber] ?? e.stepCount, e.stepCount);
      }
    }
    if (Object.keys(selection).length === 0) return;
    onConfirm(selection);
  };

  const footer = (
    <div className="flex items-center justify-between">
      <div className="text-xs text-text-muted">
        已选 <span className="font-semibold text-accent-primary">{checkedCount}</span> / {episodes.length} 个分集
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-text-secondary border border-border hover:bg-bg-tertiary transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleConfirm}
          disabled={checkedCount === 0}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium bg-accent-primary text-white border border-accent-primary/30 hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Download size={14} />
          确认导入{checkedCount > 0 ? `（${checkedCount} 集）` : ''}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      title="选择导入的分集与步骤"
      footer={footer}
      onCancel={onCancel}
      width={600}
      destroyOnClose
    >
      <div className="space-y-4">
        <div className="text-sm text-text-secondary">
          文件中检测到 <span className="font-semibold text-accent-primary">{episodes.length}</span> 个分集。
          勾选要导入的分集，每集可独立选择导入到第几步（从第 1 步起连续导入，不能隔步）：
        </div>

        {/* 分集列表 */}
        <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
          {episodes.map((ep) => {
            const isChecked = checked.has(ep.episodeNumber);
            const epStep = steps[ep.episodeNumber] ?? ep.stepCount;
            return (
              <div
                key={ep.episodeNumber}
                className={`
                  rounded-lg border transition-colors
                  ${isChecked ? 'border-accent-primary/40 bg-accent-primary/5' : 'border-border bg-bg-tertiary/30'}
                `}
              >
                {/* 分集头：勾选 + 分集号 + 数据概要 */}
                <button
                  type="button"
                  onClick={() => toggleEpisode(ep.episodeNumber)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                >
                  {isChecked ? (
                    <CheckCircle2 size={18} className="shrink-0 text-accent-primary" />
                  ) : (
                    <Circle size={18} className="shrink-0 text-text-muted" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary">
                      第 {ep.episodeNumber} 集
                      {isLegacy ? <span className="ml-2 text-xs font-normal text-text-muted">（旧格式单集数据）</span> : null}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      <span className="flex items-center gap-1">
                        <Film size={12} />
                        片段 ×{ep.fragmentCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <Videotape size={12} />
                        视频 ×{ep.videoCount}
                      </span>
                      <span>已完成 {ep.stepCount} 步</span>
                    </div>
                  </div>
                </button>

                {/* 每集步骤选择 */}
                {isChecked && (
                  <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5 pl-[54px]">
                    {IMPORT_STEP_LABELS.map((step) => {
                      const usable = step.id <= ep.stepCount;
                      const included = step.id <= epStep;
                      const isBoundary = step.id === epStep;
                      return (
                        <button
                          key={step.id}
                          type="button"
                          disabled={!usable}
                          onClick={() => setEpisodeStep(ep.episodeNumber, step.id)}
                          title={`第 ${step.id} 步 · ${step.title}：${step.desc}`}
                          className={`
                            px-2.5 py-1 rounded-full text-xs border transition-colors
                            ${isBoundary
                              ? 'bg-accent-primary text-white border-accent-primary font-medium'
                              : included
                                ? 'text-accent-primary border-accent-primary/40 bg-accent-primary/10'
                                : usable
                                  ? 'text-text-secondary border-border hover:border-accent-primary/60'
                                  : 'text-text-muted border-border opacity-50 cursor-not-allowed'}
                          `}
                        >
                          {step.id}·{step.title}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 批量操作 */}
        {!isLegacy && episodes.length > 1 && (
          <div className="flex items-center gap-3 text-xs text-text-muted bg-bg-tertiary/50 rounded-lg px-3 py-2">
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center gap-1.5 text-text-secondary hover:text-accent-primary transition-colors"
            >
              {allChecked ? <CheckCircle2 size={14} /> : <Circle size={14} />}
              {allChecked ? '取消全选' : '全选分集'}
            </button>
            <span className="text-border">|</span>
            <span>统一步骤：</span>
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => applyStepToAll(n)}
                className="px-2 py-0.5 rounded border border-border text-text-secondary hover:border-accent-primary/60 hover:text-accent-primary transition-colors"
              >
                到第{n}步
              </button>
            ))}
          </div>
        )}

        <div className="text-xs text-text-muted bg-bg-tertiary/50 rounded-lg px-3 py-2">
          ⚠️ 确认后仍需两次高危确认：导入将清空当前项目的所有数据，并替换为所选分集、所选步骤范围内的内容。
        </div>
      </div>
    </Modal>
  );
};
