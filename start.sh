#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8787}"
HOST="${HOST:-127.0.0.1}"

if [ ! -d node_modules ]; then
  echo "首次运行，安装依赖…"
  npm install --silent
fi

echo "紫微斗数排盘接口: http://${HOST}:${PORT}"
PORT="$PORT" HOST="$HOST" exec node server.js
