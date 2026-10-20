import { describe, expect, it } from 'vitest'
import type { Token } from '@metaswap/sdk'
import { getWrapType, swapReducer, type SwapFormState } from './swapReducer'

const tok = (symbol: string, address: string, extra: Partial<Token> = {}): Token => ({
  chainId: 31337,
  address: address as `0x${string}`,
  symbol,
  name: symbol,
  decimals: 18,
  logoURI: '',
  ...extra,
})
const ETH = tok('ETH', '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', { isNative: true })
const WETH = tok('WETH', '0x5FbDB2315678afecb367f032d93F642f64180aa3')
const USDC = tok('mUSDC', '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318', { decimals: 6 })

const base: SwapFormState = { independentField: 'INPUT', typedValue: '', inputToken: ETH, outputToken: undefined }

describe('swapReducer', () => {
  it('selects tokens per field', () => {
    const s = swapReducer(base, { type: 'selectToken', field: 'OUTPUT', token: USDC })
    expect(s.outputToken).toBe(USDC)
    expect(s.inputToken).toBe(ETH)
  })
  it('selecting the other side token swaps sides and flips the independent field', () => {
    const s0: SwapFormState = { independentField: 'INPUT', typedValue: '1', inputToken: ETH, outputToken: USDC }
    const s = swapReducer(s0, { type: 'selectToken', field: 'INPUT', token: USDC })
    expect(s.inputToken).toBe(USDC)
    expect(s.outputToken).toBe(ETH)
    expect(s.independentField).toBe('OUTPUT')
    expect(s.typedValue).toBe('1')
  })
  it('typing switches exact-in / exact-out', () => {
    let s = swapReducer(base, { type: 'typeInput', field: 'INPUT', value: '1' })
    expect(s).toMatchObject({ independentField: 'INPUT', typedValue: '1' })
    s = swapReducer(s, { type: 'typeInput', field: 'OUTPUT', value: '3000' })
    expect(s).toMatchObject({ independentField: 'OUTPUT', typedValue: '3000' })
  })
  it('flip swaps tokens and keeps the typed amount with its token', () => {
    const s0: SwapFormState = { independentField: 'INPUT', typedValue: '2', inputToken: ETH, outputToken: USDC }
    const s = swapReducer(s0, { type: 'flip' })
    expect(s).toEqual({ independentField: 'OUTPUT', typedValue: '2', inputToken: USDC, outputToken: ETH })
    expect(swapReducer(s, { type: 'flip' })).toEqual(s0)
  })
  it('setTokens drops a duplicate output', () => {
    const s = swapReducer(base, { type: 'setTokens', input: USDC, output: USDC })
    expect(s.inputToken).toBe(USDC)
    expect(s.outputToken).toBeUndefined()
  })
  it('clearAmount resets the typed value only', () => {
    const s = swapReducer({ ...base, typedValue: '5', outputToken: USDC }, { type: 'clearAmount' })
    expect(s.typedValue).toBe('')
    expect(s.outputToken).toBe(USDC)
  })
})

describe('getWrapType', () => {
  it('detects wrap and unwrap', () => {
    expect(getWrapType(ETH, WETH, WETH.address)).toBe('wrap')
    expect(getWrapType(WETH, ETH, WETH.address.toLowerCase())).toBe('unwrap')
    expect(getWrapType(ETH, USDC, WETH.address)).toBeNull()
    expect(getWrapType(ETH, WETH, undefined)).toBeNull()
  })
})
