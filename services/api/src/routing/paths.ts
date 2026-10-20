import { concatHex, numberToHex, type Address, type Hex } from 'viem'

export type Protocol = 'v2' | 'v3'

export interface RoutePool {
  address: string // lower-case
  version: Protocol
  token0: string
  token1: string
  fee: number
}

export interface Hop {
  pool: RoutePool
  tokenIn: string
  tokenOut: string
}

export type Path = Hop[]

export interface PathOptions {
  maxHops?: number
  /** allowed pool versions */
  protocols?: Protocol[]
  /** allow routes that mix v2 and v3 hops */
  mixed?: boolean
}

/**
 * Every simple path (no repeated token) from tokenIn to tokenOut with ≤ maxHops pools.
 * Parallel pools between the same pair (e.g. WETH/mUSDC v2 + v3 0.05% + v3 0.3%) yield distinct paths.
 */
export function enumeratePaths(pools: RoutePool[], tokenIn: string, tokenOut: string, opts: PathOptions = {}): Path[] {
  const maxHops = opts.maxHops ?? 3
  const protocols = new Set(opts.protocols ?? ['v2', 'v3'])
  const mixed = opts.mixed ?? true
  const adj = new Map<string, RoutePool[]>()
  for (const p of pools) {
    if (!protocols.has(p.version)) continue
    for (const t of [p.token0, p.token1]) {
      let arr = adj.get(t)
      if (!arr) adj.set(t, (arr = []))
      arr.push(p)
    }
  }
  const out: Path[] = []
  const visited = new Set<string>([tokenIn])
  const walk = (token: string, path: Path) => {
    if (path.length >= maxHops) return
    for (const p of adj.get(token) ?? []) {
      const next = p.token0 === token ? p.token1 : p.token0
      if (visited.has(next)) continue
      if (!mixed && path.length && path[0].pool.version !== p.version) continue
      const hop = { pool: p, tokenIn: token, tokenOut: next }
      if (next === tokenOut) {
        out.push([...path, hop])
        continue
      }
      visited.add(next)
      walk(next, [...path, hop])
      visited.delete(next)
    }
  }
  if (tokenIn !== tokenOut) walk(tokenIn, [])
  return out
}

export function pathVersion(path: Path): Protocol | 'mixed' {
  const v = path[0].pool.version
  return path.every((h) => h.pool.version === v) ? v : 'mixed'
}

/** Split a path into maximal runs of the same protocol (used to encode mixed routes). */
export function segments(path: Path): Path[] {
  const out: Path[] = []
  for (const hop of path) {
    const last = out[out.length - 1]
    if (last && last[0].pool.version === hop.pool.version) last.push(hop)
    else out.push([hop])
  }
  return out
}

/** Packed V3 path: token(20) | fee(3) | token(20) … ; reversed for exact output. */
export function encodeV3Path(hops: Path, reverse = false): Hex {
  const tokens = [hops[0].tokenIn, ...hops.map((h) => h.tokenOut)] as Address[]
  const fees = hops.map((h) => h.pool.fee)
  if (reverse) {
    tokens.reverse()
    fees.reverse()
  }
  const parts: Hex[] = [tokens[0] as Hex]
  for (let i = 0; i < fees.length; i++) {
    parts.push(numberToHex(fees[i], { size: 3 }), tokens[i + 1] as Hex)
  }
  return concatHex(parts).toLowerCase() as Hex
}

export function decodeV3Path(path: Hex): { tokens: string[]; fees: number[] } {
  const hex = path.slice(2)
  const tokens: string[] = []
  const fees: number[] = []
  let i = 0
  tokens.push(`0x${hex.slice(i, i + 40)}`)
  i += 40
  while (i < hex.length) {
    fees.push(parseInt(hex.slice(i, i + 6), 16))
    i += 6
    tokens.push(`0x${hex.slice(i, i + 40)}`)
    i += 40
  }
  return { tokens, fees }
}

export function pathPools(path: Path): string[] {
  return path.map((h) => h.pool.address)
}
