import { EventEmitter } from 'node:events'
import {
  decodeEventLog,
  getAddress,
  numberToHex,
  toEventSelector,
  type Abi,
  type Block,
  type Hex,
  type Log,
  type Transaction,
} from 'viem'
import { erc20Abi, launchAuctionAbi, launchpadAbi, npmAbi, reactorAbi, v2FactoryAbi, v2PairAbi, v3FactoryAbi, v3PoolAbi, vaultAbi, weth9Abi } from '../abis'
import { STABLE_SYMBOLS, TokenRegistry, hasDeployment, lc, type Context } from '../context'
import { launchParamsAbi } from '../abis'
import { computeUsdPrices, poolTvlUsd, swapVolumeUsd, type PricingPool } from '../pricing/prices'
import { sqrtPriceToPrice } from '../lib/v3math'
import { WriteBatch } from '../db'

export interface PoolInfo {
  address: string // lower-case
  version: 'v2' | 'v3'
  token0: string
  token1: string
  fee: number
  tickSpacing: number | null
  createdBlock: number
  createdTs: number
}

export interface PoolRuntime extends PoolInfo {
  reserve0: bigint
  reserve1: bigint
  sqrtPriceX96: bigint | null
  tick: number | null
  liquidity: bigint | null
  lpSupply: bigint
}

const ZERO = '0x0000000000000000000000000000000000000000'

const sel = (abi: Abi, name: string, inputsLen?: number) => {
  const item = abi.find(
    (i) => i.type === 'event' && i.name === name && (inputsLen === undefined || i.inputs.length === inputsLen),
  )
  if (!item || item.type !== 'event') throw new Error(`event ${name} not in abi`)
  return toEventSelector(item)
}

export const TOPICS = {
  PairCreated: sel(v2FactoryAbi, 'PairCreated'),
  PoolCreated: sel(v3FactoryAbi, 'PoolCreated'),
  V2Sync: sel(v2PairAbi, 'Sync'),
  V2Swap: sel(v2PairAbi, 'Swap'),
  V2Mint: sel(v2PairAbi, 'Mint'),
  V2Burn: sel(v2PairAbi, 'Burn'),
  Transfer: sel(erc20Abi, 'Transfer'),
  V3Initialize: sel(v3PoolAbi, 'Initialize'),
  V3Swap: sel(v3PoolAbi, 'Swap'),
  V3Mint: sel(v3PoolAbi, 'Mint'),
  V3Burn: sel(v3PoolAbi, 'Burn'),
  IncreaseLiquidity: sel(npmAbi, 'IncreaseLiquidity'),
  DecreaseLiquidity: sel(npmAbi, 'DecreaseLiquidity'),
  NpmCollect: sel(npmAbi, 'Collect'),
  Deposit: sel(weth9Abi, 'Deposit'),
  Withdrawal: sel(weth9Abi, 'Withdrawal'),
  Fill: sel(reactorAbi, 'Fill'),
  VaultDeposit: sel(vaultAbi, 'Deposit'),
  VaultWithdraw: sel(vaultAbi, 'Withdraw'),
  LaunchCreated: sel(launchpadAbi, 'LaunchCreated'),
  BidPlaced: sel(launchAuctionAbi, 'BidPlaced'),
  Settled: sel(launchAuctionAbi, 'Settled'),
  Claimed: sel(launchAuctionAbi, 'Claimed'),
} as const

const ALL_TOPICS = Object.values(TOPICS)

type RawLog = Log<bigint, number, false>
type FullBlock = Block<bigint, true>

interface PendingSwap {
  row: Record<string, string | number | null>
  pool: PoolRuntime
  amount0: bigint
  amount1: bigint
}

/**
 * Event indexer. Backfills from `deployment.blockNumber`, then follows the head (poll).
 *
 * Reorg handling: every poll compares the stored hash of the last indexed block with the chain.
 * On a mismatch (reorg, `evm_revert`, or an Anvil restart that reset the chain) it looks for the
 * newest common ancestor within `reorgDepth` blocks, deletes every row above it and replays from
 * there (all inserts are keyed by (block, logIndex) so re-reading is idempotent). If no common
 * ancestor is found the whole index is rebuilt.
 */
export class Indexer extends EventEmitter {
  pools = new Map<string, PoolRuntime>()
  prices = new Map<string, number>()
  decimals = new Map<string, number>()
  trackedTokens = new Set<string>()
  /** Stage 5: earn vaults (from the deployment), launchpads, and auctions discovered via LaunchCreated */
  vaults = new Set<string>()
  launchpads = new Set<string>()
  auctions = new Set<string>()
  launchedTokens = new Set<string>()
  indexedBlock = -1
  indexedTimestamp = 0
  headBlock = -1
  lastError: string | null = null
  running = false
  private timer: NodeJS.Timeout | null = null
  private busy = false
  readonly tokens: TokenRegistry

  constructor(private ctx: Context) {
    super()
    this.tokens = new TokenRegistry(ctx)
  }

  private get db() {
    return this.ctx.db
  }

  /** Contract addresses + deployment block; a change means a new chain → rebuild. */
  private deploymentKey(): string {
    const c = this.ctx.deployment.contracts
    const c5 = c as Record<string, string | undefined>
    // the schema tag forces a re-index when indexed tables change meaning (s5: tx_values, launches, earn)
    return JSON.stringify(['schema-s5', this.ctx.deployment.blockNumber, c.V2Factory, c.V3Factory, c.NonfungiblePositionManager, c.WETH9, c.ExclusiveDutchOrderReactor ?? null, c5.Launchpad ?? null, c5.DevnetPad ?? null])
  }

  async loadState() {
    // read everything first, then swap the in-memory state synchronously (requests never see it half-built)
    const [tokenRows, rows, launchRows, priceRows, ib, its] = await Promise.all([
      this.db.all<{ address: string; symbol: string; name: string; decimals: number }>('SELECT * FROM tokens'),
      this.db.all<Record<string, unknown>>('SELECT p.*, s.reserve0, s.reserve1, s.sqrt_price, s.tick, s.liquidity, s.lp_supply FROM pools p LEFT JOIN pool_state s ON s.address = p.address'),
      this.db.all<{ auction: string; token: string }>('SELECT auction, token FROM launches'),
      this.db.all<{ token: string; price: number }>(
        'SELECT p.token, p.price FROM price_points p JOIN (SELECT token, MAX(block) AS b FROM price_points GROUP BY token) q ON q.token = p.token AND q.b = p.block',
      ),
      this.db.getMeta('indexedBlock'),
      this.db.getMeta('indexedTimestamp'),
    ])
    this.pools.clear()
    this.prices.clear()
    this.decimals.clear()
    this.trackedTokens.clear()
    this.tokens.clear()
    for (const t of tokenRows) this.tokens.remember(t)
    for (const t of this.ctx.deployment.tokens) {
      this.decimals.set(lc(t.address), t.decimals)
      this.trackedTokens.add(lc(t.address))
    }
    for (const t of tokenRows) {
      this.decimals.set(t.address, Number(t.decimals))
      this.trackedTokens.add(t.address)
    }
    for (const r of rows) {
      this.pools.set(String(r.address), {
        address: String(r.address),
        version: r.version as 'v2' | 'v3',
        token0: String(r.token0),
        token1: String(r.token1),
        fee: Number(r.fee),
        tickSpacing: r.tick_spacing === null ? null : Number(r.tick_spacing),
        createdBlock: Number(r.created_block),
        createdTs: Number(r.created_ts),
        reserve0: BigInt((r.reserve0 as string) ?? '0'),
        reserve1: BigInt((r.reserve1 as string) ?? '0'),
        sqrtPriceX96: r.sqrt_price ? BigInt(r.sqrt_price as string) : null,
        tick: r.tick === null || r.tick === undefined ? null : Number(r.tick),
        liquidity: r.liquidity ? BigInt(r.liquidity as string) : null,
        lpSupply: BigInt((r.lp_supply as string) ?? '0'),
      })
      this.trackedTokens.add(String(r.token0))
      this.trackedTokens.add(String(r.token1))
    }
    this.vaults.clear()
    this.launchpads.clear()
    this.auctions.clear()
    this.launchedTokens.clear()
    for (const v of vaultsOf(this.ctx.deployment)) {
      this.vaults.add(lc(v.address))
      // vault share transfers feed depositor counts and portfolio history
      this.trackedTokens.add(lc(v.address))
    }
    for (const p of launchpadsOf(this.ctx.deployment)) this.launchpads.add(lc(p.address))
    for (const r of launchRows) {
      this.auctions.add(r.auction)
      this.launchedTokens.add(r.token)
      this.trackedTokens.add(r.token)
    }
    for (const r of priceRows) {
      this.prices.set(r.token, r.price)
    }
    this.indexedBlock = ib === undefined ? -1 : Number(ib)
    this.indexedTimestamp = Number(its ?? 0)
  }

  async start() {
    if (this.running) return
    this.running = true
    await this.db.init()
    if ((await this.db.getMeta('deploymentKey')) !== this.deploymentKey()) {
      await this.db.resetChainData()
    }
    await this.loadState()
    const loop = async () => {
      if (!this.running) return
      try {
        await this.tick()
        this.lastError = null
      } catch (e) {
        this.lastError = (e as Error).message
        console.error('[indexer]', (e as Error).message)
      }
      if (this.running) this.timer = setTimeout(loop, this.ctx.config.pollMs)
    }
    await loop()
  }

  stop() {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
  }

  /** Wait until the indexer has processed `block` (or timeout). */
  async waitFor(block: number, timeoutMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.indexedBlock >= block) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return this.indexedBlock >= block
  }

  async tick() {
    if (this.busy) return
    if (!hasDeployment(this.ctx)) return
    this.busy = true
    try {
      const head = Number(await this.ctx.client.getBlockNumber({ cacheTime: 0 }))
      this.headBlock = head
      await this.checkReorg(head)
      const startBlock = Math.max(0, this.ctx.deployment.blockNumber ?? 0)
      let from = Math.max(this.indexedBlock + 1, startBlock)
      while (from <= head && this.running) {
        const to = Math.min(head, from + this.ctx.config.batchSize - 1)
        await this.processRange(from, to)
        from = to + 1
      }
    } finally {
      this.busy = false
    }
  }

  private async checkReorg(head: number) {
    if (this.indexedBlock < 0) {
      if ((await this.db.getMeta('deploymentKey')) !== this.deploymentKey()) await this.db.setMeta('deploymentKey', this.deploymentKey())
      return
    }
    const stored = await this.db.get<{ hash: string }>('SELECT hash FROM blocks WHERE number = ?', this.indexedBlock)
    let ok = false
    if (head >= this.indexedBlock && stored) {
      const b = await this.ctx.client.getBlock({ blockNumber: BigInt(this.indexedBlock) })
      ok = b.hash === stored.hash
    }
    if (ok) return
    // find the newest stored block that is still canonical
    const candidates = await this.db.all<{ number: number; hash: string }>(
      'SELECT number, hash FROM blocks WHERE number <= ? ORDER BY number DESC LIMIT ?',
      Math.min(this.indexedBlock, head),
      this.ctx.config.reorgDepth,
    )
    for (const c of candidates) {
      const b = await this.ctx.client.getBlock({ blockNumber: BigInt(c.number) }).catch(() => null)
      if (b && b.hash === c.hash) {
        console.warn(`[indexer] reorg detected; rolling back to block ${c.number}`)
        await this.rollbackTo(c.number)
        this.emit('reorg', c.number)
        return
      }
    }
    console.warn('[indexer] chain changed (restart/reset); rebuilding index from scratch')
    await this.db.resetChainData()
    await this.db.setMeta('deploymentKey', this.deploymentKey())
    await this.loadState()
    this.emit('reset')
  }

  /** Delete everything above `block` and rebuild in-memory pool state by replaying stored state. */
  private async rollbackTo(block: number) {
    const tables = ['swaps', 'liquidity_events', 'transfers', 'weth_events', 'nft_transfers', 'nft_events', 'fills', 'price_points', 'pool_snapshots', 'earn_events', 'bids', 'claims']
    const w = new WriteBatch()
    for (const t of tables) w.run(`DELETE FROM ${t} WHERE block > ?`, block)
    w.run('DELETE FROM native_transfers WHERE block > ?', block)
    w.run('DELETE FROM tx_values WHERE block > ?', block)
    w.run('DELETE FROM blocks WHERE number > ?', block)
    w.run('DELETE FROM pools WHERE created_block > ?', block)
    w.run('DELETE FROM launches WHERE created_block > ?', block)
    w.run('DELETE FROM settlements WHERE block > ?', block)
    w.run("UPDATE x_orders SET status = 'open', fill_tx = NULL, fill_block = NULL, filler = NULL WHERE fill_block > ?", block)
    // pool_state reflects the old head; rebuild it from the newest snapshot at or below `block`
    w.run('DELETE FROM pool_state')
    w.setMeta('indexedBlock', String(block))
    await this.db.write(w)
    await this.loadState()
    // replay reserves from snapshots (exact: snapshots are written after every change)
    for (const p of this.pools.values()) {
      const s = await this.db.get<{ reserve0: string; reserve1: string }>(
        'SELECT reserve0, reserve1 FROM pool_snapshots WHERE pool = ? ORDER BY block DESC LIMIT 1',
        p.address,
      )
      if (s) {
        p.reserve0 = BigInt(s.reserve0)
        p.reserve1 = BigInt(s.reserve1)
      }
    }
    // v3 price/liquidity and v2 LP supply are re-read from chain on the next processed block
    this.needsRefresh = true
  }

  private needsRefresh = false
  /** writes of the range being processed (applied atomically at the end of processRange) */
  private w = new WriteBatch()

  private async refreshPoolsFromChain(blockNumber?: bigint) {
    for (const p of this.pools.values()) {
      if (p.version === 'v3') {
        const [slot0, liq] = await Promise.all([
          this.ctx.client.readContract({ address: getAddress(p.address), abi: v3PoolAbi, functionName: 'slot0', blockNumber }),
          this.ctx.client.readContract({ address: getAddress(p.address), abi: v3PoolAbi, functionName: 'liquidity', blockNumber }),
        ])
        p.sqrtPriceX96 = slot0[0]
        p.tick = slot0[1]
        p.liquidity = liq
        const [b0, b1] = await Promise.all([
          this.ctx.client.readContract({ address: getAddress(p.token0), abi: erc20Abi, functionName: 'balanceOf', args: [getAddress(p.address)], blockNumber }),
          this.ctx.client.readContract({ address: getAddress(p.token1), abi: erc20Abi, functionName: 'balanceOf', args: [getAddress(p.address)], blockNumber }),
        ])
        p.reserve0 = b0
        p.reserve1 = b1
      } else {
        const [r, ts] = await Promise.all([
          this.ctx.client.readContract({ address: getAddress(p.address), abi: v2PairAbi, functionName: 'getReserves', blockNumber }),
          this.ctx.client.readContract({ address: getAddress(p.address), abi: v2PairAbi, functionName: 'totalSupply', blockNumber }),
        ])
        p.reserve0 = r[0]
        p.reserve1 = r[1]
        p.lpSupply = ts
      }
    }
  }

  private async fetchBlocks(from: number, to: number): Promise<FullBlock[]> {
    const out: FullBlock[] = []
    const CHUNK = 250
    for (let s = from; s <= to; s += CHUNK) {
      const e = Math.min(to, s + CHUNK - 1)
      const part = await Promise.all(
        Array.from({ length: e - s + 1 }, (_, i) =>
          this.ctx.client.getBlock({ blockNumber: BigInt(s + i), includeTransactions: true }),
        ),
      )
      out.push(...(part as FullBlock[]))
    }
    return out
  }

  async processRange(from: number, to: number) {
    const c = this.ctx.deployment.contracts
    if (this.needsRefresh && from > 0) {
      // state at from-1 (a recent block after a shallow reorg); if the node pruned it, use the head
      await this.refreshPoolsFromChain(BigInt(from - 1)).catch(() => this.refreshPoolsFromChain())
      this.needsRefresh = false
    }
    const rawLogs = (await this.ctx.client.request({
      method: 'eth_getLogs',
      params: [{ fromBlock: numberToHex(from), toBlock: numberToHex(to), topics: [ALL_TOPICS] }],
    })) as unknown as Array<Record<string, unknown>>
    const logs: RawLog[] = rawLogs.map((l) => ({
      ...(l as unknown as RawLog),
      blockNumber: BigInt(l.blockNumber as string),
      logIndex: Number(l.logIndex),
      transactionIndex: Number(l.transactionIndex),
      address: lc(l.address as string) as Hex,
    }))
    const blocks = await this.fetchBlocks(from, to)
    const v2Factory = lc(c.V2Factory ?? ZERO)
    const v3Factory = lc(c.V3Factory ?? ZERO)

    // pre-fetch metadata for tokens of pools created in this range (async, before the DB tx)
    for (const log of logs) {
      if ((log.address === v2Factory && log.topics[0] === TOPICS.PairCreated) || (log.address === v3Factory && log.topics[0] === TOPICS.PoolCreated)) {
        for (const t of [log.topics[1], log.topics[2]]) {
          const a = lc(getAddress(`0x${t!.slice(26)}`))
          if (!this.decimals.has(a)) {
            const info = await this.tokens.get(a)
            if (info) this.decimals.set(a, info.decimals)
          }
        }
      }
    }

    // launches: token metadata + auction params (async, before the DB tx)
    const launchMeta = new Map<string, string | null>()
    for (const log of logs) {
      if (this.launchpads.has(log.address) && log.topics[0] === TOPICS.LaunchCreated) {
        const token = lc(getAddress(`0x${log.topics[1]!.slice(26)}`))
        const auction = lc(getAddress(`0x${log.topics[2]!.slice(26)}`))
        const info = await this.tokens.get(token)
        if (info) this.decimals.set(token, info.decimals)
        launchMeta.set(auction, await readLaunchParams(this.ctx, auction))
      }
    }

    const byBlock = new Map<number, RawLog[]>()
    for (const l of logs) {
      const n = Number(l.blockNumber)
      let arr = byBlock.get(n)
      if (!arr) byBlock.set(n, (arr = []))
      arr.push(l)
    }
    const fills: { orderHash: string; txHash: string; block: number; filler: string }[] = []
    const w = (this.w = new WriteBatch())
    try {
      {
        for (const block of blocks) {
          const n = Number(block.number)
          const blockLogs = (byBlock.get(n) ?? []).sort((a, b) => a.logIndex - b.logIndex)
          this.processBlock(block, blockLogs, fills, launchMeta)
        }
        const last = blocks[blocks.length - 1]
        w.insert('blocks', { number: Number(last.number), hash: last.hash!, timestamp: Number(last.timestamp) }, 'REPLACE')
        for (const p of this.pools.values()) {
          w.insert(
            'pool_state',
            {
              address: p.address,
              reserve0: p.reserve0.toString(),
              reserve1: p.reserve1.toString(),
              sqrt_price: p.sqrtPriceX96?.toString() ?? null,
              tick: p.tick,
              liquidity: p.liquidity?.toString() ?? null,
              lp_supply: p.lpSupply.toString(),
              updated_block: to,
            },
            'REPLACE',
          )
        }
        w.setMeta('indexedBlock', String(to))
        w.setMeta('indexedTimestamp', String(Number(last.timestamp)))
      }
      await this.db.write(w)
    } catch (e) {
      // in-memory state may be ahead of the DB: reload it
      await this.loadState()
      throw e
    }
    this.indexedBlock = to
    this.indexedTimestamp = Number(blocks[blocks.length - 1].timestamp)
    for (const f of fills) this.emit('fill', f)
    this.emit('indexed', to, this.indexedTimestamp, w, from)
  }

  private processBlock(block: FullBlock, logs: RawLog[], fills: { orderHash: string; txHash: string; block: number; filler: string }[], launchMeta = new Map<string, string | null>()) {
    const c = this.ctx.deployment.contracts
    const n = Number(block.number)
    const ts = Number(block.timestamp)
    const origins = new Map<string, string>()
    for (const tx of block.transactions as Transaction[]) {
      origins.set(tx.hash, lc(tx.from))
      if (tx.value > 0n) {
        this.w.insert('tx_values', { block: n, tx_index: Number(tx.transactionIndex), tx_hash: tx.hash, timestamp: ts, from_addr: lc(tx.from), to_addr: tx.to ? lc(tx.to) : null, value: tx.value.toString() })
      }
      if (tx.value > 0n && (tx.input === '0x' || tx.input === undefined) && tx.to) {
        this.w.insert('native_transfers', {
          block: n,
          tx_index: Number(tx.transactionIndex),
          tx_hash: tx.hash,
          timestamp: ts,
          from_addr: lc(tx.from),
          to_addr: lc(tx.to),
          value: tx.value.toString(),
        })
      }
    }
    if (logs.length === 0) return
    this.w.insert('blocks', { number: n, hash: block.hash!, timestamp: ts }, 'REPLACE')

    const v2Factory = lc(c.V2Factory ?? ZERO)
    const v3Factory = lc(c.V3Factory ?? ZERO)
    const npm = lc(c.NonfungiblePositionManager ?? ZERO)
    const weth = lc(c.WETH9 ?? ZERO)
    const reactor = lc(c.ExclusiveDutchOrderReactor ?? ZERO)
    const changed = new Set<PoolRuntime>()
    const pendingSwaps: PendingSwap[] = []
    const pendingLiq: { row: Record<string, string | number | null>; pool: PoolRuntime; a0: bigint; a1: bigint }[] = []

    for (const log of logs) {
      const t0 = log.topics[0]
      const base = { block: n, log_index: log.logIndex, tx_hash: log.transactionHash!, timestamp: ts }
      const origin = origins.get(log.transactionHash!) ?? ZERO
      const a = log.address
      if (a === v2Factory && t0 === TOPICS.PairCreated) {
        const ev = decodeEventLog({ abi: v2FactoryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        if (ev.eventName !== 'PairCreated') continue
        const [pt0, pt1, pair] = ev.args as unknown as readonly [string, string, string, bigint]
        this.addPool({ address: lc(pair), version: 'v2', token0: lc(pt0), token1: lc(pt1), fee: 3000, tickSpacing: null, createdBlock: n, createdTs: ts })
        continue
      }
      if (a === v3Factory && t0 === TOPICS.PoolCreated) {
        const ev = decodeEventLog({ abi: v3FactoryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        if (ev.eventName !== 'PoolCreated') continue
        this.addPool({ address: lc(ev.args.pool), version: 'v3', token0: lc(ev.args.token0), token1: lc(ev.args.token1), fee: Number(ev.args.fee), tickSpacing: Number(ev.args.tickSpacing), createdBlock: n, createdTs: ts })
        continue
      }
      const pool = this.pools.get(a)
      if (pool?.version === 'v2') {
        if (t0 === TOPICS.V2Sync) {
          const ev = decodeEventLog({ abi: v2PairAbi, eventName: 'Sync', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
          pool.reserve0 = ev.args.reserve0
          pool.reserve1 = ev.args.reserve1
          changed.add(pool)
        } else if (t0 === TOPICS.V2Swap) {
          const ev = decodeEventLog({ abi: v2PairAbi, eventName: 'Swap', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
          const amount0 = ev.args.amount0In - ev.args.amount0Out
          const amount1 = ev.args.amount1In - ev.args.amount1Out
          pendingSwaps.push({
            pool,
            amount0,
            amount1,
            row: { ...base, pool: a, version: 'v2', origin, sender: lc(ev.args.sender), recipient: lc(ev.args.to), amount0: amount0.toString(), amount1: amount1.toString() },
          })
        } else if (t0 === TOPICS.V2Mint || t0 === TOPICS.V2Burn) {
          const ev = decodeEventLog({ abi: v2PairAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
          if (ev.eventName !== 'Mint' && ev.eventName !== 'Burn') continue
          const isMint = ev.eventName === 'Mint'
          pendingLiq.push({
            pool,
            a0: ev.args.amount0,
            a1: ev.args.amount1,
            row: { ...base, pool: a, version: 'v2', type: isMint ? 'add' : 'remove', origin, owner: isMint ? origin : lc((ev.args as { to: string }).to), amount0: ev.args.amount0.toString(), amount1: ev.args.amount1.toString(), tick_lower: null, tick_upper: null, liquidity: null },
          })
        } else if (t0 === TOPICS.Transfer && log.topics.length === 3) {
          const ev = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
          const from = lc(ev.args.from)
          const to = lc(ev.args.to)
          if (from === ZERO) pool.lpSupply += ev.args.value
          if (to === ZERO) pool.lpSupply -= ev.args.value
          this.w.insert('transfers', { ...base, token: a, from_addr: from, to_addr: to, amount: ev.args.value.toString() })
        }
        continue
      }
      if (pool?.version === 'v3') {
        if (t0 === TOPICS.V3Initialize) {
          const ev = decodeEventLog({ abi: v3PoolAbi, eventName: 'Initialize', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
          pool.sqrtPriceX96 = ev.args.sqrtPriceX96
          pool.tick = ev.args.tick
          pool.liquidity = pool.liquidity ?? 0n
          changed.add(pool)
        } else if (t0 === TOPICS.V3Swap) {
          const ev = decodeEventLog({ abi: v3PoolAbi, eventName: 'Swap', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
          pool.sqrtPriceX96 = ev.args.sqrtPriceX96
          pool.tick = ev.args.tick
          pool.liquidity = ev.args.liquidity
          changed.add(pool)
          pendingSwaps.push({
            pool,
            amount0: ev.args.amount0,
            amount1: ev.args.amount1,
            row: { ...base, pool: a, version: 'v3', origin, sender: lc(ev.args.sender), recipient: lc(ev.args.recipient), amount0: ev.args.amount0.toString(), amount1: ev.args.amount1.toString() },
          })
        } else if (t0 === TOPICS.V3Mint || t0 === TOPICS.V3Burn) {
          const ev = decodeEventLog({ abi: v3PoolAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
          if (ev.eventName !== 'Mint' && ev.eventName !== 'Burn') continue
          const isMint = ev.eventName === 'Mint'
          const { tickLower, tickUpper, amount, amount0, amount1, owner } = ev.args
          if (pool.tick !== null && pool.tick >= tickLower && pool.tick < tickUpper) {
            pool.liquidity = (pool.liquidity ?? 0n) + (isMint ? amount : -amount)
            changed.add(pool)
          }
          pendingLiq.push({
            pool,
            a0: amount0,
            a1: amount1,
            row: { ...base, pool: a, version: 'v3', type: isMint ? 'add' : 'remove', origin, owner: lc(owner), amount0: amount0.toString(), amount1: amount1.toString(), tick_lower: tickLower, tick_upper: tickUpper, liquidity: amount.toString() },
          })
        }
        // v3 pool Collect: token movements are tracked through ERC20 transfers
        continue
      }
      if (a === npm) {
        if (t0 === TOPICS.Transfer && log.topics.length === 4) {
          const ev = decodeEventLog({ abi: npmAbi, eventName: 'Transfer', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
          this.w.insert('nft_transfers', { ...base, token_id: ev.args.tokenId.toString(), from_addr: lc(ev.args.from), to_addr: lc(ev.args.to) })
        } else if (t0 === TOPICS.IncreaseLiquidity || t0 === TOPICS.DecreaseLiquidity || t0 === TOPICS.NpmCollect) {
          const ev = decodeEventLog({ abi: npmAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
          if (ev.eventName === 'IncreaseLiquidity' || ev.eventName === 'DecreaseLiquidity') {
            this.w.insert('nft_events', { ...base, token_id: ev.args.tokenId.toString(), type: ev.eventName === 'IncreaseLiquidity' ? 'increase' : 'decrease', liquidity: ev.args.liquidity.toString(), amount0: ev.args.amount0.toString(), amount1: ev.args.amount1.toString(), origin })
          } else if (ev.eventName === 'Collect') {
            this.w.insert('nft_events', { ...base, token_id: ev.args.tokenId.toString(), type: 'collect', liquidity: null, amount0: ev.args.amount0.toString(), amount1: ev.args.amount1.toString(), origin })
          }
        }
        continue
      }
      if (a === weth && (t0 === TOPICS.Deposit || t0 === TOPICS.Withdrawal)) {
        const ev = decodeEventLog({ abi: weth9Abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        if (ev.eventName === 'Deposit') this.w.insert('weth_events', { ...base, type: 'wrap', account: lc(ev.args.dst), origin, amount: ev.args.wad.toString() })
        else if (ev.eventName === 'Withdrawal') this.w.insert('weth_events', { ...base, type: 'unwrap', account: lc(ev.args.src), origin, amount: ev.args.wad.toString() })
        continue
      }
      if (this.vaults.has(a) && (t0 === TOPICS.VaultDeposit || t0 === TOPICS.VaultWithdraw)) {
        const ev = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        if (ev.eventName === 'Deposit') {
          this.w.insert('earn_events', { ...base, vault: a, type: 'deposit', sender: lc(ev.args.sender), owner: lc(ev.args.owner), receiver: lc(ev.args.owner), assets: ev.args.assets.toString(), shares: ev.args.shares.toString() })
        } else if (ev.eventName === 'Withdraw') {
          this.w.insert('earn_events', { ...base, vault: a, type: 'withdraw', sender: lc(ev.args.sender), owner: lc(ev.args.owner), receiver: lc(ev.args.receiver), assets: ev.args.assets.toString(), shares: ev.args.shares.toString() })
        }
        continue
      }
      if (this.vaults.has(a) && t0 === TOPICS.Transfer && log.topics.length === 3) {
        const ev = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        this.w.insert('transfers', { ...base, token: a, from_addr: lc(ev.args.from), to_addr: lc(ev.args.to), amount: ev.args.value.toString() })
        continue
      }
      if (this.launchpads.has(a) && t0 === TOPICS.LaunchCreated) {
        const ev = decodeEventLog({ abi: launchpadAbi, eventName: 'LaunchCreated', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        const auction = lc(ev.args.auction)
        const token = lc(ev.args.token)
        this.w.insert('launches', { auction, token, launchpad: a, creator: lc(ev.args.creator), name: ev.args.name, symbol: ev.args.symbol, created_block: n, created_ts: ts, params_json: launchMeta.get(auction) ?? null }, 'REPLACE')
        const meta = this.tokens.getSync(token)
        const tokenRow = { address: token, symbol: meta?.symbol ?? ev.args.symbol, name: meta?.name ?? ev.args.name, decimals: meta?.decimals ?? 18 }
        this.w.insert('tokens', tokenRow, 'REPLACE')
        this.tokens.remember(tokenRow)
        this.decimals.set(token, meta?.decimals ?? 18)
        this.auctions.add(auction)
        this.launchedTokens.add(token)
        this.trackedTokens.add(token)
        this.emit('launch', { auction, token })
        continue
      }
      if (this.auctions.has(a) && (t0 === TOPICS.BidPlaced || t0 === TOPICS.Settled || t0 === TOPICS.Claimed)) {
        const ev = decodeEventLog({ abi: launchAuctionAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        if (ev.eventName === 'BidPlaced') {
          this.w.insert('bids', { ...base, auction: a, bid_id: ev.args.bidId.toString(), bidder: lc(ev.args.bidder), amount: ev.args.amount.toString(), max_price: ev.args.maxPrice.toString() })
        } else if (ev.eventName === 'Settled') {
          this.w.insert('settlements', { auction: a, block: n, tx_hash: log.transactionHash!, timestamp: ts, clearing_price: ev.args.clearingPrice.toString(), raised: ev.args.raised.toString(), launched: ev.args.launched ? 1 : 0, pool: ev.args.pool === ZERO ? null : lc(ev.args.pool) }, 'REPLACE')
        } else if (ev.eventName === 'Claimed') {
          this.w.insert('claims', { ...base, auction: a, bid_id: ev.args.bidId.toString(), bidder: lc(ev.args.bidder), tokens: ev.args.tokens.toString(), refund: ev.args.refund.toString() })
        }
        continue
      }
      if (a === reactor && t0 === TOPICS.Fill) {
        const ev = decodeEventLog({ abi: reactorAbi, eventName: 'Fill', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        const orderHash = lc(ev.args.orderHash)
        this.w.insert('fills', { ...base, order_hash: orderHash, filler: lc(ev.args.filler), swapper: lc(ev.args.swapper), nonce: ev.args.nonce.toString() })
        this.w.run(
          "UPDATE x_orders SET status = 'filled', fill_tx = ?, fill_block = ?, filler = ?, updated_at = ? WHERE hash = ?",
          log.transactionHash!, n, lc(ev.args.filler), ts, orderHash,
        )
        fills.push({ orderHash, txHash: log.transactionHash!, block: n, filler: lc(ev.args.filler) })
        continue
      }
      if (t0 === TOPICS.Transfer && log.topics.length === 3 && this.trackedTokens.has(a)) {
        const ev = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        const from = lc(ev.args.from)
        const to = lc(ev.args.to)
        const v = ev.args.value
        this.w.insert('transfers', { ...base, token: a, from_addr: from, to_addr: to, amount: v.toString() })
        // v3 pool balances (TVL) follow token transfers
        for (const [addr, sign] of [[from, -1n], [to, 1n]] as const) {
          const p = this.pools.get(addr)
          if (p?.version !== 'v3') continue
          if (p.token0 === a) p.reserve0 += sign * v
          else if (p.token1 === a) p.reserve1 += sign * v
          changed.add(p)
        }
      }
    }

    if (changed.size === 0 && pendingSwaps.length === 0 && pendingLiq.length === 0) return
    this.recomputePrices(n, ts, changed)
    for (const s of pendingSwaps) {
      const d0 = this.decimals.get(s.pool.token0) ?? 18
      const d1 = this.decimals.get(s.pool.token1) ?? 18
      const usd = swapVolumeUsd(s.amount0, s.amount1, d0, d1, this.prices.get(s.pool.token0), this.prices.get(s.pool.token1))
      const feeRate = s.pool.fee / 1e6
      this.w.insert('swaps', { ...s.row, amount_usd: usd, fee_usd: usd === null ? null : usd * feeRate })
    }
    for (const l of pendingLiq) {
      const d0 = this.decimals.get(l.pool.token0) ?? 18
      const d1 = this.decimals.get(l.pool.token1) ?? 18
      const p0 = this.prices.get(l.pool.token0)
      const p1 = this.prices.get(l.pool.token1)
      const usd = (p0 !== undefined ? (Number(l.a0) / 10 ** d0) * p0 : 0) + (p1 !== undefined ? (Number(l.a1) / 10 ** d1) * p1 : 0)
      this.w.insert('liquidity_events', { ...l.row, amount_usd: p0 === undefined && p1 === undefined ? null : usd })
    }
  }

  private addPool(info: PoolInfo) {
    if (this.pools.has(info.address)) return
    const p: PoolRuntime = { ...info, reserve0: 0n, reserve1: 0n, sqrtPriceX96: null, tick: null, liquidity: info.version === 'v3' ? 0n : null, lpSupply: 0n }
    this.pools.set(info.address, p)
    this.trackedTokens.add(info.token0)
    this.trackedTokens.add(info.token1)
    for (const t of [info.token0, info.token1]) {
      const meta = this.tokens.getSync(t)
      if (meta) {
        this.w.insert('tokens', { address: t, symbol: meta.symbol, name: meta.name, decimals: meta.decimals }, 'REPLACE')
        this.tokens.remember({ address: t, symbol: meta.symbol, name: meta.name, decimals: meta.decimals })
      }
    }
    this.w.insert('pools', {
      address: info.address,
      version: info.version,
      token0: info.token0,
      token1: info.token1,
      fee: info.fee,
      tick_spacing: info.tickSpacing,
      created_block: info.createdBlock,
      created_ts: info.createdTs,
    })
  }

  private stableAddresses(): string[] {
    return this.ctx.deployment.tokens.filter((t) => STABLE_SYMBOLS.has(t.symbol)).map((t) => lc(t.address))
  }

  pricingPools(): PricingPool[] {
    return [...this.pools.values()].map((p) => ({
      address: p.address,
      version: p.version,
      token0: p.token0,
      token1: p.token1,
      reserve0: p.reserve0,
      reserve1: p.reserve1,
      sqrtPriceX96: p.sqrtPriceX96,
      liquidity: p.liquidity,
    }))
  }

  private recomputePrices(block: number, ts: number, changed: Set<PoolRuntime>) {
    const next = computeUsdPrices(this.pricingPools(), this.decimals, this.stableAddresses())
    let pricesChanged = false
    for (const [token, price] of next) {
      const prev = this.prices.get(token)
      if (prev === undefined || Math.abs(prev - price) > Math.abs(prev) * 1e-12) {
        this.w.insert('price_points', { token, block, timestamp: ts, price }, 'REPLACE')
        pricesChanged = true
      }
    }
    this.prices = next
    const toSnapshot = pricesChanged ? [...this.pools.values()] : [...changed]
    for (const p of toSnapshot) {
      const d0 = this.decimals.get(p.token0) ?? 18
      const d1 = this.decimals.get(p.token1) ?? 18
      const tvl = poolTvlUsd(p.reserve0, p.reserve1, d0, d1, this.prices.get(p.token0), this.prices.get(p.token1))
      let price0: number | null = null
      if (p.version === 'v3' && p.sqrtPriceX96) price0 = sqrtPriceToPrice(p.sqrtPriceX96, d0, d1)
      else if (p.version === 'v2' && p.reserve0 > 0n) price0 = Number(p.reserve1) / 10 ** d1 / (Number(p.reserve0) / 10 ** d0)
      this.w.insert(
        'pool_snapshots',
        { pool: p.address, block, timestamp: ts, reserve0: p.reserve0.toString(), reserve1: p.reserve1.toString(), price0, tvl_usd: tvl },
        'REPLACE',
      )
    }
  }
}

export interface VaultInfo {
  address: string
  asset: string
  symbol: string
  apyBps: number
}

/** `deployment.vaults` (Stage 5, merged by DeployStage5). */
export function vaultsOf(d: unknown): VaultInfo[] {
  const v = (d as { vaults?: VaultInfo[] }).vaults
  return Array.isArray(v) ? v : []
}

/** Launchpads named in the deployment (`contracts.Launchpad`, `contracts.DevnetPad`). */
export function launchpadsOf(d: unknown): { key: string; address: string }[] {
  const c = ((d as { contracts?: Record<string, string> }).contracts ?? {}) as Record<string, string>
  return ['Launchpad', 'DevnetPad'].filter((k) => c[k]).map((k) => ({ key: k, address: c[k] }))
}

/** Read an auction's immutable params once (JSON with bigints as strings); null when unreadable. */
export async function readLaunchParams(ctx: Context, auction: string): Promise<string | null> {
  try {
    const raw = await ctx.client.readContract({ address: getAddress(auction), abi: launchParamsAbi, functionName: 'params' })
    return JSON.stringify(raw, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  } catch {
    return null
  }
}
