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
 * workflowStore.episode.utils.ts — 片段相关纯工具函数
 */
import type { Character, Scene, Episode, ModelConfig } from '@/shared/types/index';

// ========== 视频提示词统一约束后缀 ==========
// 提交视频生成时统一追加到提示词末尾，不再要求 LLM 写在 prompt 里、
// 也不在提示词输入框中显示（存量数据中的旧后缀在显示层剥离）
export const VIDEO_PROMPT_SUFFIX =
  '保持无字幕，不要生成水印，禁止双胞胎效果，除非提示词中明确要求方言，严禁出现方言，全部使用普通话';

// 存量数据中历史后缀的构成短语（任意组合、任意顺序出现在句尾）
const LEGACY_SUFFIX_PHRASES = [
  '保持无字幕',
  '不生成任何文字/字幕/水印/Logo',
  '不生成任何文字/字幕/水印/LOGO',
  '不要生成水印',
  '禁止双胞胎效果',
];

/**
 * 剥离提示词中的历史约束后缀（连同前置标点），供显示层与提交规范化使用
 */
export function stripVideoPromptSuffix(prompt: string): string {
  if (!prompt) return prompt;
  let text = prompt;
  for (const phrase of LEGACY_SUFFIX_PHRASES) {
    // 全局剥离该短语及其前面的连接标点（，、 ， 。 空格）
    text = text.replace(
      new RegExp(`[，,。、\\s]*${phrase.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'g'),
      (match, offset) => {
        // 句首命中（前面无内容）时整段删除；句中/句尾命中删除短语与前导标点
        void offset;
        return '';
      },
    );
  }
  // 清理剥离后残留的尾部标点与连续逗号
  return text
    .replace(/[，,、]\s*[。．.]/g, '。')
    .replace(/[，,、]{2,}/g, '，')
    .replace(/[，,、\s]+$/g, '')
    .trim();
}

/**
 * 提交视频生成前的提示词规范化：剥离旧后缀 + 追加统一约束后缀
 */
export function withVideoPromptSuffix(prompt: string): string {
  const clean = stripVideoPromptSuffix(prompt);
  return clean ? `${clean}，${VIDEO_PROMPT_SUFFIX}` : VIDEO_PROMPT_SUFFIX;
}


/**
 * 将提示词中的 role/scene/portrait 标签、<img>、[图N] 等标记去除，
 * 还原为纯文本（仅保留角色/场景名称等文字）。
 *
 * 用于首尾帧视频生成提示词等「仅需文字指导、不需要标签关联参考图」的场景：
 * 首尾帧视频以首/尾帧图片作为参考图提交给视频模型，提示词只作文字说明，
 * 因此其编辑框/预览框始终显示纯文本，不做角色/场景标签化。
 */
export function stripPromptToText(prompt: string): string {
  if (!prompt) return prompt;
  return prompt
    .replace(/@<role\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/role>/g, '$1')
    .replace(/[@#]<scene\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/scene>/g, '$1')
    .replace(/@<portrait\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/portrait>/g, '$1')
    .replace(/!<ref\s+[^>]*>([^<]*)<\/ref>/g, '$1')
    .replace(/【角色:([^】]+)】/g, '$1')
    .replace(/【场景:([^】]+)】/g, '$1')
    .replace(/【形象照:([^】]+)】/g, '$1')
    .replace(/<img[^>]*>/g, '')
    .replace(/\[图\d+\]/g, '')
    .trim();
}

/**
 * 将角色名、场景名、形象照名、道具名替换为 HTML 格式的标记
 *
 * 设计原则：
 * 1. 先处理显式标记 `【角色:姓名】` / `【场景:名称】` / `【形象照:名称】` / `【道具:名称】`，直接转换为结构化标签
 * 2. 再处理普通文本中的角色名/场景名（只在 HTML 标签外部替换）
 * 3. 用字符串扫描替代复杂正则，避免 lookbehind 等难调试语法
 */
export function convertPromptToHtml(prompt: string, characters: Character[], scenes: Scene[], props?: { id: string; name: string; imageUrls?: string[]; resolvedImageUrls?: string[] }[]): string {
  if (!prompt) return prompt;

  // 1. 已有的 role/scene/portrait/ref 标签用占位符保护（归一化、剔除内部 <img>），
  //    而不是剥离成纯文本再走名称重匹配。原因：
  //    - 衍生场景标签（#<scene scene-id="衍生id">首帧使用片段N视频尾帧参照图片1</scene>）的
  //      标签文本不是场景名，剥离后 scene-id 丢失，尾帧图无法被收集为首帧参考图
  //    - 形象照名（如"直播间甜美照"）被场景别名（"直播间"）模糊误命中，插入本不存在的场景引用
  //    第 7 步统一还原。
  const protectedTags = new Map<string, string>();
  let protectIdx = 0;
  const protect = (tag: string): string => {
    const placeholder = `__PROT_${protectIdx++}__`;
    protectedTags.set(placeholder, tag);
    return placeholder;
  };
  let htmlPrompt = prompt
    .replace(/@<role(\s+[^>]*)?>([^<]*)(?:<img[^>]*>)?<\/role>/g, (_m, attrs: string, name: string) =>
      protect(`@<role${attrs || ''}>${name}</role>`))
    .replace(/[@#]<scene(\s+[^>]*)?>([^<]*)(?:<img[^>]*>)?<\/scene>/g, (_m, attrs: string, name: string) =>
      protect(`#<scene${attrs || ''}>${name}</scene>`))
    .replace(/@<portrait(\s+[^>]*)?>([^<]*)(?:<img[^>]*>)?<\/portrait>/g, (_m, attrs: string, name: string) =>
      protect(`@<portrait${attrs || ''}>${name}</portrait>`))
    .replace(/!<ref(\s+[^>]*)?>([^<]*)<\/ref>/g, (_m, attrs: string, name: string) =>
      protect(`!<ref${attrs || ''}>${name}</ref>`))
    .replace(/<img[^>]*>/g, '')
    .replace(/\[图\d+\]/g, '')
    .trim();

  // 2. 建立名称 -> ID 映射
  const charMap = new Map<string, string>();
  for (const char of characters) {
    if (char.name) charMap.set(char.name, char.id);
  }
  const sceneMap = new Map<string, string>();
  for (const scene of scenes) {
    if (scene.name) sceneMap.set(scene.name, scene.id);
  }

  // 道具名 -> 图片URL 映射（【道具:名】→ !<ref> 标签，下游管线自动收集为参考图）
  // 仅收录有图片的道具；无图道具保留原文，不产生无效引用
  const propMap = new Map<string, string>();
  for (const prop of props || []) {
    const url = prop.resolvedImageUrls?.[0] || prop.imageUrls?.[0];
    if (prop.name && url) propMap.set(prop.name, url);
  }

  // 3. 建立形象照映射
  //    - portraitByChar：角色ID -> (形象照名 -> 下标)，用于 `【角色:X】（...【形象照:名】）` 语境下的精确归属
  //      关键修复：不同角色的形象照名可能重名（如自动命名的"形象照 1"），只按名全局索引会导致
  //      所有角色的同名形象照都被解析成同一个角色的 character-id（生产事故：全部指向沙僧）
  //    - portraitMap：形象照名 -> { charId, portraitIndex }，全局兜底（同名取第一个）
  const portraitByChar = new Map<string, Map<string, number>>();
  const portraitMap = new Map<string, { charId: string; portraitIndex: number }>();
  for (const char of characters) {
    const portraits = char.fullBodyImages || [];
    for (let i = 0; i < portraits.length; i++) {
      const p = portraits[i];
      if (!p?.name) continue;
      if (!portraitByChar.has(char.id)) portraitByChar.set(char.id, new Map());
      portraitByChar.get(char.id)!.set(p.name, i);
      if (!portraitMap.has(p.name)) {
        portraitMap.set(p.name, { charId: char.id, portraitIndex: i });
      }
    }
  }

  // 4. 先替换显式标记 `【角色:姓名】` / `【场景:名称】` / `【形象照:名称】` / `【道具:名称】`，
  //    并用占位符保护已生成的标签，防止后续普通文本替换时再次命中标签内部的名字
  const { text: afterExplicitTags, placeholders } = replaceExplicitTags(htmlPrompt, charMap, sceneMap, portraitMap, portraitByChar, propMap);
  htmlPrompt = afterExplicitTags;

  // 5. 替换普通文本中的场景名（从长到短，避免子串误替换；只在标签外部替换）
  const sortedScenes = [...scenes].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
  for (const scene of sortedScenes) {
    if (!scene.name) continue;
    htmlPrompt = replaceOutsideTags(
      htmlPrompt,
      scene.name,
      `#<scene scene-id="${scene.id}">${scene.name}</scene>`,
    );
  }

  // 5a. 场景名别名匹配：
  //   - 全角括号剥离（如"废墟（上午）"→"废墟"）
  //   - 含"·"分隔符的场景名取主体部分（如"沈清鸾偏殿·夜"→"沈清鸾偏殿"），兼容 LLM 漏写时段后缀，
  //     避免提示词里场景名被截断显示为"沈清鸾偏殿"
  //   - 最后3字别名（如"写字楼旁咖啡厅"→"咖啡厅"），跳过含"·"的别名，避免截到分隔符产生"·夜"/"殿·夜"误匹配
  const sceneAliases: { scene: typeof sortedScenes[0]; alias: string }[] = [];
  for (const scene of sortedScenes) {
    if (!scene.name) continue;
    // 全角括号剥离
    const strippedName = scene.name.replace(/（[^）]*）/g, '').trim();
    if (strippedName !== scene.name && strippedName.length > 0) {
      sceneAliases.push({ scene, alias: strippedName });
    }
    // 含"·"分隔符的场景名：取主体部分作为别名（兼容 LLM 漏写后缀，如"·夜"/"·正午"）
    const dotIdx = scene.name.indexOf('·');
    if (dotIdx >= 2) {
      const mainPart = scene.name.slice(0, dotIdx).trim();
      if (mainPart && !sceneAliases.some(a => a.alias === mainPart)) {
        sceneAliases.push({ scene, alias: mainPart });
      }
    }
    // 最后3字别名（仅用于长度 >= 5 的场景名；跳过含"·"的别名）
    if (scene.name.length >= 5) {
      const alias3 = scene.name.slice(-3);
      if (alias3 && !alias3.includes('·') && !sceneAliases.some(a => a.alias === alias3)) {
        sceneAliases.push({ scene, alias: alias3 });
      }
    }
  }
  sceneAliases.sort((a, b) => b.alias.length - a.alias.length || b.scene.name.length - a.scene.name.length);
  for (const { scene, alias } of sceneAliases) {
    htmlPrompt = replaceOutsideTags(
      htmlPrompt,
      alias,
      `#<scene scene-id="${scene.id}">${scene.name}</scene>`,
    );
  }

  // 6. 替换普通文本中的角色名（从长到短）
  const sortedChars = [...characters].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
  for (const char of sortedChars) {
    if (!char.name) continue;
    htmlPrompt = replaceOutsideTags(
      htmlPrompt,
      char.name,
      `@<role character-id="${char.id}">${char.name}</role>`,
    );
  }

  // 6b. 替换纯文本中的形象照名称（不在【】标记内的，如"元宵灯会盛装照"直接出现）
  //     从长到短排序，避免短名命中长名的子串
  const sortedPortraitEntries = [...portraitMap.entries()]
    .sort((a, b) => b[0].length - a[0].length);
  for (const [name, { charId, portraitIndex }] of sortedPortraitEntries) {
    htmlPrompt = replaceOutsideTags(
      htmlPrompt,
      name,
      `@<portrait character-id="${charId}" portrait-index="${portraitIndex}">${name}</portrait>`,
    );
  }

  // 7. 还原显式标记占位符 + 第 1 步保护的已有标签
  for (const [placeholder, tag] of placeholders) {
    htmlPrompt = htmlPrompt.replace(placeholder, tag);
  }
  for (const [placeholder, tag] of protectedTags) {
    htmlPrompt = htmlPrompt.replace(placeholder, tag);
  }

  // 8. 清理多余空白
  return htmlPrompt.replace(/\s+/g, ' ').trim();
}

/**
 * 扫描文本，将显式标记 `【角色:姓名】` / `【场景:名称】` / `【形象照:名称】` / `【道具:名称】` 转换为结构化标签
 * 保留其它标记不变
 *
 * 返回替换后的文本，以及占位符 -> 标签的映射（用于后续还原）
 */
function replaceExplicitTags(
  prompt: string,
  charMap: Map<string, string>,
  sceneMap: Map<string, string>,
  portraitMap: Map<string, { charId: string; portraitIndex: number }>,
  portraitByChar?: Map<string, Map<string, number>>,
  propMap?: Map<string, string>,
): { text: string; placeholders: Map<string, string> } {
  const result: string[] = [];
  const placeholders = new Map<string, string>();
  let placeholderIndex = 0;
  let i = 0;
  // 最近解析到的角色ID：形象照标记优先归属到该角色，避免跨角色同名形象照错配
  let lastCharId: string | null = null;

  while (i < prompt.length) {
    if (prompt.startsWith('【角色:', i)) {
      const end = prompt.indexOf('】', i);
      if (end !== -1) {
        const name = prompt.slice(i + 4, end).trim();
        const charId = charMap.get(name);
        if (charId) {
          lastCharId = charId;
          const placeholder = `__TAG_${placeholderIndex++}__`;
          const tag = `@<role character-id="${charId}">${name}</role>`;
          placeholders.set(placeholder, tag);
          result.push(placeholder);
        } else {
          result.push(prompt.slice(i, end + 1));
        }
        i = end + 1;
        continue;
      }
    }

    if (prompt.startsWith('【场景:', i)) {
      const end = prompt.indexOf('】', i);
      if (end !== -1) {
        const name = prompt.slice(i + 4, end).trim();
        const sceneId = sceneMap.get(name);
        if (sceneId) {
          const placeholder = `__TAG_${placeholderIndex++}__`;
          const tag = `#<scene scene-id="${sceneId}">${name}</scene>`;
          placeholders.set(placeholder, tag);
          result.push(placeholder);
        } else {
          result.push(prompt.slice(i, end + 1));
        }
        i = end + 1;
        continue;
      }
    }

    if (prompt.startsWith('【道具:', i)) {
      const end = prompt.indexOf('】', i);
      if (end !== -1) {
        const name = prompt.slice(i + 4, end).trim();
        const imageUrl = propMap?.get(name);
        if (imageUrl) {
          // 道具转为 !<ref> 参考附件标签：视频生成（replaceRefAssetTags）与
          // 首尾帧生成（parseFramePrompt）会自动收集为参考图
          const placeholder = `__TAG_${placeholderIndex++}__`;
          const tag = `!<ref url="${imageUrl}" type="image">${name}</ref>`;
          placeholders.set(placeholder, tag);
          result.push(placeholder);
        } else {
          // 无图道具：剔除标记保留纯文本名，避免产生无效引用
          result.push(name);
        }
        i = end + 1;
        continue;
      }
    }

    if (prompt.startsWith('【形象照:', i)) {
      const end = prompt.indexOf('】', i);
      if (end !== -1) {
        const name = prompt.slice(i + 5, end).trim();
        // 优先归属到前文最近的【角色:X】：该角色拥有此名的形象照时直接使用，
        // 避免不同角色同名形象照（如"形象照 1"）被全局解析成同一个角色
        const scopedIndex = lastCharId ? portraitByChar?.get(lastCharId)?.get(name) : undefined;
        const portrait = scopedIndex !== undefined && lastCharId
          ? { charId: lastCharId, portraitIndex: scopedIndex }
          : portraitMap.get(name);
        if (portrait) {
          const placeholder = `__TAG_${placeholderIndex++}__`;
          const tag = `@<portrait character-id="${portrait.charId}" portrait-index="${portrait.portraitIndex}">${name}</portrait>`;
          placeholders.set(placeholder, tag);
          result.push(placeholder);
        } else {
          result.push(prompt.slice(i, end + 1));
        }
        i = end + 1;
        continue;
      }
    }

    result.push(prompt[i]);
    i++;
  }

  return { text: result.join(''), placeholders };
}

/**
 * 在 HTML 标签外部替换普通文本中的目标字符串
 *
 * 成对标签（scene/role/portrait）连同其文本内容（`>...</tag>` 之间）整体跳过，
 * 避免"短名命中长名标签内部文本"导致标签嵌套。
 * 例如长场景"凤鸾殿外·正午"已生成 `#<scene ...>凤鸾殿外·正午</scene>`，
 * 后续替换短场景"凤鸾殿外"时不能命中标签内的子串。
 * img/br 等 void 标签只需跳过 `<...>`。
 */
function replaceOutsideTags(html: string, search: string, replacement: string): string {
  if (!search) return html;

  const PAIRED_TAGS = new Set(['scene', 'role', 'portrait']);

  const result: string[] = [];
  let i = 0;

  while (i < html.length) {
    const char = html[i];

    if (char === '<') {
      const tagClose = html.indexOf('>', i);
      if (tagClose === -1) {
        // 无闭合 >，按普通字符处理
        result.push(char);
        i++;
        continue;
      }

      const tagHead = html.slice(i, tagClose + 1); // 含 <...>
      const isClosing = html[i + 1] === '/';
      const openMatch = tagHead.match(/^<(\w+)/);
      const tagName = openMatch ? openMatch[1] : '';
      const isSelfClosing = tagHead.endsWith('/>');

      if (isClosing || isSelfClosing || !PAIRED_TAGS.has(tagName)) {
        // 闭合/自闭合/void 标签：跳过 <...>
        result.push(tagHead);
        i = tagClose + 1;
      } else {
        // 成对开标签：跳过整个 <tag ...>内容</tag>
        const closeTag = `</${tagName}>`;
        const closeIdx = html.indexOf(closeTag, tagClose + 1);
        if (closeIdx !== -1) {
          result.push(html.slice(i, closeIdx + closeTag.length));
          i = closeIdx + closeTag.length;
        } else {
          // 找不到闭合标签，保守跳过 <...>
          result.push(tagHead);
          i = tagClose + 1;
        }
      }
    } else if (html.startsWith(search, i)) {
      result.push(replacement);
      i += search.length;
    } else {
      result.push(char);
      i++;
    }
  }

  return result.join('');
}

/**
 * 机械注入形象照标记（兜底 LLM 漏标）
 *
 * EPISODE_GENERATION 要求每个片段角色首次出现都带【形象照:名】标记，但模型经常只在
 * 片段1 标注。本函数在生成结果落库前扫描文本：角色标记（含后端已注入 @<role> 的形式）
 * 首次出现时若括号内无形象照，则注入该角色当前分集的第一张形象照名。
 * 已有形象照标注的不动（尊重模型的场景化选择）；无形象照的角色不动。
 *
 * 仅用于 prompt / referencePrompt / firstFramePrompt / lastFramePrompt / videoPrompt；
 * firstLastFrameVideoPrompt 禁止角色名与标记，不得注入。
 */
export function injectPortraitMarkers(
  text: string,
  characters: Character[],
  currentEpisodeNumber: number,
): string {
  if (!text) return text;
  let result = text;
  for (const char of characters) {
    if (!char.name) continue;
    const portraits = (char.fullBodyImages || []).filter(
      (img) =>
        img?.name &&
        (img.episodeNumber === undefined ||
          img.episodeNumber === currentEpisodeNumber),
    );
    if (portraits.length === 0) continue;
    const portraitName = portraits[0].name!;
    const escapedName = char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 角色标记：纯文本【角色:名】或后端注入后的【角色:@<role ...>名</role>】，后可跟年龄括号
    // 括号内容允许嵌套【形象照:…】但不允许跨闭合括号（[^】）]），防止贪婪匹配吞掉后续角色的括号
    const re = new RegExp(
      `(【角色:(?:@<role[^>]*>)?${escapedName}(?:</role>)?】)(（((?:[^】）]|【[^】]*】)*)）)?`,
    );
    result = result.replace(
      re,
      (m, marker: string, _paren?: string, inner?: string) => {
        if (inner !== undefined) {
          if (inner.includes('形象照')) return m; // 已有形象照标注，尊重原选择
          return `${marker}（${inner}，【形象照:${portraitName}】）`;
        }
        return `${marker}（【形象照:${portraitName}】）`;
      },
    );
  }
  return result;
}

/**
 * 构建全能参考视频生成请求数据
 */
export interface UniversalReferenceData {
  processedPrompt: string;
  referenceImages: string[];
  referenceVideos: string[];
  referenceAudios: string[];
  referenceAudioMap: Record<string, string>;
  referenceModel: string;
  originalModel: string;
  totalDuration: number;
  firstShotReferenceImageUrl?: string;
  lastShotReferenceImageUrl?: string;
}

/**
 * 为视频生成提示词构建"表演指令"前缀。
 *
 * 视频模型不能只靠片段/分镜提示词里的动作描述来理解"角色该怎么演"；
 * 这个前缀以系统提示词的形式强制要求：角色必须有目标与阻碍、脸在思考、
 * 眼睛有生命、身体有动作任务、倾听反应要早、情绪有余韵、地位距离可见。
 */
export function buildActingPrefix(characters?: any[], _episode?: any): string {
  // 未来可扩展：按角色个性追加差异化表演提示
  return `【表演指令--角色必须活着，不能只是张嘴】
每个角色此刻都要有"想要"的目标和阻碍，用行为和微表情去追逐，不要展示情绪。
脸部必须有真实微表情：眼皮跳动、嘴角微颤、眉峰收紧、瞳孔变化、真实眨眼；禁止面瘫、禁止僵直凝视、禁止玻璃状眼神。
身体必须有与处境匹配的动作：重心变化、手势、后撤/逼近、动作任务（手里在做事）；禁止站桩、禁止自然下垂的双手。
倾听与反应：角色在对手台词结束之前就开始反应，而不是等对方说完才"开机"。
情绪有余韵：强事件之后，颤抖的手、没焦的眼神、紧绷的肩膀要延续到下一个动作。
地位与距离：谁压谁一头要写在身体上；两人距离的改变就是节拍改变。
强者安静而静止，弱者忙乱且喊叫；威胁不带预备动作，暴力不预告就抵达。`;
}

export function buildUniversalReferenceRequest(
  episode: Episode,
  characters: Character[],
  scenes: Scene[],
  videoModels: ModelConfig[],
  getVideoPromptFormatter: (provider: string) => ((...args: any[]) => string) | undefined,
  /** 未按分集过滤的原始角色列表：显式 @<portrait> 标签解析形象照图片时兜底
   * （characters 经 filterCharacterPortraitsByEpisode 过滤后，非当前分集的形象照 imageUrl 被清空，
   * 但用户在提示词中显式引用的形象照是 deliberate 的，应始终解析提交） */
  unfilteredCharacters?: Character[],
  /** 片段总时长上限（秒），默认 15；长片段模型（如 seedance2.5）为 30 */
  maxTotalDuration = 15,
  /** 道具列表：【道具:名】标记转换为 !<ref> 参考图标签（可选，不传则不转换） */
  props?: { id: string; name: string; imageUrls?: string[]; resolvedImageUrls?: string[] }[],
): UniversalReferenceData {
  // 统一把每个 shot.prompt 中的 `【角色:xxx】` / `【场景:xxx】` / `【道具:xxx】` 转换为结构化标签，
  // 确保 buildUniversalReferenceRequest 扫描时一定能识别参考图
  const shots = (episode.shots || []).map((shot) => ({
    ...shot,
    prompt: convertPromptToHtml(shot.prompt || '', characters, scenes, props),
  }));
  const imageUrls: string[] = [];
  const urlToIndex = new Map<string, number>();
  const addImageUrl = (url: string): number => {
    if (!urlToIndex.has(url)) { urlToIndex.set(url, imageUrls.length); imageUrls.push(url); }
    return urlToIndex.get(url)! + 1;
  };
  const charIdToFaceImageNum = new Map<string, number>();
  const charIdToCostumeImageNum = new Map<string, number>();
  const charIdToAudioNum = new Map<string, number>();
  const charIdToPortraitCostumeUrl = new Map<string, string>();
  const charIdToPortraitImageNum = new Map<string, number>();
  // 角色→本片使用形象照的年龄变体（如 70）。用于把面部参考图从主头像切换到对应年龄的头像变体，
  // 避免老年镜头被主头像（青年面部参考图）拉回年轻
  const charIdToAgeVariant = new Map<string, number>();
  const sceneIdToImageNum = new Map<string, number>();
  const referenceAudios: string[] = [];
  const referenceAudioMap: Record<string, string> = {};
  const referenceVideos: string[] = [];
  const currentModelConfig = videoModels.find((m) => m.id === episode.model);

  // 视频/音频参考附件的模型能力判断（与下方 referenceModel 回退逻辑保持一致的目标模型选择）：
  // 不支持时 !<ref> 标签降级为纯名称文本，避免提示词出现「参照视频1[视频1]」但请求中无对应媒体
  const supportsReferenceImage = !!currentModelConfig?.supports?.reference_image;
  const refTargetModelConfig = supportsReferenceImage
    ? currentModelConfig
    : videoModels.find((m) => m.supports?.reference_image) ?? currentModelConfig;
  const supportsRefVideo = !!refTargetModelConfig?.supports?.reference_video;
  const supportsRefAudio = !!(
    refTargetModelConfig?.supports?.reference_audio ||
    refTargetModelConfig?.supports?.reference_voice
  );

  // !<ref> 参考附件标签（分镜编辑弹窗上传的附件）：image 入参考图数组、video 入参考视频、
  // audio 入参考音频；标签替换为「名称[图片N]/[视频N]/[音频N]」占位文本（与角色/场景编号体系统一）。
  // 模型不支持视频/音频参考时对应附件不收集，标签降级为纯名称
  const REF_ASSET_TAG_RE = /!<ref\s+url="([^"]*)"\s+type="([^"]*)">([\s\S]*?)<\/ref>/g;
  const replaceRefAssetTags = (text: string): string =>
    text.replace(REF_ASSET_TAG_RE, (_m, url: string, type: string, name: string) => {
      const trimmed = name.trim();
      if (!url) return trimmed;
      if (type === 'image') {
        // 参考图直接使用图片自身 URL 提交
        return `${trimmed}[图片${addImageUrl(url)}]`;
      }
      if (type === 'video') {
        if (!supportsRefVideo) {
          console.warn(`[buildUniversalReferenceRequest] 模型 ${refTargetModelConfig?.id} 不支持视频参考，已忽略视频附件: ${trimmed}`);
          return trimmed;
        }
        if (!referenceVideos.includes(url)) referenceVideos.push(url);
        return `${trimmed}[视频${referenceVideos.indexOf(url) + 1}]`;
      }
      if (type === 'audio') {
        if (!supportsRefAudio) {
          console.warn(`[buildUniversalReferenceRequest] 模型 ${refTargetModelConfig?.id} 不支持音频参考，已忽略音频附件: ${trimmed}`);
          return trimmed;
        }
        if (!referenceAudios.includes(url)) referenceAudios.push(url);
        referenceAudioMap[url] = url;
        return `${trimmed}[音频${referenceAudios.indexOf(url) + 1}]`;
      }
      return trimmed;
    });


  // 角色图/场景图始终使用图片自身 URL 提交

  // 从形象照名称提取年龄变体标记（如「张远-70岁病中照」→ 70）
  const extractAgeVariant = (name?: string): number | undefined => {
    const m = name?.match(/(\d+)\s*岁/);
    return m ? parseInt(m[1], 10) : undefined;
  };

  const addCharImages = (charId: string) => {
    if (charIdToFaceImageNum.has(charId)) return;
    const char = characters.find((c) => c.id === charId);
    if (!char) return;
    // 年龄匹配：本片若使用年龄变体形象照（名称含"N岁"），面部参考图必须切换到
    // 同年龄的头像变体（avatarImages 中 ageVariant 匹配的项）；否则用主头像（avatarImages[0]）。
    // 不变体会导致老年镜头的面部被主头像的青年参考图拉回年轻。
    // charIdToAgeVariant 在形象照被选中的位置（@<portrait> 标签解析 / 默认首张形象照）填充
    const allAvatars = char.avatarImages || [];
    let faceImage = allAvatars[0]?.imageUrl || '';
    const ageVariant = charIdToAgeVariant.get(charId);
    if (ageVariant !== undefined) {
      const variantAvatar = allAvatars.find((a) => a.ageVariant === ageVariant && a.imageUrl);
      if (variantAvatar?.imageUrl) faceImage = variantAvatar.imageUrl;
    }
    const faceImageUrl = faceImage;
    if (faceImageUrl) { const imgNum = addImageUrl(faceImageUrl); charIdToFaceImageNum.set(charId, imgNum); }

    // 装束参照（形象照优先，多视图兜底）——与 prompt 是否标注 @<portrait> 无关，
    // 每个片段的出场角色都必须带装束参照，否则只有首片段有形象照、后续片段服装漂移：
    // 1. prompt 显式 @<portrait> 标记的形象照已在前面优先收集（charIdToPortraitCostumeUrl 已有值），不重复
    // 2. 有形象照但未显式标记：默认提交当前分集第一张形象照作为装束参照
    // 3. 完全没有形象照：回退多视图（right/back 视图）作为基础装束参照
    const portraits = (char.fullBodyImages || []).filter((img) => !!img.imageUrl);
    const hasExplicitPortrait = charIdToPortraitCostumeUrl.has(charId);
    if (portraits.length > 0 && !hasExplicitPortrait) {
      const defaultPortraitUrl = portraits[0].imageUrl!;
      const imgNum = addImageUrl(defaultPortraitUrl);
      charIdToPortraitCostumeUrl.set(charId, defaultPortraitUrl);
      charIdToPortraitImageNum.set(charId, imgNum);
      // 默认形象照同样可能是年龄变体（名称含"N岁"），记录供头像匹配
      const ageVariant = extractAgeVariant(portraits[0].name);
      if (ageVariant !== undefined) charIdToAgeVariant.set(charId, ageVariant);
    } else if (portraits.length === 0 && !hasExplicitPortrait) {
      const multiView = char.multiViewImages?.[0];
      const rightImg = multiView?.viewType === 'right' || multiView?.viewType === 'back' ? multiView : undefined;
      if (rightImg?.imageUrl) {
        const costumeImageUrl = rightImg.imageUrl;
        const imgNum = addImageUrl(costumeImageUrl); charIdToCostumeImageNum.set(charId, imgNum);
      }
    }
    // 角色音色音频：取角色音频引用中的 vocal 音频（用户上传/资产库拖入的自定义音色）；
    // 模型不支持音频参考时不收集（避免提示词引用不存在的 [音频N]）
    const vocalAudio = char.characterAudios?.find((a: any) => a.audioType === 'vocal');
    if (vocalAudio?.cosUrl && supportsRefAudio) {
      const audioUrl = vocalAudio.cosUrl;
      if (audioUrl) {
        if (!referenceAudios.includes(audioUrl)) { referenceAudios.push(audioUrl); }
        const audioNum = referenceAudios.indexOf(audioUrl) + 1;
        charIdToAudioNum.set(charId, audioNum);
        referenceAudioMap[audioUrl] = audioUrl;
      }
    }
  };

  // 首帧参考图收集（成为图1，排在所有参考图最前）：
  // 1. 衍生场景标签（#<scene scene-id="衍生id">）：收集衍生场景尾帧图。用户删除该标签则不收集（不提交首帧参考图）。
  //    「首帧使用片段N视频尾帧参照图片1」文字在标签内文本，formatter strip 保留。
  // 2. 普通分镜的 shot.referenceImageUrl（useReferenceAsFirstFrame）：收集并记录 shotFirstFrameMap（formatter 加「文字首帧为图片N」）。
  const shotFirstFrameMap = new Map<number, number>();
  // 诊断：首帧参考图收集字段状态（排查尾帧图未传入请求体的问题）
  console.log('[buildUniversalReferenceRequest] 首帧参考图诊断:', {
    episodeId: episode.id, title: episode.title, model: episode.model,
    videoGenerationMode: episode.videoGenerationMode,
    shots: (episode.shots || []).map((s, i) => ({
      idx: i,
      useReferenceAsFirstFrame: s.useReferenceAsFirstFrame,
      referenceImageUrl: s.referenceImageUrl,
      referenceImageAssetId: s.referenceImageAssetId,
      promptHead: (s.prompt || '').substring(0, 80),
    })),
  });
  if (shots.length > 0) {
    shots.forEach((shot, idx) => {
      // 1. 衍生场景标签 → 首帧参考图（尾帧图）
      let derivedTailFrameAdded = false;
      for (const match of shot.prompt.matchAll(/#<scene\s+scene-id="([^"]+)">/g)) {
        const scene = scenes.find((s) => s.id === match[1]);
        if (!scene?.isDerived) continue;
        const tailFrameUrl = scene.imageUrls?.[0];
        if (!tailFrameUrl) continue;
        const refUrl = tailFrameUrl;
        const imgNum = addImageUrl(refUrl);
        derivedTailFrameAdded = true;
        console.log(`[buildUniversalReferenceRequest] 衍生场景首帧参考图 shot[${idx}] -> 图${imgNum}: ${refUrl}`);
        break;
      }
      // 2. 普通分镜的 shot.referenceImageUrl（useReferenceAsFirstFrame）
      if (!derivedTailFrameAdded && shot.useReferenceAsFirstFrame && shot.referenceImageUrl) {
        const refUrl = shot.referenceImageUrl;
        const imgNum = addImageUrl(refUrl);
        shotFirstFrameMap.set(idx, imgNum);
        console.log(`[buildUniversalReferenceRequest] 普通分镜首帧参考图 shot[${idx}] -> 图${imgNum}: ${refUrl}`);
      }
    });

    // !<ref> 参考附件收集（在首帧收集之后，保证首帧图始终为图1）
    shots.forEach((shot) => {
      shot.prompt = replaceRefAssetTags(shot.prompt);
    });

    shots.forEach((shot) => {
      for (const m of shot.prompt.matchAll(/@<portrait\s+[^>]*character-id="([^"]+)"[^>]*portrait-index="(\d+)"[^>]*>/g)) {
        const charId = m[1];
        if (charIdToPortraitCostumeUrl.has(charId)) continue;
        const portraitIdx = parseInt(m[2], 10);
        const char = characters.find((c) => c.id === charId);
        let portraitUrl = char?.fullBodyImages?.[portraitIdx]?.imageUrl || '';
        let resolvedChar = char;
        // 显式引用的形象照被分集过滤清空时，从原始角色列表兜底解析
        if (!portraitUrl && unfilteredCharacters) {
          const rawChar = unfilteredCharacters.find((c) => c.id === charId);
          portraitUrl = rawChar?.fullBodyImages?.[portraitIdx]?.imageUrl || '';
          if (portraitUrl) resolvedChar = rawChar;
        }
        if (portraitUrl) {
          const finalPortraitUrl = portraitUrl;
          charIdToPortraitCostumeUrl.set(charId, finalPortraitUrl);
          const imgNum = addImageUrl(finalPortraitUrl);
          charIdToPortraitImageNum.set(charId, imgNum);
          // 记录本片使用的形象照年龄变体（供 addCharImages 切换同年龄头像参考）
          const portraitName = char?.fullBodyImages?.[portraitIdx]?.name
            || unfilteredCharacters?.find((c) => c.id === charId)?.fullBodyImages?.[portraitIdx]?.name;
          const ageVariant = extractAgeVariant(portraitName);
          if (ageVariant !== undefined) charIdToAgeVariant.set(charId, ageVariant);
        }
      }
    });
    shots.forEach((shot) => {
      for (const match of shot.prompt.matchAll(/@<role\s+character-id="([^"]+)">/g)) { addCharImages(match[1]); }
      for (const match of shot.prompt.matchAll(/@<role>([^<]*?)<img[^>]*><\/role>/g)) {
        const name = match[1].trim(); if (!name) continue;
        const char = characters.find((c) => c.name === name); if (char) addCharImages(char.id);
      }
      for (const match of shot.prompt.matchAll(/@<role>([^<]*?)<\/role>/g)) {
        const name = match[1].trim(); if (!name) continue;
        const char = characters.find((c) => c.name === name); if (char) addCharImages(char.id);
      }
      const sortedChars = [...characters].sort((a, b) => b.name.length - a.name.length);
      for (const char of sortedChars) {
        if (charIdToFaceImageNum.has(char.id) || charIdToCostumeImageNum.has(char.id)) continue;
        const escapedName = char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`@${escapedName}(?![^<]*>)`, 'g').test(shot.prompt)) { addCharImages(char.id); }
      }
      for (const match of shot.prompt.matchAll(/#<scene\s+scene-id="([^"]+)">/g)) {
        const sId = match[1]; if (sceneIdToImageNum.has(sId)) continue;
        const scene = scenes.find((s) => s.id === sId);
        // 衍生场景图不作为参考图（衍生片段参考图来自 shot.referenceImageUrl），避免同名衍生场景重复提交
        if (scene && !scene.isDerived && scene.imageUrls?.[0]) { const finalUrl = scene.imageUrls[0]; const imgNum = addImageUrl(finalUrl); sceneIdToImageNum.set(sId, imgNum); }
      }
      for (const match of shot.prompt.matchAll(/#<scene>([^<]*?)<img[^>]*><\/scene>/g)) {
        const name = match[1].trim(); if (!name) continue;
        const scene = scenes.find((s) => s.name === name && !s.isDerived);
        if (scene && !sceneIdToImageNum.has(scene.id) && scene.imageUrls?.[0]) {
          const finalUrl = scene.imageUrls[0]; const imgNum = addImageUrl(finalUrl); sceneIdToImageNum.set(scene.id, imgNum);
        }
      }
      for (const match of shot.prompt.matchAll(/[@#]<scene>([^<]*?)<\/scene>/g)) {
        const name = match[1].trim(); if (!name) continue;
        const scene = scenes.find((s) => s.name === name && !s.isDerived);
        if (scene && !sceneIdToImageNum.has(scene.id) && scene.imageUrls?.[0]) {
          const finalUrl = scene.imageUrls[0]; const imgNum = addImageUrl(finalUrl); sceneIdToImageNum.set(scene.id, imgNum);
        }
      }
      const sortedScenes = [...scenes].filter((s) => !s.isDerived).sort((a, b) => b.name.length - a.name.length);
      for (const scene of sortedScenes) {
        if (sceneIdToImageNum.has(scene.id)) continue;
        const escapedName = scene.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`[@#]${escapedName}(?![^<]*>)`, 'g').test(shot.prompt) && scene.imageUrls?.[0]) {
          const finalUrl = scene.imageUrls[0]; const imgNum = addImageUrl(finalUrl); sceneIdToImageNum.set(scene.id, imgNum);
        }
      }
    });
  }

  // 兜底：shots 为空或 shots prompt 中未命中场景时，从 episode.videoPrompt 中再次扫描场景图
  // 确保合并后的 videoPrompt 中提到的场景也能作为参考图提交
  const videoPromptForScan = episode.videoPrompt || '';
  if (videoPromptForScan) {
    const videoPromptHtml = convertPromptToHtml(videoPromptForScan, characters, scenes, props);
    for (const match of videoPromptHtml.matchAll(/#<scene\s+scene-id="([^"]+)">/g)) {
      const sId = match[1]; if (sceneIdToImageNum.has(sId)) continue;
      const scene = scenes.find((s) => s.id === sId);
      // 衍生场景图不作为参考图（同上分镜场景收集）
      if (scene && !scene.isDerived && scene.imageUrls?.[0]) { const finalUrl = scene.imageUrls[0]; const imgNum = addImageUrl(finalUrl); sceneIdToImageNum.set(sId, imgNum); }
    }
    const sortedScenesForVideoPrompt = [...scenes].filter((s) => !s.isDerived).sort((a, b) => b.name.length - a.name.length);
    for (const scene of sortedScenesForVideoPrompt) {
      if (sceneIdToImageNum.has(scene.id) || !scene.name || !scene.imageUrls?.[0]) continue;
      const escapedName = scene.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`[@#]${escapedName}(?![^<]*>)`, 'g').test(videoPromptHtml)) {
        const finalUrl = scene.imageUrls[0]; const imgNum = addImageUrl(finalUrl); sceneIdToImageNum.set(scene.id, imgNum);
      }
    }
  }

  const buildCharRef = (charId: string, name: string, parenContent?: string): string => {
    const faceNum = charIdToFaceImageNum.get(charId);
    const costumeNum = charIdToCostumeImageNum.get(charId);
    const portraitNum = charIdToPortraitImageNum.get(charId);
    const parts: string[] = [];
    if (parenContent) {
      const processedParenContent = parenContent.replace(
        /@<portrait\s+[^>]*character-id="([^"]+)"[^>]*portrait-index="(\d+)"[^>]*>([^<]*)(?:<img[^>]*>)?<\/portrait>/g,
        (_match, pCharId, _pIdx, pName) => {
          const pNum = charIdToPortraitImageNum.get(pCharId);
          if (pNum) {
            return `穿衣穿搭造型、装束样式严格遵守 [ref:portrait:${pNum}]`;
          }
          return pName;
        }
      );
      parts.push(processedParenContent);
    }
    if (faceNum) parts.push(`[ref:face:${faceNum}]`);
    if (portraitNum && portraitNum !== faceNum) {
      parts.push(`[ref:portrait:${portraitNum}]`);
    } else if (costumeNum && costumeNum !== faceNum) {
      parts.push(`[ref:costume:${costumeNum}]`);
    }
    const char = characters.find((c) => c.id === charId);
    // 音色提示词只要存在就输出（纯文本描述，不依赖是否选择音色）；
    // [ref:audio:N] 引用仍要求已选择音色且模型支持音频参考
    if (char?.voicePrompt) {
      let voiceDesc = char.voicePrompt;
      const audioNum = charIdToAudioNum.get(charId);
      if (audioNum) { voiceDesc += `，[ref:audio:${audioNum}]`; }
      parts.push(voiceDesc);
    }
    return `${name}（${parts.join('，')}）`;
  };

  let processedPrompt = episode.videoPrompt || '';
  if (processedPrompt) {
    // 先统一转换 videoPrompt 中的显式标记（【角色:】/【场景:】/【形象照:】/【道具:】）为结构化标签，
    // 确保后续正则链能正确识别角色、场景、形象照、道具引用
    processedPrompt = convertPromptToHtml(processedPrompt, characters, scenes, props);
    // !<ref> 参考附件标签替换为「名称[类型N]」占位文本（与 shots 处理一致，同 url 编号复用）
    processedPrompt = replaceRefAssetTags(processedPrompt);

    processedPrompt = processedPrompt
      .replace(/@<role\s+character-id="([^"]+)">([^<]*)<img[^>]*><\/role>(?:（([^）]*)）)?/g, (_match: any, charId: string, name: string, parenContent: string) => buildCharRef(charId, name, parenContent))
      .replace(/#<scene\s+scene-id="([^"]+)">([^<]*)<img[^>]*><\/scene>/g, (_match: any, sId: string, name: string) => { const imgNum = sceneIdToImageNum.get(sId); return imgNum ? `[ref:scene:${imgNum}]${name}` : name; })
      .replace(/@<role\s+character-id="([^"]+)">([^<]*)<\/role>(?:（([^）]*)）)?/g, (_match: any, charId: string, name: string, parenContent: string) => buildCharRef(charId, name, parenContent))
      .replace(/#<scene\s+scene-id="([^"]+)">([^<]*)<\/scene>/g, (_match: any, sId: string, name: string) => { const imgNum = sceneIdToImageNum.get(sId); return imgNum ? `[ref:scene:${imgNum}]${name}` : name; })
      .replace(/@<role>([^<]*)<img[^>]*><\/role>(?:（([^）]*)）)?/g, (_match: any, name: string, parenContent: string) => { const char = characters.find((c) => c.name === name.trim()); if (!char) return parenContent ? `${name.trim()}（${parenContent}）` : name.trim(); return buildCharRef(char.id, name.trim(), parenContent); })
      .replace(/@<role>([^<]*)<\/role>(?:（([^）]*)）)?/g, (_match: any, name: string, parenContent: string) => { const char = characters.find((c) => c.name === name.trim()); if (!char) return parenContent ? `${name.trim()}（${parenContent}）` : name.trim(); return buildCharRef(char.id, name.trim(), parenContent); })
      .replace(/[@#]<scene>([^<]*)<img[^>]*><\/scene>/g, (_match: any, name: string) => { const scene = scenes.find((s) => s.name === name.trim()); const imgNum = scene ? sceneIdToImageNum.get(scene.id) : undefined; return imgNum ? `[ref:scene:${imgNum}]${name.trim()}` : name.trim(); })
      .replace(/[@#]<scene>([^<]*)<\/scene>/g, (_match: any, name: string) => { const scene = scenes.find((s) => s.name === name.trim()); const imgNum = scene ? sceneIdToImageNum.get(scene.id) : undefined; return imgNum ? `[ref:scene:${imgNum}]${name.trim()}` : name.trim(); });

    const charEntries = characters.filter((c) => charIdToFaceImageNum.has(c.id) || charIdToCostumeImageNum.has(c.id)).map((c) => ({ charId: c.id, name: c.name })).sort((a, b) => b.name.length - a.name.length);
    for (const entry of charEntries) { processedPrompt = processedPrompt.replace(new RegExp(`@${entry.name}(?:（([^）]*)）)?`, 'g'), (_match: any, parenContent: string) => buildCharRef(entry.charId, entry.name, parenContent)); }
    const sceneEntries = scenes.filter((s) => sceneIdToImageNum.has(s.id)).map((s) => ({ name: s.name, imgNum: sceneIdToImageNum.get(s.id)! })).sort((a, b) => b.name.length - a.name.length);
    for (const entry of sceneEntries) { processedPrompt = processedPrompt.replace(new RegExp(`[@#]${entry.name}`, 'g'), `[ref:scene:${entry.imgNum}]${entry.name}`); }
    processedPrompt = processedPrompt
      .replace(/@<portrait\s+[^>]*character-id="([^"]+)"[^>]*portrait-index="(\d+)"[^>]*>([^<]*)(?:<img[^>]*>)?<\/portrait>/g, (_match, pCharId, _pIdx, pName) => {
        const pNum = charIdToPortraitImageNum.get(pCharId);
        if (pNum) {
          return `穿衣穿搭造型、装束样式严格遵守 [ref:portrait:${pNum}]`;
        }
        return pName;
      })
      .replace(/<img[^>]*>/gi, '').replace(/<\/?[a-z][^>]*>/gi, '').trim().replace(/#([一-龥])/g, '$1').replace(/@([一-龥])/g, '$1');
    for (const [shotIndex, imgNum] of shotFirstFrameMap) { processedPrompt = processedPrompt.replace(new RegExp(`【分镜${shotIndex + 1}\\|`, 'i'), `文字首帧为图片${imgNum}，【分镜${shotIndex + 1}|`); }
  }

  const actingPrefix = buildActingPrefix(characters, episode);

  const totalDuration = Math.min(shots.reduce((sum, s) => sum + s.duration, 0), maxTotalDuration);
  let referenceModel = episode.model || videoModels.find((m) => m.type === 'video')?.id || '';
  if (!supportsReferenceImage) { const fallbackR2v = videoModels.find((m) => m.supports?.reference_image); referenceModel = fallbackR2v?.id || referenceModel; }
  const effectiveModel = referenceModel || episode.model || '';
  const effectiveModelConfig = videoModels.find((m) => m.id === effectiveModel);
  const formatter = getVideoPromptFormatter(effectiveModelConfig?.provider || '');
  console.log('[buildUniversalReferenceRequest] 最终结果:', {
    referenceImages: imageUrls,
    shotFirstFrameMap: Array.from(shotFirstFrameMap.entries()),
    referenceModel,
    totalDuration,
  });
  if (formatter) {
    // formatter 输出的最终视频提示词同样统一追加约束后缀（剥离旧后缀防重复）
    return { processedPrompt: withVideoPromptSuffix(`${actingPrefix}\n\n${formatter(shots, characters, scenes, charIdToFaceImageNum, charIdToCostumeImageNum, charIdToAudioNum, sceneIdToImageNum, shotFirstFrameMap, charIdToPortraitImageNum)}`), referenceImages: imageUrls, referenceVideos, referenceAudios, referenceAudioMap, referenceModel, originalModel: episode.model || '', totalDuration, firstShotReferenceImageUrl: shots[0]?.referenceImageUrl, lastShotReferenceImageUrl: shots[shots.length - 1]?.referenceImageUrl };
  }
  return { processedPrompt: withVideoPromptSuffix(`${actingPrefix}\n\n${processedPrompt}`), referenceImages: imageUrls, referenceVideos, referenceAudios, referenceAudioMap, referenceModel, originalModel: episode.model || '', totalDuration, firstShotReferenceImageUrl: shots[0]?.referenceImageUrl, lastShotReferenceImageUrl: shots[shots.length - 1]?.referenceImageUrl };
}
