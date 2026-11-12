import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Button, CopyButton, EmptyState, Skeleton, TokenLogo } from '@/components/ui'
import { useAccountEarn, useEarnVaults } from '@/api/hooks'
import { formatAmount, formatTokenAmount, formatUsd, shortenAddress, fixedNumber } from '@/lib/format'
import { useWallet } from '@/wallet/hooks'
import { useUi } from '@/state/ui'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { EarnModal, type EarnMode } from '@/features/earn/EarnModal'
import { assetLabel, LivePosition } from '@/features/earn/VaultCard'
import { useVaultChain } from '@/features/earn/useVault'
import { t } from '@/i18n'

export default function VaultPage() {
  const { vault: param } = useParams()
  const { address } = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const vaults = useEarnVaults()
  const mine = useAccountEarn(address)
  const vault = vaults.data?.find((v) => v.address.toLowerCase() === param?.toLowerCase() || v.symbol.toLowerCase() === param?.toLowerCase())
  const chain = useVaultChain(vault?.address, vault?.asset.address, address)
  const [modal, setModal] = useState<EarnMode | null>(null)
  useDocumentTitle(vault ? t('{asset} Earn', { asset: assetLabel(vault) }) : t('Earn'))
  const position = mine.data?.find((p) => String(typeof p.vault === 'object' ? p.vault.address : p.vault).toLowerCase() === vault?.address.toLowerCase())

  if (vaults.isLoading) return <div className="mx-auto max-w-[900px] px-4 pt-10"><Skeleton width="100%" height={300} rounded="lg" /></div>
  if (!vault)
    return (
      <div className="mx-auto max-w-[900px] px-4 pt-10">
        <EmptyState title={t('Vault not found')}>
          <Link to="/earn" className="text-accent hover:underline">{t('Back to Earn')}</Link>
        </EmptyState>
      </div>
    )

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 pt-6 pb-24 md:px-8" data-testid="vault-page">
      <nav className="flex items-center gap-1 text-body-3 text-text-2">
        <Link to="/earn" className="hover:text-text-1">{t('Earn')}</Link>
        <ChevronRight size={14} />
        <span className="text-text-1">{assetLabel(vault)}</span>
      </nav>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <TokenLogo token={{ symbol: assetLabel(vault), address: vault.asset.address }} size={56} chainBadge />
        <div>
          <h1 className="text-heading-3 font-semibold">{vault.name ?? vault.symbol}</h1>
          <CopyButton value={vault.address} className="font-mono text-body-4">
            {shortenAddress(vault.address)}
          </CopyButton>
        </div>
        <div className="ml-auto text-right">
          <div className="text-heading-2 font-semibold text-success tabular">{fixedNumber(vault.apyPct, 2)}%</div>
          <div className="text-body-3 text-text-2">APY</div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border border-border bg-surface-1 p-6">
          <div className="text-body-3 text-text-2">{t('Your position')}</div>
          <div className="mt-2">
            <LivePosition vault={vault} account={address} position={position} size="lg" />
          </div>
          {chain.data && chain.data.shares > 0n && (
            <div className="mt-3 text-body-4 text-text-3 tabular">
              {t('{amount} {symbol} shares', { amount: formatTokenAmount(chain.data.shares, vault.asset.decimals), symbol: vault.symbol })}
            </div>
          )}
          <div className="mt-6 flex gap-2">
            {address ? (
              <>
                <Button fullWidth size="lg" onClick={() => setModal('deposit')} data-testid="vault-deposit">
                  {t('Deposit')}
                </Button>
                <Button fullWidth size="lg" variant="secondary" onClick={() => setModal('withdraw')} disabled={!chain.data || chain.data.shares === 0n} data-testid="vault-withdraw">
                  {t('Withdraw')}
                </Button>
              </>
            ) : (
              <Button fullWidth size="lg" variant="tint" onClick={openConnect}>
                {t('Connect wallet')}
              </Button>
            )}
          </div>
        </div>
        <dl className="overflow-hidden rounded-3xl border border-border">
          {[
            ['TVL', formatUsd(vault.tvlUsd, { compact: true })],
            [t('Total deposits'), chain.data ? `${formatTokenAmount(chain.data.totalAssets, vault.asset.decimals)} ${assetLabel(vault)}` : '-'],
            [t('Depositors'), formatAmount(vault.depositors)],
            [t('Lifetime earnings'), position?.lifetimeEarningsUsd != null ? formatUsd(position.lifetimeEarningsUsd) : '-'],
            [t('Share token'), vault.symbol],
            [t('Native ETH'), assetLabel(vault) === 'ETH' ? 'depositETH / withdrawETH' : t('n/a')],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between border-t border-border px-5 py-3 text-body-3 first:border-t-0">
              <dt className="text-text-2">{k}</dt>
              <dd className="font-medium tabular">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {modal && <EarnModal vault={vault} open={!!modal} initialMode={modal} onOpenChange={(o) => !o && setModal(null)} />}
    </div>
  )
}
