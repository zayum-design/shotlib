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
 * 提示词中 @ 引用素材的标签格式：
 * - generate: @<ref assetId="..." type="image|video|audio">名称</ref>
 * - drama 分镜: @<ref url="..." type="image|video|audio">名称</ref>
 * 正则同时匹配两种属性名，兼容新旧标签。
 */
const REF_TAG_RE = /@<ref\s+(?:url|assetId)="([^"]*)"\s+type="([^"]*)">([\s\S]*?)<\/ref>/g;

/** 剥离 ref 标签为 @名称 纯文本（用于记录卡等只读展示） */
export function stripRefTags(prompt: string): string {
  return prompt.replace(REF_TAG_RE, (_m, _id, _type, name) => `@${name}`);
}

/** 转义正则特殊字符 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 根据 assetId 删除 prompt 中对应的 @<ref assetId="..."> 标签（generate 用） */
export function removeRefTagByAssetId(prompt: string, assetId: string): string {
  const re = new RegExp(
    `[@!]<ref\\s+assetId="${escapeRegExp(assetId)}"\\s+type="[^"]*">[\\s\\S]*?<\\/ref>`,
    'g',
  );
  return prompt.replace(re, '').trim();
}

/** 根据 url 删除 prompt 中对应的 @<ref url="..."> 标签（drama 分镜用，兼容旧标签） */
export function removeRefTagByUrl(prompt: string, url: string): string {
  const re = new RegExp(
    `[@!]<ref\\s+url="${escapeRegExp(url)}"\\s+type="[^"]*">[\\s\\S]*?<\\/ref>`,
    'g',
  );
  return prompt.replace(re, '').trim();
}

/** 提交前清洗：剥离 ref 标签为纯名称（去掉 @ 和标签，避免透传到厂商 body.prompt）。 */
export function cleanPromptForSubmit(prompt: string): string {
  return prompt.replace(REF_TAG_RE, (_m, _id, _type, name) => name).trim();
}
