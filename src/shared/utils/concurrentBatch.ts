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
 * 按模型的 concurrent_limit 分批执行任务
 * 使用滑动窗口控制并发数，按 modelId 分组
 */

/**
 * 并发分批执行器
 * @param items 待处理的任务列表
 * @param getModelId 从 item 中提取模型 ID
 * @param executor 单个任务的执行函数
 * @param modelConfigs 模型配置列表，用于获取 concurrentLimit
 */
export async function concurrentBatchExecute<T>(
  items: T[],
  getModelId: (item: T) => string,
  executor: (item: T) => Promise<void>,
  modelConfigs: Array<{ id: string; concurrentLimit?: number }>,
): Promise<void> {
  const defaultLimit = 5;

  // 按 modelId 分组
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const modelId = getModelId(item);
    const group = groups.get(modelId) ?? [];
    group.push(item);
    groups.set(modelId, group);
  }

  // 每个模型组内按并发限制分批执行
  const groupPromises = Array.from(groups.entries()).map(
    async ([modelId, groupItems]) => {
      const config = modelConfigs.find((m) => m.id === modelId);
      const limit = config?.concurrentLimit || defaultLimit;

      // 滑动窗口控制并发
      const executing = new Set<Promise<void>>();
      for (const item of groupItems) {
        const p = executor(item)
          .then(() => {
            executing.delete(p);
          })
          .catch(() => {
            executing.delete(p);
          });
        executing.add(p);

        if (executing.size >= limit) {
          await Promise.race(executing);
        }
      }
      // 等待剩余任务完成
      await Promise.allSettled(executing);
    },
  );

  await Promise.allSettled(groupPromises);
}
