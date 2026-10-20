// Replays HISTORY_DAYS of hourly trading on a freshly seeded devnet so every chart range
// (1H … 1Y/All) has real on-chain history. Run by scripts/dev.mjs after Seed, on a chain whose
// genesis timestamp was set HISTORY_DAYS in the past (anvil --timestamp).
//
// Model: each token has a USD price following a seeded random walk (ETH/BTC correlated,
// stablecoins mean-reverting around $1). Every simulated hour the script moves each pool to the
// implied price — V3 pools exactly, via exactInputSingle with sqrtPriceLimitX96 = target; V2 pools
// via the closed-form x*y=k trade — then adds random organic trades for volume. Trades come from
// Anvil accounts #1–#5 (unlocked, local devnet only).
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

const HISTORY_DAYS = Number(process.env.HISTORY_DAYS ?? 30)
const STEP_SECONDS = Number(process.env.HISTORY_STEP_SECONDS ?? 3600)
const SWAP_GAS = 1_000_000n
const TRADERS: Address[] = [
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
]

const transport = http(DEVNET_RPC_URL, { timeout: 60_000 })
const pub = createPublicClient({ chain: metachainDevnet, transport })
const wallet = createWalletClient({ chain: metachainDevnet, transport })
const rpc = (method: string, params: unknown[] = []) => pub.request({ method: method as never, params: params as never })

// ---------- deterministic randomness ----------
let seed = Number(process.env.HISTORY_SEED ?? 20261020)
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

function stepPrices() {
  const market = gauss()
  for (const t of tokens) {
    if (STABLES.has(t.symbol)) {
      // Ornstein–Uhlenbeck around $1, ±~0.1%
      usd[t.symbol] = 1 + (usd[t.symbol] - 1) * 0.7 + gauss() * 0.0004
      continue
    }
    const v = VOL[t.symbol] ?? { sigma: 0.01, beta: 0.5 }
    const shock = v.beta * market + Math.sqrt(Math.max(0, 1 - v.beta * v.beta)) * gauss()
    // pull gently back toward the seed price so a month stays within a believable band
    const meanRevert = -0.01 * Math.log(usd[t.symbol] / t.seedPriceUsd)
    usd[t.symbol] *= Math.exp(v.sigma * shock + meanRevert)
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
  const s = Math.sqrt(raw)
  return BigInt(Math.floor(s * 2 ** 48)) * 2n ** 48n
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

// Anvil's automine can return a tx hash a moment before the block is sealed, so always wait
// rather than reading the receipt directly.
const waitMined = (hash: Hex) => pub.waitForTransactionReceipt({ hash, pollingInterval: 25, timeout: 60_000 })

async function checkReceipts(hashes: Hex[]) {
  for (const hash of hashes) {
    const r = await waitMined(hash)
    if (r.status !== 'success') {
      failed++
      console.warn(`[history] tx reverted: ${hash}`)
    }
  }
}

// ---------- main ----------
async function main() {
  if (HISTORY_DAYS <= 0) return
  const router = contractAddress('SwapRouter02')
  const weth = contractAddress('WETH9')
  const head = await pub.getBlock()
  const now = Math.floor(Date.now() / 1000)
  let t = Number(head.timestamp) + 60
  const end = now - 120
  if (end - t < STEP_SECONDS) {
    console.log(`[history] chain clock is already near now (${new Date(Number(head.timestamp) * 1000).toISOString()}); nothing to replay`)
    return
  }
  const steps = Math.floor((end - t) / STEP_SECONDS)
  console.log(`[history] replaying ${steps} steps of ${STEP_SECONDS}s from ${new Date(t * 1000).toISOString()}`)

  // manual mining while we rewrite the clock
  await rpc('evm_setIntervalMining', [0])
  await rpc('evm_setAutomine', [true])

  // fund traders: lots of ETH → WETH, and minted test tokens; approve the router once
  for (const trader of TRADERS) {
    await rpc('anvil_setBalance', [trader, '0x' + parseEther('100000000').toString(16)])
    await send(trader, weth, { abi: weth9Abi, functionName: 'deposit', args: [] }, parseEther('5000000'))
    for (const tok of tokens) {
      if (tok.symbol !== 'WETH') {
        const amount = BigInt(Math.round(5e10 / tok.seedPriceUsd)) * 10n ** BigInt(tok.decimals)
        await send(trader, tok.address, { abi: testErc20Abi, functionName: 'mint', args: [trader, amount] })
      }
      await send(trader, tok.address, { abi: testErc20Abi, functionName: 'approve', args: [router, maxUint256] })
    }
  }

  const v3Pools = deployment.pools.v3
  const v2Pools = deployment.pools.v2
  let traderIx = 0
  const nextTrader = () => TRADERS[traderIx++ % TRADERS.length]

  for (let step = 0; step < steps; step++, t += STEP_SECONDS) {
    stepPrices()
    await rpc('evm_setNextBlockTimestamp', [t])
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
      if (diff < 0.0002) continue
      const zeroForOne = target < current
      hashes.push(
        await send(nextTrader(), router, {
          abi: swapRouter02Abi,
          functionName: 'exactInputSingle',
          // amountIn is a ceiling: the price limit stops the swap at the target and only the
          // consumed amount is pulled from the trader
          args: [
            {
              tokenIn: zeroForOne ? p.token0 : p.token1,
              tokenOut: zeroForOne ? p.token1 : p.token0,
              fee: p.fee,
              recipient: TRADERS[0],
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
      if (Math.abs(target / currentPrice - 1) < 0.0004) continue
      const k = r0 * r1
      const buyToken0 = target > currentPrice // token0 gets more expensive → pay token1 in
      const amountIn = buyToken0 ? (Math.sqrt(k * target) - r1) / 0.997 : (Math.sqrt(k / target) - r0) / 0.997
      if (!(amountIn > 0)) continue
      hashes.push(
        await send(nextTrader(), router, {
          abi: swapRouter02Abi,
          functionName: 'swapExactTokensForTokens',
          args: [BigInt(Math.floor(amountIn)), 0n, buyToken0 ? [p.token1, p.token0] : [p.token0, p.token1], TRADERS[0]],
        }),
      )
    }

    // organic flow: a few random-size, random-direction trades for volume
    const organic = 2 + Math.floor(rand() * 5)
    for (let n = 0; n < organic; n++) {
      const useV3 = rand() < 0.7
      const pool = useV3 ? v3Pools[Math.floor(rand() * v3Pools.length)] : v2Pools[Math.floor(rand() * v2Pools.length)]
      const zeroForOne = rand() < 0.5
      const tokenIn = byAddress[(zeroForOne ? pool.token0 : pool.token1).toLowerCase()]
      const tokenOut = zeroForOne ? pool.token1 : pool.token0
      const sizeUsd = Math.exp(Math.log(200) + rand() * Math.log(400)) // ~$200 … $80k, log-uniform
      const amountIn = BigInt(Math.floor((sizeUsd / usd[tokenIn.symbol]) * 10 ** tokenIn.decimals))
      if (amountIn === 0n) continue
      hashes.push(
        useV3
          ? await send(nextTrader(), router, {
              abi: swapRouter02Abi,
              functionName: 'exactInputSingle',
              args: [
                {
                  tokenIn: tokenIn.address,
                  tokenOut,
                  fee: (pool as { fee: number }).fee,
                  recipient: nextTrader(),
                  amountIn,
                  amountOutMinimum: 0n,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            })
          : await send(nextTrader(), router, {
              abi: swapRouter02Abi,
              functionName: 'swapExactTokensForTokens',
              args: [amountIn, 0n, [tokenIn.address, tokenOut], nextTrader()],
            }),
      )
    }

    // receipts: every step for the first day, then sampled daily, to keep the replay fast. The
    // last tx of each step is always awaited so the next step reads settled pool state and its
    // timestamp override lands after this step's blocks.
    if (step < 24 || step % 24 === 0) await checkReceipts(hashes)
    else if (hashes.length) await waitMined(hashes[hashes.length - 1])
    if (step % 48 === 0 || step === steps - 1) {
      console.log(
        `[history] ${new Date(t * 1000).toISOString().slice(0, 16)}  ETH $${usd.WETH.toFixed(0)}  BTC $${usd.mWBTC.toFixed(0)}  META $${usd.META.toFixed(2)}  txs ${sent} (failed ${failed})`,
      )
    }
  }

  // hand the clock back to real time and resume 1s interval mining
  await rpc('evm_setNextBlockTimestamp', [Math.floor(Date.now() / 1000)])
  await rpc('evm_mine')
  await rpc('evm_setAutomine', [false])
  await rpc('evm_setIntervalMining', [1])
  console.log(`[history] done: ${sent} transactions, ${failed} failed (sampled receipts)`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('[history] failed:', err)
  process.exit(1)
})
