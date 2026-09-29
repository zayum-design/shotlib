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
 * model-registry — 模型配置注册表(替代后端 GET /models + ModelConfigService)
 *
 * 构建期内联 config/models/*.json,运行时提供:
 * - 模型列表扁平化(flatten variants → ModelInfo[],与原前端 modelApi.ModelInfo 形状一致,去积分字段)
 * - 供应商级查询:按变体反查供应商 / 变体 baseUrl / 速率限制 / 代理默认建议
 *
 * 所有供应商映射关系(代理建议等)只从 model.json 的 config 段读取,
 * 禁止在业务代码中用字符串匹配推断供应商。
 */
import aliyunJson from '@/config/models/aliyun.json';
import deepseekJson from '@/config/models/deepseek.json';
import minimaxiJson from '@/config/models/minimaxi.json';
import moonshotJson from '@/config/models/moonshot.json';
import nanoBananaJson from '@/config/models/nano-banana.json';
import sunoJson from '@/config/models/suno.json';
import volcengineJson from '@/config/models/volcengine.json';

/** model.json 变体段(与后端 VariantConfig 对齐,保留厂商专用字段) */
export interface ProviderVariant {
  id: string;
  name: string;
  /** 变体类型(来自 model.json,宽 string,调用方按值比较) */
  type: string;
  baseUrl?: string;
  description?: string;
  enabled: boolean;
  duration?: {
    min: number;
    max: number;
    default: number;
    allowAuto: boolean;
  };
  supports?: Record<string, unknown>;
  priceType?: string;
  price?: number;
  apiDocUrl?: string;
  /** 每分钟请求数限制 */
  rpm?: number;
  /** 同时运行任务数限制(视频/音乐模型) */
  concurrent_limit?: number;
  /** 每分钟图片数限制(图片模型) */
  ipm?: number;
  recommended?: boolean;
  /** 厂商专用扩展字段(reasoning / maxOutputTokens 等)原样保留 */
  [key: string]: unknown;
}

/** model.json 顶层形状 */
export interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  variants?: ProviderVariant[];
  config?: {
    apiKeyEnv?: string;
    /** 是否默认建议走代理(可被用户设置覆盖) */
    proxyDefault?: boolean;
    /** 推理模型追加的输出预算 */
    reasoningTokenBuffer?: number;
  };
  apiDocUrl?: string;
}

/** 前端模型列表条目(与原 workflow/api/modelApi.ModelInfo 形状一致,去积分字段) */
export interface ModelInfo {
  id: string;
  name: string;
  /** 模型类型(宽 string,与原 modelApi.ModelInfo 一致) */
  type: string;
  description?: string;
  enabled?: boolean;
  duration?: ProviderVariant['duration'];
  supports?: Record<string, unknown>;
  priceType?: string;
  price?: number;
  provider?: string;
  rpm?: number;
  concurrentLimit?: number;
  ipm?: number;
  recommended?: boolean;
}

const PROVIDER_CONFIGS: ProviderConfig[] = [
  aliyunJson,
  deepseekJson,
  minimaxiJson,
  moonshotJson,
  nanoBananaJson,
  sunoJson,
  volcengineJson,
] as unknown as ProviderConfig[];

/** 全部供应商原始配置 */
export function getAllProviderConfigs(): ProviderConfig[] {
  return PROVIDER_CONFIGS;
}

/** 按供应商 id 查配置 */
export function getProviderConfig(providerId: string): ProviderConfig | undefined {
  return PROVIDER_CONFIGS.find((c) => c.id === providerId);
}

/** 该供应商是否默认建议走代理(用户可在设置中按厂商覆盖) */
export function getProviderProxyDefault(providerId: string): boolean {
  return getProviderConfig(providerId)?.config?.proxyDefault === true;
}

/** 按变体 id 反查供应商 id(仅启用变体) */
export function findProviderByVariantId(variantId: string): string | undefined {
  for (const config of PROVIDER_CONFIGS) {
    if (config.variants?.some((v) => v.id === variantId && v.enabled)) {
      return config.id;
    }
  }
  return undefined;
}

/** 按变体 id 查原始变体配置(含厂商专用字段,不限启用状态) */
export function getVariantConfig(variantId: string): ProviderVariant | undefined {
  for (const config of PROVIDER_CONFIGS) {
    const variant = config.variants?.find((v) => v.id === variantId);
    if (variant) return variant;
  }
  return undefined;
}

/** 变体 baseUrl:变体声明优先,回退到 model.json 变体默认(空) */
export function getVariantBaseUrl(variantId: string): string | undefined {
  return getVariantConfig(variantId)?.baseUrl;
}

/** 变体速率限制(带默认值) */
export function getVariantRateLimits(variantId: string): {
  rpm: number;
  concurrentLimit?: number;
  ipm?: number;
} {
  const variant = getVariantConfig(variantId);
  return {
    rpm: variant?.rpm ?? 100,
    concurrentLimit: variant?.concurrent_limit,
    ipm: variant?.ipm,
  };
}

/** 供应商推理 token 追加预算(deepseek/minimaxi/volcengine 文本模型用) */
export function getProviderReasoningTokenBuffer(providerId: string): number {
  return getProviderConfig(providerId)?.config?.reasoningTokenBuffer ?? 0;
}

/** 全部启用变体 → ModelInfo[](替代 GET /models,已去积分字段) */
export function getEnabledModelInfos(): ModelInfo[] {
  const result: ModelInfo[] = [];
  for (const config of PROVIDER_CONFIGS) {
    for (const variant of config.variants || []) {
      if (!variant.enabled) continue;
      result.push({
        id: variant.id,
        name: variant.name,
        type: variant.type,
        description: variant.description || config.description || '',
        enabled: variant.enabled,
        duration: variant.duration,
        supports: variant.supports,
        priceType: variant.priceType,
        price: variant.price,
        provider: config.id,
        rpm: variant.rpm,
        concurrentLimit: variant.concurrent_limit,
        ipm: variant.ipm,
        recommended: variant.recommended,
      });
    }
  }
  return result;
}

/** 按类型取启用模型 */
export function getModelsByType(
  type: ModelInfo['type'],
): ModelInfo[] {
  return getEnabledModelInfos().filter((m) => m.type === type);
}

/** 指定类型的默认模型(第一个启用变体,对齐后端 ModelMetadataService.getDefaultModelId) */
export function getDefaultModelId(type: ModelInfo['type']): string {
  return getModelsByType(type)[0]?.id || '';
}
