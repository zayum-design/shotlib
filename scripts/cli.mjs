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
 * shotlib 配置 CLI — 设定各厂商 API Key 与默认模型(文本/图片/视频)
 *
 * 配置写入 runtime/app-config.json,由本地部署服务(scripts/serve.mjs)以
 * /app-config.json 暴露给前端;页面加载时按 generatedAt 版本合并进浏览器设置。
 *
 * 用法:
 *   npm run cli                                  # 交互式配置向导
 *   npm run cli show                             # 查看当前配置
 *   npm run cli set-key <provider> <key>         # 设置某厂商 API Key
 *   npm run cli clear-key <provider>             # 清除某厂商 API Key
 *   npm run cli set-model <text|image|video> <modelId>
 *                                                # 设置某类型默认模型
 *   npm run cli reset                            # 删除配置文件
 *
 * 安全提示:Key 以明文保存在本机 runtime/app-config.json(已被 .gitignore 忽略),
 * 请勿提交到仓库或部署到公网可访问的环境。
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, exit } from 'node:process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const CONFIG_PATH = path.join(RUNTIME_DIR, 'app-config.json');
const MODELS_DIR = path.join(ROOT, 'src', 'config', 'models');

/** 厂商顺序与 src/ai/core/model-registry.ts 保持一致 */
const PROVIDER_ORDER = ['aliyun', 'deepseek', 'minimaxi', 'moonshot', 'nano-banana', 'suno', 'volcengine'];

/** CLI 支持设定默认模型的类型 */
const MODEL_TYPES = [
  { type: 'text', label: '文本' },
  { type: 'image', label: '图片' },
  { type: 'video', label: '视频' },
];

// ---------------------------------------------------------------------------
// 模型清单(与前端同源:src/config/models/*.json)
// ---------------------------------------------------------------------------

/** 读取全部厂商配置(仅保留启用变体),按注册表顺序排列 */
function loadProviders() {
  const providers = [];
  for (const id of PROVIDER_ORDER) {
    const file = path.join(MODELS_DIR, `${id}.json`);
    if (!existsSync(file)) continue;
    const json = JSON.parse(readFileSync(file, 'utf8'));
    providers.push({
      id: json.id,
      name: json.name,
      /** 厂商能力标签(供展示):该厂商启用变体覆盖的模型类型 */
      types: [...new Set((json.variants || []).filter((v) => v.enabled).map((v) => v.type))],
      /** 是否默认建议走代理(与前端 proxyDefault 一致) */
      proxyDefault: json.config?.proxyDefault === true,
      variants: (json.variants || []).filter((v) => v.enabled),
    });
  }
  return providers;
}

/** 按类型列出全部启用模型(附所属厂商) */
function listModelsByType(providers, type) {
  const out = [];
  for (const provider of providers) {
    for (const variant of provider.variants) {
      if (variant.type === type) out.push({ provider, variant });
    }
  }
  return out;
}

/** 模型 id → 展示名(厂商 · 模型名) */
function describeModel(providers, modelId) {
  for (const provider of providers) {
    const variant = provider.variants.find((v) => v.id === modelId);
    if (variant) return `[${provider.name}] ${variant.name}`;
  }
  return `(未知模型:${modelId})`;
}

// ---------------------------------------------------------------------------
// runtime/app-config.json 读写
// ---------------------------------------------------------------------------

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return { apiKeys: {}, defaultModels: {}, proxyUrl: '', oss: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return {
      apiKeys: parsed.apiKeys && typeof parsed.apiKeys === 'object' ? parsed.apiKeys : {},
      defaultModels: parsed.defaultModels && typeof parsed.defaultModels === 'object' ? parsed.defaultModels : {},
      proxyUrl: typeof parsed.proxyUrl === 'string' ? parsed.proxyUrl : '',
      oss: parsed.oss && typeof parsed.oss === 'object' ? parsed.oss : null,
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
    };
  } catch (e) {
    console.error(`⚠️  配置文件解析失败,将重建:${CONFIG_PATH}(${e.message})`);
    return { apiKeys: {}, defaultModels: {}, proxyUrl: '', oss: null };
  }
}

/** 保存并刷新版本号:前端仅在 generatedAt 变化时重新应用(以 CLI 为准覆盖一次) */
function saveConfig(config) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const next = { ...config, generatedAt: new Date().toISOString() };
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

function printSavedHint() {
  console.log(`已保存到 ${path.relative(ROOT, CONFIG_PATH)},刷新页面后生效(会覆盖浏览器中同名的旧设置)。`);
  console.log('安全提示:文件为明文 Key,请勿提交仓库或暴露到公网。');
}

/** Key 掩码展示 */
function maskKey(key) {
  if (!key) return '(未设置)';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// 配置展示
// ---------------------------------------------------------------------------

function printConfig(config, providers) {
  console.log('\n当前配置(runtime/app-config.json):');
  if (config.generatedAt) console.log(`  更新时间: ${config.generatedAt}`);
  console.log('  API Key:');
  for (const p of providers) {
    console.log(`    - ${p.name}(${p.id}):${maskKey(config.apiKeys[p.id])}`);
  }
  console.log('  默认模型:');
  for (const { type, label } of MODEL_TYPES) {
    const id = config.defaultModels[type];
    console.log(`    - ${label}(${type}):${id ? `${id} ${describeModel(providers, id)}` : '(未设置,前端取该类型第一个启用模型)'}`);
  }
  console.log(`  代理地址: ${config.proxyUrl || '(未设置)'}`);
  console.log('  对象存储(OSS,生成图片立即上传):');
  if (config.oss?.bucket) {
    console.log(`    - provider: ${config.oss.provider || 'aliyun'}`);
    console.log(`    - bucket: ${config.oss.bucket}  region: ${config.oss.region || '(未设置)'}`);
    console.log(`    - AccessKeyId: ${maskKey(config.oss.accessKeyId)}  Secret: ${maskKey(config.oss.accessKeySecret)}`);
    if (config.oss.endpoint) console.log(`    - endpoint: ${config.oss.endpoint}`);
    if (config.oss.publicBaseUrl) console.log(`    - publicBaseUrl: ${config.oss.publicBaseUrl}`);
  } else {
    console.log('    (未设置,生成图片仅存浏览器本地)');
  }
}

// ---------------------------------------------------------------------------
// 交互式向导
// ---------------------------------------------------------------------------

/**
 * 读取编号选择;回车返回 null(保留当前值)。
 * allowZero 为 true 时接受 0(返回上级),返回 -1。
 */
async function askChoice(rl, prompt, max, allowZero = false) {
  const min = allowZero ? 0 : 1;
  while (true) {
    const answer = (await rl.question(prompt)).trim();
    if (!answer) return null;
    const num = Number(answer);
    if (Number.isInteger(num) && num >= min && num <= max) return num - 1;
    console.log(`请输入 ${min}-${max} 的编号,或直接回车保留当前值。`);
  }
}

async function wizardApiKeys(rl, config, providers) {
  console.log('\n── 配置 API Key(回车保留当前值,输入 - 清除)──');
  while (true) {
    providers.forEach((p, i) => {
      const tags = [p.types.join('/') || '无启用模型'];
      if (p.proxyDefault) tags.push('建议走代理');
      console.log(`  ${i + 1}. ${p.name}(${p.id})— ${tags.join(',')}  当前:${maskKey(config.apiKeys[p.id])}`);
    });
    console.log('  0. 返回上级');
    const idx = await askChoice(rl, '选择厂商: ', providers.length, true);
    if (idx === null || idx < 0) return; // 回车 / 0 → 返回上级
    const provider = providers[idx];
    const value = (await rl.question(`输入 ${provider.name} 的 API Key(回车保留,输入 - 清除): `)).trim();
    if (!value) continue;
    if (value === '-') {
      delete config.apiKeys[provider.id];
      console.log(`已清除 ${provider.name} 的 Key(保存后生效)。`);
    } else {
      config.apiKeys[provider.id] = value;
      console.log(`已记录 ${provider.name} 的 Key:${maskKey(value)}(保存后生效)。`);
    }
  }
}

async function wizardDefaultModels(rl, config, providers) {
  console.log('\n── 选择默认模型(回车保留当前值)──');
  for (const { type, label } of MODEL_TYPES) {
    const models = listModelsByType(providers, type);
    if (!models.length) {
      console.log(`\n${label}模型(${type}):无启用模型,跳过。`);
      continue;
    }
    console.log(`\n${label}模型(${type}):`);
    models.forEach((m, i) => {
      const flags = m.variant.recommended ? ' ★推荐' : '';
      console.log(`  ${i + 1}. [${m.provider.name}] ${m.variant.id}${flags}`);
    });
    const current = config.defaultModels[type];
    if (current) console.log(`  当前:${current} ${describeModel(providers, current)}`);
    const idx = await askChoice(rl, `选择默认${label}模型(回车保留): `, models.length);
    if (idx !== null) {
      config.defaultModels[type] = models[idx].variant.id;
      console.log(`已选择:${models[idx].variant.id}(保存后生效)。`);
    }
  }
}

async function wizardProxy(rl, config) {
  console.log('\n── 配置代理地址(解决火山引擎/阿里云/MiniMax 等浏览器跨域限制)──');
  console.log(`  当前:${config.proxyUrl || '(未设置)'}`);
  const value = (await rl.question('输入代理地址,如 http://127.0.0.1:8787(回车保留,输入 - 清除): ')).trim();
  if (!value) return;
  config.proxyUrl = value === '-' ? '' : value;
  console.log('已记录(保存后生效)。详见 README「网络与代理」。');
}

/** 向导:逐项配置 OSS(生成图片立即上传,持久公网 URL) */
async function wizardOss(rl, config) {
  console.log('\n── 配置对象存储 OSS(生成的图片立即上传,解决厂商图片 URL 过期问题)──');
  if (!config.oss) config.oss = { provider: 'aliyun', bucket: '', region: '', accessKeyId: '', accessKeySecret: '' };
  const oss = config.oss;

  console.log(`  存储服务商: 1. 阿里云 OSS(默认)  2. S3 兼容(预留)`);
  const providerInput = (await rl.question(`选择 [1/2,回车保留 ${oss.provider === 'amazon' ? '2' : '1'}]: `)).trim();
  if (providerInput === '1') oss.provider = 'aliyun';
  else if (providerInput === '2') oss.provider = 'amazon';

  const bucket = (await rl.question(`Bucket 名称(需公共读,回车保留 ${oss.bucket || '未设置'}): `)).trim();
  if (bucket) oss.bucket = bucket;
  const region = (await rl.question(`Region(如 oss-cn-beijing,回车保留 ${oss.region || '未设置'}): `)).trim();
  if (region) oss.region = region;
  const ak = (await rl.question(`AccessKeyId(回车保留,输入 - 清除): `)).trim();
  if (ak === '-') oss.accessKeyId = '';
  else if (ak) oss.accessKeyId = ak;
  const sk = (await rl.question(`AccessKeySecret(回车保留,输入 - 清除): `)).trim();
  if (sk === '-') oss.accessKeySecret = '';
  else if (sk) oss.accessKeySecret = sk;
  const endpoint = (await rl.question(`自定义 endpoint(可选,回车跳过): `)).trim();
  if (endpoint) oss.endpoint = endpoint;
  else if (endpoint === '-') delete oss.endpoint;
  const publicBase = (await rl.question(`公共访问基址/CDN 域名(可选,回车跳过): `)).trim();
  if (publicBase) oss.publicBaseUrl = publicBase;
  else if (publicBase === '-') delete oss.publicBaseUrl;

  if (!oss.bucket || !oss.accessKeyId || !oss.accessKeySecret) {
    console.log('⚠️  bucket / AccessKeyId / AccessKeySecret 未配置完整,OSS 上传不会启用。');
  } else {
    console.log('已记录(保存后生效)。要求:bucket 为公共读(厂商服务器需能拉取参考图)。');
  }
}

async function wizard() {
  const providers = loadProviders();
  const config = loadConfig();
  const rl = createInterface({ input: stdin, output: stdout });
  rl.on('SIGINT', () => {
    console.log('\n已取消(未保存)。');
    exit(0);
  });

  console.log('╔══════════════════════════════════════╗');
  console.log('║   ShotLib 配置向导(API Key / 模型)   ║');
  console.log('╚══════════════════════════════════════╝');

  try {
    while (true) {
      console.log('\n请选择:');
      console.log('  1. 配置各厂商 API Key');
      console.log('  2. 选择默认模型(文本 / 图片 / 视频)');
      console.log('  3. 配置代理地址(可选)');
      console.log('  4. 配置对象存储 OSS(生成的图片立即上传)');
      console.log('  5. 查看当前配置');
      console.log('  6. 保存并退出');
      console.log('  7. 不保存退出');
      const choice = (await rl.question('输入编号: ')).trim();
      if (choice === '1') await wizardApiKeys(rl, config, providers);
      else if (choice === '2') await wizardDefaultModels(rl, config, providers);
      else if (choice === '3') await wizardProxy(rl, config);
      else if (choice === '4') await wizardOss(rl, config);
      else if (choice === '5') printConfig(config, providers);
      else if (choice === '6') {
        saveConfig(config);
        printSavedHint();
        break;
      } else if (choice === '7') {
        console.log('已退出(未保存)。');
        break;
      } else {
        console.log('请输入 1-7 的编号。');
      }
    }
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// 非交互子命令
// ---------------------------------------------------------------------------

function usage() {
  console.log(`用法:
  npm run cli                                # 交互式配置向导
  npm run cli show                           # 查看当前配置
  npm run cli set-key <provider> <key>       # 设置某厂商 API Key
  npm run cli clear-key <provider>           # 清除某厂商 API Key
  npm run cli set-model <type> <modelId>     # 设置默认模型,type = text|image|video
  npm run cli set-oss <bucket> <region> <ak> <sk> [provider] [endpoint] [publicBaseUrl]
                                             # 配置对象存储(生成图片立即上传)
  npm run cli clear-oss                      # 清除 OSS 配置
  npm run cli reset                          # 删除配置文件

厂商列表:${PROVIDER_ORDER.join(', ')}`);
}

/** 校验厂商 id,非法时列出全部厂商并退出 */
function requireProvider(providers, id) {
  const found = providers.find((p) => p.id === id);
  if (found) return found;
  console.error(`未知厂商:${id}`);
  console.error(`可用厂商:${providers.map((p) => `${p.id}(${p.name})`).join('、')}`);
  exit(1);
}

function runSubcommand([cmd, ...rest]) {
  const providers = loadProviders();

  if (cmd === 'show') {
    printConfig(loadConfig(), providers);
    return;
  }

  if (cmd === 'set-key') {
    const [id, key] = rest;
    if (!id || key === undefined) { usage(); exit(1); }
    requireProvider(providers, id);
    const config = loadConfig();
    config.apiKeys[id] = key.trim();
    saveConfig(config);
    printSavedHint();
    return;
  }

  if (cmd === 'clear-key') {
    const [id] = rest;
    if (!id) { usage(); exit(1); }
    requireProvider(providers, id);
    const config = loadConfig();
    delete config.apiKeys[id];
    saveConfig(config);
    printSavedHint();
    return;
  }

  if (cmd === 'set-model') {
    const [type, modelId] = rest;
    if (!type || !modelId) { usage(); exit(1); }
    if (!MODEL_TYPES.some((t) => t.type === type)) {
      console.error(`类型必须是 ${MODEL_TYPES.map((t) => t.type).join(' / ')},收到:${type}`);
      exit(1);
    }
    const models = listModelsByType(providers, type);
    const match = models.find((m) => m.variant.id === modelId);
    if (!match) {
      console.error(`未知或未启用的${type}模型:${modelId}`);
      console.error(`可用模型:\n${models.map((m, i) => `  ${i + 1}. [${m.provider.name}] ${m.variant.id}`).join('\n')}`);
      exit(1);
    }
    const config = loadConfig();
    config.defaultModels[type] = modelId;
    saveConfig(config);
    printSavedHint();
    return;
  }

  if (cmd === 'set-oss') {
    // 用法: set-oss <bucket> <region> <accessKeyId> <accessKeySecret> [provider] [endpoint] [publicBaseUrl]
    const [bucket, region, ak, sk, provider, endpoint, publicBaseUrl] = rest;
    if (!bucket || !region || !ak || !sk) {
      console.error(`用法: npm run cli set-oss <bucket> <region> <accessKeyId> <accessKeySecret> [provider=aliyun] [endpoint] [publicBaseUrl]
示例: npm run cli set-oss files-shotlib oss-cn-beijing LTAI5t... 73WTE... aliyun "" https://cdn.example.com`);
      exit(1);
    }
    const config = loadConfig();
    config.oss = {
      provider: provider === 'amazon' ? 'amazon' : 'aliyun',
      bucket,
      region,
      accessKeyId: ak,
      accessKeySecret: sk,
      ...(endpoint ? { endpoint } : {}),
      ...(publicBaseUrl ? { publicBaseUrl } : {}),
    };
    saveConfig(config);
    printSavedHint();
    return;
  }

  if (cmd === 'clear-oss') {
    const config = loadConfig();
    delete config.oss;
    saveConfig(config);
    printSavedHint();
    return;
  }

  if (cmd === 'reset') {
    if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH);
    console.log('已删除配置文件;页面刷新后前端不再应用任何部署级配置(浏览器内已保存的设置不受影响)。');
    return;
  }

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    return;
  }

  console.error(`未知命令:${cmd}`);
  usage();
  exit(1);
}

// ---------------------------------------------------------------------------

const args = argv.slice(2);
if (args.length === 0) {
  wizard();
} else {
  runSubcommand(args);
}
