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
 * 剧本行级 diff 工具
 * 基于公共前后缀裁剪 + LCS（最长公共子序列）的行级对比，
 * 用于剧本修改后的新旧内容差异展示，避免引入外部 diff 依赖
 */

export interface ScriptDiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

/**
 * 对比新旧文本，返回行级差异列表
 * 差异区域过大（LCS 矩阵超过阈值）时降级为"整段删除+整段新增"展示
 */
export function diffScriptLines(oldText: string, newText: string): ScriptDiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  // 裁剪公共前缀
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  // 裁剪公共后缀
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let midDiff: ScriptDiffLine[];
  // LCS 矩阵规模阈值：约 400 万单元（2000 行 x 2000 行），超出则降级
  if (midA.length * midB.length <= 4_000_000) {
    midDiff = lcsLineDiff(midA, midB);
  } else {
    midDiff = [
      ...midA.map((text): ScriptDiffLine => ({ type: 'del', text })),
      ...midB.map((text): ScriptDiffLine => ({ type: 'add', text })),
    ];
  }

  return [
    ...a.slice(0, start).map((text): ScriptDiffLine => ({ type: 'same', text })),
    ...midDiff,
    ...a.slice(endA).map((text): ScriptDiffLine => ({ type: 'same', text })),
  ];
}

/**
 * LCS 行级 diff：回溯最长公共子序列，输出 same/add/del 行序列
 */
function lcsLineDiff(a: string[], b: string[]): ScriptDiffLine[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度（行数上界远低于 65535，Uint16 足够）
  const dp = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const out: ScriptDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

/**
 * 将连续超过 maxRun 行的未变更行折叠为占位标记，便于差异弹窗聚焦改动
 */
export interface CollapsedDiffItem {
  type: 'same' | 'add' | 'del' | 'collapsed';
  text: string;
  /** type=collapsed 时，被折叠的未变更行数 */
  collapsedCount?: number;
}

export function collapseUnchangedLines(
  lines: ScriptDiffLine[],
  maxRun: number = 6,
): CollapsedDiffItem[] {
  const out: CollapsedDiffItem[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== 'same') {
      out.push({ type: lines[i].type, text: lines[i].text });
      i++;
      continue;
    }
    // 统计连续 same 行
    let j = i;
    while (j < lines.length && lines[j].type === 'same') j++;
    const runLength = j - i;
    if (runLength > maxRun) {
      // 保留前 2 行和后 2 行作为上下文，中间折叠
      const head = 2;
      const tail = 2;
      for (let k = i; k < i + head; k++) out.push({ type: 'same', text: lines[k].text });
      out.push({
        type: 'collapsed',
        text: '',
        collapsedCount: runLength - head - tail,
      });
      for (let k = j - tail; k < j; k++) out.push({ type: 'same', text: lines[k].text });
    } else {
      for (let k = i; k < j; k++) out.push({ type: 'same', text: lines[k].text });
    }
    i = j;
  }
  return out;
}
