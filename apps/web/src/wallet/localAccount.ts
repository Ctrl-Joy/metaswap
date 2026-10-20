// "Create account": a devnet-only local account (MetaSwap's stand-in for Uniswap's embedded wallet).
// A fresh private key is generated in the browser and kept in localStorage. It is a TEST-NETWORK key:
// it only ever talks to the local MetaChain Devnet RPC (chain 31337) and must never hold real funds.
import { createConnector } from 'wagmi'
import { createWalletClient, getAddress, http, numberToHex, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { DEVNET_TOKENS } from '@metaswap/sdk'
import { DEVNET_CHAIN_ID, RPC_URL } from '@/config'
import { safeStorage } from '@/lib/storage'
import { testErc20Abi } from '@/lib/abis'

export const LOCAL_ACCOUNT_ID = 'metaswap-local'
export const LOCAL_ACCOUNT_TYPE = 'metaswapLocal'
const KEY = 'metaswap.localAccount.devnetOnly'
const CONNECTED_KEY = 'metaswap.localAccount.connected'

export interface StoredLocalAccount {
  /** Devnet-only test key. Never import this into a real wallet. */
  privateKey: Hex
  address: Address
  createdAt: number
  network: 'metachain-devnet-31337'
  warning: string
}

export function loadLocalAccount(): StoredLocalAccount | null {
  try {
    const raw = safeStorage.getItem(KEY) as string | null
    if (!raw) return null
    const v = JSON.parse(raw) as StoredLocalAccount
    return /^0x[0-9a-fA-F]{64}$/.test(v.privateKey) ? { ...v, address: getAddress(v.address) } : null
  } catch {
    return null
  }
}

export function createLocalAccountKey(): StoredLocalAccount {
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  const stored: StoredLocalAccount = {
    privateKey,
    address: account.address,
    createdAt: Date.now(),
    network: 'metachain-devnet-31337',
    warning: 'MetaChain Devnet test account created by MetaSwap. Test network only: never send real funds to it.',
  }
  safeStorage.setItem(KEY, JSON.stringify(stored))
  return stored
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) })
  const body = (await res.json()) as { result?: unknown; error?: { message: string } }
  if (body.error) throw new Error(body.error.message)
  return body.result
}

export const LOCAL_FUND_ETH = 100n * 10n ** 18n

/**
 * Fund a fresh local account: 100 ETH via `anvil_setBalance`, then each test token's open `faucet()`
 * signed by the local key. Refuses anything but chain 31337.
 */
export async function fundLocalAccount(stored: StoredLocalAccount): Promise<{ eth: bigint; tokens: string[] }> {
  const chainId = Number(await rpc('eth_chainId', []))
  if (chainId !== DEVNET_CHAIN_ID) throw new Error('Local accounts only work on MetaChain Devnet (chain 31337)')
  await rpc('anvil_setBalance', [stored.address, numberToHex(LOCAL_FUND_ETH)])
  const client = createWalletClient({ account: privateKeyToAccount(stored.privateKey), transport: http(RPC_URL), chain: devnetChain() })
  const funded: string[] = []
  for (const t of DEVNET_TOKENS.filter((x) => x.symbol !== 'WETH')) {
    try {
      const hash = await client.writeContract({ address: t.address, abi: testErc20Abi, functionName: 'faucet', gas: 200_000n })
      await rpc('eth_getTransactionReceipt', [hash])
      funded.push(t.symbol)
    } catch {
      /* faucet missing / cooling down: skip */
    }
  }
  return { eth: LOCAL_FUND_ETH, tokens: funded }
}

function devnetChain() {
  return { id: DEVNET_CHAIN_ID, name: 'MetaChain Devnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } as const
}

type Req = { method: string; params?: unknown[] }

/** Minimal EIP-1193 provider that signs with the stored key and forwards reads to the devnet RPC. */
function makeProvider(getStored: () => StoredLocalAccount | null) {
  return {
    async request({ method, params = [] }: Req): Promise<unknown> {
      const stored = getStored()
      const account = stored ? privateKeyToAccount(stored.privateKey) : null
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return account ? [account.address] : []
        case 'eth_chainId':
          return numberToHex(DEVNET_CHAIN_ID)
        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain':
          return null
        case 'eth_sendTransaction': {
          if (!account) throw new Error('No local account')
          const tx = params[0] as { to?: Address; data?: Hex; value?: Hex; gas?: Hex }
          const client = createWalletClient({ account, transport: http(RPC_URL), chain: devnetChain() })
          return client.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined })
        }
        case 'eth_signTypedData_v4': {
          if (!account) throw new Error('No local account')
          const td = JSON.parse(params[1] as string) as Parameters<typeof account.signTypedData>[0]
          // EIP712Domain is implied by viem; drop it from the explicit types.
          const { EIP712Domain: _d, ...types } = (td.types ?? {}) as Record<string, unknown>
          return account.signTypedData({ ...td, types } as Parameters<typeof account.signTypedData>[0])
        }
        case 'personal_sign': {
          if (!account) throw new Error('No local account')
          return account.signMessage({ message: { raw: params[0] as Hex } })
        }
        default:
          return rpc(method, params)
      }
    },
    on() {},
    removeListener() {},
  }
}

/** wagmi connector for the stored local account. */
export function localAccountConnector() {
  return createConnector((config) => {
    const provider = makeProvider(loadLocalAccount)
    return {
      id: LOCAL_ACCOUNT_ID,
      name: 'Devnet account',
      type: LOCAL_ACCOUNT_TYPE,
      async setup() {},
      async connect() {
        const s = loadLocalAccount()
        if (!s) throw new Error('No devnet account in this browser yet. Create one first.')
        safeStorage.setItem(CONNECTED_KEY, '1')
        return { accounts: [s.address], chainId: DEVNET_CHAIN_ID } as never
      },
      async disconnect() {
        safeStorage.removeItem(CONNECTED_KEY)
      },
      async getAccounts() {
        const s = loadLocalAccount()
        return s ? [s.address] : []
      },
      async getChainId() {
        return DEVNET_CHAIN_ID
      },
      async getProvider() {
        return provider
      },
      async isAuthorized() {
        return safeStorage.getItem(CONNECTED_KEY) === '1' && !!loadLocalAccount()
      },
      async switchChain({ chainId }) {
        const chain = config.chains.find((c) => c.id === chainId)
        if (!chain) throw new Error('Unsupported chain')
        return chain
      },
      onAccountsChanged(accounts) {
        if (accounts.length === 0) config.emitter.emit('disconnect')
        else config.emitter.emit('change', { accounts: accounts.map((a) => getAddress(a)) })
      },
      onChainChanged(chain) {
        config.emitter.emit('change', { chainId: Number(chain) })
      },
      onDisconnect() {
        config.emitter.emit('disconnect')
      },
    }
  })
}
