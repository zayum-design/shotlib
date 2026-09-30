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
 * shotlib 本地静态部署服务器(零依赖)
 *
 * 用法:
 *   node scripts/serve.mjs [--port 8080] [--host 127.0.0.1]
 *
 * - 服务 dist/ 构建产物,未命中路径回退 index.html(SPA)
 * - /app-config.json 动态映射 runtime/app-config.json(no-store):
 *   CLI(npm run cli)修改配置后刷新页面即生效,无需重新构建
 *
 * 安全提示:runtime/app-config.json 含明文 API Key,默认只绑定 127.0.0.1;
 * 使用 --host 0.0.0.0 等对外地址前请自行做好访问控制。
 */
import { createServer } from 'node:http';
import { readFile, stat, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const RUNTIME_CONFIG = path.join(ROOT, 'runtime', 'app-config.json');

// ---------- 前端日志落盘(参照 backend log-writer:logs/web/日期/小时.log) ----------

/** 上海时区时间串(与 backend 一致) */
function shanghaiParts() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: get('hour'), time: `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}` };
}

const LOG_BODY_LIMIT = 2 * 1024 * 1024; // 单条日志上限 2MB

async function handleLogWrite(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LOG_BODY_LIMIT) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'log too large' }));
      return;
    }
    chunks.push(chunk);
  }
  let entry;
  try {
    entry = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!entry || typeof entry !== 'object') throw new Error('not an object');
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'invalid json' }));
    return;
  }

  const { date, hour, time } = shanghaiParts();
  const dir = path.join(ROOT, 'logs', 'web', date);
  const file = path.join(dir, `${hour}.log`);
  try {
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({ ...entry, _logTime: time }, null, 2) + '\n---\n';
    await appendFile(file, line, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (e) {
    console.error('[serve] 写入日志失败:', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'write failed' }));
  }
}

// ---------- 参数解析 ----------

function parseArgs() {
  const options = { port: Number(process.env.PORT) || 8080, host: process.env.HOST || '127.0.0.1' };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') options.port = Number(args[++i]);
    else if (args[i] === '--host' || args[i] === '-H') options.host = args[++i];
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('用法: node scripts/serve.mjs [--port 8080] [--host 127.0.0.1]');
      process.exit(0);
    } else {
      console.error(`未知参数:${args[i]}`);
      process.exit(1);
    }
  }
  return options;
}

// ---------- 静态文件服务 ----------

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/** 发送文件(找不到返回 null,由调用方决定回退) */
async function sendFile(res, filePath, { cacheControl = 'no-cache' } = {}) {
  let fileStat;
  try {
    fileStat = await stat(filePath);
    if (!fileStat.isFile()) return null;
  } catch {
    return null;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cacheControl,
    });
    res.end(body);
    return true;
  } catch {
    return null;
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ---------- 请求处理 ----------

const { port, host } = parseArgs();

const server = createServer(async (req, res) => {
  // 前端日志落盘端点(logStore.addLog 统一上报)
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/logs') {
    await handleLogWrite(req, res);
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET, POST /logs' });
    res.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    pathname = '/';
  }

  // 部署级配置:动态映射 runtime/app-config.json(CLI 写入),始终不缓存
  if (pathname === '/app-config.json') {
    if (existsSync(RUNTIME_CONFIG)) {
      const applied = await sendFile(res, RUNTIME_CONFIG, { cacheControl: 'no-store' });
      if (applied) return;
      sendJson(res, 500, { error: 'failed to read runtime config' });
    } else {
      sendJson(res, 404, { error: 'not configured, run `npm run cli` first' });
    }
    return;
  }

  // 解析静态文件(限定在 dist/ 内,防目录穿越)
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(DIST_DIR, relative);
  if (!filePath.startsWith(DIST_DIR + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }

  // 带 hash 的构建产物可长缓存;其余(含 index.html)不缓存
  const isHashedAsset = filePath.startsWith(path.join(DIST_DIR, 'assets') + path.sep);
  const sent = await sendFile(res, filePath, { cacheControl: isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache' });
  if (sent) return;

  // SPA 回退:无扩展名的路径交给前端路由
  if (!path.extname(pathname)) {
    const fallback = await sendFile(res, path.join(DIST_DIR, 'index.html'));
    if (fallback) return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ 端口 ${port} 已被占用,换一个试试:node scripts/serve.mjs --port <其它端口>`);
  } else {
    console.error('❌ 服务器启动失败:', err.message);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  const configured = existsSync(RUNTIME_CONFIG);
  console.log('──────────────────────────────────────────────');
  console.log('  ShotLib 本地部署已启动');
  console.log(`  ➜ 地址: http://${host}:${port}`);
  if (!configured) {
    console.log('  ⚠️ 尚未配置 API Key:运行 npm run cli 配置各厂商 Key 与默认模型');
  } else {
    console.log('  ✓ 已加载部署级配置(runtime/app-config.json),修改后刷新页面即生效');
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.log('  ⚠️ 正在监听非回环地址:/app-config.json 含明文 API Key,请注意访问控制');
  }
  console.log('  按 Ctrl+C 停止');
  console.log('──────────────────────────────────────────────');
});
