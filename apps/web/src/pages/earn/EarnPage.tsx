import { useState } from 'react'
import { PiggyBank, ShieldCheck, Clock3 } from 'lucide-react'
import { Banner, Badge, EmptyState, Skeleton } from '@/components/ui'
import { useAccountEarn, useEarnVaults } from '@/api/hooks'
import type { EarnVault } from '@/api/types'
import { formatUsd } from '@/lib/format'
import { useWallet } from '@/wallet/hooks'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { VaultCard } from '@/features/earn/VaultCard'
import { EarnModal } from '@/features/earn/EarnModal'

export default function EarnPage() {
  useDocumentTitle('Earn')
  const { address } = useWallet()
  const vaults = useEarnVaults()
  const mine = useAccountEarn(address)
  const [active, setActive] = useState<EarnVault | null>(null)
  const lifetime = (mine.data ?? []).reduce((s, p) => s + (p.lifetimeEarningsUsd ?? 0), 0)
  const deposited = (mine.data ?? []).reduce((s, p) => s + (p.valueUsd ?? 0), 0)

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-8 pb-24 md:px-8" data-testid="earn-page">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Badge tone="success">No lockup</Badge>
          <h1 className="mt-3 text-[40px] leading-[44px] font-semibold tracking-[-0.02em]">Earn</h1>
          <p className="mt-2 max-w-[520px] text-body-1 text-text-2">Deposit stablecoins or ETH into MetaSwap savings vaults and earn a fixed APY every second. Withdraw any time.</p>
        </div>
        {address && (mine.data?.length ?? 0) > 0 && (
          <div className="flex gap-8 rounded-2xl border border-border px-5 py-4" data-testid="earn-summary">
            <div>
              <div className="text-body-4 text-text-2">Deposited</div>
              <div className="text-heading-3 font-semibold tabular">{formatUsd(deposited)}</div>
            </div>
            <div>
              <div className="text-body-4 text-text-2">Lifetime earnings</div>
              <div className="text-heading-3 font-semibold text-success tabular">{formatUsd(lifetime)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="vault-list">
        {vaults.isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={300} rounded="lg" />)
        ) : vaults.isError || (vaults.data ?? []).length === 0 ? (
          <div className="md:col-span-2 lg:col-span-3">
            <EmptyState icon={<PiggyBank size={20} />} title="Earn vaults unavailable">
              The MetaSwap API did not return any vaults. The Stage 5 contracts may not be deployed yet.
            </EmptyState>
          </div>
        ) : (
          (vaults.data ?? []).map((v) => (
            <VaultCard key={v.address} vault={v} account={address} position={mine.data?.find((p) => String(typeof p.vault === 'object' ? p.vault.address : p.vault).toLowerCase() === v.address.toLowerCase())} onDeposit={() => setActive(v)} />
          ))
        )}
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        <Info icon={<Clock3 size={18} />} title="Accrues every second">A rate index grows continuously at the vault's APY. Your balance updates live.</Info>
        <Info icon={<ShieldCheck size={18} />} title="Funded reserve">Yield is paid from a reward reserve funded by the vault owner, not from your principal.</Info>
        <Info icon={<PiggyBank size={18} />} title="ERC-4626">Vault shares are standard ERC-4626 tokens (meUSDC, meUSDT, meETH).</Info>
      </div>
      <Banner tone="info" className="mt-6">
        Devnet only: APYs and reserves are test parameters on MetaChain Devnet. No real funds.
      </Banner>

      {active && <EarnModal vault={active} open={!!active} onOpenChange={(o) => !o && setActive(null)} />}
    </div>
  )
}

function Info({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-5">
      <span className="text-accent">{icon}</span>
      <h3 className="mt-2 font-semibold">{title}</h3>
      <p className="mt-1 text-body-3 text-text-2">{children}</p>
    </div>
  )
}
