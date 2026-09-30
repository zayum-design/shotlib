#!/usr/bin/env node
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
 * shotlib 可选轻量代理(Node 版,零依赖)
 *
 * 用法:
 *   node proxy/node-proxy.mjs [端口]        # 默认 8787
 *   ACCESS_TOKEN=your-secret node proxy/node-proxy.mjs
 *
 * 语义与 cloudflare-worker.js 完全一致:
 *   GET/POST/PUT/PATCH/DELETE  {代理地址}?url=<encodeURIComponent(目标URL)>
 *   - 原样转发请求方法、头、体,回传响应并附加 CORS 头
 *   - 可选 ACCESS_TOKEN:设置后请求须带 x-proxy-token 头(或 ?token= 参数)
 *
 * 为什么需要它:部分厂商接口(火山方舟/阿里云百炼/MiniMax)不允许浏览器跨域直连,
 * 浏览器 fetch 会被 CORS 拦截;此代理在服务端转发并回加 CORS 头。
 * 注意:代理仅转发 HTTPS 接口请求,请自行做好访问控制(建议设置 ACCESS_TOKEN)。
 */
import http from 'node:http';

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';

/** CORS 响应头(允许任意来源 —— 部署者可用网关层收紧) */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

/** 不透传的逐跳头(host 重算,content-length 由 fetch 重算) */
const HOP_HEADERS = new Set(['host', 'content-length', 'connection', 'keep-alive']);

function sendCors(res, status, body, contentType) {
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': contentType || 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  // 预检请求直接放行
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const target = requestUrl.searchParams.get('url');

  if (!target) {
    sendCors(
      res,
      400,
      '缺少 ?url= 参数。用法:{代理地址}?url=<encodeURIComponent(目标URL)>',
    );
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    sendCors(res, 400, `目标地址非法: ${target}`);
    return;
  }
  if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
    sendCors(res, 400, `仅支持 http/https 目标: ${targetUrl.protocol}`);
    return;
  }

  // 可选访问令牌
  if (ACCESS_TOKEN) {
    const token = req.headers['x-proxy-token'] || requestUrl.searchParams.get('token');
    if (token !== ACCESS_TOKEN) {
      sendCors(res, 401, '代理令牌无效(需 x-proxy-token 头或 ?token= 参数)');
      return;
    }
  }

  // 读取请求体(厂商接口最大请求体 ~10MB,留足余量)
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  // 透传请求头(剔除逐跳头;Authorization/Cookie 等原样转发)
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_HEADERS.has(name) && value !== undefined) {
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  delete headers['x-proxy-token'];

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
      redirect: 'follow',
    });

    // 透传响应头(剔除压缩与逐跳头,长度由 Node 重算)
    // 注意:上游的 access-control-* 头必须剔除 —— undici 返回小写头名,
    // 与 CORS_HEADERS 的大写键在 writeHead 中会变成两个同名头(如 '*, http://origin'),
    // 浏览器按不区分大小写合并后判定重复值直接拒掉(CORS: multiple values)
    const respHeaders = {};
    upstream.headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(lower)) return;
      if (lower.startsWith('access-control-')) return;
      respHeaders[name] = value;
    });
    res.writeHead(upstream.status, { ...CORS_HEADERS, ...respHeaders });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    sendCors(res, 502, `代理转发失败: ${error instanceof Error ? error.message : String(error)}`);
  }
});

server.listen(PORT, () => {
  console.log(`[shotlib-proxy] 已启动: http://127.0.0.1:${PORT}${ACCESS_TOKEN ? '(已启用访问令牌)' : ''}`);
});
