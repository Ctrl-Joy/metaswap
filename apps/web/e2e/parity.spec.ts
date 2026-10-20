import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { erc20Abi, maxUint256, parseAbi, parseUnits, zeroAddress, type Address } from 'viem'
import { ACCOUNTS, connectDevWallet, eventually, mint, pub, requireStack, token, wallet, wrapEth } from './helpers'

// the parity review parity fixes (docs/analysis/parity-audit.md): trade chart toggle, search keyboard navigation,
// explore pool filters + search, range strategies, V2 → V3 migration. Account #2 is used for the
// connected flows (#4 is shared with other suites).
const deployment = JSON.parse(readFileSync(join(import.meta.dirname, '../../../packages/sdk/src/generated/deployment.json'), 'utf8')) as {
  contracts: Record<string, Address>
}
const V2F = deployment.contracts.V2Factory!
const V2R = deployment.contracts.V2Router02!
const NPM = deployment.contracts.NonfungiblePositionManager!
const ME = ACCOUNTS[2]

test.describe('parity fixes', () => {
  test.beforeEach(async () => {
    await requireStack({ api: true })
  })

  test('swap card chart: shown beside the card, toggled by the trend icon, remembered', async ({ page }) => {
    await page.goto('/swap')
    const toggle = page.getByTestId('chart-toggle')
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
    const chart = page.getByTestId('trade-chart')
    await expect(chart).toBeVisible()
    await expect(page.getByTestId('trade-chart-token')).toContainText('ETH')
    await expect(chart.getByTestId('token-chart')).toBeVisible({ timeout: 30_000 })
    // desktop: the chart sits left of the card
    const chartBox = (await chart.boundingBox())!
    const cardBox = (await page.getByTestId('swap-cta').boundingBox())!
    expect(chartBox.x + chartBox.width).toBeLessThanOrEqual(cardBox.x + 1)
    await toggle.click()
    await expect(chart).toBeHidden()
    await page.reload()
    await expect(page.getByTestId('chart-toggle')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('trade-chart')).toBeHidden()
    await page.getByTestId('chart-toggle').click()
    await expect(page.getByTestId('trade-chart')).toBeVisible()
  })

  test('top-bar search: stats, arrow-key navigation, Enter opens, Recent remembers it', async ({ page }) => {
    await page.goto('/explore')
    await page.getByTestId('search-button').click()
    const modal = page.getByTestId('search-modal')
    await expect(modal.getByTestId('search-tokens')).toContainText('Tokens by 24H volume')
    await expect(modal.getByTestId('search-pools')).toContainText('vol', { timeout: 20_000 })
    const input = modal.getByTestId('search-input')
    await input.fill('usdc')
    await input.press('ArrowDown')
    await expect(modal.getByTestId('search-option-0')).toHaveAttribute('data-active', 'true')
    await input.press('ArrowDown')
    await expect(modal.getByTestId('search-option-1')).toHaveAttribute('data-active', 'true')
    await input.press('ArrowUp')
    await expect(modal.getByTestId('search-option-0')).toHaveAttribute('data-active', 'true')
    await input.press('Enter')
    await expect(page).toHaveURL(/\/explore\/tokens\/metachain-devnet\/0x/)
    await expect(modal).toBeHidden()
    await page.getByTestId('search-button').click()
    await expect(page.getByTestId('search-recent')).toContainText('mUSDC')
    await page.getByTestId('search-clear-recent').click()
    await expect(page.getByTestId('search-recent')).toBeHidden()
  })

  test('explore pools: 30D vol + ratio columns, filters modal, search', async ({ page }) => {
    await page.goto('/explore/pools')
    const rows = page.getByTestId('pool-row')
    await expect(rows.first()).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '30D vol' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '1D vol', exact: true })).toHaveAttribute('aria-sort', 'descending')
    await expect(rows.first().getByTestId('pool-vol-tvl')).toHaveText(/^(\d+\.\d{2}|<0\.01|-)$/)
    await expect(rows.first().getByTestId('pool-vol30d')).toContainText('$', { timeout: 30_000 })
    const total = await rows.count()

    await page.getByTestId('pool-filters-button').click()
    const dlg = page.getByTestId('pool-filters-modal')
    await dlg.getByTestId('pool-filter-version-v2').click()
    await dlg.getByTestId('pool-filters-apply').click()
    await expect(dlg).toBeHidden()
    await expect(page.getByTestId('pool-filters-button')).toContainText('1')
    const v2 = await rows.count()
    expect(v2).toBeGreaterThan(0)
    expect(v2).toBeLessThan(total)
    for (const v of await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-version')))) expect(v).toBe('v2')

    await page.getByTestId('pool-filters-button').click()
    await dlg.getByTestId('pool-filters-clear').click()
    await dlg.getByTestId('pool-filter-apr-min').fill('1000000')
    await dlg.getByTestId('pool-filters-apply').click()
    await expect(page.getByTestId('pools-empty')).toContainText('No pools match')

    await page.getByTestId('pool-filters-button').click()
    await dlg.getByTestId('pool-filters-clear').click()
    await dlg.getByTestId('pool-filters-apply').click()
    await page.getByTestId('pool-search').fill('dai')
    await expect(rows.first()).toBeVisible()
    for (const t of await rows.allInnerTexts()) expect(t).toMatch(/DAI/)
  })

  test('explore transactions read "Swap A for B"; token pages read Buy/Sell', async ({ page }) => {
    await page.goto('/explore/transactions')
    await expect(page.getByTestId('tx-label').first()).toHaveText(/^(Swap \S+ for \S+|Add \S+ and \S+|Remove \S+ and \S+)$/)
    await page.goto(`/explore/tokens/metachain-devnet/${token('WETH').address}`)
    await expect(page.getByTestId('token-transactions').getByTestId('tx-label').first()).toHaveText(/^(Buy|Sell) WETH|^(Add|Remove)/, { timeout: 30_000 })
    await expect(page.getByTestId('token-links')).toContainText('Contract')
    await expect(page.getByTestId('token-link-trade')).toHaveAttribute('href', new RegExp(`outputCurrency=${token('WETH').address}`))
  })

  test('explore tokens list native ETH next to WETH', async ({ page }) => {
    await page.goto('/explore/tokens')
    const eth = page.locator('[data-testid="token-row"][data-symbol="ETH"]')
    await expect(eth).toBeVisible()
    await eth.click()
    await expect(page).toHaveURL(/\/explore\/tokens\/metachain-devnet\/NATIVE/)
  })

  test('new position: range strategies set one-sided and wide ranges', async ({ page }) => {
    await connectDevWallet(page, 2, `/positions/create?currencyA=${token('WETH').address}&currencyB=${token('mUSDC').address}&fee=3000`)
    await page.getByTestId('create-continue').click()
    await page.getByTestId('range-custom').click()
    await expect(page.getByTestId('range-price-history')).toBeVisible()
    await page.getByTestId('range-strategy-wide').click()
    await expect(page.getByTestId('range-strategy-wide')).toHaveAttribute('aria-pressed', 'true')
    const minDelta = Number((await page.getByTestId('range-min-delta').innerText()).replace('%', ''))
    const maxDelta = Number((await page.getByTestId('range-max-delta').innerText()).replace(/[+%]/g, ''))
    expect(minDelta).toBeGreaterThan(-52)
    expect(minDelta).toBeLessThan(-48)
    expect(maxDelta).toBeGreaterThan(95)
    expect(maxDelta).toBeLessThan(105)
    await page.getByTestId('range-strategy-upper').click()
    await expect(page.getByTestId('range-strategy-upper')).toHaveAttribute('aria-pressed', 'true')
    expect(Number((await page.getByTestId('range-min-delta').innerText()).replace(/[+%]/g, ''))).toBeGreaterThanOrEqual(0)
    await page.getByTestId('range-strategy-stable').click()
    const sMin = Number((await page.getByTestId('range-min-delta').innerText()).replace('%', ''))
    expect(sMin).toBeLessThan(0)
    expect(sMin).toBeGreaterThan(-5)
  })

  test('migrate a V2 WETH/mUSDC position to V3', async ({ page }) => {
    // seed V2 liquidity for #2 directly through the router
    const weth = token('WETH').address
    const usdc = token('mUSDC').address
    await wrapEth(ME, parseUnits('2', 18))
    await mint('mUSDC', ME, parseUnits('7000', 6))
    const w = wallet(ME)
    for (const t of [weth, usdc]) await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: t, abi: erc20Abi, functionName: 'approve', args: [V2R, maxUint256] }) })
    const routerAbi = parseAbi(['function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)'])
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: V2R, abi: routerAbi, functionName: 'addLiquidity', args: [weth, usdc, parseUnits('1', 18), parseUnits('6000', 6), 0n, 0n, ME, deadline] }) })
    const pair = await pub.readContract({ address: V2F, abi: parseAbi(['function getPair(address,address) view returns (address)']), functionName: 'getPair', args: [weth, usdc] })
    expect(pair).not.toBe(zeroAddress)
    const lpAbi = parseAbi(['function balanceOf(address) view returns (uint256)'])
    const lpBefore = await pub.readContract({ address: pair, abi: lpAbi, functionName: 'balanceOf', args: [ME] })
    expect(lpBefore).toBeGreaterThan(0n)
    const nftsBefore = await pub.readContract({ address: NPM, abi: lpAbi, functionName: 'balanceOf', args: [ME] })

    await connectDevWallet(page, 2, `/positions/v2/${pair}`)
    await page.getByTestId('action-migrate').click()
    const modal = page.getByTestId('migrate-modal')
    await expect(modal).toBeVisible()
    await modal.getByTestId('migrate-fee-3000').click()
    await modal.getByTestId('migrate-range-full').click()
    await expect(modal.getByTestId('migrate-summary')).toContainText('WETH')
    await modal.getByTestId('migrate-modal-confirm').click()
    await expect(modal.getByTestId('migrate-modal-success')).toBeVisible({ timeout: 120_000 })

    await eventually(async () => (await pub.readContract({ address: pair, abi: lpAbi, functionName: 'balanceOf', args: [ME] })) === 0n)
    await eventually(async () => (await pub.readContract({ address: NPM, abi: lpAbi, functionName: 'balanceOf', args: [ME] })) === nftsBefore + 1n)
  })
})
