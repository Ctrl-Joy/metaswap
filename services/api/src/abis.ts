// Minimal Uniswap-compatible ABIs used by the API.
//
// The binding interfaces (PLAN.md + docs/analysis/protocol.md) require MetaSwap contracts to
// keep Uniswap's function signatures and event layouts, so these human-readable fragments are
// stable. They are typed at compile time (the sdk's generated ABIs are empty placeholders until
// `npm run sdk:sync`), and `verifyAgainstSdk()` checks at startup that every fragment used here
// exists in the synced `@metaswap/sdk` ABIs so a contract-side divergence is reported loudly.
import { parseAbi, toEventSelector, toFunctionSelector, type Abi, type AbiEvent, type AbiFunction } from 'viem'
import * as sdk from '@metaswap/sdk'

export const erc20Abi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
])

export const weth9Abi = parseAbi([
  'event Deposit(address indexed dst, uint256 wad)',
  'event Withdrawal(address indexed src, uint256 wad)',
  'function deposit() payable',
  'function withdraw(uint256 wad)',
])

export const v2FactoryAbi = parseAbi([
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)',
  'function getPair(address, address) view returns (address)',
  'function allPairsLength() view returns (uint256)',
])

export const v2PairAbi = parseAbi([
  'event Mint(address indexed sender, uint256 amount0, uint256 amount1)',
  'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)',
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
  'event Sync(uint112 reserve0, uint112 reserve1)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
])

export const v3FactoryAbi = parseAbi([
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
  'function getPool(address, address, uint24) view returns (address)',
])

export const v3PoolAbi = parseAbi([
  'event Initialize(uint160 sqrtPriceX96, int24 tick)',
  'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)',
  'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
  'function feeGrowthGlobal0X128() view returns (uint256)',
  'function feeGrowthGlobal1X128() view returns (uint256)',
  'function ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)',
  'function tickSpacing() view returns (int24)',
])

export const npmAbi = parseAbi([
  'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }',
  'function collect(CollectParams params) payable returns (uint256 amount0, uint256 amount1)',
])

export const quoterV2Abi = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
  'function quoteExactOutput(bytes path, uint256 amountOut) returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
  'struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }',
  'struct QuoteExactOutputSingleParams { address tokenIn; address tokenOut; uint256 amount; uint24 fee; uint160 sqrtPriceLimitX96; }',
  'function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactOutputSingle(QuoteExactOutputSingleParams params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
])

export const multicall3Abi = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
  'function getEthBalance(address addr) view returns (uint256 balance)',
  'function getCurrentBlockTimestamp() view returns (uint256 timestamp)',
])

export const permit2Abi = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function nonceBitmap(address owner, uint256 wordPos) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function invalidateUnorderedNonces(uint256 wordPos, uint256 mask)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
])

export const universalRouterAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
  'function execute(bytes commands, bytes[] inputs) payable',
])

export const reactorAbi = parseAbi([
  'event Fill(bytes32 indexed orderHash, address indexed filler, address indexed swapper, uint256 nonce)',
  'struct SignedOrder { bytes order; bytes sig; }',
  'function execute(SignedOrder order) payable',
  'function executeWithCallback(SignedOrder order, bytes callbackData) payable',
])

export const executorAbi = parseAbi([
  'struct SignedOrder { bytes order; bytes sig; }',
  'function execute(SignedOrder order, bytes callbackData)',
  'function whitelistedCaller() view returns (address)',
  'function reactor() view returns (address)',
])

export const swapRouter02Abi = parseAbi([
  'struct ExactInputParams { bytes path; address recipient; uint256 amountIn; uint256 amountOutMinimum; }',
  'function exactInput(ExactInputParams params) payable returns (uint256 amountOut)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
])


// ---------- Stage 5 (docs/specs/STAGE5.md §1) ----------

export const vaultAbi = parseAbi([
  'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
  'event RateUpdated(uint256 apyBps)',
  'event ReserveFunded(uint256 amount)',
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function apyBps() view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function depositETH(address receiver) payable returns (uint256)',
])

export const launchpadAbi = parseAbi([
  'event LaunchCreated(address indexed token, address indexed auction, address indexed creator, string name, string symbol)',
  'function name() view returns (string)',
  'function launchCount() view returns (uint256)',
  'function verified(address auction) view returns (bool)',
  'event VerifiedSet(address indexed auction, bool verified)',
  'function allLaunches() view returns (address[])',
  'function setVerified(address auction, bool verified)',
  'struct LaunchParams { string name; string symbol; uint256 totalSupply; uint256 auctionSupplyBps; address quoteToken; uint256 floorPrice; uint256 tickSize; uint256 startTime; uint256 endTime; uint256 launchThreshold; uint256 liquidityBps; uint24 poolFee; string description; string website; }',
  'function createLaunch(LaunchParams p) returns (address token, address auction)',
])

export const launchAuctionAbi = parseAbi([
  'event BidPlaced(uint256 indexed bidId, address indexed bidder, uint256 amount, uint256 maxPrice)',
  'event Settled(uint256 clearingPrice, uint256 raised, bool launched, address pool)',
  'event Claimed(uint256 indexed bidId, address indexed bidder, uint256 tokens, uint256 refund)',
  'function status() view returns (uint8)',
  'function clearingPrice() view returns (uint256)',
  'function totalBids() view returns (uint256)',
  'function totalCommitted() view returns (uint256)',
  'function raised() view returns (uint256)',
  'function thresholdProgressBps() view returns (uint256)',
  'function priceLevels() view returns (uint256[] prices, uint256[] demand)',
  'function fdvAtFloor() view returns (uint256)',
  'function token() view returns (address)',
  'function pool() view returns (address)',
  'function bid(uint256 amount, uint256 maxPrice) returns (uint256 bidId)',
  'function bidETH(uint256 maxPrice) payable returns (uint256 bidId)',
  'struct BidInfo { uint256 id; address bidder; uint256 amount; uint256 maxPrice; bool native; bool claimed; }',
  'function bidsOf(address bidder) view returns (BidInfo[])',
  'function previewClaim(uint256 bidId) view returns (uint256 tokens, uint256 refund)',
  'function settle()',
  'function claim(uint256 bidId)',
  'function claimAll()',
])

export const AUCTION_STATUS = ['upcoming', 'active', 'ended', 'launched', 'failed'] as const

/** Which sdk export (synced from forge out/) must contain each local ABI's fragments. */
const SDK_ABI_EXPORTS: [string, Abi][] = [
  ['v2FactoryAbi', v2FactoryAbi],
  ['v2PairAbi', v2PairAbi],
  ['v3FactoryAbi', v3FactoryAbi],
  ['v3PoolAbi', v3PoolAbi],
  ['nonfungiblePositionManagerAbi', npmAbi],
  ['quoterV2Abi', quoterV2Abi],
  ['permit2Abi', permit2Abi],
  ['universalRouterAbi', universalRouterAbi],
  ['exclusiveDutchOrderReactorAbi', reactorAbi],
  ['swapRouter02Abi', swapRouter02Abi],
  ['weth9Abi', weth9Abi],
  ['savingsVaultAbi', vaultAbi],
  ['launchpadAbi', launchpadAbi],
  ['launchAuctionAbi', launchAuctionAbi],
]

function selectors(abi: Abi): Set<string> {
  const out = new Set<string>()
  for (const item of abi) {
    if (item.type === 'event') out.add(toEventSelector(item as AbiEvent))
    else if (item.type === 'function') out.add(toFunctionSelector(item as AbiFunction))
  }
  return out
}

/** Returns human-readable problems; empty when the synced sdk ABIs cover every fragment we use. */
export function verifyAgainstSdk(): string[] {
  const problems: string[] = []
  for (const [name, local] of SDK_ABI_EXPORTS) {
    const sdkAbi = (sdk as unknown as Record<string, Abi | undefined>)[name]
    if (!sdkAbi || sdkAbi.length === 0) {
      problems.push(`${name}: empty in @metaswap/sdk (run npm run sdk:sync)`)
      continue
    }
    const have = selectors(sdkAbi)
    for (const item of local) {
      if (item.type !== 'event' && item.type !== 'function') continue
      const sel = item.type === 'event' ? toEventSelector(item as AbiEvent) : toFunctionSelector(item as AbiFunction)
      // only the functions the contract exposes; skip overload-only helpers absent by design
      if (!have.has(sel)) problems.push(`${name}: missing ${item.type} ${item.name}`)
    }
  }
  return problems
}

/** `LaunchAuction.params()` — the immutable LaunchParams the auction was created with. */
export const launchParamsAbi = parseAbi([
  'struct LaunchParams { string name; string symbol; uint256 totalSupply; uint256 auctionSupplyBps; address quoteToken; uint256 floorPrice; uint256 tickSize; uint256 startTime; uint256 endTime; uint256 launchThreshold; uint256 liquidityBps; uint24 poolFee; string description; string website; }',
  'function params() view returns (LaunchParams)',
])
