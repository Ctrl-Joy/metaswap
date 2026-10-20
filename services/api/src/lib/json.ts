/** Deep-convert bigints to decimal strings so a value can go through JSON.stringify. */
export function jsonSafe<T>(value: T): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = jsonSafe(v)
    return out
  }
  return value
}
