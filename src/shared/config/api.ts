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
 * API 配置文件(开源版)
 *
 * 开源版无自建后端,本文件仅保留 URL 拼装工具与端点常量:
 * - buildUrl 仍被少量本地工具引用,签名保持不变
 * - 原版的通用请求函数与登录态注入已随后端一起移除
 */

// API 路径前缀 - 从环境变量读取(开源版默认无后端,保持空字符串走相对路径)
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

// API 端点
export const API_ENDPOINTS = {
  // 剧本相关
  SCRIPT_GENERATE: "/api/creator/script/generate",
  SCRIPT_PARSE: "/api/creator/script/parse",
  SCRIPT_REVIEW: "/api/creator/script/review",
  SCRIPT_REVIEW_ASSETS: "/api/creator/script/review-assets",
  SCRIPT_REVIEW_EPISODES: "/api/creator/script/review-episodes",

  // 角色图像相关
  CHARACTER_AVATAR: "/api/creator/character/{id}/avatar",
  CHARACTER_VIEWS: "/api/creator/character/{id}/views",
  CHARACTER_VIEW_REGENERATE:
    "/api/creator/character/{characterId}/fullbody/{viewType}",
  CHARACTER_EXPAND_VIEW: "/api/creator/character/{id}/expand-view",
  CHARACTER_PORTRAIT: "/api/creator/character/{id}/portrait",

  // 音色设计
  VOICE_DESIGN: "/api/creator/voice/design",

  // 场景图像相关
  SCENE_IMAGE_GENERATE: "/api/creator/image-processing/generate",

  // 片段相关
  EPISODE_GENERATE: "/api/creator/episode/generate",
  EPISODE_VIDEO: "/api/creator/episode/{id}/video",
  EPISODE_VIDEO_WITH_FRAMES: "/api/creator/episode/{id}/video-with-frames",
  EPISODE_VIDEO_WITH_REFERENCES:
    "/api/creator/episode/{id}/video-with-references",
  EPISODE_VIDEO_TASK: "/api/creator/episode/{id}/video-task/{taskId}",
  EPISODE_FIRST_FRAME: "/api/creator/episode/{id}/first-frame",
  EPISODE_LAST_FRAME: "/api/creator/episode/{id}/last-frame",
  EPISODE_COMPOSE: "/api/creator/episode/compose",

  // 模型列表
  MODELS_LIST: "/api/creator/models",
  // 热门剧本
  HOT_SCRIPTS: "/api/creator/script/hot",
  // 电影风格(智能体类型)
  AGENT_TYPES: "/api/creator/script/agent-types",
  // AI 技能
  SKILLS: "/api/creator/script/skills",
  // 剧本类型
  SCRIPT_GENRES: "/api/creator/script/genres",
  // 分集发展方向预设
  DEVELOPMENT_DIRECTIONS: "/api/creator/script/development-directions",

  // 用户素材管理(开源版为本地存根,见 shared/api/userMaterialApi.ts)
  USER_MATERIALS_LIST: "/api/creator/user-materials",
  USER_MATERIALS_DELETE: "/api/creator/user-materials/{id}",
} as const;

// 构建完整 URL
export const buildUrl = (
  endpoint: string,
  params?: Record<string, string>,
): string => {
  let url = endpoint;

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url = url.replace(`{${key}}`, value);
    });
  }

  // 拼接 API 基础 URL
  if (API_BASE_URL) {
    // 使用 URL 构造函数确保正确的拼接
    try {
      return new URL(url, API_BASE_URL).href;
    } catch {
      // 如果 URL 构造函数失败，则简单拼接
      const base = API_BASE_URL.endsWith("/")
        ? API_BASE_URL.slice(0, -1)
        : API_BASE_URL;
      const path = url.startsWith("/") ? url : "/" + url;
      return base + path;
    }
  }

  return url;
};
