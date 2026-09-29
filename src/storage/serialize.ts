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
 * serialize.ts — 存储序列化工具
 *
 * 本地持久化同样要防止巨型 base64 混入主数据:
 * 图片二进制一律走 imageRepo 的 blob 记录,主数据只引用 assetId。
 */

/** 递归剔除对象中的 base64 data URI,避免存储记录过大 */
export function stripBase64Fields(obj: any): any {
  if (typeof obj === 'string' && obj.startsWith('data:')) {
    return '';
  }
  if (Array.isArray(obj)) {
    return obj.map(stripBase64Fields);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      result[key] = stripBase64Fields(obj[key]);
    }
    return result;
  }
  return obj;
}
