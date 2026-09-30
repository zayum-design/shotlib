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
 * oss-upload.service.ts — 生成图片的对象存储直传(阿里云 OSS)
 *
 * 背景:厂商返回的图片 URL 是带过期时限的签名地址(TOS 24h 等),后续视频生成
 * 以图片 URL 作参考图时可能已失效。配置 OSS 后,生成的图片立即上传,换成
 * 持久的公共 URL 再进入业务数据。
 *
 * 实现:OSS V1 签名(Web Crypto HMAC-SHA1,零依赖),PUT 直传。
 * 上传请求优先经部署代理转发(与厂商 API 同一套 proxyUrl),避免 OSS 未配 CORS
 * 时被浏览器拦截;代理会透传 Authorization/Date/Content-Type,V1 签名不受影响。
 *
 * 要求:bucket 为公共读(厂商服务器要能直接拉取参考图)。
 */
import { settingsRepo, type OssConfig } from '@/storage/settingsRepo';
import { buildProxyUrl } from '@/ai/core/client';

/** OSS V1 签名(HMAC-SHA1 → base64) */
async function ossSignV1(
  accessKeySecret: string,
  stringToSign: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(accessKeySecret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(stringToSign));
  let binary = '';
  for (const b of new Uint8Array(sig)) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** 推断对象扩展名(Blob.type → jpeg/png/webp;未知用 png 兜底) */
function extFromMime(mime: string): string {
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'png';
}

/** 外网访问 host:bucket 拼自定义 endpoint 或默认地域域名 */
function ossHost(oss: OssConfig): string {
  const endpoint = (oss.endpoint || `https://${oss.region}.aliyuncs.com`).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `${oss.bucket}.${endpoint}`;
}

/** 最终可公开访问的 URL(publicBaseUrl(CDN) 优先) */
function publicUrl(oss: OssConfig, key: string): string {
  if (oss.publicBaseUrl) {
    return `${oss.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  }
  return `https://${ossHost(oss)}/${key}`;
}

/**
 * 上传 Blob 到阿里云 OSS,返回持久公共 URL。
 * @param keyPrefix 对象 key 前缀(如 shotlib/{projectId}/{assetType})
 * @throws 上传失败(网络/签名/权限)时抛错,由调用方降级
 */
export async function uploadBlobToOss(
  blob: Blob,
  oss: OssConfig,
  keyPrefix: string,
  filenameBase: string,
): Promise<string> {
  const key = `${keyPrefix.replace(/^\/+|\/+$/g, '')}/${filenameBase}.${extFromMime(blob.type)}`;
  const contentType = blob.type || 'application/octet-stream';
  // 注意:Date 是浏览器 fetch 的 forbidden header(设置会被静默丢弃),必须用 x-oss-date 代替。
  // V1 签名规则(对齐 ali-oss buildCanonicalString):Date 位置填 x-oss-date 的值,
  // 且 x-oss-date 同时作为 CanonicalizedOSSHeaders 出现一次
  const date = new Date().toUTCString();
  const stringToSign = `PUT\n\n${contentType}\n${date}\nx-oss-date:${date}\n/${oss.bucket}/${key}`;
  const signature = await ossSignV1(oss.accessKeySecret, stringToSign);

  const headers: Record<string, string> = {
    Authorization: `OSS ${oss.accessKeyId}:${signature}`,
    'x-oss-date': date,
    'Content-Type': contentType,
  };

  const targetUrl = `https://${ossHost(oss)}/${key}`;
  // 优先经部署代理转发(同源,免 OSS CORS 配置);未配代理时直连(要求 bucket 已配 CORS)
  const { proxyUrl } = await settingsRepo.get();
  const requestUrl = proxyUrl ? buildProxyUrl(proxyUrl, targetUrl) : targetUrl;

  const resp = await fetch(requestUrl, {
    method: 'PUT',
    headers,
    body: blob,
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`OSS 上传失败: HTTP ${resp.status} ${detail.slice(0, 200)}`);
  }
  return publicUrl(oss, key);
}

/**
 * 便捷封装:读取 settingsRepo 的 OSS 配置并上传;未配置 OSS 时返回 null(调用方降级)。
 */
export async function uploadImageAssetToOss(
  blob: Blob,
  projectId: string,
  assetType: string,
  assetId: string,
): Promise<string | null> {
  const { oss } = await settingsRepo.get();
  if (!oss?.bucket || !oss.accessKeyId || !oss.accessKeySecret) return null;
  return uploadBlobToOss(blob, oss, `shotlib/${projectId}/${assetType}`, assetId);
}
