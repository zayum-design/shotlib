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
 * JSON 修复工具函数
 * 用于修复 AI 模型返回的不完整或损坏的 JSON
 */

export function extractJsonString(responseText: string): string | null {
  let trimmed = responseText.trim();

  // 0. 处理被双引号包裹的 JSON 字符串（某些 API 会返回字符串形式的 JSON）
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const unquoted = JSON.parse(trimmed);
      if (
        typeof unquoted === 'string' &&
        (unquoted.trim().startsWith('{') || unquoted.trim().startsWith('['))
      ) {
        console.log(
          '[JSONRepair] extractJsonString: 检测到被双引号包裹的 JSON 字符串，已解包',
        );
        trimmed = unquoted.trim();
      }
    } catch {
      // 不是有效的 JSON 字符串，继续下一步
    }
  }

  // 1. 直接是 JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return removeTrailingCommas(trimmed);
  }

  // 2. Markdown 代码块
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    const content = codeBlockMatch[1].trim();
    if (content.startsWith('{') || content.startsWith('[')) {
      return removeTrailingCommas(content);
    }
  }

  // 3. 从文本中提取第一个 JSON 对象或数组
  const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    const extracted = jsonMatch[0];
    // 快速验证：以 [ 开头时，后面应该是合法的 JSON token
    if (extracted.startsWith('[')) {
      const inner = extracted.substring(1).trim();
      if (inner.length > 0 && !/^[\{\[tfn0-9-]/.test(inner[0])) {
        console.log(
          '[JSONRepair] extractJsonString: 匹配到类似数组的文本，但内容不是合法 JSON token，忽略。提取片段:',
          extracted.substring(0, 100),
        );
        return null;
      }
    }
    return removeTrailingCommas(extracted);
  }

  return null;
}

/**
 * 移除 JSON 中的尾随逗号（trailing commas）
 * AI 模型经常在数组/对象的最后一个元素后多加逗号，标准 JSON 不允许
 */
function removeTrailingCommas(jsonString: string): string {
  // 移除 } 或 ] 之前的逗号（含空白）
  return jsonString.replace(/,\s*([}\]])/g, '$1');
}

export function tryRepairIncompleteJson(jsonText: string): string | null {
  try {
    // 提取可能的 JSON 部分
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    let jsonString = jsonMatch[0];

    // 首先移除尾随逗号（AI 模型常见错误）
    jsonString = removeTrailingCommas(jsonString);

    // 统计括号平衡（在修复引号之前，避免 fixUnescapedQuotes 破坏结构）
    let braceBalance = 0;
    let bracketBalance = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') braceBalance++;
        if (char === '}') braceBalance--;
        if (char === '[') bracketBalance++;
        if (char === ']') bracketBalance--;
      }
    }

    // 如果括号不平衡，尝试直接补全括号（不截断）
    if (braceBalance > 0 || bracketBalance > 0) {
      console.log(
        `[JSONRepair] 检测到括号不平衡: {}=${braceBalance}, []=${bracketBalance}`,
      );

      // 如果字符串未闭合，先关闭它
      if (inString) {
        jsonString += '"';
        inString = false;
      }

      // 尝试直接补全括号（不截断内容）
      let directFixed = jsonString;
      while (bracketBalance > 0) {
        directFixed += ']';
        bracketBalance--;
      }
      while (braceBalance > 0) {
        directFixed += '}';
        braceBalance--;
      }

      // 尝试解析直接补全的结果
      try {
        JSON.parse(directFixed);
        console.log(
          `[JSONRepair] 直接补全括号成功，长度: ${directFixed.length}`,
        );
        return directFixed;
      } catch {
        console.log(`[JSONRepair] 直接补全括号失败，尝试截断修复`);
      }

      // 直接补全失败，尝试截断到平衡位置
      let currentBraceBalance = braceBalance;
      let currentBracketBalance = bracketBalance;
      let cutIndex = jsonString.length;

      for (let i = jsonString.length - 1; i >= 0; i--) {
        const char = jsonString[i];

        if (char === '}') currentBraceBalance++;
        if (char === '{') currentBraceBalance--;
        if (char === ']') currentBracketBalance++;
        if (char === '[') currentBracketBalance--;

        if (currentBraceBalance === 0 && currentBracketBalance === 0) {
          cutIndex = i + 1;
          break;
        }
      }

      if (cutIndex < jsonString.length) {
        jsonString = jsonString.substring(0, cutIndex);
        console.log(
          `[JSONRepair] 已截断 JSON 到平衡位置，长度: ${jsonString.length}`,
        );
      }
    }

    // 尝试解析修复后的 JSON
    try {
      JSON.parse(jsonString);
      return jsonString;
    } catch {
      // 解析失败，尝试进一步修复
    }

    // 修复字符串中的未转义双引号（作为最后手段）
    const fixedQuotes = fixUnescapedQuotes(jsonString);
    try {
      JSON.parse(fixedQuotes);
      return fixedQuotes;
    } catch {
      // 仍失败
    }

    // 处理数组元素被截断的情况
    const truncated = truncateToLastCompleteElement(jsonString);
    // 防止过度截断：如果截断后长度小于原始长度的 10%，不使用截断结果
    if (truncated && truncated.length >= jsonString.length * 0.1) {
      try {
        JSON.parse(truncated);
        return truncated;
      } catch {
        // 仍失败
      }
    }

    // 最终 fallback：尝试修复 episodes 数组结构
    const episodesFixed = repairEpisodesArrayJson(jsonString);
    if (episodesFixed) {
      try {
        JSON.parse(episodesFixed);
        return episodesFixed;
      } catch {
        // 仍失败
      }
    }

    // 所有修复都失败，返回原始提取的字符串
    return jsonString;
  } catch (error) {
    console.error('[JSONRepair] 修复不完整 JSON 失败:', error);
    return null;
  }
}

export function fixUnescapedQuotes(jsonString: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < jsonString.length; i++) {
    const char = jsonString[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      if (inString) {
        // 检查下一个非空白字符
        let j = i + 1;
        while (j < jsonString.length && /\s/.test(jsonString[j])) j++;

        const nextChar = jsonString[j];
        const prevChar = result[result.length - 1];

        // 如果是字符串结束后的引号
        if (
          nextChar === ':' ||
          nextChar === ',' ||
          nextChar === '}' ||
          nextChar === ']' ||
          nextChar === undefined
        ) {
          inString = false;
          result += char;
        } else if (prevChar === ':' || /\s/.test(prevChar)) {
          // 字符串开始
          inString = true;
          result += char;
        } else {
          // 可能是未转义的引号，尝试转义
          result += '\\"';
        }
      } else {
        inString = true;
        result += char;
      }
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * 专门修复 episodes 数组被截断的情况
 * 找到 "episodes": [ 后最后一个完整的 episode 对象，补全 ]
 */
function repairEpisodesArrayJson(jsonString: string): string | null {
  const episodesMatch = jsonString.match(/"episodes"\s*:\s*\[/);
  if (!episodesMatch) return null;

  const startIndex = episodesMatch.index! + episodesMatch[0].length;
  let lastValidIndex = startIndex;
  let braceDepth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < jsonString.length; i++) {
    const char = jsonString[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') braceDepth++;
      if (char === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          lastValidIndex = i + 1;
        }
      }
    }
  }

  const fixed = jsonString.substring(0, lastValidIndex).trimEnd();
  if (fixed.endsWith(',')) {
    return fixed.slice(0, -1) + ']}';
  }
  return fixed + ']}';
}

/**
 * 截断到倒数第二个完整元素后补全（处理数组/对象被截断的情况）
 */
function truncateToLastCompleteElement(jsonString: string): string {
  // 先尝试简单补全：如果末尾在数组/对象中间，补全右括号
  let trimmed = jsonString.trimEnd();

  // 统计括号平衡（从字符串末尾向前）
  let braceBalance = 0;
  let bracketBalance = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') braceBalance++;
      if (char === '}') braceBalance--;
      if (char === '[') bracketBalance++;
      if (char === ']') bracketBalance--;
    }
  }

  // 如果在字符串中间截断，先关闭字符串
  if (inString) {
    // 从末尾向前找到未配对的字符串开始位置，简单处理：补全引号
    trimmed += '"';
  }

  // 如果在对象/数组值内部截断，需要回溯到上一个完整的键值对或元素
  // 策略：从后向前扫描，找到最后一个可以安全截断的位置（逗号后面，且括号平衡）
  let bestCutIndex = -1;
  let currentBrace = 0;
  let currentBracket = 0;
  let strMode = false;
  let esc = false;

  for (let i = trimmed.length - 1; i >= 0; i--) {
    const char = trimmed[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (char === '\\') {
      esc = true;
      continue;
    }
    if (char === '"' && !esc) {
      strMode = !strMode;
      continue;
    }
    if (!strMode) {
      if (char === '}') currentBrace--;
      if (char === '{') currentBrace++;
      if (char === ']') currentBracket--;
      if (char === '[') currentBracket++;

      // 当括号平衡时，检查是否在逗号后或 [ { 后
      if (currentBrace === 0 && currentBracket === 0) {
        if (char === ',' || char === '[' || char === '{') {
          // 逗号后面是下一个元素的开始，逗号本身保留，后面补全
          if (char === ',') {
            bestCutIndex = i + 1;
          } else {
            // [ 或 { 后表示数组/对象刚开始或为空，不截断
            bestCutIndex = -1;
          }
          break;
        }
      }
    }
  }

  if (bestCutIndex > 0) {
    trimmed = trimmed.substring(0, bestCutIndex).trimEnd();
    // 移除末尾可能的逗号
    if (trimmed.endsWith(',')) {
      trimmed = trimmed.slice(0, -1);
    }
  }

  // 补全括号
  while (bracketBalance > 0) {
    trimmed += ']';
    bracketBalance--;
  }
  while (braceBalance > 0) {
    trimmed += '}';
    braceBalance--;
  }

  return trimmed;
}

export function fixMissingKeys(jsonString: string): string {
  try {
    const missingDescriptionRegex =
      /"name"\s*:\s*"([^"]+)"\s*,\s*"([^"\n\r]*?[\u4e00-\u9fff][^"\n\r]*?)"\s*,/g;

    let result = jsonString;
    let repaired = false;

    result = result.replace(missingDescriptionRegex, (match, name, text) => {
      if (
        text.length > 5 &&
        /[\u4e00-\u9fff]/.test(text) &&
        !text.includes(':') &&
        !text.includes('description') &&
        !text.includes('imagePrompt') &&
        !text.includes('avatarPrompt') &&
        !text.includes('model')
      ) {
        console.log(
          `[JSONRepair] 修复角色 "${name}" 的缺失 description 键: "${text.substring(0, 30)}..."`,
        );
        repaired = true;
        return `"name": "${name}", "description": "${text}",`;
      }
      return match;
    });

    if (repaired) {
      console.log('[JSONRepair] 已修复 JSON 中的缺失键问题');
    }

    return result;
  } catch (error) {
    console.error('[JSONRepair] 修复缺失键时出错:', error);
    return jsonString;
  }
}
