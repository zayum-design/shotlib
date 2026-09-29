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
 * 火山引擎 Seedance 合规检查相关常量与纯函数（前端）。
 *
 * 合规检查是 Seedance 专属能力，其 data key（`seedance`）、URL scheme（`asset://`）
 * 以及「是否需要资产合规」的判定（读取本厂商 model.json 的 supports 标志）都集中在此。
 * 通用组件/store 不得硬编码这些字面量或标志名，应通过
 * `providers/compliance-factory.ts` 按 provider 获取 helper。
 */

/** image_asset.data 中存放 Seedance 合规信息的 key */
export const SEEDANCE_DATA_KEY = 'seedance';

/** Seedance 资产 URL 协议前缀 */
export const ASSET_URL_SCHEME = 'asset://';

/** 本厂商 model.json 中标记「需要资产合规检查」的 supports 字段 */
const COMPLIANCE_FLAG = 'requires_compliance';

export interface SeedanceCompliance {
  /** 火山引擎 AIGC assetId（asset-xxx） */
  assetId: string;
  isCompliant: boolean;
  /** AIGC 素材组 ID */
  groupId?: string;
  /** 入库后可访问 URL（createAigcAsset 返回的 sourceUrl） */
  url?: string;
}

/**
 * 判断该模型是否需要 Seedance 资产合规检查（即参考图须替换为 asset://assetId 提交）。
 * 仅当本厂商 model.json 的 supports.requires_compliance 为 true 时成立。
 */
export function isComplianceRequired(
  modelConfig?: { supports?: Record<string, any> } | null,
): boolean {
  return !!modelConfig?.supports?.[COMPLIANCE_FLAG];
}

/** 构建 image_asset.data 的 seedance patch（浅合并到 data 顶层） */
export function buildSeedanceCompliance(
  payload: SeedanceCompliance,
): Record<string, SeedanceCompliance> {
  return { [SEEDANCE_DATA_KEY]: payload };
}

/** 从 image_asset.data 读取 Seedance 合规信息 */
export function readSeedanceCompliance(
  data?: Record<string, any>,
): SeedanceCompliance | undefined {
  return data?.[SEEDANCE_DATA_KEY] as SeedanceCompliance | undefined;
}

/**
 * 将原始图片 URL 解析为厂商资产 URL（asset://assetId）。
 * 优先用图片自身的合规 assetId，其次用 passThrough 映射；都没有则返回原 URL。
 */
export function resolveReferenceUrl(
  url: string,
  seedanceAssetId?: string,
  passThroughAssetIdMap?: Map<string, string>,
): string {
  if (!url) return url;
  const assetId = seedanceAssetId || passThroughAssetIdMap?.get(url);
  return assetId ? toAssetUrl(assetId) : url;
}

/** 由火山 assetId 构造 asset:// URL */
export function toAssetUrl(assetId: string): string {
  return `${ASSET_URL_SCHEME}${assetId}`;
}

/** 判断 URL 是否为 Seedance asset:// 协议 */
export function isAssetUrl(url?: string): boolean {
  return !!url && url.startsWith(ASSET_URL_SCHEME);
}

/** 从 asset:// URL 解析出火山 assetId */
export function parseAssetUrl(url?: string): string | undefined {
  if (!isAssetUrl(url)) return undefined;
  return url!.slice(ASSET_URL_SCHEME.length);
}
