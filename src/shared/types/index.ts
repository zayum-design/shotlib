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

// 角色图片对象（头像/全身照/形象照统一结构）
export interface CharacterImage {
  id?: string; // creator_instant_assets 行主键（内部关联使用）
  assetId?: string; // image_asset 行的 UUID（所有模式统一语义，用于 resolveImageAssets 解析显示 URL）
  imageUrl?: string; // 解析后的可访问 URL（运行时缓存，不持久化）
  isGenerating?: boolean;
  prompt?: string; // 生成该图片时使用的提示词
  name?: string; // 图片名称（如"头像"、"校服照"、"正装照"）
  isPortrait?: boolean; // 是否为形象照（区别于多视图）
  viewType?: string; // 多视图类型：front/right/back
  ageVariant?: number; // 年龄变体标记（如 70 表示该图是角色70岁版本），仅头像/形象照使用
  // 生成该图片使用的模型ID（即时创作形象照使用）
  model?: string;
  // 素材库关联信息（从 creator_user_materials 选中时填充）
  userAssetId?: number; // 素材库记录ID
  assetType?: string; // 素材类型（如 character）
  groupId?: string; // 素材组ID
  // 形象照所属分集（用于按分集隔离形象照）；多视图/头像不设此字段
  episodeNumber?: number;
}

// 多视图标签（历史命名，现对应 multiViewImages）
export const FULL_BODY_LABELS = ['人物多视图'];

export interface Character {
  id: string;
  name: string;
  gender?: string; // 角色性别（"男" / "女"），由剧本分解大模型明确返回
  age?: string | number; // 角色年龄，由剧本分解大模型明确返回
  description: string;
  imagePrompt: string;
  avatarPrompt: string;
  voicePrompt?: string; // 角色音色/声音描述提示词 (text_prompt)，用于情感微调
  voiceUrl?: string; // 生成的音色音频URL
  avatarImages?: CharacterImage[]; // 头像图片数组（仅保存 assetId）
  currentAvatarIndex?: number;
  avatarSource?: 'generated' | 'asset' | 'upload'; // 头像来源：generated=AI生成(虚拟人物)，asset=真人资产库(真人角色)，upload=本地上传
  fullBodyImages?: CharacterImage[];  // 形象照数组（仅保存 assetId，isPortrait=true）
  multiViewImages?: CharacterImage[]; // 人物多视图数组（仅保存 assetId，isPortrait=false）
  model: string;
  isGenerating?: boolean;
  isGeneratingAvatar?: boolean;
  isGeneratingViews?: boolean;
  isNew?: boolean; // 相对于上一集是否为新增角色
  characterAudios?: Array<{ audioType: string; cosUrl?: string }>; // 角色音频引用
}

// 场景类型
export interface Scene {
  id: string;
  name: string; // 场景名称
  description: string; // 场景描述
  location: string; // 地点
  timeOfDay: string; // 时间段（清晨/上午/中午/下午/傍晚/深夜）
  season: string; // 季节
  weather: string; // 天气
  imagePrompt: string; // 图像生成提示词
  imageAssetIds?: string[]; // 场景图片资产ID数组（4个）
  resolvedImageUrls?: string[]; // 解析后的场景图片URL（运行时缓存，不持久化）
  imageUrls?: string[]; // 兼容旧数据：场景图片URLs
  isGenerating?: boolean;
  model: string;
  isNew?: boolean; // 相对于上一集是否为新增场景
  isDerived?: boolean; // 片段衍生场景：入库持久化，但场景管理界面不显示
}

/** 单角色形象照数量上限（batch 生成/跨集合并/槽位填充统一引用，禁止各处硬编码） */
export const MAX_PORTRAITS_PER_CHARACTER = 9;

// 道具类型（剧本分解产出的关键道具，如信物/武器等有视觉意义的物品）
export interface Prop {  id: string;
  name: string; // 道具名称
  description?: string; // 道具简介（外观及剧中用途）
  imagePrompt?: string; // 道具图片生成提示词
  imageAssetIds?: string[]; // 道具图片资产ID数组
  resolvedImageUrls?: string[]; // 解析后的道具图片URL（运行时缓存，不持久化）
  imageUrls?: string[]; // 兼容旧数据：道具图片URLs
  isGenerating?: boolean;
  model?: string;
  isNew?: boolean; // 相对于上一集是否为新增道具
}

// 故事背景类型
export interface Era {
  id: string;
  name: string; // 时代名称
  description: string; // 时代描述
  year: string; // 年份范围
  location: string; // 地理背景
  socialBackground: string; // 社会背景
  culturalFeatures: string; // 文化特征
  visualStyle: string; // 视觉风格提示词
  globalPrompt: string; // 故事全局提示词（含人物装束，仅用于角色/首尾帧等含人物的图像）
  sceneStylePrompt?: string; // 场景专用全局风格前缀（只含色调/光影/质感，禁人物与剧情元素）；旧项目无此字段时场景不加前缀
  model: string;
}

// ============ 人物关系网 ============

export type RelationshipType =
  | '恋人'      // 恋人关系
  | '夫妻'      // 夫妻关系
  | '父母子女'  // 父母子女关系
  | '兄弟姐妹'  // 兄弟姐妹关系
  | '朋友'      // 朋友关系
  | '同事'      // 同事关系
  | '上下级'    // 上下级关系
  | '恋人未满'  // 暧昧关系
  | '对手'      // 对手/敌对关系
  | '陌生人';   // 陌生人

export interface CharacterRelationship {
  id: string;
  fromCharacterId: string;  // 关系起点角色ID
  fromCharacterName: string; // 关系起点角色名
  toCharacterId: string;    // 关系终点角色ID
  toCharacterName: string;  // 关系终点角色名
  relationship: RelationshipType; // 关系类型
  description: string;     // 关系描述
  intensity: number;        // 关系强度 1-10
}

export interface RelationshipNetwork {
  id: string;
  name: string;             // 关系网名称
  description: string;      // 关系网描述
  relationships: CharacterRelationship[];
}

// 视频生成方式
type VideoGenerationMode = 'first_last_frame' | 'reference_image';

export interface GeneratedVideo {
  url: string;
  sequence: number;       // 顺序编号
  createdAt: string;      // 生成时间 ISO
  timestamp: number;      // 加入时间 unix ms
  generationMode?: VideoGenerationMode;
  assetId?: string;       // 项目资产库视频资产ID（creator_drama_project_assets.asset_key）
}

export interface Episode {
  id: string;
  title: string;
  description: string;
  videoPrompt: string;
  model: string;
  isGenerating?: boolean;
  generatedVideoUrl?: string;
  generatedVideoAssetId?: string; // 当前视频的项目资产库资产ID
  generatedVideos?: GeneratedVideo[]; // 历史视频列表
  shots?: Shot[]; // 分镜列表
  // 首帧和尾帧
  firstFramePrompt?: string; // 首帧提示词
  firstFrameImageUrl?: string; // 首帧图片URL
  firstFrameImageAssetId?: string; // 首帧图片资产ID
  lastFramePrompt?: string; // 尾帧提示词
  lastFrameImageUrl?: string; // 尾帧图片URL
  lastFrameImageAssetId?: string; // 尾帧图片资产ID
  isGeneratingFirstFrame?: boolean; // 首帧生成中
  isGeneratingLastFrame?: boolean; // 尾帧生成中
  isExpandingFirstFrame?: boolean; // 首帧扩图中
  isExpandingLastFrame?: boolean; // 尾帧扩图中
  frameModel?: string; // 首帧图片生成模型
  lastFrameModel?: string; // 尾帧图片生成模型
  firstLastFrameVideoPrompt?: string; // 首尾帧生成视频的专用提示词
  firstFrameDialogue?: string; // 首帧对白
  lastFrameDialogue?: string; // 尾帧对白
  // 视频生成方式
  videoGenerationMode: VideoGenerationMode; // 视频生成方式：首尾帧或参考图（必须有值）
  // 参考图列表（用于 reference_image 模式）
  referenceImages?: string[]; // 参考图片URLs
  // 视频生成参数
  videoDuration: number; // 视频时长（秒）（必须有值）
  videoResolution?: '720p' | '1080p'; // 视频分辨率
  // 视频生成任务
  videoTaskId?: string; // 视频生成任务ID
  videoTaskStatus?: 'pending' | 'processing' | 'completed' | 'failed' | 'timeout'; // 视频生成任务状态
  videoTaskError?: string; // 视频生成错误信息
  videoTaskRetryCount?: number; // 重试次数
  videoGenerationProgress?: number; // 视频生成进度 0-100
  // 片段序号（generateEpisodes 生成时为数组位置；新增/衍生片段设为唯一大值 episodes.length，
  // 避免后端 syncScenesFromEpisodeData 用 episode_number 匹配 scene 时与现有片段冲突被覆盖）
  index?: number;
  // 软删除标记：true 时前端不显示/不导出/不参与批量生成，但数据保留在 episodes 数组（后端 scene 行保留，可恢复）
  deleted?: boolean;
}

// 分镜参考附件（图片/视频/音频，与 generate 模块 ReferenceAsset 结构一致）
export interface ShotReferenceAsset {
  type: 'image' | 'video' | 'audio';
  assetId: string; // 附件 URL（!<ref> 标签、缩略图展示、按 URL 移除标签均依赖此字段）
  name?: string;
  assetKey?: string; // image_asset 行 UUID（历史数据无此字段）
}

// 分镜类型
export interface Shot {
  id: string;
  duration: number; // 秒,上限随项目片段时长配置(15/30)
  cameraMovements: CameraMovement[]; // 运镜方式（可多选）
  shotType: ShotType; // 镜头类型
  cameraAngle: CameraAngle; // 摄像机角度
  lighting: LightingType; // 灯光设定
  mood: MoodType; // 氛围
  prompt: string; // 分镜提示词（已替换标记），对白内容已嵌入其中
  rawPrompt?: string; // 原始分镜提示词（未替换标记）
  referencePrompt?: string; // 分镜参考图提示词（已替换标记，静态画面，无台词/旁白）
  rawReferencePrompt?: string; // 原始分镜参考图提示词（未替换标记）
  dialogue?: string; // 分镜对白（与 prompt 中 {} 内文字一致；无对白时为空字符串）
  referenceImageUrl?: string; // 分镜参考图URL
  referenceImageAssetId?: string; // 分镜参考图资产ID（image_asset UUID）
  isGeneratingReferenceImage?: boolean; // 是否正在生成分镜参考图
  useReferenceAsFirstFrame?: boolean; // 是否将该分镜参考图作为起始帧参照
  referenceAssets?: ShotReferenceAsset[]; // 分镜参考附件（上传的图片/视频/音频）
}

// 运镜方式
export type CameraMovement =
  | 'static'      // 固定
  | 'push_in'      // 推
  | 'pull_out'     // 拉
  | 'pan_left'     // 左摇
  | 'pan_right'    // 右摇
  | 'tilt_up'      // 上摇
  | 'tilt_down'    // 下摇
  | 'track'        // 跟踪
  | 'dolly'        // 移动
  | 'crane_up'     // 升降-升
  | 'crane_down'   // 升降-降
  | 'rotate'       // 旋转
  | 'zoom'         // 变焦
  | 'handheld';   // 手持晃动

export const CAMERA_MOVEMENTS: { id: CameraMovement; name: string; description: string }[] = [
  { id: 'static', name: '固定', description: '镜头固定不动' },
  { id: 'push_in', name: '推', description: '镜头向前推进' },
  { id: 'pull_out', name: '拉', description: '镜头向后拉远' },
  { id: 'pan_left', name: '左摇', description: '镜头向左横扫' },
  { id: 'pan_right', name: '右摇', description: '镜头向右横扫' },
  { id: 'tilt_up', name: '上摇', description: '镜头向上倾斜' },
  { id: 'tilt_down', name: '下摇', description: '镜头向下倾斜' },
  { id: 'track', name: '跟踪', description: '跟随主体移动' },
  { id: 'dolly', name: '移动', description: '水平移动拍摄' },
  { id: 'crane_up', name: '升降-升', description: '镜头向上升起' },
  { id: 'crane_down', name: '升降-降', description: '镜头向下降落' },
  { id: 'rotate', name: '旋转', description: '镜头旋转' },
  { id: 'zoom', name: '变焦', description: '镜头焦距变化' },
  { id: 'handheld', name: '手持晃动', description: '模拟手持拍摄' },
];

// 镜头类型
export type ShotType = 'extreme_close_up' | 'close_up' | 'medium_close_up' | 'medium' | 'medium_long' | 'long' | 'extreme_long' | 'two_shot' | 'over_shoulder' | 'pov' | 'aerial';

export const SHOT_TYPES: { id: ShotType; name: string; description: string }[] = [
  { id: 'extreme_close_up', name: '特写', description: '面部或细节极致特写' },
  { id: 'close_up', name: '近景', description: '头部和肩部' },
  { id: 'medium_close_up', name: '中近景', description: '胸口以上' },
  { id: 'medium', name: '中景', description: '腰部以上' },
  { id: 'medium_long', name: '中远景', description: '膝盖以上' },
  { id: 'long', name: '远景', description: '全身镜头' },
  { id: 'extreme_long', name: '极远景', description: '广阔环境镜头' },
  { id: 'two_shot', name: '双人镜头', description: '两人同框' },
  { id: 'over_shoulder', name: '过肩镜头', description: '越过肩部的视角' },
  { id: 'pov', name: '主观镜头', description: '第一人称视角' },
  { id: 'aerial', name: '航拍镜头', description: '无人机俯视' },
];

// 摄像机角度
export type CameraAngle = 'eye_level' | 'low_angle' | 'high_angle' | 'bird_eye' | 'worm_eye' | 'dutch_angle';

export const CAMERA_ANGLES: { id: CameraAngle; name: string; description: string }[] = [
  { id: 'eye_level', name: '平视', description: '与主体视线齐平' },
  { id: 'low_angle', name: '仰视', description: '从低处向上看' },
  { id: 'high_angle', name: '俯视', description: '从高处向下看' },
  { id: 'bird_eye', name: '鸟瞰', description: '正上方垂直俯视' },
  { id: 'worm_eye', name: '虫视', description: '极低角度仰视' },
  { id: 'dutch_angle', name: '倾斜', description: '镜头倾斜制造紧张感' },
];

// 灯光类型
export type LightingType = 'natural' | 'soft' | 'hard' | 'rembrandt' | 'backlight' | 'rim' | 'practical' | 'cinematic';

export const LIGHTING_TYPES: { id: LightingType; name: string; description: string }[] = [
  { id: 'natural', name: '自然光', description: '模拟自然日光' },
  { id: 'soft', name: '柔光', description: '柔和均匀的光线' },
  { id: 'hard', name: '硬光', description: '强烈对比的硬调光线' },
  { id: 'rembrandt', name: '伦勃朗光', description: '三角形布光' },
  { id: 'backlight', name: '逆光', description: '主体背后的光线' },
  { id: 'rim', name: '轮廓光', description: '边缘勾勒光线' },
  { id: 'practical', name: '实景光', description: '场景内实际光源' },
  { id: 'cinematic', name: '电影光', description: '戏剧性电影布光' },
];

// 氛围类型
export type MoodType = 'bright' | 'dark' | 'warm' | 'cool' | 'moody' | 'ethereal' | 'noir' | 'vibrant';

export const MOOD_TYPES: { id: MoodType; name: string; description: string }[] = [
  { id: 'bright', name: '明亮', description: '整体光线明亮' },
  { id: 'dark', name: '昏暗', description: '低光暗黑氛围' },
  { id: 'warm', name: '暖色调', description: '橙黄色温暖调' },
  { id: 'cool', name: '冷色调', description: '蓝青色冷调' },
  { id: 'moody', name: '忧郁', description: '低沉情绪氛围' },
  { id: 'ethereal', name: '空灵', description: '梦幻飘渺感' },
  { id: 'noir', name: '黑色电影', description: '黑白电影风格' },
  { id: 'vibrant', name: '活泼', description: '色彩鲜艳生动' },
];

export type WorkflowStepStatus = 'pending' | 'active' | 'completed' | 'error';

export interface WorkflowStep {
  id: number;
  title: string;
  description: string;
  status: WorkflowStepStatus;
}

// ============ 模型分类 ============

// 剧本生成模型
export type ScriptModel = 'deepseek-chat';

// 图片生成模型
export type ImageModel = 'doubao-seedream-4-0-250828';

// 视频生成模型
export type VideoModel = 'doubao-seedance-1-5-pro-251215';

// 视频模型时长配置
export interface DurationConfig {
  min: number;
  max: number;
  default: number;
  allowAuto: boolean;
}

// 模型能力支持配置
export interface ModelSupports {
  reference_image?: boolean;
  reference_video?: boolean;
  reference_audio?: boolean;
  [key: string]: any;
}

// 模型配置
export interface ModelConfig {
  id: string;
  name: string;
  type: 'script' | 'image' | 'video' | 'voice';
  description?: string;
  disabled?: boolean; // 可选：标记为禁用（如占位符模型）
  duration?: DurationConfig; // 仅视频模型有时长配置
  supports?: ModelSupports;
  priceType?: string; // 计费类型
  price?: number; // 单价（分）
  creditPrice?: number; // 积分单价
  creditPrice1080p?: number; // 1080p 视频积分单价
  provider?: string; // 供应商标识
  rpm?: number; // 每分钟请求数限制（文档/展示用途）
  concurrentLimit?: number; // 同一模型最大并发任务数（视频/音乐模型）
  ipm?: number; // 每分钟图片数限制（图片模型）
  recommended?: boolean; // 推荐模型（默认选中优先级：之前选中的 → 推荐的 → 列表第一个）
}

// 无可用模型占位符
export const NO_TEXT_MODEL: ModelConfig = {
  id: 'no-text-model',
  name: '无可用剧本模型',
  type: 'script',
  description: '当前没有可用的剧本生成模型，请检查后端配置',
  disabled: true,
};

export const NO_IMAGE_MODEL: ModelConfig = {
  id: 'no-image-model',
  name: '无可用图片模型',
  type: 'image',
  description: '当前没有可用的图片生成模型，请检查后端配置',
  disabled: true,
};

export const NO_VIDEO_MODEL: ModelConfig = {
  id: 'no-video-model',
  name: '无可用视频模型',
  type: 'video',
  description: '当前没有可用的视频生成模型，请检查后端配置',
  disabled: true,
};

export const NO_VOICE_MODEL: ModelConfig = {
  id: 'no-voice-model',
  name: '无可用音色模型',
  type: 'voice',
  description: '当前没有可用的音色设计模型，请检查后端配置',
  disabled: true,
};

// 模型列表
export const TEXT_MODELS: ModelConfig[] = [NO_TEXT_MODEL];

export const IMAGE_MODELS: ModelConfig[] = [NO_IMAGE_MODEL];

export const VIDEO_MODELS: ModelConfig[] = [NO_VIDEO_MODEL];

export const VOICE_MODELS: ModelConfig[] = [NO_VOICE_MODEL];

// 获取所有模型
export const ALL_MODELS = [...TEXT_MODELS, ...IMAGE_MODELS, ...VIDEO_MODELS, ...VOICE_MODELS];

// 根据类型获取模型
export const getModelsByType = (type: 'script' | 'image' | 'video' | 'voice'): ModelConfig[] => {
  switch (type) {
    case 'script':
      return TEXT_MODELS;
    case 'image':
      return IMAGE_MODELS;
    case 'video':
      return VIDEO_MODELS;
    case 'voice':
      return VOICE_MODELS;
    default:
      return [];
  }
};

// ============ 智能体类型（电影风格）============

export type AgentType =
  | 'realism'       // 写实主义
  | 'naturalism'     // 自然主义
  | 'romanticism'    // 浪漫主义
  | 'surrealism'     // 超现实主义
  | 'expressionism'  // 表现主义
  | 'noir'           // 黑色电影
  | 'documentary'    // 纪录片风格
  | 'anime';         // 动漫风格

export interface AgentTypeConfig {
  id: AgentType;
  name: string;
  icon: string;
  description: string;
  promptHint: string; // 生成剧本时的提示词补充
}

export const AGENT_TYPES: AgentTypeConfig[] = [
  { id: 'realism', name: '写实主义', icon: '📷', description: '贴近现实生活，真实细腻的叙事风格', promptHint: '写实风格，真实感强，细腻描写日常生活细节' },
  { id: 'naturalism', name: '自然主义', icon: '🌿', description: '强调自然环境和客观呈现', promptHint: '自然主义风格，注重环境描写，客观呈现现实' },
  { id: 'romanticism', name: '浪漫主义', icon: '🌹', description: '情感丰富，理想化的视觉风格', promptHint: '浪漫主义风格，情感充沛，理想化的画面感' },
  { id: 'surrealism', name: '超现实主义', icon: '🌙', description: '梦幻、扭曲现实的视觉表现', promptHint: '超现实风格，梦幻扭曲，潜意识意象' },
  { id: 'expressionism', name: '表现主义', icon: '🎨', description: '夸张变形，表达内心情感', promptHint: '表现主义风格，夸张变形，强烈情感表达' },
  { id: 'noir', name: '黑色电影', icon: '🌑', description: '阴暗、冷峻的氛围，营造悬疑感', promptHint: '黑色电影风格，阴暗冷峻，高对比度光影' },
  { id: 'documentary', name: '纪录片风格', icon: '🎥', description: '真实记录风格，客观叙事', promptHint: '纪录片风格，真实记录，客观冷静的叙事' },
  { id: 'anime', name: '动漫风格', icon: '✨', description: '动漫/卡通风格，明亮鲜艳', promptHint: '动漫风格，明亮色彩，卡通化视觉表现' },
];

// ============ AI 技能配置 ============

export type Skill =
  | 'character'      // 人物描写
  | 'scene'          // 场景渲染
  | 'dialogue'       // 对白创作
  | 'plot'           // 剧情编排
  | 'emotion'        // 情感刻画
  | 'suspense'       // 悬念制造
  | 'rhythm'         // 节奏把控
  | 'worldbuilding'; // 世界观构建

export interface SkillConfig {
  id: Skill;
  name: string;
  icon: string;
  description: string;
}

export const SKILLS: SkillConfig[] = [
  { id: 'character', name: '人物描写', icon: '👤', description: '深入刻画人物性格、外貌和内心世界' },
  { id: 'scene', name: '场景渲染', icon: '🎬', description: '营造氛围、描写环境和布景' },
  { id: 'dialogue', name: '对白创作', icon: '💬', description: '创作自然流畅、性格鲜明的对话' },
  { id: 'plot', name: '剧情编排', icon: '📖', description: '设计合理有趣的情节发展' },
  { id: 'emotion', name: '情感刻画', icon: '❤️', description: '细腻描写人物情感变化' },
  { id: 'suspense', name: '悬念制造', icon: '🎭', description: '制造紧张感和悬念' },
  { id: 'rhythm', name: '节奏把控', icon: '🎵', description: '控制故事节奏和叙事张力' },
  { id: 'worldbuilding', name: '世界观构建', icon: '🌍', description: '创建完整可信的世界观设定' },
];

// 音频资产
export interface AudioAsset {
  id: string;
  title: string;
  audioUrl: string;
  coverUrl?: string;
  duration?: number;
  source: 'library' | 'upload';
}
