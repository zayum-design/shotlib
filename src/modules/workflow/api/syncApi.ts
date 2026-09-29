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
 * 工作流同步 API(存根)
 *
 * 原版把工作流数据同步到服务端工作区/OSS 云端(图片换公网 URL、zip 打包下载);
 * 开源版数据全部保存在浏览器 IndexedDB,图片以本地 blob/dataURL 直接使用:
 * - syncWorkflowApi / syncWorkflowToCloudApi:空操作,原样返回数据 + 空 urlMapping
 *   (消费方按 urlMapping 做局部 URL 更新,空映射即恒等变换,天然 no-op)
 * - exportWorkflowZipApi:服务端打包能力已移除,直接抛错(本地导出走设置页 JSON 导出)
 */

export interface SyncWorkflowRequest {
  workflowData: Record<string, any>;
}

export interface SyncWorkflowResponse {
  success: boolean;
  message: string;
  data?: {
    workflowPath: string;
    filesPath: string;
    savedImages: string[];
  };
}

/**
 * 同步工作流到本地(开源版数据已在本地 IndexedDB,空操作)
 */
export async function syncWorkflowApi(
  _projectId: string,
  _workflowData: Record<string, any>,
  _category?: string
): Promise<SyncWorkflowResponse> {
  return { success: true, message: '开源版数据保存在浏览器本地,无需同步' };
}

export interface SyncWorkflowToCloudRequest {
  provider: 'amazon' | 'aliyun';
  workflowData: Record<string, any>;
}

export interface SyncWorkflowToCloudResponse {
  success: boolean;
  message: string;
  data?: {
    uploaded: string[];
    failed: string[];
    urlMapping?: Record<string, string>;
    workflowData?: Record<string, any>;
  };
}

/**
 * 同步工作流到云端(存根:原样返回数据 + 空 urlMapping,消费方 patch 逻辑退化为恒等)
 */
export async function syncWorkflowToCloudApi(
  _projectId: string,
  _provider: 'amazon' | 'aliyun',
  workflowData: Record<string, any>,
  _category?: string
): Promise<SyncWorkflowToCloudResponse> {
  return {
    success: true,
    message: '开源版无云端存储,图片直接使用本地数据',
    data: { uploaded: [], failed: [], urlMapping: {}, workflowData },
  };
}

/**
 * 导出工作流为 zip 打包文件(开源版已移除:需服务端下载资产打包;
 * 本地备份请使用设置页的项目 JSON 导出)
 */
export async function exportWorkflowZipApi(
  _projectId: string,
  _workflowData: Record<string, any>,
  _category?: string
): Promise<void> {
  throw new Error('开源版已移除服务端打包导出,请使用「设置 → 数据管理」的项目 JSON 导出');
}
