#!/bin/sh
# Container entrypoint for the hosted demo: builds the web app once, keeps the chain healthy and bounded,
# then supervises the gateway and the stack. Any exit makes Docker (--restart unless-stopped) start it again.
set -e
mkdir -p "$HOME"
# Build the web app on first start so Space variables (e.g. VITE_WALLETCONNECT_PROJECT_ID) apply.
if [ ! -f apps/web/dist/index.html ]; then
  echo "[start] building web app"
  VITE_API_URL=/api VITE_RPC_URL=/rpc npm run build -w @metaswap/web
fi

CHAIN=.dev/chain
BASE=deploy/snapshot
# Bounds: a chain whose save file or memory passes these is reset to the base snapshot on the next start
# (the market is then replayed up to now, so charts stay continuous). Only trades made since the base are lost.
ROTATE_MB=${ROTATE_MB:-900}
ROTATE_MEM_MB=${ROTATE_MEM_MB:-10240}

# Anvil rewrites state.json in place, so a freeze or crash mid-write leaves a truncated file that anvil
# refuses to load. A finished dump ends with "historical_states":null}; a cut-off file can still end in "}".
complete() { [ -s "$1" ] && tail -c 60 "$1" | grep -q '"historical_states":null}$'; }

restore_base() {
  echo "[start] $1: restarting the chain from the base snapshot (history is replayed up to now)"
  gunzip -c "$BASE/state.json.gz" > "$CHAIN/state.json.tmp" && mv "$CHAIN/state.json.tmp" "$CHAIN/state.json"
  cp "$BASE/meta.json" "$CHAIN/meta.json"
  rm -f "$CHAIN/state.good.json" "$CHAIN/ROTATE"
}

size_mb=$(( $(stat -c %s "$CHAIN/state.json" 2>/dev/null || echo 0) / 1048576 ))
if [ -f "$CHAIN/ROTATE" ]; then
  restore_base "memory limit reached"
elif [ "$size_mb" -gt "$ROTATE_MB" ]; then
  restore_base "chain file is ${size_mb} MB"
elif [ -f "$CHAIN/state.json" ] && ! complete "$CHAIN/state.json"; then
  if complete "$CHAIN/state.good.json"; then
    echo "[start] state.json is incomplete, restoring the last good backup"
    cp "$CHAIN/state.good.json" "$CHAIN/state.json"
  else
    restore_base "state.json is incomplete and no backup exists"
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

node scripts/gateway.mjs &
GATEWAY=$!
# Chain (resumed from the snapshot, caught up to now) + API + live market.
PORT=8787 node scripts/dev.mjs --no-web &
STACK=$!

# Supervise: exit (so Docker restarts the container) if the gateway or the stack stops, or if memory passes the
# bound, in which case the next start resets the chain to the base snapshot.
while sleep 30; do
  kill -0 "$GATEWAY" 2>/dev/null || { echo "[start] gateway stopped; restarting"; exit 1; }
  kill -0 "$STACK" 2>/dev/null || { echo "[start] chain stack stopped; restarting"; exit 1; }
  mem=$(cat /sys/fs/cgroup/memory.current 2>/dev/null || echo 0)
  if [ "$mem" -gt $((ROTATE_MEM_MB * 1048576)) ]; then
    echo "[start] memory $((mem / 1048576)) MB is over ${ROTATE_MEM_MB} MB; resetting the chain on restart"
    touch "$CHAIN/ROTATE"
    kill "$STACK" 2>/dev/null || true
    exit 1
  fi
done
