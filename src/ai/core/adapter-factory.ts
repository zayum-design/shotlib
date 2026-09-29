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
 * 适配器工厂:按 (供应商, 任务类型) 返回对应适配器单例
 * 替代后端 AiService 的适配器路由;构造只做 model.json 变体过滤,无 IO
 */
import type { BaseAdapter } from './base-adapter';
import { findProviderByVariantId } from './model-registry';
import { DeepSeekAdapter } from '../providers/deepseek/deepseek.adapter';
import { MoonshotAdapter } from '../providers/moonshot/moonshot.adapter';
import { VolcEngineTextAdapter } from '../providers/volcengine/volcengine-text.adapter';
import { VolcEngineImageAdapter } from '../providers/volcengine/volcengine-image.adapter';
import { VolcEngineVideoAdapter } from '../providers/volcengine/volcengine-video.adapter';
import { AliyunImageAdapter } from '../providers/aliyun/aliyun-image.adapter';
import { AliyunVideoAdapter } from '../providers/aliyun/aliyun-video.adapter';
import { MiniMaxAdapter } from '../providers/minimaxi/minimaxi.adapter';
import { MiniMaxVideoAdapter } from '../providers/minimaxi/minimaxi-video.adapter';

/** 惰性单例:首次访问时实例化 */
let cache: {
  text: Map<string, BaseAdapter>;
  image: Map<string, BaseAdapter>;
  video: Map<string, BaseAdapter>;
} | null = null;

function getCache() {
  if (!cache) {
    cache = {
      text: new Map<string, BaseAdapter>([
        ['deepseek', new DeepSeekAdapter()],
        ['moonshot', new MoonshotAdapter()],
        ['volcengine', new VolcEngineTextAdapter()],
        ['minimaxi', new MiniMaxAdapter()],
      ]),
      image: new Map<string, BaseAdapter>([
        ['volcengine', new VolcEngineImageAdapter()],
        ['aliyun', new AliyunImageAdapter()],
      ]),
      video: new Map<string, BaseAdapter>([
        ['volcengine', new VolcEngineVideoAdapter()],
        ['aliyun', new AliyunVideoAdapter()],
        ['minimaxi', new MiniMaxVideoAdapter()],
      ]),
    };
  }
  return cache;
}

/** 按供应商与任务类型取适配器;未注册组合返回 undefined */
export function createAdapter(
  providerId: string,
  taskType: 'text' | 'image' | 'video',
): BaseAdapter | undefined {
  return getCache()[taskType].get(providerId);
}

/** 按变体 id 反查供应商并取适配器 */
export function createAdapterForModel(
  modelId: string,
  taskType: 'text' | 'image' | 'video',
): BaseAdapter | undefined {
  const providerId = findProviderByVariantId(modelId);
  return providerId ? createAdapter(providerId, taskType) : undefined;
}
