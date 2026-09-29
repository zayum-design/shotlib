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
 * 角色图像编排服务(纯前端版)
 *
 * 对齐后端 drama/application/services/characters.service.ts:
 * 头像/三视图全身照/重新生成/形象照的提示词组装(模板 + 用户描述 + 用户优先注记),
 * 交给 image-processing 底座执行。数据源全部内置:
 * - PROMPTS.md(workflow 优先,instant 回退)的 ## KEY 段
 * - negative-prompts.json 反向提示词
 * - instant/CHARACTER_PORTRAIT(_NEGATIVE).md 形象照模板
 */
import promptsWorkflowRaw from '@/config/prompts/workflow/PROMPTS.md?raw';
import promptsInstantRaw from '@/config/prompts/instant/PROMPTS.md?raw';
import negativePromptsJson from '@/config/presets/negative-prompts.json';
import portraitPromptRaw from '@/config/prompts/instant/CHARACTER_PORTRAIT.md?raw';
import portraitNegativeRaw from '@/config/prompts/instant/CHARACTER_PORTRAIT_NEGATIVE.md?raw';
import { processImageRequest } from './image-processing.service';
import type { ImageProcessingRequest, ImageProcessingResponse } from './image-processing.service';

/** 用户输入优先注记(与后端 model-sdk 常量一致) */
export const IMAGE_USER_PRIORITY_NOTE = '（若以上描述存在冲突，以最后用户描述为准）';

/** 解析 PROMPTS.md 的 `## KEY` 段为键值对(workflow 优先,instant 回退) */
function parsePrompts(raw: string): Record<string, string> {
  const prompts: Record<string, string> = {};
  const lines = raw.split('\n');
  let currentKey = '';
  let currentLines: string[] = [];
  for (const line of lines) {
    const match = line.match(/^##\s+(\w+)$/);
    if (match) {
      if (currentKey) prompts[currentKey] = currentLines.join('\n').trim();
      currentKey = match[1];
      currentLines = [];
    } else if (currentKey) {
      currentLines.push(line);
    }
  }
  if (currentKey) prompts[currentKey] = currentLines.join('\n').trim();
  return prompts;
}

/** workflow 版优先,缺段回退 instant 版 */
const prompts = { ...parsePrompts(promptsInstantRaw), ...parsePrompts(promptsWorkflowRaw) };

/** 形象照模板:去 `# ` 标题行(对齐后端 loadPortraitPrompt) */
function stripTitleLines(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('# '))
    .join('\n')
    .trim();
}

const negativePrompts = negativePromptsJson as Record<string, string>;

/** 通用厂商参数(对齐后端:steps/cfgScale/随机 seed) */
function commonParams(): Record<string, unknown> {
  return {
    steps: 30,
    cfgScale: 7.5,
    seed: Math.floor(Math.random() * 1000000),
  };
}

/** 统一执行:包装 processImageRequest,空图时抛错(对齐后端行为) */
async function run(request: ImageProcessingRequest): Promise<ImageProcessingResponse> {
  const result = await processImageRequest(request);
  if (!result.images || result.images.length === 0) {
    throw new Error('图片生成失败，未返回图片');
  }
  return result;
}

export interface CharacterImageContext {
  projectId?: string;
  episodeNumber?: number;
}

/** 生成角色头像(模板 AVATAR + avatarPrompt;头像为纯白背景面部特写,不拼 globalPrompt) */
export async function generateAvatar(
  avatarPrompt: string,
  model: string,
  context: CharacterImageContext & { referenceAvatarUrl?: string },
): Promise<{ avatarUrls: string[]; avatarAssetIds: string[] }> {
  const systemPrompt = prompts['AVATAR'] || '';
  const finalPrompt = `${systemPrompt}，${avatarPrompt}${IMAGE_USER_PRIORITY_NOTE}`;
  console.log(`[CharacterImageService] 头像生成提示词: ${finalPrompt}`);

  const result = await run({
    modelId: model,
    type: 'generation',
    data: {
      modelId: model,
      prompt: finalPrompt,
      negativePrompt:
        negativePrompts.avatar ||
        '模糊, 低质量, 变形, 丑陋, 侧面, 背影, 裁切, 遮挡, 暗光, 杂乱背景, 磨皮, 过度美颜, 塑料感皮肤, 过度锐化',
      width: 2048,
      height: 2048,
      numImages: 1,
      referenceImage: context.referenceAvatarUrl,
      parameters: commonParams(),
    },
    projectType: 'drama',
    projectId: context.projectId,
    assetType: 'character_image',
    episodeNumber: context.episodeNumber,
  });

  return {
    avatarUrls: [result.images[0]],
    avatarAssetIds: result.assetIds?.[0] ? [result.assetIds[0]] : [],
  };
}

/** 生成角色全身照(1 张三视图设定图;模板 FULLBODY,不拼 globalPrompt) */
export async function generateViews(
  model: string,
  context: CharacterImageContext & {
    referenceAvatarUrl?: string;
    imagePrompt?: string;
    aspectRatio?: string;
  },
): Promise<{ fullBodyUrls: string[]; fullBodyAssetIds: string[] }> {
  const basePrompt = (prompts['FULLBODY'] || '').replace('{{variation}}', '1');
  let prompt = basePrompt;
  if (context.imagePrompt) {
    prompt = `${basePrompt}，${context.imagePrompt}${IMAGE_USER_PRIORITY_NOTE}`;
  }
  console.log(`[CharacterImageService] 三视图生成提示词: ${prompt}`);

  const result = await run({
    modelId: model,
    type: 'generation',
    data: {
      modelId: model,
      prompt,
      negativePrompt:
        negativePrompts.views ||
        'blurry, low quality, deformed, ugly, extra limbs, dislocated, cropped, partial body, close-up, portrait, different outfit, inconsistent character, airbrushed skin, plastic skin, over-beautified, over-sharpened',
      aspectRatio: context.aspectRatio,
      referenceImage: context.referenceAvatarUrl,
      numImages: 1,
      parameters: commonParams(),
    },
    projectType: 'drama',
    projectId: context.projectId,
    assetType: 'character_image',
    episodeNumber: context.episodeNumber,
  });

  return {
    fullBodyUrls: [result.images[0]],
    fullBodyAssetIds: result.assetIds?.[0] ? [result.assetIds[0]] : [],
  };
}

/** 重新生成单个全身照(模板 REGENERATE 的 variation=N) */
export async function regenerateView(
  index: number,
  model: string,
  context: CharacterImageContext & { aspectRatio?: string },
): Promise<{ imageUrl: string; imageAssetId?: string; index: number }> {
  const prompt = (prompts['REGENERATE'] || '').replace('{{variation}}', String(index + 1));
  console.log(`[CharacterImageService] 重新生成全身照提示词: ${prompt}`);

  const result = await run({
    modelId: model,
    type: 'generation',
    data: {
      modelId: model,
      prompt,
      negativePrompt:
        negativePrompts.regenerateView ||
        'blurry, low quality, deformed, ugly, extra limbs, dislocated, cropped, partial body, close-up, portrait, airbrushed skin, plastic skin, over-beautified, over-sharpened',
      aspectRatio: context.aspectRatio,
      numImages: 1,
      parameters: commonParams(),
    },
    projectType: 'drama',
    projectId: context.projectId,
    assetType: 'character_image',
    episodeNumber: context.episodeNumber,
  });

  return {
    imageUrl: result.images[0],
    imageAssetId: result.assetIds?.[0] || undefined,
    index,
  };
}

/** 生成短剧角色形象照(基于头像参考图;比例派生尺寸,最长边 2048) */
export async function generatePortrait(
  model: string,
  context: CharacterImageContext & {
    avatarUrl: string;
    portraitPrompt: string;
    count?: number;
    aspectRatio?: string;
  },
): Promise<{ portraitUrls: string[]; portraitAssetIds: string[] }> {
  const count = context.count || 1;
  const aspectRatio = context.aspectRatio || '3:4';

  // 计算图片尺寸（最长边 2048）
  const MAX_SIDE = 2048;
  const parts = aspectRatio.split(':').map(Number);
  let width = MAX_SIDE;
  let height = MAX_SIDE;
  if (parts.length === 2 && !parts.some(isNaN) && parts.every((v) => v > 0)) {
    const [w, h] = parts;
    if (w >= h) {
      width = MAX_SIDE;
      height = Math.round(MAX_SIDE * (h / w));
    } else {
      height = MAX_SIDE;
      width = Math.round(MAX_SIDE * (w / h));
    }
  }

  const systemPrompt = stripTitleLines(portraitPromptRaw);
  const finalPrompt = `${systemPrompt}，${context.portraitPrompt}${IMAGE_USER_PRIORITY_NOTE}`;
  console.log(`[CharacterImageService] 形象图生成提示词: ${finalPrompt}`);

  const result = await run({
    modelId: model,
    type: 'generation',
    data: {
      modelId: model,
      prompt: finalPrompt,
      negativePrompt: stripTitleLines(portraitNegativeRaw),
      width,
      height,
      numImages: count,
      referenceImage: context.avatarUrl,
      parameters: commonParams(),
    },
    projectType: 'drama',
    projectId: context.projectId,
    assetType: 'character_image',
    episodeNumber: context.episodeNumber,
  });

  return {
    portraitUrls: [...result.images],
    portraitAssetIds: [...(result.assetIds || [])],
  };
}

/**
 * 智能扩图(存根):原版走火山 AK/SK 签名异步任务,签名密钥不能下发浏览器,
 * 开源版不支持;请使用「重新生成」整图重出。
 */
export async function outpaintView(
  _referenceImageUrl: string,
  _expandPrompt?: string,
): Promise<{ success: boolean; imageUrl: string; error?: string }> {
  return {
    success: false,
    imageUrl: '',
    error: '开源版暂不支持智能扩图（需云厂商签名密钥），请使用「重新生成」',
  };
}
