#!/bin/sh
# Container entrypoint for the hosted demo.
set -e
mkdir -p "$HOME"
# Build the web app on first start so Space variables (e.g. VITE_WALLETCONNECT_PROJECT_ID) apply.
if [ ! -f apps/web/dist/index.html ]; then
  echo "[start] building web app"
  VITE_API_URL=/api VITE_RPC_URL=/rpc npm run build -w @metaswap/web
fi
# Chain (resumed from the snapshot) + API + live market; the gateway serves everything on $PORT.
PORT=8787 node scripts/dev.mjs --no-web &
exec node scripts/gateway.mjs
