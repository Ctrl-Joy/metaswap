# MetaSwap hosted demo (any Docker host: a VPS, Oracle Cloud Always Free, Hugging Face Docker Spaces…). One container runs the MetaChain Devnet
# (Anvil, booted from the saved chain snapshot), the API (SQLite), the live market simulator and
# the single-port gateway that serves the web app on $PORT (7860).
# Built from the export produced by `node scripts/publish-hf.mjs`.
FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Foundry's anvil + cast (official release binaries; amd64 or arm64 to match the host)
RUN ARCH=$(uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/') \
  && curl -fsSL "https://github.com/foundry-rs/foundry/releases/download/stable/foundry_stable_linux_${ARCH}.tar.gz" \
  | tar -xz -C /usr/local/bin anvil cast

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY services/api/package.json services/api/
COPY packages/sdk/package.json packages/sdk/
RUN npm ci --no-audit --no-fund

COPY . .
RUN node deploy/restore.mjs && mkdir -p /app/.home && chown -R 1000:1000 /app

# Hugging Face runs Spaces as uid 1000
USER 1000
ENV HOME=/app/.home \
    FOUNDRY_BIN=/usr/local/bin \
    PORT=7860 \
    HISTORY_DAYS=0
EXPOSE 7860
CMD ["sh", "deploy/start.sh"]
