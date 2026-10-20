import { describe, expect, it } from 'vitest'
import { encodeErrorResult, parseAbi } from 'viem'
import type { Token } from '@metaswap/sdk'
import { ApiError, parseTxError } from './errors'
import { normalizeTypedData, inferPrimaryType } from './typedData'
import { searchTokens, sortByBalance, isUnknownAddress } from '@/features/tokens/tokenSearch'
import { checkRecipient } from '@/features/send/sendValidation'
import { slippageWarning, effectiveSlippageBps, protocolsParam } from '@/state/settings'
import { buildSwapSteps, requiredInputAmount } from '@/features/swap/executeSwap'

describe('parseTxError', () => {
  it('detects user rejection', () => {
    expect(parseTxError({ code: 4001, message: 'User rejected the request.' }).kind).toBe('rejected')
    expect(parseTxError({ name: 'UserRejectedRequestError', message: 'x' }).kind).toBe('rejected')
  })
  it('decodes router slippage errors from revert data', () => {
    const data = encodeErrorResult({ abi: parseAbi(['error V3TooLittleReceived()']), errorName: 'V3TooLittleReceived' })
    const e = parseTxError({ message: 'execution reverted', cause: { data } }, { slippagePct: '0.5%' })
    expect(e.kind).toBe('slippage')
    expect(e.message).toContain('0.5%')
  })
  it('finds a selector printed in the message', () => {
    const data = encodeErrorResult({ abi: parseAbi(['error TransactionDeadlinePassed()']), errorName: 'TransactionDeadlinePassed' })
    expect(parseTxError({ shortMessage: `reverted with the following signature: ${data}` }).kind).toBe('deadline')
  })
  it('maps balance and gas errors', () => {
    expect(parseTxError(new Error('ERC20: transfer amount exceeds balance')).kind).toBe('insufficient-balance')
    expect(parseTxError(new Error('insufficient funds for gas * price + value')).kind).toBe('insufficient-gas')
  })
  it('maps API errors', () => {
    expect(parseTxError(new ApiError('Quote expired or unknown; request a new quote', 410)).kind).toBe('quote-expired')
    expect(parseTxError(new ApiError('Could not reach', 0)).kind).toBe('api-down')
    expect(parseTxError(new ApiError('Insufficient liquidity for this trade', 404)).kind).toBe('liquidity')
  })
})

describe('normalizeTypedData', () => {
  const payload = {
    domain: { name: 'Permit2', chainId: '31337', verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' },
    types: {
      EIP712Domain: [{ name: 'name', type: 'string' }],
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    values: { details: { token: '0x5FbDB2315678afecb367f032d93F642f64180aa3', amount: '100', expiration: '5', nonce: '0' }, spender: '0x5FbDB2315678afecb367f032d93F642f64180aa3', sigDeadline: '99' },
  }
  it('coerces numbers and infers the primary type', () => {
    const n = normalizeTypedData(payload)
    expect(n.primaryType).toBe('PermitSingle')
    expect(n.domain.chainId).toBe(31337)
    expect(n.types.EIP712Domain).toBeUndefined()
    expect(n.message).toMatchObject({ sigDeadline: 99n, details: { amount: 100n, expiration: 5n, nonce: 0n } })
  })
  it('inferPrimaryType throws when ambiguous', () => {
    expect(() => inferPrimaryType({ A: [], B: [] })).toThrow()
  })
})

const t = (symbol: string, name: string, address: string, extra: Partial<Token> = {}): Token => ({ chainId: 31337, symbol, name, address: address as `0x${string}`, decimals: 18, logoURI: '', ...extra })
const LIST = [
  t('ETH', 'Ether', '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', { isNative: true }),
  t('WETH', 'Wrapped Ether', '0x5FbDB2315678afecb367f032d93F642f64180aa3'),
  t('mUSDC', 'Meta USD Coin', '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318', { decimals: 6 }),
  t('META', 'MetaSwap', '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82'),
]

describe('token search', () => {
  it('ranks exact symbol first, then prefixes, names', () => {
    expect(searchTokens(LIST, 'eth').map((x) => x.symbol)).toEqual(['ETH', 'WETH'])
    expect(searchTokens(LIST, 'usdc').map((x) => x.symbol)).toEqual(['mUSDC'])
    expect(searchTokens(LIST, 'meta').map((x) => x.symbol)[0]).toBe('META')
    expect(searchTokens(LIST, 'wrapped').map((x) => x.symbol)).toEqual(['WETH'])
  })
  it('matches by address', () => {
    expect(searchTokens(LIST, '0x8a791620dd6260079bf849dc5567adc3f2fdc318').map((x) => x.symbol)).toEqual(['mUSDC'])
    expect(searchTokens(LIST, '0x5FbD').map((x) => x.symbol)).toEqual(['WETH'])
  })
  it('detects unknown addresses for import', () => {
    expect(isUnknownAddress('0x1111111111111111111111111111111111111111', LIST)).toBe(true)
    expect(isUnknownAddress(LIST[1]!.address, LIST)).toBe(false)
    expect(isUnknownAddress('0x123', LIST)).toBe(false)
  })
  it('sorts holdings by USD value first', () => {
    const balances = { [LIST[2]!.address.toLowerCase()]: 5_000_000n, [LIST[3]!.address.toLowerCase()]: 10n ** 18n }
    const prices = { [LIST[2]!.address.toLowerCase()]: 1, [LIST[3]!.address.toLowerCase()]: 8 }
    expect(sortByBalance(LIST, balances, prices).map((x) => x.symbol)).toEqual(['META', 'mUSDC', 'ETH', 'WETH'])
  })
})

describe('checkRecipient', () => {
  it('validates addresses', () => {
    expect(checkRecipient('')).toEqual({ ok: false, error: 'empty' })
    expect(checkRecipient('0x123')).toEqual({ ok: false, error: 'invalid' })
    expect(checkRecipient('0x0000000000000000000000000000000000000000')).toEqual({ ok: false, error: 'zero' })
    expect(checkRecipient(LIST[2]!.address, { knownTokens: LIST })).toEqual({ ok: false, error: 'token-contract' })
    const ok = checkRecipient('0x90f79bf6eb2c4f870365e785982e1f101e93b906')
    expect(ok).toEqual({ ok: true, address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' })
    expect(checkRecipient('0x90F79bf6EB2c4f870365E785982E1f101E93b906', { self: '0x90f79bf6eb2c4f870365e785982e1f101e93b906' })).toMatchObject({ warning: 'self' })
    expect(checkRecipient('0x90F79bf6EB2c4f870365E785982E1f101E93B906')).toMatchObject({ ok: true, warning: 'checksum' })
  })
})

describe('settings helpers', () => {
  it('slippage warnings', () => {
    expect(slippageWarning('')).toBeNull()
    expect(slippageWarning('0.01')).toBe('too-low')
    expect(slippageWarning('0.5')).toBeNull()
    expect(slippageWarning('6')).toBe('too-high')
    expect(slippageWarning('51')).toBe('invalid')
  })
  it('effective slippage falls back to auto', () => {
    expect(effectiveSlippageBps({ slippageMode: 'auto', customSlippage: '' })).toBe(50)
    expect(effectiveSlippageBps({ slippageMode: 'custom', customSlippage: '1.25' })).toBe(125)
    expect(effectiveSlippageBps({ slippageMode: 'custom', customSlippage: '80' })).toBe(50)
  })
  it('protocols param', () => {
    expect(protocolsParam(true, true)).toBe('v2,v3,mixed')
    expect(protocolsParam(true, false)).toBe('v2')
    expect(protocolsParam(false, true)).toBe('v3')
  })
})

describe('swap steps', () => {
  it('orders approve → permit → swap and skips what is not needed', () => {
    expect(buildSwapSteps({ wrapType: null, needsApproval: true, needsPermit: true, inputSymbol: 'mUSDC' }).map((s) => s.id)).toEqual(['approve', 'permit', 'swap'])
    expect(buildSwapSteps({ wrapType: null, needsApproval: false, needsPermit: false, inputSymbol: 'ETH' }).map((s) => s.id)).toEqual(['swap'])
    expect(buildSwapSteps({ wrapType: 'wrap', needsApproval: true, needsPermit: true, inputSymbol: 'ETH' }).map((s) => s.id)).toEqual(['wrap'])
  })
  it('uses amountInMax for exact output', () => {
    expect(requiredInputAmount({ amountIn: '100', amountInMax: '105' }, true)).toBe(105n)
    expect(requiredInputAmount({ amountIn: '100', amountInMax: '105' }, false)).toBe(100n)
  })
})
