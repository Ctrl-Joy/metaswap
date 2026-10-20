import { Link } from 'react-router-dom'
import type { Address } from 'viem'
import { Button, Skeleton, TokenLogo } from '@/components/ui'
import type { EarnPosition, EarnVault } from '@/api/types'
import { formatAmount, formatUsd } from '@/lib/format'
import { useTokenPrices } from '@/features/tokens/useTokenList'
import { isEthVault, useLiveAssets, useVaultChain } from './useVault'

export function assetLabel(v: EarnVault) {
  return isEthVault(v) ? 'ETH' : v.asset.symbol
}

/** Live position readout: assets ticking up at the APY between chain reads. */
export function LivePosition({ vault, account, position, size = 'md' }: { vault: EarnVault; account: Address | undefined; position?: EarnPosition; size?: 'md' | 'lg' }) {
  const chain = useVaultChain(vault.address, vault.asset.address, account)
  const live = useLiveAssets(chain.data?.assets, vault.apyPct, chain.data?.fetchedAt)
  const { prices } = useTokenPrices()
  const price = prices[vault.asset.address.toLowerCase()]
  if (!account) return <span className="text-text-3">-</span>
  if (chain.isLoading) return <Skeleton width={90} height={16} />
  if (!chain.data || chain.data.shares === 0n) return <span className="text-text-2">No deposit</span>
  const amount = (live ?? 0) / 10 ** vault.asset.decimals
  const earnings = position?.lifetimeEarningsUsd
  return (
    <span className="flex flex-col" data-testid={`earn-position-${vault.symbol}`}>
      <span className={size === 'lg' ? 'text-heading-3 font-semibold tabular' : 'text-body-2 font-semibold tabular'}>
        {amount.toLocaleString('en-US', { maximumFractionDigits: vault.asset.decimals > 8 ? 8 : 6, minimumFractionDigits: vault.asset.decimals > 8 ? 8 : 6 })} {assetLabel(vault)}
      </span>
      <span className="text-body-4 text-text-2 tabular">
        {price !== undefined ? formatUsd(amount * price) : ''}
        {earnings != null && earnings > 0 && <span className="text-success"> · +{formatUsd(earnings)} earned</span>}
      </span>
    </span>
  )
}

export function VaultCard({ vault, account, position, onDeposit }: { vault: EarnVault; account: Address | undefined; position?: EarnPosition; onDeposit: () => void }) {
  return (
    <div className="flex flex-col gap-5 rounded-3xl border border-border bg-surface-1 p-5" data-testid={`vault-card-${vault.symbol}`}>
      <Link to={`/earn/${vault.address}`} className="flex items-center gap-3">
        <TokenLogo token={{ symbol: assetLabel(vault), address: vault.asset.address }} size={44} chainBadge />
        <div className="min-w-0">
          <div className="text-body-1 font-semibold">{assetLabel(vault)}</div>
          <div className="truncate text-body-4 text-text-2">{vault.name ?? vault.symbol}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-heading-3 font-semibold text-success tabular">{vault.apyPct.toFixed(2)}%</div>
          <div className="text-body-4 text-text-2">APY</div>
        </div>
      </Link>
      <div className="grid grid-cols-2 gap-3 text-body-3">
        <div>
          <div className="text-text-2">TVL</div>
          <div className="font-medium tabular">{formatUsd(vault.tvlUsd, { compact: true })}</div>
        </div>
        <div>
          <div className="text-text-2">Depositors</div>
          <div className="font-medium tabular">{formatAmount(vault.depositors)}</div>
        </div>
      </div>
      <div className="rounded-2xl bg-surface-2 px-4 py-3">
        <div className="mb-1 text-body-4 text-text-2">Your position</div>
        <LivePosition vault={vault} account={account} position={position} />
      </div>
      <div className="flex gap-2">
        <Button fullWidth onClick={onDeposit} data-testid={`vault-deposit-${vault.symbol}`}>
          Deposit
        </Button>
        <Link to={`/earn/${vault.address}`} className="inline-flex h-10 items-center rounded-full bg-surface-3 px-4 font-semibold hover:bg-surface-3-hover">
          Details
        </Link>
      </div>
    </div>
  )
}
