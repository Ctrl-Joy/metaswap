import { useEffect, useMemo, useState } from 'react'
import { useConnect, useConnectors, type Connector } from 'wagmi'
import { Code2, QrCode, Wallet, ChevronRight, ShieldAlert } from 'lucide-react'
import { Modal, Spinner, Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useUi } from '@/state/ui'
import { parseTxError } from '@/lib/errors'
import { ANVIL_ACCOUNTS, DEVNET_CHAIN_ID } from '@/config'
import { shortenAddress } from '@/lib/format'
import { DEV_WALLET_TYPE, devWalletId } from './devWallet'
import { safeStorage } from '@/lib/storage'

const DEV_ACCOUNT_KEY = 'metaswap.devWallet.lastIndex'

/** Custom MetaSwap connect modal (ui-ux.md §7.1): Dev wallet → EIP-6963 wallets → WalletConnect → Coinbase. */
export function ConnectModal() {
  const open = useUi((s) => s.connectOpen)
  const setOpen = useUi((s) => s.setConnectOpen)
  const connectors = useConnectors()
  const { connectAsync } = useConnect()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const [devIndex, setDevIndex] = useState<number>(() => Number(safeStorage.getItem(DEV_ACCOUNT_KEY) ?? 0) || 0)

  useEffect(() => {
    if (!open) {
      setPendingId(null)
      setError(null)
    }
  }, [open])

  const groups = useMemo(() => {
    const dev = connectors.filter((c) => c.type === DEV_WALLET_TYPE)
    const discovered = connectors.filter((c) => c.type === 'injected' && c.id !== 'injected')
    const generic = connectors.find((c) => c.id === 'injected')
    const hasWindowEthereum = typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum
    const injected = discovered.length ? discovered : generic && hasWindowEthereum ? [generic] : []
    const wc = connectors.find((c) => c.type === 'walletConnect')
    const cb = connectors.find((c) => c.type === 'coinbaseWallet')
    return { dev, injected, others: [wc, cb].filter(Boolean) as Connector[] }
  }, [connectors])

  async function connect(c: Connector) {
    setError(null)
    setPendingId(c.id)
    try {
      await connectAsync({ connector: c, chainId: DEVNET_CHAIN_ID })
      setOpen(false)
    } catch (e) {
      const err = parseTxError(e)
      // User rejection returns to the list silently (ui-ux.md §7.1).
      if (err.kind !== 'rejected') setError({ id: c.id, message: /already pending|-32002/i.test(String((e as Error)?.message)) ? 'Check your wallet — a request is already open.' : err.message })
    } finally {
      setPendingId(null)
    }
  }

  const devConnector = groups.dev.find((c) => c.id === devWalletId(devIndex))

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="Connect a wallet"
      width={368}
      testId="connect-modal"
      overlay={false}
      hideClose
      className="md:top-[73px]! md:right-3! md:left-auto! md:translate-x-0! md:translate-y-0! md:rounded-[20px]! [&_h2]:text-center [&_h2]:text-body-2 [&_h2]:font-medium"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5 overflow-hidden rounded-2xl" data-testid="connect-options">
          {groups.dev.length > 0 && (
            <div className="bg-surface-2 p-3" data-testid="dev-wallet-section">
              <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">
                  <Code2 size={18} />
                </span>
                <span className="min-w-0 flex-1 text-body-2 leading-[22px]">Dev wallet</span>
                <Badge tone="accent">Devnet</Badge>
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
                    className={cn(
                      'flex flex-col items-center rounded-xl border px-1 py-1.5 text-body-4 transition-colors',
                      devIndex === i ? 'border-accent bg-accent-tint text-text-1' : 'border-transparent bg-surface-3 text-text-2 hover:bg-surface-3-hover hover:text-text-1',
                    )}
                  >
                    <span className="font-semibold">#{i}</span>
                    <span className="font-mono text-[10px] opacity-80">{addr.slice(2, 6)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {groups.injected.map((c) => (
            <ConnectorRow key={c.uid} connector={c} pending={pendingId === c.id} error={error?.id === c.id ? error.message : undefined} onClick={() => connect(c)} badge="Detected" />
          ))}
          {groups.injected.length === 0 && (
            <div className="flex items-center gap-3 bg-surface-2 p-3 text-body-3 text-text-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-text-2">
                <ShieldAlert size={18} />
              </span>
              <span>No browser wallet detected. Install MetaMask or Rabby, or use the Dev wallet.</span>
            </div>
          )}
          {groups.others.map((c) => (
            <ConnectorRow key={c.uid} connector={c} pending={pendingId === c.id} error={error?.id === c.id ? error.message : undefined} onClick={() => connect(c)} />
          ))}
        </div>

        {groups.dev.length > 0 && (
          <>
            <div className="flex items-center gap-3 px-3 text-body-4 text-text-3" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <div>
              <button
                type="button"
                data-testid="connect-dev-wallet"
                disabled={!devConnector || !!pendingId}
                onClick={() => devConnector && connect(devConnector)}
                className="flex h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-accent-fill px-4 text-body-2 font-semibold text-white transition-colors hover:bg-accent-fill-hover disabled:opacity-60"
              >
                {pendingId === devConnector?.id ? <Spinner size={16} /> : null}
                Connect account #{devIndex} · {shortenAddress(ANVIL_ACCOUNTS[devIndex]!)}
              </button>
              {error && error.id === devConnector?.id && <p className="mt-2 text-center text-body-4 text-critical">{error.message}</p>}
            </div>
          </>
        )}

        <p className="px-1 text-center text-body-4 font-semibold text-text-3">
          MetaChain Devnet is a local test network (chain {DEVNET_CHAIN_ID}). Never connect a wallet holding real funds you are not prepared to test with.
        </p>
      </div>
    </Modal>
  )
}

function ConnectorRow({ connector, onClick, pending, error, badge }: { connector: Connector; onClick: () => void; pending: boolean; error?: string; badge?: string }) {
  const Icon = connector.type === 'walletConnect' ? QrCode : Wallet
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
          <Icon size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-2 leading-[22px]">{connector.name === 'Injected' ? 'Browser wallet' : connector.name}</span>
        {pending && <span className="block text-body-4 text-text-2">Connecting… open your wallet</span>}
        {error && !pending && <span className="block text-body-4 text-critical">{error} — try again</span>}
      </span>
      {badge && !pending && <Badge tone="success">{badge}</Badge>}
      {pending ? <Spinner size={18} className="text-accent" /> : <ChevronRight size={20} className="text-text-2" />}
    </button>
  )
}
