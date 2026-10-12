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
 * 剧本分幕工具
 *
 * 将剧本正文按 `## 第一幕`、`## 第二幕`、`## 第三幕` 等标题拆分为若干幕段落，
 * 用于 Step 4 片段生成的幕级顺序生成，避免单次输出整剧 JSON 导致 token 截断。
 */

export interface ScriptAct {
  /** 幕序号（从 1 开始） */
  actNumber: number;
  /** 幕标题（包含 ## 前缀的原始行） */
  title: string;
  /** 该幕的正文内容（包含幕标题自身，便于模型定位） */
  content: string;
}

/**
 * 按幕标题拆分剧本。
 *
 * 规则：
 * - 匹配 `## 第.*幕` 行作为幕边界（如 ## 第一幕、## 第二幕、## 第三幕）。
 * - 保留幕标题在对应段落中，模型仍能看到上下文。
 * - 若标题前存在前导内容（如角色清单、场景形象照说明），归入第 1 幕段落。
 * - 若未匹配到任何幕标题，返回单一段落，保持向后兼容。
 */
export function splitScriptByActs(script: string): ScriptAct[] {
  if (!script || typeof script !== 'string') {
    return [];
  }

  const trimmed = script.trim();
  if (!trimmed) {
    return [];
  }

  // 匹配 ## 第一幕、## 第二幕、## 第三幕 等，支持中文数字
  const actHeaderRegex = /^##\s*第[一二三四五六七八九十百千万\d]+幕.*$/gm;
  const matches = Array.from(trimmed.matchAll(actHeaderRegex));

  if (matches.length === 0) {
    return [
      {
        actNumber: 1,
        title: '剧本正文',
        content: trimmed,
      },
    ];
  }

  const acts: ScriptAct[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const nextMatch = matches[i + 1];
    const startIndex = match.index ?? 0;
    const endIndex = nextMatch ? (nextMatch.index ?? trimmed.length) : trimmed.length;

    // 第 1 幕从剧本开头切起，这样能把幕标题前的场景说明、形象照等上下文一并纳入
    const segmentStart = i === 0 ? 0 : startIndex;
    const segment = trimmed.slice(segmentStart, endIndex).trim();

    acts.push({
      actNumber: i + 1,
      title: match[0].trim(),
      content: segment,
    });
  }

  return acts;
}

/**
 * 统计剧本中片段节拍标记的数量（如 【片段节拍1】...【片段节拍N】）。
 * 用于生成后的覆盖率校验。
 */
export function countBeats(script: string): number {
  if (!script || typeof script !== 'string') return 0;
  const matches = script.match(/【片段节拍\d+】/g);
  return matches ? matches.length : 0;
}
