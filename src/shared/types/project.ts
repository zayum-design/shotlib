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

import type { CharacterImage } from './index';

export type ProjectCategory = 'drama' | 'advertisement' | 'music' | 'novel' | 'mv2' | 'advertisement2' | 'multi-agent';
export type ProjectType = 'script' | 'instant';
export type AspectRatio = '9:16' | '16:9' | '1:1' | '21:9';

// 即时创作角色
export interface InstantCharacter {
  id: string;
  assetId?: string; // 资产唯一标识（历史数据可能留空）
  name: string;
  avatar?: string; // 运行时解析后的当前头像 URL（不持久化）
  taskSummary: string;
  gender: string;
  ageGroup: string;
  personality: string;
  appearance: string;
  occupation: string;
  model?: string;
  avatarPrompt?: string;
  imagePrompt?: string;
  portraitPrompt?: string;
  avatarImages?: CharacterImage[]; // 头像图片数组
  portraitImages?: CharacterImage[]; // 形象照图片数组
  fullBodyImages?: CharacterImage[]; // 全身照/多视图图片数组
  isGeneratingAvatar?: boolean;
  isGeneratingViews?: boolean;
  isGeneratingPortrait?: boolean;
  voicePrompt?: string; // 角色音色/声音描述提示词，用于情感微调
}

// 即时创作场景
export interface InstantScene {
  id: string;
  assetId?: string; // 资产唯一标识（历史数据可能留空）
  name: string;
  imageUrl?: string; // 运行时解析后的当前场景图 URL（不持久化）
  prompt: string;
  sceneType: string;
  timeOfDay: string;
  atmosphere: string;
  lighting: string;
  weather: string;
  model?: string;
  imageUrls?: string[]; // 运行时解析后的场景图 URL 列表（兼容旧数据）
  isGenerating?: boolean;
}

import type { Shot, ShotReferenceAsset } from './index';

export interface CanvasItem {
  id: string;
  type: 'character' | 'scene';
  refId: string;
  name?: string; // 场次名称（scene 类型使用），覆盖场景模板名称
  x: number;
  y: number;
  characters?: string[]; // 仅 scene 类型使用：存储拖入的角色 refId
  generatedPrompt?: string; // 仅 scene 类型使用：自动生成的提示词
  customPrompt?: string; // 用户编辑的自定义提示词（优先于 generatedPrompt）
  videoModel?: string; // 该场景使用的视频模型
  videoUrl?: string; // 当前显示的视频URL（最后一个生成的或用户选择的）
  videoUrls?: string[]; // 所有生成的视频URL列表
  videoJobId?: string; // BFF 异步任务 ID（pollJobStatus 轮询用，拿到 videoTaskId 后清除）
  videoTaskId?: string; // 外部视频平台任务ID（阿里云/火山等）
  isGeneratingVideo?: boolean; // 是否正在生成视频
  videoGenerationFailed?: boolean; // 上一次视频生成是否失败（用于占位提示和按钮文案切换）
  videoGenerationError?: string; // 上一次视频生成的错误信息（用于在按钮上方显示）
  shots?: Shot[]; // 分镜列表（即时创作模式）
  isGeneratingShots?: boolean; // 是否正在生成分镜
  shotTextModel?: string; // 生成分镜使用的文本模型
  shotMaxDuration?: number; // 分镜总时长上限（秒，15 或 30；30 仅长片段模型如 seedance2.5 支持）
  shotImageModel?: string; // 该场景生成图片（首帧/尾帧/参考图）使用的图片模型
  // 视频生成方式
  videoGenerationMode?: 'first_last_frame' | 'reference_image';
  videoDuration?: number; // 视频时长（秒），首尾帧模式下使用
  videoResolution?: '720p' | '1080p'; // 视频分辨率
  // 首帧和尾帧
  firstFramePrompt?: string;
  firstFrameImageUrl?: string;
  firstFrameImageAssetId?: string;
  firstFrameGenMeta?: Record<string, any>; // 首帧生成参数（prompt/type/steps/cfgScale/seed 等），落盘到 asset.data.metadata
  lastFramePrompt?: string;
  lastFrameImageUrl?: string;
  lastFrameImageAssetId?: string;
  lastFrameGenMeta?: Record<string, any>; // 尾帧生成参数
  isGeneratingFirstFrame?: boolean;
  isGeneratingLastFrame?: boolean;
  firstLastFrameVideoPrompt?: string;
  isMinimized?: boolean;
  headerOrder?: number; // 在header中的显示顺序，undefined表示不显示在header中
  currentVideoIndex?: number; // 当前显示的视频在videoUrls中的索引
  referenceAssets?: ShotReferenceAsset[]; // 场景描述提示词的参考附件（上传的图片/视频/音频，复刻 generate 上传功能）
}

export interface CanvasConnection {
  id: string;
  fromId: string;
  toId: string;
}

export interface InstantSegment {
  id: string;
  name: string;
  canvasItems: CanvasItem[];
  connections: CanvasConnection[];
}

export interface Project {
  id: string;
  name: string;
  category: ProjectCategory;
  type: ProjectType;
  aspectRatio: AspectRatio;
  deletedAt?: string | null;
  episodeCount?: number;
  totalDuration?: number;
  coverUrl?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// 即时创作数据的独立存储结构（合并到 workflowStore 的 key 中，字段名加前缀避免冲突）
export interface InstantProjectData {
  instantCharacters: InstantCharacter[];
  instantScenes: InstantScene[];
  instantSegments: InstantSegment[];
}
