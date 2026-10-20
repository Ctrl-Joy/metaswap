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
// Trades come from Anvil accounts #10–#14 (dev.mjs starts anvil with 20 unlocked accounts), so
// the accounts the Dev wallet and e2e tests use (#0–#4) and the filler (#9) are never touched.
// Local devnet only.
import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  parseEther,
  type Address,
  type Hex,
} from 'viem'
import {
  DEVNET_RPC_URL,
  contractAddress,
  deployment,
  metachainDevnet,
  swapRouter02Abi,
  testErc20Abi,
  v2PairAbi,
  v3PoolAbi,
  weth9Abi,
} from '../packages/sdk/src/index'

const MODE = process.argv.includes('--live') ? 'live' : 'history'
const HISTORY_DAYS = Number(process.env.HISTORY_DAYS ?? 30)
const STEP_SECONDS = Number(process.env.HISTORY_STEP_SECONDS ?? 3600)
const LIVE_INTERVAL_SECONDS = Number(process.env.LIVE_INTERVAL_SECONDS ?? 20)
const SWAP_GAS = 1_000_000n
// Anvil default-mnemonic accounts #10–#14
const TRADERS: Address[] = [
  '0xBcd4042DE499D14e55001CcbB24a551F3b954096',
  '0x71bE63f3384f5fb98995898A86B02Fb2426c5788',
  '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a',
  '0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec',
  '0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097',
]
// Per-trader working capital. Enough to steer deep pools for a month, small enough that
// totalSupply (and so FDV) stays believable.
const TRADER_USD_PER_TOKEN = 25_000_000
const TRADER_WETH = parseEther('10000')

const transport = http(DEVNET_RPC_URL, { timeout: 60_000 })
const pub = createPublicClient({ chain: metachainDevnet, transport, pollingInterval: 250 })
const wallet = createWalletClient({ chain: metachainDevnet, transport })
const rpc = (method: string, params: unknown[] = []) => pub.request({ method: method as never, params: params as never })
const log = (msg: string) => console.log(`[market:${MODE}] ${msg}`)

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

// ---------- price model ----------
const tokens = deployment.tokens
const byAddress = Object.fromEntries(tokens.map((t) => [t.address.toLowerCase(), t]))
const STABLES = new Set(['mUSDC', 'mUSDT', 'mDAI'])
// hourly volatility and correlation with the market factor (ETH)
const VOL: Record<string, { sigma: number; beta: number }> = {
  WETH: { sigma: 0.0085, beta: 1 },
  mWBTC: { sigma: 0.007, beta: 0.7 },
  META: { sigma: 0.016, beta: 0.6 },
  mLINK: { sigma: 0.012, beta: 0.8 },
  mARB: { sigma: 0.013, beta: 0.8 },
}
const usd: Record<string, number> = Object.fromEntries(tokens.map((t) => [t.symbol, t.seedPriceUsd]))

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
    const v = VOL[t.symbol] ?? { sigma: 0.01, beta: 0.5 }
    const shock = v.beta * market + Math.sqrt(Math.max(0, 1 - v.beta * v.beta)) * gauss()
    // pull gently back toward the seed price so prices stay within a believable band
    const meanRevert = -0.01 * hours * Math.log(usd[t.symbol] / t.seedPriceUsd)
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
async function send(from: Address, to: Address, data: { abi: unknown; functionName: string; args: unknown[] }, value = 0n) {
  const hash = await wallet.writeContract({
    account: from,
    address: to,
    abi: data.abi,
    functionName: data.functionName,
    args: data.args,
    value,
    gas: SWAP_GAS,
    chain: metachainDevnet,
  } as never)
  sent++
  return hash as Hex
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

const targetBalance = (tok: (typeof tokens)[number]) =>
  tok.symbol === 'WETH' ? TRADER_WETH : BigInt(Math.round(TRADER_USD_PER_TOKEN / tok.seedPriceUsd)) * 10n ** BigInt(tok.decimals)

/**
 * Keep each trader stocked: approve SwapRouter02 once, and refill any token that has fallen below
 * a quarter of its working balance (ETH → WETH for WETH, open mint for test tokens). Run at start
 * and periodically, so a long replay can never stall on an empty inventory.
 */
async function topUpTraders(router: Address, weth: Address) {
  const hashes: Hex[] = []
  for (const trader of TRADERS) {
    const ethBal = await pub.getBalance({ address: trader })
    if (ethBal < parseEther('100000')) await rpc('anvil_setBalance', [trader, '0x' + parseEther('1000000').toString(16)])
    for (const tok of tokens) {
      const [balance, allowance] = (await Promise.all([
        pub.readContract({ address: tok.address, abi: testErc20Abi, functionName: 'balanceOf', args: [trader] }),
        pub.readContract({ address: tok.address, abi: testErc20Abi, functionName: 'allowance', args: [trader, router] }),
      ])) as [bigint, bigint]
      const target = targetBalance(tok)
      if (balance < target / 4n) {
        const missing = target - balance
        hashes.push(
          tok.address.toLowerCase() === weth.toLowerCase()
            ? await send(trader, weth, { abi: weth9Abi, functionName: 'deposit', args: [] }, missing)
            : await send(trader, tok.address, { abi: testErc20Abi, functionName: 'mint', args: [trader, missing] }),
        )
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

/** One market step: steer every pool to the model price, then add organic trades. */
async function marketStep(router: Address, organicMin: number, organicMax: number): Promise<Hex[]> {
  const hashes: Hex[] = []
  const v3Pools = deployment.pools.v3
  const v2Pools = deployment.pools.v2

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
    // every trade pays its own sender so trader inventories stay balanced over a long replay
    const trader = nextTrader()
    hashes.push(
      await send(trader, router, {
        abi: swapRouter02Abi,
        functionName: 'exactInputSingle',
        // amountIn is a ceiling: the price limit stops the swap at the target and only the
        // consumed amount is pulled from the trader
        args: [
          {
            tokenIn: zeroForOne ? p.token0 : p.token1,
            tokenOut: zeroForOne ? p.token1 : p.token0,
            fee: p.fee,
            recipient: trader,
            amountIn: 10n ** 30n,
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: target,
          },
        ],
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
    const target = rawPrice(p.token0, p.token1)
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
    const pool = useV3 ? v3Pools[Math.floor(rand() * v3Pools.length)] : v2Pools[Math.floor(rand() * v2Pools.length)]
    const zeroForOne = rand() < 0.5
    const tokenIn = byAddress[(zeroForOne ? pool.token0 : pool.token1).toLowerCase()]
    const tokenOut = zeroForOne ? pool.token1 : pool.token0
    const sizeUsd = Math.exp(Math.log(200) + rand() * Math.log(400)) // ~$200 … $80k, log-uniform
    const amountIn = BigInt(Math.floor((sizeUsd / usd[tokenIn.symbol]) * 10 ** tokenIn.decimals))
    if (amountIn === 0n) continue
    const trader = nextTrader()
    hashes.push(
      useV3
        ? await send(trader, router, {
            abi: swapRouter02Abi,
            functionName: 'exactInputSingle',
            args: [
              {
                tokenIn: tokenIn.address,
                tokenOut,
                fee: (pool as { fee: number }).fee,
                recipient: trader,
                amountIn,
                amountOutMinimum: 0n,
                sqrtPriceLimitX96: 0n,
              },
            ],
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

// ---------- modes ----------
async function runHistory(router: Address, weth: Address) {
  if (HISTORY_DAYS <= 0) return
  const head = await pub.getBlock()
  let t = Number(head.timestamp) + 60
  const end = Math.floor(Date.now() / 1000) - 120
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
    if (step % 48 === 0 || step === steps - 1) {
      log(
        `${new Date(t * 1000).toISOString().slice(0, 16)}  ETH $${usd.WETH.toFixed(0)}  BTC $${usd.mWBTC.toFixed(0)}  META $${usd.META.toFixed(2)}  txs ${sent} (failed ${failed})`,
      )
    }
  }

  // hand the clock back to real time and resume 1s interval mining
  await rpc('evm_setNextBlockTimestamp', [Math.floor(Date.now() / 1000)])
  await rpc('evm_mine')
  await rpc('evm_setAutomine', [false])
  await rpc('evm_setIntervalMining', [1])
  log(`done: ${sent} transactions, ${failed} failed (sampled receipts)`)
  if (failed > 0) process.exitCode = 1
}

/**
 * Start the live walk from the prices the pools hold right now, so nothing jumps. Read on-chain
 * rather than from the API: the indexer may still be backfilling and would report stale prices.
 * ETH comes from the deepest WETH/stable V3 pool; every other token from its V3 pool against WETH
 * (or a stable); stablecoins keep $1.
 */
async function loadCurrentPrices() {
  const weth = deployment.tokens.find((t) => t.symbol === 'WETH')!
  const pools = deployment.pools.v3
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
  const pick = (base: string, quotes: string[]) => {
    for (const quote of quotes) for (let i = 0; i < pools.length; i++) {
      const v = priceIn(i, base, quote)
      if (v) return { v, quote }
    }
    return null
  }
  const eth = pick('WETH', ['mUSDC', 'mUSDT', 'mDAI'])
  if (eth) usd.WETH = eth.v
  for (const t of tokens) {
    if (t.symbol === 'WETH' || STABLES.has(t.symbol)) continue
    const hit = pick(t.symbol, [weth.symbol, 'mUSDC', 'mUSDT', 'mDAI'])
    if (hit) usd[t.symbol] = hit.quote === weth.symbol ? hit.v * usd.WETH : hit.v
  }
}

async function runLive(router: Address, weth: Address) {
  await topUpTraders(router, weth)
  await loadCurrentPrices()
  log(`trading every ${LIVE_INTERVAL_SECONDS}s from ETH $${usd.WETH.toFixed(2)} — Ctrl+C to stop`)
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

