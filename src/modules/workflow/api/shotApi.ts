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
 * 分镜生成 API
 */
import type { Shot } from '@/shared/types/index';
import { processTextByPromptType } from '@/ai/services/text-processing.service';

export interface GenerateSceneShotsRequest {
  sceneDescription: string;
  sceneName: string;
  characters: Array<{
    id: string;
    name: string;
    description?: string;
    avatarUrl?: string;
  }>;
  model?: string;
}

export interface GenerateSceneShotsResponse {
  success: boolean;
  data: {
    shots: Shot[];
    firstFramePrompt?: string;
    lastFramePrompt?: string;
    firstLastFrameVideoPrompt?: string;
  };
  message?: string;
}

/**
 * 归一化 AI 返回的分镜数据
 */
function normalizeShots(parsed: any): GenerateSceneShotsResponse['data'] {
  return {
    shots: (parsed.shots || []).map((shot: any, idx: number) => ({
      id: shot.id || `shot_${idx + 1}`,
      duration: Math.min(Math.max(1, shot.duration || 3), 15),
      cameraMovements: Array.isArray(shot.cameraMovements) ? shot.cameraMovements : [],
      shotType: shot.shotType || 'medium',
      cameraAngle: shot.cameraAngle || 'eye_level',
      lighting: shot.lighting || 'natural',
      mood: shot.mood || 'bright',
      prompt: shot.prompt || '',
    })),
    firstFramePrompt: parsed.firstFramePrompt || '',
    lastFramePrompt: parsed.lastFramePrompt || '',
    firstLastFrameVideoPrompt: parsed.firstLastFrameVideoPrompt || '',
  };
}

/**
 * 修复 LLM 输出中常见的 JSON 语法错误：对象/数组元素之间缺失逗号
 * 例如 `}{`、`"value" "nextKey":` 等。逐字符扫描，跳过字符串内部内容。
 */
function fixMissingCommas(json: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  let inLiteral = false; // 数字 / true / false / null
  let pendingValueEnd = false; // 刚结束一个完整值，尚未遇到 , : } ]

  for (const ch of json) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        pendingValueEnd = true;
      }
      continue;
    }
    if (inLiteral) {
      if (/[\d.eE+\-a-zA-Z]/.test(ch)) {
        out += ch;
        continue;
      }
      inLiteral = false;
      pendingValueEnd = true;
    }
    if (/\s/.test(ch)) {
      out += ch;
      continue;
    }
    if (ch === ',' || ch === ':') {
      pendingValueEnd = false;
      out += ch;
      continue;
    }
    if (ch === '}' || ch === ']') {
      pendingValueEnd = true;
      out += ch;
      continue;
    }
    // ch 是一个新值的开始（{ [ " 或字面量）
    if (pendingValueEnd) {
      out += ',';
      pendingValueEnd = false;
    }
    if (ch === '"') inString = true;
    else if (ch !== '{' && ch !== '[') inLiteral = true;
    out += ch;
  }
  return out;
}

/**
 * 补全未闭合的字符串与括号，并去除尾部多余的逗号/冒号
 */
function balanceBrackets(s: string): string {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if (ch === '}' || ch === ']') closers.pop();
  }
  let out = s;
  if (inString) out += '"';
  out = out.replace(/[\s,:]+$/, '');
  while (closers.length) out += closers.pop();
  return out;
}

/**
 * 截断恢复：JSON 被 maxTokens 截断时，逐步回退到最后一个完整节点并闭合括号
 */
function closeTruncatedJson(json: string): string | null {
  let s = json;
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = balanceBrackets(s);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // 回退到上一个完整闭合节点再试
    }
    const cut = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (cut <= 0) return null;
    s = s.slice(0, cut + 1);
  }
  return null;
}

/**
 * 从 AI 返回的文本中解析分镜数据
 */
export function parseShotsFromText(text: string): GenerateSceneShotsResponse['data'] {
  // 前置检查：如果返回内容为空，给出明确错误
  if (!text || text.trim().length === 0) {
    throw new Error('AI 返回内容为空，请检查模型配置或稍后重试');
  }

  const cleanedText = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleanedText.indexOf('{');
  const jsonString = start >= 0 ? cleanedText.slice(start) : cleanedText;

  // 依次尝试：原文 → 补缺失逗号 → 截断恢复
  const commaFixed = fixMissingCommas(jsonString);
  const candidates = [jsonString, commaFixed];
  const recovered = closeTruncatedJson(commaFixed);
  if (recovered) candidates.push(recovered);

  for (const candidate of candidates) {
    try {
      const data = normalizeShots(JSON.parse(candidate));
      if (candidate !== jsonString) {
        console.warn('[parseShotsFromText] JSON 经修复后解析成功');
      }
      return data;
    } catch {
      // 尝试下一个候选
    }
  }

  console.error('解析场景分镜 JSON 失败:', '\n原始文本:', cleanedText.substring(0, 500));
  throw new Error('AI 返回的数据格式不正确');
}

/**
 * 根据场景和角色信息自动生成短剧场景的分镜列表
 * (本地 AI 层:加载 drama/scene-shots-generation 模板作为 systemPrompt 后调模型)
 */
export async function generateSceneShotsApi(
  sceneName: string,
  sceneDescription: string,
  characters: Array<{ id: string; name: string; description?: string; avatarUrl?: string }>,
  model: string = 'deepseek',
  _preview?: boolean,
  _async?: boolean,
  maxDuration?: number,
): Promise<GenerateSceneShotsResponse> {
  const characterInfo = characters.map((c) => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n');
  // 时长上限：15 或 30（30 仅长片段模型如 seedance2.5 支持）
  const maxTotal = maxDuration === 30 ? 30 : 15;
  const durationRule = maxTotal >= 30
    ? `

【本次片段时长规则（优先级高于提示词模板中任何默认时长约束）】
- 所有分镜 duration 之和严禁超过 30 秒；单个分镜 3-10 秒；分镜总数 3-6 个；
- 分镜节奏按「0-6s 建立 / 6-12s 引入 / 12-18s 发展 / 18-24s 高潮 / 24-30s 落点留钩」推进；
- 对白时长硬匹配规则（10.2）不得成为突破 30 秒总上限的理由，冲突时精简对白字数。`
    : '';
  const input = `场景名称：${sceneName}
场景描述：${sceneDescription}

角色信息：
${characterInfo || '无特定角色'}

请为上述场景设计分镜列表，总时长不超过${maxTotal}秒。${durationRule}`;

  const response = await processTextByPromptType({
    modelId: model,
    promptType: 'drama/scene-shots-generation',
    input,
    parameters: {
      temperature: 0.8,
      // 推理型模型（如 deepseek-v4-pro）的推理过程也占用 max_tokens 额度，
      // 8000 会被推理耗尽导致 JSON 正文截断，留出余量
      maxTokens: 16000,
      // 关闭 DeepSeek V4 思考模式：分镜生成是结构化短输出（正文约 2000 token），
      // 无需长推理链；开着思考时 flash 曾为单个 15 秒片段烧 2 万+ 推理 token（约 3 分钟）
      thinking: { type: 'disabled' },
    },
  });

  // 解析返回的 JSON
  const parsedData = parseShotsFromText(response.text);

  return {
    success: true,
    data: parsedData,
  };
}
