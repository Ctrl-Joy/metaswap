# MetaSwap protocol mechanics (protocol research)

Engineering reference for the contracts (AMM contracts `src/amm`, router & MetaSwapX contracts `src/x`), the SDK math (`packages/sdk/src/math`) and the API quoter (`services/api`). Constants and formulas are taken from the Uniswap sources listed in the Sources section; where MetaSwap intentionally differs from Uniswap it is marked **MetaSwap:**.

Notation: `uint` = `uint256`. Amounts are base units (integers). Floor division unless stated.

---

## 1. V2 constant-product AMM

### 1.1 Invariant and fee
- Invariant: `x * y = k` on reserves `reserve0`, `reserve1` (both `uint112`; `k` is kept in `uint256`).
- Swap fee: 0.30%, applied on input. The pair checks the **fee-adjusted** invariant after the swap:
  `balance0Adjusted = balance0*1000 - amount0In*3`, same for token1; require `balance0Adjusted * balance1Adjusted >= reserve0*reserve1*1000^2`.
  (`contracts/UniswapV2Pair.sol` L180-182, https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol)

### 1.2 getAmountOut / getAmountIn (exact integer formulas)
From `UniswapV2Library.sol` (https://github.com/Uniswap/v2-periphery/blob/master/contracts/libraries/UniswapV2Library.sol):

```
getAmountOut(amountIn, reserveIn, reserveOut):
  require amountIn > 0; require reserveIn > 0 && reserveOut > 0
  amountInWithFee = amountIn * 997
  numerator       = amountInWithFee * reserveOut
  denominator     = reserveIn * 1000 + amountInWithFee
  amountOut       = numerator / denominator          // floor

getAmountIn(amountOut, reserveIn, reserveOut):
  require amountOut > 0; require reserveIn > 0 && reserveOut > 0
  numerator   = reserveIn * amountOut * 1000
  denominator = (reserveOut - amountOut) * 997
  amountIn    = numerator / denominator + 1          // ceil-like, +1
```
Chained variants: `getAmountsOut(path)` / `getAmountsIn(path)` walk the path pair by pair (reverse for In).

### 1.3 LP minting and burning
- First deposit: `liquidity = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY`, and `MINIMUM_LIQUIDITY = 10**3` minted to `address(0)` forever.
- Later deposits: `liquidity = min(amount0 * totalSupply / reserve0, amount1 * totalSupply / reserve1)`.
- Burn: `amount0 = liquidity * balance0 / totalSupply`, `amount1 = liquidity * balance1 / totalSupply` (balances = pair balances; reserves are the pre-burn values).
- `sqrt` is Uniswap's Babylonian method (`Math.sol`).

### 1.4 Protocol fee switch (1/6 of growth)
Only active when `feeTo != address(0)`. `_mintFee` runs before every mint/burn:
```
rootK      = sqrt(reserve0 * reserve1)
rootKLast  = sqrt(kLast)
if rootK > rootKLast:
  liquidity = totalSupply * (rootK - rootKLast) / (rootK * 5 + rootKLast)
  mint(feeTo, liquidity)
```
`kLast = reserve0*reserve1` is stored after each mint/burn when fee is on, and set to 0 when off.
Effect: the protocol takes 1/6 of the 0.30% fee growth, i.e. 0.05% of volume. (`UniswapV2Pair.sol` L88-106, L129, L154.)

**MetaSwap:** implement `feeTo` setter (`setFeeTo`, factory) and default it to `address(0)` (off). Devnet may enable it to exercise the code path.

### 1.5 TWAP cumulative price oracle (UQ112x112)
- `price0CumulativeLast += uint(UQ112x112.encode(reserve1).uqdiv(reserve0)) * timeElapsed`, and symmetric for `price1CumulativeLast` (uses the reserves **before** the update, updated in `_update` once per block, `timeElapsed = blockTimestamp - blockTimestampLast`, with `uint32` timestamp wraparound).
- `UQ112x112.encode(y) = y * 2**112` (uint224). `uqdiv(x) = x_encoded / x`.
- Average price over [t1, t2] = `(cum(t2) - cum(t1)) / (t2 - t1)`, result in UQ112.112 (divide by `2**112` for a decimal price of token0 in token1 raw units).
- Consumers must snapshot `(cumulative, blockTimestampLast)` and wrap-safe subtract.

### 1.6 Swap, flash swaps, skim/sync
- `swap(amount0Out, amount1Out, to, data)`:
  1. optimistic transfer out to `to`;
  2. if `data.length > 0` call `IUniswapV2Callee(to).uniswapV2Call(sender, amount0Out, amount1Out, data)` (flash swap);
  3. `amountIn = balance - (reserve - amountOut)` per token; require at least one `amountIn > 0`;
  4. K check above (`'UniswapV2: K'`).
- `skim(to)`: transfers `balance - reserve` of each token to `to` (rescue excess).
- `sync()`: sets reserves to balances (`Sync` event).
- Reentrancy `lock` modifier on all state changers.

### 1.7 Events and signatures (must match Uniswap V2 for tooling)
```
event Mint(address indexed sender, uint amount0, uint amount1);
event Burn(address indexed sender, uint amount0, uint amount1, address indexed to);
event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to);
event Sync(uint112 reserve0, uint112 reserve1);
event Transfer(address indexed from, address indexed to, uint value);   // ERC20
event Approval(address indexed owner, address indexed spender, uint value);
event PairCreated(address indexed token0, address indexed token1, address pair, uint);  // Factory, 3rd arg uint = allPairs.length
```
`getReserves() returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)`.
Factory: `createPair(tokenA, tokenB)`, `getPair(a,b)`, `allPairs(i)`, `feeTo()`, `feeToSetter()`. Pair sorts tokens (`token0 < token1`).

### 1.8 V2 LP permit (ERC20 permit)
- `PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")`
  = `0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9` (verified in `UniswapV2ERC20.sol` L18).
- Domain: `EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)` with name = LP token name, version `"1"`.
- Digest: `keccak256("\x19\x01" || DOMAIN_SEPARATOR || keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline)))`.
- **MetaSwap:** LP name "MetaSwap V2", symbol "MS-V2"; use the same typehash and domain shape so the router's `permit` path works.

---

## 2. V3 concentrated liquidity

Source: `UniswapV3Pool.sol`, `TickMath.sol`, `SwapMath.sol`, `SqrtPriceMath.sol`, `Tick.sol`, `Position.sol`, `Oracle.sol`, `UniswapV3Factory.sol`, `IUniswapV3PoolEvents.sol` (https://github.com/Uniswap/v3-core/tree/main/contracts).

### 2.1 Ticks and prices
- Price at tick `i`: `p(i) = 1.0001^i`, with `i` in `[MIN_TICK, MAX_TICK] = [-887272, 887272]`.
- `sqrtPriceX96 = sqrt(p) * 2^96` (Q64.96, uint160). Bounds: `MIN_SQRT_RATIO = 4295128739`, `MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342`.
- Token-raw price: `price(token1 per token0) = (sqrtPriceX96 / 2^96)^2`. Human price adds `10^(dec0 - dec1)`.
- `getSqrtRatioAtTick` / `getTickAtSqrtRatio` implemented with the Uniswap Q128 magic-number table in `TickMath.sol` (port verbatim; do not re-derive).

### 2.2 Fee tiers and tick spacing
| fee (pips, 1e6) | fee % | tickSpacing | enabled in v3-core constructor? |
|---|---|---|---|
| 100 | 0.01% | 1 | **no** (must call `enableFeeAmount(100, 1)` explicitly) |
| 500 | 0.05% | 10 | yes |
| 3000 | 0.30% | 60 | yes |
| 10000 | 1.00% | 200 | yes |

Verified in `UniswapV3Factory.sol` (`feeAmountTickSpacing[...]`, `FeeAmountEnabled` events). PLAN.md's tiers (100/500/3000/10000 with spacings 1/10/60/200) match, but the factory deploy script must enable 100 itself. `enableFeeAmount` is owner-only and `tickSpacing` must be `< 16384`.
Pool address = CREATE2 from factory + (token0, token1, fee); periphery must use `getPool`, never init-code math (PLAN rule).

### 2.3 Liquidity math (SqrtPriceMath)
Let `sqrtA < sqrtB` be the range bounds (sqrt prices, real numbers), `L` liquidity.
- Full range below current price: `amount0 = L * (sqrtB - sqrtA) / (sqrtA * sqrtB)`, `amount1 = 0`.
- Full range above: `amount0 = 0`, `amount1 = L * (sqrtB - sqrtA)`.
- Current price `sqrtP` inside `[sqrtA, sqrtB)`:
  `amount0 = L * (sqrtB - sqrtP) / (sqrtP * sqrtB)`, `amount1 = L * (sqrtP - sqrtA)`.
- Inverse (mint amounts → L): `L = min(amount0 / (1/sqrtP - 1/sqrtB), amount1 / (sqrtP - sqrtA))` when in range.
- Contract rounding: `getAmount0Delta(…, roundUp)` / `getAmount1Delta(…)` round **up** when the pool receives tokens (mint), **down** when paying out (burn/collect).

### 2.4 Swap step loop
`Pool.swap` iterates initialized ticks in the swap direction:
1. `computeSwapStep(sqrtP, sqrtTarget, L, amountRemaining, feePips)` (SwapMath):
   - exactIn: `amountRemainingLessFee = amountRemaining * (1e6 - feePips) / 1e6` (mulDiv).
   - Compute `sqrtNext` from input, clamp to `sqrtTarget` (the next tick boundary or price limit).
   - `amountIn`, `amountOut` between `sqrtP` and `sqrtNext`; `feeAmount = amountIn * feePips / (1e6 - feePips)` rounded up when not reaching target; when the target is reached, `feeAmount = amountIn * feePips/(1e6 - feePips)` rounded up.
2. Next price when token0 is input: `sqrtNext = L * sqrtP / (L + amount * sqrtP)` (round up); when token1 is input: `sqrtNext = sqrtP + amount / L` (round down). Output side uses the symmetric formulas.
3. On reaching a tick boundary, `Tick.cross`: `liquidityNet` added (moving up) or subtracted (moving down); `feeGrowthOutside` flipped.
4. Pool state: `sqrtPriceX96`, `tick`, `liquidity` (active), `feeGrowthGlobal0X128/1X128`, `protocolFees`, `observations`.

### 2.5 Fee growth accounting
- Per swap: `feeGrowthGlobal += feeAmount * 2^128 / L` (per token). Protocol share taken first if `feeProtocol` set.
- Ticks store `feeGrowthOutside0X128/1X128`; `Tick.getFeeGrowthInside(lower, upper, current, globals)`:
  - `below = current >= lower ? outside_lower : global - outside_lower`
  - `above = current < upper ? outside_upper : global - outside_upper`
  - `inside = global - below - above`
- Position owed: `tokensOwed0 += L * (inside0 - feeGrowthInside0Last) / 2^128` (+ same for token1), then `feeGrowthInside0Last = inside0`.
- Initialization of `feeGrowthOutside` on first use: set equal to global if tick `<= current` (Uniswap convention).

### 2.6 Positions and NFT manager
- `Position.Info`: `liquidity uint128`, `feeGrowthInside0LastX128`, `feeGrowthInside1LastX128`, `tokensOwed0`, `tokensOwed1` keyed by `keccak256(abi.encodePacked(owner, tickLower, tickUpper))`.
- `NonfungiblePositionManager` (ERC721) mints an NFT per position with `PositionInfo` (poolId, tickLower/Upper, liquidity, fee growth). Key functions:
  - `mint(MintParams{token0, token1, fee, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min, recipient, deadline}) returns (tokenId, liquidity, amount0, amount1)`
  - `increaseLiquidity(IncreaseLiquidityParams{tokenId, amount0Desired, amount1Desired, amount0Min, amount1Min, deadline})`
  - `decreaseLiquidity(DecreaseLiquidityParams{tokenId, liquidity, amount0Min, amount1Min, deadline})` → credits `tokensOwed`, does not transfer
  - `collect(CollectParams{tokenId, recipient, amount0Max, amount1Max})` → pays owed (uint128::max = all)
  - `burn(tokenId)` requires zero liquidity and zero owed.
- Pool-level calls are `mint(owner, tickLower, tickUpper, amount, data)`, `burn(tickLower, tickUpper, amount)` (returns amounts owed, does not transfer) and `collect(recipient, tickLower, tickUpper, amount0Requested, amount1Requested)`.

### 2.7 Oracle observations
- `Observation { blockTimestamp uint32, tickCumulative int56, secondsPerLiquidityCumulativeX128 uint160, initialized bool }`, array of 65535 slots, `cardinality` (populated) and `cardinalityNext` (target).
- Written at most once per block on first swap/mint/burn. Default cardinality 1; grow with `increaseObservationCardinalityNext(uint16)` (event `IncreaseObservationCardinalityNext`).
- `observe(uint32[] secondsAgos) returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)`.
- TWAP tick over `[t-Δ, t]`: `(tickCumulative(t) - tickCumulative(t-Δ)) / Δ` (floor toward −∞ when negative), price = `1.0001^twapTick`.

### 2.8 Events (exact fields, IUniswapV3PoolEvents)
```
event Initialize(uint160 sqrtPriceX96, int24 tick)
event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)
event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)
event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
event Flash(address indexed sender, address indexed recipient, uint256 amount0, uint256 amount1, uint256 paid0, uint256 paid1)
event IncreaseObservationCardinalityNext(uint16 observationCardinalityNextOld, uint16 observationCardinalityNextNew)
event SetFeeProtocol(uint8 feeProtocol0Old, uint8 feeProtocol1Old, uint8 feeProtocol0New, uint8 feeProtocol1New)
event CollectProtocol(address indexed sender, address indexed recipient, uint128 amount0, uint128 amount1)
// Factory:
event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)
event FeeAmountEnabled(uint24 indexed fee, int24 indexed tickSpacing)
event OwnerChanged(address indexed oldOwner, address indexed newOwner)
```
Note: `Collect` may emit zero amounts (fee-claim-by-touch). The indexer should treat `Mint`/`Burn` `amount` as liquidity delta; `Burn` does not move tokens (they become owed).

### 2.9 QuoterV2 (simulate by revert; call via eth_call)
```
quoteExactInputSingle(QuoteExactInputSingleParams{address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96})
  returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
quoteExactInput(bytes path, uint256 amountIn)  returns (amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, gasEstimate)
quoteExactOutputSingle(QuoteExactOutputSingleParams{tokenIn, tokenOut, amount, fee, sqrtPriceLimitX96}) returns (amountIn, sqrtPriceX96After, initializedTicksCrossed, gasEstimate)
quoteExactOutput(bytes path, uint256 amountOut) returns (amountIn, …)
```
Quoter is not `view`; the API must call it with `eth_call` and decode the revert payload (the Uniswap pattern: quoter reverts with `abi.encode(amountOut, sqrtAfter, ticksCrossed, gas)`). Use `eth_call`, not `eth_estimateGas`. Path bytes = `token(20) | fee(3) | token(20) [| fee(3) | token(20)]…`. For exact output, the path is **reversed** (tokenOut first).

### 2.10 TickLens
`getPopulatedTicksInWord(address pool, int16 tickBitmapIndex) returns (PopulatedTick[] {int24 tick; int128 liquidityNet; uint128 liquidityGross})`. Used by `/pools/:address/ticks` to draw the liquidity-distribution chart. Scan words from `floor(minTick / spacing / 256)` to `ceil(maxTick…)`; each word covers 256 compressed ticks.

---

## 3. Permit2

Source: `src/libraries/PermitHash.sol`, `src/SignatureTransfer.sol`, `src/AllowanceTransfer.sol`, `src/interfaces/ISignatureTransfer.sol` (https://github.com/Uniswap/permit2). Canonical address on all EVM chains: `0x000000000022D473030F116dDEE9F6B43aC78BA3` (MetaSwap devnet deploys its own copy via DeployX; the canonical address is only for mainnet parity).

### 3.1 Domain
`EIP712Domain(string name,uint256 chainId,address verifyingContract)` with **name = "Permit2"**, no version field, `chainId = 31337` on devnet, `verifyingContract = Permit2 address`. Field order to be confirmed against Permit2's `EIP712.sol` (from memory: name, chainId, verifyingContract). Clients must read the domain from the deployed contract's `DOMAIN_SEPARATOR()` or compute it from the same fields, never hard-code it.

### 3.2 SignatureTransfer (one-shot, per-transaction signatures)
Typehashes (exact strings from `PermitHash.sol`):
```
TokenPermissions:            "TokenPermissions(address token,uint256 amount)"
PermitTransferFrom:          "PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"
PermitBatchTransferFrom:     "PermitBatchTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"
Witness stub (single):       "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,"   + witnessTypeString
Witness stub (batch):        "PermitBatchWitnessTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline,"  + witnessTypeString
```
`witnessTypeString` = `"<WitnessType> witness)<nested types in alphabetical order>"` (see §3.4).

Struct: `PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }`; `SignatureTransferDetails { address to; uint256 requestedAmount; }`.

**Nonce semantics:** unordered bitmap. `nonceBitmap[owner][nonce >> 8] & (1 << (nonce & 0xff))`. A nonce is consumed by setting its bit; any unused nonce is valid (no ordering). MetaSwap clients should use a random 256-bit or a per-user counter; never reuse across different signatures unless intended.

Calls:
- `permitTransferFrom(PermitTransferFrom, SignatureTransferDetails, owner, signature)`
- `permitWitnessTransferFrom(PermitTransferFrom, SignatureTransferDetails, owner, bytes32 witness, string witnessTypeString, bytes signature)`
- `permitTransferFrom` batch variants.
- `invalidateUnorderedNonces(uint256 wordPos, uint256 mask)` — cancel many nonces at once (used by UniswapX cancel).

Digest: `keccak256(0x1901 || DOMAIN_SEPARATOR || hashWithWitness)`, where `hashWithWitness = keccak256(abi.encode(typeHash, keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, token, amount)), spender, nonce, deadline, witness))` and `typeHash = keccak256(stub || witnessTypeString)`.

### 3.3 AllowanceTransfer (persistent allowances; used by the UniversalRouter swap flow)
Typehashes:
```
PermitDetails: "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
PermitSingle:  "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
PermitBatch:   "PermitBatch(PermitDetails[] details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
```
- Storage: `allowance[owner][token][spender] = (amount uint160, expiration uint48, nonce uint48)`.
- `nonce` here is sequential per (owner, token, spender) and increments on each permit; the signature must carry the current nonce.
- `approve(token, spender, amount, expiration)` — on-chain approval of Permit2 itself is ERC20 `approve(Permit2, max)`, done once per token.
- `permit(owner, PermitSingle, signature)` sets allowance; `sigDeadline` bounds signature validity; `expiration` bounds allowance validity.
- `transferFrom(from, to, uint160 amount, token)` consumes allowance; reverts if expired or insufficient.
- MetaSwap uses SignatureTransfer for limit orders (UniswapX witness) and AllowanceTransfer (`PERMIT2_PERMIT`) for classic swaps when the user prefers a long-lived allowance; default for classic swaps: **ERC20 approve(Permit2, max) once, then `PERMIT2_PERMIT` (AllowanceTransfer) per swap if needed, else direct `PERMIT2_TRANSFER_FROM`**.

### 3.4 Witness type string example (UniswapX ExclusiveDutchOrder, from `ExclusiveDutchOrderLib.sol`)
```
"ExclusiveDutchOrder witness)"
+ "DutchOutput(address token,uint256 startAmount,uint256 endAmount,address recipient)"
+ "ExclusiveDutchOrder(OrderInfo info,uint256 decayStartTime,uint256 decayEndTime,address exclusiveFiller,uint256 exclusivityOverrideBps,address inputToken,uint256 inputStartAmount,uint256 inputEndAmount,DutchOutput[] outputs)"
+ "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)"
+ "TokenPermissions(address token,uint256 amount)"
```
Nested types must be appended alphabetically after the primary type (DutchOutput < ExclusiveDutchOrder-nested ordering as UniswapX does it; copy the concatenation order from the source, do not sort by hand).

---

## 4. UniversalRouter command set (MetaSwap = Uniswap command byte layout)

Source: `contracts/libraries/Commands.sol`, `contracts/base/Dispatcher.sol`, `modules/uniswap/v2/V2SwapRouter.sol`, `v3/V3SwapRouter.sol`, `modules/Payments.sol` (https://github.com/Uniswap/universal-router/tree/main/contracts).

- `execute(bytes commands, bytes[] inputs, uint256 deadline)` (MetaSwap signature per PLAN; Uniswap's canonical is `execute(bytes,bytes[],uint256)` on the deadline variant). Reverts `TransactionDeadlinePassed` if `block.timestamp > deadline`.
- Byte layout: `bit7` = `FLAG_ALLOW_REVERT` (0x80, subcall may fail without reverting the whole tx), `bits0-6` = command type. Command `i` uses `inputs[i]`.

| Command | byte | Input encoding (`abi.encode` of these fields, in order) |
|---|---|---|
| `V3_SWAP_EXACT_IN` | 0x00 | `(address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)` |
| `V3_SWAP_EXACT_OUT` | 0x01 | `(address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser)` — path **reversed** (tokenOut…tokenIn) |
| `PERMIT2_TRANSFER_FROM` | 0x02 | `(address token, address recipient, uint160 amount)` |
| `PERMIT2_PERMIT_BATCH` | 0x03 | `(PermitBatch, bytes signature)` |
| `SWEEP` | 0x04 | `(address token, address recipient, uint256 amountMin)` |
| `TRANSFER` | 0x05 | `(address token, address recipient, uint256 value)` |
| `PAY_PORTION` | 0x06 | `(address token, address recipient, uint256 bips)` (bips out of 10000) |
| `V2_SWAP_EXACT_IN` | 0x08 | `(address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser)` |
| `V2_SWAP_EXACT_OUT` | 0x09 | `(address recipient, uint256 amountOut, uint256 amountInMax, address[] path, bool payerIsUser)` |
| `PERMIT2_PERMIT` | 0x0a | `(PermitSingle, bytes signature)` where `PermitSingle = ((address token, uint160 amount, uint48 expiration, uint48 nonce), address spender, uint256 sigDeadline)` |
| `WRAP_ETH` | 0x0b | `(address recipient, uint256 amountMin)` — wraps `msg.value` into WETH held by router (or recipient) |
| `UNWRAP_WETH` | 0x0c | `(address recipient, uint256 amountMin)` |
| `PERMIT2_TRANSFER_FROM_BATCH` | 0x0d | `(batch transfer details…)` |
| `BALANCE_CHECK_ERC20` | 0x0e | `(address owner, address token, uint256 minBalance)` |
| `EXECUTE_SUB_PLAN` | 0x21 | nested commands+inputs |

Notes:
- `payerIsUser = true` means the user pays via Permit2 (`PERMIT2_TRANSFER_FROM` must run first in the same tx, or allowance exists); `false` means the router already holds the funds (after a previous step such as `WRAP_ETH`).
- Recipient sentinels from `ActionConstants`: `MSG_SENDER = address(1)`, `ADDRESS_THIS = address(2)` (router-held balance). Confirm values in the vendored `ActionConstants.sol` before implementing.
- **Vendored Uniswap UR (current main) appends an extra trailing `uint256[] minHopPriceX36` to the V2/V3 swap inputs** (Dispatcher L69-82). **MetaSwap decision:** omit it, follow the 5-field layout above, and document the omission in `docs/specs/CHANGES.md` if the maintainer wants full parity.
- Router-level `minHopPriceX36`, V4 commands and position-manager commands are out of scope for MetaSwap.

Canonical swap sequences (classic):
- ERC20 in, permit2 pre-approved: `[PERMIT2_TRANSFER_FROM(tokenIn, pool/router, amountIn)?]` — the Uniswap pattern is `PERMIT2_TRANSFER_FROM(tokenIn, <router or pool>, amountIn)` then `V3_SWAP_EXACT_IN(recipient, amountIn, amountOutMin, path, payerIsUser=false)`. Using `payerIsUser=true` pays from the user directly through Permit2 inside the swap; choose one per route. MetaSwap default: `payerIsUser=true` with the Permit2 allowance, to save one call.
- ETH in: `WRAP_ETH(ADDRESS_THIS, amountIn)` then swap with `payerIsUser=false`; `value = amountIn`.
- ETH out: swap with recipient `ADDRESS_THIS`, then `UNWRAP_WETH(MSG_SENDER, amountOutMin)`.

---

## 5. UniswapX / MetaSwapX order mechanics (summary; detail in metaswapx-metachain.md)

- `ExclusiveDutchOrder` (exact field order, `ExclusiveDutchOrderLib.sol`):
  `OrderInfo info; uint256 decayStartTime; uint256 decayEndTime; address exclusiveFiller; uint256 exclusivityOverrideBps; address inputToken; uint256 inputStartAmount; uint256 inputEndAmount; DutchOutput[] outputs;`
  (the Solidity struct uses `DutchInput input` which flattens to `inputToken, inputStartAmount, inputEndAmount` in the typestring).
- `OrderInfo { address reactor; address swapper; uint256 nonce; uint256 deadline; address additionalValidationContract; bytes additionalValidationData; }`.
- `DutchOutput { address token; uint256 startAmount; uint256 endAmount; address recipient; }`.
- Typehashes: `ORDER_INFO_TYPE = "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)"`.
- Decay (`DutchDecayLib.sol`): `decay(start, end, decayStart, decayEnd)`:
  - `t <= decayStart` → `start`; `t >= decayEnd` → `end`; otherwise `start + (end - start) * (t - decayStart) / (decayEnd - decayStart)` (floor; sign follows direction).
  - Outputs decay down (`startAmount >= endAmount`); inputs decay up (`startAmount <= endAmount`). A reactor rejects orders where both inputs and outputs decay.
  - Validation: `deadline >= decayEndTime >= decayStartTime`.
- Exclusivity: before `decayStartTime`, only `exclusiveFiller` may fill (or, with `exclusivityOverrideBps > 0`, a non-exclusive filler may override by improving outputs by that many bps).
- Reactor entry points: `execute(SignedOrder)` and `executeWithCallback(SignedOrder, bytes callbackData)` where `SignedOrder { bytes order; bytes sig; }`.
- Cancel: `Permit2.invalidateUnorderedNonces(wordPos, mask)` (swapper-signed or directly on-chain).

---

## 6. Trade math used by UI and API

### 6.1 Price impact
- Mid price (pre-fee): `mid = reserveOut / reserveIn` (V2); `mid = (sqrtP/2^96)^2` oriented to tokenOut/tokenIn (V3).
- Execution price: `exec = amountOut / amountIn`.
- `priceImpact = 1 - exec / mid`, shown as bps: `priceImpactBps = round(10000 * (1 - exec/mid))`. Clamp to 0 when negative (fee-only). Show warning above 1% (100 bps) per Uniswap UX convention (see UI analysis).
- For multi-hop, compute per hop and compound: `1 - Π(1 - impact_i)`, or use the full-route mid price.

### 6.2 Slippage and bounds
- Exact input: `amountOutMinimum = floor(amountOut * (10000 - slippageBps) / 10000)`.
- Exact output: `amountInMaximum = ceil(amountIn * (10000 + slippageBps) / 10000)`.
- Default auto slippage: 0.5% (50 bps) for majors; MetaSwap: 50 bps default, user range 1–500 bps, warn above 100 bps.

### 6.3 Deadline
- `deadline = now + 30 min` default (`block.timestamp` based). Pass as the `execute` argument; permits also carry `sigDeadline`/`deadline`.
- MetaSwapX order `deadline` is absolute unix seconds in `OrderInfo`; decay times are absolute seconds too (chain has 1s blocks on MetaChain Devnet, so use `block.timestamp`).

### 6.4 Gas estimation
- `gasEstimate` from QuoterV2 is a rough hint only. Use `eth_estimateGas` on the final `methodParameters` (with `from` = user) and add 20% headroom for the UI estimate.
- `gasUsd = gasUnits * gasPriceWei / 1e18 * ethUsd`.
- Gas is ETH on devnet (`nativeCurrency: ETH`).

### 6.5 USD pricing
- Stablecoin anchor: pools with mUSDC/mUSDT/mDAI paired to any token; price of token = `quote(token → stable)` on the best route, using pool spot price (V2 reserves or V3 `sqrtPriceX96`), weighted by TVL, optionally TWAP (V2 `price0CumulativeLast` / V3 `observe`).
- ETH price: derived from `WETH/mUSDC` pools (seed price 3000) — `ethUsd = spot(WETH→mUSDC)`.
- Token USD price = route-based quote through the highest-TVL path to a stable (max 2 hops). If no route, `priceUsd = null` (do not guess).
- Seed prices in PLAN (WETH 3000, mWBTC 60000, META 8, mLINK 15, mARB 0.8, stables 1) are used only to **seed the pools** on Anvil; the API must derive USD from pools, not from the constants.

---

## 7. Note: Uniswap v4 (context only, not implemented)

- v4 uses a singleton `PoolManager` (all pools in one contract, pools identified by `PoolKey {currency0, currency1, fee, tickSpacing, hooks}`), **flash accounting** (balance deltas per unlock; settle/take at the end of `unlock`), and **hooks** (callbacks at `beforeSwap`, `afterSwap`, `beforeAddLiquidity`, etc. gated by address bits).
- Pool id = `keccak256(abi.encode(PoolKey))`. Native ETH is `address(0)` currency.
- License: v4-core and v4-periphery are BUSL-1.1 (PLAN ground rule 1: do not port). Use only as conceptual reference.
- Practical impact on MetaSwap: none; MetaSwap V2/V3 + UniversalRouter v3 commands are the scope.

---

## Sources
- V2 core: https://github.com/Uniswap/v2-core (UniswapV2Pair.sol, UniswapV2ERC20.sol, UniswapV2Factory.sol)
- V2 periphery library: https://github.com/Uniswap/v2-periphery/blob/master/contracts/libraries/UniswapV2Library.sol
- V3 core: https://github.com/Uniswap/v3-core (UniswapV3Pool.sol, UniswapV3Factory.sol, libraries/TickMath.sol, SwapMath.sol, SqrtPriceMath.sol, Tick.sol, Position.sol, Oracle.sol, interfaces/pool/IUniswapV3PoolEvents.sol)
- V3 periphery: https://github.com/Uniswap/v3-periphery (lens/QuoterV2.sol, lens/TickLens.sol)
- Permit2: https://github.com/Uniswap/permit2 (src/libraries/PermitHash.sol, src/SignatureTransfer.sol, src/AllowanceTransfer.sol, src/interfaces/ISignatureTransfer.sol)
- UniversalRouter: https://github.com/Uniswap/universal-router (contracts/libraries/Commands.sol, base/Dispatcher.sol)
- UniswapX: https://github.com/Uniswap/UniswapX (src/lib/ExclusiveDutchOrderLib.sol, DutchOrderLib.sol, DutchDecayLib.sol, OrderInfoLib.sol, src/reactors/ExclusiveDutchOrderReactor.sol, src/base/ReactorStructs.sol)
- Uniswap docs (fetched via developers.uniswap.org llms.mdx): https://developers.uniswap.org/llms.mdx/docs/liquidity/uniswapx/concepts/auction-types
- Items marked from memory and not re-read in source this pass: WETH9 ABI details, Babylonian `sqrt` body, `ActionConstants` values, V3 `getNextSqrtPriceFromInput` rounding nuance. Verify before relying on exact rounding.
