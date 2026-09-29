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

import type { Scene, Character, Shot } from '@/shared/types/index';
import { CAMERA_MOVEMENTS, SHOT_TYPES, CAMERA_ANGLES, LIGHTING_TYPES, MOOD_TYPES } from '@/shared/types/index';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { idbStorage } from '@/shared/utils/indexedDbStorage';
import { useProjectStore } from '@/shared/stores/projectStore';
import { parseVisualPromptToText } from '@/shared/components/ui/visualPromptEditorUtils';
import { stripVideoPromptSuffix } from '../stores/workflowStore.episode.utils';

// 统一获取角色头像（兼容 Character 和 InstantCharacter）
const getCharImage = (char: any): string => {
  return char?.avatarImages?.[char?.currentAvatarIndex || 0]?.imageUrl
    || char?.multiViewImages?.[0]?.imageUrl
    || char?.fullBodyImages?.[0]?.imageUrl
    || char?.avatar
    || '';
};

// 统一获取场景图片（兼容 Scene 和 InstantScene）
const getSceneImage = (scene: any): string => {
  return scene?.imageUrls?.[0] || scene?.imageUrl || '';
};

// 统一获取角色形象照图片
const getPortraitImage = (portrait: any): string => {
  return portrait?.imageUrl || '';
};

// 优先按 ID 查找,缺 ID 时回退到按名称查找
const findCharByIdOrName = (characters: any[], entityId: string, name: string): any | undefined => {
  let char: any;
  if (entityId) char = characters.find((c) => c.id === entityId);
  if (!char && name) char = characters.find((c) => c.name === name);
  return char;
};

const findSceneByIdOrName = (scenes: any[], entityId: string, name: string): any | undefined => {
  let scene: any;
  if (entityId) scene = scenes.find((s) => s.id === entityId);
  if (!scene && name) scene = scenes.find((s) => s.name === name);
  return scene;
};

/**
 * 将包含 @<role> 和 #<scene> 标签的提示词渲染为带图片的可视化 HTML
 * 用于只读场景（如 EpisodeCard 中的分镜列表显示）
 * @param episodeNumber 当前分集号，传入时只使用当前分集的形象照
 */
export const renderVisualPrompt = function renderVisualPromptImpl(prompt: string, characters: any[], scenes: any[], episodeNumber?: number): string {
  if (!prompt) return '';

  // 按分集过滤形象照，避免跨集显示
  const filteredCharacters = episodeNumber !== undefined
    ? filterCharacterPortraitsByEpisode(characters, episodeNumber)
    : characters;

  let html = '';
  let lastIndex = 0;

  // 改进的正则表达式，使用非贪婪匹配，并允许标签内容中包含其他标签
  // 兼容有属性/无属性，以及 @<scene> 这种异常前缀格式
  // 关键修复：兼容后端 prompt 模板中的中文方括号标记 【形象照:xxx】、
  // 【角色:xxx】、【场景:xxx】，否则这些标记会作为纯文本原样显示，无法 hover 预览。
  // !<ref> 为参考附件标签（分镜编辑弹窗上传的图片/视频/音频附件）
  const regex = /(@<role(?:\s+[^>]*)?>[\s\S]*?<\/role>|[@#]<scene(?:\s+[^>]*)?>[\s\S]*?<\/scene>|@<portrait(?:\s+[^>]*)?>[\s\S]*?<\/portrait>|!<ref(?:\s+[^>]*)?>[\s\S]*?<\/ref>|【形象照:[^】]+】|【角色:[^】]+】|【场景:[^】]+】)/g;
  let match;

  while ((match = regex.exec(prompt)) !== null) {
    // 匹配前的文本
    if (match.index > lastIndex) {
      const text = prompt
        .substring(lastIndex, match.index)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      html += `<span>${text}</span>`;
    }

    const tagContent = match[1];

    // 解析标签类型和内容
    let tagType: 'role' | 'scene' | 'portrait' | 'asset' | null = null;
    let name = '';
    let entityId = '';
    let imageUrl = '';
    let portraitIndex = '';
    let assetType = '';

    // 异常名字过滤：标签内若仅为 # / @ / 空白，视为非法 pill，降级为纯文本
    const isValidName = (s: string): boolean =>
      !!s && s !== '#' && s !== '@' && !/^[#@\s]+$/.test(s);

    if (tagContent.startsWith('@<role')) {
      tagType = 'role';
      // 提取 character-id
      const idMatch = tagContent.match(/character-id="([^"]+)"/);
      entityId = idMatch ? idMatch[1] : '';

      // 关键修复：先去掉 <img> 标签，再提取 </role> 前的纯文本作为名字（与 VisualPromptEditor 一致）
      const cleanedRoleContent = tagContent.replace(/<img\b[^>]*>/g, '');
      const nameMatch = cleanedRoleContent.match(/@<role(?:\s+[^>]*)?>([\s\S]*?)<\/role>/);
      name = nameMatch ? nameMatch[1].trim() : '';

      // 防御性处理：name 可能因嵌套/异常格式仍为完整标签，尝试提取内部纯文本
      if (name && name.includes('<')) {
        const innerNameMatch = name.match(/<(?:role|scene|portrait)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:role|scene|portrait)>/);
        name = innerNameMatch ? innerNameMatch[1].trim() : name.replace(/<[^>]+>/g, '').trim();
      }
      if (!isValidName(name)) name = '';

      // 若 ID 缺失但名字有效，尝试按名字回查角色
      if (name && !entityId) {
        const char = filteredCharacters.find((c) => c.name === name);
        entityId = char?.id || '';
      }

      // 提取图片URL（从原始 tagContent 取，因为 img 标签有 src）
      const imgMatch = tagContent.match(/<img[^>]*src="([^"]*)"/);
      const imgSrc = imgMatch ? imgMatch[1] : '';

      if (name && entityId) {
        const char = findCharByIdOrName(filteredCharacters, entityId, name);
        imageUrl = imgSrc || getCharImage(char);
      }
    } else if (tagContent.startsWith('#<scene') || tagContent.startsWith('@<scene')) {
      tagType = 'scene';
      // 提取 scene-id
      const idMatch = tagContent.match(/scene-id="([^"]+)"/);
      entityId = idMatch ? idMatch[1] : '';

      // 关键修复：先去掉 <img> 标签，再提取 </scene> 前的纯文本作为名字
      const cleanedSceneContent = tagContent.replace(/<img\b[^>]*>/g, '');
      const nameMatch = cleanedSceneContent.match(/[@#]<scene(?:\s+[^>]*)?>([\s\S]*?)<\/scene>/);
      name = nameMatch ? nameMatch[1].trim() : '';

      // 防御性处理：name 可能因嵌套/异常格式仍为完整标签，尝试提取内部纯文本
      if (name && name.includes('<')) {
        const innerNameMatch = name.match(/<(?:scene|role|portrait)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:scene|role|portrait)>/);
        name = innerNameMatch ? innerNameMatch[1].trim() : name.replace(/<[^>]+>/g, '').trim();
      }
      if (!isValidName(name)) {
        // 名字异常时尝试用 scene-id 在 scenes 列表中回查
        if (entityId) {
          const scene = scenes.find((s) => s.id === entityId);
          name = scene?.name || '';
        } else {
          name = '';
        }
      }

      // 若 ID 缺失但名字有效，尝试按名字回查场景
      if (name && !entityId) {
        const scene = scenes.find((s) => s.name === name);
        entityId = scene?.id || '';
      }

      // 提取图片URL
      const imgMatch = tagContent.match(/<img[^>]*src="([^"]*)"/);
      const imgSrc = imgMatch ? imgMatch[1] : '';

      if (name && entityId) {
        const scene = findSceneByIdOrName(scenes, entityId, name);
        imageUrl = imgSrc || getSceneImage(scene);
      }
    } else if (tagContent.startsWith('@<portrait')) {
      tagType = 'portrait';
      const idMatch = tagContent.match(/character-id="([^"]+)"/);
      entityId = idMatch ? idMatch[1] : '';
      const idxMatch = tagContent.match(/portrait-index="([^"]+)"/);
      portraitIndex = idxMatch ? idxMatch[1] : '';

      // 关键修复：先去掉 <img> 标签，再提取 </portrait> 前的纯文本作为名字
      const cleanedPortraitContent = tagContent.replace(/<img\b[^>]*>/g, '');
      const nameMatch = cleanedPortraitContent.match(/@<portrait(?:\s+[^>]*)?>([\s\S]*?)<\/portrait>/);
      name = nameMatch ? nameMatch[1].trim() : '';

      // 防御性处理：name 可能因嵌套/异常格式仍为完整标签，尝试提取内部纯文本
      if (name && name.includes('<')) {
        const innerNameMatch = name.match(/<(?:portrait|role|scene)(?:\s+[^>]*)?>([\s\S]*?)<\/(?:portrait|role|scene)>/);
        name = innerNameMatch ? innerNameMatch[1].trim() : name.replace(/<[^>]+>/g, '').trim();
      }
      if (!isValidName(name)) name = '';

      // 若 ID 缺失但名字有效，尝试按名字回查形象照所属角色
      if (name && !entityId) {
        for (const c of filteredCharacters) {
          const portraits = c.fullBodyImages || [];
          const idx = portraits.findIndex((p: any) => p?.name === name);
          if (idx >= 0) {
            entityId = c.id;
            portraitIndex = String(idx);
            break;
          }
        }
      }

      const imgMatch = tagContent.match(/<img[^>]*src="([^"]*)"/);
      const imgSrc = imgMatch ? imgMatch[1] : '';

      if (name && entityId) {
        const char = findCharByIdOrName(filteredCharacters, entityId, name);
        const portraits = char?.fullBodyImages || [];
        const portrait = portraits[parseInt(portraitIndex, 10)];
        imageUrl = imgSrc || getPortraitImage(portrait);
      }
      // 关键修复：形象照精确定位无图时（独立形象照 character 的图存在 avatarImages、
      // 或 fullBodyImages.assetId 未被 resolveImageAssets 解析出 url），按 name 全局回查
      // 其它角色的 fullBodyImages，再回退到该 character 的任意可用图片，保证提示词预览/编辑框
      // 中的形象照能显示并可 hover 预览
      if (!imageUrl && name) {
        for (const c of filteredCharacters) {
          const matched = (c.fullBodyImages || []).find(
            (p: any) => p?.name === name && p?.imageUrl,
          );
          if (matched?.imageUrl) {
            imageUrl = matched.imageUrl;
            break;
          }
        }
        if (!imageUrl && entityId) {
          const char = findCharByIdOrName(filteredCharacters, entityId, name);
          if (char) imageUrl = getCharImage(char);
        }
      }
    } else if (tagContent.startsWith('!<ref')) {
      // 参考附件标签：!<ref url="..." type="image|video|audio">名称</ref>
      tagType = 'asset';
      const urlMatch = tagContent.match(/url="([^"]*)"/);
      entityId = urlMatch ? urlMatch[1] : '';
      const typeMatch = tagContent.match(/type="([^"]*)"/);
      assetType = typeMatch ? typeMatch[1] : 'image';
      const nameMatch = tagContent.match(/!<ref(?:\s+[^>]*)?>([\s\S]*?)<\/ref>/);
      name = nameMatch ? nameMatch[1].trim() : '';
      if (!isValidName(name)) name = '';
      imageUrl = assetType === 'image' ? entityId : '';
    } else if (tagContent.startsWith('【形象照:')) {
      // 关键修复：后端 prompt 模板输出【形象照:xxx】中文方括号标记，
      // 之前会被当作纯文本原样显示。现在解析为可视化形象照标签。
      // 按 portrait.name 在 activeCharacterIds 列表中查找对应角色的对应形象照。
      tagType = 'portrait';
      const inner = tagContent.replace(/^【形象照:/, '').replace(/】$/, '').trim();

      // 如果内部是混合/嵌套标签（非简单的 @<portrait>），递归渲染内部
      if (inner.includes('<') && !inner.startsWith('@<portrait')) {
        html += renderVisualPromptImpl(inner, characters, scenes, episodeNumber);
        lastIndex = match.index + match[0].length;
        continue;
      }

      name = inner;

      // 兼容嵌套 XML 标签格式：【形象照:@<portrait character-id="..." portrait-index="...">名称</portrait>】
      if (inner.startsWith('@<portrait')) {
        const idMatch = inner.match(/character-id="([^"]+)"/);
        entityId = idMatch ? idMatch[1] : '';
        const idxMatch = inner.match(/portrait-index="([^"]+)"/);
        portraitIndex = idxMatch ? idxMatch[1] : '';
        const nameMatch = inner.match(/@<portrait(?:\s+[^>]*)?>([\s\S]*?)<\/portrait>/);
        name = nameMatch ? nameMatch[1].trim() : inner.replace(/<[^>]+>/g, '').trim();
      }

      // 关键策略：按名称在所有角色中查找匹配的形象照（按 portrait.name 精确匹配）
      for (const c of filteredCharacters) {
        const portraits = c.fullBodyImages || [];
        const idx = portraits.findIndex((p: any) => p?.name === name);
        if (idx >= 0) {
          entityId = c.id;
          portraitIndex = String(idx);
          imageUrl = getPortraitImage(portraits[idx]);
          break;
        }
      }
    } else if (tagContent.startsWith('【角色:')) {
      // 关键修复：后端 prompt 模板输出【角色:姓名】中文方括号标记
      tagType = 'role';
      const inner = tagContent.replace(/^【角色:/, '').replace(/】$/, '').trim();

      // 如果内部是混合/嵌套标签（非简单的 @<role>），递归渲染内部
      if (inner.includes('<') && !inner.startsWith('@<role')) {
        html += renderVisualPromptImpl(inner, characters, scenes, episodeNumber);
        lastIndex = match.index + match[0].length;
        continue;
      }

      name = inner;

      // 兼容嵌套 XML 标签格式：【角色:@<role character-id="...">姓名</role>】
      if (inner.startsWith('@<role')) {
        const idMatch = inner.match(/character-id="([^"]+)"/);
        entityId = idMatch ? idMatch[1] : '';
        const nameMatch = inner.match(/@<role(?:\s+[^>]*)?>([\s\S]*?)<\/role>/);
        name = nameMatch ? nameMatch[1].trim() : inner.replace(/<[^>]+>/g, '').trim();
      }

      const char = findCharByIdOrName(filteredCharacters, entityId, name);
      if (char) {
        entityId = char.id;
        imageUrl = getCharImage(char);
      }
    } else if (tagContent.startsWith('【场景:')) {
      // 关键修复：后端 prompt 模板输出【场景:名称】中文方括号标记
      tagType = 'scene';
      const inner = tagContent.replace(/^【场景:/, '').replace(/】$/, '').trim();

      // 如果内部是混合/嵌套标签（非简单的 #<scene>/@<scene>），递归渲染内部
      if (inner.includes('<') && !inner.startsWith('#<scene') && !inner.startsWith('@<scene')) {
        html += renderVisualPromptImpl(inner, characters, scenes, episodeNumber);
        lastIndex = match.index + match[0].length;
        continue;
      }

      name = inner;

      // 兼容嵌套 XML 标签格式：【场景:#<scene scene-id="...">名称</scene>】
      if (inner.startsWith('#<scene') || inner.startsWith('@<scene')) {
        const idMatch = inner.match(/scene-id="([^"]+)"/);
        entityId = idMatch ? idMatch[1] : '';
        const nameMatch = inner.match(/[@#]<scene(?:\s+[^>]*)?>([\s\S]*?)<\/scene>/);
        name = nameMatch ? nameMatch[1].trim() : inner.replace(/<[^>]+>/g, '').trim();
      }

      const scene = findSceneByIdOrName(scenes, entityId, name);
      if (scene) {
        entityId = scene.id;
        imageUrl = getSceneImage(scene);
      }
    }

    const safeName = name.replace(/"/g, '&quot;');
      if (tagType === 'role' && name) {
      const char = findCharByIdOrName(filteredCharacters, entityId, name);
      const imgHtml = imageUrl
        ? `<img src="${imageUrl}" class="w-5 h-5 rounded-full object-cover border border-accent-primary/30 cursor-pointer" data-hover-image="${imageUrl}" data-hover-type="role" data-hover-name="${safeName}" onerror="this.style.display='none'">`
        : `<div class="w-5 h-5 rounded-full bg-accent-primary/30 flex items-center justify-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`;
      // 若角色配置了自定义音色（上传/资产库拖入），在名字后显示喇叭图标（点击播放），
      // 音频地址用 data-tts-custom-url 携带
      const customVoiceUrl = (char?.characterAudios?.find((a: { audioType: string; cosUrl?: string }) => a.audioType === 'vocal')?.cosUrl || char?.voiceUrl || '');
      const speakerHtml = customVoiceUrl
        ? `<span class="tts-speaker-btn inline-flex items-center justify-center ml-0.5 w-4 h-4 rounded-full bg-accent-primary/40 hover:bg-accent-primary/70 cursor-pointer transition-colors" data-tts-custom-url="${encodeURIComponent(customVoiceUrl)}" title="播放自定义音色">
            <svg class="tts-speaker-play" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
            <svg class="tts-speaker-stop" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>
           </span>`
        : '';
      html += `<span contenteditable="false" data-role-tag="true" data-character-id="${entityId}" data-name="${safeName}" data-image="${imageUrl}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-accent-primary/20 border border-accent-primary/40 rounded-full text-accent-primary text-sm select-none cursor-default">${imgHtml} <span class="font-medium">${name}</span>${speakerHtml}</span><span>​</span>`;
    } else if (tagType === 'scene' && name) {
      const imgHtml = imageUrl
        ? `<img src="${imageUrl}" class="h-5 w-auto max-w-12 rounded object-contain border border-emerald-500/30" onerror="this.style.display='none'">`
        : `<div class="w-8 h-5 rounded bg-emerald-500/30 flex items-center justify-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></div>`;
      html += `<span contenteditable="false" data-scene-tag="true" data-scene-id="${entityId}" data-name="${safeName}" data-image="${imageUrl}" data-hover-image="${imageUrl}" data-hover-type="scene" data-hover-name="${safeName}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-emerald-500/20 border border-emerald-500/40 rounded text-emerald-400 text-sm select-none cursor-default">${imgHtml} <span class="font-medium">${name}</span></span><span>​</span>`;
    } else if (tagType === 'portrait' && name) {
      const imgHtml = imageUrl
        ? `<img src="${imageUrl}" class="w-5 h-5 rounded-full object-cover border border-purple-500/30" onerror="this.style.display='none'">`
        : `<div class="w-5 h-5 rounded-full bg-purple-500/30 flex items-center justify-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`;
      html += `<span contenteditable="false" data-portrait-tag="true" data-character-id="${entityId}" data-portrait-index="${portraitIndex}" data-name="${safeName}" data-image="${imageUrl}" data-hover-image="${imageUrl}" data-hover-type="portrait" data-hover-name="${safeName}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-purple-500/20 border border-purple-500/40 rounded-full text-purple-400 text-sm select-none cursor-default">${imgHtml} <span class="font-medium">${name}</span></span><span>​</span>`;
    } else if (tagType === 'asset' && name) {
      // 参考附件 pill（琥珀色）：图片显示缩略图并可 hover 预览，视频/音频显示类型图标
      // 文字用 amber-600 而非 amber-400：浅色主题（白底）下 amber-400 对比度过低看不清
      const assetIconSvg = assetType === 'video'
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
      const imgHtml = assetType === 'image' && entityId
        ? `<img src="${entityId}" class="w-5 h-5 rounded object-cover border border-amber-500/50 cursor-pointer" data-hover-image="${entityId}" data-hover-type="scene" data-hover-name="${safeName}" onerror="this.style.display='none'">`
        : `<div class="w-5 h-5 rounded bg-amber-500/30 flex items-center justify-center">${assetIconSvg}</div>`;
      html += `<span contenteditable="false" data-asset-tag="true" data-url="${entityId}" data-asset-type="${assetType}" data-name="${safeName}" data-image="${imageUrl}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-amber-500/15 border border-amber-500/50 rounded-full text-amber-600 text-sm select-none cursor-default">${imgHtml} <span class="font-medium">${name}</span></span><span>​</span>`;
    } else {
      // 如果无法解析标签，直接显示原始文本
      html += `<span>${tagContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < prompt.length) {
    const text = prompt
      .substring(lastIndex)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    html += `<span>${text}</span>`;
  }

  return html;
};

/**
 * 同步更新提示词中指定角色/场景的标记为纯净格式（移除 img 标签）
 * @param prompt 原始提示词
 * @param type 'role' | 'scene'
 * @param entityId 角色ID或场景ID
 * @param imageUrl 新的图片URL（已废弃，不再嵌入标记中，由 renderVisualPrompt 动态渲染）
 */
export const syncPromptImage = (prompt: string, type: 'role' | 'scene', entityId: string, _imageUrl: string): string => {
  if (!prompt) return prompt;

  if (type === 'role') {
    // 匹配 @<role character-id="xxx">角色名[可选<img>]</role>
    // 只处理 character-id 匹配的标签，移除其中的 img 标签
    return prompt.replace(
      /@<role\b[^>]*>([\s\S]*?)<\/role>/g,
      (match, innerContent) => {
        if (!match.includes(`character-id="${entityId}"`)) return match;
        // 提取角色名（去掉 img 标签）
        const nameMatch = innerContent.match(/^([^<]*)/);
        const name = nameMatch ? nameMatch[1].trim() : '';
        return `@<role character-id="${entityId}">${name}</role>`;
      }
    );
  } else {
    // 匹配 #<scene scene-id="xxx">场景名[可选<img>]</scene>
    return prompt.replace(
      /#<scene\b[^>]*>([\s\S]*?)<\/scene>/g,
      (match, innerContent) => {
        if (!match.includes(`scene-id="${entityId}"`)) return match;
        const nameMatch = innerContent.match(/^([^<]*)/);
        const name = nameMatch ? nameMatch[1].trim() : '';
        return `#<scene scene-id="${entityId}">${name}</scene>`;
      }
    );
  }
};

/**
 * 同步更新所有 episode 中的角色/场景图片
 */
export const syncEpisodePromptImages = (episodes: any[], type: 'role' | 'scene', entityId: string, imageUrl: string): any[] => {
  return episodes.map((episode) => {
    const updatePrompt = (prompt: string | undefined) => syncPromptImage(prompt || '', type, entityId, imageUrl);

    return {
      ...episode,
      shots: episode.shots?.map((shot: any) => ({
        ...shot,
        prompt: updatePrompt(shot.prompt),
        referencePrompt: updatePrompt(shot.referencePrompt),
      })),
      firstFramePrompt: updatePrompt(episode.firstFramePrompt),
      lastFramePrompt: updatePrompt(episode.lastFramePrompt),
      firstLastFrameVideoPrompt: updatePrompt(episode.firstLastFrameVideoPrompt),
      videoPrompt: updatePrompt(episode.videoPrompt),
    };
  });
};

// ========== 存储键名规范 ==========
// v2 格式（固定格式，不再依赖 project-storage）：
//   项目资产: shotlib_workflow_${projectId}_assets
//   分集数据: shotlib_workflow_${projectId}_episode_${n}
//   分集列表: shotlib_episode_list_${projectId}（保持现有）
// 兼容旧格式（加载时会自动查找）：
//   shotlib_workflow_${category}_${type}_${projectId}_episode_${n}
//   shotlib_workflow_${projectId}（第1集旧格式）

/** 获取项目资产存储键 */
export const getProjectAssetsKey = (projectId: string): string => {
  return `shotlib_workflow_${projectId}_assets`;
};

/** 获取分集资产存储键（对应后端 creator_drama_project_assets 的 category='drama' + episode_number 记录） */
export const getEpisodeAssetsKey = (projectId: string, episodeNumber: number): string => {
  return `shotlib_workflow_${projectId}_assets_episode_${episodeNumber}`;
};

/** 获取剧本存储键（对应后端 creator_drama_project_assets 的 category='script' 记录，按 episode_number 区分） */
export const getScriptAssetKey = (projectId: string, episodeNumber: number = 1): string => {
  return `shotlib_workflow_${projectId}_script_${episodeNumber}`;
};

/** 获取分集数据存储键（保存时使用，固定格式） */
export const getEpisodeDataKey = (projectId: string, episodeNumber: number): string => {
  return `shotlib_workflow_${projectId}_episode_${episodeNumber}`;
};

/**
 * 获取片段当前可用的视频 URL（与 step4 的"已有视频"判定逻辑一致）：
 * 优先 generatedVideoUrl，回退到历史视频 generatedVideos 最新一条
 */
export const getEpisodeVideoUrl = (ep: {
  generatedVideoUrl?: string;
  generatedVideos?: { url: string }[];
}): string => {
  if (ep.generatedVideoUrl) return ep.generatedVideoUrl;
  const history = ep.generatedVideos;
  return history && history.length > 0 ? history[history.length - 1].url : '';
};


export const getCurrentProjectAspectRatio = (): string => {
  if (typeof window === 'undefined') return '16:9';
  try {
    // 优先从 projectStore (zustand) 读取，支持 workflow 模式
    const projectStore = useProjectStore.getState();
    if (projectStore?.currentProjectId) {
      const project = projectStore.projects.find((p) => p.id === projectStore.currentProjectId);
      if (project?.aspectRatio) {
        return project.aspectRatio;
      }
    }
    // 回退到 project-storage（即时创作模式兼容）
    const projectStorage = userStorage.getItem('project-storage');
    if (projectStorage) {
      const projectData = JSON.parse(projectStorage);
      const projects = projectData?.state?.projects || [];
      const currentProjectId = projectData?.state?.currentProjectId;
      const project = projects.find((p: any) => p.id === currentProjectId);
      return project?.aspectRatio || '16:9';
    }
  } catch (e) {
    console.error('Failed to read project aspect ratio:', e);
  }
  return '16:9';
};

/**
 * 按分集过滤道具显示列表（与角色/场景的 active IDs 机制一致）。
 * 道具为项目级资产（跨集共享存储），显示/批量生成时按当前分集活跃ID过滤：
 * 1. 有 activePropIds：精确过滤（分解时写入）
 * 2. 旧数据无 activePropIds：回退按道具名在本集剧本中的出现匹配（≥2字，单字名
 *    命中率过高不参与），避免第2集新增道具串到第1集、第3集显示全部历史道具
 * 3. 无剧本：保持旧行为显示全部
 */
export function filterEpisodeProps<T extends { id: string; name?: string }>(
  props: T[] | undefined,
  activePropIds: string[] | undefined,
  script: string | undefined,
): T[] {
  const list = props || [];
  if (activePropIds?.length) {
    return list.filter((p) => activePropIds.includes(p.id));
  }
  if (script?.trim()) {
    return list.filter((p) => {
      const n = (p.name || '').trim();
      return n.length >= 2 && script.includes(n);
    });
  }
  return list;
}

/**
 * 解析首帧/尾帧的HTML提示词
 * 将 <scene> 和 <role> 标签转换为 名称[图片N] 格式，并收集对应的参考图片URL
 * 顺序：第1张为场景图，第2张为人物多视图
 */
/**
 * 智能合并：避免空数组覆盖非空数组，避免 undefined 覆盖已有值
 */
function smartMerge(existing: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
  const result = { ...existing };
  for (const key of Object.keys(incoming)) {
    const val = incoming[key];
    if (val === undefined) continue;
    // 保护：空数组不覆盖非空数组（防止生成过程中间状态清空已有数据）
    if (Array.isArray(val) && val.length === 0) {
      const existingVal = existing[key];
      if (Array.isArray(existingVal) && existingVal.length > 0) {
        console.log(`[smartMerge] 保护: ${key} (existing=${existingVal.length}, incoming=0)`);
        continue;
      }
    }
    // 保护：空字符串不覆盖非空字符串（防止生成过程中间状态清空已有数据）
    if (val === '' && typeof existing[key] === 'string' && existing[key] !== '') {
      console.log(`[smartMerge] 保护: ${key} (existing="${existing[key].substring(0, 20)}...", incoming="")`);
      continue;
    }
    result[key] = val;
  }
  return result;
}

/**
 * 将 workflow 状态保存到 localStorage（v2 格式：项目资产 + 分集数据分离）
 */
export function saveWorkflowStateToLocal(projectId: string, episodeNumber: number, state: any) {
  // 只保存非 undefined 的字段，避免传入 partialState 时覆盖已有资产
  const assets: Record<string, any> = {};
  // 项目级字段（与 PROJECT_DATA_FIELDS 对齐）
  // characters/scenes 虽然按行存储在后端，但 localStorage 缓存中仍需保留（用于秒开加载）
  const assetFields = [
    'characters', 'scenes', 'props',
    'agentType', 'artStyle', 'artStylePromptHint', 'skills', 'genre',
    'textModel', 'imageModel', 'videoModel',
    'era', 'relationshipNetwork',
    'audioAssets',
    // 以下字段不在 PROJECT_DATA_FIELDS 中，但 localStorage 缓存需要保留（模型列表、preview 开关）
    'textModels', 'imageModels', 'videoModels', 'previewEnabled',
  ];
  for (const key of assetFields) {
    if (state[key] !== undefined) assets[key] = state[key];
  }

  const episode: Record<string, any> = {};
  // 分集级字段（与 EPISODE_DATA_FIELDS 对齐）
  const episodeFields = [
    'currentStep', 'topic', 'script', 'previousEpisodeScript', 'previousEpisodeSummary',
    'summary', 'isEnding', 'episodes', 'isSimplifiedMode', 'activeCharacterIds', 'activeSceneIds',
    'activePropIds',
  ];
  for (const key of episodeFields) {
    if (state[key] !== undefined) episode[key] = state[key];
  }
  // 确保数组字段有默认值，但仅在本地无数据时才写入默认值
  if (episode.activeCharacterIds === undefined) episode.activeCharacterIds = [];
  if (episode.activeSceneIds === undefined) episode.activeSceneIds = [];
  if (episode.activePropIds === undefined) episode.activePropIds = [];

  const now = Date.now();

  try {
    const assetsKey = getProjectAssetsKey(projectId);
    const existingAssetsRaw = userStorage.getItem(assetsKey);
    const mergedAssets = existingAssetsRaw
      ? smartMerge(JSON.parse(existingAssetsRaw), assets)
      : assets;
    mergedAssets._savedAt = now;  // 记录保存时间戳

    // 同步写入 localStorage（可靠 fallback）
    userStorage.setItem(assetsKey, JSON.stringify(mergedAssets));
    // 异步写入 IndexedDB（大容量、不阻塞）
    idbStorage.setItem(assetsKey, mergedAssets).catch((e) => {
      console.warn('[saveWorkflowStateToLocal] IndexedDB assets save failed:', e);
    });

    console.log(`[saveWorkflowStateToLocal] assetsKey=${assetsKey}, assetFields=${Object.keys(assets).join(',')}, mergedKeys=${Object.keys(mergedAssets).join(',')}`);

    const episodeKey = getEpisodeDataKey(projectId, episodeNumber);
    const existingEpisodeRaw = userStorage.getItem(episodeKey);
    const mergedEpisode = existingEpisodeRaw
      ? smartMerge(JSON.parse(existingEpisodeRaw), episode)
      : episode;
    mergedEpisode._savedAt = now;  // 记录保存时间戳

    // 同步写入 localStorage
    userStorage.setItem(episodeKey, JSON.stringify(mergedEpisode));
    // 异步写入 IndexedDB
    idbStorage.setItem(episodeKey, mergedEpisode).catch((e) => {
      console.warn('[saveWorkflowStateToLocal] IndexedDB episode save failed:', e);
    });

    console.log(`[saveWorkflowStateToLocal] episodeKey=${episodeKey}, episodeFields=${Object.keys(episode).join(',')}, mergedKeys=${Object.keys(mergedEpisode).join(',')}, episodesCount=${mergedEpisode.episodes?.length ?? 'N/A'}, activeChars=${mergedEpisode.activeCharacterIds?.length ?? 'N/A'}`);
  } catch (e) {
    console.error('[saveWorkflowStateToLocal] failed:', e);
  }
}

export function parseFramePrompt(
  htmlPrompt: string,
  scenes: Scene[],
  characters: Character[]
): { prompt: string; referenceImageUrls: string[] } {
  const referenceImageUrls: string[] = [];
  let prompt = htmlPrompt;

  // 移除外层 div 包裹
  prompt = prompt.replace(/<div[^>]*class="html-content"[^>]*>([\s\S]*)<\/div>/, '$1').trim();

  // 处理 ref 参考附件标签（! 前缀，分镜编辑弹窗上传的参考附件），优先放入参考图列表
  // image 类型进入参考图数组；video/audio 图像生成无法引用，仅保留名称文本
  prompt = prompt.replace(
    /!<ref\s+url="([^"]*)"\s+type="([^"]*)">([\s\S]*?)<\/ref>/g,
    (_match, url: string, type: string, name: string) => {
      if (type === 'image' && url) {
        if (!referenceImageUrls.includes(url)) {
          referenceImageUrls.push(url);
        }
        const placeholder = `[图片${referenceImageUrls.indexOf(url) + 1}]`;
        return `${name.trim()}${placeholder}`;
      }
      return name.trim();
    }
  );

  // 处理 scene 标签（带 # 或 @ 前缀），优先放入参考图列表
  // 兼容有 scene-id 属性和无属性两种格式
  prompt = prompt.replace(
    /[@#]<scene(?:\s+scene-id="([^"]+)")?>([^<]*)(?:<img[^>]*src="([^"]*)"[^>]*>)?<\/scene>/g,
    (_match, sceneId, sceneName, imgSrc) => {
      let sceneImageUrl = imgSrc || '';
      if (!sceneImageUrl && sceneId) {
        const scene = scenes.find((s) => s.id === sceneId);
        sceneImageUrl = scene?.imageUrls?.[0] || '';
      }
      if (sceneImageUrl && !referenceImageUrls.includes(sceneImageUrl)) {
        referenceImageUrls.push(sceneImageUrl);
      }
      const placeholder = sceneImageUrl ? `[图片${referenceImageUrls.indexOf(sceneImageUrl) + 1}]` : '';
      return `${sceneName.trim()}${placeholder}`;
    }
  );

  // 处理 portrait 标签（@ 前缀），按 portrait-index 提取单张形象照
  // 记录哪些角色已有形象照引用，后续 role 标签处理时跳过对应的全身照
  const portraitCharIds = new Set<string>();
  prompt = prompt.replace(
    /@<portrait(?:\s+[^>]*)?>([^<]*)(?:<img[^>]*src="([^"]*)"[^>]*>)?<\/portrait>/g,
    (_match, portraitName, imgSrc) => {
      const attrsMatch = _match.match(/character-id="([^"]+)"/);
      const idxMatch = _match.match(/portrait-index="(\d+)"/);
      const charId = attrsMatch ? attrsMatch[1] : '';
      const portraitIdx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
      let portraitUrl = imgSrc || '';
      if (!portraitUrl && charId) {
        const char = characters.find((c) => c.id === charId);
        portraitUrl = char?.fullBodyImages?.[portraitIdx]?.imageUrl || '';
      }
      if (charId) portraitCharIds.add(charId);
      if (portraitUrl && !referenceImageUrls.includes(portraitUrl)) {
        referenceImageUrls.push(portraitUrl);
      }
      const placeholder = portraitUrl ? `[图片${referenceImageUrls.indexOf(portraitUrl) + 1}]` : '';
      return `${portraitName.trim()}${placeholder}`;
    }
  );

  // 处理 role 标签（带 @ 前缀），使用人物多视图
  // 若该角色已有形象照引用，则跳过全身照，由形象照作为该人物的唯一装束参照
  // 兼容有 character-id 属性和无属性两种格式
  prompt = prompt.replace(
    /@<role(?:\s+character-id="([^"]+)")?>([^<]*)(?:<img[^>]*src="([^"]*)"[^>]*>)?<\/role>/g,
    (_match, charId, charName, imgSrc) => {
      // 该角色已有形象照作为参照，不再添加全身照
      const hasPortrait = charId ? portraitCharIds.has(charId) : false;
      let charImageUrl = '';
      if (!hasPortrait) {
        charImageUrl = imgSrc || '';
        if (!charImageUrl && charId) {
          const char = characters.find((c) => c.id === charId);
          charImageUrl = char?.multiViewImages?.[0]?.imageUrl || '';
        }
      }
      if (charImageUrl && !referenceImageUrls.includes(charImageUrl)) {
        referenceImageUrls.push(charImageUrl);
      }
      const placeholder = charImageUrl ? `[图片${referenceImageUrls.indexOf(charImageUrl) + 1}]` : '';
      return `${charName.trim()}${placeholder}`;
    }
  );

  // 清理剩余 HTML 标签并规范化空白
  prompt = prompt.replace(/<[^>]+>/g, '').trim();
  prompt = prompt.replace(/\s+/g, ' ').trim();

  return { prompt, referenceImageUrls };
}


/**
 * 生成分镜提示词（组合镜头类型、运镜、角度、灯光、氛围、用户提示词）
 */
export const generateShotPrompt = (shot: Shot): string => {
  const parts: string[] = [];

  // 镜头类型
  const shotTypeInfo = SHOT_TYPES.find((s) => s.id === shot.shotType);
  if (shotTypeInfo) parts.push(shotTypeInfo.name);

  // 运镜方式
  if (shot.cameraMovements?.length > 0) {
    const movements = shot.cameraMovements
      .map((m) => {
        const info = CAMERA_MOVEMENTS.find((c) => c.id === m);
        return info ? info.name : m;
      })
      .join('、');
    parts.push(movements + '运镜');
  }

  // 摄像机角度
  const angleInfo = CAMERA_ANGLES.find((a) => a.id === shot.cameraAngle);
  if (angleInfo) parts.push(angleInfo.name + '视角');

  // 灯光
  const lightingInfo = LIGHTING_TYPES.find((l) => l.id === shot.lighting);
  if (lightingInfo) parts.push(lightingInfo.name + '光线');

  // 氛围
  const moodInfo = MOOD_TYPES.find((m) => m.id === shot.mood);
  if (moodInfo) parts.push(moodInfo.name + '氛围');

  // 用户提示词（显示层剥离统一约束后缀，提交时由系统重新追加）
  if (shot.prompt) parts.push(stripVideoPromptSuffix(shot.prompt));

  return parts.join('，');
};

/**
 * 生成用于预览的分镜提示词（剥离 role/scene/portrait 标签，仅纯文本展示）
 */
export const generateShotPromptPreview = (shot: Shot): string => {
  return parseVisualPromptToText(generateShotPrompt(shot));
};

/**
 * 按分集过滤角色形象照，多视图跨集共享。
 * 用于视频生成、首尾帧生成、提示词解析等读取角色图片的场景。
 * 旧数据未标记 episodeNumber 的形象照默认保留（兼容已有项目）。
 */
export function filterCharacterPortraitsByEpisode(
  characters: Character[],
  episodeNumber: number,
): Character[] {
  return characters.map((c) => {
    const fullBodyImages = c.fullBodyImages || [];
    return {
      ...c,
      fullBodyImages: fullBodyImages.map((img) => {
        if (img.episodeNumber === undefined || img.episodeNumber === episodeNumber) return img;
        // 非当前分集的形象照：保留占位结构，但清空图片 URL，避免被下游引用
        return { ...img, imageUrl: '', assetId: '' };
      }),
    };
  });
}
