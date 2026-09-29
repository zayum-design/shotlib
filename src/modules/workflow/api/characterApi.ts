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
 * 角色图像生成 API(纯前端版)
 *
 * - 生成调用本地 AI 编排层 character-image.service(提示词组装与后端一致)
 * - 智能扩图为存根(原版依赖云厂商签名密钥,不能下发浏览器)
 * - TTS/音色能力已移除(开源版无语音服务)
 */
import type { ApiResponse } from './types';
import { useWorkflowStore } from '../stores/workflowStore';
import { useProjectStore } from '@/shared/stores/projectStore';
import {
  generateAvatar as svcGenerateAvatar,
  generateViews as svcGenerateViews,
  regenerateView as svcRegenerateView,
  generatePortrait as svcGeneratePortrait,
  outpaintView,
} from '@/ai/services/character-image.service';

function getProjectId(): string | undefined {
  // workflow 页面取 workflowStore；instant 页面不设置 workflowStore，
  // 回退到共享 projectStore 的当前项目（避免上传路径 projectId 段落为 unknown）
  return (
    useWorkflowStore.getState().currentProjectId ??
    useProjectStore.getState().currentProjectId ??
    undefined
  );
}

// ============ 请求体构造（业务语义 body）============
// generateXxxApi 与 slice triggerPreview 共用这些纯函数，保证「预览 local = 真实提交」。
// 尺寸用业务语义 aspectRatio 直传（厂商层解析 size）；avatar 固定方形不携带尺寸字段。

/**
 * 构建头像生成请求体（业务语义 body）。service 固定 2048x2048，不携带尺寸字段。
 */
export function buildGenerateAvatarRequestBody(
  avatarPrompt: string,
  model: string,
  globalPrompt?: string,
  preview?: boolean,
  async?: boolean,
  episodeNumber?: number,
  referenceAvatarUrl?: string,
): any {
  return {
    avatarPrompt,
    model,
    globalPrompt,
    preview,
    async,
    projectId: getProjectId(),
    episodeNumber,
    referenceAvatarUrl,
  };
}

/**
 * 构建角色全身照/三视图请求体（业务语义 body）。尺寸由 aspectRatio 派生。
 */
export function buildGenerateCharacterViewsRequestBody(
  model: string,
  referenceAvatarUrl: string | undefined,
  globalPrompt: string | undefined,
  imagePrompt: string | undefined,
  aspectRatio: string | undefined,
  preview?: boolean,
  async?: boolean,
  episodeNumber?: number,
): any {
  return {
    model,
    referenceAvatarUrl,
    globalPrompt,
    imagePrompt,
    aspectRatio,
    preview,
    async,
    projectId: getProjectId(),
    episodeNumber,
  };
}

/**
 * 构建重新生成单张全身照请求体（业务语义 body）。尺寸由 aspectRatio 派生。
 */
export function buildRegenerateViewRequestBody(
  index: number,
  model: string,
  globalPrompt: string | undefined,
  aspectRatio: string | undefined,
  preview?: boolean,
  async?: boolean,
  episodeNumber?: number,
): any {
  return {
    index,
    model,
    globalPrompt,
    aspectRatio,
    preview,
    async,
    projectId: getProjectId(),
    episodeNumber,
  };
}

/**
 * 构建扩图请求体（业务语义 body）。尺寸由 aspectRatio 派生。
 */
export function buildExpandCharacterViewRequestBody(
  referenceImageUrl: string,
  model: string,
  globalPrompt: string | undefined,
  expandPrompt: string | undefined,
  aspectRatio: string | undefined,
  preview?: boolean,
  async?: boolean,
  episodeNumber?: number,
): any {
  return {
    model,
    referenceImageUrl,
    globalPrompt,
    expandPrompt,
    aspectRatio,
    preview,
    async,
    projectId: getProjectId(),
    episodeNumber,
  };
}

/**
 * 构建形象照请求体（业务语义 body）。透传 request 字段并补 projectId。
 */
export function buildGenerateCharacterPortraitRequestBody(
  request: GenerateCharacterPortraitRequest & { episodeNumber?: number },
): any {
  return { ...request, projectId: getProjectId() };
}

export interface GenerateAvatarRequest {
  characterId: string;
  avatarPrompt: string;
  model?: string;
  globalPrompt?: string;
}

export interface GenerateAvatarResponse {
  avatarUrls: string[];
  avatarAssetIds?: string[];
}

/**
 * 生成角色头像(本地 AI 编排;头像为纯白背景特写,globalPrompt 不参与)
 */
export async function generateAvatarApi(
  _characterId: string,
  avatarPrompt: string,
  model: string = 'SDXL',
  _globalPrompt?: string,
  _timeout?: number,
  _preview?: boolean,
  _async?: boolean,
  episodeNumber?: number,
  referenceAvatarUrl?: string,
): Promise<ApiResponse<GenerateAvatarResponse>> {
  const data = await svcGenerateAvatar(avatarPrompt, model, {
    projectId: getProjectId(),
    episodeNumber,
    referenceAvatarUrl,
  });
  return { success: true, data };
}

export interface GenerateCharacterViewsRequest {
  views?: Array<{
    type?: string;
    prompt?: string;
  }>;  // 已废弃，保留兼容性
  model?: string;
  referenceAvatarUrl?: string;
  globalPrompt?: string;
}

export interface GenerateCharacterViewsResponse {
  fullBodyUrls: string[];  // 全身照URL（现改为1张）
  fullBodyAssetIds?: string[];
}

/**
 * 生成角色全身照(1 张人物三视图设定图;模板 FULLBODY,globalPrompt 不参与)
 */
export async function generateCharacterViewsApi(
  _characterId: string,
  model: string = 'SDXL',
  referenceAvatarUrl?: string,
  _globalPrompt?: string,
  imagePrompt?: string,
  aspectRatio?: string,
  _timeout?: number,
  _preview?: boolean,
  _async?: boolean,
  episodeNumber?: number,
): Promise<ApiResponse<GenerateCharacterViewsResponse>> {
  const data = await svcGenerateViews(model, {
    projectId: getProjectId(),
    episodeNumber,
    referenceAvatarUrl,
    imagePrompt,
    aspectRatio,
  });
  return { success: true, data };
}

export interface RegenerateViewRequest {
  index: number;
  model?: string;
  globalPrompt?: string;
}

export interface RegenerateViewResponse {
  imageUrl: string;
  imageAssetId?: string;
  index: number;
}

/**
 * 重新生成单个全身照(模板 REGENERATE 的 variation=N)
 */
export async function regenerateViewApi(
  _characterId: string,
  index: number,
  model: string = 'SDXL',
  _globalPrompt?: string,
  aspectRatio?: string,
  _preview?: boolean,
  _async?: boolean,
  episodeNumber?: number,
): Promise<ApiResponse<RegenerateViewResponse>> {
  const data = await svcRegenerateView(index, model, {
    projectId: getProjectId(),
    episodeNumber,
    aspectRatio,
  });
  return { success: true, data };
}

export interface ExpandCharacterViewRequest {
  model?: string;
  referenceImageUrl: string;
  globalPrompt?: string;
  expandPrompt?: string;
}

export interface ExpandCharacterViewResponse {
  imageUrl: string;
}

/**
 * 基于当前多视图扩图生成新的全身照(存根:依赖云厂商签名密钥,开源版不支持)
 */
export async function expandCharacterViewApi(
  _characterId: string,
  referenceImageUrl: string,
  _model: string = 'SDXL',
  _globalPrompt?: string,
  expandPrompt?: string,
  _aspectRatio?: string,
  _preview?: boolean,
  _async?: boolean,
  _episodeNumber: number = 0,
): Promise<ApiResponse<ExpandCharacterViewResponse>> {
  const result = await outpaintView(referenceImageUrl, expandPrompt);
  if (!result.success) {
    return { success: false, data: { imageUrl: '' }, message: result.error };
  }
  return { success: true, data: { imageUrl: result.imageUrl } };
}

export interface GenerateCharacterPortraitRequest {
  avatarUrl: string;
  portraitPrompt: string;
  model?: string;
  count?: number;
  globalPrompt?: string;
  aspectRatio?: string;
  preview?: boolean;
  async?: boolean;
}

export interface GenerateCharacterPortraitResponse {
  success: boolean;
  data?: {
    portraitUrls: string[];
    portraitAssetIds?: string[];
  };
  message?: string;
  error?: string;
}

/**
 * 生成短剧角色形象图（基于头像参考图;比例派生尺寸,最长边 2048）
 */
export async function generateCharacterPortraitApi(
  _characterId: string,
  request: GenerateCharacterPortraitRequest & { episodeNumber?: number },
): Promise<GenerateCharacterPortraitResponse> {
  const data = await svcGeneratePortrait(request.model || '', {
    projectId: getProjectId(),
    episodeNumber: request.episodeNumber,
    avatarUrl: request.avatarUrl,
    portraitPrompt: request.portraitPrompt,
    count: request.count,
    aspectRatio: request.aspectRatio,
  });
  return { success: true, data };
}
