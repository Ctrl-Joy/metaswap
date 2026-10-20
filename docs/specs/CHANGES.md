# Interface change log

Changes to the binding interfaces in PLAN.md, newest first.

## 2026-10-21 — Backend: Postgres/TimescaleDB, WebSocket push, live demo wallet (API)
Additive for REST clients: shapes are unchanged except the demo address.
- **Storage:** the API uses PostgreSQL + TimescaleDB when `DATABASE_URL` is set. `npm start` reads it from `services/api/.env`. Without it, the API falls back to SQLite.
  - Everything lives in schema `metaswap`, and migrations run in code.
  - Hypertables: `blocks`, `swaps`, `transfers`, `price_points`, `pool_snapshots`.
  - Candles come from continuous aggregates: `price_ohlc_1m|1h|1d` and `swap_volume_1m|1h|1d`.
  - A new chain drops and recreates the schema.
  - `/health` adds `database: "postgres"|"sqlite"`.
- **WebSocket** at `ws://127.0.0.1:8787/ws`. Topics: `blocks`, `prices`, `explore`, `launches`, `x:orders`, `token:<addr>`, `pool:<addr>`, `account:<addr>`. The client contract and message shapes are in `services/api/README.md` under "WebSocket".
- **Demo wallet:** `GET /accounts/demo` is now **Anvil #19** (`0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199`), not #1.
  - `market.ts --history` builds it, worth ~$3.5k: ETH, WETH, mUSDC, META, mARB, a WETH/mUSDC V3 position, a meUSDC deposit, and a MANGO bid that it later claims.
  - `--live` makes it trade, deposit or withdraw, or collect fees every 1–3 minutes.
  - #15–#18 remain extra bidders. #1 is no longer used by `market.ts`.

## 2026-10-21 — Stage 5 API notes (API)
All STAGE5 §3 endpoints are implemented with the specified fields. The additions below are additive (see `services/api/README.md` "Stage 5 endpoints"):
- New endpoints: `GET /earn/vaults/:address` and `GET /accounts/:a/nfts`. `/accounts/demo` also returns `label: "Demo wallet"`.
- Launch rows:
  - `launchpad` is `{ address, name }`, not a bare string.
  - Bid volume is `totalCommitted` → `bidVolumeUsd`. The contract's `totalBids()` is a count and is exposed as `bidCount`.
  - Rows also carry `clearingFdvUsd`, `priceUsd`, `launchedAt` and `creator`.
  - `status` also accepts `ended` (between endTime and settle).
- `/launches/:auction` bids carry `estimatedTokens` / `estimatedRefund` while the auction is open. These mirror `previewClaim`.
- `/explore/tokens` rows carry `tags`. `/explore/trending` rows add `trendingScore`.
- The portfolio adds a `tokensUsd` / `earnUsd` / `poolsUsd` breakdown, where `totalUsd` is their sum. Pool value is principal; uncollected fees are reported separately.
- Activity adds item types `earn-deposit`, `earn-withdraw`, `bid` and `claim`.
- **History without archive state.** Portfolio history and `change24h` are rebuilt from indexed events, and nothing reads state older than the head, so anvil's `--prune-history 512` is fine. The earlier request for `--max-persisted-states` is withdrawn.
- **Request (`packages/sdk`):** add `Launchpad` and `DevnetPad` to `ContractName`, and `vaults?: { address, asset, symbol, apyBps }[]` to `Deployment`. The API and `market.ts` read them through a cast until then. I added the four Stage 5 ABIs to `sync.mjs`'s CONTRACTS map as asked.
- `scripts/market.ts` honours `METASWAP_RPC` and `METASWAP_DEPLOYMENT_FILE`, so it can be pointed at a private chain.

## 2026-10-20 — API: fine-grained history for explore charts (API)
Additive; existing shapes unchanged.
- `GET /pools/:address/history?interval=minute|hour|day` (default `hour`).
- New `GET /tokens/:address/tvl-history` → `[{ time, tvlUsd }]`. It takes `range=1H|1D|1W|1M|1Y|ALL`, or the explore area's
  current `interval=hour|day&from=<unix>` (plus optional `to`).
- `GET /explore/tokens?range=1H|1D|1W|1M|1Y|ALL` (case-insensitive, default 1D) adds `volumeUsd` (volume over the
  range) and `range`. `volume24hUsd` is kept, and `sort=volume` now sorts by `volumeUsd`.
- Young-chain auto-refinement for `/explore/stats`, pool history and token TVL history:
  - while the data spans less than 2 hours, `hour` and `day` return minute buckets;
  - while it spans less than 2 days, `day` returns hour buckets;
  - `interval=minute` is always honoured.

  `/explore/stats` adds `interval` (the bucket actually used), `requestedInterval` and `bucketSec`. the explore area's existing
  calls (`interval=day` / `hour`) get fine buckets with no web change.

## 2026-10-20 — API additions on top of PLAN.md (API, services/api)
All PLAN paths/fields are implemented as specified; these are **additive** (see `services/api/README.md`):
- `GET /quote` takes `swapper=<address>` (the wallet that will send the tx). The Permit2/ERC20 allowance checks
  (`permit2.required`, `permitData`, `approval`) need it; without it `permit2.required` is `null`.
  Also `maxHops` (default 3) and `maxSplits` (default 3). `deadline` = unix seconds, or seconds-from-now if < 1e9.
- The quote response adds `id` (30 s TTL), `routes[]` (percent/amounts per split leg), `approval`
  (`{ required, token, spender: Permit2 }`) and, when allowances are in place, `methodParameters.gasLimit`
  (simulated estimate +30%). **Web: send `gas = methodParameters.gasLimit` when present.** In testing, tight
  wallet-side estimates sometimes ran out of gas on V3 swaps. `POST /swap` returns `gasLimit` too.
- `permitData.values` numbers are decimal strings (JSON). Convert `amount`/`sigDeadline` to BigInt and
  `expiration`/`nonce` to Number before `signTypedData`.
- `POST /swap` accepts `{ quote: <quote object or id>, permitSignature? }`. It returns 410 when the quote has expired.
- MetaSwapX: `GET /x/quote?tokenIn&tokenOut&amount&swapper&slippageBps&mode=dutch|limit&decaySeconds|limitPrice|limitAmountOut&expirySeconds`
  returns a ready-to-sign order (`encodedOrder`, `orderHash`, `typedData`) when `swapper` is given.
  `POST /x/orders { encodedOrder, signature }` → 201 with the stored order. Native ETH output uses token `0x0`.
  ETH input is rejected (wrap it first). Exact-output X quotes are not supported.
- Extra endpoints: `GET /pools/:address/transactions`, `GET /x/filler` (bot status), `/explore/stats?interval=day`,
  `/pools/:address/history?interval=day`. `apr` is a percentage (fees24h×365/TVL×100).

## 2026-10-20 — `POST /swap` added (maintainer)
Source: protocol research research (`docs/analysis/flows.md`). The Permit2 flow needs calldata rebuilt after the
user signs, so the API mirrors Uniswap's Trading API: `GET /quote` returns `permit2.required` +
`permitData` (EIP-712 PermitSingle), and `POST /swap { quote, permitSignature? }` returns
`methodParameters` with a `PERMIT2_PERMIT` command prepended. See the API section of PLAN.md.

## 2026-10-20 — V3 fee tier 100 must be enabled
Source: protocol research. Uniswap's v3 factory constructor only enables 500/3000/10000. MetaSwapV3Factory enables
100 (tick spacing 1) too, as PLAN.md requires.

## 2026-10-20 — UniversalRouter swap inputs omit `minHopPriceX36`
Source: protocol research. Recent Uniswap UniversalRouter versions append a per-hop min-price array to
V2/V3 swap inputs. MetaSwap uses the classic encoding without it (see `docs/analysis/protocol.md`).

## 2026-10-20 — MetaSwapX Permit2 witness type string uses sorted EIP-712 order (router & MetaSwapX contracts)
UniswapX's `ExclusiveDutchOrderLib.PERMIT2_ORDER_TYPE` lists `ExclusiveDutchOrder(...)` before `DutchOutput(...)`.
MetaSwap lists referenced types alphabetically (`DutchOutput`, `ExclusiveDutchOrder`, `OrderInfo`,
`TokenPermissions`), which is what viem/ethers/alloy `signTypedData` produce, so the web app can sign orders with
plain `signTypedData`. Exact strings: `packages/contracts/README.md` ("MetaSwapX & Router").

## 2026-10-21 — Stage 5 contracts: details beyond STAGE5.md (router & MetaSwapX contracts)
- Price unit: whole quote per whole token × 1e18, decimal-agnostic (0.05 mUSDC = 5e16). `fdvAtFloor()` is returned in quote base units.
- `totalBids()` = number of bids. `raised()` = quote committed until settlement, then the actual proceeds at the
  clearing price; `totalCommitted()` is always the committed sum. Launch requires proceeds > 0 and ≥ threshold.
- When the bids above a level already buy the whole supply, the clearing price falls between two levels:
  `demandAbove / supply`, rounded up to the tick.
- Leftover tokens (unsold auction supply + reserve not used for the LP) and the non-LP proceeds go to the creator.
- `bidETH` bids are refunded in ETH; ERC20 bids in the quote token. `claim(bidId)` can be called by anyone and pays the bidder.
- Extras: `previewClaim`, `bidsOf` returning `BidInfo` structs, `demandAt`, `lpTokenId`, and a launchpad
  `VerifiedSet(address indexed auction, bool verified)` event. Launchpad validation reverts are `InvalidParams(uint8 code)`.
  These keep the launchpad under EIP-170 (156 bytes of margin).
