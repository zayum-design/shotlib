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

/** 生成类型：图片 / 视频 */
export type GenerateMode = 'image' | 'video';

/** 视频参考模式：全能参考（多参考图）/ 首尾帧 */
export type VideoReferenceMode = 'references' | 'frames';

/** 单个生成结果（一张图或一段视频） */
export interface GenerateResult {
  id: string;
  type: GenerateMode;
  /** 结果资产 ID（引用 creator_generate_assets，pending 时为空） */
  assetId: string;
  status: 'pending' | 'done' | 'error';
  seed?: number;
  /** 视频：异步任务 ID（前端轮询用） */
  taskId?: string;
  /** 失败时的错误信息 */
  error?: string;
}

/** 图片自定义尺寸 */
export interface GenerateSize {
  w: number;
  h: number;
  /** 是否锁定比例（改 W 时 H 按比例联动） */
  lock: boolean;
}

/** 参考资源类型（全能参考支持图片/视频/音频） */
export type ReferenceType = 'image' | 'video' | 'audio';

/** 单个参考资源 */
export interface ReferenceAsset {
  type: ReferenceType;
  /** 资产 ID（引用 creator_generate_assets） */
  assetId: string;
  name?: string;
}

/** 一条生成记录（用户一次提交 = 一条记录） */
export interface GenerateRecord {
  id: string;
  prompt: string;
  mode: GenerateMode;
  /** 比例：16:9 / 9:16 / 1:1 / 21:9 / 3:2 / 4:3 / 3:4 / 2:3 等 */
  aspectRatio: string;
  model: string;
  count: number;
  /** 参考资源（图片/视频/音频，全能参考 / 图片图生图） */
  references: ReferenceAsset[];
  /** 视频：参考模式 */
  referenceMode?: VideoReferenceMode;
  /** 视频：首帧资产 ID（首尾帧模式） */
  firstFrameAssetId?: string;
  /** 视频：尾帧资产 ID（首尾帧模式） */
  lastFrameAssetId?: string;
  /** 分辨率：图片 1k/2k/4k，视频 720p */
  resolution?: string;
  /** 视频：时长（秒） */
  duration?: number;
  /** 图片：自定义尺寸（W/H + 锁定） */
  size?: GenerateSize;
  results: GenerateResult[];
  /** ISO 时间字符串 */
  createdAt: string;
}

/** 会话元信息（左侧列表项，轻量） */
export interface SessionMeta {
  sessionId: string;
  title: string;
  /** ISO 时间字符串 */
  updatedAt: string;
  recordCount: number;
}

/** 会话完整内容 */
export interface SessionContent {
  records: GenerateRecord[];
}

/** getSessionApi 返回结构 */
export interface SessionData {
  meta: SessionMeta | null;
  content: SessionContent;
}

/** createSessionApi 返回结构 */
export interface CreateSessionResult {
  projectId: string;
  sessionId: string;
  meta: SessionMeta;
}
