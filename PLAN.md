# MetaSwap — build plan and shared spec

MetaSwap is an original, end-to-end recreation of the *functionality and UX patterns* of the
Uniswap web app (app.uniswap.org), under its own brand:

- **MetaSwap** — the DEX app: swap, limit, send, explore, pools/positions, portfolio.
- **MetaSwapX** — advanced trading/execution: gasless, signed Dutch-auction intent orders
  filled by competing fillers (inspired by UniswapX).
- **MetaChain** — the planned MetaSwap blockchain ecosystem (inspired by Unichain). For now:
  a product/roadmap page, chain metadata, and the local dev chain branded "MetaChain Devnet".

This file is the contract between everyone working on the repo. If you need to change an
interface defined here, write the change into `docs/specs/CHANGES.md` and tell the maintainer
in your final report — do not silently diverge.

## Ground rules

1. **Original brand, original code.** Do not copy Uniswap logos, wordmarks, illustrations, icon
   sets, fonts or copy text. Recreate *layouts, flows and behaviour*, not brand assets.
   Uniswap's open-source code (v2-core GPL-3.0, v3-core GPL-2.0-or-later since 2023-04-01,
   Permit2 MIT, UniversalRouter GPL-3.0, UniswapX GPL-3.0, interface GPL-3.0) may be used as a
   reference or ported; MetaSwap is GPL-3.0-or-later so that is compatible. When you port a
   file, keep the original SPDX/copyright header and add a `// Ported from <repo>/<path>` line.
   Do **not** port Uniswap v4-core / v4-periphery (BUSL-licensed).
2. **Local first, no real funds.** Everything runs against a local Anvil chain. Do not deploy to
   any public network, and never put real private keys anywhere. Anvil's well-known dev keys are
   fine for local testing.
3. **Preserve existing work.** Don't delete or rewrite files owned by another area (see
   ownership table). Add, don't clobber.
4. **Test actual functionality.** Every area ships with tests that exercise real behaviour
   (Forge tests against real contracts, API tests against a real Anvil, Playwright against the
   real running stack). "It compiles" is not done.
5. Windows host. Shell is Git Bash / PowerShell. Foundry binaries are in
   `C:\Users\bikal\Tools\foundry\bin` (add to PATH: `export PATH="$PATH:/c/Users/bikal/Tools/foundry/bin"`).
   Node 24, npm 11. No Python, no Docker.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Contracts | Solidity 0.8.26, Foundry (forge/anvil/cast) | Fast native tests, Anvil local chain |
| Local chain | Anvil, chainId **31337**, branded "MetaChain Devnet", RPC `http://127.0.0.1:8545`, block time 1s | |
| Shared TS | `packages/sdk` (`@metaswap/sdk`): ABIs, addresses, chain config, token list, math, types | One source of truth for web + api |
| Backend | `services/api` (`@metaswap/api`): Node 24 + TypeScript (run with `tsx`), Hono HTTP server on **:8787**, `viem`, `node:sqlite` (built-in, no native deps) | Indexer + routing + MetaSwapX order book + filler |
| Frontend | `apps/web` (`@metaswap/web`): Vite + React 18 + TypeScript, React Router, wagmi v2 + viem, TanStack Query, Zustand, Tailwind CSS, Radix UI primitives, `lightweight-charts` for price charts, Vite dev server on **:5173** | Mirrors Uniswap's SPA architecture |
| Tests | forge test; vitest (sdk/api/web units); Playwright e2e for web against the live local stack | |

**Pinned versions (binding — keep all workspaces on the same lines):** typescript 5.9.3,
viem ^2.57, wagmi ^2.19 (v2 API, not v3), @tanstack/react-query ^5, react/react-dom ^19,
react-router-dom ^7, vite ^7.3, vitest ^3.2, @playwright/test ^1.64, tailwindcss ^4 (CSS-first
config via `@tailwindcss/vite`), zustand ^5, lightweight-charts ^5, hono ^4, @hono/node-server,
tsx ^4. `@metaswap/sdk` is consumed as TypeScript source (`exports: "./src/index.ts"`).

## Repository layout and ownership

```
metaswap/
  PLAN.md                     maintainer
  docs/analysis/              UI analysis (ui-ux.md, design-tokens.md, screens/), protocol research (protocol.md, architecture.md, flows.md)
  docs/specs/                 maintainer; CHANGES.md for interface change requests
  lib/forge-std/              shared (git submodule) — do not edit
  packages/contracts/
    foundry.toml              maintainer (profiles: default, amm, x)
    src/amm/                  AMM contracts  (v2 + v3 + periphery + tokens/WETH/Multicall)
    test/amm/                 AMM contracts
    script/DeployAMM.s.sol    AMM contracts
    src/x/                    router & MetaSwapX contracts  (Permit2, UniversalRouter, MetaSwapX reactor + executors)
    test/x/                   router & MetaSwapX contracts
    script/DeployX.s.sol      router & MetaSwapX contracts
    script/Seed.s.sol         AMM contracts (pools/liquidity/swap history)
    deployments/31337.json    written by the deploy scripts (gitignored)
  packages/sdk/               maintainer (+ sync script that exports ABIs from forge out/)
  services/api/               API
  apps/web/                   web app (shell, wallet, swap/limit/send, settings, account drawer)
                              explore (explore, token/pool detail, charts)
                              positions (positions: create/add/remove/collect, v2 + v3)
  scripts/                    maintainer (dev-up / dev-down / e2e helpers)
```

## Contracts (Solidity) — names are binding

All contracts live under `packages/contracts/src/`. Periphery must **look up pools/pairs via the
factory** (`getPair` / `getPool`) instead of CREATE2 init-code-hash math, so changing bytecode
never breaks routing.

### AMM contracts: `src/amm`
- `tokens/WETH9.sol` — canonical WETH9 behaviour (deposit/withdraw/receive).
- `tokens/TestERC20.sol` — ERC20 + EIP-2612 permit, configurable decimals, `mint(address,uint256)`
  open on devnet (faucet) and a `faucet()` that mints a fixed amount to msg.sender (rate-limited per address per hour).
- `utils/Multicall3.sol` — standard Multicall3.
- **V2 (constant product, 0.30% fee)**: `v2/MetaSwapV2Factory.sol`, `v2/MetaSwapV2Pair.sol`
  (LP ERC20 "MetaSwap V2" / "MS-V2" with permit, TWAP cumulative prices, `MINIMUM_LIQUIDITY`,
  `skim`/`sync`, protocol fee switch), `v2/MetaSwapV2Router02.sol` (full Router02 surface incl.
  ETH variants and fee-on-transfer variants), `v2/libraries/*`. Interfaces in `v2/interfaces/`
  matching Uniswap V2's function signatures and events (so standard tooling works).
- **V3 (concentrated liquidity)**: `v3/MetaSwapV3Factory.sol` (fee tiers 100/500/3000/10000 with
  tick spacings 1/10/60/200), `v3/MetaSwapV3Pool.sol` (+ `v3/libraries/*`: TickMath, SqrtPriceMath,
  SwapMath, Tick, TickBitmap, Position, Oracle, FullMath, LiquidityMath...), periphery:
  `v3/NonfungiblePositionManager.sol` (ERC721 "MetaSwap V3 Positions" / "MS-V3-POS", mint,
  increase/decrease liquidity, collect, burn, on-chain JSON/SVG tokenURI with MetaSwap styling),
  `v3/SwapRouter02.sol` (exactInputSingle, exactInput, exactOutputSingle, exactOutput, multicall,
  WETH unwrap/refund), `v3/QuoterV2.sol`, `v3/TickLens.sol`. Interfaces in `v3/interfaces/` with
  Uniswap V3 function signatures and events.
- `script/DeployAMM.s.sol` — deploys everything above + test tokens, writes
  `deployments/31337.json` (schema below).
- `script/Seed.s.sol` — creates pools and liquidity and runs a realistic set of swaps from several
  Anvil accounts so explore pages and charts have data. Seed tokens (all `TestERC20` except WETH):

  | symbol | name | decimals | seed USD price |
  |---|---|---|---|
  | WETH | Wrapped Ether | 18 | 3000 |
  | mUSDC | Meta USD Coin | 6 | 1 |
  | mUSDT | Meta Tether | 6 | 1 |
  | mDAI | Meta Dai | 18 | 1 |
  | mWBTC | Meta Wrapped BTC | 8 | 60000 |
  | META | MetaSwap | 18 | 8 |
  | mLINK | Meta Chainlink | 18 | 15 |
  | mARB | Meta Arbitrum | 18 | 0.8 |

  Pools: V2 WETH/mUSDC, WETH/mDAI, mWBTC/WETH, META/WETH, mLINK/WETH, mUSDC/mUSDT;
  V3 WETH/mUSDC 0.05%, WETH/mUSDC 0.3%, mUSDC/mUSDT 0.01%, mWBTC/WETH 0.3%, META/WETH 1%,
  mARB/WETH 0.3%, mDAI/mUSDC 0.01%. Deep enough liquidity that a $10k swap has <1% impact on
  the majors.

### router & MetaSwapX contracts: `src/x`
- `permit2/Permit2.sol` (+ `SignatureTransfer`, `AllowanceTransfer`, libraries) — port of
  Uniswap Permit2 (MIT).
- `router/MetaSwapUniversalRouter.sol` — command-based router (Uniswap UniversalRouter command
  byte layout) supporting at least: `V3_SWAP_EXACT_IN`, `V3_SWAP_EXACT_OUT`, `V2_SWAP_EXACT_IN`,
  `V2_SWAP_EXACT_OUT`, `PERMIT2_PERMIT`, `PERMIT2_TRANSFER_FROM`, `WRAP_ETH`, `UNWRAP_WETH`,
  `SWEEP`, `TRANSFER`, `PAY_PORTION`, with `execute(bytes commands, bytes[] inputs, uint256 deadline)`.
  Pays from the user via Permit2 (users approve Permit2 once, then sign per swap). This is the
  router the web app uses for swaps.
- **MetaSwapX**: `metaswapx/reactors/ExclusiveDutchOrderReactor.sol` (+ `BaseReactor`,
  `lib/*`, `base/ReactorStructs.sol`), `metaswapx/sample-executors/SwapRouter02Executor.sol`
  (filler executor that fills from MetaSwap V3/V2 liquidity). Orders: Dutch decay of output
  amount from start→end over a window, optional exclusive filler period, signed via Permit2
  witness. Port of UniswapX (GPL-3.0) is fine.
- `script/DeployX.s.sol` — reads `deployments/31337.json`, deploys Permit2, UniversalRouter,
  Reactor, Executor, and merges their addresses back into the same file.

### `deployments/31337.json` schema (binding)
```json
{
  "chainId": 31337,
  "blockNumber": 0,
  "contracts": {
    "WETH9": "0x…", "Multicall3": "0x…",
    "V2Factory": "0x…", "V2Router02": "0x…",
    "V3Factory": "0x…", "NonfungiblePositionManager": "0x…", "SwapRouter02": "0x…",
    "QuoterV2": "0x…", "TickLens": "0x…",
    "Permit2": "0x…", "UniversalRouter": "0x…",
    "ExclusiveDutchOrderReactor": "0x…", "SwapRouter02Executor": "0x…"
  },
  "tokens": [
    { "symbol": "WETH", "name": "Wrapped Ether", "decimals": 18, "address": "0x…", "seedPriceUsd": 3000 }
  ],
  "pools": {
    "v2": [ { "address": "0x…", "token0": "0x…", "token1": "0x…" } ],
    "v3": [ { "address": "0x…", "token0": "0x…", "token1": "0x…", "fee": 500 } ]
  }
}
```
`blockNumber` is the block the AMM deployment started at (the indexer starts from there).

## `@metaswap/sdk` (maintainer)
- `abis/*.ts` — `as const` ABIs exported from forge `out/` by `scripts/sync.mjs`.
- `src/deployments.ts` — loads `deployments/31337.json` (copied into `src/generated/`).
- `src/chains.ts` — `metachainDevnet` viem chain (id 31337, name "MetaChain Devnet",
  native currency ETH, RPC 8545), plus metadata for the planned MetaChain mainnet/testnet
  (`status: "planned"`).
- `src/tokens.ts` — token list in Uniswap token-list JSON format + logo URIs (generated SVG
  initials served by the web app at `/tokens/<symbol>.svg`).
- `src/math/` — V2 getAmountOut/In, price impact, tick↔price, sqrtPriceX96↔price, formatting.

## API — `services/api` on http://127.0.0.1:8787 (API) — binding paths

All JSON, amounts as decimal strings in base units unless suffixed `Formatted`/`Usd`.

- `GET /health` → `{ ok, chainId, indexedBlock, headBlock }`
- `GET /tokens` → token list (Uniswap token-list schema).
- `GET /tokens/:address` → `{ token, priceUsd, change1h, change24h, volume24hUsd, tvlUsd, fdvUsd, marketCapUsd }`
- `GET /tokens/:address/candles?interval=1m|5m|1h|1d&from&to` → `[{ time, open, high, low, close, volumeUsd }]`
- `GET /tokens/:address/price-history?range=1H|1D|1W|1M|1Y` → `[{ time, priceUsd }]`
- `GET /explore/stats` → `{ tvlUsd, volume24hUsd, v2: {...}, v3: {...}, volumeHistory: [...], tvlHistory: [...] }`
- `GET /explore/tokens?sort=volume|tvl|price|change&order=desc` → token rows with sparkline
- `GET /explore/pools?sort=tvl|volume|apr` → `{ address, version: "v2"|"v3", token0, token1, fee, tvlUsd, volume24hUsd, volume7dUsd, apr }`
- `GET /pools/:address` → pool detail + reserves/liquidity/current tick/price, `GET /pools/:address/history`, `GET /pools/:address/ticks` (v3 liquidity distribution for the range chart)
- `GET /explore/transactions?type=swap|add|remove&token&pool` → recent txs
- `GET /accounts/:address/activity` → swaps/adds/removes/sends/orders for the account
- `GET /accounts/:address/positions` → V2 LP balances + V3 NFT positions (with uncollected fees, in-range flag)
- `GET /accounts/:address/balances` → token balances + USD values (portfolio)
- `GET /quote?tokenIn&tokenOut&amount&type=EXACT_INPUT|EXACT_OUTPUT&slippageBps&recipient&deadline&protocols=v2,v3,mixed`
  → `{ route: [[{ type:"v2"|"v3", pool, tokenIn, tokenOut, fee }]], amountIn, amountOut, amountOutMin|amountInMax, priceImpactBps, gasEstimate, gasUsd, routeString, methodParameters: { to: UniversalRouter, calldata, value }, permit2: { required, spender, ... } }`
  `permit2.required` is true when the user's Permit2 allowance for the router is missing,
  insufficient or expiring; the quote then includes `permitData: { domain, types, values }`
  (an EIP-712 `PermitSingle` for spender = UniversalRouter) for the wallet to sign. ERC20 → Permit2
  `approve` (max) is a separate on-chain step the web app does first when needed.
- `POST /swap` body `{ quote, permitSignature? }` → `{ methodParameters: { to, calldata, value }, gasEstimate }`
  — rebuilds UniversalRouter calldata, prepending a `PERMIT2_PERMIT` command when a signature is
  supplied (mirrors Uniswap's Trading API `/quote` → `/swap`). Quotes carry an `id` and expire after 30s.
  Routing: enumerate all V2+V3 pools, paths up to 3 hops, optional split across up to 3 routes,
  quote V2 with exact reserve math and V3 via `QuoterV2` (eth_call), pick best net-of-gas.
- MetaSwapX: `POST /x/orders` (encoded signed order + signature) → validates & stores,
  `GET /x/orders?swapper&status=open|filled|expired|cancelled`, `GET /x/orders/:hash`,
  `GET /x/quote?…` (indicative Dutch-auction start/end amounts). A built-in **filler bot**
  (`src/filler/`) polls open orders and fills profitable ones through the executor using the
  Anvil filler account (#9).

## Web app — `apps/web` on http://127.0.0.1:5173 — routes (binding)

| Route | Page |
|---|---|
| `/` → `/swap` | Landing/swap |
| `/swap` | Swap card with tabs **Swap / Limit / Send / Buy**; review modal; tx progress |
| `/limit` | MetaSwapX limit order (signs Permit2 witness order, posts to API) |
| `/send` | Send tokens/ETH |
| `/buy` | Buy (devnet faucet: mint test tokens, get ETH from Anvil) |
| `/explore`, `/explore/tokens`, `/explore/pools`, `/explore/transactions` | Explore tables + stats |
| `/explore/tokens/:chain/:address` | Token detail: price chart (line/candles, ranges), stats, swap widget, txs |
| `/explore/pools/:chain/:address` | Pool detail: chart, TVL/volume, composition, txs |
| `/positions` | Your positions (V2 + V3) |
| `/positions/create` | New position (choose pair, version, fee tier, range, deposit) |
| `/positions/v2/:pair`, `/positions/v3/:tokenId` | Position detail: add/remove liquidity, collect fees |
| `/portfolio` (also account drawer) | Balances, activity, positions, limit orders |
| `/metaswapx` | MetaSwapX product page + your orders |
| `/metachain` | MetaChain ecosystem page (planned), add-network button for Devnet |

Wallet: wagmi connectors — EIP-6963 injected (MetaMask, Rabby, Coinbase ext…), WalletConnect
(only if `VITE_WALLETCONNECT_PROJECT_ID` set), Coinbase Wallet SDK, and a **"Dev wallet"**
connector that signs with Anvil account #0..#4 (only on chainId 31337; used by Playwright e2e).
Custom connect modal in MetaSwap style (not RainbowKit's look).

## Ports and dev commands
- Anvil `:8545` (`anvil --chain-id 31337 --block-time 1 --accounts 10 --balance 10000`)
- API `:8787`, Web `:5173`
- `scripts/dev-up.sh`: start anvil → DeployAMM → DeployX → Seed → `npm run sdk:sync` → api → web.

## Stages
1. Analysis (the UI teardown UI/UX, the protocol research protocol/architecture) ‖ Contracts (the AMM contracts AMM, the router/MetaSwapX contracts X/router)
2. SDK sync + API (the API) ‖ Web shell + swap (the web shell)
3. Web explore + charts (the explore area) ‖ Web positions (the positions/launches area)
4. Integration, e2e, polish (maintainer)
