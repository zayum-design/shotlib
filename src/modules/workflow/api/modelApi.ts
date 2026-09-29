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
 * 模型列表 API(纯前端版)
 *
 * 原版从服务端拉取模型列表;开源版改为读取内置 model.json 配置(model-registry)。
 */
import { getEnabledModelInfos } from '@/ai/core/model-registry';
import type { ApiResponse } from './types';

export interface DurationConfig {
  min: number;
  max: number;
  default: number;
  allowAuto: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  type: 'text' | 'image' | 'video' | 'voice';
  description?: string;
  enabled?: boolean;
  duration?: DurationConfig;
  supports?: {
    text_to_video?: boolean;
    first_frame?: boolean;
    last_frame?: boolean;
    reference_image?: boolean;
    reference_video?: boolean;
    reference_audio?: boolean;
    generate_audio?: boolean;
    resolution?: boolean;
    ratio?: boolean;
    duration?: boolean;
    watermark?: boolean;
    seed?: boolean;
    negative_prompt?: boolean;
    prompt_extend?: boolean;
    requires_compliance?: boolean;
    [key: string]: any;
  };
  priceType?: string;
  price?: number;
  creditPrice?: number;
  creditPrice1080p?: number;
  provider?: string;
  rpm?: number;
  concurrentLimit?: number;
  ipm?: number;
  /** 推荐模型标记(model.json variant.recommended) */
  recommended?: boolean;
}

export interface GetModelsResponse {
  models: ModelInfo[];
  /**
   * 场景图片画面比例(开源版不再由服务端下发,恒为 null,前端回退到项目比例)
   */
  sceneImageAspectRatio?: string | null;
}

/**
 * 获取可用模型列表(内置配置)
 */
export async function getModelsApi(): Promise<ApiResponse<GetModelsResponse>> {
  const models = getEnabledModelInfos() as unknown as ModelInfo[];
  return { success: true, data: { models, sceneImageAspectRatio: null } };
}
