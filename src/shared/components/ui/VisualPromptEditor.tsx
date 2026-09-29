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

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { User, Image as ImageIcon } from 'lucide-react';
import { HoverImagePreview, type HoverPreviewState } from './HoverImagePreview';
import { getCharImage, getSceneImage, getPortraitImage, getPortraits, refAssetDisplayName } from './visualPromptEditorUtils';
import { VisualPromptEditorDropdown } from './VisualPromptEditorDropdown';
import type { ShotReferenceAsset } from '../../types';

/** 参考附件 pill 的图标 SVG（视频/音频） */
const refAssetIconSvg = (assetType: string): string =>
  assetType === 'video'
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>'
    : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

/** 构建参考附件 pill 的 HTML（data-asset-tag 标记，contenteditable=false）
 * 文字用 amber-600 而非 amber-400：浅色主题（白底）下 amber-400 对比度过低看不清 */
const buildRefAssetPillHtml = (url: string, assetType: string, name: string): string => {
  const inner =
    assetType === 'image' && url
      ? `<img src="${url}" class="w-5 h-5 rounded object-cover border border-amber-500/50" onerror="this.style.display='none'">`
      : `<div class="w-5 h-5 rounded bg-amber-500/30 flex items-center justify-center">${refAssetIconSvg(assetType)}</div>`;
  return `<span contenteditable="false" data-asset-tag="true" data-url="${url}" data-asset-type="${assetType}" data-name="${name}" data-image="${assetType === 'image' ? url : ''}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-amber-500/15 border border-amber-500/50 rounded-full text-amber-600 text-sm select-none">${inner} <span class="font-medium">${name}</span></span>`;
};

interface VisualPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  characters: any[]; // 兼容 Character 和 InstantCharacter
  scenes?: any[];    // 兼容 Scene 和 InstantScene
  /** 参考附件（传入后启用参考附件引用；触发键由 assetTriggerKey 决定） */
  referenceAssets?: ShotReferenceAsset[];
  /** 参考附件的触发键：'!'（默认，与 ShotEditModal 一致）或 '@'（@ 同时引用角色与参考附件） */
  assetTriggerKey?: '@' | '!';
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  style?: React.CSSProperties;
  minRows?: number;
  maxRows?: number;
  hintText?: string;
  sceneImageWidth?: number; // 场景 pill 图片宽度（px）
  readOnly?: boolean;       // 只读模式（用于纯展示，禁用编辑和交互）
}

// 工具函数已抽取到 ./visualPromptEditorUtils

export const VisualPromptEditor: React.FC<VisualPromptEditorProps> = ({
  value,
  onChange,
  characters,
  scenes = [],
  referenceAssets,
  assetTriggerKey = '!',
  placeholder = '',
  className = '',
  editorClassName = '',
  style,
  minRows = 8,
  maxRows = 8,
  hintText = '输入 @ 插入角色或形象照，输入 # 插入场景',
  sceneImageWidth = 27,
  readOnly = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef(value);
  const isComposingRef = useRef(false);
  const showDropdownRef = useRef(false);
  const playingAudioRef = useRef<{ audio: HTMLAudioElement; btn: HTMLElement } | null>(null);

  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownMode, setDropdownMode] = useState<'role' | 'scene' | 'asset' | 'role_asset' | null>(null);
  const [filter, setFilter] = useState('');

  // 同步 ref，避免闭包中捕获过时的 showDropdown state
  useEffect(() => {
    showDropdownRef.current = showDropdown;
  }, [showDropdown]);
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [hoverPreview, setHoverPreview] = useState<{
    visible: boolean;
    x: number;
    y: number;
    imageUrl: string;
    type: 'role' | 'scene' | 'portrait';
  }>({ visible: false, x: 0, y: 0, imageUrl: '', type: 'role' });
  const [expandedCharId, setExpandedCharId] = useState<string | null>(null);
  const hoverPillRef = useRef<HTMLElement | null>(null);

  // 预览显示期间，在 document 层面监听 mousemove。
  // 一旦鼠标离开当前 pill（包括离开编辑器、滑过空白处、停在浏览器其它区域），
  // 立即关闭预览，彻底避免 React 合成事件在 contenteditable 子树里漏报。
  useEffect(() => {
    if (!hoverPreview.visible) return;
    const handleDocMouseMove = (ev: MouseEvent) => {
      const pill = hoverPillRef.current;
      if (!pill || !document.contains(pill)) {
        hoverPillRef.current = null;
        setHoverPreview(prev => (prev.visible ? { ...prev, visible: false } : prev));
        return;
      }
      const rect = pill.getBoundingClientRect();
      const tol = 2;
      const inside =
        ev.clientX >= rect.left - tol &&
        ev.clientX <= rect.right + tol &&
        ev.clientY >= rect.top - tol &&
        ev.clientY <= rect.bottom + tol;
      if (!inside) {
        hoverPillRef.current = null;
        setHoverPreview(prev => (prev.visible ? { ...prev, visible: false } : prev));
      }
    };
    document.addEventListener('mousemove', handleDocMouseMove);
    return () => document.removeEventListener('mousemove', handleDocMouseMove);
  }, [hoverPreview.visible]);

  // 过滤人物列表
  // 按名称去重：同名角色可能因同步/历史数据存在多条（id 不同），会导致下拉出现同名空白项。
  // 优先保留有图片的条目（插入的 character-id 指向有图数据），其余保留先出现的
  const filteredChars = (() => {
    const matched = characters.filter((c) =>
      c.name.toLowerCase().includes(filter.toLowerCase())
    );
    const hasImage = (c: (typeof matched)[number]) =>
      !!(
        c.avatarImages?.some((img: { assetId?: string; imageUrl?: string }) => img?.assetId || img?.imageUrl) ||
        c.multiViewImages?.some((img: { assetId?: string; imageUrl?: string }) => img?.assetId || img?.imageUrl) ||
        c.fullBodyImages?.some((img: { assetId?: string; imageUrl?: string }) => img?.assetId || img?.imageUrl)
      );
    const byName = new Map<string, (typeof matched)[number]>();
    for (const c of matched) {
      const existing = byName.get(c.name);
      if (!existing || (!hasImage(existing) && hasImage(c))) {
        byName.set(c.name, c);
      }
    }
    return Array.from(byName.values());
  })();

  // 过滤场景列表（含名称匹配；片段衍生场景 isDerived 不在联想下拉显示，避免误插入）
  // 按名称去重：同名场景可能因同步/历史数据存在多条（id 不同），会导致下拉出现同名空白项。
  // 优先保留有场景图的条目（插入的 scene-id 指向有图数据），其余保留先出现的
  const filteredScenes = (() => {
    const matched = scenes.filter((s) =>
      !s.isDerived && s.name.toLowerCase().includes(filter.toLowerCase())
    );
    const hasImage = (s: any) =>
      !!(s.imageAssetIds?.length || s.imageUrls?.[0] || s.imageUrl);
    const byName = new Map<string, (typeof matched)[number]>();
    for (const s of matched) {
      const existing = byName.get(s.name);
      if (!existing || (!hasImage(existing) && hasImage(s))) {
        byName.set(s.name, s);
      }
    }
    return Array.from(byName.values());
  })();

  // 过滤参考附件列表（按显示名/文件名匹配）
  const filteredAssets = (referenceAssets || []).filter((a) => {
    const kw = filter.toLowerCase();
    return (
      refAssetDisplayName(referenceAssets || [], a).toLowerCase().includes(kw) ||
      (a.name || '').toLowerCase().includes(kw)
    );
  });

  // 构建用于 editor 内部显示的 HTML
  const buildDisplayHtml = useCallback(function buildDisplayHtmlImpl(val: string): string {
    if (!val) return '';

    // 纯文本片段转义：先清理残留的孤立 HTML 标签，再转义
    const escapeText = (text: string): string =>
      text
        .replace(/<\/?(?:scene|role|portrait|ref|img)[^>]*>/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

    let html = '';
    let lastIndex = 0;

    // 改进的正则表达式，使用非贪婪匹配，并允许标签内容中包含其他标签
    // 兼容有属性/无属性，以及 @<scene> 这种异常前缀格式
    // 关键修复：兼容后端 prompt 模板中的中文方括号标记 【形象照:xxx】、
    // 【角色:xxx】、【场景:xxx】，否则这些标记会作为纯文本原样显示，无法 hover 预览。
    // !<ref> 为参考附件标签（分镜编辑弹窗上传的图片/视频/音频附件）
    const regex = /(@<role(?:\s+[^>]*)?>[\s\S]*?<\/role>|[@#]<scene(?:\s+[^>]*)?>[\s\S]*?<\/scene>|@<portrait(?:\s+[^>]*)?>[\s\S]*?<\/portrait>|!<ref(?:\s+[^>]*)?>[\s\S]*?<\/ref>|【形象照:[^】]+】|【角色:[^】]+】|【场景:[^】]+】)/g;
    let match;

    while ((match = regex.exec(val)) !== null) {
      // 匹配前的文本
      if (match.index > lastIndex) {
        html += `<span>${escapeText(val.substring(lastIndex, match.index))}</span>`;
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

        // 关键修复：原正则 `([^<]*)` 在内部 <img> 处截断导致 name 为空，
        // 触发降级文本展示，把 <role> 当作自定义元素保留。
        // 改为：先去掉 <img> 标签，再提取 </role> 前的纯文本作为名字。
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
          const char = characters.find((c) => c.name === name);
          entityId = char?.id || '';
        }

        // 提取图片URL
        const imgMatch = tagContent.match(/<img[^>]*src="([^"]*)"/);
        const imgSrc = imgMatch ? imgMatch[1] : '';

        if (name && entityId) {
          const char = characters.find((c) => c.id === entityId);
          imageUrl = imgSrc || getCharImage(char);
        }
      } else if (tagContent.startsWith('#<scene') || tagContent.startsWith('@<scene')) {
        tagType = 'scene';
        // 提取 scene-id
        const idMatch = tagContent.match(/scene-id="([^"]+)"/);
        entityId = idMatch ? idMatch[1] : '';

        // 关键修复：同上，容忍内部 <img> 嵌套
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
          const scene = scenes.find((s) => s.id === entityId);
          imageUrl = imgSrc || getSceneImage(scene);
        }
      } else if (tagContent.startsWith('@<portrait')) {
        tagType = 'portrait';
        const idMatch = tagContent.match(/character-id="([^"]+)"/);
        entityId = idMatch ? idMatch[1] : '';
        const idxMatch = tagContent.match(/portrait-index="([^"]+)"/);
        portraitIndex = idxMatch ? idxMatch[1] : '';

        // 关键修复：同上，容忍内部 <img> 嵌套
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
          for (const c of characters) {
            const portraits = getPortraits(c);
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
          const char = characters.find((c) => c.id === entityId);
          const portraits = getPortraits(char);
          const portrait = portraits[parseInt(portraitIndex, 10)];
          imageUrl = imgSrc || getPortraitImage(portrait);
        }
        // 关键修复：形象照精确定位无图时（独立形象照 character 图在 avatar、或 assetId 未解析），
        // 按 name 全局回查其它角色的形象照，再回退到该 character 的任意可用图片
        if (!imageUrl && name) {
          for (const c of characters) {
            const matched = getPortraits(c).find(
              (p: any) => p?.name === name && p?.imageUrl,
            );
            if (matched?.imageUrl) {
              imageUrl = matched.imageUrl;
              break;
            }
          }
          if (!imageUrl && entityId) {
            const char = characters.find((c) => c.id === entityId);
            if (char) imageUrl = getCharImage(char);
          }
        }
      } else if (tagContent.startsWith('【形象照:')) {
        // 关键修复：后端 prompt 模板输出【形象照:xxx】中文方括号标记
        tagType = 'portrait';
        const inner = tagContent.replace(/^【形象照:/, '').replace(/】$/, '').trim();

        // 如果内部是混合/嵌套标签（非简单的 @<portrait>），递归渲染内部
        if (inner.includes('<') && !inner.startsWith('@<portrait')) {
          html += buildDisplayHtmlImpl(inner);
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

        if (!isValidName(name)) name = '';
        for (const c of characters) {
          const portraits = getPortraits(c);
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
          html += buildDisplayHtmlImpl(inner);
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

        if (!isValidName(name)) name = '';
        const char = characters.find((c) => c.name === name);
        if (char) {
          entityId = char.id;
          imageUrl = getCharImage(char);
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
      } else if (tagContent.startsWith('【场景:')) {
        // 关键修复：后端 prompt 模板输出【场景:名称】中文方括号标记
        tagType = 'scene';
        const inner = tagContent.replace(/^【场景:/, '').replace(/】$/, '').trim();

        // 如果内部是混合/嵌套标签（非简单的 #<scene>/@<scene>），递归渲染内部
        if (inner.includes('<') && !inner.startsWith('#<scene') && !inner.startsWith('@<scene')) {
          html += buildDisplayHtmlImpl(inner);
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

        if (!isValidName(name)) name = '';
        const scene = scenes.find((s) => s.name === name);
        if (scene) {
          entityId = scene.id;
          imageUrl = getSceneImage(scene);
        }
      }

      if (tagType === 'role' && name) {
        const imgHtml = imageUrl
          ? `<img src="${imageUrl}" class="w-5 h-5 rounded-full object-cover border border-accent-primary/30" onerror="this.style.display='none'">`
          : `<div class="w-5 h-5 rounded-full bg-accent-primary/30 flex items-center justify-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`;
        const char = characters.find((c) => c.id === entityId);
        // 自定义音色（上传/资产库拖入）用 data-tts-custom-url 携带音频地址
        const customVoiceUrl = char
          ? (char.characterAudios?.find((a: { audioType: string; cosUrl?: string }) => a.audioType === 'vocal')?.cosUrl || char.voiceUrl || '')
          : '';
        const speakerBtnInner =
          `<svg class="tts-speaker-play" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
           <svg class="tts-speaker-stop" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>`;
        const speakerHtml = customVoiceUrl
            ? `<span class="tts-speaker-btn inline-flex items-center justify-center ml-0.5 w-4 h-4 rounded-full bg-accent-primary/40 hover:bg-accent-primary/70 cursor-pointer transition-colors" data-tts-custom-url="${encodeURIComponent(customVoiceUrl)}" title="播放自定义音色">${speakerBtnInner}</span>`
            : '';
        html += `<span contenteditable="false" data-role-tag="true" data-character-id="${entityId}" data-name="${name}" data-image="${imageUrl}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-accent-primary/20 border border-accent-primary/40 rounded-full text-accent-primary text-sm select-none">${imgHtml} <span class="font-medium">${name}</span>${speakerHtml}</span><span>​</span>`;
      } else if (tagType === 'scene' && name) {
        const imgHtml = imageUrl
          ? `<img src="${imageUrl}" class="h-auto rounded object-contain border border-emerald-500/30" style="width:${sceneImageWidth}px" onerror="this.style.display='none'">`
          : `<div class="h-auto min-h-[16px] rounded bg-emerald-500/30 flex items-center justify-center" style="width:${sceneImageWidth}px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></div>`;
        html += `<span contenteditable="false" data-scene-tag="true" data-scene-id="${entityId}" data-name="${name}" data-image="${imageUrl}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-emerald-500/20 border border-emerald-500/40 rounded text-emerald-400 text-sm select-none">${imgHtml} <span class="font-medium">${name}</span></span><span>​</span>`;
      } else if (tagType === 'portrait' && name) {
        const imgHtml = imageUrl
          ? `<img src="${imageUrl}" class="w-5 h-5 rounded-full object-cover border border-purple-500/30" onerror="this.style.display='none'">`
          : `<div class="w-5 h-5 rounded-full bg-purple-500/30 flex items-center justify-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`;
        html += `<span contenteditable="false" data-portrait-tag="true" data-character-id="${entityId}" data-portrait-index="${portraitIndex}" data-name="${name}" data-image="${imageUrl}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-purple-500/20 border border-purple-500/40 rounded-full text-purple-400 text-sm select-none">${imgHtml} <span class="font-medium">${name}</span></span><span>​</span>`;
      } else if (tagType === 'asset' && name) {
        html += `${buildRefAssetPillHtml(entityId, assetType, name)}<span>​</span>`;
      } else {
        // 如果无法解析标签（名字为空/仅为 #/@ 等异常情况），降级为纯文本展示
        // 注意：必须把原始 tagContent 当文本转义，避免内嵌 <img> 当作真实 HTML 渲染
        html += `<span>${escapeText(tagContent)}</span>`;
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < val.length) {
      html += `<span>${escapeText(val.substring(lastIndex))}</span>`;
    }

    return html;
  }, [characters, scenes, sceneImageWidth]);

  // 同步编辑器内容（仅外部变化时）
  const syncEditor = useCallback(() => {
    if (!editorRef.current) return;
    const newHtml = buildDisplayHtml(value);
    if (editorRef.current.innerHTML !== newHtml) {
      editorRef.current.innerHTML = newHtml;
    }
    lastValueRef.current = value;
  }, [value, buildDisplayHtml]);

  // 挂载时同步一次
  useEffect(() => {
    syncEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当外部 value 变化时同步（比较 lastValueRef 来避免覆盖内部编辑状态）
  useEffect(() => {
    if (value !== lastValueRef.current) {
      syncEditor();
    }
  }, [value, syncEditor]);

  const toggleSpeakerIcons = (btn: HTMLElement, playing: boolean) => {
    const playSvg = btn.querySelector('.tts-speaker-play') as SVGElement | null;
    const stopSvg = btn.querySelector('.tts-speaker-stop') as SVGElement | null;
    if (playSvg) playSvg.style.display = playing ? 'none' : '';
    if (stopSvg) stopSvg.style.display = playing ? '' : 'none';
  };

  const stopPlayingAudio = () => {
    const cur = playingAudioRef.current;
    if (cur) {
      cur.audio.pause();
      URL.revokeObjectURL(cur.audio.src);
      toggleSpeakerIcons(cur.btn, false);
      playingAudioRef.current = null;
    }
  };

  // 检查光标位置是否位于 @/# 触发器后面且未形成完整标记，自动弹出下拉框
  const checkCursorTrigger = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setShowDropdown(false);
      return;
    }

    const node = sel.anchorNode;
    if (!node) {
      setShowDropdown(false);
      return;
    }

    // 光标在不可编辑的 pill 内部 → 不触发
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = (node as Text).parentElement;
      if (parent && (parent.closest('[data-role-tag]') || parent.closest('[data-scene-tag]') || parent.closest('[data-portrait-tag]') || parent.closest('[data-asset-tag]'))) {
        setShowDropdown(false);
        return;
      }
    }

    if (node.nodeType !== Node.TEXT_NODE) {
      setShowDropdown(false);
      return;
    }

    const text = node.textContent || '';
    const offset = sel.anchorOffset;
    const before = text.substring(0, offset);

    const lastAt = before.lastIndexOf('@');
    const lastHash = before.lastIndexOf('#');
    // 仅当传入 referenceAssets 时 ! 才是触发符
    const lastBang = assetTriggerKey === '!' && referenceAssets ? before.lastIndexOf('!') : -1;

    if (lastAt === -1 && lastHash === -1 && lastBang === -1) {
      setShowDropdown(false);
      return;
    }

    const lastTrigger = Math.max(lastAt, lastHash, lastBang);
    const trigger = text[lastTrigger];
    const after = text.substring(lastTrigger + 1, offset);

    // 触发符与光标之间有空白字符，或已出现标记起始符 <，则关闭
    if (after.includes(' ') || after.includes('\n') || after.includes('<')) {
      setShowDropdown(false);
      return;
    }

    const mode = trigger === '@' ? (assetTriggerKey === '@' && referenceAssets && referenceAssets.length ? 'role_asset' : 'role') : trigger === '!' ? 'asset' : 'scene';
    // 如果 after 不匹配任何角色/场景/附件名，回退显示全部选项，避免下拉框为空
    const kw = after.toLowerCase();
    const hasMatch =
      mode === 'asset'
        ? (referenceAssets || []).some(
            (a) =>
              refAssetDisplayName(referenceAssets || [], a).toLowerCase().includes(kw) ||
              (a.name || '').toLowerCase().includes(kw),
          )
        : mode === 'role_asset'
          ? (referenceAssets || []).some(
              (a) =>
                refAssetDisplayName(referenceAssets || [], a).toLowerCase().includes(kw) ||
                (a.name || '').toLowerCase().includes(kw),
            ) || characters.some((item: any) => item.name.toLowerCase().includes(kw))
          : (mode === 'role' ? characters : scenes).some((item: any) =>
              item.name.toLowerCase().includes(kw),
            );

    setDropdownMode(mode);
    setFilter(hasMatch ? after : '');
    setShowDropdown(true);
    requestAnimationFrame(updateDropdownPosition);
  };

  // 处理编辑器点击（播放音色 + 光标触发检测）
  const handleEditorClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    const target = e.target as HTMLElement;
    // 音色播放按钮点击
    const speakerBtn = target.closest('.tts-speaker-btn') as HTMLElement | null;
    if (speakerBtn) {
      e.preventDefault();
      e.stopPropagation();

      // 如果正在播放，点击停止
      const cur = playingAudioRef.current;
      if (cur && cur.btn === speakerBtn) {
        stopPlayingAudio();
        return;
      }
      // 如果有其他音频在播放，先停止
      if (cur) stopPlayingAudio();

      const customUrl = speakerBtn.getAttribute('data-tts-custom-url');
      if (customUrl) {
        // 自定义音色：直接播放音频地址（无需鉴权）
        const audioUrl = decodeURIComponent(customUrl);
        const audio = new Audio(audioUrl);
        const onEnded = () => {
          toggleSpeakerIcons(speakerBtn, false);
          playingAudioRef.current = null;
        };
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('error', onEnded);
        toggleSpeakerIcons(speakerBtn, true);
        playingAudioRef.current = { audio, btn: speakerBtn };
        audio.play().catch(() => {
          toggleSpeakerIcons(speakerBtn, false);
          playingAudioRef.current = null;
        });
        return;
      }
      return;
    }
    // 点击标签不再删除，保留标签功能
    // 检测光标是否在 @/# 触发器后面
    checkCursorTrigger();
  };

  // 处理输入
  const handleInput = () => {
    if (readOnly) return;
    if (!editorRef.current) return;

    const extractHtml = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent || '').replace(/\u200B/g, '');
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.getAttribute('data-role-tag') === 'true') {
          const name = el.getAttribute('data-name') || '';
          const charId = el.getAttribute('data-character-id') || '';
          if (!charId) return name;
          return `@<role character-id="${charId}">${name}</role>`;
        }
        if (el.getAttribute('data-scene-tag') === 'true') {
          const name = el.getAttribute('data-name') || '';
          const sceneId = el.getAttribute('data-scene-id') || '';
          if (!sceneId) return name;
          return `#<scene scene-id="${sceneId}">${name}</scene>`;
        }
        if (el.getAttribute('data-portrait-tag') === 'true') {
          const name = el.getAttribute('data-name') || '';
          const charId = el.getAttribute('data-character-id') || '';
          if (!charId) return name;
          const portraitIdx = el.getAttribute('data-portrait-index') || '';
          const idxAttr = portraitIdx ? ` portrait-index="${portraitIdx}"` : '';
          return `@<portrait character-id="${charId}"${idxAttr}>${name}</portrait>`;
        }
        if (el.getAttribute('data-asset-tag') === 'true') {
          const name = el.getAttribute('data-name') || '';
          const url = el.getAttribute('data-url') || '';
          if (!url) return name;
          const assetType = el.getAttribute('data-asset-type') || 'image';
          return `!<ref url="${url}" type="${assetType}">${name}</ref>`;
        }
        if (el.tagName === 'BR') {
          return '\n';
        }
        if (el.tagName === 'DIV' || el.tagName === 'P') {
          // 递归处理子节点
          let inner = '';
          el.childNodes.forEach((child) => {
            inner += extractHtml(child);
          });
          return '\n' + inner;
        }
        // 其他标签（如 span）递归处理子节点
        let inner = '';
        el.childNodes.forEach((child) => {
          inner += extractHtml(child);
        });
        return inner;
      }
      return '';
    };

    let html = '';
    editorRef.current.childNodes.forEach((node) => {
      html += extractHtml(node);
    });

    onChange(html);
    lastValueRef.current = html;
  };

  // 计算光标位置（相对于容器）
  const updateDropdownPosition = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    setDropdownPos({
      left: rect.left - containerRect.left,
      top: rect.bottom - containerRect.top + 4,
    });
  };

  // keydown 检测 @ / # / !（在 keyup 之前，Shift 修饰键仍然有效，更可靠）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    if (isComposingRef.current) return;
    if (e.key === '@') {
      // assetTriggerKey='@' 且有参考附件时，@ 同时引用角色与参考附件
      setDropdownMode(assetTriggerKey === '@' && referenceAssets && referenceAssets.length ? 'role_asset' : 'role');
      setFilter('');
      setShowDropdown(true);
      requestAnimationFrame(updateDropdownPosition);
    } else if (e.key === '#') {
      setDropdownMode('scene');
      setFilter('');
      setShowDropdown(true);
      requestAnimationFrame(updateDropdownPosition);
    } else if (e.key === '!' && assetTriggerKey === '!' && referenceAssets) {
      setDropdownMode('asset');
      setFilter('');
      setShowDropdown(true);
      requestAnimationFrame(updateDropdownPosition);
    }
  };

  // beforeinput 拦截中文全角 ！：自动替换为英文 ! 并触发参考附件面板
  // （IME 提交全角字符时 keydown 不可靠，beforeinput 的 data 才是最终字符，直接输入/IME 两条路径都能覆盖）
  const handleBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    if (readOnly || assetTriggerKey !== '!' || !referenceAssets) return;
    const data = (e.nativeEvent as InputEvent).data;
    if (data === '！') {
      e.preventDefault();
      // insertText 会触发 input 事件，驱动 handleInput 同步 value
      document.execCommand('insertText', false, '!');
      setDropdownMode('asset');
      setFilter('');
      setShowDropdown(true);
      requestAnimationFrame(updateDropdownPosition);
    }
  };

  // keyup 处理过滤、关闭和光标移动触发
  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    if (isComposingRef.current) return;

    // 方向键/ Home / End 移动光标后，检查是否落在 @/# 触发器后面
    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)
    ) {
      checkCursorTrigger();
      return;
    }

    // @ / # / ! 已在 keydown 中处理，此处跳过
    if (e.key === '@' || e.key === '#' || e.key === '!') return;
    if (!showDropdownRef.current) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const node = sel.anchorNode;
    const text = node?.textContent || '';
    const trigger = dropdownMode === 'role' || dropdownMode === 'role_asset' ? '@' : dropdownMode === 'asset' ? '!' : '#';
    const triggerIndex = text.lastIndexOf(trigger);

    if (triggerIndex !== -1) {
      const after = text.substring(triggerIndex + 1);
      if (after.includes(' ') || after.includes('\n')) {
        setShowDropdown(false);
      } else {
        const kw = after.toLowerCase();
        const hasMatch =
          dropdownMode === 'asset'
            ? (referenceAssets || []).some(
                (a) =>
                  refAssetDisplayName(referenceAssets || [], a).toLowerCase().includes(kw) ||
                  (a.name || '').toLowerCase().includes(kw),
              )
            : dropdownMode === 'role_asset'
              ? (referenceAssets || []).some(
                  (a) =>
                    refAssetDisplayName(referenceAssets || [], a).toLowerCase().includes(kw) ||
                    (a.name || '').toLowerCase().includes(kw),
                ) || characters.some((item: any) => item.name.toLowerCase().includes(kw))
              : (dropdownMode === 'role' ? characters : scenes).some((item: any) =>
                  item.name.toLowerCase().includes(kw),
                );
        setFilter(hasMatch ? after : '');
        requestAnimationFrame(updateDropdownPosition);
      }
    }
  };

  // 插入标签（asset 类型时 entityId 传附件 url，assetType 传 image/video/audio）
  const insertTag = (type: 'role' | 'scene' | 'portrait' | 'asset', name: string, imageUrl: string, entityId: string, portraitIndex?: number, assetType?: string) => {
    try {
      const editor = editorRef.current;
      if (!editor) return;

      // 保存当前选区，防止 focus 导致位置丢失
      let savedRange: Range | null = null;
      const oldSel = window.getSelection();
      if (oldSel && oldSel.rangeCount > 0) {
        savedRange = oldSel.getRangeAt(0).cloneRange();
      }

      editor.focus();

      const sel = window.getSelection();
      if (!sel) return;

      // 若 focus 后选区丢失，尝试恢复
      if (sel.rangeCount === 0 && savedRange) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      if (sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);
      let textNode = range.startContainer;
      let offset = range.startOffset;

      // 如果当前不在文本节点，尝试从选区起点向前找到最近的文本节点
      if (textNode.nodeType !== Node.TEXT_NODE) {
        const treeWalker = document.createTreeWalker(
          editor,
          NodeFilter.SHOW_TEXT,
          null
        );
        let candidate: Text | null = null;
        let node: Node | null;
        while ((node = treeWalker.nextNode()) !== null) {
          if (node === textNode || (textNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)) {
            candidate = node as Text;
          } else {
            break;
          }
        }
        if (candidate) {
          textNode = candidate;
          offset = candidate.textContent?.length || 0;
        } else {
          return;
        }
      }

      const text = (textNode as Text).textContent || '';
      const before = text.substring(0, offset);
      const after = text.substring(offset);
      const trigger = type === 'scene' ? '#' : type === 'asset' ? '!' : '@';
      const triggerIndex = before.lastIndexOf(trigger);

      if (triggerIndex !== -1) {
        (textNode as Text).textContent = before.substring(0, triggerIndex) + after;

        let tagHtml = '';
        if (type === 'role') {
          const imgHtml = imageUrl
            ? `<img src="${imageUrl}" class="w-5 h-5 rounded-full object-cover border border-accent-primary/30" onerror="this.style.display='none'">`
            : `<div class="w-5 h-5 rounded-full bg-accent-primary/30 flex items-center justify-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`;
          tagHtml = `<span contenteditable="false" data-role-tag="true" data-character-id="${entityId}" data-name="${name}" data-image="${imageUrl}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-accent-primary/20 border border-accent-primary/40 rounded-full text-accent-primary text-sm select-none">${imgHtml} <span class="font-medium">${name}</span></span>`;
        } else if (type === 'scene') {
          const imgHtml = imageUrl
            ? `<img src="${imageUrl}" class="h-auto rounded object-contain border border-emerald-500/30" style="width:${sceneImageWidth}px" onerror="this.style.display='none'">`
            : `<div class="h-auto min-h-[16px] rounded bg-emerald-500/30 flex items-center justify-center" style="width:${sceneImageWidth}px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></div>`;
          tagHtml = `<span contenteditable="false" data-scene-tag="true" data-scene-id="${entityId}" data-name="${name}" data-image="${imageUrl}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-emerald-500/20 border border-emerald-500/40 rounded text-emerald-400 text-sm select-none">${imgHtml} <span class="font-medium">${name}</span></span>`;
        } else if (type === 'portrait') {
          const imgHtml = imageUrl
            ? `<img src="${imageUrl}" class="w-5 h-5 rounded-full object-cover border border-purple-500/30" onerror="this.style.display='none'">`
            : `<div class="w-5 h-5 rounded-full bg-purple-500/30 flex items-center justify-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`;
          const idxAttr = portraitIndex !== undefined ? ` data-portrait-index="${portraitIndex}"` : '';
          tagHtml = `<span contenteditable="false" data-portrait-tag="true" data-character-id="${entityId}"${idxAttr} data-name="${name}" data-image="${imageUrl}" class="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-purple-500/20 border border-purple-500/40 rounded-full text-purple-400 text-sm select-none">${imgHtml} <span class="font-medium">${name}</span></span>`;
        } else if (type === 'asset') {
          tagHtml = buildRefAssetPillHtml(entityId, assetType || 'image', name);
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = tagHtml;
        const tagNode = wrapper.firstChild as Node;

        const newRange = document.createRange();
        newRange.setStart(textNode, triggerIndex);
        newRange.collapse(true);
        newRange.insertNode(tagNode);

        const space = document.createTextNode(' ');
        (tagNode as HTMLElement).after(space);

        const finalRange = document.createRange();
        finalRange.setStartAfter(space);
        finalRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(finalRange);

        handleInput();
      }
    } catch (err) {
      console.error('[VisualPromptEditor] insertTag 失败:', err);
    } finally {
      setShowDropdown(false);
    }
  };

  // 同步 showDropdownRef
  useEffect(() => {
    showDropdownRef.current = showDropdown;
  }, [showDropdown]);

  // 点击外部关闭下拉框
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const lineHeight = 24;
  const minHeight = minRows * lineHeight;
  const maxHeight = maxRows * lineHeight;
  const hasContent = !!value;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        ref={editorRef}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={handleInput}
        onBeforeInput={handleBeforeInput}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={handleEditorClick}
        onCompositionStart={() => { isComposingRef.current = true; }}
        onCompositionEnd={() => { isComposingRef.current = false; }}
        onMouseMove={(e) => {
          // 进入 pill 时显示/切换预览；离开 pill 由 document 层 mousemove 监听负责关闭。
          const target = e.target as HTMLElement;
          const tag = target.closest('[data-role-tag], [data-scene-tag], [data-portrait-tag], [data-asset-tag]') as HTMLElement | null;
          if (!tag) return;
          const imageUrl = tag.getAttribute('data-image') || '';
          if (!imageUrl) return;
          const rect = tag.getBoundingClientRect();
          let type: 'role' | 'scene' | 'portrait' = 'scene';
          if (tag.hasAttribute('data-role-tag')) type = 'role';
          else if (tag.hasAttribute('data-portrait-tag')) type = 'portrait';
          const nextX = rect.left + rect.width / 2;
          const nextY = rect.top;
          hoverPillRef.current = tag;
          setHoverPreview(prev => {
            if (prev.visible && prev.imageUrl === imageUrl && prev.x === nextX && prev.y === nextY) {
              return prev;
            }
            return { visible: true, x: nextX, y: nextY, imageUrl, type };
          });
        }}
        onMouseLeave={() => {
          hoverPillRef.current = null;
          setHoverPreview(prev => (prev.visible ? { ...prev, visible: false } : prev));
        }}
        className={`w-full h-full p-3 rounded-lg text-sm text-text-primary outline-none overflow-y-auto border bg-bg-tertiary focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary ${editorClassName}`}
        style={{
          minHeight,
          maxHeight,
          lineHeight: '1.6',
          ...style,
        }}
      />

      {!readOnly && !hasContent && (
        <div
          className="absolute top-3 left-3 text-text-muted text-sm pointer-events-none select-none"
          onClick={() => editorRef.current?.focus()}
        >
          {placeholder}
        </div>
      )}

      {!readOnly && showDropdown && (
        <VisualPromptEditorDropdown
          dropdownMode={dropdownMode}
          dropdownPos={dropdownPos}
          dropdownRef={dropdownRef}
          filteredChars={filteredChars}
          filteredScenes={filteredScenes}
          characters={characters}
          referenceAssets={referenceAssets}
          filteredAssets={filteredAssets}
          expandedCharId={expandedCharId}
          setExpandedCharId={setExpandedCharId}
          insertTag={insertTag}
        />
      )}

      <HoverImagePreview
        preview={
          hoverPreview.visible && hoverPreview.imageUrl
            ? { src: hoverPreview.imageUrl, name: '', type: hoverPreview.type, x: hoverPreview.x, y: hoverPreview.y }
            : null
        }
        placement="top"
        variant="colored"
        size="sm"
        showName={false}
      />

      {!readOnly && (
        <p className="text-xs text-text-muted mt-2">
          {hintText}
        </p>
      )}
    </div>
  );
};

export default VisualPromptEditor;
