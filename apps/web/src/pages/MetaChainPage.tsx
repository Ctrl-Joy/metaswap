import { Layers, Zap, Boxes, Network, Plus, Clock3, CheckCircle2, CircleDashed } from 'lucide-react'
import { METACHAIN_NETWORKS, deployment } from '@metaswap/sdk'
import { Badge, Button, ButtonLink, CopyButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { addDevnetToWallet, useDevnetReachable } from '@/wallet/hooks'
import { RPC_URL } from '@/config'

const ROADMAP = [
  {
    phase: 'Now',
    title: 'MetaChain Devnet',
    status: 'live' as const,
    items: ['Local chain (Anvil, chain 31337) with 1s blocks', 'MetaSwap V2 + V3 pools, Permit2 and the Universal Router', 'MetaSwapX intent orders with an operator-run filler'],
  },
  {
    phase: 'Next',
    title: 'Public testnet',
    status: 'planned' as const,
    items: ['Same contracts, deployed per chain id', 'Public RPC, faucet and explorer', 'Sub-second preconfirmation research'],
  },
  {
    phase: 'Later',
    title: 'MetaChain mainnet',
    status: 'planned' as const,
    items: ['Ethereum L2 settling to L1', 'Native bridge and indexer at scale', 'Open MetaSwapX filler network'],
  },
]

const PLANNED_SPECS = [
  ['Stack', 'Optimistic rollup L2 (planned)'],
  ['Block time', '1 second target'],
  ['Preconfirmations', 'Sub-second target (~200–250 ms)'],
  ['Settlement', 'Ethereum L1'],
  ['Native asset', 'ETH'],
  ['Liquidity', 'MetaSwap V2/V3 and MetaSwapX from day one'],
]

export default function MetaChainPage() {
  useDocumentTitle('MetaChain')
  const { reachable, blockNumber } = useDevnetReachable()
  const devnet = METACHAIN_NETWORKS.find((n) => n.key === 'devnet')!
  const contracts = Object.keys(deployment.contracts ?? {}).length
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-8 pb-24 md:px-8">
      <section className="relative overflow-hidden rounded-3xl border border-border bg-surface-1 px-6 py-12 md:px-12 md:py-16">
        <div className="pointer-events-none absolute -top-24 -right-24 size-[360px] rounded-full opacity-50 blur-3xl" style={{ background: 'radial-gradient(circle, var(--ms-accent-fill), transparent 70%)' }} aria-hidden />
        <div className="relative max-w-[620px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">Devnet live</Badge>
            <Badge>Testnet and mainnet planned</Badge>
          </div>
          <h1 className="mt-4 text-[40px] leading-[44px] font-semibold tracking-[-0.02em] md:text-heading-1">MetaChain</h1>
          <p className="mt-4 text-body-1 text-text-2">
            A planned Ethereum layer 2 built around trading: fast blocks, deep MetaSwap liquidity from the first block, and intent settlement as a first-class feature. Today it runs as a local developer network.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button size="lg" leftIcon={<Plus size={18} />} onClick={() => void addDevnetToWallet()} data-testid="add-network">
              <span className="sm:hidden">Add to wallet</span>
              <span className="hidden sm:inline">Add MetaChain Devnet to wallet</span>
            </Button>
            <ButtonLink to="/swap" size="lg" variant="secondary">
              Trade on devnet
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-3">
        <Pillar icon={<Zap size={20} />} title="Built for speed">
          One-second blocks today, with a target of sub-second preconfirmations so swaps feel instant.
        </Pillar>
        <Pillar icon={<Layers size={20} />} title="Liquidity native">
          MetaSwap pools, Permit2 and the Universal Router ship with the chain, so trading works from genesis.
        </Pillar>
        <Pillar icon={<Boxes size={20} />} title="Intents first">
          MetaSwapX orders settle on the same chain they are filled on, with fillers competing for every trade.
        </Pillar>
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-heading-3 font-semibold">Devnet specs</h2>
          <dl className="mt-4 overflow-hidden rounded-2xl border border-border" data-testid="devnet-specs">
            <Spec label="Network name" value={devnet.name} />
            <Spec label="Chain ID" value={String(devnet.chainId)} />
            <Spec label="Native currency" value="ETH (18 decimals)" />
            <Spec label="RPC URL" value={<span className="inline-flex items-center gap-2 font-mono">{RPC_URL}<CopyButton value={RPC_URL} label="Copy RPC URL" /></span>} />
            <Spec label="Block time" value={`${devnet.blockTimeMs / 1000}s`} />
            <Spec label="Explorer" value="None (local devnet)" />
            <Spec label="Contracts deployed" value={contracts ? String(contracts) : 'Not yet synced'} />
            <Spec
              label="Status"
              value={
                <span className="inline-flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', reachable ? 'bg-success' : 'bg-critical')} />
                  {reachable ? `Online · block ${blockNumber?.toString() ?? ''}` : 'Not reachable'}
                </span>
              }
            />
          </dl>
        </div>
        <div>
          <h2 className="text-heading-3 font-semibold">MetaChain targets</h2>
          <dl className="mt-4 overflow-hidden rounded-2xl border border-border">
            {PLANNED_SPECS.map(([k, v]) => (
              <Spec key={k} label={k} value={v} />
            ))}
          </dl>
          <p className="mt-3 text-body-4 text-text-3">Planned features are targets, not commitments. No token, validator set or launch date has been announced.</p>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-heading-3 font-semibold">Networks</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3" data-testid="networks">
          {METACHAIN_NETWORKS.map((n) => (
            <div key={n.key} className="rounded-2xl border border-border bg-surface-1 p-5">
              <div className="flex items-center justify-between">
                <Network size={20} className="text-accent" />
                <Badge tone={n.status === 'live' ? 'success' : 'neutral'}>{n.status === 'live' ? 'Live' : 'Planned'}</Badge>
              </div>
              <h3 className="mt-3 font-semibold">{n.name}</h3>
              <p className="mt-1 text-body-3 text-text-2">{n.description}</p>
              <p className="mt-3 text-body-4 text-text-3">Chain ID {n.chainId ?? 'TBD'}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-heading-3 font-semibold">Roadmap</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {ROADMAP.map((r) => (
            <li key={r.phase} className={cn('rounded-2xl border p-5', r.status === 'live' ? 'border-accent bg-accent-solid' : 'border-border bg-surface-1')}>
              <div className="flex items-center gap-2 text-body-4 font-semibold text-text-2">
                {r.status === 'live' ? <CheckCircle2 size={16} className="text-success" /> : r.phase === 'Next' ? <Clock3 size={16} /> : <CircleDashed size={16} />}
                {r.phase.toUpperCase()}
              </div>
              <h3 className="mt-2 text-body-1 font-semibold">{r.title}</h3>
              <ul className="mt-3 flex flex-col gap-1.5 text-body-3 text-text-2">
                {r.items.map((i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-text-3" />
                    {i}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function Pillar({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-5">
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent-tint text-accent">{icon}</span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1.5 text-body-3 text-text-2">{children}</p>
    </div>
  )
}

function Spec({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 text-body-3 first:border-t-0">
      <dt className="text-text-2">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}
