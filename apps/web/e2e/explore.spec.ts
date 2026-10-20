import { expect, test, type Page } from '@playwright/test'
import { API, requireStack } from './helpers'

// Explore pages against the live stack (chain :8545 + API :8787). requireStack() skips with a clear
// message when either is down. The Trending, Earn and Auctions endpoints are being deployed by the API;
// tests that need populated data intercept those routes with sample payloads, and the empty/hidden
// behaviour is asserted against the live API.

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`)
  return (await r.json()) as T
}

const CORS = { 'access-control-allow-origin': '*' }

async function mockJson(page: Page, pattern: string, body: unknown) {
  await page.route(pattern, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) }))
}

const now = () => Math.floor(Date.now() / 1000)

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

  test('category chips filter the token list and sync the URL', async ({ page }) => {
    await page.goto('/explore')
    await expect(page.getByTestId('token-row').first()).toBeVisible()
    const all = await page.getByTestId('token-row').count()
    await page.getByTestId('chip-stablecoins').click()
    await expect(page).toHaveURL(/category=stablecoins/)
    await expect(page.getByTestId('token-row').first()).toBeVisible()
    // Wait for the filtered list to render (the count is read again until the re-render lands).
    await expect.poll(() => page.getByTestId('token-row').count()).toBeLessThan(all)
    const stables = await page.getByTestId('token-row').count()
    expect(stables).toBeGreaterThan(0)
    // Stablecoin rows carry a tag badge.
    await expect(page.getByTestId('token-row').first().getByText('Stablecoins')).toBeVisible()

    await page.getByTestId('chip-more').click()
    await page.getByTestId('more-wrapped').click()
    await expect(page).toHaveURL(/category=wrapped/)
    await expect(page.getByTestId('token-row').filter({ hasText: 'WETH' }).first()).toBeVisible()
  })

  test('trending row and Earn row render from the API when deployed (mocked here)', async ({ page }) => {
    const trend = (symbol: string, i: number) => ({
      token: { chainId: 31337, address: `0x${String(i).padStart(40, '0')}`, symbol, name: `${symbol} Token`, decimals: 18, tags: [] },
      priceUsd: 1 + i,
      change24h: 5 * i,
      sparkline: [1, 1.1, 1.05, 1.2].map((p) => ({ time: now(), priceUsd: p })),
    })
    await mockJson(page, '**/explore/trending*', { tokens: [trend('AAA', 1), trend('BBB', 2), trend('CCC', 3), trend('DDD', 4), trend('EEE', 5)] })
    await mockJson(page, '**/earn/vaults*', { vaults: [{ slug: 'usdt', token: { symbol: 'USDT' }, apy: 4.78 }, { slug: 'usdc', token: { symbol: 'USDC' }, apy: 4.41 }, { slug: 'eth', token: { symbol: 'ETH' }, apy: 1.57 }] })
    await page.goto('/explore')
    const trending = page.getByTestId('trending-row')
    await expect(trending).toBeVisible()
    await expect(page.getByTestId('trending-card')).toHaveCount(4)
    await expect(trending.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/explore/tokens?category=trending')
    const earn = page.getByTestId('earn-row')
    await expect(earn).toBeVisible()
    await expect(page.getByTestId('earn-card')).toHaveCount(3)
    await expect(page.getByTestId('earn-card').first()).toHaveAttribute('href', '/earn/usdt')
    await expect(earn.getByText('4.78% APY')).toBeVisible()
  })

  test('auctions tab: empty state with the launch button when none exist', async ({ page }) => {
    await mockJson(page, '**/launches*', { launches: [] })
    await page.goto('/explore/auctions')
    await expect(page.getByTestId('auctions-empty')).toBeVisible()
    await expect(page.getByTestId('launch-auction')).toHaveAttribute('href', '/launches/create')
  })

  test('auctions tab: verified cards, status and rows link to the auction', async ({ page }) => {
    const launches = [
      { slug: 'balances', name: 'Balances', symbol: 'BALANCE', verified: true, fdvAtFloorUsd: 23_300_000, bidVolumeUsd: 410_500, thresholdUsd: 6_500, thresholdMetPct: 100, status: 'live', startsAt: now() - 3600, endsAt: now() + 67_000 },
      { slug: 'strat', name: 'STRAT Token', symbol: 'STRAT', verified: false, fdvAtFloorUsd: 1_700_000, bidVolumeUsd: 73_600, thresholdUsd: 167_200, thresholdMetPct: 44, status: 'live', startsAt: now() - 7200, endsAt: now() + 500_000 },
      { slug: 'aztec', name: 'AZTEC', symbol: 'AZTEC', verified: true, fdvAtFloorUsd: 188_300_000, bidVolumeUsd: 72_000_000, status: 'launched', startsAt: now() - 900_000, endsAt: now() - 100 },
    ]
    await mockJson(page, '**/launches*', { launches })
    await page.goto('/explore/auctions')
    await expect(page.getByTestId('top-auctions')).toBeVisible()
    await expect(page.getByTestId('top-auction-card')).toHaveCount(2)
    const rows = page.getByTestId('auction-row')
    await expect(rows).toHaveCount(3)
    await expect(page.locator('[data-testid="auction-row"][data-auction="aztec"]').getByText('Launched')).toBeVisible()
    await page.getByTestId('auction-chip-verified').click()
    await expect(rows).toHaveCount(2)
    await page.locator('[data-testid="auction-row"][data-auction="balances"]').click()
    await expect(page).toHaveURL(/\/launches\/balances$/)
  })
})
