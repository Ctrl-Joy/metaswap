import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAbi, parseUnits, zeroAddress, type Address } from 'viem'
import { ACCOUNTS, balanceOf, connectDevWallet, eventually, mint, pub, requireStack, token, wallet, wrapEth } from './helpers'

// the positions/launches area positions flows against the live devnet. Account #3 is the LP, #4 generates swap fees.
const deployment = JSON.parse(readFileSync(join(import.meta.dirname, '../../../packages/sdk/src/generated/deployment.json'), 'utf8')) as {
  contracts: Record<string, Address>
}
const NPM = deployment.contracts.NonfungiblePositionManager!
const V3F = deployment.contracts.V3Factory!
const V2F = deployment.contracts.V2Factory!
const SR02 = deployment.contracts.SwapRouter02!

const npmAbi = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) returns (uint256,uint256)',
])
const factoryAbi = parseAbi(['function getPool(address,address,uint24) view returns (address)', 'function getPair(address,address) view returns (address)'])
const poolAbi = parseAbi(['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'])
const pairAbi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function nonces(address) view returns (uint256)'])
const routerAbi = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)'])

const LP = ACCOUNTS[3]
const SWAPPER = ACCOUNTS[4]
const MAX128 = 2n ** 128n - 1n

const positionLiquidity = async (id: bigint) => (await pub.readContract({ address: NPM, abi: npmAbi, functionName: 'positions', args: [id] }))[7]
const uncollected = async (id: bigint, owner: Address) =>
  (await pub.simulateContract({ address: NPM, abi: npmAbi, functionName: 'collect', args: [{ tokenId: id, recipient: owner, amount0Max: MAX128, amount1Max: MAX128 }], account: owner })).result

async function confirmFlow(page: Page, modalId: string) {
  const modal = page.getByTestId(modalId)
  await expect(modal).toBeVisible()
  await modal.getByTestId(`${modalId}-confirm`).click()
  await expect(modal.getByTestId(`${modalId}-success`)).toBeVisible({ timeout: 90_000 })
  return modal
}

test.describe.serial('positions on the live devnet', () => {
  let tokenId: bigint | undefined
  let v2Pair: Address | undefined

  test.beforeEach(async () => {
    await requireStack({ api: true })
  })

  test('create a V3 WETH/mUSDC 0.3% custom-range position', async ({ page }) => {
    await wrapEth(LP, parseUnits('5', 18))
    await mint('mUSDC', LP, parseUnits('20000', 6))
    await connectDevWallet(page, 3, `/positions/create?currencyA=${token('WETH').address}&currencyB=${token('mUSDC').address}&fee=3000`)
    await expect(page.getByTestId('fee-tier-3000-tvl')).toContainText('TVL')
    await page.getByTestId('create-continue').click()
    await expect(page.getByTestId('range-selector')).toBeVisible()
    await page.getByTestId('range-custom').click()
    await page.getByTestId('range-preset-10').click()
    await page.getByTestId('range-min-inc').click() // stepper snaps one tick spacing
    await page.getByTestId('deposit-a-input').fill('1')
    await expect(page.getByTestId('deposit-b-input')).not.toHaveValue('', { timeout: 15_000 })
    const usdc = Number(await page.getByTestId('deposit-b-input').inputValue())
    expect(usdc).toBeGreaterThan(1000) // ~3000 mUSDC per WETH, ratio depends on the range
    await page.getByTestId('create-review').click()
    const modal = await confirmFlow(page, 'create-modal')
    const href = await modal.getByTestId('view-new-position').getAttribute('href')
    tokenId = BigInt(href!.split('/').pop()!)
    expect(await pub.readContract({ address: NPM, abi: npmAbi, functionName: 'ownerOf', args: [tokenId] })).toBe(LP)
    const p = await pub.readContract({ address: NPM, abi: npmAbi, functionName: 'positions', args: [tokenId] })
    expect(p[4]).toBe(3000)
    expect(p[7]).toBeGreaterThan(0n)
    expect(p[5]).toBeLessThan(p[6])
    expect(Math.abs(p[5] % 60)).toBe(0)
  })

  test('add liquidity to it (paying ETH for the WETH side)', async ({ page }) => {
    test.skip(!tokenId, 'needs the position from the previous test')
    const before = await positionLiquidity(tokenId!)
    await connectDevWallet(page, 3, `/positions/v3/${tokenId}`)
    await expect(page.getByTestId('position-status')).toHaveText('In range')
    await expect(page.getByTestId('position-nft')).toBeVisible()
    await page.getByTestId('action-add').click()
    const modal = page.getByTestId('increase-modal')
    await modal.getByTestId('increase-a-input').fill('0.5')
    await expect(modal.getByTestId('increase-b-input')).not.toHaveValue('')
    await confirmFlow(page, 'increase-modal')
    await eventually(async () => (await positionLiquidity(tokenId!)) > before)
    const after = await positionLiquidity(tokenId!)
    // +0.5 WETH on top of 1 WETH → ~1.5x liquidity
    expect(Number(after) / Number(before)).toBeGreaterThan(1.4)
  })

  test('collect fees after a swap generates some', async ({ page }) => {
    test.skip(!tokenId, 'needs the position from the previous test')
    // swap 20 ETH → mUSDC through the 0.3% pool from another account (fees accrue in WETH)
    const hash = await wallet(SWAPPER).writeContract({
      address: SR02,
      abi: routerAbi,
      functionName: 'exactInputSingle',
      args: [{ tokenIn: token('WETH').address, tokenOut: token('mUSDC').address, fee: 3000, recipient: SWAPPER, amountIn: parseUnits('20', 18), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
      value: parseUnits('20', 18),
      gas: 1_000_000n,
    })
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe('success')
    const [fee0, fee1] = await uncollected(tokenId!, LP)
    expect(fee0).toBeGreaterThan(0n)
    const wethBefore = await balanceOf('WETH', LP)
    await connectDevWallet(page, 3, `/positions/v3/${tokenId}`)
    await expect(page.getByTestId('action-collect')).toBeEnabled({ timeout: 20_000 })
    await page.getByTestId('action-collect').click()
    const modal = page.getByTestId('collect-modal')
    await modal.getByTestId('eth-toggle').click() // collect as WETH, not ETH
    await confirmFlow(page, 'collect-modal')
    await eventually(async () => (await balanceOf('WETH', LP)) > wethBefore)
    expect((await balanceOf('WETH', LP)) - wethBefore).toBeGreaterThanOrEqual(fee0)
    // The live market simulator keeps trading through this pool, so a few wei of new fees can
    // accrue between the collect and this read. Collecting must have cleared what was owed.
    const [left0, left1] = await uncollected(tokenId!, LP)
    expect(left0).toBeLessThan(fee0 / 100n + 1n)
    expect(left1).toBeLessThanOrEqual(fee1 / 100n + 1_000_000n)
  })

  test('remove 50% of the V3 position', async ({ page }) => {
    test.skip(!tokenId, 'needs the position from the previous test')
    const before = await positionLiquidity(tokenId!)
    const usdcBefore = await balanceOf('mUSDC', LP)
    await connectDevWallet(page, 3, `/positions/v3/${tokenId}`)
    await page.getByTestId('action-remove').click()
    const modal = page.getByTestId('remove-modal')
    await modal.getByTestId('percent-50').click()
    await expect(modal.getByTestId('percent-value')).toHaveText('50%')
    await confirmFlow(page, 'remove-modal')
    await eventually(async () => (await positionLiquidity(tokenId!)) < before)
    expect(await positionLiquidity(tokenId!)).toBe(before - (before * 5000n) / 10_000n)
    expect(await balanceOf('mUSDC', LP)).toBeGreaterThan(usdcBefore)
    // NFT still owned (not burned at 50%)
    expect(await pub.readContract({ address: NPM, abi: npmAbi, functionName: 'ownerOf', args: [tokenId!] })).toBe(LP)
  })

  test('create a V2 META/WETH position', async ({ page }) => {
    await mint('META', LP, parseUnits('1000', 18))
    v2Pair = await pub.readContract({ address: V2F, abi: factoryAbi, functionName: 'getPair', args: [token('META').address, token('WETH').address] })
    expect(v2Pair).not.toBe(zeroAddress)
    const lpBefore = await pub.readContract({ address: v2Pair, abi: pairAbi, functionName: 'balanceOf', args: [LP] })
    await connectDevWallet(page, 3, `/positions/create?currencyA=META&currencyB=ETH&version=v2`)
    await page.getByTestId('create-continue').click()
    await page.getByTestId('deposit-a-input').fill('100')
    await expect(page.getByTestId('deposit-b-input')).not.toHaveValue('')
    const eth = Number(await page.getByTestId('deposit-b-input').inputValue())
    expect(eth).toBeGreaterThan(0.1) // 100 META * $8 / $3000 ≈ 0.27 ETH
    expect(eth).toBeLessThan(1)
    await page.getByTestId('create-review').click()
    const modal = await confirmFlow(page, 'create-modal')
    await expect(modal.getByTestId('view-new-position')).toHaveAttribute('href', new RegExp(`/positions/v2/${v2Pair}`, 'i'))
    await eventually(async () => (await pub.readContract({ address: v2Pair!, abi: pairAbi, functionName: 'balanceOf', args: [LP] })) > lpBefore)
  })

  test('remove V2 liquidity with an LP permit signature', async ({ page }) => {
    test.skip(!v2Pair, 'needs the V2 position from the previous test')
    const lpBefore = await pub.readContract({ address: v2Pair!, abi: pairAbi, functionName: 'balanceOf', args: [LP] })
    expect(lpBefore).toBeGreaterThan(0n)
    const nonceBefore = await pub.readContract({ address: v2Pair!, abi: pairAbi, functionName: 'nonces', args: [LP] })
    const metaBefore = await balanceOf('META', LP)
    await connectDevWallet(page, 3, `/positions/v2/${v2Pair}`)
    await expect(page.getByTestId('lp-balance')).toContainText('MS-V2')
    await page.getByTestId('action-remove').click()
    const modal = page.getByTestId('remove-modal')
    await modal.getByTestId('percent-50').click()
    await modal.getByTestId('remove-modal-confirm').click()
    await expect(modal.getByTestId('step-permit')).toBeVisible()
    await expect(modal.getByTestId('remove-modal-success')).toBeVisible({ timeout: 90_000 })
    const lpAfter = await pub.readContract({ address: v2Pair!, abi: pairAbi, functionName: 'balanceOf', args: [LP] })
    expect(lpAfter).toBe(lpBefore - (lpBefore * 5000n) / 10_000n)
    // the permit nonce was consumed → removeLiquidity*WithPermit path
    expect(await pub.readContract({ address: v2Pair!, abi: pairAbi, functionName: 'nonces', args: [LP] })).toBe(nonceBefore + 1n)
    expect(await balanceOf('META', LP)).toBeGreaterThan(metaBefore)
  })

  test('create a brand-new V3 pool (mLINK/mARB) with a starting price', async ({ page }) => {
    const link = token('mLINK').address
    const arb = token('mARB').address
    let fee: number | undefined
    for (const f of [3000, 10000, 500, 100]) {
      const pool = await pub.readContract({ address: V3F, abi: factoryAbi, functionName: 'getPool', args: [link, arb, f] })
      if (pool === zeroAddress) {
        fee = f
        break
      }
    }
    test.skip(fee === undefined, 'every mLINK/mARB fee tier already has a pool on this chain (re-run after a fresh deploy)')
    await mint('mLINK', LP, parseUnits('100', 18))
    await mint('mARB', LP, parseUnits('5000', 18))
    await connectDevWallet(page, 3, `/positions/create?currencyA=mLINK&currencyB=mARB&fee=${fee}`)
    await expect(page.getByTestId(`fee-tier-${fee}-tvl`)).toHaveText('Not created')
    await page.getByTestId('create-continue').click()
    await page.getByTestId('start-price-input').fill('18.75') // $15 / $0.8 mARB per mLINK
    await page.getByTestId('deposit-a-input').fill('10')
    await expect(page.getByTestId('deposit-b-input')).not.toHaveValue('')
    const arbAmount = Number(await page.getByTestId('deposit-b-input').inputValue())
    expect(arbAmount).toBeGreaterThan(187)
    expect(arbAmount).toBeLessThan(188)
    await page.getByTestId('create-review').click()
    const modal = await confirmFlow(page, 'create-modal')
    const href = await modal.getByTestId('view-new-position').getAttribute('href')
    const id = BigInt(href!.split('/').pop()!)
    const pool = await pub.readContract({ address: V3F, abi: factoryAbi, functionName: 'getPool', args: [link, arb, fee!] })
    expect(pool).not.toBe(zeroAddress)
    const [sqrt] = await pub.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' })
    expect(sqrt).toBeGreaterThan(0n)
    // pool price ≈ 18.75 mARB per mLINK (token order decides the orientation)
    const raw = (Number(sqrt) / 2 ** 96) ** 2
    const price = link.toLowerCase() < arb.toLowerCase() ? raw : 1 / raw
    expect(Math.abs(price - 18.75) / 18.75).toBeLessThan(0.001)
    expect(await pub.readContract({ address: NPM, abi: npmAbi, functionName: 'ownerOf', args: [id] })).toBe(LP)
    expect(await positionLiquidity(id)).toBeGreaterThan(0n)
  })

  test('positions list shows the new positions with filters', async ({ page }) => {
    await connectDevWallet(page, 3, '/positions')
    await expect(page.getByTestId('positions-list')).toBeVisible({ timeout: 30_000 })
    if (tokenId) await expect(page.getByTestId(`position-card-v3-${tokenId}`)).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('filter-version-v2').click()
    await expect(page.locator('[data-testid^="position-card-v3-"]')).toHaveCount(0)
    await expect(page.getByTestId('top-pools')).toBeVisible()
  })
})

test('positions page shows the connect gate when signed out', async ({ page }) => {
  await requireStack({ api: false })
  await page.goto('/positions')
  await expect(page.getByTestId('positions-gate')).toBeVisible()
  await expect(page.getByTestId('new-position')).toBeVisible()
})
