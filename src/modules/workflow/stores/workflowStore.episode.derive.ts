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

/**
 * workflowStore.episode.derive.ts — 片段衍生子 Slice
 *
 * 原版能力：从已生成视频的片段一键衍生——服务端 ffmpeg 截取视频尾帧上传素材库，
 * 在该片段后插入一个"全能参考生成"片段。
 * 开源版：浏览器对跨域视频 URL 无法 canvas 截帧，且无服务端 ffmpeg/素材库，
 * 该功能整体禁用，点击时给出明确提示。
 */
import type { StoreApi } from 'zustand';
import { message } from '@/shared/utils/message';
import type { WorkflowState } from './workflowStore';

type SetFn = StoreApi<WorkflowState>['setState'];
type GetFn = StoreApi<WorkflowState>['getState'];

export interface EpisodeDeriveSliceActions {
  /** 从已生成视频的片段衍生新片段(开源版禁用,恒返回 null) */
  deriveEpisodeFromVideo: (episodeId: string) => Promise<{ newEpisodeId: string } | null>;
}

export function createEpisodeDeriveSlice(set: SetFn, get: GetFn): EpisodeDeriveSliceActions {
  void set; // 本 slice 无状态写入
  void get;
  return {
    deriveEpisodeFromVideo: async (episodeId: string) => {
      void episodeId;
      message.warning('开源版不支持自动截取视频尾帧(需服务端 ffmpeg),请手动保存尾帧图片后在首帧处上传使用');
      return null;
    },
  };
}
