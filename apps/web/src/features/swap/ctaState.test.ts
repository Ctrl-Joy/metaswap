import { describe, expect, it } from 'vitest'
import { deriveSwapCta, impactSeverity, type CtaInput } from './ctaState'

const ready: CtaInput = {
  isConnected: true,
  wrongNetwork: false,
  hasInputToken: true,
  hasOutputToken: true,
  amount: 10n ** 18n,
  wrapType: null,
  quoteStatus: 'success',
  inputSymbol: 'ETH',
  inputBalance: 5n * 10n ** 18n,
  requiredInput: 10n ** 18n,
  needsApproval: false,
  priceImpactBps: 10,
}

describe('deriveSwapCta', () => {
  it('asks to connect when signed out (before anything else)', () => {
    const s = deriveSwapCta({ ...ready, isConnected: false, amount: null })
    expect(s).toMatchObject({ label: 'Connect wallet', action: 'connect', disabled: false })
  })
  it('asks to switch on the wrong network', () => {
    expect(deriveSwapCta({ ...ready, wrongNetwork: true })).toMatchObject({ action: 'switch-network', disabled: false })
  })
  it('requires both tokens', () => {
    expect(deriveSwapCta({ ...ready, hasOutputToken: false })).toMatchObject({ label: 'Select a token', disabled: true })
  })
  it('rejects identical tokens', () => {
    expect(deriveSwapCta({ ...ready, sameToken: true }).label).toBe('Select different tokens')
  })
  it('requires an amount', () => {
    expect(deriveSwapCta({ ...ready, amount: null })).toMatchObject({ label: 'Enter an amount', disabled: true })
    expect(deriveSwapCta({ ...ready, amount: 0n })).toMatchObject({ label: 'Enter an amount', disabled: true })
  })
  it('shows a loading state while quoting or when the quote is stale', () => {
    expect(deriveSwapCta({ ...ready, quoteStatus: 'loading' })).toMatchObject({ disabled: true, loading: true })
    expect(deriveSwapCta({ ...ready, quoteStale: true })).toMatchObject({ disabled: true, loading: true })
  })
  it('reports no route / insufficient liquidity', () => {
    expect(deriveSwapCta({ ...ready, quoteStatus: 'no-route' })).toMatchObject({ disabled: true, tone: 'critical' })
  })
  it('offers retry when the API is down', () => {
    const s = deriveSwapCta({ ...ready, quoteStatus: 'error', apiDown: true })
    expect(s.action).toBe('retry')
    expect(s.label).toMatch(/unavailable/i)
  })
  it('flags insufficient balance against the required input', () => {
    const s = deriveSwapCta({ ...ready, inputBalance: 1n, requiredInput: 2n })
    expect(s).toMatchObject({ label: 'Insufficient ETH balance', disabled: true, tone: 'critical' })
  })
  it('uses amountInMax for exact-out (required > balance even though amountIn fits)', () => {
    const s = deriveSwapCta({ ...ready, inputBalance: 100n, requiredInput: 101n })
    expect(s.label).toMatch(/Insufficient/)
  })
  it('says approve when Permit2 allowance is missing', () => {
    expect(deriveSwapCta({ ...ready, inputSymbol: 'mUSDC', needsApproval: true })).toMatchObject({ label: 'Approve mUSDC and swap', action: 'review' })
  })
  it('is ready to review', () => {
    expect(deriveSwapCta(ready)).toMatchObject({ label: 'Review', action: 'review', disabled: false, tone: 'primary' })
  })
  it('escalates tone for high and blocked price impact', () => {
    expect(deriveSwapCta({ ...ready, priceImpactBps: 700 }).tone).toBe('critical')
    expect(deriveSwapCta({ ...ready, priceImpactBps: 2000 }).label).toMatch(/Swap anyway/)
  })
  it('handles wrap / unwrap without a quote', () => {
    expect(deriveSwapCta({ ...ready, wrapType: 'wrap', quoteStatus: 'idle' })).toMatchObject({ label: 'Wrap', action: 'wrap' })
    expect(deriveSwapCta({ ...ready, wrapType: 'unwrap', quoteStatus: 'idle', inputSymbol: 'WETH' })).toMatchObject({ label: 'Unwrap', action: 'unwrap' })
    expect(deriveSwapCta({ ...ready, wrapType: 'wrap', inputBalance: 0n }).label).toBe('Insufficient ETH balance')
  })
  it('shows submitting', () => {
    expect(deriveSwapCta({ ...ready, submitting: true })).toMatchObject({ label: 'Submitting…', disabled: true })
  })
})

describe('impactSeverity', () => {
  it.each([
    [undefined, 'none'],
    [0, 'none'],
    [99, 'none'],
    [100, 'low'],
    [299, 'low'],
    [300, 'medium'],
    [500, 'high'],
    [1499, 'high'],
    [1500, 'blocked'],
  ])('%s bps → %s', (bps, sev) => expect(impactSeverity(bps as number | undefined)).toBe(sev))
})
