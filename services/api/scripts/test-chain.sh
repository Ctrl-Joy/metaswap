#!/usr/bin/env bash
# Private full test chain on :8555 (never touches the shared :8545): anvil (20 accounts, genesis
# HISTORY_DAYS in the past, only the last 512 states in memory, like dev.mjs) → DeployAMM → DeployX → DeployStage5 → Seed
# → scripts/market.ts --history. The shared deployments/31337.json is restored afterwards; this
# chain's deployment is written to $TEMP/ms-8555.json.
#
#   HISTORY_DAYS=30 bash services/api/scripts/test-chain.sh
#   METASWAP_RPC=http://127.0.0.1:8555 METASWAP_DEPLOYMENT_FILE=$TEMP/ms-8555.json npx vitest run test/integration
set -e
export PATH="$PATH:/c/Users/bikal/Tools/foundry/bin"
ROOT=/c/Users/bikal/Downloads/REA/metaswap
HISTORY_DAYS=${HISTORY_DAYS:-30}
PORT=${PORT:-8555}
RPC=http://127.0.0.1:$PORT
cd "$ROOT/packages/contracts"
PID=$(netstat -ano | grep ":$PORT " | grep LISTENING | awk '{print $5}' | head -1)
[ -n "$PID" ] && taskkill //PID $PID //F >/dev/null
cp deployments/31337.json "$TEMP/31337.backup.json" 2>/dev/null || true
restore() { [ -f "$TEMP/31337.backup.json" ] && cp "$TEMP/31337.backup.json" "$ROOT/packages/contracts/deployments/31337.json"; return 0; }
trap restore EXIT
ARGS="--chain-id 31337 --block-time 1 --accounts 20 --balance 10000 --port $PORT --prune-history 512"
[ "$HISTORY_DAYS" -gt 0 ] && ARGS="$ARGS --timestamp $(( $(date +%s) - HISTORY_DAYS * 86400 ))"
(anvil $ARGS > "$TEMP/anvil$PORT.log" 2>&1 &)
sleep 3
K=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
for s in DeployAMM DeployX DeployStage5 Seed; do
  [ -f script/$s.s.sol ] || continue
  forge script script/$s.s.sol --rpc-url $RPC --private-key $K --broadcast --slow > "$TEMP/forge-$s.log" 2>&1 || { echo "$s failed"; tail -20 "$TEMP/forge-$s.log"; exit 1; }
done
cp deployments/31337.json "$TEMP/ms-$PORT.json"
restore
echo "deployed on :$PORT, deployment at $TEMP/ms-$PORT.json"
if [ "$HISTORY_DAYS" -gt 0 ]; then
  cd "$ROOT"
  METASWAP_RPC=$RPC METASWAP_DEPLOYMENT_FILE="$TEMP/ms-$PORT.json" npx tsx scripts/market.ts --history
fi
echo "chain ready on :$PORT"
