# Interface change log

Changes to the binding interfaces in PLAN.md, newest first.

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
