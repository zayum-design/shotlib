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
import { Modal, Progress } from 'antd';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

/** 单个分集的导入状态 */
export interface ImportEpisodeProgress {
  episodeNumber: number;
  /** 该集导入到第几步 */
  maxStep: number;
  status: 'pending' | 'saving' | 'done' | 'failed';
}

/** 导入进度状态（由 useWorkflowImport 驱动） */
export interface ImportProgressState {
  open: boolean;
  percent: number;
  /** 当前阶段描述 */
  stage: string;
  episodes: ImportEpisodeProgress[];
  /** 全部完成（用于展示成功态） */
  done: boolean;
}

const EPISODE_STATUS_ICON: Record<ImportEpisodeProgress['status'], React.ReactNode> = {
  pending: <span className="w-4 h-4 rounded-full border-2 border-border inline-block" />,
  saving: <Loader2 size={16} className="animate-spin text-accent-primary" />,
  done: <CheckCircle2 size={16} className="text-emerald-500" />,
  failed: <XCircle size={16} className="text-red-500" />,
};

/**
 * 导入进度弹窗
 *
 * 确认导入后展示：总体进度条 + 当前阶段 + 各分集同步状态。
 * 导入期间不可关闭（防止半途打断导致数据不一致）。
 */
export const ImportProgressModal: React.FC<{ state: ImportProgressState }> = ({ state }) => (
  <Modal
    open={state.open}
    title={state.done ? '导入完成' : '正在导入数据'}
    footer={null}
    closable={false}
    maskClosable={false}
    keyboard={false}
    width={480}
    destroyOnClose
  >
    <div className="space-y-4 py-1">
      <Progress
        percent={state.percent}
        status={state.episodes.some((e) => e.status === 'failed') ? 'exception' : state.done ? 'success' : 'active'}
        strokeColor={state.done ? '#10b981' : undefined}
      />
      <div className="text-sm text-text-secondary">{state.stage}</div>

      {state.episodes.length > 0 && (
        <div className="space-y-1.5">
          {state.episodes.map((ep) => (
            <div key={ep.episodeNumber} className="flex items-center gap-2.5 text-sm">
              <span className="shrink-0">{EPISODE_STATUS_ICON[ep.status]}</span>
              <span className="text-text-primary">第 {ep.episodeNumber} 集</span>
              <span className="text-xs text-text-muted">导入前 {ep.maxStep} 步</span>
              <span className="ml-auto text-xs text-text-muted">
                {ep.status === 'pending' && '等待中'}
                {ep.status === 'saving' && '同步中…'}
                {ep.status === 'done' && '已同步'}
                {ep.status === 'failed' && '同步失败'}
              </span>
            </div>
          ))}
        </div>
      )}

      {!state.done && (
        <div className="text-xs text-text-muted bg-bg-tertiary/50 rounded-lg px-3 py-2">
          导入期间请勿关闭或刷新页面，也请不要切换项目/分集。
        </div>
      )}
    </div>
  </Modal>
);
