import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePublicClient } from 'wagmi'
import { ChevronLeft, Rocket } from 'lucide-react'
import { parseUnits, type Address } from 'viem'
import { DEVNET_TOKENS } from '@metaswap/sdk'
import { Banner, Button, Card, SegmentedTabs } from '@/components/ui'
import { priceOf, useTokenPrices } from '@/features/tokens/useTokenList'
import { useWallet } from '@/wallet/hooks'
import { useUi } from '@/state/ui'
import { formatAmount, formatUsd } from '@/lib/format'
import { cn } from '@/lib/cn'
import { GAS, txStep, useStepRunner, type SentTx } from '@/features/positions/execute'
import { ReviewRow, TxFlowModal } from '@/features/positions/components/TxFlowModal'
import { FEE_TIER_LIST } from '@/features/positions/tokens'
import { buildCreateLaunch, createdLaunch, launchpads, launchRevertMessage, type LaunchParamsInput } from './contracts'
import { launchpadAbi } from './abi'
import { humanToPrice, pctToBps } from './units'
import { formatCountdown } from './components/LaunchBits'

const QUOTES = DEVNET_TOKENS.filter((t) => t.symbol === 'mUSDC' || t.symbol === 'WETH')
const DURATIONS = [
  { label: '2m', sec: 120 },
  { label: '10m', sec: 600 },
  { label: '1h', sec: 3600 },
  { label: '6h', sec: 6 * 3600 },
  { label: '1d', sec: 86400 },
  { label: '3d', sec: 3 * 86400 },
  { label: '7d', sec: 7 * 86400 },
]

interface Form {
  name: string
  symbol: string
  supply: string
  auctionPct: string
  quote: string
  floor: string
  startMode: 'now' | 'scheduled'
  startAt: string
  durationSec: number
  threshold: string
  liquidityPct: string
  fee: number
  description: string
  website: string
  launchpad: string
}

/** /launches/create — form → review → createLaunch → redirect to the auction. */
export function CreateLaunch() {
  const pads = launchpads()
  const { address } = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const client = usePublicClient()
  const navigate = useNavigate()
  const { prices } = useTokenPrices()
  const [form, setForm] = useState<Form>({
    name: '',
    symbol: '',
    supply: '1000000000',
    auctionPct: '50',
    quote: QUOTES.find((t) => t.symbol === 'mUSDC')?.address ?? '',
    floor: '0.0001',
    startMode: 'now',
    startAt: '',
    durationSec: 86400,
    threshold: '5000',
    liquidityPct: '50',
    fee: 10000,
    description: '',
    website: '',
    launchpad: pads[0]?.address ?? '',
  })
  const [touched, setTouched] = useState<Set<keyof Form>>(new Set())
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setTouched((t) => (t.has(k) ? t : new Set(t).add(k)))
  }
  const quote = QUOTES.find((t) => t.address === form.quote)
  const quoteUsd = priceOf(prices, quote) ?? 0

  const v = useMemo(() => {
    const errors: Partial<Record<keyof Form, string>> = {}
    if (!form.name.trim()) errors.name = 'Required'
    if (!/^[A-Za-z0-9]{2,11}$/.test(form.symbol)) errors.symbol = '2–11 letters or digits'
    const supplyN = Number(form.supply)
    if (!(supplyN >= 1000) || !Number.isInteger(supplyN)) errors.supply = 'Whole number, at least 1,000'
    const auctionBps = pctToBps(form.auctionPct)
    if (auctionBps === null || auctionBps < 100 || auctionBps > 9900) errors.auctionPct = '1–99%'
    const floor = humanToPrice(form.floor)
    if (!floor || floor === 0n) errors.floor = 'Enter a floor price'
    const liqBps = pctToBps(form.liquidityPct)
    if (liqBps === null || liqBps < 100) errors.liquidityPct = '1–100%'
    let threshold: bigint | null = null
    try {
      threshold = quote && form.threshold ? parseUnits(form.threshold, quote.decimals) : null
    } catch {
      threshold = null
    }
    if (threshold === null) errors.threshold = 'Enter a minimum raise'
    let startAt: number | null = null
    if (form.startMode === 'scheduled') {
      const t = Date.parse(form.startAt)
      if (!Number.isFinite(t) || t < Date.now()) errors.startAt = 'Pick a future time'
      else startAt = Math.floor(t / 1000)
    }
    if (form.website && !/^https?:\/\//.test(form.website)) errors.website = 'Must start with http(s)://'
    if (!form.launchpad) errors.launchpad = 'No launchpad deployed'
    const supply = supplyN >= 1000 && Number.isInteger(supplyN) ? BigInt(form.supply) * 10n ** 18n : 0n
    const fdvQuote = floor ? (Number(floor) / 1e18) * supplyN : 0
    const raiseAtFloor = floor && auctionBps ? (Number(floor) / 1e18) * supplyN * (auctionBps / 10_000) : 0
    return { errors, supply, auctionBps, floor, liqBps, threshold, startAt, fdvQuote, raiseAtFloor, ok: Object.values(errors).every((e) => !e) }
  }, [form, quote])

  const [review, setReview] = useState(false)
  const runner = useStepRunner()

  const confirm = () => {
    if (!address || !quote || !v.ok || !client) return
    const out: SentTx = {}
    void runner
      .run(async () => {
        const block = await client.getBlock()
        const start = v.startAt ?? Number(block.timestamp) + 2
        const floor = v.floor!
        const tick = floor / 100n > 0n ? floor / 100n : 1n
        const params: LaunchParamsInput = {
          name: form.name.trim(),
          symbol: form.symbol.trim(),
          totalSupply: v.supply,
          auctionSupplyBps: BigInt(v.auctionBps!),
          quoteToken: quote.address,
          floorPrice: (floor / tick) * tick,
          tickSize: tick,
          startTime: BigInt(start),
          endTime: BigInt(start + form.durationSec),
          launchThreshold: v.threshold!,
          liquidityBps: BigInt(v.liqBps!),
          poolFee: form.fee,
          description: form.description.trim(),
          website: form.website.trim(),
        }
        // simulate first so InvalidParams(code) becomes a readable form error
        try {
          await client.simulateContract({ account: address, address: form.launchpad as Address, abi: launchpadAbi, functionName: 'createLaunch', args: [params] })
        } catch (err) {
          const msg = launchRevertMessage(err)
          if (msg) throw new Error(msg)
          throw err
        }
        return [
          txStep(
            { id: 'create', title: 'Create launch', description: 'Deploys the token and its auction', account: address, type: 'other', summary: `Created launch ${params.symbol}`, gas: GAS.createAndMint },
            () => buildCreateLaunch(form.launchpad as Address, params),
            out,
          ),
        ]
      })
      .then((ok) => {
        const created = ok ? createdLaunch(out.receipt) : null
        if (created) navigate(`/launches/${created.auction}`)
      })
  }

  // only show a field's error once the user has edited it
  const e = Object.fromEntries(Object.entries(v.errors).filter(([k]) => touched.has(k as keyof Form))) as typeof v.errors
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-6 pb-24 md:px-8" data-testid="create-launch">
      <Link to="/launches" className="mb-2 inline-flex items-center gap-1 text-body-3 text-text-2 hover:text-text-1">
        <ChevronLeft size={16} /> Launches
      </Link>
      <h1 className="mb-1 text-heading-3 font-semibold md:text-heading-2">Launch a token</h1>
      <p className="mb-6 text-body-3 text-text-2">
        A uniform-price batch auction sells part of the supply. If it raises the threshold, part of the proceeds and the reserved tokens seed a MetaSwap V3 pool at the clearing price. Otherwise every bidder is refunded.
      </p>
      {pads.length === 0 && (
        <Banner tone="warning" className="mb-4" title="Launchpads not deployed">
          The devnet deployment has no launchpad contracts yet. Redeploy the stack with DeployStage5.
        </Banner>
      )}
      <div className="flex flex-col gap-4">
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="text-body-1 font-semibold sm:col-span-2">Token</h2>
          <Field label="Name" error={e.name}>
            <Input value={form.name} onChange={(x) => set('name', x)} placeholder="Pixel Pup" testId="launch-name" />
          </Field>
          <Field label="Symbol" error={e.symbol}>
            <Input value={form.symbol} onChange={(x) => set('symbol', x.toUpperCase())} placeholder="PUP" testId="launch-symbol" />
          </Field>
          <Field label="Total supply" error={e.supply}>
            <Input value={form.supply} onChange={(x) => set('supply', x.replace(/\D/g, ''))} testId="launch-supply" />
          </Field>
          <Field label="Sold in auction (%)" error={e.auctionPct} hint="The rest is reserved for the liquidity pool.">
            <Input value={form.auctionPct} onChange={(x) => set('auctionPct', x)} testId="launch-auction-pct" />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <textarea value={form.description} onChange={(ev) => set('description', ev.target.value)} rows={2} data-testid="launch-description" className="w-full rounded-xl border border-border bg-surface-1 px-3 py-2 text-body-2 outline-none focus:border-surface-3-solid" />
          </Field>
          <Field label="Website" error={e.website} className="sm:col-span-2">
            <Input value={form.website} onChange={(x) => set('website', x)} placeholder="https://" testId="launch-website" />
          </Field>
        </Card>

        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="text-body-1 font-semibold sm:col-span-2">Auction</h2>
          <Field label="Raise in">
            <SegmentedTabs size="sm" ariaLabel="Quote token" value={form.quote} onChange={(x) => set('quote', x)} items={QUOTES.map((t) => ({ value: t.address, label: t.symbol === 'WETH' ? 'WETH / ETH' : t.symbol, testId: `launch-quote-${t.symbol}` }))} />
          </Field>
          <Field label={`Floor price (${quote?.symbol} per token)`} error={e.floor} hint={v.fdvQuote > 0 ? `FDV at floor: ${formatAmount(v.fdvQuote)} ${quote?.symbol} (${formatUsd(v.fdvQuote * quoteUsd, { compact: true })})` : undefined}>
            <Input value={form.floor} onChange={(x) => set('floor', x)} testId="launch-floor" />
          </Field>
          <Field label="Start">
            <div className="flex flex-col gap-2">
              <SegmentedTabs size="sm" ariaLabel="Start" value={form.startMode} onChange={(x) => set('startMode', x)} items={[{ value: 'now', label: 'Now', testId: 'launch-start-now' }, { value: 'scheduled', label: 'Scheduled', testId: 'launch-start-scheduled' }]} />
              {form.startMode === 'scheduled' && (
                <input type="datetime-local" value={form.startAt} onChange={(ev) => set('startAt', ev.target.value)} className="h-10 rounded-xl border border-border bg-surface-1 px-3 text-body-3" data-testid="launch-start-at" />
              )}
              {e.startAt && <span className="text-body-4 text-critical">{e.startAt}</span>}
            </div>
          </Field>
          <Field label="Duration" hint={formatCountdown(form.durationSec)}>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((d) => (
                <button key={d.sec} type="button" onClick={() => set('durationSec', d.sec)} data-testid={`launch-duration-${d.label}`} className={cn('h-8 rounded-full px-3 text-body-4 font-semibold', form.durationSec === d.sec ? 'bg-accent-fill text-white' : 'bg-surface-2 text-text-2 hover:text-text-1')}>
                  {d.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`Launch threshold (${quote?.symbol})`} error={e.threshold} hint={`Minimum raise. At the floor the auction raises up to ${formatAmount(v.raiseAtFloor)} ${quote?.symbol}.`}>
            <Input value={form.threshold} onChange={(x) => set('threshold', x)} testId="launch-threshold" />
          </Field>
          <Field label="Liquidity (% of raise)" error={e.liquidityPct} hint="Paired with the reserved tokens in a full-range V3 pool; the rest goes to you.">
            <Input value={form.liquidityPct} onChange={(x) => set('liquidityPct', x)} testId="launch-liquidity-pct" />
          </Field>
          <Field label="Pool fee tier">
            <SegmentedTabs size="sm" ariaLabel="Pool fee" value={String(form.fee)} onChange={(x) => set('fee', Number(x))} items={FEE_TIER_LIST.map((t) => ({ value: String(t.fee), label: t.label, testId: `launch-fee-${t.fee}` }))} />
          </Field>
          <Field label="Launchpad" error={e.launchpad}>
            <select value={form.launchpad} onChange={(ev) => set('launchpad', ev.target.value)} data-testid="launch-launchpad" className="h-10 w-full rounded-xl border border-border bg-surface-1 px-3 text-body-2">
              {pads.map((p) => (
                <option key={p.address} value={p.address}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </Card>

        {address ? (
          <Button size="xl" fullWidth disabled={!v.ok} onClick={() => setReview(true)} leftIcon={<Rocket size={18} />} data-testid="launch-review">
            {v.ok ? 'Review launch' : 'Complete the form'}
          </Button>
        ) : (
          <Button size="xl" fullWidth onClick={openConnect}>
            Connect wallet
          </Button>
        )}
      </div>

      <TxFlowModal open={review} onOpenChange={setReview} title="Review launch" runner={runner} confirmLabel="Create launch" onConfirm={confirm} testId="launch-modal">
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
          <ReviewRow label="Token">
            {form.name} ({form.symbol})
          </ReviewRow>
          <ReviewRow label="Total supply">{formatAmount(Number(form.supply))}</ReviewRow>
          <ReviewRow label="Auction supply">{form.auctionPct}%</ReviewRow>
          <ReviewRow label="Floor price">
            {form.floor} {quote?.symbol}
          </ReviewRow>
          <ReviewRow label="FDV at floor">{formatUsd(v.fdvQuote * quoteUsd, { compact: true })}</ReviewRow>
          <ReviewRow label="Start">{form.startMode === 'now' ? 'Now' : new Date(form.startAt).toLocaleString()}</ReviewRow>
          <ReviewRow label="Duration">{formatCountdown(form.durationSec)}</ReviewRow>
          <ReviewRow label="Threshold">
            {form.threshold} {quote?.symbol}
          </ReviewRow>
          <ReviewRow label="Liquidity">
            {form.liquidityPct}% of raise · {FEE_TIER_LIST.find((t) => t.fee === form.fee)?.label} pool
          </ReviewRow>
          <ReviewRow label="Launchpad">{pads.find((p) => p.address === form.launchpad)?.name}</ReviewRow>
        </div>
      </TxFlowModal>
    </div>
  )
}

function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-body-3 font-medium text-text-2">{label}</span>
      {children}
      {error ? <span className="text-body-4 text-critical">{error}</span> : hint ? <span className="text-body-4 text-text-3">{hint}</span> : null}
    </label>
  )
}

function Input({ value, onChange, placeholder, testId }: { value: string; onChange: (v: string) => void; placeholder?: string; testId?: string }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(ev) => onChange(ev.target.value)}
      data-testid={testId}
      className="h-10 w-full rounded-xl border border-border bg-surface-1 px-3 text-body-2 outline-none focus:border-surface-3-solid tabular"
    />
  )
}
