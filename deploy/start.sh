#!/bin/sh
# Container entrypoint for the hosted demo.
set -e
mkdir -p "$HOME"
# Build the web app on first start so Space variables (e.g. VITE_WALLETCONNECT_PROJECT_ID) apply.
if [ ! -f apps/web/dist/index.html ]; then
  echo "[start] building web app"
  VITE_API_URL=/api VITE_RPC_URL=/rpc npm run build -w @metaswap/web
fi

# Anvil rewrites state.json in place, so a freeze or crash mid-write leaves a truncated file that anvil
# refuses to load. A complete file ends with "}". If it does not, restore the last verified backup.
CHAIN=.dev/chain
complete() { [ -s "$1" ] && [ "$(tail -c 1 "$1")" = "}" ]; }
if [ -f "$CHAIN/state.json" ] && ! complete "$CHAIN/state.json"; then
  if complete "$CHAIN/state.good.json"; then
    echo "[start] state.json is incomplete, restoring the last good backup"
    cp "$CHAIN/state.good.json" "$CHAIN/state.json"
  else
    echo "[start] state.json is incomplete and no backup exists"
  fi
fi
# Every 10 minutes, keep a verified copy (only when the file is complete and has stopped changing).
(
  while sleep 600; do
    f="$CHAIN/state.json"
    if complete "$f"; then
      a=$(stat -c %Y "$f"); sleep 5; b=$(stat -c %Y "$f")
      [ "$a" = "$b" ] && complete "$f" && cp "$f" "$CHAIN/state.good.tmp" && mv "$CHAIN/state.good.tmp" "$CHAIN/state.good.json"
    fi
  done
) &

# Chain (resumed from the snapshot) + API + live market; the gateway serves everything on $PORT.
PORT=8787 node scripts/dev.mjs --no-web &
exec node scripts/gateway.mjs
