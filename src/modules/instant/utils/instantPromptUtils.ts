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

import type {
  InstantCharacter,
  InstantScene,
  InstantSegment,
  CanvasItem,
} from '@/shared/types/project';
import {
  SHOT_TYPES,
  CAMERA_MOVEMENTS,
  CAMERA_ANGLES,
  LIGHTING_TYPES,
  MOOD_TYPES,
} from '@/shared/types/index';
import type { Shot } from '@/shared/types/index';

/**
 * 折叠同层重复包裹的标签：例如
 *   #<scene id="X">#<scene id="X">名字<img></scene><img></scene>
 * 折叠为
 *   #<scene id="X">名字<img></scene>
 * 用于修复历史脏数据导致的渲染异常
 */
export function denestPromptTags(prompt: string): string {
  if (!prompt) return prompt;
  let result = prompt;
  let prev;
  do {
    prev = result;
    result = result
      .replace(
        /@<role(?:\s+[^>]*)?>(@<role(?:\s+[^>]*)?>[^<]*(?:<img[^>]*>)?<\/role>)(?:<img[^>]*>)?<\/role>/g,
        '$1'
      )
      .replace(
        /#<scene(?:\s+[^>]*)?>(#<scene(?:\s+[^>]*)?>[^<]*(?:<img[^>]*>)?<\/scene>)(?:<img[^>]*>)?<\/scene>/g,
        '$1'
      )
      .replace(
        /@<portrait(?:\s+[^>]*)?>(@<portrait(?:\s+[^>]*)?>[^<]*(?:<img[^>]*>)?<\/portrait>)(?:<img[^>]*>)?<\/portrait>/g,
        '$1'
      );
  } while (result !== prev);
  return result;
}

/**
 * 将存储的提示词标记代码渲染为 HTML pills（只读）
 */
export const renderPromptHtml = (
  prompt: string,
  characters: InstantCharacter[],
  scenes: InstantScene[]
): string => {
  if (!prompt) return '';

  // 先折叠重复嵌套的同名标签，避免历史脏数据渲染时外层泄漏为纯文本
  prompt = denestPromptTags(prompt);

  const escapeAttr = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  let html = '';
  let lastIndex = 0;
  const regex =
    /@<(role)(?:\s+[^>]*)?>([^<]*)(?:<img[^>]*>)?<\/role>|#<(scene)(?:\s+[^>]*)?>([^<]*)(?:<img[^>]*>)?<\/scene>|@<(portrait)(?:\s+[^>]*)?>([^<]*)(?:<img[^>]*>)?<\/portrait>/g;
  let match;

  while ((match = regex.exec(prompt)) !== null) {
    if (match.index > lastIndex) {
      const text = prompt
        .substring(lastIndex, match.index)
        .replace(/<\/?(?:scene|role|portrait|img)[^>]*>/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      html += `<span>${text}</span>`;
    }

    const tagType = (match[1] || match[3] || match[5]) as 'role' | 'scene' | 'portrait';
    const name = (match[2] || match[4] || match[6]).trim();
    const idMatch = match[0].match(
      tagType === 'scene' ? /scene-id="([^"]+)"/ : /character-id="([^"]+)"/
    );
    const entityId = idMatch ? idMatch[1] : '';

    let imageUrl = '';
    if (tagType === 'role') {
      const char = characters.find((c) =>
        entityId ? c.id === entityId : c.name === name
      );
      imageUrl = char?.avatar || char?.avatarImages?.[0]?.imageUrl || '';
    } else if (tagType === 'portrait') {
      const idxMatch = match[0].match(/portrait-index="(\d+)"/);
      const idx = idxMatch ? parseInt(idxMatch[1], 10) : -1;
      const char = characters.find((c) => c.id === entityId);
      imageUrl = (idx >= 0 ? char?.portraitImages?.[idx]?.imageUrl : char?.portraitImages?.[0]?.imageUrl) || '';
    } else {
      const scene = scenes.find((s) =>
        entityId ? s.id === entityId : s.name === name
      );
      imageUrl = scene?.imageUrl || scene?.imageUrls?.[0] || '';
    }

    const safeName = escapeAttr(name);
    const safeImg = escapeAttr(imageUrl);
    const pillAttrs = `data-pill-type="${tagType}" data-pill-name="${safeName}" data-pill-img="${safeImg}"`;

    if (tagType === 'role') {
      const imgHtml = imageUrl
        ? `<img src="${imageUrl}" class="w-4 h-4 rounded-full object-cover border border-accent-primary/30" onerror="this.style.display='none'">`
        : `<div class="w-4 h-4 rounded-full bg-accent-primary/30 flex items-center justify-center"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`;
      html += `<span ${pillAttrs} class="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 bg-accent-primary/20 border border-accent-primary/40 rounded-full text-accent-primary text-xs select-none cursor-pointer">${imgHtml} <span class="font-medium">${name}</span></span>`;
    } else if (tagType === 'portrait') {
      const imgHtml = imageUrl
        ? `<img src="${imageUrl}" class="w-4 h-4 rounded-full object-cover border border-purple-500/30" onerror="this.style.display='none'">`
        : `<div class="w-4 h-4 rounded-full bg-purple-500/30 flex items-center justify-center"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`;
      html += `<span ${pillAttrs} class="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 bg-purple-500/20 border border-purple-500/40 rounded-full text-purple-400 text-xs select-none cursor-pointer">${imgHtml} <span class="font-medium">${name}</span></span>`;
    } else {
      const imgHtml = imageUrl
        ? `<img src="${imageUrl}" class="w-[27px] h-auto rounded object-contain border border-emerald-500/30" onerror="this.style.display='none'">`
        : `<div class="w-[27px] h-auto min-h-[18px] rounded bg-emerald-500/20 flex items-center justify-center"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></div>`;
      html += `<span ${pillAttrs} class="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 bg-emerald-500/20 border border-emerald-500/40 rounded text-emerald-400 text-xs select-none cursor-pointer">${imgHtml} <span class="font-medium">${name}</span></span>`;
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < prompt.length) {
    const text = prompt
      .substring(lastIndex)
      .replace(/<\/?(?:scene|role|portrait|img)[^>]*>/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html += `<span>${text}</span>`;
  }

  return html;
};

/**
 * 解析首尾帧提示词中的 @role / #scene 标签，提取参考图片（含多视图）并清理为纯文本
 */
export function parseFramePrompt(
  htmlPrompt: string,
  scenes: InstantScene[],
  characters: InstantCharacter[]
): { prompt: string; referenceImageUrls: string[] } {
  const referenceImageUrls: string[] = [];
  let prompt = htmlPrompt;

  // 处理 scene 标签（带 # 前缀），放入所有场景图
  prompt = prompt.replace(
    /#<scene\s+scene-id="([^"]+)">([^<]*)(?:<img[^>]*>)?<\/scene>/g,
    (_match, sceneId, sceneName) => {
      const scene = scenes.find((s) => s.id === sceneId);
      const sceneImages = scene?.imageUrls?.length
        ? scene.imageUrls.filter(
            (url): url is string => !!url && !referenceImageUrls.includes(url)
          )
        : scene?.imageUrl
          ? [scene.imageUrl].filter((url) => !referenceImageUrls.includes(url))
          : [];
      const startIdx = referenceImageUrls.length;
      referenceImageUrls.push(...sceneImages);
      const placeholders =
        sceneImages.length > 0
          ? sceneImages.map((_, i) => `[图片${startIdx + i + 1}]`).join('')
          : '';
      return `${sceneName.trim()}${placeholders}`;
    }
  );

  // 处理 portrait 标签（@ 前缀），按 portrait-index 提取单张形象照
  // 同时记录哪些角色已有形象照引用，后续 role 标签处理时跳过对应的全身照
  const portraitCharIds = new Set<string>();
  prompt = prompt.replace(
    /@<portrait\s+([^>]*?)>([^<]*)(?:<img[^>]*>)?<\/portrait>/g,
    (_match, attrs: string, portraitName: string) => {
      const cidM = attrs.match(/character-id="([^"]+)"/);
      const idxM = attrs.match(/portrait-index="(\d+)"/);
      if (!cidM) return portraitName.trim();
      portraitCharIds.add(cidM[1]);
      const char = characters.find((c) => c.id === cidM[1]);
      const idx = idxM ? parseInt(idxM[1], 10) : 0;
      const portraitUrl = char?.portraitImages?.[idx]?.imageUrl;
      if (portraitUrl && !referenceImageUrls.includes(portraitUrl)) {
        const placeholderIdx = referenceImageUrls.length;
        referenceImageUrls.push(portraitUrl);
        return `${portraitName.trim()}[图片${placeholderIdx + 1}]`;
      }
      return portraitName.trim();
    }
  );

  // 处理 role 标签（带 @ 前缀），放入人物参考图（多视图优先，其次头像）
  // 若该角色已有形象照引用，则跳过全身照，由形象照作为该人物的唯一装束参照
  prompt = prompt.replace(
    /@<role\s+character-id="([^"]+)">([^<]*)(?:<img[^>]*>)?<\/role>/g,
    (_match, charId, charName) => {
      const char = characters.find((c) => c.id === charId);
      // 该角色已有形象照作为参照，不再添加全身照
      const hasPortrait = portraitCharIds.has(charId);
      const fullBodyImageUrls = hasPortrait
        ? []
        : char?.fullBodyImages?.map((img) => img.imageUrl).filter(
            (url): url is string => !!url && !referenceImageUrls.includes(url)
          ) ?? [];
      const charImages = fullBodyImageUrls.length > 0
        ? fullBodyImageUrls
        : hasPortrait
          ? []
          : char?.avatarImages?.map((img) => img.imageUrl).filter(
              (url): url is string => !!url && !referenceImageUrls.includes(url)
            ) ?? [];
      const startIdx = referenceImageUrls.length;
      referenceImageUrls.push(...charImages);
      const placeholders =
        charImages.length > 0
          ? charImages.map((_, i) => `[图片${startIdx + i + 1}]`).join('')
          : '';
      return `${charName.trim()}${placeholders}`;
    }
  );

  // 清理剩余 HTML 标签并规范化空白
  prompt = prompt.replace(/<[^>]+>/g, '').trim();
  prompt = prompt.replace(/\s+/g, ' ').trim();

  return { prompt, referenceImageUrls };
}

/**
 * 将 AI 输出的形象照标注转换为 @<portrait> 标签
 * 模板要求 AI 输出 "姓名（39岁，形象照名）"；括号内的形象照名与该角色
 * portraitImages 的 name 匹配（同名取第一个），转换为结构化标签后：
 * UI 可渲染形象照 pill，视频/首尾帧生成可按 portrait-index 提取参考图
 */
export function convertPortraitAnnotations(
  prompt: string,
  characters: InstantCharacter[]
): string {
  if (!prompt) return prompt;

  let result = prompt;
  for (const char of [...characters].sort((a, b) => b.name.length - a.name.length)) {
    const portraits = (char.portraitImages || []).filter((img) => img?.name && img?.imageUrl);
    if (portraits.length === 0) continue;

    for (const [idx, portrait] of portraits.entries()) {
      const name = portrait.name as string;
      // 匹配 "角色名（N岁，形象照名）" 括号内的形象照名，替换为 @<portrait> 标签
      const re = new RegExp(
        `${char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}（(\\d+岁)，${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}）`,
        'g'
      );
      result = result.replace(
        re,
        (_m, age: string) =>
          `${char.name}（${age}，@<portrait character-id="${char.id}" portrait-index="${idx}">${name}</portrait>）`
      );
    }
  }
  return result;
}

/**
 * 将纯文本提示词中的角色名/场景名自动包裹为 @role / #scene 标签
 * 标签内嵌入角色头像和场景图片（与 workflow 的 convertPromptToHtml 保持一致）
 */
export function wrapPromptWithTags(
  prompt: string,
  characters: InstantCharacter[],
  scenes: InstantScene[]
): string {
  console.log('[wrapPromptWithTags] input:', prompt, 'chars:', characters.map(c => c.name), 'scenes:', scenes.map(s => s.name));
  if (!prompt) return '';
  // 已经是 HTML 格式则直接返回（先折叠潜在的嵌套重复标签）
  if (/<role|<scene/.test(prompt)) return denestPromptTags(prompt);

  let result = prompt;

  // 按名字长度降序，避免短名被包含在长名中造成重复替换
  const sortedChars = [...characters].sort((a, b) => b.name.length - a.name.length);
  const sortedScenes = [...scenes].sort((a, b) => b.name.length - a.name.length);

  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 先处理角色，再处理场景（与剧本工作流 convertPromptToHtml 保持一致）
  // 否则角色名与场景名重叠时（如"小明"在"小明家"中），场景优先会导致角色标签嵌套在场景标签内
  // 使用 (?<!<[^>]*)...(?![^<]*>) 避免在 HTML 标签内替换（支持中文，\b 对中文无效）
  for (const char of sortedChars) {
    const escapedName = escapeRegExp(char.name);
    const regex = new RegExp(`(?<!<[^>]*)${escapedName}(?![^<]*>)`, 'g');
    const roleTag = `@<role character-id="${char.id}">${char.name}</role>`;
    const before = result;
    result = result.replace(regex, roleTag);
    if (result !== before) {
      console.log('[wrapPromptWithTags] 替换角色:', char.name, '→ tag');
    }
  }

  // 场景名精确匹配（角色标签已保护，场景名不会在标签内误匹配）
  for (const scene of sortedScenes) {
    const escapedName = escapeRegExp(scene.name);
    const regex = new RegExp(`(?<!<[^>]*)${escapedName}(?![^<]*>)`, 'g');
    const sceneTag = `#<scene scene-id="${scene.id}">${scene.name}</scene>`;
    const before = result;
    result = result.replace(regex, sceneTag);
    if (result !== before) {
      console.log('[wrapPromptWithTags] 替换场景:', scene.name, '→ tag');
    }
  }

  console.log('[wrapPromptWithTags] output:', result);
  return result;
}

/**
 * 简化首尾帧提示词，去掉动态/镜头运动等不适合静态画面生成的描述
 */
export function simplifyFramePrompt(prompt: string): string {
  if (!prompt) return '';
  let result = prompt;

  // 去掉镜头运动相关词汇
  const cameraPatterns = [
    /镜头(?:缓慢|缓缓|慢慢|逐渐)?(?:推进|拉远|上移|下移|左移|右移|平移|摇动|跟随|切换|转换|拉伸|收缩)/g,
    /(?:推|拉|摇|移|跟|升|降)镜头/g,
    /(?:特写|近景|中景|全景|远景)(?:切换|转换|推移)?/g,
    /画面(?:缓慢|缓缓|慢慢|逐渐)?(?:推进|拉远|放大|缩小|平移|移动)/g,
    /摄像机(?:缓慢|缓缓|慢慢|逐渐)?(?:推进|拉远|上移|下移|平移|跟随)/g,
    /(?:慢动作|快切|闪回|淡入|淡出|叠化)/g,
    /运镜[：:]?[^，。；]+/g,
  ];
  for (const p of cameraPatterns) {
    result = result.replace(p, '');
  }

  // 去掉时间变化/动态过程描述
  const timePatterns = [
    /(?:逐渐|慢慢|缓缓|渐渐|随即|突然|瞬间|下一秒|紧接着|随后|之后|接着)[^，。；]*/g,
    /(?:开始|结束|过渡|转变|变化|转换)[^，。；]{0,10}/g,
    /(?:从…到…|由…变…)[^，。；]*/g,
  ];
  for (const p of timePatterns) {
    result = result.replace(p, '');
  }

  // 去掉过渡连接词开头的短句
  const transitionPatterns = [
    /(?:接着|然后|随后|之后|紧接着|与此同时|此时|此刻|随即|突然|忽然)[，,]?/g,
  ];
  for (const p of transitionPatterns) {
    result = result.replace(p, '');
  }

  // 清理多余空格和重复标点
  result = result.replace(/\s+/g, ' ').trim();
  result = result.replace(/[，,；;]+[，,；;]+/g, '，');
  result = result.replace(/[。\.]+[。\.]+/g, '。');
  result = result.replace(/，[，,；;。.\s]*$/g, '');
  result = result.replace(/^[，,；;。.\s]+/g, '');

  // 限制长度，保留核心内容（约80字）
  if (result.length > 80) {
    // 尝试在句末截断
    const cutIndex = result.indexOf('。', 80);
    if (cutIndex > 0 && cutIndex < 120) {
      result = result.substring(0, cutIndex + 1);
    } else {
      // 找逗号截断
      const commaIndex = result.lastIndexOf('，', 100);
      if (commaIndex > 60) {
        result = result.substring(0, commaIndex) + '。';
      }
    }
  }

  return result.trim();
}

/**
 * 去掉提示词中的 @role / #scene HTML 标签，只保留纯文本
 * 支持嵌套/并列标签，循环处理直到没有匹配
 * 同时会去掉标签内嵌入的 <img> 标签
 */
export function stripPromptTags(prompt: string): string {
  if (!prompt) return '';
  let result = prompt;
  // 循环处理：每次移除最内层的 role/scene/portrait 标签，支持嵌套/并列空标签
  let prev;
  do {
    prev = result;
    result = result
      // 优先处理带 <img> 的标签，提取纯文本名字（去掉 <img>）
      .replace(/@<role(?:\s+[^>]*)?>([^<]*)(?:<img[^>]*>)?<\/role>/g, '$1')
      .replace(/#<scene(?:\s+[^>]*)?>([^<]*)(?:<img[^>]*>)?<\/scene>/g, '$1')
      .replace(/@<portrait(?:\s+[^>]*)?>([^<]*)(?:<img[^>]*>)?<\/portrait>/g, '$1')
      // 兜底：处理不带 <img> 或包含其他内容的标签
      .replace(/@<role\s+[^>]*>([\s\S]*?)<\/role>/g, '$1')
      .replace(/#<scene\s+[^>]*>([\s\S]*?)<\/scene>/g, '$1')
      .replace(/@<portrait\s+[^>]*>([\s\S]*?)<\/portrait>/g, '$1');
  } while (result !== prev);
  // 兜底：移除所有剩余 HTML 标签
  result = result.replace(/<[^>]+>/g, '');
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

/**
 * 生成分镜提示词（组合镜头类型、运镜、角度、灯光、氛围、用户提示词）
 */
export const generateShotPrompt = (shot: Shot): string => {
  const parts: string[] = [];

  const shotTypeInfo = SHOT_TYPES.find((s) => s.id === shot.shotType);
  if (shotTypeInfo) parts.push(shotTypeInfo.name);

  if (shot.cameraMovements?.length > 0) {
    const movements = shot.cameraMovements
      .map((m) => {
        const info = CAMERA_MOVEMENTS.find((c) => c.id === m);
        return info ? info.name : m;
      })
      .join('、');
    parts.push(movements + '运镜');
  }

  const angleInfo = CAMERA_ANGLES.find((a) => a.id === shot.cameraAngle);
  if (angleInfo) parts.push(angleInfo.name + '视角');

  const lightingInfo = LIGHTING_TYPES.find((l) => l.id === shot.lighting);
  if (lightingInfo) parts.push(lightingInfo.name + '光线');

  const moodInfo = MOOD_TYPES.find((m) => m.id === shot.mood);
  if (moodInfo) parts.push(moodInfo.name + '氛围');

  if (shot.prompt) parts.push(shot.prompt);

  return parts.join('，');
};

/**
 * 生成用于预览的分镜提示词（剥离 role/scene/portrait 标签，仅纯文本展示）
 */
export const generateShotPromptPreview = (shot: Shot): string => {
  return stripPromptTags(generateShotPrompt(shot));
};

// 统一获取角色最新预览图（与 VisualPromptEditor.getCharImage 保持一致）
const getCharLatestImage = (char: InstantCharacter | undefined): string => {
  if (!char) return '';
  return (
    char.avatarImages?.[0]?.imageUrl ||
    char.fullBodyImages?.[0]?.imageUrl ||
    char.avatar ||
    ''
  );
};

// 统一获取场景最新预览图
const getSceneLatestImage = (scene: InstantScene | undefined): string => {
  if (!scene) return '';
  return scene.imageUrls?.[0] || scene.imageUrl || '';
};

/**
 * 刷新提示词中 @role / #scene 标签内嵌入的 <img src=>，使其指向当前角色/场景的最新图片。
 * 不影响标签外的纯文本与无 character-id/scene-id 的标签。
 */
export function refreshPromptImageUrls(
  prompt: string,
  characters: InstantCharacter[],
  scenes: InstantScene[]
): string {
  if (!prompt) return prompt;

  let result = prompt;

  // 角色标签：替换嵌入的 <img src=>，或当原标签无图片时补齐
  result = result.replace(
    /@<role(\s+[^>]*)?>([^<]*)(<img[^>]*>)?<\/role>/g,
    (match, attrs = '', name, imgTag) => {
      const idMatch = (attrs || '').match(/character-id="([^"]+)"/);
      const charId = idMatch ? idMatch[1] : '';
      if (!charId) return match;
      const char = characters.find((c) => c.id === charId);
      const latestUrl = getCharLatestImage(char);
      // 标记中不再嵌入 img，清理已有的 img 标签
      return `@<role${attrs}>${name}</role>`;
    }
  );

  // 场景标签：同上
  result = result.replace(
    /([@#])<scene(\s+[^>]*)?>([^<]*)(<img[^>]*>)?<\/scene>/g,
    (match, prefix, attrs = '', name, imgTag) => {
      const idMatch = (attrs || '').match(/scene-id="([^"]+)"/);
      const sceneId = idMatch ? idMatch[1] : '';
      if (!sceneId) return match;
      const scene = scenes.find((s) => s.id === sceneId);
      const latestUrl = getSceneLatestImage(scene);
      // 标记中不再嵌入 img，清理已有的 img 标签
      return `${prefix}<scene${attrs}>${name}</scene>`;
    }
  );

  // 形象照标签：根据 character-id + portrait-index 刷新 <img src>，索引越界则移除整个标签
  result = result.replace(
    /@<portrait(\s+[^>]*)?>([^<]*)(<img[^>]*>)?<\/portrait>/g,
    (match, attrs = '', name, imgTag) => {
      const cidM = (attrs || '').match(/character-id="([^"]+)"/);
      const idxM = (attrs || '').match(/portrait-index="(\d+)"/);
      if (!cidM || !idxM) return match;
      const char = characters.find((c) => c.id === cidM[1]);
      const idx = parseInt(idxM[1], 10);
      const portraitUrl = char?.portraitImages?.[idx]?.imageUrl;
      if (!portraitUrl) {
        // 形象照已被删除：清除整个 @ 标签（连同 @ 文本）
        return '';
      }
      // 标记中不再嵌入 img，清理已有的 img 标签
      return `@<portrait${attrs}>${name}</portrait>`;
    }
  );

  return result;
}

/**
 * 删除某个角色的某个形象照后，清理所有提示词中：
 * 1. 引用了被删除形象照的 @<portrait> 标签（连同 @ 文本一起删除）
 * 2. 其他大于该索引的 portrait-index 整体减 1（保持索引连续）
 */
export function removePortraitTagFromPrompt(
  prompt: string,
  charId: string,
  removedIndex: number,
): string {
  if (!prompt) return prompt;
  let result = prompt.replace(
    /@<portrait(\s+[^>]*?)>([\s\S]*?)<\/portrait>/g,
    (match, attrs: string, inner: string) => {
      const cidM = attrs.match(/character-id="([^"]+)"/);
      const idxM = attrs.match(/portrait-index="(\d+)"/);
      if (!cidM || !idxM) return match;
      if (cidM[1] !== charId) return match;
      const idx = parseInt(idxM[1], 10);
      if (idx === removedIndex) return '';
      if (idx > removedIndex) {
        const newAttrs = attrs.replace(
          /portrait-index="\d+"/,
          `portrait-index="${idx - 1}"`,
        );
        return `@<portrait${newAttrs}>${inner}</portrait>`;
      }
      return match;
    },
  );
  // 规范化连续空白（删除 tag 后可能留下多余空格）
  result = result.replace(/[ \t]{2,}/g, ' ');
  return result;
}

/**
 * 对所有 segments 中可能含提示词的字段执行 portrait 标签清理
 */
export function removePortraitFromSegments(
  segments: InstantSegment[],
  charId: string,
  removedIndex: number,
): InstantSegment[] {
  const clean = (val?: string) =>
    val ? removePortraitTagFromPrompt(val, charId, removedIndex) : val;

  return segments.map((seg) => ({
    ...seg,
    canvasItems: (seg.canvasItems || []).map((item: CanvasItem) => {
      if (item.type !== 'scene') return item;
      const nextShots = item.shots?.map((shot: Shot) => ({
        ...shot,
        prompt: clean(shot.prompt) ?? shot.prompt,
        rawPrompt: clean(shot.rawPrompt) ?? shot.rawPrompt,
        referencePrompt: clean(shot.referencePrompt) ?? shot.referencePrompt,
        rawReferencePrompt:
          clean(shot.rawReferencePrompt) ?? shot.rawReferencePrompt,
      }));
      return {
        ...item,
        customPrompt: clean(item.customPrompt) ?? item.customPrompt,
        generatedPrompt: clean(item.generatedPrompt) ?? item.generatedPrompt,
        firstFramePrompt: clean(item.firstFramePrompt) ?? item.firstFramePrompt,
        lastFramePrompt: clean(item.lastFramePrompt) ?? item.lastFramePrompt,
        firstLastFrameVideoPrompt:
          clean(item.firstLastFrameVideoPrompt) ?? item.firstLastFrameVideoPrompt,
        shots: nextShots,
      };
    }),
  }));
}

/**
 * 将 segments 内所有提示词字段（场景描述/首尾帧/视频提示/分镜）中的角色/场景图片标签
 * 刷新为当前角色/场景的最新图片 URL。
 */
export function refreshSegmentsPromptImageUrls(
  segments: InstantSegment[],
  characters: InstantCharacter[],
  scenes: InstantScene[]
): InstantSegment[] {
  const refresh = (val?: string) =>
    val ? refreshPromptImageUrls(val, characters, scenes) : val;

  return segments.map((seg) => ({
    ...seg,
    canvasItems: (seg.canvasItems || []).map((item: CanvasItem) => {
      if (item.type !== 'scene') return item;
      const nextShots = item.shots?.map((shot: Shot) => ({
        ...shot,
        prompt: refresh(shot.prompt) ?? shot.prompt,
        rawPrompt: refresh(shot.rawPrompt) ?? shot.rawPrompt,
        referencePrompt: refresh(shot.referencePrompt) ?? shot.referencePrompt,
        rawReferencePrompt:
          refresh(shot.rawReferencePrompt) ?? shot.rawReferencePrompt,
      }));
      return {
        ...item,
        customPrompt: refresh(item.customPrompt) ?? item.customPrompt,
        generatedPrompt: refresh(item.generatedPrompt) ?? item.generatedPrompt,
        firstFramePrompt: refresh(item.firstFramePrompt) ?? item.firstFramePrompt,
        lastFramePrompt: refresh(item.lastFramePrompt) ?? item.lastFramePrompt,
        firstLastFrameVideoPrompt:
          refresh(item.firstLastFrameVideoPrompt) ?? item.firstLastFrameVideoPrompt,
        shots: nextShots,
      };
    }),
  }));
}

/**
 * 生成带标签的可视化分镜提示词（保留 @role / #scene 标签用于 UI 渲染）
 */
export const generateVisualShotPrompt = (shot: Shot): string => {
  const parts: string[] = [];

  const shotTypeInfo = SHOT_TYPES.find((s) => s.id === shot.shotType);
  if (shotTypeInfo) parts.push(shotTypeInfo.name);

  if (shot.cameraMovements?.length > 0) {
    const movements = shot.cameraMovements
      .map((m) => {
        const info = CAMERA_MOVEMENTS.find((c) => c.id === m);
        return info ? info.name : m;
      })
      .join('、');
    parts.push(movements + '运镜');
  }

  const angleInfo = CAMERA_ANGLES.find((a) => a.id === shot.cameraAngle);
  if (angleInfo) parts.push(angleInfo.name + '视角');

  const lightingInfo = LIGHTING_TYPES.find((l) => l.id === shot.lighting);
  if (lightingInfo) parts.push(lightingInfo.name + '光线');

  const moodInfo = MOOD_TYPES.find((m) => m.id === shot.mood);
  if (moodInfo) parts.push(moodInfo.name + '氛围');

  if (shot.prompt) parts.push(shot.prompt);

  return parts.join('，');
};
