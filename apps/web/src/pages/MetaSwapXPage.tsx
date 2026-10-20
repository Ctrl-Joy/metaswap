import { useEffect, useState } from 'react'
import { PenLine, Gavel, CheckCircle2, Fuel, ShieldCheck, Timer } from 'lucide-react'
import { ButtonLink, Badge } from '@/components/ui'
import { OrdersList } from '@/features/limit/OrdersList'
import { useWallet } from '@/wallet/hooks'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useXFillerStatus } from './useXFiller'

export default function MetaSwapXPage() {
  useDocumentTitle('MetaSwapX')
  const { address } = useWallet()
  const filler = useXFillerStatus()
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-8 pb-24 md:px-8">
      <section className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr]">
        <div>
          <Badge tone="accent">Live on MetaChain Devnet</Badge>
          <h1 className="mt-4 text-[40px] leading-[44px] font-semibold tracking-[-0.02em] md:text-heading-1">MetaSwapX</h1>
          <p className="mt-4 max-w-[520px] text-body-1 text-text-2">
            Sign what you want, not how to get it. MetaSwapX turns a trade into a signed intent. Fillers compete to deliver it, pay the gas, and the best price reaches you.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink to="/limit" size="lg">
              Place a limit order
            </ButtonLink>
            <ButtonLink to="/swap" size="lg" variant="secondary">
              Swap
            </ButtonLink>
          </div>
          <div className="mt-6 flex items-center gap-2 text-body-3 text-text-2">
            <span className={`size-2 rounded-full ${filler.running ? 'bg-success' : 'bg-text-3'}`} aria-hidden />
            {filler.running ? 'Devnet filler is online and watching the order book' : filler.loading ? 'Checking filler status…' : 'Devnet filler is offline — orders wait until a filler runs'}
          </div>
        </div>
        <DutchDecayDiagram />
      </section>

      <section className="mt-16">
        <h2 className="text-heading-3 font-semibold">How an intent order works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          <Step n={1} icon={<PenLine size={20} />} title="You sign an order">
            Pick what you sell and the least you will accept. Your wallet signs a Permit2 message that authorises exactly this order and nothing else. No gas.
          </Step>
          <Step n={2} icon={<Gavel size={20} />} title="Fillers compete">
            The order is a Dutch auction: the output you are offered starts high and falls toward your limit. The first filler who can pay the current amount wins.
          </Step>
          <Step n={3} icon={<CheckCircle2 size={20} />} title="Settled on-chain">
            The reactor contract pulls your tokens through Permit2 and checks that you received at least the decayed amount, all in one transaction the filler pays for.
          </Step>
        </ol>
      </section>

      <section className="mt-16 grid gap-4 md:grid-cols-3">
        <Feature icon={<Fuel size={20} />} title="Gasless">
          Fillers pay network fees. You only pay gas once to approve a token for Permit2, and to cancel.
        </Feature>
        <Feature icon={<ShieldCheck size={20} />} title="Protected">
          A failed or unprofitable fill costs you nothing. Your limit is enforced by the contract, not by trust.
        </Feature>
        <Feature icon={<Timer size={20} />} title="You set the clock">
          Orders expire after the time you choose. Cancel any time by invalidating the order's Permit2 nonce.
        </Feature>
      </section>

      <section className="mt-16" aria-labelledby="x-orders">
        <h2 id="x-orders" className="text-heading-3 font-semibold">
          Your orders
        </h2>
        <div className="mt-4 max-w-[640px]">{address ? <OrdersList /> : <p className="text-body-3 text-text-2">Connect a wallet to see your MetaSwapX orders.</p>}</div>
      </section>
    </div>
  )
}

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-border bg-surface-1 p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent-tint text-accent">{icon}</span>
        <span className="text-body-4 font-semibold text-text-3">STEP {n}</span>
      </div>
      <h3 className="mt-4 text-body-1 font-semibold">{title}</h3>
      <p className="mt-2 text-body-3 text-text-2">{children}</p>
    </li>
  )
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-5">
      <span className="text-accent">{icon}</span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1.5 text-body-3 text-text-2">{children}</p>
    </div>
  )
}

/**
 * Original illustration of an exclusive Dutch auction: optional exclusivity window, linear decay
 * from the start amount to the limit, then flat until the deadline. A marker sweeps the curve.
 */
function DutchDecayDiagram() {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setT(0.45)
      return
    }
    const id = setInterval(() => setT((v) => (v >= 1 ? 0 : v + 0.01)), 60)
    return () => clearInterval(id)
  }, [])
  // geometry
  const W = 440
  const H = 260
  const x0 = 48
  const x1 = 120 // decay start
  const x2 = 300 // decay end
  const x3 = 420 // deadline
  const yStart = 50
  const yEnd = 190
  const px = x0 + (x3 - x0) * t
  const py = px <= x1 ? yStart : px >= x2 ? yEnd : yStart + ((yEnd - yStart) * (px - x1)) / (x2 - x1)
  return (
    <figure className="rounded-3xl border border-border bg-surface-1 p-4" aria-label="Dutch auction decay diagram">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby="decay-title">
        <title id="decay-title">Output amount offered over time: flat during exclusivity, decaying linearly to your limit, then flat until the deadline.</title>
        <defs>
          <linearGradient id="decay-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--ms-accent-fill)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--ms-accent-fill)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x={x0} y={20} width={x1 - x0} height={H - 60} fill="var(--ms-surface-3)" rx="6" />
        <text x={(x0 + x1) / 2} y={36} textAnchor="middle" fontSize="10" fill="var(--ms-text-2)">exclusive</text>
        <line x1={x0} y1={yEnd} x2={x3} y2={yEnd} stroke="var(--ms-warning)" strokeDasharray="4 4" strokeWidth="1.5" />
        <text x={x3} y={yEnd + 16} textAnchor="end" fontSize="11" fill="var(--ms-warning)">your limit</text>
        <path d={`M${x0},${yStart} L${x1},${yStart} L${x2},${yEnd} L${x3},${yEnd} L${x3},${H - 40} L${x0},${H - 40} Z`} fill="url(#decay-fill)" />
        <path d={`M${x0},${yStart} L${x1},${yStart} L${x2},${yEnd} L${x3},${yEnd}`} fill="none" stroke="var(--ms-accent)" strokeWidth="3" strokeLinejoin="round" />
        <line x1={x0} y1={H - 40} x2={x3} y2={H - 40} stroke="var(--ms-border)" />
        <line x1={x0} y1={14} x2={x0} y2={H - 40} stroke="var(--ms-border)" />
        {[
          [x1, 'decay start'],
          [x2, 'decay end'],
          [x3, 'deadline'],
        ].map(([x, l]) => (
          <g key={l as string}>
            <line x1={x as number} y1={H - 44} x2={x as number} y2={H - 36} stroke="var(--ms-text-3)" />
            <text x={x as number} y={H - 22} textAnchor="middle" fontSize="10" fill="var(--ms-text-2)">{l}</text>
          </g>
        ))}
        <text x={x0 - 8} y={yStart + 4} textAnchor="end" fontSize="10" fill="var(--ms-text-2)">start</text>
        <text x={14} y={H / 2} fontSize="10" fill="var(--ms-text-3)" transform={`rotate(-90 14 ${H / 2})`} textAnchor="middle">output you receive</text>
        <line x1={px} y1={py} x2={px} y2={H - 40} stroke="var(--ms-accent)" strokeOpacity="0.4" />
        <circle cx={px} cy={py} r="7" fill="var(--ms-accent-fill)" stroke="white" strokeWidth="2" />
      </svg>
      <figcaption className="px-2 pt-1 text-body-4 text-text-2">A filler can fill at any point on the curve. The earlier it fills, the more you receive; you never receive less than your limit.</figcaption>
    </figure>
  )
}
