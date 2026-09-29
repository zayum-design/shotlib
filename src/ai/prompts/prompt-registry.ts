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
 * promptType 注册表(单一配置源)
 *
 * 集中声明所有通过 prompt-loader 加载的提示词类型:
 * - 每个类型的用途说明
 * - 需要内联注入的共享模板(sharedVars:模板变量名 → 共享模板相对路径,不含 .md)
 * - 渲染时必须提供的业务变量(requiredVars,用于文档与排查)
 *
 * 规则:
 * - 新增 promptType 时必须在此登记,禁止在业务代码中散落路径拼接逻辑
 * - 未登记的类型仍会按旧的路径推断逻辑解析(向后兼容),但会输出控制台警告
 *
 * 相比原后端注册表,仅保留 drama 业务线条目(开源版范围),
 * 相对路径省略顶级业务前缀 `drama/`(开源版只含短剧模板库)。
 */

export interface PromptTypeEntry {
  /** 用途说明 */
  description: string;
  /**
   * 共享模板注入:模板中的 `{{变量名}}` 占位符 → config/prompts 下的共享模板相对路径(不含 .md)。
   * 在模板加载时内联替换,渲染业务变量前完成,调用方无感知。
   */
  sharedVars?: Record<string, string>;
  /** 渲染时应提供的业务变量名(文档作用,便于排查模板占位符未替换问题) */
  requiredVars?: string[];
}

/** 短剧创作工艺库(题材钩子库)目录:config/prompts/workflow/drama/ */
export const DRAMA_CRAFT_GUIDE_DIR = 'workflow/drama';

/**
 * 剧本类型默认注入的创作工艺指南(genres.json 中单个题材可用 craftGuides 字段覆盖)。
 * 对应 config/prompts/workflow/drama/ 下的同名 .md 文件。
 */
export const DEFAULT_DRAMA_CRAFT_GUIDES = [
  'short-drama-hook',
  'short-drama-opening',
  'short-drama-rhythm',
  'short-drama-satisfaction',
];

/** 剧本创作模式 id(项目级选择,缺省 drama 保持存量行为) */
export type ScriptCreationMode = 'drama' | 'story' | 'mood';

/**
 * 创作模式 → 结构叠加层模板(config/prompts 相对路径,不含 .md)。
 * 叠加层定义剧集结构/幕标题/节拍功能/开场与结尾规则,注入剧本生成的 {{modeGuide}}。
 * 新增模式只需添加 md 文件并在此登记一行。
 */
export const SCRIPT_MODE_OVERLAYS: Record<ScriptCreationMode, string> = {
  drama: 'workflow/modes/SHORT_DRAMA',
  story: 'workflow/modes/STORY',
  mood: 'workflow/modes/MOOD',
};

/** 各创作模式默认注入的创作工艺指南(钩子/付费点类工艺仅付费短剧模式需要) */
export const MODE_CRAFT_GUIDES: Record<ScriptCreationMode, string[]> = {
  drama: DEFAULT_DRAMA_CRAFT_GUIDES,
  story: ['short-drama-rhythm'],
  mood: [],
};

export const PROMPT_TYPE_REGISTRY: Record<string, PromptTypeEntry> = {
  // ============ drama / workflow(剧本工作流) ============
  'drama/script-generation': {
    description: '短剧剧本生成(钩子集/连载集/大结局)',
    sharedVars: {
      directingCore: 'shared/DIRECTING_CORE',
    },
    requiredVars: [
      'topic',
      'agentType',
      'genreGuide',
      'genreHooks',
      'isEnding',
    ],
  },
  'drama/script-parsing': {
    description: '剧本分解为结构化 JSON(角色/场景/时代/关系/形象照/分集纲要)',
  },
  'drama/script-review': {
    description: '剧本校验审阅(含 AI 味检测维度)',
    requiredVars: ['summary'],
  },
  'drama/script-modify': {
    description: '按修改要求输出完整修改后剧本(含反 AI 味红线)',
    sharedVars: {
      directingCore: 'shared/DIRECTING_CORE',
    },
    requiredVars: ['summary', 'requirement'],
  },
  'drama/asset-prompt-review': {
    description: '角色/场景资产提示词校验审阅',
    requiredVars: ['characters', 'scenes'],
  },
  'drama/asset-prompt-modify': {
    description: '角色/场景资产提示词修改(JSON 输出)',
    requiredVars: ['characters', 'scenes', 'requirement'],
  },
  'drama/episode-generation': {
    description: '短剧分镜/片段生成(镜头合同 + 上集状态 + 事件分桶)',
    sharedVars: {
      directingCore: 'shared/DIRECTING_CORE',
      shotLanguage: 'shared/SHOT_LANGUAGE',
    },
    requiredVars: [
      'script',
      'characters',
      'scenes',
      'previousEndingState',
      'eventBuckets',
    ],
  },
  'drama/episode-prompt-review': {
    description: '片段提示词校验审阅(含连续性/AI 味维度)',
    requiredVars: ['characters', 'episodes'],
  },
  'drama/episode-prompt-modify': {
    description: '片段提示词修改(JSON 输出,含镜头合同/反 AI 味约束)',
    sharedVars: {
      directingCore: 'shared/DIRECTING_CORE',
      shotLanguage: 'shared/SHOT_LANGUAGE',
    },
    requiredVars: ['characters', 'episodes', 'requirement'],
  },
  'drama/video-negatives': {
    description: '视频生成禁止项(追加到视频提示词末尾)',
  },

  // ============ drama / instant(即时创作) ============
  'drama/scene-shots-generation': {
    description: '即时创作:场景分镜生成(轻量版镜头合同)',
    sharedVars: {
      directingCore: 'shared/DIRECTING_CORE',
      shotLanguage: 'shared/SHOT_LANGUAGE',
    },
  },
  'drama/character-portrait': {
    description: '即时创作:角色形象照生成提示词',
  },

  // ============ 通用 ============
  'video/anti-ai-suffix': {
    description: '视频生成反 AI 味全局后缀',
  },
};

/** 查询注册表条目(未注册返回 undefined) */
export function getPromptTypeEntry(
  promptType: string,
): PromptTypeEntry | undefined {
  return PROMPT_TYPE_REGISTRY[promptType];
}
