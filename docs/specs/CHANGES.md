# Interface change log

Changes to the binding interfaces in PLAN.md, newest first.

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
