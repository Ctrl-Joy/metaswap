# @metaswap/api

The MetaSwap backend. It is a Hono server on `http://127.0.0.1:8787` with four parts:

- an **event indexer** that writes to SQLite;
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
| `DB_PATH` | `services/api/data/metaswap.sqlite` | SQLite file (WAL) |
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
src/config.ts, context.ts, db.ts (schema migrations in code, PRAGMA user_version)
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
| `GET /explore/stats?interval=hour\|day` | `{ tvlUsd, volume24hUsd, volume7dUsd, v2:{tvlUsd,volume24hUsd,volume7dUsd,poolCount}, v3:{…}, volumeHistory:[{time,volumeUsd}], tvlHistory:[{time,tvlUsd}], txCount24h }` |
| `GET /explore/tokens?sort=volume\|tvl\|price\|change&order=desc` | token stats rows + `sparkline:[{time,priceUsd}]` |
| `GET /explore/pools?sort=tvl\|volume\|apr&order=desc` | `{ address, version, token0, token1, fee, feeTier, tvlUsd, volume24hUsd, volume7dUsd, fees24hUsd, apr }` |
| `GET /explore/transactions?type=swap\|add\|remove&token&pool&account&limit&before` | swaps: `{ type, txHash, blockNumber, timestamp, version, pool, fee, account, tokenIn:{…amount}, tokenOut:{…amount}, amountUsd }`; adds/removes: `token0`/`token1` instead |
| `GET /pools/:address` | pool row + `reserve0/1(+Formatted,+Usd), liquidity, sqrtPriceX96, tick, tickSpacing, totalSupply (v2), token0Price, token1Price, tvlChange24h, volumeChange24h, createdAt` |
| `GET /pools/:address/history?interval=hour\|day` | `[{ time, volumeUsd, feesUsd, tvlUsd, token0Price }]` |
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

## Tests

- **Unit tests** (`test/unit`, 35 tests):
  - path enumeration and V3 path encoding;
  - V2 math, mid price and price impact, gas conversion, slippage;
  - the split optimiser;
  - UniversalRouter calldata, decoded back with viem: permit, splits, WRAP/UNWRAP, mixed V2↔V3, exact output;
  - Permit2 `PermitSingle` and the MetaSwapX witness digest, checked against the contracts' typehash strings, plus sign/recover;
  - order encoding and decay;
  - USD pricing;
  - candle and bucket aggregation;
  - TickMath.
- **Integration tests** (`test/integration`, 12 tests): these run only when `METASWAP_RPC` (default `:8545`) has a deployment whose UniversalRouter and reactor have code. They start the API in-process with a temporary DB, use fresh `anvil_setBalance`-funded accounts, and cover:
  - a Permit2 approve + sign + `/swap` round trip;
  - ETH input (WRAP) and ETH output (UNWRAP);
  - a 2-hop swap, a split trade and an exact-output trade, each executed and checked against `amountOutMin`/`amountInMax`;
  - the indexer picking up a swap and `/explore/transactions` plus account activity showing it;
  - token, candle, price, explore, pool and tick data for seeded tokens;
  - balances and positions;
  - a MetaSwapX Dutch order filled by the filler bot on-chain;
  - nonce-invalidation cancellation.
- `scripts/test-chain.sh` starts a private Anvil on `:8555`, deploys and seeds it, and leaves the shared `deployments/31337.json` unchanged. Run the suite against it:
  ```bash
  METASWAP_RPC=http://127.0.0.1:8555 METASWAP_DEPLOYMENT_FILE=$TEMP/ms-8555.json npx vitest run test/integration
  ```
