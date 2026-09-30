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
 * 原版把用户上传的素材(角色/场景参考图)存到自建服务端 + OSS;
 * 开源版无后端,全部函数改为本地存根:
 * - 写入类返回失败 + 明确提示(UI 走已有的失败分支)
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

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** 统一的「功能不可用」失败响应 */
function unavailable<T>(data: T, message = '开源版不支持素材库云端存储,图片仅保存在当前项目中'): ApiResponse<T> {
  return { success: false, data, message };
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

