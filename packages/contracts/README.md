# MetaSwap contracts

Foundry project for the MetaSwap AMM (`src/amm`, AMM contracts) and MetaSwapX / router (`src/x`, router & MetaSwapX contracts).
Each section below is owned by its area.

## AMM (`src/amm`, AMM contracts)

These are ports of Uniswap v2-core and v2-periphery (GPL-3.0), and of v3-core and v3-periphery `0.8` branches and
swap-router-contracts (GPL-2.0-or-later), moved to Solidity 0.8.26. Every ported file keeps its SPDX header and has a
`// Ported from …` line. v3-core files that were BUSL-1.1 are marked GPL-2.0-or-later, the licence they switched to
on their Change Date (2023-04-01). **The periphery never uses CREATE2 init-code hashes.** It finds pairs and pools
with `factory.getPair` / `factory.getPool`, and V3 callbacks are accepted only when `msg.sender == pool`.

| Contract | Path | Notes |
|---|---|---|
| `WETH9` | `tokens/WETH9.sol` | canonical WETH9 |
| `TestERC20` | `tokens/TestERC20.sol` | ERC20 + EIP-2612, `decimals` set in the constructor, open `mint(to, amount)`, `faucet()` (mints `faucetAmount`, once per hour per address; `faucetAvailableIn(addr)`) |
| `Multicall3` | `utils/Multicall3.sol` | standard Multicall3 |
| `MetaSwapV2Factory` | `v2/MetaSwapV2Factory.sol` | `createPair`, `getPair`, `allPairs`, `feeTo` switch, `pairCodeHash()` (informational) |
| `MetaSwapV2Pair` | `v2/MetaSwapV2Pair.sol` | LP token "MetaSwap V2" / "MS-V2", EIP-2612 permit, TWAP accumulators (`unchecked` wrap), `skim` / `sync`, 0.30% fee, flash swaps via `uniswapV2Call` |
| `MetaSwapV2Router02` | `v2/MetaSwapV2Router02.sol` | the full Router02 surface, including the ETH and fee-on-transfer variants |
| `MetaSwapV3Factory` | `v3/MetaSwapV3Factory.sol` | fee tiers 100/500/3000/10000 → tick spacing 1/10/60/200, all enabled in the constructor |
| `MetaSwapV3Pool` | `v3/MetaSwapV3Pool.sol` | v3-core `0.8` pool; reverts with custom errors (`IMetaSwapV3PoolErrors`) |
| `NonfungiblePositionManager` | `v3/NonfungiblePositionManager.sol` | ERC721 "MetaSwap V3 Positions" / "MS-V3-POS"; constructor `(factory, WETH9)`; deploys its own `PositionDescriptor` (on-chain JSON + SVG `tokenURI`, `tokenDescriptor()`) |
| `SwapRouter02` | `v3/SwapRouter02.sol` | swap-router-contracts surface: V3 `exactInput[Single]`/`exactOutput[Single]`, V2 `swapExactTokensForTokens`/`swapTokensForExactTokens`, `multicall(bytes[])`, `multicall(deadline, bytes[])`, `multicall(prevBlockhash, bytes[])`, `wrapETH`/`unwrapWETH9`/`refundETH`/`sweepToken`/`pull` (+ fee variants), SelfPermit. ApproveAndCall is **not** included. Constructor `(v2Factory, v3Factory, positionManager, WETH9)` |
| `QuoterV2` | `v3/QuoterV2.sol` | `quoteExactInput[Single]`, `quoteExactOutput[Single]` (call with `eth_call`) |
| `TickLens` | `v3/TickLens.sol` | `getPopulatedTicksInWord(pool, wordIndex)` |

Interfaces use the Uniswap function signatures and events, so standard tooling and ABIs work. Import them as
`@metaswap/amm/v2/interfaces/IMetaSwapV2{Factory,Pair,Router01,Router02,Callee,ERC20}.sol`, `.../v2/interfaces/IWETH.sol`,
`@metaswap/amm/v3/interfaces/IMetaSwapV3{Factory,Pool}.sol` (+ `pool/*`, `callback/IMetaSwapV3{Swap,Mint,Flash}Callback.sol`),
`INonfungiblePositionManager.sol`, `ISwapRouter02.sol`, `IV3SwapRouter.sol`, `IV2SwapRouter.sol`, `IQuoterV2.sol`,
`ITickLens.sol` and `external/IWETH9.sol`. Callback function names are unchanged (`uniswapV3SwapCallback`,
`uniswapV3MintCallback`, `uniswapV3FlashCallback`, `uniswapV2Call`).

### Test, deploy, seed

```bash
export PATH="$PATH:/c/Users/bikal/Tools/foundry/bin"
FOUNDRY_PROFILE=amm forge test        # 109 tests: V2 pair/router, V3 pool/NPM/router/quoter/lens, math fuzz, tokens

anvil --chain-id 31337 --block-time 1 --accounts 10 --balance 10000 --port 8545
K=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # Anvil #0, local devnet only
forge script script/DeployAMM.s.sol --rpc-url http://127.0.0.1:8545 --private-key $K --broadcast --slow
forge script script/DeployX.s.sol   --rpc-url http://127.0.0.1:8545 --private-key $K --broadcast --slow
forge script script/Seed.s.sol      --rpc-url http://127.0.0.1:8545 --private-key $K --broadcast --slow
```

- `DeployAMM` deploys everything above plus the 7 `TestERC20` seed tokens (WETH is `WETH9`) using `$PRIVATE_KEY`,
  or Anvil #0 if that is not set. It then writes `deployments/31337.json`.
- `Seed` works only on a fresh chain, after DeployAMM; it reverts if any V2 pair already exists, so to run it again,
  restart anvil and redeploy. It reads the deployment file and works in this order:
  1. Mints test tokens to accounts #0–#5 in one Multicall3 transaction, and has #0 wrap 8,000 ETH.
  2. Submits EIP-2612 permits from #1–#5 for both routers.
  3. Creates the 6 V2 pairs and 7 V3 pools from PLAN.md at the seed prices. `sqrtPriceX96` takes token order and
     decimals into account (`script/lib/MetaSwapConfig.sol`).
  4. Adds liquidity. V2 pools get $0.6M–$3M per side. Each V3 pool gets a full-range position (owned by #0), a wide
     concentrated position (#1) and a narrow one (#2), and its oracle cardinality is raised to 100.
  5. Runs 63 swaps from #1–#5: V2 router (exact in/out, ETH in/out) and SwapRouter02 (exact in/out, ETH in with
     `refundETH`, multi-hop).
  6. Writes `pools.v2` / `pools.v3` back into the file. Only the `.pools` key is replaced; other keys, such as the
     DeployX contracts, are kept.
- Seed sends about 100 transactions. Anvil mines a multi-sender script one transaction per block, so it takes about
  4–5 minutes with `--block-time 1`.
- Swap transactions set an explicit gas limit (`SWAP_GAS`). Forge re-simulates every broadcast transaction inside one
  block, which hides the V2 accumulator and V3 oracle storage writes, so its estimates come out too low.
- For a $10k trade on the majors, price impact is about 0.06% (e.g. QuoterV2: 1 WETH → 2998 mUSDC on the 0.05% pool).

### `deployments/31337.json`

```jsonc
{
  "chainId": 31337,
  "blockNumber": 8,                 // block at the start of DeployAMM (indexer start)
  "contracts": { "WETH9", "Multicall3", "V2Factory", "V2Router02", "V3Factory",
                 "NonfungiblePositionManager", "SwapRouter02", "QuoterV2", "TickLens",
                 /* merged by DeployX: */ "Permit2", "UniversalRouter", "ExclusiveDutchOrderReactor", "SwapRouter02Executor" },
  "tokens": [ { "symbol": "WETH", "name": "Wrapped Ether", "decimals": 18, "address": "0x…", "seedPriceUsd": 3000 }, … ],
  "pools": { "v2": [ { "address", "token0", "token1" } ], "v3": [ { "address", "token0", "token1", "fee" } ] }
}
```

DeployAMM writes `pools` as empty arrays, and Seed fills them in. Tokens are listed in this order: WETH, mUSDC,
mUSDT, mDAI, mWBTC, META, mLINK, mARB.

## MetaSwapX & Router (`src/x`, router & MetaSwapX contracts)

Ports of Uniswap Permit2 (MIT), UniversalRouter (GPL-3.0) and UniswapX (GPL-2.0-or-later); every ported file keeps
its SPDX header and a `// Ported from …` line.

| Contract | Path |
|---|---|
| `Permit2` (SignatureTransfer + AllowanceTransfer) | `src/x/permit2/Permit2.sol` |
| `MetaSwapUniversalRouter` | `src/x/router/MetaSwapUniversalRouter.sol` |
| `ExclusiveDutchOrderReactor` (+ `BaseReactor`, `ProtocolFees`) | `src/x/metaswapx/reactors/` |
| `SwapRouter02Executor` (filler executor) | `src/x/metaswapx/sample-executors/SwapRouter02Executor.sol` |

```bash
export PATH="$PATH:/c/Users/bikal/Tools/foundry/bin"
FOUNDRY_PROFILE=x forge test                                   # Permit2, router, reactor tests (real AMM pools)
forge script script/DeployX.s.sol --rpc-url http://127.0.0.1:8545 --broadcast   # after DeployAMM (+ Seed)
```

`DeployX` reads `deployments/31337.json`, deploys the four contracts and merges `Permit2`, `UniversalRouter`,
`ExclusiveDutchOrderReactor`, `SwapRouter02Executor` into `.contracts` (other keys are kept). Deployer/owner =
`$PRIVATE_KEY` or Anvil #0; the executor's whitelisted caller = `$FILLER_ADDRESS` or Anvil #9
(`0xa0Ee7A142d267C1f36714E4a8F75612F20a79720`). Reactor protocol fee is 0 until the owner calls
`setProtocolFeeController` (max 5 bps per output token).

### UniversalRouter

`execute(bytes commands, bytes[] inputs, uint256 deadline)` (and `execute(bytes, bytes[])`), payable. One command
byte per input; set bit `0x80` to allow that command to fail. Constructor: `(permit2, weth9, v2Factory, v3Factory)`;
pools/pairs are found with `getPool` / `getPair`. Recipient flags: `address(1)` = `msg.sender`, `address(2)` = the
router. Amount `1<<255` (`CONTRACT_BALANCE`) = the router's whole balance; V2 `amountIn = 0` = already paid to the pair.

| byte | command | `abi.encode` of input |
|---|---|---|
| `0x00` | V3_SWAP_EXACT_IN | `(address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)` |
| `0x01` | V3_SWAP_EXACT_OUT | `(address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser)`, path reversed (tokenOut first) |
| `0x02` | PERMIT2_TRANSFER_FROM | `(address token, address recipient, uint160 amount)` |
| `0x03` | PERMIT2_PERMIT_BATCH | `(IAllowanceTransfer.PermitBatch, bytes signature)` |
| `0x04` | SWEEP | `(address token, address recipient, uint256 amountMin)` (token `0x0` = ETH) |
| `0x05` | TRANSFER | `(address token, address recipient, uint256 value)` |
| `0x06` | PAY_PORTION | `(address token, address recipient, uint256 bips)` |
| `0x08` | V2_SWAP_EXACT_IN | `(address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser)` |
| `0x09` | V2_SWAP_EXACT_OUT | `(address recipient, uint256 amountOut, uint256 amountInMax, address[] path, bool payerIsUser)` |
| `0x0a` | PERMIT2_PERMIT | `(IAllowanceTransfer.PermitSingle, bytes signature)` |
| `0x0b` | WRAP_ETH | `(address recipient, uint256 amount)` |
| `0x0c` | UNWRAP_WETH | `(address recipient, uint256 amountMin)` |
| `0x0d` | PERMIT2_TRANSFER_FROM_BATCH | `(IAllowanceTransfer.AllowanceTransferDetails[])` |
| `0x0e` | BALANCE_CHECK_ERC20 | `(address owner, address token, uint256 minBalance)` |
| `0x21` | EXECUTE_SUB_PLAN | `(bytes commands, bytes[] inputs)` |

V3 path = `tokenIn ‖ uint24 fee ‖ tokenOut [‖ fee ‖ token …]` (packed). These are the classic UniversalRouter
encodings, without the newer `minHopPriceX36` field.

### EIP-712

Permit2 domain: `EIP712Domain(string name,uint256 chainId,address verifyingContract)`, name `"Permit2"`, chainId
31337, verifyingContract = Permit2 (no version).

- `PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)`
  (spender = UniversalRouter, nonce = `allowance(owner, token, spender).nonce`).
- MetaSwapX orders are signed as Permit2 `PermitWitnessTransferFrom` with spender = reactor,
  `permitted = {inputToken, inputEndAmount}`, `nonce = info.nonce`, `deadline = info.deadline`, `witness` = the order:

```
PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,ExclusiveDutchOrder witness)
DutchOutput(address token,uint256 startAmount,uint256 endAmount,address recipient)
ExclusiveDutchOrder(OrderInfo info,uint256 decayStartTime,uint256 decayEndTime,address exclusiveFiller,uint256 exclusivityOverrideBps,address inputToken,uint256 inputStartAmount,uint256 inputEndAmount,DutchOutput[] outputs)
OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)
TokenPermissions(address token,uint256 amount)
```

(concatenated without newlines; referenced types are in alphabetical order, so viem/ethers/alloy `signTypedData`
with these types produces matching signatures).

`SignedOrder.order` = `abi.encode(ExclusiveDutchOrder)` where the struct is
`((address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData) info, uint256 decayStartTime, uint256 decayEndTime, address exclusiveFiller, uint256 exclusivityOverrideBps, (address token,uint256 startAmount,uint256 endAmount) input, (address token,uint256 startAmount,uint256 endAmount,address recipient)[] outputs)`.
Order hash (Fill event `orderHash`) = EIP-712 struct hash of the order. Cancel with Permit2
`invalidateUnorderedNonces(nonce >> 8, 1 << (nonce & 0xff))`.

Rules: outputs decay linearly from `startAmount` down to `endAmount` between `decayStartTime` and `decayEndTime` (or
the input decays upward, never both); `deadline >= decayEndTime`; before `decayStartTime` only `exclusiveFiller`
may fill, others must add `exclusivityOverrideBps` to every output (0 = strictly exclusive).

### Filler executor

`SwapRouter02Executor.execute(SignedOrder order, bytes callbackData)` / `executeBatch(SignedOrder[], bytes)`, callable
only by the whitelisted filler. `callbackData = abi.encode(address[] approveToSwapRouter02, address[] approveToReactor,
bytes[] swapRouter02Calls)`; the calls run through `SwapRouter02.multicall(type(uint256).max, calls)` (V3
`exactInputSingle`/`exactInput`… or V2 `swapExactTokensForTokens`…, with recipient = the executor). Surplus stays in the
executor; owner can `withdrawERC20`, `withdrawETH`, `unwrapWETH`.
