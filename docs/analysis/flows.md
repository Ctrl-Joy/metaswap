# MetaSwap user flows (protocol research)

Step-by-step sequences for every flow the contracts, API and web app must support. Each step lists the UI state, the on-chain call or signature, and the API call if any. Contract names and function signatures follow `protocol.md`. Addresses come from `deployments/31337.json`. Permit2 and UniversalRouter are the only swap entry points; V2/V3 pools are called only through periphery.

Conventions:
- `UR` = MetaSwapUniversalRouter, `P2` = Permit2, `R02` = SwapRouter02 (not used by the web swap flow), `NPM` = NonfungiblePositionManager, `V2R` = V2Router02, `RX` = ExclusiveDutchOrderReactor.
- "Sig" = EIP-712 signature via `eth_signTypedData_v4` (wagmi `signTypedData`). "Tx" = wallet transaction via `sendTransaction`.
- Every tx waits for a receipt; a receipt with status 0 is a revert.

---

## 1. Connect wallet

UI states: `disconnected` → `connecting` (modal open, connector list) → `connected-wrong-chain` | `connected` → `connected-unsupported` (chain not 31337 and no MetaChain support).

1. User clicks "Connect". Modal lists connectors: EIP-6963 injected wallets (one row per announced provider), WalletConnect (only if `VITE_WALLETCONNECT_PROJECT_ID`), Coinbase Wallet, Dev wallet (only when `import.meta.env.DEV` or chain 31337 is reachable; shows Anvil #0–#4).
2. Wallet request: `eth_requestAccounts`. Dev wallet: connects locally, no prompt.
3. App reads `eth_chainId`. If not 31337: state `connected-wrong-chain`, show "Switch to MetaChain Devnet".
4. Persist last connector id in `localStorage` (try/catch). On reload, reconnect silently (`eth_accounts`), no prompt.
5. Sign-in is not needed. Account data is read-only by address.
- Errors: user rejects (`4001`) → back to `disconnected`, no toast. No provider → show install/EIP-6963 hint. `-32002` (request pending) → "Check your wallet".

## 2. Switch chain

Only chain 31337 exists in v1.

1. If `eth_chainId` != `0x7a69` (31337): call `wallet_switchEthereumChain({chainId: "0x7a69"})`.
2. If error `4902` (unknown chain): call `wallet_addEthereumChain` with: `chainId: "0x7a69"`, `chainName: "MetaChain Devnet"`, `nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18}`, `rpcUrls: ["http://127.0.0.1:8545"]`, `blockExplorerUrls: []`.
3. After switch, invalidate all chain-keyed TanStack queries and reset tx confirmations.
- Errors: user rejects → stay on `connected-wrong-chain`, disable swap button with reason. Localhost RPC not reachable → banner "Devnet is not running (run scripts/dev-up.sh)".
- `/metachain` page's "Add network" button runs step 2 directly.

## 3. Select token / import token

1. Token selector lists tokens from `GET /tokens` (MetaSwap list). Search filters by symbol, name, address. Sort: balance first, then list order.
2. Balances: `multicall` `balanceOf` + native `getBalance` for the connected account (Multicall3 at `deployments.contracts.Multicall3`).
3. Paste an address not in the list: UI validates `0x` + 40 hex, calls `GET /tokens/:address` (API reads `name`, `symbol`, `decimals` on-chain via `eth_call`).
   - If found and not in list: show "Unknown token" warning row; user must check a box "I understand this token is not in the list" before it can be selected.
   - If the call fails (no contract / not ERC20): "Not a token on this network".
4. Selected token stored in the swap form state.
- Edge: same token for in and out → error "Select different tokens", no quote.

## 4. Classic swap (ERC20 in → ERC20 out) via UniversalRouter + Permit2

### 4.0 Quote
1. User types amount (EXACT_INPUT) or chooses output amount (EXACT_OUTPUT).
2. Web calls `GET /quote?tokenIn&tokenOut&amount&type&slippageBps&recipient&deadline&protocols=v2,v3,mixed`.
3. API returns route, `amountIn`/`amountOut`, `amountOutMin`/`amountInMax`, `priceImpactBps`, `gasEstimate`, `gasUsd`, `methodParameters {to: UR, calldata, value}`, `permit2 {required, spender, ...}`.
4. UI state `quoting` (spinner, previous quote dimmed) → `quoted` (review button enabled) | `no-route` ("No route found") | `error` (retry link).

### 4.1 Step list (computed from the quote and the on-chain state)
1. **Balance check**: if `balanceOf(user) < amountIn` → state `insufficient-balance` (button "Insufficient <SYMBOL> balance"), stop.
2. **ERC20 approval to Permit2** (only once per token per user):
   - Read `allowance(user, P2)` on tokenIn.
   - If `< amountIn`: Tx `approve(P2, MaxUint256)` on tokenIn. (Some tokens require zeroing first; MetaSwap test tokens do not.)
   - Wait for receipt.
3. **Permit2 signature** (only if the route uses `PERMIT2_PERMIT` / AllowanceTransfer):
   - Read `P2.allowance(user, tokenIn, UR)` → `(amount, expiration, nonce)`.
   - If amount < amountIn or expired: build `PermitSingle {details: {token, amount: amountIn (uint160), expiration: now+30d, nonce}, spender: UR, sigDeadline: deadline}` and Sig via `eth_signTypedData_v4`.
   - Otherwise skip.
   - v1 decision: the router pulls tokens from the user through Permit2 AllowanceTransfer, so the user needs a valid P2 allowance for (token, UR). The `/quote` response sets `permit2.required = true` with the `PermitSingle` typed data whenever that allowance is missing or too small. The web signs it, then asks the API to rebuild calldata with the signature (`GET /quote` with an extra `permitSignature` param, or a dedicated build endpoint, to be added to the PLAN API contract via CHANGES.md). The rebuilt calldata has a leading `PERMIT2_PERMIT` command in the same `execute`. The UI does not need to know which path was taken.
4. **Swap transaction**: Tx to `UR.execute(commands, inputs, deadline)` with `value = msg.value` (0 for ERC20 in), built from `methodParameters`.
   - Wait for receipt.

Result: state `success` (show amounts from the Swap event: `amount0In/amount1In/amount0Out/amount1Out` of the last pool in the route; the API indexer confirms). Analytics-free.

### 4.2 State machine
`idle` → `quoting` → `quoted` → (`review` modal) → `approving` (step 2, if needed) → `awaiting-approval-confirm` → `signing-permit` (step 3, if needed) → `submitting-swap` → `awaiting-swap-confirm` → `success` | `failed(reason)`.
- User may close the modal during a pending tx; the tx tracker keeps watching and the header shows a pending indicator.

### 4.3 Failure states (classic)
| Failure | Detected by | UI |
|---|---|---|
| User rejects approval/sign/tx (`4001`) | wallet error | "Transaction rejected", back to `quoted` |
| Insufficient balance | step 1 check, or `ERC20: transfer amount exceeds balance` | "Insufficient balance" |
| Insufficient allowance (approval raced) | revert `TRANSFER_FROM_FAILED` / P2 `InsufficientAllowance` | re-run approval step |
| Slippage exceeded | revert `Too little received` (UR `V3TooLittleReceived`/`V2TooLittleReceived`) | "Price moved beyond your slippage (x%). Increase slippage or re-quote." |
| Deadline passed | revert `TransactionDeadlinePassed` or UR deadline check | "Transaction deadline passed. Re-quote." |
| Permit expired (`sigDeadline`/`expiration`) | revert `PermitExpired` | re-sign |
| Pool liquidity insufficient | API `no-route` or revert `V2: INSUFFICIENT_LIQUIDITY` / V3 `LOK`/`SPL` | "Not enough liquidity for this amount" |
| Reverted (other) | receipt status 0 | "Transaction failed" + explorer link (no explorer; show hash) |
| Dropped / replaced | receipt not found after N polls / nonce consumed | "Transaction was replaced or dropped" |

## 5. ETH-in and ETH-out swaps, wrap and unwrap

### 5.1 ETH in (native ETH → token)
- Steps: no approval (ETH needs none). Tx `UR.execute` with `commands = [WRAP_ETH, V3_SWAP_EXACT_IN(payerIsUser=false)]` (or `V2_SWAP_EXACT_IN`), `inputs = [ (ADDRESS_THIS, amountIn), (recipient, amountIn, amountOutMin, path, false) ]`, `value = amountIn`. API `methodParameters` supplies this exact tx.
- Errors: insufficient ETH (balance must cover amount + gas): UI reserves `gasUsd` estimate (`gasEstimate × gasPrice × 1.2`) and shows "Keep some ETH for gas".

### 5.2 ETH out (token → native ETH)
- Same as classic with the last command `UNWRAP_WETH(MSG_SENDER, amountOutMin)` and the swap recipient `ADDRESS_THIS`. No separate approval beyond tokenIn.
- Output shown as "ETH".

### 5.3 Wrap / unwrap (WETH ↔ ETH, standalone)
- Wrap: Tx `WETH9.deposit()` with `value = amount`. Receipt → state success. Uniswap-style UI: "Wrap" button when the selected pair is ETH↔WETH.
- Unwrap: Tx `WETH9.withdraw(amount)`.
- Errors: insufficient balance; reverted if `withdraw` > balance.

## 6. Exact-output swaps

- Quote with `type=EXACT_OUTPUT`: API returns `amountIn` (computed by `getAmountsIn` or `QuoterV2.quoteExactOutput`) and `amountInMax = ceil(amountIn × (10000 + slippageBps)/10000)`.
- Commands: `V3_SWAP_EXACT_OUT(recipient, amountOut, amountInMax, path reversed, payerIsUser)` or `V2_SWAP_EXACT_OUT(...)`. Approval/permit uses `amountInMax` (not `amountIn`) so the pull does not fail.
- Failure: if the user's balance is < `amountInMax` but ≥ `amountIn`, the UI warns "Balance covers the expected input but not the slippage buffer".
- Revert `V2: EXCESSIVE_INPUT_AMOUNT` / UR `V3TooMuchRequested` → "Price moved; re-quote".
- Quote can be unavailable for impossible outputs (`getExactOutputWillFail` analogue): show "Output exceeds pool liquidity".

## 7. Multi-hop and split routes

- Route representation (API): `route: [[hop, hop, …], [hop…]]` where each hop is `{type, pool, tokenIn, tokenOut, fee}`; split routes list several routes with `percent`.
- Encoding: one `V3_SWAP_EXACT_IN` command per (sub-)route with `path` = packed `token | fee | token | …`; for V2 hops `address[]` path. Multi-route = multiple commands with separate `amountIn` values that sum to the total (each route's `amountIn` is its share). `amountOutMin` applies to the total: put the full `amountOutMin` on the **last** command's output recipient via `SWEEP`/`BALANCE_CHECK_ERC20` or use per-route minima that sum to the total minimum (API decides; default: per-route min = floor(route share × amountOutMin)).
- Mixed V2 and V3 hops: allowed (`protocols=mixed`). Each hop type maps to its own command; intermediate tokens stay in the router between commands with `payerIsUser=false` after the first hop.
- Approval/permit: a single pull of `totalAmountIn` from the user.
- Failure: a sub-route reverting reverts the whole tx (no `FLAG_ALLOW_REVERT` by default).

## 8. Send (ERC20 or ETH)

1. User enters recipient (address or ENS not supported in devnet) and amount. Validation: checksum address, not zero address, not the token contract itself, warn if recipient is a contract with no code.
2. ETH: Tx `{to: recipient, value: amount}`.
3. ERC20: Tx `token.transfer(recipient, amount)`. No Permit2 (plain transfer).
4. Optional: "Send to new address" warning modal.
5. States: `review` → `pending` → `success` | `failed`. Activity appears in `GET /accounts/:address/activity` after indexing.
- Failure: insufficient balance; `ERC20: transfer amount exceeds balance`; user rejects.

## 9. Add liquidity to V2 pair (and remove)

### 9.1 Add
1. Position page `/positions/create` (V2 path) or `/positions/v2/:pair` add. Choose pair (existing pair address from `GET /pools`); if pair missing: create it (step 9.1a).
2. Amounts: user enters amountA; amountB computed from current reserves: `amountB = amountA * reserveB / reserveA` (`quote()`), with slippage: `amountAMin = amountA*(1-slip)`, `amountBMin = amountB*(1-slip)`. For a new pair (reserves 0), user sets both.
3. Approvals: for each token, `allowance(user, V2R) >= amount` else Tx `approve(V2R, Max)`. (V2 router uses direct `transferFrom`, not Permit2, for liquidity — keep it this way for V2.)
4. Tx `V2R.addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, to, deadline)`; or `addLiquidityETH(token, amountTokenDesired, amountTokenMin, amountETHMin, to, deadline)` with `value = amountETH`.
5. Result: `Mint(sender, amount0, amount1)` and LP balance increase.
- 9.1a Create pair: Tx `V2Factory.createPair(tokenA, tokenB)` if `getPair == 0x0`. Event `PairCreated`. (Router then adds liquidity; the first deposit sets price.)
- Failures: `UniswapV2Router: INSUFFICIENT_B_AMOUNT` (amount ratio stale → re-quote); `INSUFFICIENT_LIQUIDITY_MINTED`; allowance/balance; slippage.

### 9.2 Remove (with LP permit)
1. UI shows LP balance, share of pool, underlying amounts = `liquidity * reserve / totalSupply`.
2. Approve LP to router: either Tx `pair.approve(V2R, amount)`, or **gasless** `pair.permit(owner, V2R, liquidity, deadline, v, r, s)` via EIP-2612-style Sig (`Permit` typehash from `protocol.md` §1.8, domain name "MetaSwap V2"). Use permit when available (default), fall back to approve.
3. Tx `V2R.removeLiquidityWithPermit(tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline, approveMax, v, r, s)` (or the ETH variant `removeLiquidityETHWithPermit`). Without permit: `removeLiquidity(...)`.
4. Result: `Burn(sender, amount0, amount1, to)`; LP balance decreases.
- Failures: `UniswapV2Router: INSUFFICIENT_A_AMOUNT`; permit nonce/deadline errors; zero liquidity.

## 10. Create V3 position (initialize pool if needed, then mint)

1. Choose pair, fee tier (100/500/3000/10000), price range: presets (Full range, ±X%) or tick inputs snapped to tick spacing. Show current price and "in range" flag.
2. Pool existence: `V3Factory.getPool(token0, token1, fee)`. If `0x0`: Tx `createPool(tokenA, tokenB, fee)` (tokens sorted by factory). Pool address from event `PoolCreated(token0, token1, fee, tickSpacing, pool)`.
3. If pool exists but `slot0.sqrtPriceX96 == 0` (uninitialized): Tx `pool.initialize(sqrtPriceX96)` where `sqrtPriceX96 = sqrt(price) * 2^96` for the user's starting price (user-entered, or current market). Emits `Initialize`.
4. Compute amounts: given tick range and deposit amounts, derive L (`protocol.md` §2.3). Show the required ratio. For one-sided ranges only one token is needed.
5. Approvals: approve NPM for token0 and token1 (`approve(NPM, Max)` if allowance insufficient). NPM uses `transferFrom`, not Permit2.
6. Tx `NPM.mint(MintParams{token0, token1, fee, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min, recipient, deadline})` (multicall with `createAndInitializePoolIfNecessary` allowed: `NPM.multicall([createAndInitializePoolIfNecessary(token0, token1, fee, sqrtPriceX96), mint(...)])` — preferred single tx when the pool is new).
7. Result: NFT `tokenId` minted; `IncreaseLiquidity` (NPM) and pool `Mint` events.
- Failures: `Price slippage check` (`amount0Min` / `amount1Min` not met → re-quote); tick not aligned (`tickLower % tickSpacing != 0`); `LOK`; approvals; NFT price range out of bounds.

## 11. Increase / decrease / collect / burn a V3 position

### 11.1 Increase
1. Position detail shows `tokensOwed`, uncollected fees (from `pool.positions` via NPM `positions(tokenId)`), in-range flag.
2. Approvals as in §10.5.
3. Tx `NPM.increaseLiquidity({tokenId, amount0Desired, amount1Desired, amount0Min, amount1Min, deadline})`.

### 11.2 Decrease
1. User chooses percent (25/50/75/100%) → `liquidity = position.liquidity * pct`.
2. Tx `NPM.decreaseLiquidity({tokenId, liquidity, amount0Min, amount1Min, deadline})`. This credits `tokensOwed0/1` and does not transfer tokens.
3. Then `NPM.collect({tokenId, recipient: user, amount0Max: MaxUint128, amount1Max: MaxUint128})` to actually receive tokens. UI bundles 2 and 3 in one `multicall` tx (default).

### 11.3 Collect fees only
- Tx `NPM.collect(...)` with `amount0Max/amount1Max = MaxUint128`. Fees shown before: `(feeGrowthInside - feeGrowthInsideLast) * liquidity / 2^128 + tokensOwed`. Collect with zero owed reverts silently in some versions: UI disables the button when owed is 0.

### 11.4 Burn (close the NFT)
1. Requires liquidity 0 and tokensOwed collected (UI bundles: decrease 100% → collect → burn in one `multicall`).
2. Tx `NPM.burn(tokenId)`. NFT is destroyed.
- Failures: `Not cleared` (burn with liquidity/owed remaining); `Not approved` (not owner); slippage on decrease.

## 12. Limit order via MetaSwapX (UniswapX-style)

Scope: Dutch-decay `ExclusiveDutchOrder`, signed via Permit2 witness, posted to the API, filled by the filler bot.

### 12.1 Sign
1. User sets sell token, sell amount (`inputStartAmount = inputEndAmount` for an exact-input order), buy token, **limit** (min buy amount at end of decay), start/end decay times (defaults: start now+0s, decayEnd = start + 60s, exclusivity window 0 or 10s), exclusive filler (`0x0` = open), `exclusivityOverrideBps` (default 0).
2. Quote: `GET /x/quote?…` returns indicative `startAmount` (best case, from current pool price) and `endAmount` (limit).
3. Approval: ERC20 `approve(P2, Max)` on the sell token if allowance < amount (same as §4.1.2).
4. Sign: build `ExclusiveDutchOrder`: `info = {reactor: RX, swapper: user, nonce: random or per-user counter, deadline: decayEndTime + buffer, additionalValidationContract: 0x0, additionalValidationData: 0x}`, `decayStartTime`, `decayEndTime`, `exclusiveFiller`, `exclusivityOverrideBps`, `inputToken`, `inputStartAmount`, `inputEndAmount`, `outputs = [{token: buyToken, startAmount, endAmount, recipient: user}]`.
   - Sig: `eth_signTypedData_v4` with `PermitWitnessTransferFrom` typed data: `permitted = {token: inputToken, amount: inputStartAmount}`, `spender = RX`, `nonce`, `deadline = info.deadline`, `witness = hash(order)`, witness type string from `protocol.md` §3.4.
   - No gas paid by the user, no on-chain tx at signing.
5. Post: `POST /x/orders` with `{ encodedOrder, signature, chainId }`. API validates (see §12.4).

### 12.2 Fill (filler bot / competing filler)
1. Filler polls `GET /x/orders?status=open` (API) or reads `status` from its own store; checks profit: on-chain outputs at block time (decay math) vs. its own route through pools (`QuoterV2` or V2 `getAmountsOut`).
2. If profitable and the filler is allowed (exclusive filler or after `decayStartTime`): call `RX.execute(SignedOrder{order, sig})` or `executeWithCallback(SignedOrder, callbackData)` with the `SwapRouter02Executor` as the fill contract (`callbackData` = routing instructions).
3. Reactor flow (per `UniswapX/docs architecture`): validate order → resolve decayed input/outputs (`DutchDecayLib.decay`) → verify exclusivity (`exclusiveFiller` or override bps) → `P2.permitWitnessTransferFrom(...)` to move input from swapper to executor → `reactorCallback` on executor → executor swaps via `SwapRouter02` into outputs → reactor checks outputs received by recipients.
4. Filler receives the input tokens (minus nothing) and pays outputs; gas paid by filler.
5. Event: the reactor emits `Fill(bytes32 indexed orderHash, address indexed filler, address indexed swapper, uint256 nonce)` (verify event name against the vendored reactor; `BaseReactor` not opened in this pass). API marks order `filled` when it sees the event (indexer) or the filler reports it.
- Failures for the filler: output not met at execution (`InsufficientOutput` style revert) → order stays open; exclusive window active for another filler → revert `NotExclusive` (or equivalent).

### 12.3 Cancel
1. Swapper wants to cancel: Tx `P2.invalidateUnorderedNonces(wordPos, mask)` where `wordPos = nonce >> 8`, `mask = 1 << (nonce & 0xff)` (cancels that order's Permit2 nonce; the order can no longer transfer).
2. API marks `cancelled` on seeing the tx receipt (indexer) or after cancel tx confirmation. Filler checks status before fill; a fill after cancel reverts at Permit2.
- Cancel is on-chain and costs gas (the only non-gasless action for MetaSwapX).

### 12.4 Expire
- When `block.timestamp > info.deadline` the reactor reverts (`OrderExpired`-style). API marks `expired` when `now > deadline` and status is still open (poller, every block). No tx needed.

### 12.5 States visible in UI
`signing` → `posted` (open) → `exclusive-window` (only exclusive filler may fill, optional badge) → `decaying` → `filled` (show tx hash, executed amounts) | `expired` | `cancelled`. Failed validation at POST shows the reason (bad signature, deadline too short, unsupported token).

### 12.6 API validation on POST /x/orders
- Recover signer from the Permit2 witness digest; must equal `swapper`.
- `info.reactor == RX`, `chainId == 31337`, `deadline > now` and `>= decayEndTime`, `decayEndTime >= decayStartTime`.
- Input decays are not allowed together with output decays (reactor rule).
- Nonce not yet used in Permit2 bitmap (`nonceBitmap` check via `eth_call`).
- Balance and allowance check of input token at post time (warning only, not rejection).

## 13. Failure state catalogue (cross-flow)

| Code / message | Meaning | Recovery |
|---|---|---|
| `4001` user rejected | wallet declined | return to previous state |
| `-32603` / RPC error | node unreachable or internal | retry with backoff, banner if devnet down |
| `insufficient funds for gas * price + value` | native balance too low | show "Keep ETH for gas" |
| Revert: `Too little received` / `V2: INSUFFICIENT_OUTPUT_AMOUNT` | slippage | re-quote, suggest higher slippage |
| Revert: `TransactionDeadlinePassed` | deadline passed | re-quote |
| Revert: `PermitExpired` / `InvalidSignature` (P2) | permit stale or wrong | re-sign |
| Revert: `TRANSFER_FROM_FAILED` / `InsufficientAllowance` | approval missing or lowered | run approval step |
| Revert: `V2: INSUFFICIENT_LIQUIDITY` / V3 `LOK` / `SPL` | pool depleted or bad limit | re-route or lower size |
| Receipt status 0, no reason | generic revert | show hash, suggest retry with higher slippage |
| Receipt missing after 60 polls | dropped | mark dropped, allow resubmit |
| Nonce too low | another tx from same account consumed nonce | refresh nonce, re-submit |

## 14. Sequence sketches (order of calls)

Classic ERC20→ERC20 (first time):
```
user --approve(P2, max)--> tokenIn            [Tx 1, once]
user --sign PermitSingle--> (off-chain)       [Sig, if AllowanceTransfer path]
user --execute(commands, inputs, deadline)--> UR   [Tx 2]
  UR --P2.transferFrom or P2.permit--> user tokenIn
  UR --V3 pool.swap / V2 pair.swap--> pool
  pool --transfer tokenOut--> recipient
```
MetaSwapX order:
```
user --approve(P2, max)--> tokenIn            [Tx, once]
user --sign PermitWitnessTransferFrom(order)-->  (off-chain)  --POST /x/orders-->  API
filler --execute(SignedOrder)--> RX
  RX --P2.permitWitnessTransferFrom--> executor (tokenIn from user)
  RX --reactorCallback--> executor --SwapRouter02--> pools
  RX --verify outputs--> recipient (buyToken)
```

---

## Sources
- Contract calls, events, typehashes and error names: `protocol.md` (Uniswap sources listed there).
- Interface flow structure (steps, classic vs UniswapX): https://github.com/Uniswap/interface `packages/uniswap/src/features/transactions/swap/utils/generateSwapTransactionSteps.ts`, `.../steps/`.
- UniswapX reactor lifecycle and fill contract pattern: https://developers.uniswap.org/llms.mdx/docs/liquidity/uniswapx/concepts/architecture and `auction-types`.
- **Unverified in this pass:** exact revert names of UniversalRouter (`V3TooLittleReceived`, `V3TooMuchRequested`) and of Permit2 (`PermitExpired`, `InvalidSignature`); the reactor `Fill` event signature; `ActionConstants` values. Confirm in the vendored source before writing error mappings.
