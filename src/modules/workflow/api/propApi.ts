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
 * 道具图像生成 API
 *
 * 复用场景图生成端点（image-processing/generate），
 * 仅 assetType/promptType 语义不同：prop_image / prop。
 */
import { processImageRequest } from '@/ai/services/image-processing.service';
import type { ApiResponse } from './types';
import { useWorkflowStore } from '../stores/workflowStore';
import { useProjectStore } from '@/shared/stores/projectStore';
import type { GenerateSceneImageResponse } from './sceneApi';

function getProjectId(): string | undefined {
  return (
    useWorkflowStore.getState().currentProjectId ??
    useProjectStore.getState().currentProjectId ??
    undefined
  );
}

// 道具与角色/场景同为项目级资产（episode_number=0），跨集统一
const PROJECT_LEVEL_EPISODE_NUMBER = 0;

export type GeneratePropImageResponse = GenerateSceneImageResponse;

/** 道具单次生成的候选图数量（单卡生成与批量生成共用） */
export const PROP_NUM_IMAGES = 4;

/**
 * 构建道具图生成请求体（业务语义 body，零厂商参数）。
 */
export function buildGeneratePropImageRequestBody(
  prompt: string,
  model: string,
  numImages: number,
  globalPrompt?: string,
  aspectRatio?: string,
  preview?: boolean,
): any {
  const finalPrompt = globalPrompt ? `${globalPrompt}，${prompt}` : prompt;
  return {
    modelId: model,
    type: 'generation',
    data: {
      modelId: model,
      prompt: finalPrompt,
      promptType: 'prop',
      aspectRatio,
      numImages,
    },
    preview,
    projectType: 'drama',
    projectId: getProjectId(),
    assetType: 'prop_image',
    episodeNumber: PROJECT_LEVEL_EPISODE_NUMBER,
  };
}

/**
 * 生成道具图片(本地 AI 层:厂商参数由 adapter 构造,图片 blob 化落库)
 */
export async function generatePropImageApi(
  prompt: string,
  model: string,
  numImages: number,
  globalPrompt?: string,
  aspectRatio?: string,
  _timeout?: number,
  preview?: boolean,
): Promise<ApiResponse<GeneratePropImageResponse>> {
  const requestBody = buildGeneratePropImageRequestBody(
    prompt,
    model,
    numImages,
    globalPrompt,
    aspectRatio,
    preview,
  );

  const result = await processImageRequest(requestBody);
  return { success: true, data: result };
}

/**
 * 构建道具完整提示词：imagePrompt + 画风提示词 + 纯道具后缀。
 */
export function buildPropFullPrompt(
  prop: { imagePrompt?: string },
  artStylePromptHint?: string,
): string {
  let fullPrompt = prop.imagePrompt || '';
  if (artStylePromptHint) {
    fullPrompt = fullPrompt ? `${fullPrompt},${artStylePromptHint}` : artStylePromptHint;
  }
  return `${fullPrompt},纯道具特写,无人物,无人手,简洁纯色背景,产品级打光。画风仅作为整体色调/光影/质感参考，不改变道具本身的结构、功能形态与材质本质，严禁出现融化的时钟、漂浮的物体、不可能几何等艺术家标志性符号`;
}

// 类型补充：ApiResponse 重导出（与 sceneApi 对齐，便于调用方统一引用）
export type { ApiResponse };
