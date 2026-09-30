#!/usr/bin/env bash
# Copyright 2026 zayum-design
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

#
# deploy.sh — ShotLib 一键本地部署
#
# 用法:
#   ./deploy.sh                 # 安装依赖(按需)→ 构建 → 本地静态服务启动(默认 127.0.0.1:8080)
#   ./deploy.sh --dev           # 开发模式,直接 npm run dev(端口 5176)
#   ./deploy.sh --config        # 先运行 CLI 配置 API Key / 默认模型,再部署
#   ./deploy.sh --proxy         # 强制后台启动本地代理 proxy/node-proxy.mjs(默认 8787)
#   ./deploy.sh --no-proxy      # 禁止自动启动代理(即使配置了 proxyUrl)
#   ./deploy.sh --port 9000     # 指定静态服务端口
#   ./deploy.sh --host 0.0.0.0  # 指定监听地址(注意:配置文件含明文 Key,慎对外暴露)
#
# 代理自动启动:runtime/app-config.json 中配置了本机代理地址(http://127.0.0.1:PORT
# 或 http://localhost:PORT)时,部署会自动附带启动本地代理,无需手动 --proxy。
#
set -euo pipefail
cd "$(dirname "$0")"

MODE="prod"
PORT=""
HOST=""
WITH_PROXY="false"
NO_PROXY="false"
RUN_CLI="false"
PROXY_PORT="${PROXY_PORT:-8787}"

usage() {
  sed -n '/^# 用法/,/^#$/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)      MODE="dev"; shift ;;
    --port)     PORT="${2:?--port 需要一个参数}"; shift 2 ;;
    --host)     HOST="${2:?--host 需要一个参数}"; shift 2 ;;
    --proxy)    WITH_PROXY="true"; shift ;;
    --no-proxy) NO_PROXY="true"; shift ;;
    --config)   RUN_CLI="true"; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "未知参数:$1"; usage; exit 1 ;;
  esac
done

echo "╔══════════════════════════════════════╗"
echo "║      ShotLib 一键本地部署             ║"
echo "╚══════════════════════════════════════╝"

# ---------- 环境检查:Node >= 20 ----------
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未找到 node,请先安装 Node.js >= 20:https://nodejs.org/"
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 20 )); then
  echo "❌ 需要 Node.js >= 20,当前:$(node -v)"
  exit 1
fi

# ---------- 可选:先运行 CLI 配置 ----------
if [[ "$RUN_CLI" == "true" ]]; then
  node scripts/cli.mjs
fi

# ---------- 依赖安装(按需) ----------
if [[ ! -d node_modules ]]; then
  echo "==> 安装依赖(npm install)…"
  npm install
fi

# ---------- 本地代理:--no-proxy 显式关闭;否则按需自动启动 ----------
# 自动启动条件:runtime/app-config.json 配置了指向本机的 proxyUrl
# (火山引擎/阿里云/MiniMax 等厂商浏览器无法直连,必须经本地代理转发)
if [[ "$WITH_PROXY" != "true" && "$NO_PROXY" != "true" && -f runtime/app-config.json ]]; then
  CONFIG_PROXY_URL="$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('runtime/app-config.json','utf8')).proxyUrl||'')}catch{}")"
  case "$CONFIG_PROXY_URL" in
    http://127.0.0.1:*|http://localhost:*)
      WITH_PROXY="true"
      PROXY_PORT="${CONFIG_PROXY_URL##*:}"
      PROXY_PORT="${PROXY_PORT%%/*}"
      echo "==> 检测到部署配置已启用代理(${CONFIG_PROXY_URL}),自动启动本地代理"
      ;;
  esac
fi

PROXY_PID=""
cleanup() {
  if [[ -n "$PROXY_PID" ]]; then
    kill "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
if [[ "$WITH_PROXY" == "true" ]]; then
  # 端口已被监听说明代理已在运行(如上次部署残留/手动启动),直接复用
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PROXY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "==> 端口 ${PROXY_PORT} 已有代理在监听,复用现有实例"
  else
    echo "==> 启动本地代理(端口 ${PROXY_PORT})…"
    node proxy/node-proxy.mjs "$PROXY_PORT" &
    PROXY_PID=$!
    # 给代理一点启动时间,失败立即报错退出,避免前端请求打到空端口
    sleep 0.5
    if ! kill -0 "$PROXY_PID" 2>/dev/null; then
      echo "❌ 本地代理启动失败(端口 ${PROXY_PORT} 可能被占用):可改用 ./deploy.sh --no-proxy 并在设置中调整代理地址"
      exit 1
    fi
  fi
  echo "    代理地址: http://127.0.0.1:${PROXY_PORT}(可在「设置 → 网络」查看/修改)"
fi

# ---------- 启动 ----------
if [[ ! -f runtime/app-config.json ]]; then
  echo "⚠️  尚未配置 API Key:可运行 npm run cli(或 ./deploy.sh --config)配置各厂商 Key 与默认模型"
fi

if [[ "$MODE" == "dev" ]]; then
  echo "==> 开发模式启动(npm run dev)…"
  npm run dev
else
  echo "==> 构建生产包(npm run build)…"
  npm run build

  echo "==> 启动本地静态服务…"
  SERVE_ARGS=()
  [[ -n "$PORT" ]] && SERVE_ARGS+=(--port "$PORT")
  [[ -n "$HOST" ]] && SERVE_ARGS+=(--host "$HOST")
  # 不用 exec:保证 EXIT trap 能清理后台代理;空数组展开兼容 macOS bash 3.2 + set -u
  node scripts/serve.mjs ${SERVE_ARGS[@]+"${SERVE_ARGS[@]}"}
fi
