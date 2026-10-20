// MetaSwap devnet market simulator.
//
//   npx tsx scripts/market.ts --history   replay HISTORY_DAYS of hourly trading up to "now" (run once,
//                                          right after Seed, on a chain whose genesis timestamp was set
//                                          HISTORY_DAYS in the past via anvil --timestamp)
//   npx tsx scripts/market.ts --live      keep trading gently in real time (every LIVE_INTERVAL_SECONDS)
//                                          so 1H changes, live transaction feeds and charts keep moving
//
// Model: each token has a USD price following a seeded random walk (correlated with ETH,
// stablecoins mean-reverting around $1). Each step moves every pool to the implied price — V3
// pools exactly, via exactInputSingle with sqrtPriceLimitX96 = target; V2 pools via the
// closed-form x*y=k trade — and adds random organic trades for volume.
//
// Stage 5 (docs/specs/STAGE5.md §2): the history replay also runs token launches through both
// launchpads (graduated + failed auctions, plus Active/Upcoming ones at "now"), and Earn vault
// deposits/withdrawals. Graduated tokens join the steered pool set with meme-like volatility. Live
// mode keeps adding small bids to Active auctions and settles/claims auctions as they end.
//
// Trades come from Anvil accounts #10–#14 (dev.mjs starts anvil with 20 unlocked accounts); bids
// also come from #15–#19 and the demo wallet #1. The Dev wallet/e2e accounts #0, #2–#4 and the
// filler (#9) are never touched (#0 only signs launchpad owner calls). Local devnet only.
//
// Env: METASWAP_RPC (default http://127.0.0.1:8545), METASWAP_DEPLOYMENT_FILE (default: the synced sdk copy).
import { readFileSync } from 'node:fs'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  maxUint256,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from 'viem'
import {
  DEVNET_RPC_URL,
  deployment as sdkDeployment,
  metachainDevnet,
  swapRouter02Abi,
  testErc20Abi,
  v2PairAbi,
  v3PoolAbi,
  weth9Abi,
  type Deployment,
} from '../packages/sdk/src/index'

const MODE = process.argv.includes('--live') ? 'live' : 'history'
const HISTORY_DAYS = Number(process.env.HISTORY_DAYS ?? 30)
const STEP_SECONDS = Number(process.env.HISTORY_STEP_SECONDS ?? 3600)
const LIVE_INTERVAL_SECONDS = Number(process.env.LIVE_INTERVAL_SECONDS ?? 20)
const SWAP_GAS = 1_000_000n
const DEPLOY_GAS = 12_000_000n
const RPC = process.env.METASWAP_RPC ?? DEVNET_RPC_URL

type Vault = { address: Address; asset: Address; symbol: string; apyBps: number }
const deployment = (
  process.env.METASWAP_DEPLOYMENT_FILE ? JSON.parse(readFileSync(process.env.METASWAP_DEPLOYMENT_FILE, 'utf8')) : sdkDeployment
) as Deployment & { vaults?: Vault[]; contracts: Deployment['contracts'] & { Launchpad?: Address; DevnetPad?: Address } }
const contractAddress = (name: keyof typeof deployment.contracts): Address => {
  const a = deployment.contracts[name]
  if (!a) throw new Error(`Contract ${String(name)} is not in the deployment`)
  return a as Address
}

// Anvil default-mnemonic accounts
const OWNER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // #0 deployer = launchpad owner
const DEMO: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' // #1 demo wallet
const TRADERS: Address[] = [
  '0xBcd4042DE499D14e55001CcbB24a551F3b954096', // #10
  '0x71bE63f3384f5fb98995898A86B02Fb2426c5788', // #11
  '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a', // #12
  '0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec', // #13
  '0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097', // #14
]
const EXTRA_BIDDERS: Address[] = [
  '0xcd3B766CCDd6AE721141F452C550Ca635964ce71', // #15
  '0x2546BcD3c84621e976D8185a91A922aE77ECEc30', // #16
  '0xbDA5747bFD65F08deb54cb465eB87D40e51B197E', // #17
  '0xdD2FD4581271e230360230F9337D5c0430Bf44C0', // #18
  '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199', // #19
]
const CREATORS = EXTRA_BIDDERS
// Per-trader working capital. Enough to steer deep pools for a month, small enough that
// totalSupply (and so FDV) stays believable.
const TRADER_USD_PER_TOKEN = 25_000_000
const TRADER_WETH = parseEther('10000')

const chain = { ...metachainDevnet, rpcUrls: { default: { http: [RPC] } } }
const transport = http(RPC, { timeout: 60_000 })
const pub = createPublicClient({ chain, transport, pollingInterval: 250 })
const wallet = createWalletClient({ chain, transport })
const rpc = (method: string, params: unknown[] = []) => pub.request({ method: method as never, params: params as never })
const log = (msg: string) => console.log(`[market:${MODE}] ${msg}`)

// ---------- Stage 5 ABIs (packages/contracts/README.md) ----------
const launchpadAbi = parseAbi([
  'struct LaunchParams { string name; string symbol; uint256 totalSupply; uint256 auctionSupplyBps; address quoteToken; uint256 floorPrice; uint256 tickSize; uint256 startTime; uint256 endTime; uint256 launchThreshold; uint256 liquidityBps; uint24 poolFee; string description; string website; }',
  'function createLaunch(LaunchParams p) returns (address token, address auction)',
  'function setVerified(address auction, bool verified)',
  'function allLaunches() view returns (address[])',
  'event LaunchCreated(address indexed token, address indexed auction, address indexed creator, string name, string symbol)',
])
const auctionAbi = parseAbi([
  'struct LaunchParams { string name; string symbol; uint256 totalSupply; uint256 auctionSupplyBps; address quoteToken; uint256 floorPrice; uint256 tickSize; uint256 startTime; uint256 endTime; uint256 launchThreshold; uint256 liquidityBps; uint24 poolFee; string description; string website; }',
  'function params() view returns (LaunchParams)',
  'function status() view returns (uint8)',
  'function token() view returns (address)',
  'function pool() view returns (address)',
  'function totalBids() view returns (uint256)',
  'function bid(uint256 amount, uint256 maxPrice) returns (uint256)',
  'function bidETH(uint256 maxPrice) payable returns (uint256)',
  'function settle()',
  'function claim(uint256 bidId)',
  'struct BidInfo { uint256 id; address bidder; uint256 amount; uint256 maxPrice; bool native; bool claimed; }',
  'function bidsOf(address bidder) view returns (BidInfo[])',
])
const vaultAbi = parseAbi([
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function depositETH(address receiver) payable returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
])
const AUCTION_STATUS = ['upcoming', 'active', 'ended', 'launched', 'failed'] as const

// ---------- deterministic randomness ----------
let seed = Number(process.env.MARKET_SEED ?? (MODE === 'live' ? Date.now() % 2 ** 31 : 20261020))
function rand(): number {
  // mulberry32
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
function gauss(): number {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]

// ---------- price model ----------
interface SimToken {
  symbol: string
  name: string
  decimals: number
  address: Address
  seedPriceUsd: number
  /** launched through a launchpad: no open mint, meme volatility */
  launched?: boolean
}
const tokens: SimToken[] = deployment.tokens.map((t) => ({ ...t, address: t.address as Address }))
const seedTokens = tokens.slice()
const byAddress: Record<string, SimToken> = Object.fromEntries(tokens.map((t) => [t.address.toLowerCase(), t]))
const STABLES = new Set(['mUSDC', 'mUSDT', 'mDAI'])
// hourly volatility and correlation with the market factor (ETH)
const VOL: Record<string, { sigma: number; beta: number }> = {
  WETH: { sigma: 0.0085, beta: 1 },
  mWBTC: { sigma: 0.007, beta: 0.7 },
  META: { sigma: 0.016, beta: 0.6 },
  mLINK: { sigma: 0.012, beta: 0.8 },
  mARB: { sigma: 0.013, beta: 0.8 },
}
const MEME_VOL = { sigma: 0.035, beta: 0.3 }
const usd: Record<string, number> = Object.fromEntries(tokens.map((t) => [t.symbol, t.seedPriceUsd]))

type V3Pool = { address: Address; token0: Address; token1: Address; fee: number; meme?: boolean }
const v3Pools: V3Pool[] = deployment.pools.v3.map((p) => ({ ...p, address: p.address as Address, token0: p.token0 as Address, token1: p.token1 as Address }))
const v2Pools = deployment.pools.v2

/** Advance the random walk by `hours` (fractional for live mode). */
function stepPrices(hours: number) {
  const scale = Math.sqrt(hours)
  const market = gauss()
  for (const t of tokens) {
    if (STABLES.has(t.symbol)) {
      // Ornstein–Uhlenbeck around $1, ±~0.1%
      const keep = Math.pow(0.7, hours)
      usd[t.symbol] = 1 + (usd[t.symbol] - 1) * keep + gauss() * 0.0004 * scale
      continue
    }
    const v = t.launched ? MEME_VOL : (VOL[t.symbol] ?? { sigma: 0.01, beta: 0.5 })
    const shock = v.beta * market + Math.sqrt(Math.max(0, 1 - v.beta * v.beta)) * gauss()
    // pull gently back toward the seed (or launch) price so prices stay within a believable band
    const meanRevert = -(t.launched ? 0.004 : 0.01) * hours * Math.log(usd[t.symbol] / t.seedPriceUsd)
    usd[t.symbol] *= Math.exp(v.sigma * scale * shock + meanRevert)
  }
}

// ---------- pool math ----------
/** raw token1-per-token0 price implied by the USD model */
function rawPrice(token0: Address, token1: Address): number {
  const t0 = byAddress[token0.toLowerCase()]
  const t1 = byAddress[token1.toLowerCase()]
  return (usd[t0.symbol] / usd[t1.symbol]) * 10 ** (t1.decimals - t0.decimals)
}
function toSqrtPriceX96(raw: number): bigint {
  return BigInt(Math.floor(Math.sqrt(raw) * 2 ** 48)) * 2n ** 48n
}

// ---------- tx helpers ----------
let sent = 0
let failed = 0
// Sends are serialized per account: a send starts only after the previous one from the same
// account has been accepted, so anvil never sees two in-flight txs competing for one nonce
// ("replacement transaction underpriced"). Anvil assigns the nonce, so an outside sender using
// the same account cannot desync a local counter.
const queues = new Map<string, Promise<unknown>>()
async function send(from: Address, to: Address, data: { abi: unknown; functionName: string; args: unknown[] }, value = 0n, gas = SWAP_GAS) {
  const key = from.toLowerCase()
  const run = async () => {
    const hash = await wallet.writeContract({
      account: from,
      address: to,
      abi: data.abi,
      functionName: data.functionName,
      args: data.args,
      value,
      gas,
      chain,
    } as never)
    sent++
    return hash as Hex
  }
  const p = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(run)
  queues.set(key, p)
  return p
}

// Anvil can hand back a tx hash a moment before its block is sealed, so poll for the receipt.
// (viem's waitForTransactionReceipt re-checks only when a *new* block arrives; with automine and
// nothing else being sent, that block never comes and it times out.)
async function waitMined(hash: Hex) {
  const deadline = Date.now() + 60_000
  for (;;) {
    const receipt = await pub.getTransactionReceipt({ hash }).catch(() => null)
    if (receipt) return receipt
    if (Date.now() > deadline) throw new Error(`tx ${hash} not mined within 60s`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

async function checkReceipts(hashes: Hex[]) {
  for (const hash of hashes) {
    const r = await waitMined(hash)
    if (r.status !== 'success') {
      failed++
      log(`tx reverted: ${hash}`)
    }
  }
}

/** Send and wait; returns the receipt (counts a revert as a failure). */
async function sendWait(from: Address, to: Address, data: { abi: unknown; functionName: string; args: unknown[] }, value = 0n, gas = SWAP_GAS) {
  const hash = await send(from, to, data, value, gas)
  const r = await waitMined(hash)
  if (r.status !== 'success') {
    failed++
    log(`tx reverted: ${data.functionName} ${hash}`)
  }
  return r
}

const balanceOf = (token: Address, who: Address) => pub.readContract({ address: token, abi: testErc20Abi, functionName: 'balanceOf', args: [who] }) as Promise<bigint>

const targetBalance = (tok: SimToken) =>
  tok.symbol === 'WETH' ? TRADER_WETH : BigInt(Math.round(TRADER_USD_PER_TOKEN / tok.seedPriceUsd)) * 10n ** BigInt(tok.decimals)

/**
 * Keep each trader stocked: approve SwapRouter02 once, and refill any token that has fallen below
 * a quarter of its working balance (ETH → WETH for WETH, open mint for test tokens). Run at start
 * and periodically, so a long replay can never stall on an empty inventory. Launched tokens can't
 * be minted; traders hold what they won in auctions (only the router approval is ensured).
 */
async function topUpTraders(router: Address, weth: Address) {
  const hashes: Hex[] = []
  for (const trader of TRADERS) {
    const ethBal = await pub.getBalance({ address: trader })
    if (ethBal < parseEther('100000')) await rpc('anvil_setBalance', [trader, '0x' + parseEther('1000000').toString(16)])
    for (const tok of tokens) {
      const [balance, allowance] = (await Promise.all([
        balanceOf(tok.address, trader),
        pub.readContract({ address: tok.address, abi: testErc20Abi, functionName: 'allowance', args: [trader, router] }),
      ])) as [bigint, bigint]
      if (!tok.launched) {
        const target = targetBalance(tok)
        if (balance < target / 4n) {
          const missing = target - balance
          hashes.push(
            tok.address.toLowerCase() === weth.toLowerCase()
              ? await send(trader, weth, { abi: weth9Abi, functionName: 'deposit', args: [] }, missing)
              : await send(trader, tok.address, { abi: testErc20Abi, functionName: 'mint', args: [trader, missing] }),
          )
        }
      }
      if (allowance < maxUint256 / 2n) {
        hashes.push(await send(trader, tok.address, { abi: testErc20Abi, functionName: 'approve', args: [router, maxUint256] }))
      }
    }
  }
  await checkReceipts(hashes)
}

let traderIx = 0
const nextTrader = () => TRADERS[traderIx++ % TRADERS.length]

/** For meme pools, the trader holding the most of `tokenIn` (traders' launch-token inventories come from auction claims). */
async function richestTrader(tokenIn: Address): Promise<{ trader: Address; balance: bigint }> {
  const bals = await Promise.all(TRADERS.map((t) => balanceOf(tokenIn, t)))
  let best = 0
  for (let i = 1; i < bals.length; i++) if (bals[i] > bals[best]) best = i
  return { trader: TRADERS[best], balance: bals[best] }
}

/** One market step: steer every pool to the model price, then add organic trades. */
async function marketStep(router: Address, organicMin: number, organicMax: number): Promise<Hex[]> {
  const hashes: Hex[] = []

  // V3: move each pool exactly to its target price
  const slots = await Promise.all(
    v3Pools.map((p) => pub.readContract({ address: p.address, abi: v3PoolAbi, functionName: 'slot0' }) as Promise<readonly [bigint, ...unknown[]]>),
  )
  for (let i = 0; i < v3Pools.length; i++) {
    const p = v3Pools[i]
    const current = slots[i][0]
    const target = toSqrtPriceX96(rawPrice(p.token0, p.token1))
    const diff = Number(target > current ? target - current : current - target) / Number(current)
    if (diff < 0.0001) continue
    const zeroForOne = target < current
    const tokenIn = zeroForOne ? p.token0 : p.token1
    // every trade pays its own sender so trader inventories stay balanced over a long replay;
    // meme pools trade from whoever holds the launch token (or the quote side)
    let trader = nextTrader()
    let amountIn = 10n ** 30n
    if (p.meme) {
      const r = await richestTrader(tokenIn)
      if (r.balance === 0n) continue
      trader = r.trader
      amountIn = r.balance
    }
    hashes.push(
      await send(trader, router, {
        abi: swapRouter02Abi,
        functionName: 'exactInputSingle',
        // amountIn is a ceiling: the price limit stops the swap at the target and only the
        // consumed amount is pulled from the trader
        args: [{ tokenIn, tokenOut: zeroForOne ? p.token1 : p.token0, fee: p.fee, recipient: trader, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: target }],
      }),
    )
  }

  // V2: closed-form trade to the target price (fee-adjusted)
  const reserves = await Promise.all(
    v2Pools.map((p) => pub.readContract({ address: p.address, abi: v2PairAbi, functionName: 'getReserves' }) as Promise<readonly [bigint, bigint, number]>),
  )
  for (let i = 0; i < v2Pools.length; i++) {
    const p = v2Pools[i]
    const r0 = Number(reserves[i][0])
    const r1 = Number(reserves[i][1])
    const target = rawPrice(p.token0 as Address, p.token1 as Address)
    const currentPrice = r1 / r0
    if (Math.abs(target / currentPrice - 1) < 0.0002) continue
    const k = r0 * r1
    const buyToken0 = target > currentPrice // token0 gets more expensive → pay token1 in
    const amountIn = buyToken0 ? (Math.sqrt(k * target) - r1) / 0.997 : (Math.sqrt(k / target) - r0) / 0.997
    if (!(amountIn > 0)) continue
    const trader = nextTrader()
    hashes.push(
      await send(trader, router, {
        abi: swapRouter02Abi,
        functionName: 'swapExactTokensForTokens',
        args: [BigInt(Math.floor(amountIn)), 0n, buyToken0 ? [p.token1, p.token0] : [p.token0, p.token1], trader],
      }),
    )
  }

  // organic flow: random-size, random-direction trades for volume
  const organic = organicMin + Math.floor(rand() * (organicMax - organicMin + 1))
  for (let n = 0; n < organic; n++) {
    const useV3 = rand() < 0.7
    const pool = useV3 ? pick(v3Pools) : pick(v2Pools)
    const zeroForOne = rand() < 0.5
    const tokenIn = byAddress[(zeroForOne ? pool.token0 : pool.token1).toLowerCase()]
    const tokenOut = (zeroForOne ? pool.token1 : pool.token0) as Address
    const meme = (pool as V3Pool).meme
    const sizeUsd = meme ? Math.exp(Math.log(50) + rand() * Math.log(100)) : Math.exp(Math.log(200) + rand() * Math.log(400)) // ~$200 … $80k, log-uniform
    let amountIn = BigInt(Math.floor((sizeUsd / usd[tokenIn.symbol]) * 10 ** tokenIn.decimals))
    let trader = nextTrader()
    if (meme) {
      const r = await richestTrader(tokenIn.address)
      trader = r.trader
      if (amountIn > r.balance / 20n) amountIn = r.balance / 20n
    }
    if (amountIn === 0n) continue
    hashes.push(
      useV3
        ? await send(trader, router, {
            abi: swapRouter02Abi,
            functionName: 'exactInputSingle',
            args: [{ tokenIn: tokenIn.address, tokenOut, fee: (pool as V3Pool).fee, recipient: trader, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
          })
        : await send(trader, router, {
            abi: swapRouter02Abi,
            functionName: 'swapExactTokensForTokens',
            args: [amountIn, 0n, [tokenIn.address, tokenOut], trader],
          }),
    )
  }
  return hashes
}

// ---------- Stage 5: launches ----------
interface LaunchPlan {
  name: string
  symbol: string
  pad: 'Launchpad' | 'DevnetPad'
  quote: 'mUSDC' | 'WETH'
  /** creation time: days from the start of the replay (history), or hours relative to "now" when `nowRel` */
  startDay?: number
  durationH?: number
  /** Active/Upcoming at "now": start/end relative to the replay end, in hours (created a few hours before the end) */
  nowStartH?: number
  nowEndH?: number
  outcome: 'graduate' | 'fail' | 'open'
  verified?: boolean
  floorUsd: number
  description: string
  website: string
}

const LAUNCHES: LaunchPlan[] = [
  { name: 'Pixel Pup', symbol: 'PUP', pad: 'Launchpad', quote: 'mUSDC', startDay: 1.5, durationH: 24, outcome: 'graduate', verified: true, floorUsd: 0.0012, description: 'A pixel-art pup that fetches liquidity.', website: 'https://pixelpup.example' },
  { name: 'Moon Mango', symbol: 'MANGO', pad: 'DevnetPad', quote: 'WETH', startDay: 4, durationH: 36, outcome: 'graduate', floorUsd: 0.0008, description: 'Tropical fruit, lunar ambitions.', website: 'https://moonmango.example' },
  { name: 'Orbit', symbol: 'ORB', pad: 'Launchpad', quote: 'mUSDC', startDay: 7, durationH: 24, outcome: 'graduate', verified: true, floorUsd: 0.002, description: 'Community token circling the MetaChain ecosystem.', website: 'https://orbit.example' },
  { name: 'Lumen', symbol: 'LUMEN', pad: 'DevnetPad', quote: 'mUSDC', startDay: 10, durationH: 48, outcome: 'fail', floorUsd: 0.003, description: 'Light-speed micro-payments (did not reach its threshold).', website: 'https://lumen.example' },
  { name: 'Quokka', symbol: 'QKA', pad: 'Launchpad', quote: 'WETH', startDay: 12.5, durationH: 24, outcome: 'graduate', floorUsd: 0.0015, description: 'The happiest token on the devnet.', website: 'https://quokka.example' },
  { name: 'Tidal', symbol: 'TIDE', pad: 'Launchpad', quote: 'mUSDC', startDay: 16, durationH: 30, outcome: 'graduate', verified: true, floorUsd: 0.0025, description: 'Rides the waves of on-chain volume.', website: 'https://tidal.example' },
  { name: 'Ember', symbol: 'EMBR', pad: 'DevnetPad', quote: 'mUSDC', startDay: 19, durationH: 24, outcome: 'fail', floorUsd: 0.004, description: 'A spark that never caught (refunded).', website: 'https://ember.example' },
  { name: 'Nimbus', symbol: 'NIMB', pad: 'Launchpad', quote: 'mUSDC', startDay: 22, durationH: 36, outcome: 'graduate', floorUsd: 0.0018, description: 'Cloud-native memes.', website: 'https://nimbus.example' },
  { name: 'Fizzy Fox', symbol: 'FIZZ', pad: 'DevnetPad', quote: 'WETH', startDay: 25.5, durationH: 24, outcome: 'graduate', floorUsd: 0.0009, description: 'Sparkling and sly.', website: 'https://fizzyfox.example' },
  // live at "now"
  { name: 'Comet Cat', symbol: 'COMET', pad: 'Launchpad', quote: 'mUSDC', nowStartH: -40, nowEndH: 18, outcome: 'open', verified: true, floorUsd: 0.0015, description: 'A cat with a tail of stardust.', website: 'https://cometcat.example' },
  { name: 'Velvet Vole', symbol: 'VELV', pad: 'DevnetPad', quote: 'WETH', nowStartH: -20, nowEndH: 72, outcome: 'open', floorUsd: 0.001, description: 'Soft paws, strong hands.', website: 'https://velvetvole.example' },
  { name: 'Saffron', symbol: 'SAFF', pad: 'Launchpad', quote: 'mUSDC', nowStartH: -10, nowEndH: 120, outcome: 'open', floorUsd: 0.002, description: 'A pinch of spice for your portfolio.', website: 'https://saffron.example' },
  { name: 'Glimmer', symbol: 'GLIM', pad: 'Launchpad', quote: 'mUSDC', nowStartH: 24, nowEndH: 96, outcome: 'open', floorUsd: 0.0012, description: 'Starting soon: a glimmer of hope.', website: 'https://glimmer.example' },
  { name: 'Basalt', symbol: 'BSLT', pad: 'DevnetPad', quote: 'WETH', nowStartH: 48, nowEndH: 120, outcome: 'open', floorUsd: 0.0014, description: 'Starting soon: rock-solid fundamentals.', website: 'https://basalt.example' },
]

const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n
const AUCTION_BPS = 2000n
const SUPPLY_SOLD = 200_000_000 // whole tokens sold in each auction

interface LiveLaunch {
  plan?: LaunchPlan
  auction: Address
  token: Address
  quote: Address
  quoteDecimals: number
  quoteSymbol: string
  floor: bigint
  tick: bigint
  startTime: number
  endTime: number
  /** remaining demand budget to place (USD) during the window */
  demandUsd: number
  settled: boolean
  approved: Set<string>
}
const live: LiveLaunch[] = []

const quoteInfo = (sym: 'mUSDC' | 'WETH') => {
  const t = seedTokens.find((x) => x.symbol === sym)!
  return { address: t.address, decimals: t.decimals }
}

/** price units: whole quote per whole token × 1e18; the tick is a tenth of the floor */
function floorAndTick(floorUsd: number, quote: 'mUSDC' | 'WETH') {
  const quotePerToken = floorUsd / usd[quote]
  const tick = BigInt(Math.max(1, Math.round((quotePerToken / 10) * 1e18)))
  return { floor: tick * 10n, tick }
}

async function createLaunch(plan: LaunchPlan, now: number): Promise<LiveLaunch | null> {
  const pad = deployment.contracts[plan.pad]
  if (!pad) return null
  const q = quoteInfo(plan.quote)
  const { floor, tick } = floorAndTick(plan.floorUsd, plan.quote)
  const start = plan.nowStartH !== undefined ? replayEnd + plan.nowStartH * 3600 : now
  const end = plan.nowEndH !== undefined ? replayEnd + plan.nowEndH * 3600 : now + (plan.durationH ?? 24) * 3600
  const supplyCostUsd = plan.floorUsd * SUPPLY_SOLD
  // graduates: threshold well under demand; fails: threshold far above what bidders commit
  const thresholdUsd = plan.outcome === 'fail' ? supplyCostUsd * 2.5 : supplyCostUsd * 0.5
  const threshold = BigInt(Math.round((thresholdUsd / usd[plan.quote]) * 10 ** q.decimals))
  const creator = pick(CREATORS)
  const r = await sendWait(
    creator,
    pad,
    {
      abi: launchpadAbi,
      functionName: 'createLaunch',
      args: [
        {
          name: plan.name,
          symbol: plan.symbol,
          totalSupply: TOTAL_SUPPLY,
          auctionSupplyBps: AUCTION_BPS,
          quoteToken: q.address,
          floorPrice: floor,
          tickSize: tick,
          startTime: BigInt(start),
          endTime: BigInt(end),
          launchThreshold: threshold,
          liquidityBps: 5000n,
          poolFee: 10000,
          description: plan.description,
          website: plan.website,
        },
      ],
    },
    0n,
    DEPLOY_GAS,
  )
  if (r.status !== 'success') return null
  let auction: Address | null = null
  let token: Address | null = null
  for (const l of r.logs) {
    try {
      const ev = decodeEventLog({ abi: launchpadAbi, data: l.data, topics: l.topics })
      if (ev.eventName === 'LaunchCreated') {
        auction = ev.args.auction
        token = ev.args.token
      }
    } catch {}
  }
  if (!auction || !token) return null
  if (plan.verified) await sendWait(OWNER, pad, { abi: launchpadAbi, functionName: 'setVerified', args: [auction, true] })
  // graduates: ~1.5–2.2× the floor cost of the supply; failures: a fraction of the threshold;
  // live auctions: partial demand so far, more arrives in live mode
  const demandUsd =
    plan.outcome === 'graduate' ? supplyCostUsd * (1.5 + rand() * 0.7) : plan.outcome === 'fail' ? thresholdUsd * 0.35 : supplyCostUsd * (0.4 + rand() * 0.5)
  const l: LiveLaunch = { plan, auction, token, quote: q.address, quoteDecimals: q.decimals, quoteSymbol: plan.quote, floor, tick, startTime: start, endTime: end, demandUsd, settled: false, approved: new Set() }
  live.push(l)
  log(`launch ${plan.symbol} on ${plan.pad}: auction ${auction} (${plan.outcome})`)
  return l
}

/** Place 0–3 bids on an active auction at time `now`; `fraction` = share of the remaining budget to place. */
async function placeBids(l: LiveLaunch, now: number, fraction: number, small = false) {
  if (now < l.startTime || now >= l.endTime) return
  const bids = small ? (rand() < 0.5 ? 1 : 0) : 1 + Math.floor(rand() * 3)
  for (let i = 0; i < bids; i++) {
    const budget = small ? 200 + rand() * 4800 : (l.demandUsd * fraction) / bids
    if (budget < 1) continue
    if (!small) l.demandUsd -= budget
    // traders bid big; #15–#19 and the demo wallet bid smaller amounts
    const r = rand()
    const bidder = r < 0.6 ? pick(TRADERS) : r < 0.85 ? pick(EXTRA_BIDDERS) : DEMO
    const usdAmount = bidder === DEMO ? Math.min(budget, 2_000 + rand() * 3_000) : budget
    const amount = BigInt(Math.max(1, Math.round((usdAmount / usd[l.quoteSymbol]) * 10 ** l.quoteDecimals)))
    // max price: floor … ~2.5× floor, skewed low, on the tick grid
    const k = 10n + BigInt(Math.floor(15 * rand() * rand()))
    const maxPrice = l.tick * k
    // automine gives each tx its own block, 1 s apart, so a step that starts just before endTime
    // can cross it; the auction then rejects bids (AuctionNotActive). Leave room for the approve/
    // deposit txs plus the bid itself.
    if (Number((await pub.getBlock()).timestamp) + 4 >= l.endTime) return
    if (l.quoteSymbol === 'WETH' && rand() < 0.6) {
      await sendWait(bidder, l.auction, { abi: auctionAbi, functionName: 'bidETH', args: [maxPrice] }, amount)
      continue
    }
    if (l.quoteSymbol === 'WETH') {
      await sendWait(bidder, l.quote, { abi: weth9Abi, functionName: 'deposit', args: [] }, amount)
    } else if ((await balanceOf(l.quote, bidder)) < amount) {
      await sendWait(bidder, l.quote, { abi: testErc20Abi, functionName: 'mint', args: [bidder, amount * 2n] })
    }
    if (!l.approved.has(bidder)) {
      await sendWait(bidder, l.quote, { abi: testErc20Abi, functionName: 'approve', args: [l.auction, maxUint256] })
      l.approved.add(bidder)
    }
    await sendWait(bidder, l.auction, { abi: auctionAbi, functionName: 'bid', args: [amount, maxPrice] })
  }
}

/** After endTime: settle, claim every bid (claim pays the bidder), and add a graduated pool to the steered set. */
async function settleAndClaim(l: LiveLaunch, router: Address) {
  const status = AUCTION_STATUS[Number(await pub.readContract({ address: l.auction, abi: auctionAbi, functionName: 'status' }))]
  if (status === 'ended') await sendWait(pick(TRADERS), l.auction, { abi: auctionAbi, functionName: 'settle', args: [] }, 0n, DEPLOY_GAS)
  const after = AUCTION_STATUS[Number(await pub.readContract({ address: l.auction, abi: auctionAbi, functionName: 'status' }))]
  if (after !== 'launched' && after !== 'failed') return
  l.settled = true
  const bidders = [...new Set([...TRADERS, ...EXTRA_BIDDERS, DEMO])]
  for (const b of bidders) {
    const bids = (await pub.readContract({ address: l.auction, abi: auctionAbi, functionName: 'bidsOf', args: [b] })) as readonly { id: bigint; claimed: boolean }[]
    for (const bid of bids) if (!bid.claimed) await sendWait(b, l.auction, { abi: auctionAbi, functionName: 'claim', args: [bid.id] }, 0n, 2_000_000n)
  }
  log(`${l.plan?.symbol ?? l.auction} ${after}`)
  if (after === 'launched') await registerLaunchedPool(l, router)
}

async function registerLaunchedPool(l: LiveLaunch, router: Address) {
  const pool = (await pub.readContract({ address: l.auction, abi: auctionAbi, functionName: 'pool' })) as Address
  const [p] = (await Promise.all([pub.readContract({ address: l.auction, abi: auctionAbi, functionName: 'params' })])) as [{ symbol: string; name: string; poolFee: number }]
  if (byAddress[l.token.toLowerCase()]) return
  const tok: SimToken = { symbol: p.symbol, name: p.name, decimals: 18, address: l.token, seedPriceUsd: 0, launched: true }
  const [token0, token1] = l.token.toLowerCase() < l.quote.toLowerCase() ? [l.token, l.quote] : [l.quote, l.token]
  tokens.push(tok)
  byAddress[l.token.toLowerCase()] = tok
  // start the walk from the pool's own price (the clearing price), with a random long-run drift
  const slot = (await pub.readContract({ address: pool, abi: v3PoolAbi, functionName: 'slot0' })) as readonly [bigint, ...unknown[]]
  const raw = (Number(slot[0]) / 2 ** 96) ** 2 // token1 per token0, raw (both 18 decimals for WETH; mUSDC 6)
  const q = byAddress[l.quote.toLowerCase()]
  const human = raw * 10 ** (18 - q.decimals) // when token is token0: quote(human) per token
  const quotePerToken = token0 === l.token ? raw * 10 ** (18 - q.decimals) : 1 / (raw * 10 ** (q.decimals - 18))
  void human
  usd[tok.symbol] = quotePerToken * usd[q.symbol]
  tok.seedPriceUsd = usd[tok.symbol] * Math.exp(gauss() * 0.6)
  v3Pools.push({ address: pool, token0, token1, fee: p.poolFee, meme: true })
  // traders need the router approval to sell their claimed tokens
  for (const t of TRADERS) await sendWait(t, l.token, { abi: testErc20Abi, functionName: 'approve', args: [router, maxUint256] })
}

/** Re-discover launches on chain (live mode / restarts): every auction of both launchpads. */
async function discoverLaunches(router: Address) {
  for (const key of ['Launchpad', 'DevnetPad'] as const) {
    const pad = deployment.contracts[key]
    if (!pad) continue
    const auctions = (await pub.readContract({ address: pad, abi: launchpadAbi, functionName: 'allLaunches' })) as Address[]
    for (const auction of auctions) {
      if (live.some((l) => l.auction.toLowerCase() === auction.toLowerCase())) continue
      const [p, token, status] = (await Promise.all([
        pub.readContract({ address: auction, abi: auctionAbi, functionName: 'params' }),
        pub.readContract({ address: auction, abi: auctionAbi, functionName: 'token' }),
        pub.readContract({ address: auction, abi: auctionAbi, functionName: 'status' }),
      ])) as [{ quoteToken: Address; floorPrice: bigint; tickSize: bigint; startTime: bigint; endTime: bigint; symbol: string }, Address, number]
      const q = byAddress[p.quoteToken.toLowerCase()]
      const l: LiveLaunch = {
        auction,
        token,
        quote: p.quoteToken,
        quoteDecimals: q?.decimals ?? 18,
        quoteSymbol: q?.symbol ?? 'mUSDC',
        floor: p.floorPrice,
        tick: p.tickSize,
        startTime: Number(p.startTime),
        endTime: Number(p.endTime),
        demandUsd: 0,
        settled: status >= 3,
        approved: new Set(),
      }
      live.push(l)
      if (AUCTION_STATUS[status] === 'launched') await registerLaunchedPool(l, router)
    }
  }
}

// ---------- Stage 5: earn ----------
async function earnDeposit(who: Address, vault: Vault, usdAmount: number, weth: Address) {
  const asset = byAddress[vault.asset.toLowerCase()]
  const amount = BigInt(Math.round((usdAmount / usd[asset.symbol]) * 10 ** asset.decimals))
  if (vault.asset.toLowerCase() === weth.toLowerCase()) {
    await sendWait(who, vault.address, { abi: vaultAbi, functionName: 'depositETH', args: [who] }, amount)
    return
  }
  if ((await balanceOf(asset.address, who)) < amount) await sendWait(who, asset.address, { abi: testErc20Abi, functionName: 'mint', args: [who, amount] })
  await sendWait(who, asset.address, { abi: testErc20Abi, functionName: 'approve', args: [vault.address, maxUint256] })
  await sendWait(who, vault.address, { abi: vaultAbi, functionName: 'deposit', args: [amount, who] })
}

async function earnWithdrawPart(who: Address, vault: Vault, share: number) {
  const max = (await pub.readContract({ address: vault.address, abi: vaultAbi, functionName: 'maxWithdraw', args: [who] })) as bigint
  const amount = (max * BigInt(Math.round(share * 1000))) / 1000n
  if (amount > 0n) await sendWait(who, vault.address, { abi: vaultAbi, functionName: 'withdraw', args: [amount, who, who] })
}

/** Earn schedule over the replay (day → deposits/withdrawals). */
async function earnActivity(day: number, weth: Address) {
  const vaults = deployment.vaults ?? []
  if (!vaults.length) return
  const v = (sym: string) => vaults.find((x) => x.symbol === sym)!
  if (day === 1) {
    for (const [i, t] of TRADERS.entries()) {
      await earnDeposit(t, v('meUSDC'), 1_500_000 + i * 400_000, weth)
      await earnDeposit(t, v('meUSDT'), 1_000_000 + i * 300_000, weth)
      await earnDeposit(t, v('meETH'), 600_000 + i * 150_000, weth)
    }
    await earnDeposit(DEMO, v('meUSDC'), 25_000, weth)
    await earnDeposit(DEMO, v('meETH'), 15_000, weth)
  } else if (day === 9) {
    await earnDeposit(DEMO, v('meUSDT'), 12_000, weth)
    await earnDeposit(TRADERS[1], v('meUSDC'), 2_000_000, weth)
  } else if (day === 15) {
    await earnWithdrawPart(TRADERS[2], v('meUSDC'), 0.4)
    await earnDeposit(TRADERS[3], v('meETH'), 900_000, weth)
  } else if (day === 21) {
    await earnWithdrawPart(DEMO, v('meUSDC'), 0.2)
    await earnDeposit(TRADERS[4], v('meUSDT'), 1_200_000, weth)
  }
}

// ---------- modes ----------
let replayEnd = 0

async function runHistory(router: Address, weth: Address) {
  if (HISTORY_DAYS <= 0) return
  const head = await pub.getBlock()
  let t = Number(head.timestamp) + 60
  const t0 = t
  const end = Math.floor(Date.now() / 1000) - 120
  replayEnd = end
  if (end - t < STEP_SECONDS) {
    log(`chain clock is already near now (${new Date(Number(head.timestamp) * 1000).toISOString()}); nothing to replay`)
    return
  }
  const steps = Math.floor((end - t) / STEP_SECONDS)
  log(`replaying ${steps} steps of ${STEP_SECONDS}s from ${new Date(t * 1000).toISOString()}`)

  // manual mining while we rewrite the clock
  await rpc('evm_setIntervalMining', [0])
  await rpc('evm_setAutomine', [true])
  await topUpTraders(router, weth)
  for (const b of [...EXTRA_BIDDERS, DEMO]) {
    const bal = await pub.getBalance({ address: b })
    if (bal < parseEther('1000')) await rpc('anvil_setBalance', [b, '0x' + parseEther('10000').toString(16)])
  }
  const hasStage5 = Boolean(deployment.contracts.Launchpad && deployment.contracts.DevnetPad)
  if (!hasStage5) log('no launchpads in the deployment: skipping launches and earn')
  const lastDay = -1
  let doneDay = lastDay

  for (let step = 0; step < steps; step++, t += STEP_SECONDS) {
    stepPrices(STEP_SECONDS / 3600)
    await rpc('evm_setNextBlockTimestamp', [t])
    if (step > 0 && step % 24 === 0) await topUpTraders(router, weth)
    const hashes = await marketStep(router, 2, 6)
    // receipts: every step for the first day, then sampled daily, to keep the replay fast. The
    // last tx of each step is always awaited so the next step reads settled pool state and its
    // timestamp override lands after this step's blocks.
    if (step < 24 || step % 24 === 0) await checkReceipts(hashes)
    else if (hashes.length) await waitMined(hashes[hashes.length - 1])

    if (hasStage5) {
      const day = Math.floor((t - t0) / 86400)
      if (day !== doneDay) {
        doneDay = day
        await earnActivity(day, weth)
      }
      const blockTs = Number((await pub.getBlock()).timestamp)
      for (const plan of LAUNCHES) {
        if (live.some((l) => l.plan === plan)) continue
        const createAt = plan.startDay !== undefined ? t0 + plan.startDay * 86400 : end + Math.min(plan.nowStartH ?? 0, 0) * 3600 - 6 * 3600
        if (t >= createAt) await createLaunch(plan, blockTs)
      }
      for (const l of live) {
        if (l.settled) continue
        const ts = Number((await pub.getBlock()).timestamp)
        if (ts >= l.endTime) {
          await settleAndClaim(l, router)
          continue
        }
        // spread the budget over the window: each hour places ~1/(hours left) of what remains
        const hoursLeft = Math.max(1, (l.endTime - ts) / 3600)
        if (l.plan?.outcome === 'open' && l.endTime > end) await placeBids(l, ts, 1 / Math.max(hoursLeft, 1) / 1.5)
        else await placeBids(l, ts, Math.min(1, 1.2 / hoursLeft))
      }
    }
    if (step % 48 === 0 || step === steps - 1) {
      log(
        `${new Date(t * 1000).toISOString().slice(0, 16)}  ETH $${usd.WETH.toFixed(0)}  BTC $${usd.mWBTC.toFixed(0)}  META $${usd.META.toFixed(2)}  memes ${tokens.filter((x) => x.launched).length}  txs ${sent} (failed ${failed})`,
      )
    }
  }

  // hand the clock back to real time and resume 1s interval mining
  await rpc('evm_setNextBlockTimestamp', [Math.floor(Date.now() / 1000)])
  await rpc('evm_mine')
  await rpc('evm_setAutomine', [false])
  await rpc('evm_setIntervalMining', [1])
  log(`done: ${sent} transactions, ${failed} failed (sampled receipts); ${live.length} launches`)
  if (failed > 0) process.exitCode = 1
}

/**
 * Start the live walk from the prices the pools hold right now, so nothing jumps. Read on-chain
 * rather than from the API: the indexer may still be backfilling and would report stale prices.
 * ETH comes from the deepest WETH/stable V3 pool; every other token from its V3 pool against WETH
 * (or a stable); stablecoins keep $1. Launched tokens are priced from their own pools.
 */
async function loadCurrentPrices() {
  const weth = seedTokens.find((t) => t.symbol === 'WETH')!
  const pools = v3Pools
  const slots = await Promise.all(
    pools.map((p) => pub.readContract({ address: p.address, abi: v3PoolAbi, functionName: 'slot0' }) as Promise<readonly [bigint, ...unknown[]]>),
  )
  /** human price of `base` in units of `quote` from pool i */
  const priceIn = (i: number, base: string, quote: string) => {
    const p = pools[i]
    const t0 = byAddress[p.token0.toLowerCase()]
    const t1 = byAddress[p.token1.toLowerCase()]
    const raw = (Number(slots[i][0]) / 2 ** 96) ** 2 // token1 per token0, raw units
    const p01 = raw * 10 ** (t0.decimals - t1.decimals) // human token1 per token0
    if (t0.symbol === base && t1.symbol === quote) return p01
    if (t1.symbol === base && t0.symbol === quote) return 1 / p01
    return null
  }
  const find = (base: string, quotes: string[]) => {
    for (const quote of quotes)
      for (let i = 0; i < pools.length; i++) {
        const v = priceIn(i, base, quote)
        if (v) return { v, quote }
      }
    return null
  }
  const eth = find('WETH', ['mUSDC', 'mUSDT', 'mDAI'])
  if (eth) usd.WETH = eth.v
  for (const t of tokens) {
    if (t.symbol === 'WETH' || STABLES.has(t.symbol)) continue
    const hit = find(t.symbol, [weth.symbol, 'mUSDC', 'mUSDT', 'mDAI'])
    if (hit) usd[t.symbol] = hit.quote === weth.symbol ? hit.v * usd.WETH : hit.v
    if (t.launched) t.seedPriceUsd = usd[t.symbol]
  }
}

async function runLive(router: Address, weth: Address) {
  await loadCurrentPrices()
  if (deployment.contracts.Launchpad) await discoverLaunches(router).catch((e) => log(`launch discovery failed: ${(e as Error).message.split('\n')[0]}`))
  await topUpTraders(router, weth)
  await loadCurrentPrices()
  log(`trading every ${LIVE_INTERVAL_SECONDS}s from ETH $${usd.WETH.toFixed(2)}; ${live.length} launches tracked — Ctrl+C to stop`)
  let last = Date.now()
  for (let step = 1; ; step++) {
    await new Promise((r) => setTimeout(r, LIVE_INTERVAL_SECONDS * 1000))
    const now = Date.now()
    stepPrices((now - last) / 3_600_000)
    last = now
    try {
      if (step % 30 === 0) await topUpTraders(router, weth)
      const hashes = await marketStep(router, 0, 2)
      await checkReceipts(hashes)
      const ts = Number((await pub.getBlock()).timestamp)
      if (step % 15 === 0 && deployment.contracts.Launchpad) await discoverLaunches(router)
      for (const l of live) {
        if (l.settled) continue
        if (ts >= l.endTime) await settleAndClaim(l, router)
        else await placeBids(l, ts, 0, true)
      }
    } catch (err) {
      // the chain may be restarting; keep going
      log(`step skipped: ${(err as Error).message.split('\n')[0]}`)
    }
    if (step % 30 === 0) log(`ETH $${usd.WETH.toFixed(2)}  txs ${sent} (failed ${failed})`)
  }
}

async function main() {
  const router = contractAddress('SwapRouter02')
  const weth = contractAddress('WETH9')
  if (MODE === 'live') await runLive(router, weth)
  else await runHistory(router, weth)
}

main().catch((err) => {
  log(`failed: ${err}`)
  process.exit(1)
})
