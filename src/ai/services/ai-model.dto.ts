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
 * AI 模型服务相关的 DTO 和接口
 */

export interface AIModel {
  id: string;
  name: string;
  type: 'text' | 'image' | 'video' | 'music' | 'voice';
}

export interface ScriptGenerationOptions {
  topic: string;
  agentType?: string;
  subStyleHint?: string;
  skills?: string[];
  isEnding?: boolean;
  /** 剧本类型ID（对应 genres.json 预设） */
  genre?: string;
  /** 剧本类型专属创作指引（由 controller 从 genres.json 解析后注入系统提示词） */
  genreGuide?: string;
  /** 剧本类型对应的短剧创作工艺库内容（钩子/开场/节奏等，由 controller 按题材注入） */
  genreHooks?: string;
  /** 创作模式：drama(付费短剧，默认) / story(故事短片) / mood(氛围情绪短片) */
  creationMode?: string;
}

export interface ScriptParsingOptions {
  script: string;
}

// 片段生成相关接口
export interface EpisodeGenerationOptions {
  script: string;
  characters?: any[];
  scenes?: any[];
  /** 道具列表（分镜提示词通过【道具:名】标记引用，imageUrl 供参考图关联） */
  props?: any[];
  /** 上一集结尾状态（由后端从分集数据提取注入，首集为空） */
  previousEndingState?: string;
  /** 本集事件分桶文本（事件密度防火墙，由前端按剧本分解的分集纲要传入） */
  eventBuckets?: string;
  /** 片段时长上限（秒）:15 或 30,30s 仅长片段模型（如 seedance2.5）支持。默认 15 */
  maxEpisodeDuration?: number;
}

export interface LyricsGenerationOptions {
  prompt: string;
  style?: string;
  mood?: string;
}

// 角色信息接口（包含头像）
export interface CharacterInfo {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  fullBodyUrl?: string;
}

// 场景信息接口（包含图片）
export interface SceneInfo {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
}

export interface Shot {
  id: string;
  duration: number;
  cameraMovements: string[];
  shotType: string;
  cameraAngle: string;
  lighting: string;
  mood: string;
  prompt: string; // 分镜提示词，对白内容已嵌入其中
  referencePrompt?: string;
  rawReferencePrompt?: string;
  dialogue?: string; // 分镜对白（与 prompt 中 {} 内文字一致；无对白时为空字符串）
}

export interface Episode {
  id: string;
  title: string;
  description: string;
  videoPrompt: string;
  rawVideoPrompt?: string;
  model: string;
  shots: Shot[];
  firstFramePrompt?: string;
  lastFramePrompt?: string;
  firstLastFrameVideoPrompt?: string;
  firstFrameDialogue?: string;
  lastFrameDialogue?: string;
}
