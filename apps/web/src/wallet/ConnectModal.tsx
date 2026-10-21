import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useConnect, useConnectors, type Connector } from 'wagmi'
import { ArrowLeft, ChevronRight, Code2, KeyRound, QrCode, ShieldAlert, Smartphone, Wallet, CircleCheck } from 'lucide-react'
import { Spinner, Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useUi } from '@/state/ui'
import { parseTxError } from '@/lib/errors'
import { ANVIL_ACCOUNTS, DEVNET_CHAIN_ID } from '@/config'
import { shortenAddress, formatAmount } from '@/lib/format'
import { safeStorage } from '@/lib/storage'
import { TopRightPanel } from '@/features/account/TopRightPanel'
import { DEV_WALLET_TYPE, devWalletId } from './devWallet'
import { createLocalAccountKey, fundLocalAccount, loadLocalAccount, LOCAL_ACCOUNT_ID } from './localAccount'

const DEV_ACCOUNT_KEY = 'metaswap.devWallet.lastIndex'

type View = 'main' | 'other' | 'mobile' | 'created' | 'login-none'

/** Row inside the joined option group (Uniswap: 62px, surface-2, 12px pad, 32px icon tile, 16px label). */
function OptionRow({ icon, label, right, onClick, testId, disabled, sub }: { icon: ReactNode; label: string; right?: ReactNode; onClick?: () => void; testId?: string; disabled?: boolean; sub?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testId} className="flex min-h-[62px] w-full items-center gap-3 bg-surface-2 p-3 text-left transition-colors hover:bg-surface-2-hover disabled:opacity-60">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-2 text-text-1">{label}</span>
        {sub && <span className="block text-body-4 text-text-2">{sub}</span>}
      </span>
      {right}
    </button>
  )
}

function Group({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 overflow-hidden rounded-2xl" data-testid={testId}>
      {children}
    </div>
  )
}

function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <button type="button" onClick={onBack} aria-label="Back" data-testid="connect-back" className="w-[15%] text-text-2 hover:text-text-1">
        <ArrowLeft size={24} />
      </button>
      <span className="text-body-2 font-medium text-text-1">{title}</span>
      <span className="w-[15%]" />
    </div>
  )
}

/**
 * Connect panel, laid out like Uniswap's (measured: docs/analysis/measured/connect-panel): 368px top-right
 * panel, centred "Connect a wallet", a joined group ("MetaSwap Mobile" → WalletConnect QR, "Other wallets ›"),
 * an "or" divider, a 46px "Create account" (devnet local account), "Log in", and the devnet terms line.
 * The Dev wallet (Anvil accounts #0–#4) lives under Other wallets.
 */
export function ConnectModal() {
  const open = useUi((s) => s.connectOpen)
  const setOpen = useUi((s) => s.setConnectOpen)
  const connectors = useConnectors()
  const { connectAsync } = useConnect()
  const [view, setView] = useState<View>('main')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const [devIndex, setDevIndex] = useState<number>(() => Number(safeStorage.getItem(DEV_ACCOUNT_KEY) ?? 0) || 0)
  const [created, setCreated] = useState<{ address: string; tokens: string[]; eth: bigint } | null>(null)

  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setPendingId(null)
      setError(null)
      setView('main')
    }, 250)
    return () => clearTimeout(t)
  }, [open])

  const groups = useMemo(() => {
    const dev = connectors.filter((c) => c.type === DEV_WALLET_TYPE)
    const discovered = connectors.filter((c) => c.type === 'injected' && c.id !== 'injected')
    const generic = connectors.find((c) => c.id === 'injected')
    const hasWindowEthereum = typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum
    const injected = discovered.length ? discovered : generic && hasWindowEthereum ? [generic] : []
    return {
      dev,
      injected,
      wc: connectors.find((c) => c.type === 'walletConnect'),
      cb: connectors.find((c) => c.type === 'coinbaseWallet'),
      local: connectors.find((c) => c.id === LOCAL_ACCOUNT_ID),
    }
  }, [connectors])

  async function connect(c: Connector, closeAfter = true) {
    setError(null)
    setPendingId(c.id)
    try {
      await connectAsync({ connector: c, chainId: DEVNET_CHAIN_ID })
      if (closeAfter) setOpen(false)
      return true
    } catch (e) {
      const err = parseTxError(e)
      if (err.kind !== 'rejected') setError({ id: c.id, message: /already pending|-32002/i.test(String((e as Error)?.message)) ? 'Check your wallet — a request is already open.' : err.message })
      return false
    } finally {
      setPendingId(null)
    }
  }

  /**
   * WalletConnect: like Uniswap, the QR replaces our panel. Close the panel while WalletConnect's own
   * modal is up; if the QR is dismissed (or fails) bring the panel back on the main view.
   */
  async function connectWalletConnect(c: Connector) {
    setError(null)
    setView('main')
    setOpen(false)
    try {
      await connectAsync({ connector: c, chainId: DEVNET_CHAIN_ID })
    } catch (e) {
      const err = parseTxError(e)
      setOpen(true)
      if (err.kind !== 'rejected') setError({ id: c.id, message: err.message })
    }
  }

  async function createAccount() {
    if (!groups.local) return
    setError(null)
    setPendingId('create')
    try {
      const stored = createLocalAccountKey()
      const funded = await fundLocalAccount(stored)
      setCreated({ address: stored.address, tokens: funded.tokens, eth: funded.eth })
      setPendingId(null)
      const ok = await connect(groups.local, false)
      if (ok) setView('created')
    } catch (e) {
      setError({ id: 'create', message: (e as Error).message })
      setPendingId(null)
    }
  }

  function logIn() {
    if (loadLocalAccount() && groups.local) void connect(groups.local)
    else setView('login-none')
  }

  const devConnector = groups.dev.find((c) => c.id === devWalletId(devIndex))
  const busy = !!pendingId

  return (
    <TopRightPanel open={open} onOpenChange={setOpen} title="Connect a wallet" testId="connect-modal">
      <div className="flex flex-col gap-4 p-4">
        {view === 'main' && (
          <>
            <div className="text-center text-body-2 font-medium text-text-1">Connect a wallet</div>
            <Group testId="connect-options">
              <OptionRow
                icon={<Smartphone size={18} />}
                label="MetaSwap Mobile"
                testId="connect-mobile"
                disabled={busy}
                sub={pendingId === groups.wc?.id ? 'Scan the QR code with your wallet…' : error && error.id === groups.wc?.id ? <span className="text-critical">{error.message}</span> : undefined}
                onClick={() => (groups.wc ? void connectWalletConnect(groups.wc) : setView('mobile'))}
                right={pendingId === groups.wc?.id ? <Spinner size={18} className="text-accent" /> : <QrCode size={20} className="text-text-2" />}
              />
              <OptionRow icon={<Wallet size={18} />} label="Other wallets" testId="connect-other-wallets" onClick={() => setView('other')} right={<ChevronRight size={20} className="text-text-2" />} />
            </Group>
            <div className="flex items-center gap-3 px-3 text-body-4 text-text-3" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => void createAccount()}
                disabled={busy || !groups.local}
                data-testid="create-account"
                className="flex h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-accent-fill px-4 text-body-2 font-semibold text-white transition-colors hover:bg-accent-fill-hover disabled:opacity-60"
              >
                {pendingId === 'create' && <Spinner size={16} />}
                {pendingId === 'create' ? 'Creating and funding…' : 'Create account'}
              </button>
              {error?.id === 'create' && <p className="text-center text-body-4 text-critical">{error.message}</p>}
              <button type="button" onClick={logIn} disabled={busy} data-testid="log-in" className="inline-flex items-center gap-1.5 text-body-2 font-semibold text-accent hover:opacity-80">
                {pendingId === LOCAL_ACCOUNT_ID ? <Spinner size={16} /> : <KeyRound size={16} />} Log in
              </button>
            </div>
            <Terms />
          </>
        )}

        {view === 'other' && (
          <>
            <SubHeader title="Other wallets" onBack={() => setView('main')} />
            <Group testId="other-wallets">
              {groups.injected.map((c) => (
                <ConnectorRow key={c.uid} connector={c} pending={pendingId === c.id} error={error?.id === c.id ? error.message : undefined} onClick={() => void connect(c)} badge="Detected" />
              ))}
              {groups.injected.length === 0 && (
                <div className="flex min-h-[62px] items-center gap-3 bg-surface-2 p-3 text-body-3 text-text-2" data-testid="no-browser-wallet">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-text-2">
                    <ShieldAlert size={18} />
                  </span>
                  <span>No browser wallet detected — install MetaMask or Rabby.</span>
                </div>
              )}
              {groups.cb && <ConnectorRow connector={groups.cb} pending={pendingId === groups.cb.id} error={error?.id === groups.cb.id ? error.message : undefined} onClick={() => void connect(groups.cb!)} />}
            </Group>
            {groups.dev.length > 0 && (
              <Group testId="dev-wallet-section">
                <div className="bg-surface-2 p-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">
                      <Code2 size={18} />
                    </span>
                    <span className="min-w-0 flex-1 text-body-2">Dev wallet</span>
                    <Badge tone="accent">Anvil</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1" role="radiogroup" aria-label="Dev wallet account" data-testid="dev-account-select">
                    {ANVIL_ACCOUNTS.map((addr, i) => (
                      <button
                        key={addr}
                        type="button"
                        role="radio"
                        aria-checked={devIndex === i}
                        data-testid={`dev-account-${i}`}
                        title={addr}
                        onClick={() => {
                          setDevIndex(i)
                          safeStorage.setItem(DEV_ACCOUNT_KEY, String(i))
                        }}
                        className={cn('flex flex-col items-center rounded-xl border px-1 py-1.5 text-body-4 transition-colors', devIndex === i ? 'border-accent bg-accent-tint text-text-1' : 'border-transparent bg-surface-3 text-text-2 hover:bg-surface-3-hover hover:text-text-1')}
                      >
                        <span className="font-semibold">#{i}</span>
                        <span className="text-[10px] opacity-80">{addr.slice(2, 6)}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    data-testid="connect-dev-wallet"
                    disabled={!devConnector || busy}
                    onClick={() => devConnector && void connect(devConnector)}
                    className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent-tint px-3 text-body-3 font-semibold text-accent transition-colors hover:bg-accent-tint-hover disabled:opacity-60"
                  >
                    {pendingId === devConnector?.id && <Spinner size={14} />}
                    Connect account #{devIndex} · {shortenAddress(ANVIL_ACCOUNTS[devIndex]!)}
                  </button>
                  {error && error.id === devConnector?.id && <p className="mt-2 text-center text-body-4 text-critical">{error.message}</p>}
                </div>
              </Group>
            )}
            <Terms />
          </>
        )}

        {view === 'mobile' && (
          <>
            <SubHeader title="MetaSwap Mobile" onBack={() => setView('main')} />
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface-2 p-4 text-center" data-testid="walletconnect-setup">
              <QrCode size={32} className="text-accent" />
              <p className="text-body-3 text-text-1">Mobile wallets connect through WalletConnect.</p>
              <p className="text-body-4 text-text-2">
                Set <code className="rounded bg-surface-3 px-1">VITE_WALLETCONNECT_PROJECT_ID</code> to a free project ID from cloud.walletconnect.com, restart the app, and this row opens a QR code to scan with your phone.
              </p>
            </div>
          </>
        )}

        {view === 'created' && created && (
          <div className="flex flex-col items-center gap-3 py-2 text-center" data-testid="account-created">
            <CircleCheck size={40} className="text-success" />
            <div className="text-body-1 font-medium">Devnet account ready</div>
            <div className="text-body-3 text-text-2" data-testid="created-address">
              {shortenAddress(created.address)}
            </div>
            <div className="text-body-4 text-text-2">
              Funded with {formatAmount(Number(created.eth / 10n ** 18n))} ETH{created.tokens.length ? ` and test ${created.tokens.join(', ')}` : ''}.
            </div>
            <p className="rounded-xl bg-warning-tint px-3 py-2 text-body-4 text-warning">This key lives in this browser and only works on MetaChain Devnet. Never send real funds to it.</p>
            <button type="button" onClick={() => setOpen(false)} data-testid="created-done" className="flex h-[46px] w-full items-center justify-center rounded-2xl bg-accent-fill text-body-2 font-semibold text-white hover:bg-accent-fill-hover">
              Start trading
            </button>
          </div>
        )}

        {view === 'login-none' && (
          <>
            <SubHeader title="Log in" onBack={() => setView('main')} />
            <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 text-center" data-testid="login-none">
              <p className="text-body-3 text-text-1">No devnet account in this browser yet.</p>
              <button type="button" onClick={() => void createAccount()} className="h-10 rounded-xl bg-accent-fill text-body-3 font-semibold text-white hover:bg-accent-fill-hover">
                Create account
              </button>
              <button type="button" onClick={() => setView('other')} className="text-body-3 font-semibold text-accent hover:opacity-80">
                Use another wallet
              </button>
            </div>
          </>
        )}
      </div>
    </TopRightPanel>
  )
}

function Terms() {
  return (
    <p className="px-2 text-center text-body-4 font-medium text-text-3" data-testid="connect-terms">
      MetaChain Devnet is a test network. By connecting a wallet you agree to MetaSwap&apos;s <span className="text-text-2">devnet terms</span>; <span className="text-text-2">never use a wallet holding real funds</span>.
    </p>
  )
}

function ConnectorRow({ connector, onClick, pending, error, badge }: { connector: Connector; onClick: () => void; pending: boolean; error?: string; badge?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      data-testid={`connector-${connector.id}`}
      className={cn('flex min-h-[62px] w-full items-center gap-3 p-3 text-left transition-colors hover:bg-surface-2-hover', error ? 'bg-critical-tint' : 'bg-surface-2')}
    >
      {connector.icon ? (
        <img src={connector.icon} alt="" className="size-8 rounded-lg" />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent-tint text-accent">
          <Wallet size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-2">{connector.name === 'Injected' ? 'Browser wallet' : connector.name}</span>
        {pending && <span className="block text-body-4 text-text-2">Connecting… open your wallet</span>}
        {error && !pending && <span className="block text-body-4 text-critical">{error} — try again</span>}
      </span>
      {badge && !pending && <Badge tone="success">{badge}</Badge>}
      {pending ? <Spinner size={18} className="text-accent" /> : <ChevronRight size={20} className="text-text-2" />}
    </button>
  )
}
