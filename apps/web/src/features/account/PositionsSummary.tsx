import { Link } from 'react-router-dom'
import { Layers } from 'lucide-react'
import type { Address } from 'viem'
import { Badge, ButtonLink, DoubleLogo, EmptyState, Skeleton } from '@/components/ui'
import { useAccountPositions } from '@/api/hooks'
import type { PositionRow } from '@/api/types'
import { useTokenList } from '@/features/tokens/useTokenList'
import { formatUsd } from '@/lib/format'

function addrOf(t: PositionRow['token0']): string {
  return typeof t === 'string' ? t : t.address
}

/** Compact list of the account's V2/V3 positions (from GET /accounts/:address/positions). */
export function PositionsSummary({ address, onNavigate }: { address: Address; onNavigate?: () => void }) {
  const q = useAccountPositions(address)
  const { find } = useTokenList()
  if (q.isLoading) return <Skeleton width="100%" height={56} rounded="lg" />
  if (q.isError) return <p className="py-6 text-center text-body-3 text-text-2">Positions unavailable — the MetaSwap API is not reachable.</p>
  const rows = (q.data ?? []).filter((p) => !p.closed)
  if (rows.length === 0)
    return (
      <EmptyState icon={<Layers size={20} />} title="No open positions" className="py-8" action={<ButtonLink to="/positions/create" size="sm" onClick={onNavigate}>New position</ButtonLink>}>
        Provide liquidity to earn fees on every trade through your range.
      </EmptyState>
    )
  return (
    <ul className="flex flex-col" data-testid="positions-summary">
      {rows.map((p) => {
        const t0 = find(addrOf(p.token0))
        const t1 = find(addrOf(p.token1))
        const href = p.version === 'v3' ? `/positions/v3/${p.tokenId}` : `/positions/v2/${p.pair ?? p.pool}`
        return (
          <li key={`${p.version}-${p.tokenId ?? p.pair}`}>
            <Link to={href} onClick={onNavigate} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2">
              <DoubleLogo token0={t0} token1={t1} size={28} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-body-3 font-semibold">
                  {t0?.symbol}/{t1?.symbol}
                  <Badge>
                    {p.version}
                    {p.fee ? ` ${p.fee / 10_000}%` : ''}
                  </Badge>
                </span>
                <span className={p.inRange ? 'text-body-4 text-success' : 'text-body-4 text-warning'}>{p.inRange ? 'In range' : 'Out of range'}</span>
              </span>
              <span className="text-body-3 tabular">{formatUsd(p.valueUsd as number | null | undefined)}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
