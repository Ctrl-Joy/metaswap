import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { writeContract } from 'wagmi/actions'
import { Droplets, FlaskConical, Check, ChevronRight } from 'lucide-react'
import { DEVNET_TOKENS, NATIVE_ETH, type Token } from '@metaswap/sdk'
import { Banner, Button, Skeleton, TokenLogo } from '@/components/ui'
import { testErc20Abi } from '@/lib/abis'
import { formatDuration, formatTokenAmount, formatUsd } from '@/lib/format'
import { toNumber } from '@/lib/amount'
import { parseTxError } from '@/lib/errors'
import { RPC_URL, DEVNET_CHAIN_ID } from '@/config'
import { useUi } from '@/state/ui'
import { toast } from '@/state/toasts'
import { trackTx, invalidateChainQueries } from '@/state/transactions'
import { wagmiConfig } from '@/wallet/wagmi'
import { useWallet, useSwitchToDevnet } from '@/wallet/hooks'
import { useTokenBalances } from '@/hooks/useTokenBalances'
import { useTokenPrices } from '@/features/tokens/useTokenList'
import { TokenSelector } from '@/features/tokens/TokenSelector'
import { cn } from '@/lib/cn'

export const ETH_FAUCET_AMOUNT = 10n * 10n ** 18n

/** Dev-only: top up native ETH with Anvil's anvil_setBalance (no wallet signature, local node only). */
export async function requestDevEth(account: `0x${string}`, amount = ETH_FAUCET_AMOUNT): Promise<bigint> {
  const rpc = async (method: string, params: unknown[]) => {
    const res = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) })
    const body = (await res.json()) as { result?: unknown; error?: { message: string } }
    if (body.error) throw new Error(body.error.message)
    return body.result
  }
  const chainId = Number(await rpc('eth_chainId', []))
  if (chainId !== DEVNET_CHAIN_ID) throw new Error('The ETH faucet only works on the local MetaChain Devnet')
  const current = BigInt((await rpc('eth_getBalance', [account, 'latest'])) as string)
  const next = current + amount
  await rpc('anvil_setBalance', [account, `0x${next.toString(16)}`])
  return next
}

const faucetTokens = DEVNET_TOKENS.filter((t) => t.symbol !== 'WETH')
const faucetSet = new Set([NATIVE_ETH, ...faucetTokens].map((t) => t.address.toLowerCase()))
const isFaucetToken = (t: Token) => faucetSet.has(t.address.toLowerCase())

/** /buy on devnet: a faucet instead of a fiat on-ramp (ui-ux.md §6.1 → PLAN "Buy"). */
export function BuyForm() {
  const wallet = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const { switchToDevnet } = useSwitchToDevnet()
  const client = usePublicClient()
  const qc = useQueryClient()
  const { prices } = useTokenPrices()
  const tokens = useMemo(() => [NATIVE_ETH, ...faucetTokens], [])
  const { balances } = useTokenBalances(tokens, wallet.address)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [pick, setPick] = useState<Token>(NATIVE_ETH)
  const [selectorOpen, setSelectorOpen] = useState(false)

  const info = useQuery({
    queryKey: ['faucet-info', wallet.address],
    enabled: !!client && faucetTokens.length > 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      const out: Record<string, { amount?: bigint; waitSec: number }> = {}
      await Promise.all(
        faucetTokens.map(async (t) => {
          const [amount, wait] = await Promise.all([
            client!.readContract({ address: t.address, abi: testErc20Abi, functionName: 'faucetAmount' }).catch(() => undefined),
            wallet.address ? client!.readContract({ address: t.address, abi: testErc20Abi, functionName: 'faucetAvailableIn', args: [wallet.address] }).catch(() => 0n) : Promise.resolve(0n),
          ])
          out[t.address.toLowerCase()] = { amount, waitSec: Number(wait) }
        }),
      )
      return out
    },
  })

  const mark = (k: string) => setDone((s) => new Set(s).add(k))

  async function claimToken(t: Token, quiet = false): Promise<boolean> {
    if (!wallet.address) return false
    const meta = info.data?.[t.address.toLowerCase()]
    if (meta && meta.waitSec > 0) {
      if (!quiet) toast.info(`${t.symbol} faucet cooling down`, `Available again in ${formatDuration(meta.waitSec)}.`)
      return false
    }
    const hash = await writeContract(wagmiConfig, { address: t.address, abi: testErc20Abi, functionName: 'faucet' })
    const receipt = await trackTx(wallet.address, { hash, type: 'faucet', summary: `Received ${meta?.amount ? formatTokenAmount(meta.amount, t.decimals) : ''} test ${t.symbol}` }, { toast: !quiet })
    if (!receipt || receipt.status !== 'success') throw new Error(`${t.symbol} faucet reverted`)
    mark(t.address)
    return true
  }

  async function claimEth(quiet = false) {
    if (!wallet.address) return
    await requestDevEth(wallet.address)
    invalidateChainQueries()
    mark(NATIVE_ETH.address)
    if (!quiet) toast.success('Received 10 test ETH', 'Balance set directly on the local Anvil node.')
  }

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      const err = parseTxError(e)
      if (err.kind !== 'rejected') toast.error('Faucet failed', err.message)
    } finally {
      setBusy(null)
      void qc.invalidateQueries({ queryKey: ['faucet-info'] })
    }
  }

  const claimAll = () =>
    run('all', async () => {
      await claimEth(true)
      let n = 0
      for (const t of faucetTokens) if (await claimToken(t, true)) n++
      toast.success('Test tokens received', `10 ETH${n ? ` and ${n} test token${n === 1 ? '' : 's'}` : ''} added to your wallet.`)
    })

  const pickMeta = pick.isNative ? undefined : info.data?.[pick.address.toLowerCase()]
  const pickAmount = pick.isNative ? '10' : pickMeta?.amount !== undefined ? formatTokenAmount(pickMeta.amount, pick.decimals) : undefined
  const pickCooldown = pickMeta?.waitSec ?? 0
  const pickBalance = balances[pick.address.toLowerCase()]
  const pickPrice = prices[pick.address.toLowerCase()]
  const chips = [NATIVE_ETH, ...faucetTokens.filter((t) => t.symbol === 'mUSDC' || t.symbol === 'META')]

  let cta: React.ReactNode
  if (!wallet.address)
    cta = (
      <Button size="xl" fullWidth variant="tint" style={{ height: 54, borderRadius: 20 }} onClick={openConnect} data-testid="buy-connect">
        Connect wallet
      </Button>
    )
  else if (wallet.wrongNetwork)
    cta = (
      <Button size="xl" fullWidth variant="warning" style={{ height: 54, borderRadius: 20 }} onClick={() => void switchToDevnet()}>
        Switch to MetaChain Devnet
      </Button>
    )
  else
    cta = (
      <Button
        size="xl"
        fullWidth
        style={{ height: 54, borderRadius: 20 }}
        data-testid="buy-cta"
        loading={busy === pick.address}
        disabled={!!busy || pickCooldown > 0}
        onClick={() => run(pick.address, () => (pick.isNative ? claimEth() : claimToken(pick)))}
      >
        {pickCooldown > 0 ? `Available in ${formatDuration(pickCooldown)}` : `Get ${pickAmount ?? ''} ${pick.symbol}`}
      </Button>
    )

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-[264px] flex-col rounded-[20px] border border-border bg-surface-1 px-4 pt-3 pb-[52px]" data-testid="buy-hero">
        <div className="flex items-center justify-between">
          <span className="text-body-3 text-text-2">You're getting</span>
          <span className="flex h-6 items-center gap-1 rounded-full bg-surface-3 px-2 text-body-4 font-semibold text-text-2">
            <FlaskConical size={14} /> Test tokens
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-end">
          <div className="flex items-baseline gap-2 tabular" data-testid="buy-amount">
            {pickAmount === undefined ? (
              <Skeleton width={160} height={60} rounded="lg" />
            ) : (
              <>
                <span className="text-[70px] leading-[60px] font-medium">{pickAmount}</span>
                <span className="text-heading-3 text-text-3">{pick.symbol}</span>
              </>
            )}
          </div>
          <div className="mt-[28px] flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Token">
            {chips.map((t) => (
              <button
                key={t.address}
                type="button"
                role="radio"
                aria-checked={pick.address === t.address}
                onClick={() => setPick(t)}
                data-testid={`buy-pick-${t.symbol}`}
                className={cn(
                  'h-[37px] rounded-full border border-border bg-surface-1 px-4 text-body-2 leading-[18px] font-semibold transition-colors hover:bg-surface-2',
                  pick.address === t.address ? 'text-text-1' : 'text-text-2',
                )}
              >
                {t.symbol}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setSelectorOpen(true)}
        className="flex h-[72px] items-center gap-3 rounded-[20px] bg-surface-2 p-4 text-left transition-colors hover:bg-surface-2-hover"
        data-testid="buy-token"
      >
        <TokenLogo token={pick} size={40} chainBadge />
        <span className="min-w-0 flex-1 text-body-2 leading-[22px]">{pick.symbol}</span>
        {wallet.address && pickBalance !== undefined && (
          <span className="text-body-3 text-text-2 tabular">
            {formatTokenAmount(pickBalance, pick.decimals)} {pick.symbol}
            {pickPrice !== undefined && ` · ${formatUsd(toNumber(pickBalance, pick.decimals) * pickPrice)}`}
          </span>
        )}
        <ChevronRight size={20} className="text-text-2" />
      </button>
      {cta}
      <TokenSelector open={selectorOpen} onOpenChange={setSelectorOpen} selected={pick} onSelect={setPick} filter={isFaucetToken} title="Select a test token" />

      {wallet.address && !wallet.wrongNetwork && (
        <section className="mt-6" aria-labelledby="all-test-tokens">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 id="all-test-tokens" className="text-body-1 font-medium">
              All test tokens
            </h2>
            <Button size="sm" variant="secondary" onClick={claimAll} loading={busy === 'all'} disabled={!!busy} data-testid="get-test-tokens" leftIcon={<Droplets size={14} />}>
              Get all
            </Button>
          </div>
          <ul className="flex flex-col rounded-[20px] border border-border px-4" data-testid="faucet-list">
            <FaucetRow
              token={NATIVE_ETH}
              amountLabel="10 ETH"
              balance={balances[NATIVE_ETH.address.toLowerCase()]}
              price={prices[NATIVE_ETH.address.toLowerCase()]}
              busy={busy === NATIVE_ETH.address}
              done={done.has(NATIVE_ETH.address)}
              disabled={!!busy}
              onClick={() => run(NATIVE_ETH.address, () => claimEth())}
            />
            {faucetTokens.map((t) => {
              const meta = info.data?.[t.address.toLowerCase()]
              return (
                <FaucetRow
                  key={t.address}
                  token={t}
                  amountLabel={meta?.amount !== undefined ? `${formatTokenAmount(meta.amount, t.decimals)} ${t.symbol}` : undefined}
                  loading={info.isLoading}
                  cooldown={meta?.waitSec}
                  balance={balances[t.address.toLowerCase()]}
                  price={prices[t.address.toLowerCase()]}
                  busy={busy === t.address}
                  done={done.has(t.address)}
                  disabled={!!busy}
                  onClick={() => run(t.address, () => claimToken(t))}
                />
              )
            })}
          </ul>
          {faucetTokens.length === 0 && <Banner tone="warning" title="No test tokens deployed">Run the deploy scripts and sdk sync to populate the token list.</Banner>}
        </section>
      )}
      <p className="mt-3 px-2 text-center text-body-4 text-text-3">
        MetaChain Devnet is a local test network. Tokens here have no value: ETH is set on your local Anvil node and each test token has a public faucet (once per hour per address).
      </p>
    </div>
  )
}

function FaucetRow(p: {
  token: Token
  amountLabel?: string
  loading?: boolean
  cooldown?: number
  balance?: bigint
  price?: number
  busy: boolean
  done: boolean
  disabled: boolean
  onClick: () => void
}) {
  const cooling = (p.cooldown ?? 0) > 0
  return (
    <li className="flex min-h-16 items-center gap-3 border-t border-border py-3 first:border-t-0" data-testid={`faucet-row-${p.token.symbol}`}>
      <TokenLogo token={p.token} size={36} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{p.token.symbol}</div>
        <div className="text-body-4 text-text-2 tabular">
          Balance {p.balance !== undefined ? formatTokenAmount(p.balance, p.token.decimals) : '…'}
          {p.balance !== undefined && p.price !== undefined && ` · ${formatUsd(toNumber(p.balance, p.token.decimals) * p.price)}`}
        </div>
      </div>
      <div className="text-right text-body-3 tabular">{p.loading ? <Skeleton width={70} height={14} /> : p.amountLabel ?? ''}</div>
      <Button
        size="sm"
        variant={p.done ? 'secondary' : 'tint'}
        onClick={p.onClick}
        loading={p.busy}
        disabled={p.disabled || cooling}
        className="w-[88px]"
        leftIcon={p.done && !p.busy ? <Check size={14} /> : undefined}
      >
        {cooling ? formatDuration(p.cooldown!) : p.done ? 'Again' : 'Get'}
      </Button>
    </li>
  )
}
