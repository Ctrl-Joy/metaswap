// MetaSwap devnet market simulator.
//
//   npx tsx scripts/market.ts --history   replay HISTORY_DAYS of hourly trading up to "now" (run once,
//                                          right after Seed, on a chain whose genesis timestamp was set
//                                          HISTORY_DAYS in the past via anvil --timestamp)
//   npx tsx scripts/market.ts --normalize give the Dev wallet accounts #0–#5 realistic personal portfolios on an
//                                          existing chain (also done by --history; idempotent)
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
// also come from #15–#18. #19 is the demo wallet (GET /accounts/demo): a small (~$2–5k) realistic
// portfolio built during the replay — a few tokens, one V3 position, an Earn deposit and one launch
// bid — that keeps acting every 1–3 minutes in live mode. The Dev wallet accounts #0–#5 hand Seed's
// protocol liquidity and inventory to the treasury (#8) and get $2k–$30k personal portfolios with a
// little activity (normalizeDevWallets). #0 also signs launchpad owner calls; the filler (#9) is never
// touched. Local devnet only.
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
  nonfungiblePositionManagerAbi,
  swapRouter02Abi,
  testErc20Abi,
  v2PairAbi,
  v3PoolAbi,
  weth9Abi,
  type Deployment,
} from '../packages/sdk/src/index'

const MODE = process.argv.includes('--live') ? 'live' : process.argv.includes('--normalize') ? 'normalize' : 'history'
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
const DEMO: Address = '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199' // #19 demo wallet (services/api DEMO_ADDRESS)
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

/** Plain ETH transfer (same per-account queue as send). */
async function sendValue(from: Address, to: Address, value: bigint) {
  const key = from.toLowerCase()
  const run = async () => {
    const hash = await wallet.sendTransaction({ account: from, to, value, chain } as never)
    sent++
    return hash as Hex
  }
  const p = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(run)
  queues.set(key, p)
  return waitMined(await p)
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
    // traders bid big; #15–#18 bid too (the demo wallet places its own single bid)
    const bidder = rand() < 0.65 ? pick(TRADERS) : pick(EXTRA_BIDDERS)
    const usdAmount = budget
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
  } else if (day === 9) {
    await earnDeposit(TRADERS[1], v('meUSDC'), 2_000_000, weth)
  } else if (day === 15) {
    await earnWithdrawPart(TRADERS[2], v('meUSDC'), 0.4)
    await earnDeposit(TRADERS[3], v('meETH'), 900_000, weth)
  } else if (day === 21) {
    await earnDeposit(TRADERS[4], v('meUSDT'), 1_200_000, weth)
  }
}

// ---------- personal wallets: demo (#19) and the Dev wallet accounts (#0–#5) ----------
// The demo holds a believable small portfolio: ETH, WETH, mUSDC, META, mARB, a WETH/mUSDC V3
// position, a meUSDC deposit and one bid on the MANGO launch (claimed when it settles). Everything
// it holds comes from its own on-chain actions after an initial balance, so the API's
// event-sourced history is exact.
//
// Seed mints protocol-scale inventory to #0–#5 and gives #0 all V2 LP and full-range V3
// positions. normalizeDevWallets() hands all of that to the treasury (#8), so pools and charts are
// unchanged, and gives each Dev wallet account a small personal portfolio ($2k–$30k) funded by
// treasury transfers at the current price.
const DEMO_START_ETH = parseEther('1.3')
const TREASURY: Address = '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f' // #8: protocol liquidity + inventory
const DEV_ACCOUNTS: Address[] = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // #0
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // #1
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // #2
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906', // #3
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', // #4
  '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', // #5
]
interface Starter {
  eth: number
  /** USD worth of each token, transferred from the treasury */
  tokens: Record<string, number>
  /** a small concentrated V3 position: [tokenA, tokenB, USD per side] */
  position?: [string, string, number]
  /** an Earn deposit: [vault symbol, USD] */
  earn?: [string, number]
}
const STARTERS: Starter[] = [
  { eth: 3.2, tokens: { mUSDC: 4_000, META: 1_800, mWBTC: 2_500 }, position: ['WETH', 'mUSDC', 350] }, // #0 ≈ $17k
  { eth: 1.4, tokens: { mUSDT: 1_200, mLINK: 600 }, earn: ['meUSDC', 900] }, // #1 ≈ $6.5k
  { eth: 6.5, tokens: { mUSDC: 2_200, mDAI: 1_500, mARB: 900 }, position: ['META', 'WETH', 250] }, // #2 ≈ $23k
  { eth: 0.9, tokens: { mUSDC: 650, META: 300 } }, // #3 ≈ $3.4k
  { eth: 2.4, tokens: { mUSDC: 3_000, mUSDT: 800, mWBTC: 1_200 }, earn: ['meETH', 1_500] }, // #4 ≈ $13k
  { eth: 1.1, tokens: { mDAI: 400 } }, // #5
]

const demoRand = (() => {
  let x = Number(process.env.DEMO_SEED ?? (MODE === 'live' ? Date.now() % 2 ** 31 : 7))
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 1 | x) + 0x6d2b79f5) | 0
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
})()
const demo = { ready: false, bidPlaced: false }
/** V3 position per personal account (fee claims) */
const personalPositions = new Map<string, bigint>()
const approvedPairs = new Set<string>()

const sym = (s: string) => tokens.find((t) => t.symbol === s)!
const demoPool = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()]
  return v3Pools.filter((p) => !p.meme && ((p.token0.toLowerCase() === x && p.token1.toLowerCase() === y) || (p.token0.toLowerCase() === y && p.token1.toLowerCase() === x))).sort((p, q) => q.fee - p.fee)[0]
}
const toRaw = (symbol: string, usdAmount: number) => BigInt(Math.floor((usdAmount / usd[symbol]) * 10 ** sym(symbol).decimals))

async function approveOnce(who: Address, token: Address, spender: Address) {
  const k = `${who}:${token}:${spender}`.toLowerCase()
  if (approvedPairs.has(k)) return
  const allowance = (await pub.readContract({ address: token, abi: testErc20Abi, functionName: 'allowance', args: [who, spender] })) as bigint
  if (allowance < maxUint256 / 2n) await sendWait(who, token, { abi: testErc20Abi, functionName: 'approve', args: [spender, maxUint256] })
  approvedPairs.add(k)
}

/** Wrap ETH so `who` holds at least `amount` WETH. */
async function wrapTo(who: Address, weth: Address, amount: bigint) {
  const bal = await balanceOf(weth, who)
  if (bal < amount) await sendWait(who, weth, { abi: weth9Abi, functionName: 'deposit', args: [] }, amount - bal)
}

/** Swap `usdAmount` of one token for another through their V3 pool. */
async function personalSwap(who: Address, router: Address, from: string, to: string, usdAmount: number) {
  const a = sym(from)
  const b = sym(to)
  const pool = demoPool(a.address, b.address)
  if (!pool) return false
  const amountIn = toRaw(from, usdAmount)
  if (amountIn === 0n || (await balanceOf(a.address, who)) < amountIn) return false
  await approveOnce(who, a.address, router)
  await sendWait(who, router, {
    abi: swapRouter02Abi,
    functionName: 'exactInputSingle',
    args: [{ tokenIn: a.address, tokenOut: b.address, fee: pool.fee, recipient: who, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
  })
  return true
}

/** Mint a concentrated (about ±20%) V3 position from `who`'s own tokens. */
async function mintPosition(who: Address, symA: string, symB: string, usdEach: number) {
  const npm = deployment.contracts.NonfungiblePositionManager as Address | undefined
  const pool = demoPool(sym(symA).address, sym(symB).address)
  if (!npm || !pool) return
  const slot = (await pub.readContract({ address: pool.address, abi: v3PoolAbi, functionName: 'slot0' })) as readonly [bigint, number, ...unknown[]]
  const spacing = pool.fee === 500 ? 10 : pool.fee === 3000 ? 60 : pool.fee === 100 ? 1 : 200
  const tick = Number(slot[1])
  const lower = Math.floor((tick - 1800) / spacing) * spacing
  const upper = Math.ceil((tick + 1800) / spacing) * spacing
  const aIs0 = pool.token0.toLowerCase() === sym(symA).address.toLowerCase()
  const amtA = toRaw(symA, usdEach)
  const amtB = toRaw(symB, usdEach)
  await approveOnce(who, sym(symA).address, npm)
  await approveOnce(who, sym(symB).address, npm)
  const r = await sendWait(
    who,
    npm,
    {
      abi: nonfungiblePositionManagerAbi,
      functionName: 'mint',
      args: [
        {
          token0: pool.token0,
          token1: pool.token1,
          fee: pool.fee,
          tickLower: lower,
          tickUpper: upper,
          amount0Desired: aIs0 ? amtA : amtB,
          amount1Desired: aIs0 ? amtB : amtA,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: who,
          deadline: 2n ** 40n,
        },
      ],
    },
    0n,
    DEPLOY_GAS,
  )
  for (const l of r.logs) {
    try {
      const ev = decodeEventLog({ abi: nonfungiblePositionManagerAbi, data: l.data, topics: l.topics })
      if (ev.eventName === 'IncreaseLiquidity') personalPositions.set(who.toLowerCase(), (ev.args as { tokenId: bigint }).tokenId)
    } catch {}
  }
}

async function demoSetup(router: Address, weth: Address) {
  const bal = await pub.getBalance({ address: DEMO })
  // a fresh chain gives every dev account 10,000 ETH; the demo starts with a small, realistic stack
  if (bal > parseEther('100')) await rpc('anvil_setBalance', [DEMO, '0x' + DEMO_START_ETH.toString(16)])
  await wrapTo(DEMO, weth, toRaw('WETH', 1_750))
  await personalSwap(DEMO, router, 'WETH', 'mUSDC', 950)
  await personalSwap(DEMO, router, 'WETH', 'META', 300)
  await personalSwap(DEMO, router, 'WETH', 'mARB', 200)
  await mintPosition(DEMO, 'WETH', 'mUSDC', 160)
  demo.ready = true
  log('demo wallet ready')
}

/** The demo's single launch bid (MANGO, a WETH auction that graduates). */
async function demoBid(now: number) {
  if (demo.bidPlaced) return
  const l = live.find((x) => x.plan?.symbol === 'MANGO')
  if (!l || now < l.startTime || Number((await pub.getBlock()).timestamp) + 4 >= l.endTime) return
  demo.bidPlaced = true
  const amount = toRaw('WETH', 140)
  await sendWait(DEMO, l.auction, { abi: auctionAbi, functionName: 'bidETH', args: [l.tick * 14n] }, amount)
}

/** Deposit into (or withdraw part of) an Earn vault. */
async function personalEarn(who: Address, deposit: boolean, usdAmount: number, vaultSymbol = 'meUSDC') {
  const vault = (deployment.vaults ?? []).find((v) => v.symbol === vaultSymbol)
  if (!vault) return false
  if (!deposit) {
    await earnWithdrawPart(who, vault, 0.05 + demoRand() * 0.1)
    return true
  }
  const asset = byAddress[vault.asset.toLowerCase()]
  const amount = toRaw(asset.symbol, usdAmount)
  if (asset.symbol === 'WETH') {
    // the ETH vault takes native ETH
    if ((await pub.getBalance({ address: who })) < amount) return false
    await sendWait(who, vault.address, { abi: vaultAbi, functionName: 'depositETH', args: [who] }, amount)
    return true
  }
  if ((await balanceOf(vault.asset, who)) < amount) return false
  await approveOnce(who, vault.asset, vault.address)
  await sendWait(who, vault.address, { abi: vaultAbi, functionName: 'deposit', args: [amount, who] })
  return true
}

/** Collect the account's V3 position fees ("claim"). */
async function personalCollect(who: Address) {
  const npm = deployment.contracts.NonfungiblePositionManager as Address | undefined
  const tokenId = personalPositions.get(who.toLowerCase())
  if (!npm || tokenId === undefined) return false
  const max = 2n ** 128n - 1n
  await sendWait(who, npm, { abi: nonfungiblePositionManagerAbi, functionName: 'collect', args: [{ tokenId, recipient: who, amount0Max: max, amount1Max: max }] })
  return true
}

/** One small action: a trade, an Earn deposit/withdrawal, or a fee claim ($5–60). */
async function personalAct(who: Address, router: Address, weth: Address) {
  const size = 5 + demoRand() * 55
  const r = demoRand()
  let done = false
  if (r < 0.2) {
    await wrapTo(who, weth, toRaw('WETH', size))
    done = await personalSwap(who, router, 'WETH', pick(['mUSDC', 'META', 'mARB']), size)
  } else if (r < 0.5) done = await personalSwap(who, router, pick(['mUSDC', 'META', 'mARB']), 'WETH', size)
  else if (r < 0.65) done = await personalSwap(who, router, 'WETH', pick(['mUSDC', 'META', 'mARB']), size)
  else if (r < 0.8) done = await personalEarn(who, true, size)
  else if (r < 0.9) done = await personalEarn(who, false, 0)
  else done = await personalCollect(who)
  // fall back to a wrap + plain trade so every slot produces visible activity
  if (!done) {
    await wrapTo(who, weth, toRaw('WETH', size))
    await personalSwap(who, router, 'WETH', 'mUSDC', size)
  }
  return size
}

async function demoAct(router: Address, weth: Address) {
  if (!demo.ready) return
  const size = await personalAct(DEMO, router, weth)
  if (MODE === 'live') log(`demo wallet acted ($${size.toFixed(0)})`)
}

/** Live mode / restarts: find the personal accounts' V3 positions again (newest NFT each). */
async function demoDiscover() {
  const npm = deployment.contracts.NonfungiblePositionManager as Address | undefined
  if (npm) {
    for (const who of [DEMO, ...DEV_ACCOUNTS]) {
      const n = (await pub.readContract({ address: npm, abi: nonfungiblePositionManagerAbi, functionName: 'balanceOf', args: [who] })) as bigint
      if (n > 0n && n < 5n) personalPositions.set(who.toLowerCase(), (await pub.readContract({ address: npm, abi: nonfungiblePositionManagerAbi, functionName: 'tokenOfOwnerByIndex', args: [who, n - 1n] })) as bigint)
    }
  }
  demo.ready = true
}

const erc721TransferAbi = parseAbi(['function transferFrom(address from, address to, uint256 tokenId)'])
const erc20TransferAbi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)'])

/**
 * Give the Dev wallet accounts (#0–#5) realistic personal portfolios. Idempotent: an account is
 * normalized only while it still looks like Seed's protocol inventory (V2 LP, more than one V3
 * NFT, or > 100 ETH). Moves its LP tokens, position NFTs, vault shares and every ERC20 balance to
 * the treasury, sets its ETH, then funds its starter portfolio from the treasury.
 */
async function normalizeDevWallets(router: Address, weth: Address) {
  const npm = deployment.contracts.NonfungiblePositionManager as Address | undefined
  const lpTokens = deployment.pools.v2.map((p) => p.address as Address)
  const vaultShares = (deployment.vaults ?? []).map((v) => v.address)
  const erc20s = [...new Set([...tokens.map((t) => t.address), ...lpTokens, ...vaultShares].map((a) => a.toLowerCase()))] as Address[]
  if ((await pub.getBalance({ address: TREASURY })) < parseEther('100000')) await rpc('anvil_setBalance', [TREASURY, '0x' + parseEther('1000000').toString(16)])
  let changed = 0
  for (const [i, who] of DEV_ACCOUNTS.entries()) {
    const [eth, nfts, lp] = await Promise.all([
      pub.getBalance({ address: who }),
      npm ? (pub.readContract({ address: npm, abi: nonfungiblePositionManagerAbi, functionName: 'balanceOf', args: [who] }) as Promise<bigint>) : Promise.resolve(0n),
      Promise.all(lpTokens.map((a) => pub.readContract({ address: a, abi: erc20TransferAbi, functionName: 'balanceOf', args: [who] }) as Promise<bigint>)),
    ])
    if (eth <= parseEther('100') && nfts <= 1n && lp.every((b) => b === 0n)) continue
    changed++
    // 1) protocol inventory → treasury (LP, positions, shares, tokens)
    if (npm) {
      for (let n = nfts; n > 0n; n--) {
        const id = (await pub.readContract({ address: npm, abi: nonfungiblePositionManagerAbi, functionName: 'tokenOfOwnerByIndex', args: [who, 0n] })) as bigint
        await sendWait(who, npm, { abi: erc721TransferAbi, functionName: 'transferFrom', args: [who, TREASURY, id] })
      }
    }
    for (const t of erc20s) {
      const bal = (await pub.readContract({ address: t, abi: erc20TransferAbi, functionName: 'balanceOf', args: [who] })) as bigint
      if (bal > 0n) await sendWait(who, t, { abi: erc20TransferAbi, functionName: 'transfer', args: [TREASURY, bal] })
    }
    // 2) starter portfolio: ETH, then tokens from the treasury at the current price
    const s = STARTERS[i]
    const earnEth = s.earn && sym('WETH') && (deployment.vaults ?? []).find((v) => v.symbol === s.earn![0])?.asset.toLowerCase() === weth.toLowerCase() ? s.earn[1] / usd.WETH : 0
    // ETH by a real transfer to/from the treasury (not anvil_setBalance) so the indexed history stays exact
    const targetEth = parseEther((s.eth + earnEth).toFixed(6))
    const nowEth = await pub.getBalance({ address: who })
    if (nowEth > targetEth) await sendValue(who, TREASURY, nowEth - targetEth - parseEther('0.001'))
    else if (nowEth < targetEth) await sendValue(TREASURY, who, targetEth - nowEth)
    const want: Record<string, number> = { ...s.tokens }
    if (s.position) for (const k of [s.position[0], s.position[1]]) want[k] = (want[k] ?? 0) + s.position[2] * 1.02
    if (s.earn && !earnEth) {
      const vault = (deployment.vaults ?? []).find((v) => v.symbol === s.earn![0])
      if (vault) want[byAddress[vault.asset.toLowerCase()].symbol] = (want[byAddress[vault.asset.toLowerCase()].symbol] ?? 0) + s.earn[1]
    }
    for (const [symbol, usdAmount] of Object.entries(want)) {
      const amount = toRaw(symbol, usdAmount)
      if ((await balanceOf(sym(symbol).address, TREASURY)) < amount) await sendWait(TREASURY, sym(symbol).address, { abi: testErc20Abi, functionName: 'mint', args: [TREASURY, amount] })
      await sendWait(TREASURY, sym(symbol).address, { abi: erc20TransferAbi, functionName: 'transfer', args: [who, amount] })
    }
    if (s.position) await mintPosition(who, s.position[0], s.position[1], s.position[2])
    if (s.earn) await personalEarn(who, true, s.earn[1], s.earn[0])
  }
  if (changed) log(`dev wallets #0–#5 normalized (${changed}): protocol liquidity and inventory now held by the treasury ${TREASURY}`)
  void router
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
  for (const b of EXTRA_BIDDERS) {
    const bal = await pub.getBalance({ address: b })
    if (bal < parseEther('1000')) await rpc('anvil_setBalance', [b, '0x' + parseEther('10000').toString(16)])
  }
  const hasStage5 = Boolean(deployment.contracts.Launchpad && deployment.contracts.DevnetPad)
  if (!hasStage5) log('no launchpads in the deployment: skipping launches and earn')
  await normalizeDevWallets(router, weth)
  await demoSetup(router, weth)
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
        if (day === 1) await personalEarn(DEMO, true, 320)
      }
      // the demo acts about once a day, at a random hour
      if (day >= 1 && demoRand() < 1 / 24) await demoAct(router, weth)
      // Dev wallet accounts: a few actions a day between them, so each has some activity
      if (day >= 1 && demoRand() < 3 / 24) await personalAct(pick(DEV_ACCOUNTS.slice(0, 5)), router, weth)
      await demoBid(Number((await pub.getBlock()).timestamp))
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

  await normalizeDevWallets(router, weth)
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
  await demoDiscover().catch(() => {})
  log(`trading every ${LIVE_INTERVAL_SECONDS}s from ETH $${usd.WETH.toFixed(2)}; ${live.length} launches tracked — Ctrl+C to stop`)
  let last = Date.now()
  const demoNext = () => Date.now() + (60 + demoRand() * 120) * 1000
  let demoAt = demoNext()
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
      if (Date.now() >= demoAt) {
        demoAt = demoNext()
        await demoAct(router, weth)
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
  else if (MODE === 'normalize') {
    // existing chain: price from the pools, then give #0–#5 personal portfolios
    await loadCurrentPrices()
    await normalizeDevWallets(router, weth)
  } else await runHistory(router, weth)
}

main().catch((err) => {
  log(`failed: ${err}`)
  process.exit(1)
})
