import { API_URL } from '@/config'
import { ApiError } from '@/lib/errors'

type Query = Record<string, string | number | boolean | undefined | null>

function qs(params?: Query): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorFrom(res: Response, body: unknown): ApiError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const msg = (typeof b.error === 'string' && b.error) || (typeof b.message === 'string' && b.message) || (typeof body === 'string' && body) || `${res.status} ${res.statusText}`
  const code = typeof b.code === 'string' ? b.code : undefined
  return new ApiError(msg, res.status, code, body)
}

/** Thin typed fetch wrapper for services/api. Network failures become ApiError(status 0). */
export async function apiGet<T>(path: string, params?: Query, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}${qs(params)}`, { ...init, headers: { accept: 'application/json', ...init?.headers } })
  } catch (e) {
    throw new ApiError(`Could not reach the MetaSwap API at ${API_URL}`, 0, 'NETWORK', e)
  }
  const body = await parse(res)
  if (!res.ok) throw errorFrom(res, body)
  return body as T
}

export async function apiPost<T>(path: string, data: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    })
  } catch (e) {
    throw new ApiError(`Could not reach the MetaSwap API at ${API_URL}`, 0, 'NETWORK', e)
  }
  const body = await parse(res)
  if (!res.ok) throw errorFrom(res, body)
  return body as T
}

/** Unwrap `{ items: [...] }` / `{ orders: [...] }` / bare arrays. */
export function asList<T>(body: unknown, ...keys: string[]): T[] {
  if (Array.isArray(body)) return body as T[]
  if (body && typeof body === 'object') {
    for (const k of [...keys, 'items', 'data', 'results', 'rows']) {
      const v = (body as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v as T[]
    }
  }
  return []
}
