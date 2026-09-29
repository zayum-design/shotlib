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
 * 合规检查 helper 工厂（按 provider 注册）。
 *
 * 参照 `video-prompt-factory.ts` 的模式：新增合规厂商时在此注册即可，
 * 调用方按 provider 标识取 helper，不接触厂商专属常量。
 */
import {
  buildSeedanceCompliance,
  readSeedanceCompliance,
  toAssetUrl,
  isAssetUrl,
  parseAssetUrl,
  isComplianceRequired,
  resolveReferenceUrl,
  type SeedanceCompliance,
} from './volcengine/compliance';

export interface ComplianceHelpers {
  /** 判断该模型是否需要资产合规检查（参考图须替换为厂商资产 URL 提交） */
  isComplianceRequired: (modelConfig?: { supports?: Record<string, any> } | null) => boolean;
  /** 由合规 payload 构造 image_asset.data 的 patch（顶层 key 由厂商决定） */
  buildCompliancePatch: (payload: SeedanceCompliance) => Record<string, SeedanceCompliance>;
  /** 从 image_asset.data 读取合规信息 */
  readCompliance: (data?: Record<string, any>) => SeedanceCompliance | undefined;
  /** 由合规 assetId 构造厂商资产 URL（如 asset://） */
  toAssetUrl: (assetId: string) => string;
  /** 将原始图片 URL 解析为厂商资产 URL（优先 seedanceAssetId，其次 passThrough 映射） */
  resolveReferenceUrl: (
    url: string,
    seedanceAssetId?: string,
    passThroughAssetIdMap?: Map<string, string>,
  ) => string;
  isAssetUrl: (url?: string) => boolean;
  parseAssetUrl: (url?: string) => string | undefined;
}

const COMPLIANCE_PROVIDERS: Record<string, ComplianceHelpers> = {
  volcengine: {
    isComplianceRequired,
    buildCompliancePatch: buildSeedanceCompliance,
    readCompliance: readSeedanceCompliance,
    toAssetUrl,
    resolveReferenceUrl,
    isAssetUrl,
    parseAssetUrl,
  },
};

/**
 * 根据 provider 标识获取合规 helper。
 * @param provider 模型 provider（来自 model.json，如 volcengine）
 */
export function getComplianceHelpers(provider?: string): ComplianceHelpers | undefined {
  if (!provider) return undefined;
  return COMPLIANCE_PROVIDERS[provider];
}

/**
 * 遍历所有已注册厂商的 reader，返回首个命中的合规信息。
 * 用于加载时还原角色图片合规状态（无 provider 上下文）。
 */
export function readAnyCompliance(data?: Record<string, any>): SeedanceCompliance | undefined {
  for (const provider of Object.values(COMPLIANCE_PROVIDERS)) {
    const compliance = provider.readCompliance(data);
    if (compliance) return compliance;
  }
  return undefined;
}
