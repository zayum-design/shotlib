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
 * 剧本相关 API(纯前端版)
 *
 * 原版为 HTTP 调用封装;开源版改为:
 * - 静态预设(智能体/类型/技能/发展方向)直接读取内置 JSON
 * - 剧本生成/审阅/解析调用本地 AI 编排层(aiModelService),与后端 controller 的
 *   变量组装逻辑(subStyleHint/genreGuide/genreHooks)保持一致
 */
import agentTypesJson from '@/config/presets/workflow/agent-types.json';
import genresJson from '@/config/presets/workflow/genres.json';
import skillsJson from '@/config/presets/workflow/skills.json';
import developmentDirectionsJson from '@/config/presets/development-directions.json';
import { promptLoader } from '@/ai/prompts/prompt-loader';
import { aiModelService } from '@/ai/services/ai-model.service';
import type { ApiResponse } from './types';

// ============ 静态预设数据 ============

export interface SubStyleItem {
  id: string;
  name: string;
  promptHint: string;
}

export interface AgentTypeItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  promptHint: string;
  subStyles?: SubStyleItem[];
}

export interface GenreItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** 剧本类型专属创作指引(注入系统提示词) */
  promptGuide?: string;
  /** 题材专属创作工艺库(按创作模式分流;缺省用模式默认清单) */
  craftGuides?: string[];
}

export interface SkillItem {
  id: string;
  name: string;
  icon: string;
  description: string;
}

const agentTypes = agentTypesJson as AgentTypeItem[];
const genres = genresJson as GenreItem[];
const skills = skillsJson as SkillItem[];

// ============ 创作模式工艺库(与后端 prompt-type.registry 一致) ============

/** 各创作模式默认注入的创作工艺指南(钩子/付费点类工艺仅付费短剧模式需要) */
const MODE_CRAFT_GUIDES: Record<string, string[]> = {
  drama: ['short-drama-hook', 'short-drama-opening', 'short-drama-rhythm', 'short-drama-satisfaction'],
  story: ['short-drama-rhythm'],
  mood: [],
};

const craftGuideCache = new Map<string, string>();

/** 按创作模式解析题材工艺库内容(复刻后端 resolveGenreHooks) */
function resolveGenreHooks(genre: GenreItem | undefined, creationMode?: string): string {
  if (!genre) return '';
  const modeKey = creationMode && creationMode in MODE_CRAFT_GUIDES ? creationMode : 'drama';
  const guideNames: string[] = Array.isArray(genre.craftGuides)
    ? genre.craftGuides
    : MODE_CRAFT_GUIDES[modeKey] || [];
  const parts: string[] = [];
  for (const name of guideNames) {
    if (!craftGuideCache.has(name)) {
      craftGuideCache.set(name, promptLoader.loadCraftGuide(name));
    }
    const content = craftGuideCache.get(name);
    if (content) parts.push(content);
  }
  return parts.join('\n\n---\n\n');
}

// ============ 剧本生成 ============

export interface GenerateScriptRequest {
  topic: string;
  model?: string;
  agentType?: string;  // 智能体类型
  skills?: string[];  // 技能列表
  subStyle?: string;   // 子风格ID（可选）
  artStyle?: string;   // 画风ID（可选）
  genre?: string;      // 剧本类型ID（可选）
  async?: boolean;     // 是否异步执行(开源版忽略,恒同步)
  isEnding?: boolean;  // 是否为大结局
}

export interface GenerateScriptResponse {
  script: string;
  summary?: string;
}

/**
 * 生成剧本:复刻后端 controller 的变量组装(subStyleHint/genreGuide/genreHooks)
 * 后调用本地 AI 编排层
 */
export async function generateScriptApi(
  topic: string,
  model: string = 'deepseek',
  agentType?: string,
  skills?: string[],
  _preview?: boolean,
  subStyle?: string,
  _artStyle?: string,
  _async?: boolean,
  isEnding?: boolean,
  genre?: string,
  creationMode?: string,
): Promise<ApiResponse<GenerateScriptResponse>> {
  // 子风格 promptHint:从智能体预设的 subStyles 中解析
  let subStyleHint = '';
  if (subStyle && agentType) {
    const currentAgentType = agentTypes.find((t) => t.id === agentType);
    const currentSubStyle = currentAgentType?.subStyles?.find((s) => s.id === subStyle);
    if (currentSubStyle) subStyleHint = currentSubStyle.promptHint;
  }

  // 剧本类型专属创作指引与工艺库
  const genreItem = genre ? genres.find((g) => g.id === genre) : undefined;
  const genreGuide = genreItem?.promptGuide || '';
  const genreHooks = resolveGenreHooks(genreItem, creationMode);

  try {
    const { script, summary } = await aiModelService.generateScript(model, {
      topic,
      agentType,
      subStyleHint: subStyleHint || undefined,
      skills,
      isEnding,
      genre,
      genreGuide: genreGuide || undefined,
      genreHooks: genreHooks || undefined,
      creationMode,
    });
    return { success: true, data: { script, summary } };
  } catch (error) {
    return {
      success: false,
      data: { script: '', summary: '' },
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============ 剧本校验/修改 ============

export type ScriptReviewMode = 'review' | 'modify';

export interface ReviewScriptResponse {
  mode: ScriptReviewMode;
  /** mode=review 时返回审阅报告 */
  report?: string;
  /** mode=modify 时返回修改后的完整剧本 */
  script?: string;
}

/**
 * mode=review:根据故事梗概对剧本进行合理性二次校验审阅
 * mode=modify:按修改要求对当前剧本进行修改
 */
export async function reviewScriptApi(
  script: string,
  summary: string,
  mode: ScriptReviewMode,
  requirement?: string,
  model: string = 'deepseek',
  _async?: boolean,
  creationMode?: string,
): Promise<ApiResponse<ReviewScriptResponse>> {
  try {
    if (mode === 'modify') {
      const modified = await aiModelService.modifyScript(model, {
        script,
        summary: summary || undefined,
        requirement: requirement || '',
      });
      return { success: true, data: { mode, script: modified } };
    }
    const report = await aiModelService.reviewScript(model, {
      script,
      summary: summary || undefined,
      creationMode,
    });
    return { success: true, data: { mode, report } };
  } catch (error) {
    return {
      success: false,
      data: { mode },
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============ 资产提示词校验/修改 ============

/** 资产提示词修改结果（仅包含需要修改的资产和字段） */
export interface AssetPromptChanges {
  characters: {
    name: string;
    imagePrompt?: string;
    avatarPrompt?: string;
    voicePrompt?: string;
  }[];
  scenes: { name: string; imagePrompt?: string }[];
}

/** 扁平化的单条提示词修改项（勾选确认后提交应用） */
export interface AssetPromptChangeItem {
  assetType: 'character' | 'scene';
  /** 角色/场景名称（与分解产出名称匹配） */
  name: string;
  field: 'imagePrompt' | 'avatarPrompt' | 'voicePrompt';
  newValue: string;
}

export interface ReviewAssetsResponse {
  mode: ScriptReviewMode;
  /** mode=review 时返回审阅报告 */
  report?: string;
  /** mode=modify 时返回提示词修改结果 */
  changes?: AssetPromptChanges;
}

/**
 * mode=review:根据剧本对分解产出的角色/场景提示词进行合理性二次校验审阅
 * mode=modify:按修改要求修改角色/场景提示词
 */
export async function reviewAssetsApi(
  script: string,
  characters: unknown[],
  scenes: unknown[],
  mode: ScriptReviewMode,
  requirement?: string,
  model: string = 'deepseek',
  _async?: boolean,
): Promise<ApiResponse<ReviewAssetsResponse>> {
  try {
    if (mode === 'modify') {
      const changes = await aiModelService.modifyAssetPrompts(model, {
        script,
        characters: characters as never[],
        scenes: scenes as never[],
        requirement: requirement || '',
      });
      return { success: true, data: { mode, changes } };
    }
    const report = await aiModelService.reviewAssetPrompts(model, {
      script,
      characters: characters as never[],
      scenes: scenes as never[],
    });
    return { success: true, data: { mode, report } };
  } catch (error) {
    return {
      success: false,
      data: { mode },
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============ 片段提示词校验/修改 ============

/** 片段提示词修改结果（仅包含需要修改的片段/分镜和字段） */
export interface EpisodePromptChanges {
  episodes: {
    id: string;
    videoPrompt?: string;
    firstFramePrompt?: string;
    lastFramePrompt?: string;
    firstLastFrameVideoPrompt?: string;
    shots?: { id: string; prompt?: string; referencePrompt?: string; [key: string]: unknown }[];
    /** 新增片段时输出（id 以 __new__ 前缀） */
    title?: string;
    description?: string;
    /** 删除片段标记 */
    deleted?: boolean;
  }[];
}

/** 扁平化的单条片段提示词修改项（勾选确认后提交应用） */
export interface EpisodePromptChangeItem {
  episodeId: string;
  /** 分镜修改时带分镜 id，片段级字段修改时为空 */
  shotId?: string;
  /** 修改动作：字段修改（默认）/ 新增片段 / 删除片段 */
  action?: 'update' | 'add' | 'delete';
  /** action=add 时的新片段完整数据 */
  episodeData?: Record<string, unknown>;
  field:
    | 'videoPrompt'
    | 'firstFramePrompt'
    | 'lastFramePrompt'
    | 'firstLastFrameVideoPrompt'
    | 'prompt'
    | 'referencePrompt';
  newValue: string;
}

export interface ReviewEpisodesResponse {
  mode: ScriptReviewMode;
  /** mode=review 时返回审阅报告 */
  report?: string;
  /** mode=modify 时返回提示词修改结果 */
  changes?: EpisodePromptChanges;
}

/**
 * mode=review:根据剧本对片段/分镜提示词进行合理性二次校验审阅
 * mode=modify:按修改要求修改片段/分镜提示词
 */
export async function reviewEpisodesApi(
  script: string,
  episodes: unknown[],
  characters: unknown[],
  mode: ScriptReviewMode,
  requirement?: string,
  model: string = 'deepseek',
  _async?: boolean,
): Promise<ApiResponse<ReviewEpisodesResponse>> {
  try {
    if (mode === 'modify') {
      const changes = await aiModelService.modifyEpisodePrompts(model, {
        script,
        episodes: episodes as never[],
        characters: characters as never[],
        requirement: requirement || '',
      });
      return { success: true, data: { mode, changes } };
    }
    const report = await aiModelService.reviewEpisodePrompts(model, {
      script,
      episodes: episodes as never[],
      characters: characters as never[],
    });
    return { success: true, data: { mode, report } };
  } catch (error) {
    return {
      success: false,
      data: { mode },
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============ 静态预设查询 API ============

export interface HotScriptItem {
  title: string;
  content: string;
  clicks: number;
}

/** 获取热门剧本列表(开源版已下线服务端热门剧本,恒返回空列表) */
export async function getHotScriptsApi(_subStyle?: string): Promise<ApiResponse<{ items: HotScriptItem[] }>> {
  return { success: true, data: { items: [] } };
}

/** 获取电影风格列表(内置预设) */
export async function getAgentTypesApi(): Promise<ApiResponse<{ items: AgentTypeItem[] }>> {
  return { success: true, data: { items: agentTypes } };
}

/** 获取剧本类型列表(内置预设) */
export async function getGenresApi(): Promise<ApiResponse<{ items: GenreItem[] }>> {
  return { success: true, data: { items: genres } };
}

/** 获取 AI 技能列表(内置预设) */
export async function getSkillsApi(): Promise<ApiResponse<{ items: SkillItem[] }>> {
  return { success: true, data: { items: skills } };
}

// ============ 剧本解析 ============

export interface ParseScriptRequest {
  script: string;
  model?: string;
}

export interface ParseScriptResponse {
  characters: Character[];
  scenes: Scene[];
  props?: Prop[]; // 剧本中的关键道具（旧模板/旧数据缺失时为空，可选用）
  era: Era;
  relationshipNetwork?: RelationshipNetwork; // 人物关系网（可选）
}

// 类型仅用于响应形状声明,由 AI 编排层返回的 any 数据填充
type Character = Record<string, unknown>;
type Scene = Record<string, unknown>;
type Prop = Record<string, unknown>;
type Era = Record<string, unknown>;
type RelationshipNetwork = Record<string, unknown>;

/**
 * 从剧本解析角色、场景、道具和故事背景
 */
export async function parseScriptApi(
  script: string,
  model: string = 'deepseek',
  _preview?: boolean,
  _async?: boolean,
): Promise<ApiResponse<ParseScriptResponse>> {
  try {
    const result = await aiModelService.parseScript(model, { script });
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      data: {
        characters: [],
        scenes: [],
        props: [],
        era: {} as Era,
        relationshipNetwork: undefined,
      } as unknown as ParseScriptResponse,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============ 异步任务查询(存根) ============

export interface ScriptJobStatusResponse {
  jobId: string | number;
  state: string;
  result?: unknown;
  failedReason?: string;
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
}

/**
 * 查询剧本生成异步任务状态(开源版无服务端队列,AI 调用恒同步,此接口仅为兼容保留)
 */
export async function getScriptJobStatusApi(
  _jobId: string | number,
): Promise<ApiResponse<ScriptJobStatusResponse>> {
  return {
    success: false,
    data: { jobId: '', state: 'unavailable', attemptsMade: 0, timestamp: 0 },
    message: '开源版无服务端队列,剧本生成恒为同步调用',
  };
}

// ============ 分集发展方向(内置预设) ============

export interface DevelopmentDirection {
  id: string;
  name: string;
  isEnding: boolean;
}

export interface DevelopmentCategory {
  id: string;
  name: string;
  directions: DevelopmentDirection[];
}

export interface GetDevelopmentDirectionsResponse {
  version: string;
  categories: DevelopmentCategory[];
}

/** 获取分集发展方向预设(内置 JSON) */
export async function getDevelopmentDirectionsApi(): Promise<ApiResponse<GetDevelopmentDirectionsResponse>> {
  return { success: true, data: developmentDirectionsJson };
}
