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
 * 用户素材库 API(开源版本地存根版)
 *
 * 原版把用户上传的素材(角色/场景参考图、真人核身资产)存到自建服务端 + OSS;
 * 开源版无后端,全部函数改为本地存根:
 * - 列表类返回空集合(素材库面板显示为空,不报错)
 * - 写入类返回失败 + 明确提示(UI 走已有的失败分支)
 * 所有导出的类型与函数签名保持不变,消费方零改动。
 */

export interface UserMaterialItem {
  id: number;
  userId: number;
  assetType: string;
  sourceUrl: string;
  data?: Record<string, any>;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ===== 真人资产(火山 Seedance 独有,依赖服务端核身回调,开源版整体禁用)=====
export interface RealPersonAssetItem {
  id: number;
  groupId: string;
  assetId: string;
  sourceUrl: string;
  status: string;
  name: string;
}

export interface RealPersonGroupItem {
  id: number;
  groupId: string;
  name: string;
  avatarUrl: string;
  assetCount: number;
  assets: RealPersonAssetItem[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** 统一的「功能不可用」失败响应 */
function unavailable<T>(data: T, message = '开源版不支持素材库云端存储,图片仅保存在当前项目中'): ApiResponse<T> {
  return { success: false, data, message };
}

/** GET /api/creator/user-materials?type=... → 开源版恒返回空素材库 */
export async function listUserMaterials(
  assetType: string = "character",
): Promise<ApiResponse<UserMaterialItem[]>> {
  void assetType;
  return { success: true, data: [] };
}

/** GET /api/creator/volcengine/real-person/groups → 开源版恒返回空分组 */
export async function listRealPersonGroups(): Promise<
  ApiResponse<RealPersonGroupItem[]>
> {
  return { success: true, data: [] };
}

/** POST /api/creator/volcengine/real-person/verify/start → 开源版不支持真人核身 */
export async function startRealPersonVerification(
  name?: string,
): Promise<ApiResponse<{ sessionId: string; h5Url: string }>> {
  void name;
  return unavailable({ sessionId: '', h5Url: '' }, '开源版不支持真人核身(需要服务端回调)');
}

/** GET /api/creator/volcengine/real-person/verify/poll → 开源版恒失败 */
export async function pollRealPersonVerification(
  sessionId: string,
): Promise<
  ApiResponse<{
    status: string;
    groupId?: string;
    name?: string;
    errorMessage?: string;
  }>
> {
  void sessionId;
  return unavailable({ status: 'failed' }, '开源版不支持真人核身(需要服务端回调)');
}

/** POST /api/creator/volcengine/real-person/verify/complete → 开源版恒失败 */
export async function completeVerification(
  bytedToken: string,
  resultCode: string,
): Promise<ApiResponse<{ groupId: string; verified: boolean }>> {
  void bytedToken;
  void resultCode;
  return unavailable({ groupId: '', verified: false }, '开源版不支持真人核身(需要服务端回调)');
}

/** GET /api/creator/volcengine/real-person/verify/existing → 开源版恒无进行中会话 */
export async function getExistingRealPersonSession(): Promise<
  ApiResponse<{
    sessionId?: string;
    groupId?: string;
    name?: string;
    status?: string;
  }>
> {
  return { success: true, data: {} };
}

/** POST /api/creator/volcengine/real-person/assets → 开源版不支持 */
export async function createRealPersonAsset(
  groupId: string,
  imageUrl: string,
  name?: string,
): Promise<ApiResponse<RealPersonAssetItem>> {
  void groupId;
  void imageUrl;
  void name;
  return unavailable({} as RealPersonAssetItem);
}

/** DELETE /api/creator/volcengine/real-person/assets/:id → 开源版不支持 */
export async function deleteRealPersonAsset(
  id: number,
): Promise<ApiResponse<null>> {
  void id;
  return unavailable(null);
}

/** GET /api/creator/user-materials/aigc/group → 开源版不支持 */
export async function getOrCreateAigcGroup(): Promise<
  ApiResponse<{ groupId: string }>
> {
  return unavailable({ groupId: '' });
}

/** POST /api/creator/user-materials/aigc/create → 开源版不支持 */
export async function createAigcAsset(
  groupId: string,
  imageUrl: string,
): Promise<
  ApiResponse<{ assetId: string; groupId: string; sourceUrl: string }>
> {
  void groupId;
  void imageUrl;
  return unavailable({ assetId: '', groupId: '', sourceUrl: '' });
}

/** POST /api/creator/user-materials → 开源版不支持(素材不入云库) */
export async function createLocalAsset(
  imageUrl: string,
  assetType: string = "image",
  name?: string,
  description?: string,
  data?: Record<string, any>,
): Promise<ApiResponse<UserMaterialItem>> {
  void imageUrl;
  void assetType;
  void name;
  void description;
  void data;
  return unavailable({} as unknown as UserMaterialItem);
}

/** POST /api/creator/user-materials/character/compliance-create → 开源版不支持 */
export async function createCharacterComplianceAsset(
  imageUrl: string,
  sourceUrl: string,
  data: Record<string, any>,
  name?: string,
): Promise<ApiResponse<UserMaterialItem>> {
  void imageUrl;
  void sourceUrl;
  void data;
  void name;
  return unavailable({} as unknown as UserMaterialItem);
}

/** DELETE /api/creator/user-materials/:id → 开源版不支持 */
export async function deleteUserMaterial(
  id: number,
): Promise<ApiResponse<null>> {
  void id;
  return unavailable(null);
}
