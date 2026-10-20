#!/usr/bin/env bash
# Private test chain on :8555 (does not touch the shared :8545). Restores the shared deployments file afterwards.
set -e
export PATH="$PATH:/c/Users/bikal/Tools/foundry/bin"
cd /c/Users/bikal/Downloads/REA/metaswap/packages/contracts
PID=$(netstat -ano | grep ":8555 " | grep LISTENING | awk '{print $5}' | head -1)
[ -n "$PID" ] && taskkill //PID $PID //F >/dev/null
cp deployments/31337.json "$TEMP/31337.backup.json" 2>/dev/null || true
(anvil --chain-id 31337 --block-time 1 --accounts 10 --balance 10000 --port 8555 > "$TEMP/anvil8555.log" 2>&1 &)
sleep 3
K=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
for s in DeployAMM DeployX Seed; do
  forge script script/$s.s.sol --rpc-url http://127.0.0.1:8555 --private-key $K --broadcast --slow > "$TEMP/forge-$s.log" 2>&1 || { echo "$s failed"; tail -20 "$TEMP/forge-$s.log"; exit 1; }
done
cp deployments/31337.json "$TEMP/ms-8555.json"
[ -f "$TEMP/31337.backup.json" ] && cp "$TEMP/31337.backup.json" deployments/31337.json
echo "chain ready on :8555, deployment at $TEMP/ms-8555.json"
