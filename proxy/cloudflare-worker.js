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
 * Cloudflare Worker 通用转发代理(单文件,零依赖)
 *
 * 约定:收到 `?url=<encodeURIComponent(目标URL)>` 后,原样转发请求方法/头/体,
 * 并在响应上回加 CORS 头,解决国内部分 AI 厂商接口不允许浏览器直连的问题。
 *
 * 部署:
 *   1. 登录 Cloudflare Dashboard → Workers & Pages → Create Worker
 *   2. 粘贴本文件全部内容,Deploy
 *   3. (可选)在 Worker 的 Settings → Variables 添加 ACCESS_TOKEN,开启简单鉴权
 *   4. 在本应用「设置 → 网络」填入 Worker 地址,并为需要走代理的厂商打开开关
 *
 * 安全提示:公开部署时务必设置 ACCESS_TOKEN,否则你的 Worker 会被第三方白嫖流量。
 */

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    };

    // 预检请求直接放行
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const targetUrl = new URL(request.url).searchParams.get('url');
    if (!targetUrl) {
      return jsonResponse({ error: '缺少 ?url= 参数' }, 400, corsHeaders);
    }

    // 可选鉴权:header 优先,其次查询参数
    if (env.ACCESS_TOKEN) {
      const token =
        request.headers.get('X-Proxy-Token') ||
        new URL(request.url).searchParams.get('token');
      if (token !== env.ACCESS_TOKEN) {
        return jsonResponse({ error: '未授权的代理访问' }, 401, corsHeaders);
      }
    }

    // 只允许 http/https 目标,防 SSRF 滥用
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return jsonResponse({ error: '非法的目标 URL' }, 400, corsHeaders);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return jsonResponse({ error: '仅支持 http/https 目标' }, 400, corsHeaders);
    }

    // 原样转发:方法 / 头(去掉浏览器自动加的 host 系列头)/ 体
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('origin');
    headers.delete('referer');
    headers.delete('x-proxy-token');

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      // @ts-ignore Cloudflare Workers 支持 duplex 流式转发
      duplex: 'half',
      redirect: 'follow',
    });

    // 回传响应:透传状态/头,叠加 CORS
    const respHeaders = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(corsHeaders)) {
      respHeaders.set(k, v);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};

function jsonResponse(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
