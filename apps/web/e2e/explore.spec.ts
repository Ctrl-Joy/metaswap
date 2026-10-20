import { expect, test } from '@playwright/test'
import { API, requireStack } from './helpers'

// Explore pages against the live stack (chain :8545 + API :8787). requireStack() skips with a clear
// message when either is down.

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`)
  return (await r.json()) as T
}

test.describe('explore', () => {
  test.beforeAll(async () => {
    await requireStack({ api: true })
  })

  test('tokens tab loads at least 8 rows', async ({ page }) => {
    await page.goto('/explore')
    const rows = page.getByTestId('token-row')
    await expect(rows.first()).toBeVisible()
    expect(await rows.count()).toBeGreaterThanOrEqual(8)
  })

  test('pools tab loads at least 13 rows and sorts by TVL', async ({ page }) => {
    await page.goto('/explore/pools')
    const rows = page.getByTestId('pool-row')
    await expect(rows.first()).toBeVisible()
    expect(await rows.count()).toBeGreaterThanOrEqual(13)

    const tvlHeader = page.getByRole('columnheader', { name: 'TVL', exact: true })
    const firstPool = () => page.getByTestId('pool-row').first().getAttribute('data-pool')
    const before = await firstPool()
    // TVL is the default (descending); the first click flips it to ascending, which moves the top row.
    await tvlHeader.getByRole('button').click()
    await expect(tvlHeader).toHaveAttribute('aria-sort', 'ascending')
    const asc = await firstPool()
    expect(asc).not.toBe(before)
    await tvlHeader.getByRole('button').click()
    await expect(tvlHeader).toHaveAttribute('aria-sort', 'descending')
    expect(await firstPool()).toBe(before)
    expect(await page.getByTestId('pool-row').count()).toBeGreaterThanOrEqual(13)
  })

  test('clicking WETH opens a token page with a chart canvas and stats', async ({ page }) => {
    await page.goto('/explore')
    const weth = page.locator('[data-testid="token-row"][data-symbol="WETH"]')
    await expect(weth).toBeVisible()
    await weth.click()
    await expect(page).toHaveURL(/\/explore\/tokens\/metachain-devnet\/0x/)
    await expect(page.getByTestId('token-page')).toBeVisible()
    await expect(page.getByTestId('token-chart')).toHaveAttribute('data-status', /ready|empty|loading/)
    await expect(page.getByTestId('stat-tvl')).toBeVisible()
    await expect(page.getByTestId('stat-volume')).toBeVisible()
    // A rendered chart needs at least two points; the seeded devnet has them for WETH.
    await expect(page.getByTestId('token-price-chart').locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  })

  test('range switching requests and renders different data', async ({ page }) => {
    const weth = (await apiGet<Array<{ token: { symbol: string; address: string } }>>('/explore/tokens')).find((r) => r.token.symbol === 'WETH')
    expect(weth).toBeTruthy()
    await page.goto(`/explore/tokens/metachain-devnet/${weth!.token.address}`)
    const seen: string[] = []
    page.on('request', (req) => {
      const u = new URL(req.url())
      if (u.pathname.endsWith('/price-history')) seen.push(u.searchParams.get('range') ?? '')
    })
    await expect(page.getByTestId('token-chart')).toBeVisible()
    await page.getByTestId('range-1W').click()
    await expect.poll(() => seen).toContain('1W')
    await page.getByTestId('range-1Y').click()
    await expect.poll(() => seen).toContain('1Y')
    await expect(page.getByTestId('range-1Y')).toHaveAttribute('aria-selected', 'true')
  })

  test('pool page shows the liquidity chart', async ({ page }) => {
    const pools = await apiGet<Array<{ address: string; version: string }>>('/explore/pools?sort=tvl')
    const v3 = pools.find((p) => p.version === 'v3') ?? pools[0]
    expect(v3).toBeTruthy()
    await page.goto(`/explore/pools/metachain-devnet/${v3!.address}`)
    await expect(page.getByTestId('pool-page')).toBeVisible()
    await page.getByTestId('pool-tab-liquidity').click()
    if (v3!.version === 'v3') {
      await expect(page.getByTestId('liquidity-chart')).toBeVisible({ timeout: 20_000 })
    } else {
      await expect(page.getByTestId('pool-tvl-chart')).toBeVisible({ timeout: 20_000 })
    }
  })

  test('transactions tab lists seeded swaps', async ({ page }) => {
    await page.goto('/explore/transactions')
    const rows = page.getByTestId('tx-row')
    await expect(rows.first()).toBeVisible()
    expect(await rows.count()).toBeGreaterThan(0)
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Swap' }).first()).toBeVisible()
  })

  test('unknown token shows a friendly not-found state', async ({ page }) => {
    await page.goto('/explore/tokens/metachain-devnet/0x0000000000000000000000000000000000000001')
    await expect(page.getByTestId('explore-not-found')).toBeVisible()
  })
})
