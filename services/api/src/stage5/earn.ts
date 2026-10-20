import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, type Address, type Hex } from 'viem'
import { vaultAbi } from '../abis'
import type { Analytics } from '../analytics'
import { HttpError, lc, tokenJson, type Context } from '../context'
import { vaultsOf, type Indexer, type VaultInfo } from '../indexer/indexer'
import type { Router } from '../routing/router'

type Call = { target: Address; callData: Hex }

/** Earn vaults (ERC-4626 savings vaults, STAGE5 §1a/§3). */
export class Earn {
  constructor(
    private ctx: Context,
    private indexer: Indexer,
    private analytics: Analytics,
    private router: Router,
  ) {}

  vaultList(): VaultInfo[] {
    return vaultsOf(this.ctx.deployment)
  }

  private assetToken(v: VaultInfo) {
    const t = this.indexer.tokens.getSync(v.asset)
    if (!t) throw new HttpError(500, `vault asset ${v.asset} unknown`)
    return t
  }

  /** Reads `fn` on every vault (optionally with args) at `blockNumber`. */
  private async readAll(fns: { fn: 'totalAssets' | 'totalSupply' | 'apyBps' | 'balanceOf' | 'convertToAssets'; args?: (v: VaultInfo) => readonly unknown[] }[], blockNumber?: bigint) {
    const vaults = this.vaultList()
    const calls: Call[] = []
    for (const v of vaults)
      for (const f of fns)
        calls.push({ target: getAddress(v.address), callData: encodeFunctionData({ abi: vaultAbi, functionName: f.fn, args: (f.args?.(v) ?? []) as never }) })
    const block = blockNumber ?? (await this.ctx.client.getBlockNumber({ cacheTime: 0 }))
    const res = await this.router.multicall(calls, block)
    return vaults.map((v, i) =>
      fns.map((f, j) => {
        const r = res[i * fns.length + j]
        if (!r.success || r.returnData === '0x') return null
        return decodeFunctionResult({ abi: vaultAbi, functionName: f.fn, data: r.returnData }) as bigint
      }),
    )
  }

  /** Distinct addresses holding vault shares (from indexed share transfers). */
  async depositors(vault: string): Promise<number> {
    const rows = await this.ctx.db.all<{ to_addr: string; from_addr: string; amount: string }>('SELECT from_addr, to_addr, amount FROM transfers WHERE token = ?', lc(vault))
    const bal = new Map<string, bigint>()
    for (const r of rows) {
      bal.set(r.to_addr, (bal.get(r.to_addr) ?? 0n) + BigInt(r.amount))
      bal.set(r.from_addr, (bal.get(r.from_addr) ?? 0n) - BigInt(r.amount))
    }
    let n = 0
    for (const [a, b] of bal) if (a !== '0x0000000000000000000000000000000000000000' && b > 0n) n++
    return n
  }

  async vaults() {
    const vs = this.vaultList()
    if (!vs.length) return []
    const data = await this.readAll([{ fn: 'totalAssets' }, { fn: 'totalSupply' }, { fn: 'apyBps' }])
    const depositors = await Promise.all(vs.map((v) => this.depositors(v.address)))
    return vs.map((v, i) => {
      const [totalAssets, totalSupply, apy] = data[i]
      const asset = this.assetToken(v)
      const apyBps = apy !== null ? Number(apy) : v.apyBps
      const price = this.analytics.priceUsd(asset.address)
      const assets = totalAssets ?? 0n
      return {
        address: getAddress(v.address),
        asset: tokenJson(this.ctx, asset),
        symbol: v.symbol,
        apyBps,
        apyPct: apyBps / 100,
        totalAssets: assets.toString(),
        totalAssetsFormatted: Number(assets) / 10 ** asset.decimals,
        totalShares: (totalSupply ?? 0n).toString(),
        tvlUsd: price === null ? null : (Number(assets) / 10 ** asset.decimals) * price,
        depositors: depositors[i],
      }
    })
  }

  async vault(address: string) {
    const v = (await this.vaults()).find((x) => lc(x.address) === lc(address))
    if (!v) throw new HttpError(404, 'Unknown vault')
    return v
  }

  /**
   * Account positions. Principal accounting is per vault in asset units:
   * deposited = Σ Deposit.assets (owner = account) − Σ Withdraw.assets (owner = account);
   * lifetime earnings = current assets + withdrawn − deposited. USD values use today's price for
   * earnings and the price at each deposit/withdrawal for `depositedUsd`.
   */
  async account(address: string, blockNumber?: bigint) {
    if (!isAddress(address, { strict: false })) throw new HttpError(400, 'invalid address')
    const owner = getAddress(address)
    const vs = this.vaultList()
    if (!vs.length) return []
    const balances = await this.readAll([{ fn: 'balanceOf', args: () => [owner] }], blockNumber)
    const shares = balances.map((b) => b[0] ?? 0n)
    const assetsRes = await this.readAll([{ fn: 'convertToAssets', args: (v) => [shares[vs.indexOf(v)]] }], blockNumber)
    const out = []
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]
      const asset = this.assetToken(v)
      const events = await this.ctx.db.all<{ type: string; assets: string; timestamp: number }>('SELECT type, assets, timestamp FROM earn_events WHERE vault = ? AND owner = ? ORDER BY block, log_index', lc(v.address), lc(owner))
      if (shares[i] === 0n && events.length === 0) continue
      const assets = shares[i] === 0n ? 0n : (assetsRes[i][0] ?? 0n)
      let deposited = 0n
      let withdrawn = 0n
      let depositedUsd = 0
      for (const e of events) {
        const amt = BigInt(e.assets)
        const usd = (Number(amt) / 10 ** asset.decimals) * ((await this.analytics.priceAt(asset.address, Number(e.timestamp))) ?? 0)
        if (e.type === 'deposit') {
          deposited += amt
          depositedUsd += usd
        } else {
          withdrawn += amt
          depositedUsd -= usd
        }
      }
      const price = this.analytics.priceUsd(asset.address)
      const earnings = assets + withdrawn - deposited
      const human = (x: bigint) => Number(x) / 10 ** asset.decimals
      out.push({
        vault: { address: getAddress(v.address), symbol: v.symbol, apyBps: v.apyBps, apyPct: v.apyBps / 100, asset: tokenJson(this.ctx, asset) },
        shares: shares[i].toString(),
        assets: assets.toString(),
        assetsFormatted: human(assets),
        valueUsd: price === null ? null : human(assets) * price,
        deposited: (deposited - withdrawn).toString(),
        depositedUsd,
        lifetimeEarnings: earnings.toString(),
        lifetimeEarningsUsd: price === null ? null : human(earnings) * price,
      })
    }
    return out
  }
}
