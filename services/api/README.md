# @metaswap/api

The MetaSwap backend. It is a Hono server on `http://127.0.0.1:8787` (WebSocket push on `ws://127.0.0.1:8787/ws`) with these parts:

- an **event indexer** that writes to PostgreSQL + TimescaleDB (`DATABASE_URL`), or to SQLite when that is unset;
- **real-time push** over WebSocket, published by the indexer as it commits blocks;
- **USD pricing and analytics**;
- a **smart order router** that returns UniversalRouter calldata with Permit2 support;
- the **MetaSwapX** order book, plus a built-in **filler bot**.

Everything runs against the local Anvil devnet ("MetaChain Devnet", chainId 31337).

```bash
npm run dev -w @metaswap/api        # tsx watch src/index.ts
npm start -w @metaswap/api          # tsx src/index.ts
npm test -w @metaswap/api           # unit + integration (integration auto-skips without a deployed chain)
npm run typecheck -w @metaswap/api
```

To get a chain with contracts and seed data, run `node scripts/dev.mjs --chain-only` from the repo root. Then start the API.

## Environment

| var | default | |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | |
| `METASWAP_RPC` (alias `RPC_URL`) | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `METASWAP_DEPLOYMENT_FILE` | – | Overrides the deployment JSON. Default order: synced `@metaswap/sdk`, then `packages/contracts/deployments/31337.json` if the sdk copy is still a placeholder. |
| `DATABASE_URL` | – | PostgreSQL + TimescaleDB, e.g. `postgres://user:pass@127.0.0.1:5432/metaswap`. `npm start`/`npm run dev` read it from `services/api/.env` (already-set variables win). Unset → SQLite. |
| `DB_PATH` | `services/api/data/metaswap.sqlite` | SQLite file (WAL), used when `DATABASE_URL` is unset |
| `INDEXER_POLL_MS` | `1000` | head polling interval |
| `INDEXER_BATCH_SIZE` | `2000` | blocks per `eth_getLogs` during backfill |
| `INDEXER_REORG_DEPTH` | `32` | how far back to look for a common ancestor |
| `INDEXER_ENABLED` | `true` | |
| `FILLER_ENABLED` | `true` | MetaSwapX filler bot |
| `FILLER_PRIVATE_KEY` | Anvil #9 | Local devnet only. The executor whitelists #9. |
| `FILLER_MIN_PROFIT_USD` | `0` | extra profit the bot requires on top of gas |
| `QUOTE_TTL_MS` | `30000` | `/quote` id lifetime used by `POST /swap` |
| `CORS_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | |
| `STABLE_SYMBOLS` | `mUSDC,mUSDT,mDAI` | USD anchors ($1) |

## Layout

```
src/index.ts            server entry           src/app.ts        routes + service wiring
src/config.ts, context.ts, db.ts (storage interface; backends in src/storage/: postgres.ts, sqlite.ts)
src/realtime/hub.ts     WebSocket hub (/ws): topics, snapshots, publishing from the indexer
src/abis.ts             Uniswap-compatible ABI fragments, checked against the synced sdk ABIs at startup
src/indexer/            backfill from deployment.blockNumber, 1 s head polling, reorg/reset detection
src/pricing/            USD prices (deepest path from stables), candles/bucketing (pure)
src/analytics.ts        token/pool/explore/tx queries      src/accounts.ts  balances/positions/activity
src/routing/            paths, split optimiser, QuoterV2 multicall quoting, UniversalRouter encoder, Permit2
src/x/                  ExclusiveDutchOrder encode/hash/EIP-712, order book + validation
src/filler/             filler bot (SwapRouter02Executor callback data)
```

### Indexer

The indexer reads every relevant log with one `eth_getLogs` per batch, filtered by topic. It indexes:

- V2: factory `PairCreated`, plus pair `Sync`/`Swap`/`Mint`/`Burn`/`Transfer` (LP tokens);
- V3: factory `PoolCreated`, plus pool `Initialize`/`Swap`/`Mint`/`Burn`;
- the NonfungiblePositionManager: `IncreaseLiquidity`/`DecreaseLiquidity`/`Collect`/`Transfer`;
- ERC20 `Transfer` for every pool token;
- WETH `Deposit`/`Withdrawal`;
- the reactor's `Fill`.

It also reads each block's transactions, which give the tx origin for activity and native ETH sends.

- V3 pool balances (used for TVL) come from token transfers, and V2 reserves come from `Sync`. Historical state therefore needs no archive calls.
- At the end of every block that changes anything, it recomputes USD prices and stores `price_points` and `pool_snapshots`. Candles, volume and TVL history are aggregated from these rows when a request arrives.
- All rows are keyed by `(block, logIndex)`, so re-indexing a range is idempotent.
- **Reorg and chain-restart handling:** on every poll, the indexer checks the stored hash of the last indexed block. On a mismatch, it rolls back to the newest common ancestor within `INDEXER_REORG_DEPTH` and replays from there. If there is no common ancestor (for example after an Anvil restart), it rebuilds the index from scratch. A changed deployment does the same.

### Storage

One async interface (`src/storage/common.ts`), two backends:

- **PostgreSQL + TimescaleDB** when `DATABASE_URL` is set. Everything lives in the `metaswap` schema; migrations run in code at startup (`metaswap.schema_version`).
  - Hypertables, partitioned on the unix `timestamp` column in 7-day chunks: `blocks`, `swaps`, `transfers`, `price_points`, `pool_snapshots`.
  - Continuous aggregates (real-time, refreshed by TimescaleDB jobs): `price_ohlc_1m|1h|1d` (first/max/min/last price per token) and `swap_volume_1m|1h|1d` (USD volume, fees and swap count per pool). `GET /tokens/:a/candles` reads them; the output is identical to the SQLite path.
  - A new chain (changed deployment, or a restart with no common ancestor) drops and recreates the schema.
- **SQLite** (`node:sqlite`) otherwise, so tests and fresh clones need no server. Migrations use `PRAGMA user_version`; a new chain truncates the tables.

The indexer decodes a block range into a write batch and commits it in one transaction (multi-row upserts on Postgres). Reads are never blocked by a half-written range. Both backends run the same SQL (written with `?` placeholders).

### Pricing

- mUSDC, mUSDT and mDAI are fixed at $1.
- Other tokens are priced greedily, always through the pool whose priced side holds the most USD. The path usually runs stable → WETH → everything else.
- Tokens with no route stay `null`.

Derived values:

- **TVL** is pool balances × prices.
- **Volume** follows the Uniswap subgraph convention: the average of both legs when both are priced.
- **Fees** are volume × fee tier.
- **APR** is `fees24h × 365 / TVL × 100` (a percentage).
- **FDV** and **market cap** are both `totalSupply × price`, because devnet tokens have no vesting.

### Routing

1. **Find paths.** List every simple path of up to 3 hops over all indexed V2 and V3 pools. Native ETH is treated as WETH. `protocols=v2,v3,mixed` filters the paths.
2. **Quote each path at 100%.** V2 hops use exact reserve math (`v2Math`). V3 hops use `QuoterV2.quoteExact{Input,Output}Single`, batched through `Multicall3.aggregate3`. Pool state is read fresh at the quote block.
3. **Quote the 8 best paths at 5% steps.** Then search 1-, 2- and 3-route splits whose pools don't overlap (the alpha-router approach). Each candidate is scored by its output net of gas, with gas converted into the output token at USD prices.
4. **Re-quote the chosen legs** with their exact amounts.

Price impact is measured against the fee-adjusted mid price. Slippage defaults to 50 bps.

Encoding follows the UniversalRouter command table in `packages/contracts/README.md`:

- **ERC20 input:** swaps use `payerIsUser` (paid through Permit2).
- **ETH input:** `WRAP_ETH` runs first, and `value` is set.
- **ETH output:** swaps send to `ADDRESS_THIS`, then `UNWRAP_WETH` pays the recipient.
- **Mixed routes:** a V3 segment that feeds a V2 segment pays the next pair directly (`amountIn = 0`). A V2 segment that feeds a V3 segment goes through the router balance (`CONTRACT_BALANCE`).
- **Exact output:** only pure V2 or pure V3 routes are used. With ETH input, the router wraps `amountInMax` and refunds the rest.

Permit2:

- If `Permit2.allowance(swapper, token, UniversalRouter)` is too low, or expires before the deadline, the quote includes `permitData`. This is a `PermitSingle` for the max uint160 amount with a 30-day expiration and a 30-minute `sigDeadline`.
- `POST /swap` adds `PERMIT2_PERMIT` at the start of the commands.

### MetaSwapX and the filler bot

`POST /x/orders` checks an order before storing it. It verifies:

- the ABI encoding of the `ExclusiveDutchOrder`;
- that the Permit2 witness signature recovers to `info.swapper`;
- the reactor address, deadline and decay rules;
- that the nonce is unused (`Permit2.nonceBitmap`);
- that the swapper has enough balance and an ERC20 allowance to Permit2.

Order statuses update on every indexed block:

- `filled`: a reactor `Fill` event was seen;
- `cancelled`: the nonce was used without a fill, e.g. via `invalidateUnorderedNonces`;
- `expired`: the deadline has passed.

The filler bot runs on every block. For each open order it:

1. resolves the decay at the next block's timestamp;
2. routes the input through the router;
3. fills through `SwapRouter02Executor.execute` only when the route's output covers the resolved outputs plus gas. The callback data contains SwapRouter02 `exactInput`/`swapExactTokensForTokens` calls, plus `unwrapWETH9` for ETH output.

Each fill is simulated with `estimateGas` before it is sent.

## Endpoints

Amounts are decimal strings in base units unless a field ends in `Formatted` or `Usd`. Errors return `{ error, details? }` with the matching 4xx or 5xx status.

| Method & path | Notes |
|---|---|
| `GET /health` | `{ ok, chainId, indexedBlock, headBlock, deployment, indexerError, filler, networks }` |
| `GET /tokens` | Uniswap token-list (ETH + deployed/discovered tokens) |
| `GET /tokens/:address` | `{ token, priceUsd, change1h, change24h, volume24hUsd, volume7dUsd, tvlUsd, fdvUsd, marketCapUsd, totalSupply, high24hUsd, low24hUsd }` (ETH sentinel `0xEeee…` maps to WETH data) |
| `GET /tokens/:address/candles?interval=1m\|5m\|1h\|1d&from&to` | `[{ time, open, high, low, close, volumeUsd }]` (minute candles aggregated; forward-filled) |
| `GET /tokens/:address/price-history?range=1H\|1D\|1W\|1M\|1Y` | `[{ time, priceUsd }]` |
| `GET /tokens/:address/tvl-history?range=1H\|1D\|1W\|1M\|1Y\|ALL` or `?interval=minute\|hour\|day&from&to` | `[{ time, tvlUsd }]`: the token's reserves across its pools × its price, at each bucket end |
| `GET /explore/stats?interval=minute\|hour\|day` | `{ tvlUsd, volume24hUsd, volume7dUsd, v2:{tvlUsd,volume24hUsd,volume7dUsd,poolCount}, v3:{…}, interval, requestedInterval, bucketSec, volumeHistory:[{time,volumeUsd}], tvlHistory:[{time,tvlUsd}], txCount24h }` (`interval` = the bucket actually used) |
| `GET /explore/tokens?sort=volume\|tvl\|price\|change&order=desc&range=1H\|1D\|1W\|1M\|1Y\|ALL` | token stats rows + `range`, `volumeUsd` (volume over `range`, default 1D; `sort=volume` sorts by it), `volume24hUsd` (always 24h), `sparkline:[{time,priceUsd}]` |
| `GET /explore/pools?sort=tvl\|volume\|apr&order=desc` | `{ address, version, token0, token1, fee, feeTier, tvlUsd, volume24hUsd, volume7dUsd, fees24hUsd, apr }` |
| `GET /explore/transactions?type=swap\|add\|remove&token&pool&account&limit&before` | swaps: `{ type, txHash, blockNumber, timestamp, version, pool, fee, account, tokenIn:{…amount}, tokenOut:{…amount}, amountUsd }`; adds/removes: `token0`/`token1` instead |
| `GET /pools/:address` | pool row + `reserve0/1(+Formatted,+Usd), liquidity, sqrtPriceX96, tick, tickSpacing, totalSupply (v2), token0Price, token1Price, tvlChange24h, volumeChange24h, createdAt` |
| `GET /pools/:address/history?interval=minute\|hour\|day` | `[{ time, volumeUsd, feesUsd, tvlUsd, token0Price }]` |
| `GET /pools/:address/ticks` | v3: `{ currentTick, sqrtPriceX96, liquidity, tickSpacing, ticks:[{ tick, liquidityNet, liquidityGross, liquidityActive, price0, price1 }] }` (exact, from indexed Mint/Burn) |
| `GET /pools/:address/transactions` | same as explore/transactions for one pool |
| `GET /accounts/:address/balances` | `{ totalValueUsd, balances:[{ token, balance, balanceFormatted, priceUsd, valueUsd, change24h }] }` |
| `GET /accounts/:address/positions` | `{ v2:[{ pair, token0:{amount}, token1, liquidity, totalSupply, shareOfPool, valueUsd }], v3:[{ tokenId, pool, fee, tickLower, tickUpper, currentTick, priceLower/Upper, liquidity, token0:{amount}, token1, uncollectedFees:{amount0,amount1,valueUsd}, valueUsd, inRange, closed }], positions:[…] }` |
| `GET /accounts/:address/activity?limit` | swaps/adds/removes/collects/wraps/sends/receives/mints/native sends + MetaSwapX `order` items, newest first |
| `GET /quote?tokenIn&tokenOut&amount&type&slippageBps&recipient&swapper&deadline&protocols&maxHops&maxSplits` | see below |
| `POST /swap` `{ quote, permitSignature? }` | `{ quoteId, methodParameters:{to,calldata,value,gasLimit?}, gasEstimate, permitIncluded, deadline, simulation }` |
| `GET /x/quote?tokenIn&tokenOut&amount&swapper&slippageBps&mode=dutch\|limit&decaySeconds&startDelaySeconds&limitPrice\|limitAmountOut&expirySeconds` | indicative auction + ready-to-sign order |
| `POST /x/orders` `{ encodedOrder, signature }` | 201 + stored order |
| `GET /x/orders?swapper&status=open,filled,expired,cancelled&limit` | orders with `resolved` current amounts |
| `GET /x/orders/:hash` | one order |
| `GET /x/filler` | filler status + recent attempts |

### Stage 5 endpoints (`docs/specs/STAGE5.md` §3)

| Method & path | Notes |
|---|---|
| `GET /explore/trending` | 4–8 token rows ranked by `volume24hUsd × \|change24h\|` (launched tokens included), each with `sparkline`, `tags` and `trendingScore` |
| `GET /explore/tokens?category=all\|trending\|gainers\|stablecoins\|majors\|defi\|l2\|memes\|launched\|wrapped` | the token rows above, filtered (combines with `sort`/`order`/`range`); rows carry `tags: string[]`. `gainers` = positive 1D change, descending; `trending` = by trending score |
| `GET /earn/vaults` | `[{ address, asset: token, symbol, apyBps, apyPct, totalAssets, totalAssetsFormatted, totalShares, tvlUsd, depositors }]` |
| `GET /earn/vaults/:address` | one vault |
| `GET /accounts/:a/earn` | `[{ vault:{address,symbol,apyPct,asset}, shares, assets, assetsFormatted, valueUsd, deposited, depositedUsd, lifetimeEarnings, lifetimeEarningsUsd }]` |
| `GET /launches?status=all\|active\|upcoming\|ended\|launched\|failed&launchpad=<address or name>&verified=true\|false&sort=fdv\|volume\|liquidity\|age\|bidVolume&order&q` | rows: `auction, token, name, symbol, logoURI, launchpad:{address,name}, creator, verified, status, startTime, endTime, createdAt, launchedAt, ageSec, quoteToken, totalSupply, auctionSupply, floorPrice, floorPriceUsd, fdvAtFloorUsd, totalCommitted, bidVolumeUsd, bidCount, raised, threshold, thresholdUsd, thresholdPct, clearingPrice, clearingPriceUsd, clearingFdvUsd` + after launch `pool, priceUsd, fdvUsd, volume24hUsd, liquidityUsd, change1h, change1d, sparkline` |
| `GET /launches/trending` | launched rows by 24h volume |
| `GET /launches/top-verified` | up to 4 verified rows (active first) |
| `GET /launches/:auction?bidsOf=<address>` | row + `params`, `description`, `website`, `priceLevels:[{price,priceUsd,demand,demandUsd,fdvUsd}]`, `bids` (recent 50; while open each has `estimatedTokens/estimatedRefund`, mirroring `previewClaim`), `bidsOf`, `settlement` |
| `GET /accounts/:a/portfolio` | `{ totalUsd, tokensUsd, earnUsd, poolsUsd, change24hUsd, change24hPct, tokens:[{ token, priceUsd, balance, balanceFormatted, valueUsd, avgCostUsd, costBasisUsd, unrealizedPnlUsd, unrealizedPnlPct, change24h, tags }], pools:[positions + status in-range\|out-of-range\|closed, feesUsd], earn, earnLifetimeEarningsUsd, nfts, activity }` |
| `GET /accounts/:a/portfolio/history?range=1H\|1D\|1W\|1M\|1Y\|ALL` | `[{ time, valueUsd }]`: 60–122 buckets; at each, ETH + every token `balanceOf`, vault shares → assets, V2 LP and V3 positions are read **at the historical block** (one Multicall per bucket) and valued at that time's prices. The last point uses live prices, so it matches `totalUsd`. Cached 30 s |
| `GET /accounts/:a/nfts` | V3 position NFTs `{ tokenId, contract, pool, name, image (data:image/svg+xml), tokenURI, inRange, closed }` |
| `GET /accounts/demo` | `{ address, label }`: the demo wallet (Anvil #19, built and kept active by `scripts/market.ts`: ~$2–5k of tokens, one V3 position, an Earn deposit and a launch bid; acts every 1–3 min in live mode) |

How the Stage 5 values are computed:

- **Cost basis** uses the average cost of every inflow (ERC20 transfers in, WETH wraps, native ETH receives, router unwraps, and the genesis ETH balance), each valued at the USD price when it arrived. Tokens claimed from a launch auction cost the clearing price. `costBasisUsd = avgCostUsd × balance`.
- **Earn earnings** are `assets now + withdrawn − deposited`, in asset units.
- **Indexing.** The indexer picks up the vaults from `deployment.vaults` and the launchpads from `contracts.Launchpad`/`DevnetPad`. It indexes each launchpad's `LaunchCreated`, plus `BidPlaced`/`Settled`/`Claimed` on every discovered auction. Launched tokens join the token set, and their V3 pools join through the factory's `PoolCreated`.
- **No historical node state.** Anvil runs with `--prune-history 512`, so nothing reads state older than the head. Portfolio history and `change24h` rebuild holdings backwards from the current on-chain holdings using indexed events, then value them with the indexed prices at each bucket:
  - ERC20, WETH, vault shares and LP tokens follow `Transfer`/`Deposit`/`Withdrawal` events.
  - V3 liquidity follows `IncreaseLiquidity`/`DecreaseLiquidity`; the pool price comes from the indexed snapshots.
  - ETH follows the `value` of top-level txs plus the ETH paid out by unwraps the account triggered. Gas is ignored, since it is about 0 on the devnet.
  - Vault assets per share are discounted by the APY.

### History buckets on a young chain

History endpoints (`/explore/stats`, `/pools/:address/history` and `/tokens/:address/tvl-history`) take `interval=minute|hour|day` and default to `hour`. A fresh devnet would otherwise give one-point charts, so the API refines the bucket size automatically:

- While the indexed data spans less than 2 hours, `hour` and `day` return **minute** buckets.
- While it spans less than 2 days, `day` returns **hour** buckets.
- `minute` is always honoured, and covers the last 24 hours.

The windows are 24 hours for minute buckets, 7 days for hourly and 365 days for daily. `/explore/stats` reports the bucket it actually used in `interval` and `bucketSec`.

### Example: `GET /quote?tokenIn=<mUSDC>&tokenOut=<WETH>&amount=3000000000&swapper=0x…`

```jsonc
{
  "id": "6f0c…", "expiresAt": 1792514001, "type": "EXACT_INPUT", "blockNumber": "512",
  "tokenIn": { "symbol": "mUSDC", "decimals": 6, … }, "tokenOut": { "symbol": "WETH", … },
  "amountIn": "3000000000", "amountOut": "997951532617373215", "amountOutMin": "992961775" /* … */,
  "priceImpactBps": 1, "gasEstimate": "171000", "gasUsd": 0.52, "slippageBps": 50, "deadline": "1792515771",
  "route": [[{ "type": "v3", "pool": "0x423C…", "tokenIn": {…}, "tokenOut": {…}, "fee": 500, "amountIn": "3000000000", "amountOut": "9979…" }]],
  "routes": [{ "percent": 100, "protocol": "v3", "routeString": "mUSDC --[V3 0.05%]--> WETH", … }],
  "routeString": "[100%] mUSDC --[V3 0.05%]--> WETH",
  "methodParameters": { "to": "<UniversalRouter>", "calldata": "0x3593564c…", "value": "0" },
  "permit2": { "required": true, "spender": "<UniversalRouter>", "permit2Address": "<Permit2>", "token": "<mUSDC>", "allowance": "0", "expiration": 0, "nonce": 0 },
  "permitData": {
    "domain": { "name": "Permit2", "chainId": 31337, "verifyingContract": "<Permit2>" },
    "types": { "PermitSingle": […], "PermitDetails": […] }, "primaryType": "PermitSingle",
    "values": { "details": { "token": "<mUSDC>", "amount": "1461501637330902918203684832716283019655932542975", "expiration": "1795105971", "nonce": "0" }, "spender": "<UniversalRouter>", "sigDeadline": "1792515771" }
  },
  "approval": { "required": true, "token": "<mUSDC>", "spender": "<Permit2>", "currentAllowance": "0", "amount": "3000000000" }
}
```

How the web app uses this:

1. If `approval.required`, send `approve(Permit2, max)`.
2. If `permit2.required`, sign `permitData`. Convert the string numbers in `values` first: BigInt for `amount`/`sigDeadline`, Number for `expiration`/`nonce`.
3. `POST /swap { quote, permitSignature }`.
4. Send `methodParameters`, using `gas = gasLimit` when it is present.

### Example: MetaSwapX

```bash
GET /x/quote?tokenIn=<mUSDC>&tokenOut=<WETH>&amount=2000000000&swapper=0x…&decaySeconds=60
# → { mode:"dutch", reactor, permit2, input:{…}, outputs:[{ token, startAmount, endAmount, recipient }],
#     decayStartTime, decayEndTime, deadline, classicAmountOut, improvementBps:10,
#     order:{…}, encodedOrder:"0x…", orderHash:"0x…", typedData:{ domain, types, primaryType:"PermitWitnessTransferFrom", message } }
# sign typedData (or rebuild it from encodedOrder), then:
POST /x/orders { "encodedOrder": "0x…", "signature": "0x…" }
# → 201 { orderHash, status:"open", resolved:{ input, outputs }, … }  → becomes "filled" when the bot fills it
```

## WebSocket (`ws://127.0.0.1:8787/ws`)

The indexer publishes after it commits each block range, so a pushed value always matches what the REST endpoint returns at that moment. Payloads reuse the REST shapes. Amounts are base-unit strings and addresses are checksummed, as in REST.

**Client → server** (JSON text frames; `id` is optional and echoed back):

```json
{ "op": "subscribe",   "topics": ["blocks", "prices", "account:0xabc…"], "id": 1 }
{ "op": "unsubscribe", "topics": ["blocks"], "id": 2 }
{ "op": "ping", "id": 3 }
```

**Server → client:**

```json
{ "type": "hello", "indexedBlock": 1234, "indexedTimestamp": 1792300000, "topics": ["blocks", "prices", "explore", "launches", "x:orders", "token:<address>", "pool:<address>", "account:<address>"] }
{ "type": "subscribed", "id": 1, "topics": ["blocks", "prices", "account:0xabc…"], "invalid": ["token:nope"] }
{ "type": "unsubscribed", "id": 2, "topics": ["prices", "account:0xabc…"] }
{ "type": "pong", "id": 3 }
{ "type": "error", "message": "…" }
{ "type": "event", "topic": "<topic>", "event": "<event>", "block": 1235, "data": { … }, "snapshot": true }
```

- Topic addresses are case-insensitive. The server stores them lower-case and echoes that form in `topic`.
- `subscribed`/`unsubscribed` list the client's full current set. `invalid` lists topics that were rejected. The limit is 200 topics per connection.
- Right after a subscribe, some topics get one event with `"snapshot": true` holding the current state: `blocks`, `prices`, `explore` (stats), `token:` (price), `pool:` (state) and `account:` (portfolio).
- The server pings every 30 s and drops connections that do not answer. Browsers answer automatically.
- On reconnect, re-subscribe, then refetch over REST anything you may have missed.

| topic | event | `data` | when |
|---|---|---|---|
| `blocks` | `block` | `{ number, hash, timestamp }` | every committed range (≈ every block live) |
| | `reorg` | `{ rolledBackTo }` | rollback after a reorg; refetch |
| | `reset` | `{}` | new chain, index rebuilt; refetch everything |
| `prices` | `prices` | `{ timestamp, prices: { <token>: usd } }` | only the tokens whose price changed. Native ETH = the WETH price. |
| `explore` | `txs` | `[tx]` (same shape as `/explore/transactions`, oldest first) | new swaps / adds / removes |
| | `stats` | `{ tvlUsd, volume24hUsd, volume7dUsd, txCount24h, v2, v3 }` (as `/explore/stats`, without the histories) | at most every 5 s |
| `token:<addr>` | `price` | `{ token, priceUsd, timestamp }` | the token's price changed |
| | `candle` | `{ interval: "1m", candle: { time, open, high, low, close, volumeUsd } }` | the current minute candle (upsert by `time`) |
| | `txs` | `[tx]` in pools containing the token | new trades / liquidity |
| `pool:<addr>` | `state` | `{ address, version, reserve0, reserve1, sqrtPriceX96, tick, liquidity, token0Price, token1Price, tvlUsd, volume24hUsd, fees24hUsd, apr }` | the pool changed |
| | `txs` | `[tx]` | new trades / liquidity in the pool |
| `account:<addr>` | `activity` | new items in the `/accounts/:a/activity` shape | the account appears in the range (origin, sender/receiver, bidder, depositor, …) |
| | `balances` | `/accounts/:a/balances` | same |
| | `positions` | `/accounts/:a/positions` | same |
| | `portfolio` | `{ address, totalUsd, tokensUsd, earnUsd, poolsUsd, change24hUsd, change24hPct, tokens, pools, earn }` (as `/accounts/:a/portfolio`, without nfts/activity) | on activity, and at most every 5 s when prices move |
| | `order` | MetaSwapX order (as `/x/orders/:hash`) | the account's order was submitted or changed status |
| `launches` | `launch` | `{ auction, token, name, symbol, launchpad }` | new launch |
| | `bid` | `{ auction, bidId, bidder, amount, maxPrice, txHash, blockNumber, timestamp }` | new bid |
| | `update` | a `/launches` row + `previousStatus` | status change (time-based too: upcoming → active → ended) or new bids on that auction |
| | `settled` | `{ auction, launched, clearingPrice, raised, pool, txHash }` | auction settled |
| | `claim` | `{ auction, bidId, bidder, tokens, refund, txHash }` | bid claimed |
| `x:orders` | `order` | MetaSwapX order (as `/x/orders/:hash`) | any order submitted or changing status (filled / expired / cancelled) |

Example (browser):

```js
const ws = new WebSocket('ws://127.0.0.1:8787/ws')
ws.onopen = () => ws.send(JSON.stringify({ op: 'subscribe', topics: ['prices', `account:${address}`] }))
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.type !== 'event') return
  if (m.topic === 'prices') updatePrices(m.data.prices)
  else if (m.event === 'portfolio') setPortfolio(m.data)
}
```

## Tests

- **Unit tests** (`test/unit`, 48 tests):
  - path enumeration and V3 path encoding;
  - V2 math, mid price and price impact, gas conversion, slippage;
  - the split optimiser;
  - UniversalRouter calldata, decoded back with viem: permit, splits, WRAP/UNWRAP, mixed V2↔V3, exact output;
  - Permit2 `PermitSingle` and the MetaSwapX witness digest, checked against the contracts' typehash strings, plus sign/recover;
  - order encoding and decay;
  - USD pricing;
  - candle and bucket aggregation;
  - TickMath.
- **Integration tests** (`test/integration`, 19 tests): these run only when `METASWAP_RPC` (default `:8545`) has a deployment whose UniversalRouter and reactor have code. They start the API in-process with a temporary DB, use fresh `anvil_setBalance`-funded accounts, and cover:
  - a Permit2 approve + sign + `/swap` round trip;
  - ETH input (WRAP) and ETH output (UNWRAP);
  - a 2-hop swap, a split trade and an exact-output trade, each executed and checked against `amountOutMin`/`amountInMax`;
  - the indexer picking up a swap and `/explore/transactions` plus account activity showing it;
  - token, candle, price, explore, pool and tick data for seeded tokens;
  - balances and positions;
  - a MetaSwapX Dutch order filled by the filler bot on-chain;
  - nonce-invalidation cancellation;
  - minute pool history, token TVL history, explore token ranges and auto-refined stats buckets.
- **WebSocket test** (`test/integration/realtime.test.ts`): it subscribes to every topic kind, performs a wrap and a swap, and checks the block, price, token, pool, explore and account events.
- **Both storage backends:** the suite uses SQLite by default. Set `DATABASE_URL` to run it on Postgres (use a separate database such as `metaswap_test`):
  ```bash
  DATABASE_URL=postgres://…/metaswap_test METASWAP_RPC=http://127.0.0.1:8555 METASWAP_DEPLOYMENT_FILE=$TEMP/ms-8555.json npx vitest run test/integration
  ```
- `scripts/test-chain.sh` starts a private Anvil on `:8555`, deploys and seeds it, and leaves the shared `deployments/31337.json` unchanged. Run the suite against it:
  ```bash
  METASWAP_RPC=http://127.0.0.1:8555 METASWAP_DEPLOYMENT_FILE=$TEMP/ms-8555.json npx vitest run test/integration
  ```
