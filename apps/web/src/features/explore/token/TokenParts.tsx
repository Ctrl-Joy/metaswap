import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, Droplets, FileCode2, Globe, Rocket, Share2 } from 'lucide-react'
import { useLaunchDetail, useLaunches } from '@/features/launches/api'
import { CHAIN_SLUG } from '@/config'
import { NATIVE_ADDRESS } from '@metaswap/sdk'
import { Badge, Button, Card, CopyButton, IconButton, Skeleton, TokenLogo, Usd } from '@/components/ui'
import { formatUsd, shortenAddress } from '@/lib/format'
import { cn } from '@/lib/cn'
import { extremes, toCandles } from '../transforms'
import type { CandlePoint } from '../types'
import { tokenDescription } from './tokenInfo'

export function TokenHeader({ symbol, name, address, loading }: { symbol: string; name: string; address: string; loading: boolean }) {
  const isNative = address === NATIVE_ADDRESS
  const [copied, setCopied] = useState(false)
  return (
    <header className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-body-3 text-text-2">
        <Link to="/explore/tokens" className="hover:text-text-1">
          Tokens
        </Link>
        <span className="mx-1.5 text-text-3">&gt;</span>
        <span className="text-text-1">{symbol || '...'}</span>
      </nav>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {loading ? <Skeleton width={44} height={44} /> : <TokenLogo token={{ symbol, address }} size={44} />}
          <div className="flex min-w-0 flex-col gap-1">
            {loading ? (
              <Skeleton width={180} height={24} />
            ) : (
              <h1 className="flex flex-wrap items-baseline gap-2 text-heading-3 font-semibold md:text-heading-2">
                <span className="truncate">{name}</span>
                <span className="text-body-1 font-medium text-text-2">{symbol}</span>
              </h1>
            )}
            <div className="flex flex-wrap items-center gap-2 text-body-3 text-text-2">
              <Badge tone="neutral">MetaChain Devnet</Badge>
              {!isNative && (
                <CopyButton value={address} label="Copy token address" className="text-body-3">
                  <span className="font-mono">{shortenAddress(address, 6)}</span>
                </CopyButton>
              )}
              {isNative && <span>Native token</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            label={copied ? 'Link copied' : 'Share link'}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href)
              } catch {
                /* clipboard blocked */
              }
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            <Share2 size={18} />
          </IconButton>
        </div>
      </div>
    </header>
  )
}

export function TokenStats({
  tvl,
  marketCap,
  fdv,
  volume24h,
  candles,
  loading,
}: {
  tvl: number | null
  marketCap: number | null
  fdv: number | null
  volume24h: number | null
  candles: CandlePoint[] | undefined
  loading: boolean
}) {
  const ext = extremes(toCandles(candles ?? []))
  const items: Array<{ label: string; node: ReactNode; testId: string }> = [
    { label: 'TVL', node: <Usd value={tvl} compact />, testId: 'stat-tvl' },
    { label: 'Market cap', node: <Usd value={marketCap} compact />, testId: 'stat-market-cap' },
    { label: 'FDV', node: <Usd value={fdv} compact />, testId: 'stat-fdv' },
    { label: '1D volume', node: <Usd value={volume24h} compact />, testId: 'stat-volume' },
    {
      label: '52W high',
      node: ext ? <span className="tabular">{formatUsd(ext.high, { compact: false })}</span> : <span className="text-text-3">-</span>,
      testId: 'stat-high',
    },
    {
      label: '52W low',
      node: ext ? <span className="tabular">{formatUsd(ext.low, { compact: false })}</span> : <span className="text-text-3">-</span>,
      testId: 'stat-low',
    },
  ]
  return (
    <section aria-label="Token statistics" className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3" data-testid="token-stats">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col gap-1" data-testid={it.testId}>
          <span className="text-body-3 text-text-2">{it.label}</span>
          <span className={cn('text-body-1 font-semibold', loading && 'text-transparent')}>{loading ? <Skeleton width={90} height={20} /> : it.node}</span>
        </div>
      ))}
    </section>
  )
}

export function TokenAbout({ symbol, name, address, topPool }: { symbol: string; name: string; address?: string; topPool?: { address: string; label: string } }) {
  const [open, setOpen] = useState(false)
  const text = tokenDescription(symbol)
  const isNative = !address || address.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
  const launches = useLaunches({})
  const launch = !isNative ? launches.data?.find((l) => l.token.toLowerCase() === address!.toLowerCase()) : undefined
  const detail = useLaunchDetail(launch?.auction)
  const website = detail.data?.website
  const chip = 'inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-body-3 font-semibold text-text-1 transition-colors hover:bg-surface-3'
  return (
    <section aria-label="About" className="flex flex-col gap-3" data-testid="token-about">
      <h2 className="text-heading-3 font-semibold">About {name}</h2>
      <p className={cn('max-w-[720px] text-body-2 text-text-2', !open && 'line-clamp-2')}>{text}</p>
      <div>
        <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Show less' : 'Show more'}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2" data-testid="token-links">
        {!isNative && (
          <CopyButton value={address!} label="Copy contract address" className={chip}>
            <FileCode2 size={15} aria-hidden /> Contract <span className="font-mono text-text-2">{shortenAddress(address!)}</span>
          </CopyButton>
        )}
        {topPool && (
          <Link to={`/explore/pools/${CHAIN_SLUG}/${topPool.address}`} className={chip} data-testid="token-link-pool">
            <Droplets size={15} aria-hidden /> Top pool · {topPool.label}
          </Link>
        )}
        <Link to={isNative ? '/swap?outputCurrency=ETH' : `/swap?outputCurrency=${address}`} className={chip} data-testid="token-link-trade">
          <ArrowLeftRight size={15} aria-hidden /> Trade {symbol}
        </Link>
        {launch && (
          <Link to={`/launches/${launch.auction}`} className={chip} data-testid="token-link-launch">
            <Rocket size={15} aria-hidden /> Launch auction
          </Link>
        )}
        {website && /^https?:\/\//.test(website) && (
          <a href={website} target="_blank" rel="noreferrer noopener" className={chip} data-testid="token-link-website">
            <Globe size={15} aria-hidden /> Website
          </a>
        )}
      </div>
    </section>
  )
}

/** Rounded surface wrapper used by the stat/about/tab blocks. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn('p-4 md:p-6', className)}>{children}</Card>
}
