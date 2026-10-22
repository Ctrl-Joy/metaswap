#!/bin/sh
# Run on the server after copying a new ~/metaswap-demo.tar.gz (see DEPLOY.md "Updating later").
# Rebuilds the image from the new code and swaps the container, keeping the server's live chain
# (trades made on the site) unless --reset-chain is given. Contract changes still rebuild the chain.
set -e
cd ~
WC_ID=$(sudo docker inspect metaswap --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^VITE_WALLETCONNECT_PROJECT_ID=//p')

rm -rf metaswap.new && mkdir metaswap.new && tar -xzf metaswap-demo.tar.gz -C metaswap.new

if [ "$1" != "--reset-chain" ] && sudo docker ps -q -f name='^metaswap$' | grep -q .; then
  # anvil rewrites state.json every 30s; retry until a complete copy is read
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sudo docker cp metaswap:/app/.dev/chain/state.json /tmp/state.json
    if python3 -c 'import json; json.load(open("/tmp/state.json"))' 2>/dev/null; then
      gzip -c /tmp/state.json > metaswap.new/deploy/snapshot/state.json.gz
      sudo docker cp metaswap:/app/.dev/chain/meta.json metaswap.new/deploy/snapshot/meta.json
      echo "[update] keeping the live chain"
      break
    fi
    sleep 2
  done
  rm -f /tmp/state.json
fi

echo "[update] building (a few minutes)"
(cd metaswap.new && sudo docker build -q -t metaswap .)
sudo docker rm -f metaswap >/dev/null 2>&1 || true
sudo docker run -d --name metaswap --restart unless-stopped -p 80:7860 \
  ${WC_ID:+-e VITE_WALLETCONNECT_PROJECT_ID=$WC_ID} metaswap >/dev/null
rm -rf metaswap && mv metaswap.new metaswap
sudo docker image prune -f >/dev/null
echo "[update] done — the site is back in about 2 minutes"
