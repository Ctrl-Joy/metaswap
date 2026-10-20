# MetaSwapX (UniswapX-style intents) and MetaChain (Unichain-style L2) (protocol research)

Research for the MetaSwapX contracts and filler (router & MetaSwapX contracts, the API) and the MetaChain ecosystem page (the web shell). Sources are inline. Items marked **(unverified)** came from memory or were not confirmed in a fetched source.

---

## Part 1: UniswapX design

Sources: https://developers.uniswap.org/llms.mdx/docs/liquidity/uniswapx/concepts/auction-types , https://developers.uniswap.org/llms.mdx/docs/liquidity/uniswapx/concepts/architecture , https://developers.uniswap.org/llms.mdx/docs/liquidity/uniswapx/overview , and the contracts at https://github.com/Uniswap/UniswapX (src/lib/ExclusiveDutchOrderLib.sol, DutchDecayLib.sol, DutchOrderLib.sol, OrderInfoLib.sol, src/reactors/ExclusiveDutchOrderReactor.sol, src/base/ReactorStructs.sol).

### 1.1 Core idea
- Swappers sign an **order** (intent) that specifies outputs and the auction parameters; no on-chain tx is needed to start. Input tokens are pulled at fill time through **Permit2** `permitWitnessTransferFrom`, with the order as the witness, so the signature only authorizes that exact order.
- **Fillers** (anyone, permissionless) compete to settle the order when profitable. Filler pays gas, is paid the spread between input and outputs. Failed fills cost the user nothing.
- Swapper gets **gasless** UX: no approval-per-trade beyond the one-time Permit2 approve, no gas.

### 1.2 Order types
| Type | Reactor (this repo) | Behavior |
|---|---|---|
| Limit | `LimitOrderReactor` | Static outputs, fill any time before deadline |
| Dutch (linear, timestamp) | `V2DutchOrderReactor` | Outputs decay linearly over `[decayStartTime, decayEndTime]` (seconds) |
| Dutch (linear, block) | `V3DutchOrderReactor` | Same but in block numbers (used on Unichain and other DutchV3 chains per docs) |
| **Exclusive Dutch** | `ExclusiveDutchOrderReactor` | Dutch decay plus an exclusive-filler window before `decayStartTime`, optional override via `exclusivityOverrideBps` |
| Priority | `PriorityOrderReactor` | Fill competition by priority gas fee; outputs with priority-based bonus |

Auction timing on chains (docs): Ethereum uses RFQ + Exclusive Dutch with time-based windows (about 24 s / 2 blocks exclusivity). Unichain and other DutchV3 chains use the same model with **block-based** windows, set per order by the cosigner. (`auction-types`)

### 1.3 Reactor and fill contract roles
- **Reactor** (`IReactor`): validates the signed order, resolves decayed inputs and outputs (`DutchDecayLib.decay`), checks exclusivity, pulls input via Permit2 to the **fill contract** (executor), calls `reactorCallback`, then verifies outputs were delivered to each `recipient`.
- **Executor / fill contract** (`SwapRouter02Executor` sample): receives input tokens, swaps through pools (V2/V3 via SwapRouter02), pays outputs in `reactorCallback`. A **direct fill** is also possible with `address(1)` as fill contract (filler pays outputs from own balance). (`architecture`)
- `execute(SignedOrder)` and `executeWithCallback(SignedOrder, bytes)`; `SignedOrder { bytes order; bytes sig; }`.

### 1.4 Decay math (exact, `DutchDecayLib.sol`)
```
decay(start, end, decayStart, decayEnd):
  t = block.timestamp (or block.number for V3)
  if t <= decayStart: amount = start
  if t >= decayEnd:   amount = end
  else:               amount = start + (end - start) * (t - decayStart) / (decayEnd - decayStart)   // floor
```
- Output tokens decay **down** (start ≥ end), input tokens decay **up** (start ≤ end, for exact-output style orders). Reactor rejects orders that decay both.
- Validation: `deadline >= decayEndTime >= decayStartTime`.
- Priority and V3 nonlinear curves: V3 on DutchV3 chains uses a multi-point curve (`NonlinearDutchDecayLib`, **unverified** in this pass).

### 1.5 Struct and typestrings (`ExclusiveDutchOrderLib.sol`, `OrderInfoLib.sol`, `DutchOrderLib.sol`)
```
OrderInfo = { address reactor; address swapper; uint256 nonce; uint256 deadline;
              address additionalValidationContract; bytes additionalValidationData }
  "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)"

DutchOutput = { address token; uint256 startAmount; uint256 endAmount; address recipient }
  "DutchOutput(address token,uint256 startAmount,uint256 endAmount,address recipient)"

ExclusiveDutchOrder = { OrderInfo info; uint256 decayStartTime; uint256 decayEndTime;
                        address exclusiveFiller; uint256 exclusivityOverrideBps;
                        DutchInput input /* token, startAmount, endAmount */; DutchOutput[] outputs }
  "ExclusiveDutchOrder(OrderInfo info,uint256 decayStartTime,uint256 decayEndTime,address exclusiveFiller,uint256 exclusivityOverrideBps,address inputToken,uint256 inputStartAmount,uint256 inputEndAmount,DutchOutput[] outputs)"

Permit2 witness string:
  "ExclusiveDutchOrder witness)" + DutchOutput + ExclusiveDutchOrder + OrderInfo + "TokenPermissions(address token,uint256 amount)"
  typehash stub: "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,"
```
Witness hash: `keccak256(abi.encode(ORDER_TYPE_HASH, info-hash, decayStartTime, decayEndTime, exclusiveFiller, exclusivityOverrideBps, inputToken, inputStartAmount, inputEndAmount, keccak256(outputs-hashes)))` where `outputs-hashes` = concatenated `DutchOutput` struct hashes. (Matches `ExclusiveDutchOrderLib.hash` pattern; copy the exact encoding from the source when implementing, do not re-derive.)

Permit2 spender for the pull is the **reactor** (`spender = RX`), and `permitted = { token: inputToken, amount: inputStartAmount }`, `nonce` is the Permit2 unordered nonce (cancel mechanism), `deadline = info.deadline`.

### 1.6 Exclusivity
- Before `decayStartTime`, only `exclusiveFiller` can fill. If `exclusiveFiller == 0x0`, the order is open from creation.
- `exclusivityOverrideBps > 0`: a non-exclusive filler may still fill during the window if it improves **every** output by at least `exclusivityOverrideBps` (soft exclusivity: swapper never gets less than the exclusive price). The reactor's `handleExclusiveOverrideTimestamp` applies this (source file `ExclusivityOverrideLib.sol` was not retrievable in this pass; verify before implementing).

### 1.7 RFQ, quoting and cosigner
- **RFQ**: on Ethereum the interface gets a *soft quote* (indicative) from a permissioned set of quoters, then a *hard quote* after the user signs, and the highest hard quote gets exclusivity for a short window. If the exclusive filler "fades", the order drops to an open Dutch auction. Quoters are permissioned; fillers are permissionless. (`auction-types`)
- **Cosigner**: a service that co-signs the auction parameters (for example `decayStartBlock`, timing) to reflect real-time prices, because quoting and signing can be ~30 s apart. The cosigner never exceeds the user's slippage bound. Uniswap Labs is cosigner for its interface and API. (`auction-types`)
- **MetaSwapX**: no RFQ network. Single operator-run API acts as the "quoter" for indicative prices (`GET /x/quote`) and the order book for fills. The API may optionally add a cosigner signature later (out of v1 scope); v1 uses the user signature only.

### 1.8 Gasless UX
- User signs typed data (no tx) → posts to API. Filler pays gas, so the user holds no ETH for the swap.
- Costs to user: one-time approval of the sell token to Permit2 (a tx), and gas for cancel (an on-chain `invalidateUnorderedNonces`).
- Failed fill: no fee; the order stays open until expiry.

### 1.9 Cancellation and expiry
- **Cancel**: `Permit2.invalidateUnorderedNonces(wordPos, mask)` where `wordPos = nonce >> 8` and `mask` sets bit `nonce & 0xff`. After that, any fill reverts when Permit2 checks the nonce. (Uniswap nonces are unordered bits in Permit2's bitmap.)
- **Expiry**: once `block.timestamp > deadline` the reactor refuses fills. Off-chain status `expired` is set by the API.

### 1.10 Filler economics (for the MetaSwapX filler bot)
- Filler receives input tokens and pays outputs. Profit = (decayed input value) − (outputs value) − gas cost, if sourced from a route with better price than the decayed outputs.
- Decision each block: quote the route through V2/V3 with `QuoterV2` (eth_call) or reserve math, compare to outputs at current decay point, fill if `profit > minProfit`.
- Exclusive window: a filler that is not exclusive must wait until `decayStartTime` (or pay the override amount).

---

## Part 2: Unichain (reference) and MetaChain (planned)

Sources: https://developers.uniswap.org/llms.mdx/docs/unichain (Unichain overview, fetched with curl; origin docs.unichain.org redirects here).

### 2.1 Unichain facts (from the fetched overview)
- DeFi-focused **Ethereum L2**, built on the **OP Stack**, part of the **Superchain**; shares standards and tooling with other OP Stack chains.
- **Stage 1 rollup**: permissionless fault-proof system for trust-minimized security.
- **1-second block time**; **200 ms preconfirmations via Flashblocks** (streams partial block updates; out-of-protocol, does not change consensus). Use `pending` block tag with standard JSON-RPC methods.
- Chain IDs and RPC: **Mainnet 130** (`https://mainnet.unichain.org`, explorer uniscan.xyz); **Sepolia 1301** (`https://sepolia.unichain.org`, sepolia.uniscan.xyz). Public RPCs are rate limited and not for production.
- EVM equivalent; OP Stack EIP-1559 gas settings; sequencer for execution, full nodes verify blocks independently.
- Native interoperability with other Superchain chains (interop docs link: docs.optimism.io/get-started/interop).
- Bridge via Superbridge and others (Across, Brid.gg, Allbridge, Synapse, thirdweb, Relay, Orbiter).
- Unichain whitepaper linked from the docs (`whitepaper_unichain.pdf`) and the Flashblocks, network-info and EVM-equivalence pages are linked but were **not fetched** in this pass.

**Discrepancy to flag:** PLAN.md and the user brief say "250 ms flashblocks"; the Unichain overview says **200 ms preconfirmations**. Use **250 ms** only as a MetaChain *devnet/product* parameter (our own target), and the ecosystem page should say "~200–250 ms" or cite the Unichain figure as Unichain's own number.

**Not confirmed in fetched material (treat as unverified):** "Unichain Validation Network" as a named program (mentioned in the task brief; no fetched page confirmed it), and exact superchain interop message timing.

### 2.2 MetaChain (what we build vs. what we describe)

MetaChain is **planned**. On the ecosystem page it is a roadmap and specs page. The only running chain is the local Anvil devnet branded "MetaChain Devnet".

Devnet parameters (binding, from PLAN.md):
| Field | Value |
|---|---|
| Name (UI) | MetaChain Devnet |
| Chain ID | 31337 |
| Native currency | ETH (18 decimals) |
| RPC | http://127.0.0.1:8545 |
| Block time | 1 s (`anvil --block-time 1`) |
| Accounts | 10, balance 10000 ETH each (`--accounts 10 --balance 10000`) |
| Explorer | none (devnet) |
| Status | local dev only; no public network |

Planned MetaChain mainnet and testnet metadata in `packages/sdk/src/chains.ts` should be `status: "planned"` with placeholder chain IDs marked TBD (do not pick a real chain id that collides with a public chain).

Suggested specs table for the ecosystem page (planned, not live):
| Spec | Target | Note |
|---|---|---|
| Stack | OP Stack L2 (planned) | same family as Unichain, but no commitment yet |
| Block time | 1 s | matches Unichain's public parameter |
| Preconfirmations | sub-second target, 200–250 ms | "target", not a promise |
| Settlement | Ethereum L1 | planned |
| Native asset | ETH | planned |
| Liquidity | MetaSwap V2/V3 + MetaSwapX on MetaChain | planned |
| Status | Devnet live (local), testnet and mainnet planned | |

### 2.3 Roadmap (proposed text for `/metachain`, marked as planned)
1. Now: MetaChain Devnet (local Anvil, chain 31337), MetaSwap V2/V3, MetaSwapX on devnet.
2. Next: public testnet with the same contracts (deploy scripts parametrized by chain id; `deployments/<chainId>.json`).
3. Later: mainnet, bridge, indexer and explorer at scale, MetaSwapX filler network beyond the operator bot.

Copy rules: no Uniswap or Unichain logos, names, or copy text; describe the planned chain in MetaSwap's own words.

---

## Part 3: Concrete proposal

### 3.1 MetaSwapX (what we build now, on Anvil)

Contracts (router & MetaSwapX contracts, `packages/contracts/src/x/`):
- `metaswapx/reactors/ExclusiveDutchOrderReactor.sol` (+ `BaseReactor`, `lib/*`, `base/ReactorStructs.sol`) — port of UniswapX ExclusiveDutchOrderReactor (GPL-3.0, keep SPDX header and add `// Ported from Uniswap/UniswapX/src/reactors/ExclusiveDutchOrderReactor.sol`).
- `metaswapx/sample-executors/SwapRouter02Executor.sol` — fills from MetaSwap V3/V2 via `SwapRouter02`; implements `reactorCallback`.
- `permit2/Permit2.sol` (+ SignatureTransfer, AllowanceTransfer, libraries) — MIT port, unchanged typehashes (see `protocol.md` §3).
- Deploy: `script/DeployX.s.sol` deploys Permit2, UniversalRouter, Reactor, Executor; writes addresses into `deployments/31337.json` (`ExclusiveDutchOrderReactor`, `SwapRouter02Executor`, `Permit2`, `UniversalRouter`).
- Not in v1: Priority reactor, V3 block-based reactor, RFQ, cosigner, nonlinear curves, direct-fill.

Off-chain (API, `services/api/src/x/`):
- `POST /x/orders` — validate per `flows.md` §12.6, store in `node:sqlite` with status open.
- `GET /x/orders?swapper&status=open|filled|expired|cancelled`, `GET /x/orders/:hash`.
- `GET /x/quote?…` — indicative `startAmount` and `endAmount` from current pool price (QuoterV2 or reserve math), decay parameters preset (e.g. `decayStart = now + 0 s`, `decayEnd = now + 60 s`, exclusivity 0 s, `exclusivityOverrideBps = 0`).
- Indexer: decode `Fill`/`Cancel` events (or Permit2 `NonceInvalidated`) to update statuses; expiry poller every block.
- Filler bot (`services/api/src/filler/`): polls open orders every 1 s, computes decay price, quotes route, fills via `ExclusiveDutchOrderReactor.execute` with `SwapRouter02Executor` using Anvil account #9 (only). Logs profit; configurable `minProfitWei`.

Frontend (web app, `/limit` and `/metaswapx`):
- Form: sell token/amount, buy token, min buy amount (end of decay), decay window (presets: 30 s, 60 s, 5 min), exclusivity off (default) or 10 s with exclusive filler = operator address (optional).
- Sign: `eth_signTypedData_v4` with the witness typed data. No gas.
- Post and show status timeline (`posted` → `decaying` → `filled|expired|cancelled`).
- Cancel: Tx `Permit2.invalidateUnorderedNonces`.
- `/metaswapx` product page: explanation of Dutch auctions with a live decay chart (lightweight-charts, from `/x/quote` samples), your orders list.

Tests:
- Forge: decay math vectors (start, end, mid, boundary times); reactor fill happy path; exclusivity revert; expired revert; cancel-then-fill revert; Permit2 witness signature recovery.
- API vitest against real Anvil: POST validation (bad sig, bad reactor, past deadline) and status transitions.
- Playwright: sign + post + filler fills + status becomes `filled`.

### 3.2 MetaChain ecosystem page (what it communicates)
- Hero: "MetaChain: the planned chain for MetaSwap" with a "Devnet live" badge.
- Specs table (2.2) with `status` column: live (devnet), planned (testnet, mainnet).
- Roadmap (2.3).
- Add-network button: `wallet_addEthereumChain` for 31337 (flows.md §2).
- Footer note: "Planned features are targets, not commitments."
- No claims about token, validators, or launch dates.

### 3.3 Open questions for the maintainer
1. Flashblocks figure: 200 ms (Unichain docs) vs 250 ms (PLAN). Recommend keeping PLAN's 250 ms only for MetaChain targets.
2. Whether the operator should also act as cosigner (adds a signature to each order). Out of scope for v1 unless requested.
3. MetaSwapX `ExclusiveDutchOrder` vs a simpler `DutchOrder` (no exclusivity). Recommend keeping Exclusive since PLAN names it; `exclusiveFiller = 0x0` gives an open auction.

---

## Sources
- UniswapX auction types (fetched): https://developers.uniswap.org/llms.mdx/docs/liquidity/uniswapx/concepts/auction-types
- UniswapX architecture (fetched): https://developers.uniswap.org/llms.mdx/docs/liquidity/uniswapx/concepts/architecture
- UniswapX overview (fetched): https://developers.uniswap.org/llms.mdx/docs/liquidity/uniswapx/overview
- UniswapX contracts (fetched via raw.githubusercontent.com): https://github.com/Uniswap/UniswapX/blob/main/src/lib/ExclusiveDutchOrderLib.sol , …/src/lib/DutchDecayLib.sol , …/src/lib/DutchOrderLib.sol , …/src/lib/OrderInfoLib.sol , …/src/reactors/ExclusiveDutchOrderReactor.sol , …/src/base/ReactorStructs.sol
- Unichain overview (fetched): https://developers.uniswap.org/llms.mdx/docs/unichain (origin https://docs.unichain.org/docs/learn/about-unichain redirects here)
- Permit2 (fetched): https://github.com/Uniswap/permit2 (PermitHash.sol, SignatureTransfer.sol)
- Not fetched in this pass: UniswapX `ExclusivityOverrideLib.sol`, `NonlinearDutchDecayLib.sol`, `BaseReactor.sol`, the Unichain Flashblocks / network-info pages, the Unichain whitepaper.
