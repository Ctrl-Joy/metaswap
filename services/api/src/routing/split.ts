/**
 * Split-route optimiser (in the spirit of Uniswap's alpha router).
 *
 * Each candidate route r has quotes at 5% increments: `quotes[r][i]` is the output (exact input)
 * or required input (exact output) for i×5% of the trade, or null when the route cannot fill it.
 * We search 1, 2 and 3-route combinations whose percentages add to 100 and whose pools are
 * disjoint (independent quotes are only valid when routes don't touch the same pool), scoring
 * each by amount net of the routes' gas cost (expressed in the same token).
 */

export const STEP_PCT = 5
export const STEPS = 100 / STEP_PCT // 20

export interface SplitCandidate {
  /** pools the route touches (for the disjointness rule) */
  pools: string[]
  /** index i (0..20) → amount for i*5% of the trade */
  quotes: (bigint | null)[]
  /** gas cost of including this route, in the quoted token's base units */
  gasCost: bigint
}

export interface SplitResult {
  /** (route index, percent) pairs, percents sum to 100 */
  parts: { route: number; pct: number }[]
  /** Σ quoted amounts (output for exact-in, input for exact-out) */
  amount: bigint
  /** amount net of gas (exact-in: amount - gas, exact-out: amount + gas) */
  score: bigint
}

export function optimizeSplit(
  candidates: SplitCandidate[],
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT',
  maxRoutes = 3,
): SplitResult | null {
  const exactIn = type === 'EXACT_INPUT'
  const better = (a: bigint, b: bigint) => (exactIn ? a > b : a < b)
  const value = (r: number, i: number): bigint | null => candidates[r].quotes[i] ?? null
  const net = (amt: bigint, gas: bigint) => (exactIn ? amt - gas : amt + gas)
  let best: SplitResult | null = null
  const consider = (parts: { route: number; pct: number }[]) => {
    let amount = 0n
    let gas = 0n
    for (const p of parts) {
      const v = value(p.route, p.pct / STEP_PCT)
      if (v === null || (exactIn && v <= 0n)) return
      amount += v
      gas += candidates[p.route].gasCost
    }
    const score = net(amount, gas)
    if (!best || better(score, best.score)) best = { parts, amount, score }
  }
  const disjoint = (...rs: number[]) => {
    const seen = new Set<string>()
    for (const r of rs) for (const p of candidates[r].pools) {
      if (seen.has(p)) return false
      seen.add(p)
    }
    return true
  }
  const n = candidates.length
  for (let a = 0; a < n; a++) consider([{ route: a, pct: 100 }])
  if (maxRoutes >= 2) {
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        if (!disjoint(a, b)) continue
        for (let i = 1; i < STEPS; i++) consider([{ route: a, pct: i * STEP_PCT }, { route: b, pct: 100 - i * STEP_PCT }])
      }
  }
  if (maxRoutes >= 3) {
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        if (!disjoint(a, b)) continue
        for (let c = b + 1; c < n; c++) {
          if (!disjoint(a, b, c)) continue
          for (let i = 1; i < STEPS - 1; i++)
            for (let j = 1; i + j < STEPS; j++)
              consider([
                { route: a, pct: i * STEP_PCT },
                { route: b, pct: j * STEP_PCT },
                { route: c, pct: 100 - (i + j) * STEP_PCT },
              ])
        }
      }
  }
  if (!best) return null
  const result = best as SplitResult
  result.parts.sort((x, y) => y.pct - x.pct)
  return result
}

/** Amount for `pct` percent of `total`; the parts of a split are assigned so they sum exactly to total. */
export function splitAmounts(total: bigint, pcts: number[]): bigint[] {
  const out = pcts.map((p) => (total * BigInt(p)) / 100n)
  const assigned = out.reduce((a, b) => a + b, 0n)
  out[0] += total - assigned
  return out
}
