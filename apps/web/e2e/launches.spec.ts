import { expect, test } from '@playwright/test'
import { erc20Abi, parseAbi, parseUnits, zeroAddress, type Address } from 'viem'
import { ACCOUNTS, balanceOf, connectDevWallet, eventually, mint, pickToken, pub, requireStack, reviewAndConfirm, token } from './helpers'

// the positions/launches area launches flows on a real chain.
// - Default: the shared stack (:5173 web, :8545 chain, :8787 API). Settlement waits for the 2-minute
//   auction to end in real time.
// - LAUNCH_BASE_URL=http://127.0.0.1:5174 VITE_RPC_URL=http://127.0.0.1:8565 TIME_TRAVEL=1: a private
//   fork with its own web server (VITE_LAUNCHPADS set); settlement uses evm_increaseTime. The swap test
//   needs the API and is skipped there.
const BASE = process.env.LAUNCH_BASE_URL ?? ''
const TIME_TRAVEL = process.env.TIME_TRAVEL === '1'
const PRIVATE = !!process.env.LAUNCH_BASE_URL

const auctionAbi = parseAbi([
  'struct BidInfo { uint256 id; address bidder; uint256 amount; uint256 maxPrice; bool native; bool claimed; }',
  'function status() view returns (uint8)',
  'function raised() view returns (uint256)',
  'function token() view returns (address)',
  'function pool() view returns (address)',
  'function clearingPrice() view returns (uint256)',
  'function bidsOf(address) view returns (BidInfo[])',
  'function launchpad() view returns (address)',
])

const CREATOR = ACCOUNTS[3]
const BIDDER = ACCOUNTS[4]
const SYMBOL = `T${Date.now().toString(36).slice(-5).toUpperCase()}`

test.describe.serial('launches on a live chain', () => {
  let auction: Address | undefined

  test.beforeEach(async () => {
    await requireStack({ api: !PRIVATE })
  })

  test('create a launch (2-minute mUSDC auction)', async ({ page }) => {
    await connectDevWallet(page, 3, `${BASE}/launches/create`)
    await page.getByTestId('launch-name').fill(`Test Orbit ${SYMBOL}`)
    await page.getByTestId('launch-symbol').fill(SYMBOL)
    await page.getByTestId('launch-supply').fill('1000000')
    await page.getByTestId('launch-auction-pct').fill('50')
    await page.getByTestId('launch-quote-mUSDC').click()
    await page.getByTestId('launch-floor').fill('0.01')
    await page.getByTestId('launch-duration-2m').click()
    await page.getByTestId('launch-threshold').fill('1000')
    await page.getByTestId('launch-liquidity-pct').fill('50')
    await page.getByTestId('launch-fee-10000').click()
    await page.getByTestId('launch-description').fill('E2E test launch')
    await page.getByTestId('launch-review').click()
    const modal = page.getByTestId('launch-modal')
    await modal.getByTestId('launch-modal-confirm').click()
    await page.waitForURL(/\/launches\/0x[0-9a-fA-F]{40}$/, { timeout: 60_000 })
    auction = page.url().split('/').pop() as Address
    await expect(page.getByTestId('auction-title')).toContainText(SYMBOL)
    const tokenAddr = await pub.readContract({ address: auction, abi: auctionAbi, functionName: 'token' })
    expect(await pub.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'symbol' })).toBe(SYMBOL)
    expect(await pub.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'totalSupply' })).toBe(parseUnits('1000000', 18))
    // the whole supply sits in the auction
    expect(await pub.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'balanceOf', args: [auction] })).toBe(parseUnits('1000000', 18))
    void CREATOR
  })

  test('bid on the active auction (approve + bid)', async ({ page }) => {
    test.skip(!auction, 'needs the launch from the previous test')
    await mint('mUSDC', BIDDER, parseUnits('10000', 6))
    await connectDevWallet(page, 4, `${BASE}/launches/${auction}`)
    await expect(page.getByTestId('auction-status')).toHaveAttribute('data-status', 'active', { timeout: 20_000 })
    // 500k tokens for sale: 6,000 mUSDC at max 0.012 fills the supply exactly at 0.012
    await page.getByTestId('bid-amount-input').fill('6000')
    await page.getByTestId('bid-max-price').fill('0.012')
    await expect(page.getByTestId('bid-est-tokens')).not.toHaveText('-')
    await page.getByTestId('bid-review').click()
    const modal = page.getByTestId('bid-modal')
    await modal.getByTestId('bid-modal-confirm').click()
    await expect(modal.getByTestId('bid-modal-success')).toBeVisible({ timeout: 60_000 })
    await modal.getByTestId('bid-modal-close').click()
    const bids = await pub.readContract({ address: auction!, abi: auctionAbi, functionName: 'bidsOf', args: [BIDDER] })
    expect(bids).toHaveLength(1)
    expect(bids[0]!.amount).toBe(parseUnits('6000', 6))
    expect(bids[0]!.maxPrice).toBe(parseUnits('0.012', 18))
    expect(await pub.readContract({ address: auction!, abi: auctionAbi, functionName: 'raised' })).toBe(parseUnits('6000', 6))
    await expect(page.getByTestId('my-bids')).toContainText('6,000')
    await expect(page.getByTestId('stat-clearing')).toContainText('0.012')
  })

  test('settle the ended auction and claim tokens', async ({ page }) => {
    test.skip(!auction, 'needs the launch from the previous test')
    test.setTimeout(300_000)
    if (TIME_TRAVEL) {
      await pub.request({ method: 'evm_increaseTime' as never, params: [180] as never })
      await pub.request({ method: 'evm_mine' as never, params: [] as never })
    }
    // wait for the chain to pass endTime (real time on the shared stack)
    await eventually(async () => (await pub.readContract({ address: auction!, abi: auctionAbi, functionName: 'status' })) === 2, 200_000)
    await connectDevWallet(page, 4, `${BASE}/launches/${auction}`)
    await page.getByTestId('auction-settle').click()
    const settle = page.getByTestId('settle-modal')
    await settle.getByTestId('settle-modal-confirm').click()
    await expect(settle.getByTestId('settle-modal-success')).toBeVisible({ timeout: 60_000 })
    await settle.getByTestId('settle-modal-close').click()
    expect(await pub.readContract({ address: auction!, abi: auctionAbi, functionName: 'status' })).toBe(3) // Launched
    const pool = await pub.readContract({ address: auction!, abi: auctionAbi, functionName: 'pool' })
    expect(pool).not.toBe(zeroAddress)
    expect(await pub.readContract({ address: auction!, abi: auctionAbi, functionName: 'clearingPrice' })).toBe(parseUnits('0.012', 18))

    await expect(page.getByTestId('auction-status')).toHaveAttribute('data-status', 'launched', { timeout: 15_000 })
    const tokenAddr = await pub.readContract({ address: auction!, abi: auctionAbi, functionName: 'token' })
    await page.getByTestId('auction-claim').click()
    const claim = page.getByTestId('claim-modal')
    await claim.getByTestId('claim-modal-confirm').click()
    await expect(claim.getByTestId('claim-modal-success')).toBeVisible({ timeout: 60_000 })
    const got = await pub.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'balanceOf', args: [BIDDER] })
    // 6,000 mUSDC at 0.012 → the full 500k auction supply (within rounding)
    expect(got).toBeGreaterThan(parseUnits('499999', 18))
    expect(got).toBeLessThanOrEqual(parseUnits('500000', 18))
    const bids = await pub.readContract({ address: auction!, abi: auctionAbi, functionName: 'bidsOf', args: [BIDDER] })
    expect(bids[0]!.claimed).toBe(true)
    await claim.getByTestId('claim-modal-close').click()
    await expect(page.getByTestId('auction-swap')).toBeVisible()
  })

  test('the launched token trades via /swap', async ({ page }) => {
    test.skip(!auction, 'needs the launch from the previous test')
    test.skip(PRIVATE, 'quotes come from the shared API, which does not see the private fork')
    const tokenAddr = await pub.readContract({ address: auction!, abi: auctionAbi, functionName: 'token' })
    const me = ACCOUNTS[2]
    await mint('mUSDC', me, parseUnits('100', 6))
    const before = await pub.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'balanceOf', args: [me] })
    await connectDevWallet(page, 2, `/swap?inputCurrency=${token('mUSDC').address}&outputCurrency=${tokenAddr}`)
    const out = page.getByTestId('swap-output-token')
    if (!(await out.textContent())?.includes(SYMBOL)) {
      // not in the API token list yet: import it by address
      await out.click()
      const selector = page.getByTestId('token-selector')
      await selector.getByTestId('token-search').fill(tokenAddr)
      const option = selector.getByTestId(`token-option-${SYMBOL}`)
      if (await option.first().isVisible().catch(() => false)) await option.first().click()
      else {
        await selector.getByTestId('import-ack').check()
        await selector.getByTestId('import-confirm').click()
      }
    }
    await page.getByTestId('swap-input-input').fill('10')
    await expect(page.getByTestId('swap-output-input')).not.toHaveValue('', { timeout: 30_000 })
    await reviewAndConfirm(page)
    await eventually(async () => (await pub.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'balanceOf', args: [me] })) > before)
    void pickToken
    void balanceOf
  })
})

test('launches page renders its sections', async ({ page }) => {
  await requireStack({ api: false })
  await page.goto(`${BASE}/launches`)
  await expect(page.getByTestId('launch-banner')).toBeVisible()
  await expect(page.getByTestId('trending-launches')).toBeVisible()
  await expect(page.getByTestId('all-launches')).toBeVisible()
  await expect(page.getByTestId('auctions')).toBeVisible()
  await page.getByTestId('banner-create').click()
  await expect(page).toHaveURL(/\/launches\/create$/)
})
