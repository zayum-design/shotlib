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
 * 视频生成模拟进度（基于已耗时的减速渐近曲线）。
 *
 * 后端视频生成是异步任务，真实进度无法获取；前端用渐近曲线模拟进度，
 * 避免进度条长时间停留在 0%（提交后到首次轮询返回约 10s+），提升等待体验。
 * 计时器与真实轮询解耦：即使轮询因网络波动暂停，进度条仍持续缓慢增长；
 * 任务完成时由调用方跳 100% 并停止计时器。
 *
 * 复用方：drama workflow 片段视频生成、generate 模块视频结果占位。
 */

/** 提交后立即显示的起始进度（消除 0% 闪烁） */
export const VIDEO_PROGRESS_START = 8;
/** 模拟进度上限（留 5% 给最终完成跳转 100%） */
export const VIDEO_PROGRESS_CEIL = 95;
/** 减速曲线时间常数（秒），越大增长越慢 */
export const VIDEO_PROGRESS_TAU = 45;
/** 进度刷新间隔（毫秒） */
export const VIDEO_PROGRESS_TICK = 500;

/**
 * 渐近减速曲线：从 START 平滑逼近 CEIL，前期增长快、后期慢，永不到 100%。
 * @param elapsedSec 已耗时（秒）
 */
export function calcSimulatedProgress(elapsedSec: number): number {
  const ratio = 1 - Math.exp(-elapsedSec / VIDEO_PROGRESS_TAU);
  const p =
    VIDEO_PROGRESS_START + (VIDEO_PROGRESS_CEIL - VIDEO_PROGRESS_START) * ratio;
  return Math.min(p, VIDEO_PROGRESS_CEIL);
}
