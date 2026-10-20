import { decodeErrorResult, toFunctionSelector, type Hex } from 'viem'
import { knownErrorsAbi } from './abis'

export type TxErrorKind =
  | 'rejected'
  | 'slippage'
  | 'deadline'
  | 'insufficient-balance'
  | 'insufficient-gas'
  | 'allowance'
  | 'permit'
  | 'liquidity'
  | 'quote-expired'
  | 'api-down'
  | 'reverted'
  | 'unknown'

export interface FriendlyError {
  kind: TxErrorKind
  title: string
  message: string
  /** Original technical message for a "details" disclosure. */
  detail?: string
}

/** Error thrown by the API client; carries HTTP status + body. */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly body?: unknown
  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

const SELECTORS: Record<string, string> = Object.fromEntries(
  knownErrorsAbi.map((item) => {
    const sig = `${item.name}(${item.inputs.map((i) => i.type).join(',')})`
    return [toFunctionSelector(sig).toLowerCase(), item.name]
  }),
)

interface Collected {
  texts: string[]
  codes: number[]
  datas: string[]
  names: string[]
}

function collect(err: unknown, depth = 0, out: Collected = { texts: [], codes: [], datas: [], names: [] }): Collected {
  if (!err || depth > 6) return out
  if (typeof err === 'string') {
    out.texts.push(err)
    return out
  }
  if (typeof err !== 'object') return out
  const e = err as Record<string, unknown>
  for (const k of ['shortMessage', 'message', 'details', 'reason']) if (typeof e[k] === 'string') out.texts.push(e[k] as string)
  if (typeof e.name === 'string') out.names.push(e.name)
  if (typeof e.code === 'number') out.codes.push(e.code)
  if (typeof e.data === 'string' && e.data.startsWith('0x')) out.datas.push(e.data)
  if (e.data && typeof e.data === 'object') {
    const d = e.data as Record<string, unknown>
    if (typeof d.data === 'string') out.datas.push(d.data)
    if (typeof d.errorName === 'string') out.names.push(d.errorName)
  }
  if (e.cause) collect(e.cause, depth + 1, out)
  return out
}

/** Find a known custom-error name from revert data or the selector printed in a message. */
export function revertErrorName(err: unknown): string | undefined {
  const { texts, datas, names } = collect(err)
  const known = new Set(Object.values(SELECTORS))
  for (const n of names) if (known.has(n)) return n
  for (const d of datas) {
    try {
      return decodeErrorResult({ abi: knownErrorsAbi, data: d as Hex }).errorName
    } catch {
      const hit = SELECTORS[d.slice(0, 10).toLowerCase()]
      if (hit) return hit
    }
  }
  const joined = texts.join(' \n ')
  for (const m of joined.matchAll(/0x[0-9a-fA-F]{8}/g)) {
    const hit = SELECTORS[m[0].toLowerCase()]
    if (hit) return hit
  }
  for (const name of known) if (joined.includes(name)) return name
  return undefined
}

const SLIPPAGE_ERRORS = new Set(['V2TooLittleReceived', 'V3TooLittleReceived', 'V2TooMuchRequested', 'V3TooMuchRequested'])
const LIQUIDITY_ERRORS = new Set(['V2InvalidReserves', 'V3InvalidSwap', 'V3PoolNotFound', 'V2PairNotFound'])

/** Map any wallet / RPC / API / revert error to user-facing copy (docs/analysis/flows.md §4.3, §13). */
export function parseTxError(err: unknown, ctx: { slippagePct?: string } = {}): FriendlyError {
  const { texts, codes, names } = collect(err)
  const text = texts.join(' \n ')
  const detail = texts[0]

  if (
    codes.includes(4001) ||
    names.includes('UserRejectedRequestError') ||
    /user (rejected|denied|cancel)|rejected the request|request rejected|user disapproved/i.test(text)
  )
    return { kind: 'rejected', title: 'Request rejected', message: 'You rejected the request in your wallet.', detail }

  if (err instanceof ApiError) {
    if (err.status === 410 || err.code === 'QUOTE_EXPIRED' || /expired/i.test(err.message))
      return { kind: 'quote-expired', title: 'Quote expired', message: 'This quote is older than 30 seconds. Refresh to get a new price.', detail: err.message }
    if (/no route|liquidity/i.test(err.message))
      return { kind: 'liquidity', title: 'No route found', message: 'There is not enough liquidity to route this trade.', detail: err.message }
    if (err.status >= 500 || err.status === 0)
      return { kind: 'api-down', title: 'MetaSwap API unavailable', message: 'The quote service did not respond. Check that the API is running and try again.', detail: err.message }
    return { kind: 'unknown', title: 'Request failed', message: err.message, detail: err.message }
  }
  if (names.includes('TypeError') && /fetch|network|load failed/i.test(text))
    return { kind: 'api-down', title: 'MetaSwap API unavailable', message: 'Could not reach the MetaSwap API. Check that it is running and try again.', detail }

  const custom = revertErrorName(err)
  if ((custom && SLIPPAGE_ERRORS.has(custom)) || /too little received|insufficient_output_amount|excessive_input_amount|too much requested/i.test(text))
    return {
      kind: 'slippage',
      title: 'Price moved',
      message: `The price moved beyond your slippage tolerance${ctx.slippagePct ? ` (${ctx.slippagePct})` : ''}. Increase slippage or refresh the quote.`,
      detail,
    }
  if (custom === 'TransactionDeadlinePassed' || /deadline passed|transaction too old/i.test(text))
    return { kind: 'deadline', title: 'Deadline passed', message: 'The transaction deadline passed before it was mined. Refresh the quote and try again.', detail }
  if (custom === 'SignatureExpired' || custom === 'AllowanceExpired' || custom === 'InvalidNonce' || /invalidsignature|signature expired/i.test(text))
    return { kind: 'permit', title: 'Permit no longer valid', message: 'The Permit2 signature expired or was already used. Sign again.', detail }
  if (custom === 'InsufficientAllowance' || /transfer_from_failed|insufficient allowance/i.test(text))
    return { kind: 'allowance', title: 'Approval missing', message: 'The token approval is missing or too low. Approve again and retry.', detail }
  if (/insufficient funds/i.test(text))
    return { kind: 'insufficient-gas', title: 'Not enough ETH', message: 'Your ETH balance cannot cover this amount plus network fees. Keep some ETH for gas.', detail }
  if (custom === 'InsufficientToken' || custom === 'InsufficientETH' || custom === 'BalanceTooLow' || /exceeds balance|insufficient balance/i.test(text))
    return { kind: 'insufficient-balance', title: 'Insufficient balance', message: 'Your balance is too low for this transaction.', detail }
  if ((custom && LIQUIDITY_ERRORS.has(custom)) || /insufficient_liquidity/i.test(text))
    return { kind: 'liquidity', title: 'Not enough liquidity', message: 'The pools cannot fill this amount. Try a smaller trade.', detail }
  if (/reverted|status 0/i.test(text))
    return { kind: 'reverted', title: 'Transaction failed', message: 'The transaction reverted. Try again with a higher slippage tolerance.', detail }
  const short = texts.find((t) => t.length < 160)
  return { kind: 'unknown', title: 'Something went wrong', message: short ?? 'Unexpected error.', detail }
}

export function isUserRejection(err: unknown): boolean {
  return parseTxError(err).kind === 'rejected'
}
