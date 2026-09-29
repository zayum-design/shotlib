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
 * 图像标记规范化工具函数
 * 用于处理视频生成提示中的图片占位符标记
 */

/**
 * 规范化图像标记，将各种 img 标记替换为官方格式的 [图N] 标记
 * 支持：
 * - <img src="..."> 标签 → [图N]
 * - [img1], [image1], [pic1], [photo1], [图片1] → [图1]
 */
export function normalizeImageMarkers(prompt: string): string {
  let normalized = prompt;

  // 第一步：替换<img>标签为占位符
  // 示例：@<role>陆景深<img src="a.png" width="40"></role> -> @<role>陆景深[图1]</role>
  const imgTags = normalized.match(/<img[^>]*>/gi) || [];

  // 创建图片URL到占位符的映射
  const urlToPlaceholder = new Map<string, string>();
  let placeholderIndex = 1;

  for (const imgTag of imgTags) {
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
    if (srcMatch) {
      const srcUrl = srcMatch[1];

      if (!urlToPlaceholder.has(srcUrl)) {
        urlToPlaceholder.set(srcUrl, `[图${placeholderIndex}]`);
        placeholderIndex++;
      }

      const placeholder = urlToPlaceholder.get(srcUrl);
      if (placeholder) {
        normalized = normalized.replace(imgTag, placeholder);
      } else {
        normalized = normalized.replace(imgTag, '');
      }
    } else {
      normalized = normalized.replace(imgTag, '');
    }
  }

  // 第二步：替换常见的 img 标记格式为官方格式
  normalized = normalized.replace(/\[img(\d+)\]/gi, '[图$1]');
  normalized = normalized.replace(/\[image(\d+)\]/gi, '[图$1]');
  normalized = normalized.replace(/\[pic(\d+)\]/gi, '[图$1]');
  normalized = normalized.replace(/\[photo(\d+)\]/gi, '[图$1]');
  normalized = normalized.replace(/\[图片(\d+)\]/gi, '[图$1]');

  // 第三步：清理多余的空格，但保留换行
  normalized = normalized.replace(/[ \t]+/g, ' ').trim();

  if (normalized !== prompt) {
    console.log(`[ImageMarkers] 规范化图像标记:`);
    console.log(`  原始长度: ${prompt.length} 字符`);
    console.log(`  处理后长度: ${normalized.length} 字符`);
    console.log(`  清理了 ${prompt.length - normalized.length} 个字符`);
    console.log(`  处理后: ${normalized.substring(0, 200)}...`);
    console.log(`  图片URL到占位符映射:`, Object.fromEntries(urlToPlaceholder));
  }

  return normalized;
}

/**
 * 从提示中提取唯一的占位符数字并排序
 */
export function extractPlaceholderNumbers(prompt: string): number[] {
  const matches = prompt.match(/\[图(\d+)\]/g) || [];
  const numbers = matches
    .map((match) => {
      const numMatch = match.match(/\[图(\d+)\]/);
      return numMatch ? parseInt(numMatch[1]) : 0;
    })
    .filter((num) => num > 0);
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}
