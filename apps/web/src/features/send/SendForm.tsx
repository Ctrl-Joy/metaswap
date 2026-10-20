import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { sendTransaction, writeContract } from 'wagmi/actions'
import { usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpDown, CircleCheck, User } from 'lucide-react'
import { NATIVE_ETH, type Token } from '@metaswap/sdk'
import { Banner, Button, Identicon, Modal, TokenLogo } from '@/components/ui'
import { cn } from '@/lib/cn'
import { erc20Abi } from '@/lib/abis'
import { formatAmount, formatTokenAmount, formatUsd, shortenAddress } from '@/lib/format'
import { maxSpendable, parseAmount, sanitizeAmountInput, toInputString, toNumber } from '@/lib/amount'
import { parseTxError, type FriendlyError } from '@/lib/errors'
import { useUi } from '@/state/ui'
import { trackTx } from '@/state/transactions'
import { wagmiConfig } from '@/wallet/wagmi'
import { useWallet, useSwitchToDevnet } from '@/wallet/hooks'
import { TokenButton } from '@/features/tokens/CurrencyInputPanel'
import { TokenSelector } from '@/features/tokens/TokenSelector'
import { useTokenList, useTokenPrices } from '@/features/tokens/useTokenList'
import { useTokenBalance } from '@/hooks/useTokenBalances'
import { checkRecipient, RECIPIENT_ERROR_TEXT } from './sendValidation'

/** Send tokens or ETH (flows.md §8): amount with USD toggle, recipient validation, review, track. */
export function SendForm() {
  const [params] = useSearchParams()
  const { find, all } = useTokenList()
  const wallet = useWallet()
  const openConnect = useUi((s) => s.openConnect)
  const { switchToDevnet } = useSwitchToDevnet()
  const { prices } = useTokenPrices()
  const client = usePublicClient()
  const [token, setToken] = useState<Token>(() => find(params.get('token')) ?? NATIVE_ETH)
  const [text, setText] = useState('')
  const [usdMode, setUsdMode] = useState(false)
  const [recipient, setRecipient] = useState(params.get('to') ?? '')
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const balance = useTokenBalance(token, wallet.address)
  const price = prices[token.address.toLowerCase()]

  const amount = useMemo(() => {
    if (!usdMode) return parseAmount(text, token.decimals)
    const usd = Number(text)
    if (!price || !(usd > 0)) return null
    return parseAmount(String(Number((usd / price).toFixed(Math.min(token.decimals, 12)))), token.decimals)
  }, [text, usdMode, token, price])
  const usdValue = amount !== null && price !== undefined ? toNumber(amount, token.decimals) * price : undefined

  const check = checkRecipient(recipient, { token, self: wallet.address, knownTokens: all })
  const code = useQuery({
    queryKey: ['code', check.ok ? check.address : null],
    enabled: check.ok && !!client,
    queryFn: () => client!.getCode({ address: (check as { address: `0x${string}` }).address }),
  })
  const isContract = !!code.data && code.data !== '0x'

  let cta: { label: string; disabled: boolean; onClick?: () => void; tone?: 'tint' | 'critical' | 'warning' }
  if (!wallet.address) cta = { label: 'Connect wallet', disabled: false, onClick: openConnect, tone: 'tint' }
  else if (wallet.wrongNetwork) cta = { label: 'Switch to MetaChain Devnet', disabled: false, onClick: () => void switchToDevnet(), tone: 'warning' }
  else if (!amount) cta = { label: 'Enter an amount', disabled: true }
  else if (balance !== undefined && balance < amount) cta = { label: `Insufficient ${token.symbol} balance`, disabled: true, tone: 'critical' }
  else if (!check.ok) cta = { label: check.error === 'empty' ? 'Enter a recipient' : RECIPIENT_ERROR_TEXT[check.error], disabled: true }
  else cta = { label: 'Review send', disabled: false, onClick: () => setReviewOpen(true) }

  const toggleUsd = () => {
    if (!price) return
    if (!usdMode && amount) setText(String(Number((toNumber(amount, token.decimals) * price).toFixed(2))))
    else if (usdMode && amount) setText(toInputString(amount, token.decimals, 6))
    setUsdMode((v) => !v)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-2xl border border-border bg-surface-1 p-4" data-testid="send-amount-panel">
        <div className="text-body-3 text-text-2">You're sending</div>
        <div className="flex flex-col items-center py-6">
          <div className="flex max-w-full items-baseline justify-center">
            {usdMode && <span className={cn('text-[48px] leading-[52px] font-medium', text ? 'text-text-1' : 'text-text-3')}>$</span>}
            <input
              inputMode="decimal"
              placeholder="0"
              aria-label={usdMode ? 'Amount in USD' : `Amount in ${token.symbol}`}
              data-testid="send-amount-input"
              value={text}
              onChange={(e) => {
                const v = sanitizeAmountInput(e.target.value, usdMode ? 2 : token.decimals)
                if (v !== null) setText(v)
              }}
              style={{ width: `${Math.max(1, text.length || 1) + 0.5}ch` }}
              className="max-w-full min-w-[1ch] bg-transparent text-center text-[48px] leading-[52px] font-medium tracking-[-0.02em] outline-none tabular"
            />
            {!usdMode && <span className="ml-2 text-heading-3 text-text-2">{token.symbol}</span>}
          </div>
          <button type="button" onClick={toggleUsd} disabled={!price} className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-body-3 text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-50" data-testid="send-usd-toggle">
            {usdMode ? `${amount ? formatTokenAmount(amount, token.decimals) : '0'} ${token.symbol}` : formatUsd(usdValue ?? 0)}
            <ArrowUpDown size={14} />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <TokenButton token={token} onClick={() => setSelectorOpen(true)} testId="send-token" />
          {wallet.address && balance !== undefined && (
            <div className="flex items-center gap-2 text-body-3 text-text-2">
              <span className="tabular">
                Balance: {formatTokenAmount(balance, token.decimals)}
              </span>
              <button
                type="button"
                className="rounded-full bg-accent-tint px-2 py-0.5 text-body-4 font-semibold text-accent hover:bg-accent-tint-hover"
                onClick={() => {
                  setUsdMode(false)
                  setText(toInputString(maxSpendable(balance, !!token.isNative), token.decimals, token.decimals))
                }}
              >
                Max
              </button>
            </div>
          )}
        </div>
      </div>

      <label className="mt-1 block rounded-2xl bg-surface-2 p-4" data-testid="send-recipient-panel">
        <span className="text-body-3 text-text-2">To</span>
        <span className="mt-2 flex items-center gap-3">
          {check.ok ? <Identicon address={check.address} size={28} /> : <span className="flex size-7 items-center justify-center rounded-full bg-surface-3 text-text-3"><User size={16} /></span>}
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Wallet address (0x…)"
            aria-label="Recipient address"
            data-testid="send-recipient"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-body-2 outline-none"
          />
        </span>
        {recipient && !check.ok && check.error !== 'empty' && <span className="mt-2 block text-body-4 text-critical" data-testid="recipient-error">{RECIPIENT_ERROR_TEXT[check.error]}</span>}
        {check.ok && check.warning === 'self' && <span className="mt-2 block text-body-4 text-warning">This is your own address.</span>}
        {check.ok && check.warning === 'checksum' && <span className="mt-2 block text-body-4 text-warning">Checksum mismatch — double-check this address.</span>}
        {check.ok && isContract && <span className="mt-2 block text-body-4 text-warning">This address is a contract. Make sure it can receive {token.symbol}.</span>}
      </label>

      <Button size="xl" fullWidth className="mt-1" data-testid="send-cta" disabled={cta.disabled} onClick={cta.onClick} variant={cta.tone === 'critical' ? 'critical' : cta.tone === 'warning' ? 'warning' : cta.tone === 'tint' ? 'tint' : 'primary'}>
        {cta.label}
      </Button>

      <TokenSelector
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        selected={token}
        onSelect={(t) => {
          setToken(t)
          setUsdMode(false)
          setText('')
        }}
      />
      {reviewOpen && amount && check.ok && wallet.address && (
        <SendReview
          open={reviewOpen}
          onOpenChange={(o) => {
            setReviewOpen(o)
            if (!o && sent) {
              setSent(false)
              setText('')
            }
          }}
          account={wallet.address}
          token={token}
          amount={amount}
          to={check.address}
          usdValue={usdValue}
          onSent={() => setSent(true)}
        />
      )}
    </div>
  )
}

function SendReview(p: { open: boolean; onOpenChange: (o: boolean) => void; account: `0x${string}`; token: Token; amount: bigint; to: `0x${string}`; usdValue?: number; onSent: () => void }) {
  const [phase, setPhase] = useState<'review' | 'pending' | 'done' | 'error'>('review')
  const [err, setErr] = useState<FriendlyError | null>(null)
  const label = `${formatTokenAmount(p.amount, p.token.decimals)} ${p.token.symbol}`
  const run = async () => {
    setPhase('pending')
    setErr(null)
    try {
      const hash = p.token.isNative
        ? await sendTransaction(wagmiConfig, { to: p.to, value: p.amount })
        : await writeContract(wagmiConfig, { address: p.token.address, abi: erc20Abi, functionName: 'transfer', args: [p.to, p.amount] })
      const receipt = await trackTx(p.account, { hash, type: 'send', summary: `Sent ${label} to ${shortenAddress(p.to)}`, meta: { token: p.token.address, to: p.to, amount: p.amount.toString() } })
      if (!receipt || receipt.status !== 'success') throw new Error('Transfer reverted')
      setPhase('done')
      p.onSent()
    } catch (e) {
      const fe = parseTxError(e)
      setErr(fe)
      setPhase(fe.kind === 'rejected' ? 'review' : 'error')
    }
  }
  return (
    <Modal open={p.open} onOpenChange={p.onOpenChange} title={phase === 'done' ? 'Sent' : 'Review send'} dismissible={phase !== 'pending'} testId="send-review">
      {phase === 'done' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid="send-success">
          <CircleCheck size={56} className="text-success" />
          <div className="text-heading-3 font-semibold">Sent!</div>
          <p className="text-body-3 text-text-2">
            {label} to <span className="font-mono">{shortenAddress(p.to)}</span>
          </p>
          <Button fullWidth size="lg" onClick={() => p.onOpenChange(false)}>
            Close
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-body-3 text-text-2">You're sending</div>
              <div className="text-heading-3 font-semibold tabular">{label}</div>
              {p.usdValue !== undefined && <div className="text-body-3 text-text-2">{formatUsd(p.usdValue)}</div>}
            </div>
            <TokenLogo token={p.token} size={40} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-body-3 text-text-2">To</div>
              <div className="font-mono text-body-2 break-all">{p.to}</div>
            </div>
            <Identicon address={p.to} size={40} />
          </div>
          {err && phase === 'error' && <Banner tone="critical" title={err.title}>{err.message}</Banner>}
          {phase === 'review' && err?.kind === 'rejected' && <p className="text-center text-body-4 text-text-2">Request rejected in wallet.</p>}
          <Button size="xl" fullWidth onClick={run} loading={phase === 'pending'} data-testid="confirm-send">
            {phase === 'pending' ? 'Sending…' : phase === 'error' ? 'Try again' : `Send ${formatAmount(toNumber(p.amount, p.token.decimals))} ${p.token.symbol}`}
          </Button>
        </div>
      )}
    </Modal>
  )
}
