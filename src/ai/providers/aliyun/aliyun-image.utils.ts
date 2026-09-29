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
 * 阿里云图片适配器相关纯工具函数:尺寸解析、URL 抽取、变体回退
 */

export const QWEN_FIXED_SIZES: Array<{ size: string; ratio: number }> = [
  { size: '1664*928', ratio: 1664 / 928 },
  { size: '1472*1140', ratio: 1472 / 1140 },
  { size: '1328*1328', ratio: 1 },
  { size: '1140*1472', ratio: 1140 / 1472 },
  { size: '928*1664', ratio: 928 / 1664 },
];

/**
 * 从阿里云图片接口返回的 output 结构中抽取图片 URL 列表,兼容多种历史/新格式
 */
export function extractImageUrls(output: any): string[] {
  if (!output || typeof output !== 'object') return [];
  const urls: string[] = [];

  // 标准结构:output.choices[].message.content[].image
  if (Array.isArray(output.choices)) {
    for (const choice of output.choices) {
      const contents = choice?.message?.content || [];
      if (Array.isArray(contents)) {
        for (const item of contents) {
          if (item?.image && typeof item.image === 'string')
            urls.push(item.image);
          else if (item?.url && typeof item.url === 'string')
            urls.push(item.url);
        }
      }
    }
  }

  // 兼容老接口:output.results[].url
  if (Array.isArray(output.results)) {
    for (const r of output.results) {
      if (typeof r?.url === 'string') urls.push(r.url);
    }
  }

  // 兼容 output.image_url / output.url
  if (typeof output.image_url === 'string') urls.push(output.image_url);
  if (typeof output.url === 'string') urls.push(output.url);

  return [...new Set(urls)].filter((u) => u && u.length > 0);
}

/**
 * 解析尺寸:根据模型能力选择固定预设、缩写、或自定义 WxH
 */
export function resolveSize(
  params: Record<string, any>,
  supports: Record<string, any>,
): string | undefined {
  // 优先使用显式 size 字符串
  if (typeof params.size === 'string' && params.size.length > 0) {
    return normalizeSize(params.size);
  }

  let width = Number(params.width);
  let height = Number(params.height);

  // aspectRatio 模式:按比例 + 阿里云默认 2K 档算 width/height(像素是厂商知识)
  if ((!width || !height) && typeof params.aspectRatio === 'string') {
    const dims = aspectRatioToDimensions(params.aspectRatio);
    width = dims.width;
    height = dims.height;
  }

  // 千问 Max/Plus 固定预设
  if (supports.size_fixed_only) {
    return snapToQwenFixedSize(width || 1664, height || 928);
  }

  // 支持 size_preset 的模型(如 wan2.7-image 系列)推荐 2K 缩写
  if (supports.size_preset && !width && !height) {
    return '2K';
  }

  // 默认 WxH
  if (width && height) {
    return `${width}*${height}`;
  }

  // 兜底默认值:优先使用 variant supports 中配置的 defaultSize
  if (supports.defaultSize) return supports.defaultSize;
  return '2048*2048';
}

/**
 * 比例 → 阿里云默认 2K 档像素(长边 2048)。像素是厂商知识,前端只传 aspectRatio。
 */
function aspectRatioToDimensions(aspectRatio: string): {
  width: number;
  height: number;
} {
  const parts = aspectRatio.split(':').map(Number);
  const aw = parts[0] > 0 ? parts[0] : 16;
  const ah = parts[1] > 0 ? parts[1] : 9;
  const longSide = 2048;
  if (aw >= ah) {
    return { width: longSide, height: Math.round((longSide * ah) / aw) };
  }
  return { width: Math.round((longSide * aw) / ah), height: longSide };
}

/**
 * 千问 Max/Plus 固定尺寸适配:根据宽高比挑选最接近的预设
 */
export function snapToQwenFixedSize(width: number, height: number): string {
  if (!width || !height) return QWEN_FIXED_SIZES[0].size;
  const target = width / height;
  let best = QWEN_FIXED_SIZES[0];
  let minDiff = Math.abs(target - best.ratio);
  for (const s of QWEN_FIXED_SIZES.slice(1)) {
    const diff = Math.abs(target - s.ratio);
    if (diff < minDiff) {
      minDiff = diff;
      best = s;
    }
  }
  return best.size;
}

/**
 * 规范化用户传入的 size 字符串
 * 允许 "1024x1024" / "1024*1024" / "1K" / "2K" / "4K"
 */
export function normalizeSize(size: string): string {
  const upper = size.trim().toUpperCase();
  if (['1K', '2K', '4K'].includes(upper)) return upper;
  return size.replace(/x/i, '*');
}

/**
 * 兼容前端传入聚合 modelId(aliyun),自动取首个变体;
 * 传入合法变体 id 时原样返回
 */
export function resolveActualModelId(
  modelId: string,
  variants: Array<{ id: string }> | undefined,
  fallback = 'qwen-image',
): string {
  if (modelId && variants?.some((v) => v.id === modelId)) {
    return modelId;
  }
  return variants?.[0]?.id || fallback;
}
