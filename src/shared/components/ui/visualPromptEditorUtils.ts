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

// VisualPromptEditor 工具函数：统一处理 Character / Scene / Portrait 数据兼容性
import type { ShotReferenceAsset } from '../../types';

/** 参考附件显示名：按类型在附件列表中的编号（图片1 / 视频1 / 音频1） */
export const refAssetDisplayName = (assets: ShotReferenceAsset[], asset: ShotReferenceAsset): string => {
  const label = asset.type === 'image' ? '图片' : asset.type === 'video' ? '视频' : '音频';
  const sameType = assets.filter((a) => a.type === asset.type);
  const idx = sameType.indexOf(asset);
  return `${label}${idx >= 0 ? idx + 1 : 1}`;
};

// 统一获取角色头像（兼容 Character 和 InstantCharacter）
export const getCharImage = (char: any): string => {
  return char?.avatarImages?.[char?.currentAvatarIndex || 0]?.imageUrl
    || char?.multiViewImages?.[0]?.imageUrl
    || char?.fullBodyImages?.[0]?.imageUrl
    || char?.avatar
    || '';
};

// 统一获取场景图片（兼容 Scene 和 InstantScene）
export const getSceneImage = (scene: any): string => {
  return scene?.imageUrls?.[0] || scene?.imageUrl || '';
};

// 统一获取角色形象照图片
export const getPortraitImage = (portrait: any): string => {
  return portrait?.imageUrl || '';
};

// 统一获取角色所有形象照
// 注意两种数据模型：
// - workflow Character：形象照存 fullBodyImages（isPortrait=true），多视图存 multiViewImages
// - instant InstantCharacter：形象照存 portraitImages，fullBodyImages 存全身照/多视图（isPortrait=false）
// 之前优先读 fullBodyImages，导致 instant 角色一旦有多视图，形象照列表就全部错显示为多视图
export const getPortraits = (char: any): Array<{ imageUrl: string; name: string }> => {
  if (Array.isArray(char?.portraitImages) && char.portraitImages.length > 0) {
    return char.portraitImages.filter((img: any) => img?.imageUrl);
  }
  if (Array.isArray(char?.fullBodyImages) && char.fullBodyImages.length > 0) {
    // 排除多视图/全身照（isPortrait === false），只保留形象照
    return char.fullBodyImages.filter((img: any) => img?.name && img?.imageUrl && img?.isPortrait !== false);
  }
  return [];
};

/**
 * 将 VisualPromptEditor 生成的提示词中的角色/场景/形象照/产品标签解析为纯文本。
 * 支持：
 * - XML 标签：<role>、<scene>、<portrait>、<product>（含嵌套/损坏数据时递归取最内层）
 * - 中文方括号标记：【角色:姓名】、【场景:名称】、【形象照:名称】
 */
export const parseVisualPromptToText = (prompt: string): string => {
  if (!prompt) return '';

  let result = prompt;

  // 0. 参考附件标签（! 前缀）：!<ref url="..." type="...">名称</ref> → 名称
  result = result.replace(/!<ref(?:\s+[^>]*)?>([^<]*?)<\/ref>/g, '$1');

  // 1. 循环替换最内层 XML 标签为标签内文本，从而兼容异常嵌套/损坏数据
  const innerTagRegex = /<(role|scene|portrait|product)(?:\s+[^>]*)?>([^<]*?)<\/\1>/g;
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result.replace(innerTagRegex, '$2');
  }

  // 2. 处理后端模板使用的中文方括号标记
  result = result.replace(/【(?:角色|场景|形象照):([^】]+)】/g, '$1');

  return result.trim();
};
