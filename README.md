# MetaSwap

An end-to-end, working recreation of the Uniswap web app's functionality and UX under its own brand:

- **MetaSwap**: swap, limit, send, buy (devnet faucet), explore (tokens, pools, transactions, auctions,
  trending, charts), liquidity positions (V2 + V3, migrate), portfolio, Earn vaults and Launches
  (token launch auctions that graduate into V3 pools). Pages are pixel-matched to measured Uniswap
  layouts (`docs/analysis/measured/`) and update in real time over WebSocket.
- **MetaSwapX**: gasless, signed Dutch-auction intent orders, filled on-chain by a filler bot
  (inspired by UniswapX).
- **MetaChain**: the planned MetaSwap chain. Today this is the local **MetaChain Devnet** (Anvil,
  chainId 31337) plus an ecosystem/roadmap page.

Everything runs locally against a devnet. There are no real funds and nothing is deployed to a
public network.

## Quick start (Windows, Git Bash or PowerShell)

Prerequisites: Node ≥ 22.19 (24 recommended) and Foundry (`forge`, `anvil`). The launcher
looks for Foundry in `C:\Users\bikal\Tools\foundry\bin`; set `FOUNDRY_BIN` if it lives elsewhere.

```bash
npm install
npm run dev
```

`npm run dev` (`scripts/dev.mjs`) does all of this:

1. Starts Anvil on `:8545`, with its clock set 30 days in the past.
2. Deploys every contract.
3. Seeds 8 tokens and 13 pools.
4. Replays **30 days of hourly trading** — swaps, token launches (graduated, failed, live, upcoming),
   Earn deposits and a ~$3.5k demo wallet — so every chart range has history (about 10 minutes).
5. Starts PostgreSQL (if installed), the API on `:8787` (REST + WebSocket `/ws`), a **live market
   simulator** that keeps prices moving, and the web app on **http://127.0.0.1:5173**.

Ctrl+C stops everything. Each launch is a fresh chain.

In the app, click **Connect → Dev wallet** to use a funded Anvil account (no browser extension
needed). The **Buy** tab is a faucet for test tokens and ETH.

| Option | Effect |
|---|---|
| `HISTORY_DAYS=0 npm run dev` | Skip the history replay (fast start, about 4 minutes) |
| `node scripts/dev.mjs --no-market` | No live market simulator |
| `node scripts/dev.mjs --chain-only` | Chain + contracts + seed + history only |
| `VITE_WALLETCONNECT_PROJECT_ID=…` (in `apps/web/.env.local`) | Enables WalletConnect / mobile wallets |

## Repository

| Path | What |
|---|---|
| `packages/contracts` | Solidity (Foundry): V2 + V3 AMM, NFT position manager, SwapRouter02, QuoterV2, TickLens, Permit2, UniversalRouter, MetaSwapX reactor + executor, deploy/seed scripts. See its README. |
| `packages/sdk` | Shared TS: chain config, token list, ABIs + addresses (synced from Foundry), V2/V3 math, formatting |
| `services/api` | Indexer, USD pricing and candles, explore/account endpoints, split-route quoting with Permit2 `/quote` → `/swap`, MetaSwapX order book + filler bot. See its README. |
| `apps/web` | Vite + React 19 + wagmi 2 + Tailwind 4 app. See its README. |
| `scripts/` | `dev.mjs` launcher, `market.ts` history replay and live simulator |
| `docs/analysis` | Teardown of app.uniswap.org (UI/UX, design tokens, screenshots) and protocol/architecture/flow research |
| `docs/specs/CHANGES.md` | Interface change log on top of `PLAN.md` |

## Tests

| Suite | Command | What it covers |
|---|---|---|
| Contracts | `cd packages/contracts && forge test` | 184 tests: AMM, Permit2, router, MetaSwapX |
| SDK | `npm test -w @metaswap/sdk` | math and formatting |
| API unit | `npm run test:unit -w @metaswap/api` | routing, calldata, typed data, pricing |
| API integration | `npm run test:integration -w @metaswap/api` | real swaps, splits and MetaSwapX fills on the running chain |
| Web unit | `npm test -w @metaswap/web` | CTA states, parsing, order hashing, positions math, explore transforms |
| Web e2e | `npm run e2e -w @metaswap/web` | Playwright against the live stack: swaps, Permit2, limit orders, positions, explore |

The integration and e2e suites need the stack running (`npm run dev`).
`SCREENS=1 npm run e2e -w @metaswap/web -- e2e/screens.spec.ts` regenerates
`apps/web/e2e/screenshots/`.

## License

GPL-3.0-or-later. Contracts ported from Uniswap's open-source repositories keep their original
headers: v2 (GPL-3.0), v3 (GPL-2.0-or-later), Permit2 (MIT), UniversalRouter and UniswapX
(GPL-3.0). MetaSwap's branding, logos and UI code are original. Uniswap v4 (BUSL) is not used.
