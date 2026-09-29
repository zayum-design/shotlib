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
 * 场景图像生成 API(纯前端版)
 *
 * - 生成调用本地 AI 层 image-processing(厂商参数由 adapter 构造,图片 blob 化落库)
 * - 场景预制(向导配置/随机灵感)读取内置 scene-presets.json
 * - AI 提示词生成(场景/形象/片段)调用本地文本模型
 */
import scenePresetsJson from '@/config/presets/instant/scene-presets.json';
import { processImageRequest } from '@/ai/services/image-processing.service';
import { generateCleanText } from '@/ai/services/text-processing.service';
import type { ApiResponse } from './types';
import { useWorkflowStore } from '../stores/workflowStore';
import { useProjectStore } from '@/shared/stores/projectStore';

function getProjectId(): string | undefined {
  // workflow 页面取 workflowStore；instant 页面不设置 workflowStore，
  // 回退到共享 projectStore 的当前项目（避免上传路径 projectId 段落为 unknown）
  return (
    useWorkflowStore.getState().currentProjectId ??
    useProjectStore.getState().currentProjectId ??
    undefined
  );
}

function getEpisodeNumber(): number {
  return useWorkflowStore.getState().currentEpisodeNumber ?? 1;
}

/**
 * 关键修复：场景图属于项目级资产（episode_number=0），
 * 跨集统一。任何调用 scene 图像 API 的地方都应使用 0。
 * 这里直接覆盖默认的当前分集号。
 */
function getProjectLevelEpisodeNumber(): number {
  return 0;
}

export interface GenerateSceneImageRequest {
  prompt: string;
  model?: string;
  numImages?: number;
}

// 与后端ImageProcessingResponse保持一致
export interface GenerateSceneImageResponse {
  images: string[];
  assetIds?: string[];
  modelId: string;
  type: string;
  processingTime: number;
  prompt?: string;
  metadata?: Record<string, any>;
}

// 场景视角配置
export const SCENE_VIEWS = [
  { name: '正面', angle: 'front', description: '正前方视角，展示场景的正面全貌' },
  { name: '左侧', angle: 'left', description: '正左方视角，从场景左侧90度角展示' },
  { name: '右侧', angle: 'right', description: '正右方视角，从场景右侧90度角展示' },
  { name: '背面', angle: 'back', description: '正后方视角，从场景背面180度展示' },
];

/**
 * 构建场景完整提示词：imagePrompt + 画风提示词 + 纯场景后缀。
 * scene slice（regenerateSceneImage / generateSceneImages）与 batch slice（batchGenerateScenes）共用，
 * 保证批量预览 prompt 与单张提交 prompt 一致。
 */
export function buildSceneFullPrompt(
  scene: { imagePrompt?: string },
  artStylePromptHint?: string,
): string {
  let fullPrompt = scene.imagePrompt || '';
  if (artStylePromptHint) {
    fullPrompt = fullPrompt ? `${fullPrompt},${artStylePromptHint}` : artStylePromptHint;
  }
  return `${fullPrompt},纯场景画面,无人物,无角色,空镜头,环境特写。画风仅作为整体色调/光影/质感参考，不改变场景本身的结构、空间关系与物体形态，严禁出现融化的时钟、漂浮的物体、不可能几何等艺术家标志性符号`;
}

/**
 * 构建场景图生成请求体（业务语义 body，零厂商参数）。
 * generateSceneImageApi 与预览 triggerPreview 共用此函数，保证预览 local = 真实提交。
 * 厂商参数（size/seed/steps/cfgScale/negativePrompt 等）全部由厂商 adapter 构造。
 */
export function buildGenerateSceneImageRequestBody(
  prompt: string,
  model: string,
  numImages: number,
  globalPrompt?: string,
  aspectRatio?: string,
  referenceImages?: string[],
  sceneMultiView?: boolean,
  preview?: boolean,
): any {
  const finalPrompt = globalPrompt ? `${globalPrompt}，${prompt}` : prompt;
  return {
    modelId: model,
    type: 'generation',
    data: {
      modelId: model,
      prompt: finalPrompt,
      promptType: 'scene',
      aspectRatio,
      numImages,
      sceneMultiView: !!sceneMultiView,
      referenceImages,
    },
    preview,
    projectType: 'drama',
    projectId: getProjectId(),
    assetType: 'scene_image',
    episodeNumber: getProjectLevelEpisodeNumber(),
  };
}

/**
 * 构建场景视角图请求体（业务语义 body，零厂商参数）。
 * generateSceneViewApi 与预览 triggerPreview 共用此函数。
 */
export function buildGenerateSceneViewRequestBody(
  prompt: string,
  model: string,
  viewIndex: number,
  referenceImageUrl?: string,
  globalPrompt?: string,
  aspectRatio?: string,
  preview?: boolean,
): any {
  const view = SCENE_VIEWS[viewIndex];
  const basePrompt = globalPrompt ? `${globalPrompt}，${prompt}` : prompt;
  const viewPrompt = `【${view?.name ?? ''}视角】${view?.description ?? ''}。${referenceImageUrl ? '必须严格保持与参考图片一致的场景元素、风格、光照、色调。' : ''}\n\n${basePrompt}`;
  return {
    modelId: model,
    type: 'generation',
    data: {
      modelId: model,
      prompt: viewPrompt,
      promptType: 'scene',
      aspectRatio,
      numImages: 1,
      referenceImage: referenceImageUrl,
      viewAngle: view?.angle,
      viewIndex,
    },
    preview,
    projectType: 'drama',
    projectId: getProjectId(),
    assetType: 'scene_image',
    episodeNumber: getProjectLevelEpisodeNumber(),
  };
}

/**
 * 生成场景图片（支持多视角链式生成;开源版恒为同步调用,无 async/jobId 分支）
 */
export async function generateSceneImageApi(
  prompt: string,
  model: string = 'SDXL',
  numImages: number = 4,
  globalPrompt?: string,
  aspectRatio?: string,
  _timeout?: number,
  preview?: boolean,
  _async?: boolean,
  referenceImages?: string[],
  sceneMultiView?: boolean,
): Promise<ApiResponse<GenerateSceneImageResponse>> {
  // 多视角生成模式：由调用方根据模型配置中的 sequential_image_generation 能力传入
  const isMultiViewMode = numImages > 1 && !!sceneMultiView;
  void isMultiViewMode;

  // 业务语义 body（零厂商参数），与预览 triggerPreview 共用同一构造
  const requestBody = buildGenerateSceneImageRequestBody(
    prompt,
    model,
    numImages,
    globalPrompt,
    aspectRatio,
    referenceImages,
    sceneMultiView,
    preview,
  );

  const result = await processImageRequest(requestBody);
  return { success: true, data: result };
}

/**
 * 生成单个场景视角图片（用于重新生成特定视角）
 */
export async function generateSceneViewApi(
  prompt: string,
  model: string,
  viewIndex: number,
  referenceImageUrl?: string,
  globalPrompt?: string,
  aspectRatio?: string,
  preview?: boolean,
  _async?: boolean,
): Promise<ApiResponse<GenerateSceneImageResponse>> {
  const view = SCENE_VIEWS[viewIndex];
  if (!view) {
    throw new Error(`无效的视角索引: ${viewIndex}`);
  }

  // 业务语义 body（零厂商参数），与预览 triggerPreview 共用同一构造
  const requestBody = buildGenerateSceneViewRequestBody(
    prompt,
    model,
    viewIndex,
    referenceImageUrl,
    globalPrompt,
    aspectRatio,
    preview,
  );

  const result = await processImageRequest(requestBody);
  return { success: true, data: result };
}

// ============ 场景预制数据（instant）============
// 数据源：src/config/presets/instant/scene-presets.json(内置)

// 属性向导单步选项
export interface SceneStepOption {
  title: string;
  options: string[];
}

// 场景预制项：名称 + 提示词
export interface ScenePresetItem {
  name: string;
  prompt: string;
}

// 冲突规则：[触发步骤索引, 触发值, 被影响步骤索引, 被排除值]
export type SceneConflictRule = [number, string, number, string];

// 完整预制库结构
interface ScenePresetLibrary {
  stepOptions: SceneStepOption[];
  optionsByType: Record<string, Record<string, string[]>>;
  conflictRules: SceneConflictRule[];
  presets: Record<string, ScenePresetItem[]>;
}

const presetLibrary = scenePresetsJson as unknown as ScenePresetLibrary;

// 场景属性向导配置
export interface ScenePresetConfig {
  stepOptions: SceneStepOption[];
  optionsByType: Record<string, Record<string, string[]>>;
  conflictRules: SceneConflictRule[];
}

/**
 * 获取场景属性向导配置（步骤选项 / 按类型选项 / 冲突规则;内置 JSON）
 */
export async function getScenePresetConfig(): Promise<{
  success: boolean;
  data: ScenePresetConfig;
  message?: string;
}> {
  return {
    success: true,
    data: {
      stepOptions: presetLibrary.stepOptions || [],
      optionsByType: presetLibrary.optionsByType || {},
      conflictRules: presetLibrary.conflictRules || [],
    },
  };
}

/**
 * 随机获取一条场景预制（名称 + 提示词），可按场景类型过滤(内置 JSON)
 */
export async function getRandomScenePreset(
  type?: string,
): Promise<{ success: boolean; data: ScenePresetItem; message?: string }> {
  const presets = presetLibrary.presets || {};
  const pool: ScenePresetItem[] =
    type && presets[type] ? presets[type] : Object.values(presets).flat();
  if (!pool.length) {
    return { success: false, data: { name: '', prompt: '' }, message: '场景灵感库为空' };
  }
  const item = pool[Math.floor(Math.random() * pool.length)];
  return { success: true, data: { name: item.name, prompt: item.prompt } };
}

// ============ AI 提示词生成(本地文本模型) ============

// 产出的是「场景参考图」绘图提示词：先生成场景图，再作为视频模型的场景参考，
// 因此强调空镜环境、空间布局、光影氛围等可视化细节，便于视频模型对齐场景
const SCENE_PROMPT_SYSTEM_PROMPT =
  '你是一名资深影视美术指导，正在为 AI 视频生成制作「场景参考图」的绘图提示词。根据用户给出的「场景名称」，生成一段可直接用于绘图模型的场景画面描述。要求：1) 不超过 100 个汉字；2) 依次覆盖：场景的时代与类型、空间布局与标志性陈设/道具、时间（白天/黄昏/夜晚）与光线（光源方向、明暗、光影质感）、色调与整体氛围；3) 以空镜环境为主体，不出现清晰的人物主体，避免人物干扰视频模型对场景的参考；4) 多写具体可视化的细节（材质、陈设位置、天气、环境状态），避免堆砌抽象形容词；5) 只输出提示词正文，不要解释、不要标题、不要引号、不要换行、不要序号。';

// AI 生成形象提示词的系统提示
const PORTRAIT_PROMPT_SYSTEM_PROMPT =
  '你是一名专业的人物形象造型师。请根据用户给出的「形象标题」，生成一段用于 AI 绘图的角色形象描述提示词。要求：1) 不超过 80 个汉字；2) 描述角色的服装、配饰、发型、姿态、表情与气质；3) 只输出提示词正文，不要解释、不要标题、不要引号、不要换行、不要序号。';

// 产出的是「视频片段」画面提示词：基于给定的角色 + 场景 + 用户创意，
// 要求原样保留角色名与场景名，便于前端将名称替换为 @<role> / #<scene> 引用标签
const SEGMENT_PROMPT_SYSTEM_PROMPT =
  '你是一名资深短剧编剧兼分镜导演，正在为 AI 视频生成撰写「片段提示词」。根据用户给出的「角色」「场景」和「创意描述」，生成一段可直接用于视频生成的片段画面描述。要求：1) 不超过 150 个汉字；2) 必须自然地提及给定的角色名与场景名（保持原名不变，不要改写），交代谁在哪里、做什么、情绪与关系变化；3) 包含具体的动作、表情、氛围与镜头感描写，画面可拍性强；4) 多写可视化细节，避免堆砌抽象形容词；5) 只输出提示词正文，不要解释、不要标题、不要引号、不要换行、不要序号。';

/**
 * 根据场景名称，使用文本模型生成 ≤ 30 字的画面提示词
 */
export async function generateScenePromptApi(
  model: string,
  sceneName: string,
): Promise<{ success: boolean; data: { prompt: string }; message?: string }> {
  try {
    const prompt = await generateCleanText({
      modelId: model,
      input: sceneName.trim(),
      systemPrompt: SCENE_PROMPT_SYSTEM_PROMPT,
    });
    return { success: true, data: { prompt } };
  } catch (err) {
    return {
      success: false,
      data: { prompt: '' },
      message: err instanceof Error ? err.message : '生成提示词失败',
    };
  }
}

/**
 * 根据形象标题，使用文本模型生成角色形象提示词
 */
export async function generatePortraitPromptApi(
  model: string,
  portraitTitle: string,
): Promise<{ success: boolean; data: { prompt: string }; message?: string }> {
  try {
    const prompt = await generateCleanText({
      modelId: model,
      input: portraitTitle.trim(),
      systemPrompt: PORTRAIT_PROMPT_SYSTEM_PROMPT,
    });
    return { success: true, data: { prompt } };
  } catch (err) {
    return {
      success: false,
      data: { prompt: '' },
      message: err instanceof Error ? err.message : '生成提示词失败',
    };
  }
}

/**
 * AI 创意：根据角色 + 场景 + 创意描述，使用文本模型生成片段提示词
 */
export async function generateSegmentPromptApi(
  model: string,
  prompt: string,
  sceneName?: string,
  characterNames?: string[],
): Promise<{ success: boolean; data: { prompt: string }; message?: string }> {
  try {
    const names = (characterNames || []).filter(Boolean);
    const input = [
      names.length > 0 ? `角色：${names.join('、')}` : '',
      sceneName ? `场景：${sceneName}` : '',
      `创意描述：${prompt.trim()}`,
    ]
      .filter(Boolean)
      .join('\n');
    const result = await generateCleanText({
      modelId: model,
      input,
      systemPrompt: SEGMENT_PROMPT_SYSTEM_PROMPT,
    });
    return { success: true, data: { prompt: result } };
  } catch (err) {
    return {
      success: false,
      data: { prompt: '' },
      message: err instanceof Error ? err.message : '生成片段提示词失败',
    };
  }
}
