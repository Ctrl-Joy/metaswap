import { createConnector } from 'wagmi'
import { mock } from 'wagmi/connectors'
import { getAddress, type Address } from 'viem'
import { ANVIL_ACCOUNTS } from '@/config'
import { safeStorage } from '@/lib/storage'

// "Dev wallet": wagmi's mock connector bound to one Anvil account. Anvil keeps its default
// accounts unlocked, so eth_sendTransaction and eth_signTypedData_v4 are forwarded straight
// to the node and signed there — no extension and no private keys in the browser.

export const DEV_WALLET_TYPE = 'metaswapDev'
const STORAGE_KEY = 'metaswap.devWallet.connected'

export function devWalletId(index: number): string {
  return `metaswap-dev-${index}`
}

export function isDevWalletId(id: string | undefined): boolean {
  return !!id && id.startsWith('metaswap-dev-')
}

export function devWallet(index: number) {
  const address = getAddress(ANVIL_ACCOUNTS[index]!) as Address
  const id = devWalletId(index)
  const base = mock({ accounts: [address], features: { reconnect: true } })

  return createConnector((config) => {
    const inner = base(config)
    return {
      ...inner,
      id,
      name: `Dev wallet #${index}`,
      type: DEV_WALLET_TYPE,
      icon: undefined,
      async connect(params) {
        const res = await inner.connect.call(this, params as never)
        safeStorage.setItem(STORAGE_KEY, id)
        return res as never
      },
      async disconnect() {
        if (safeStorage.getItem(STORAGE_KEY) === id) safeStorage.removeItem(STORAGE_KEY)
        await inner.disconnect.call(this)
      },
      async getAccounts() {
        return [address]
      },
      async isAuthorized() {
        return safeStorage.getItem(STORAGE_KEY) === id
      },
    }
  })
}

export const DEV_WALLET_COUNT = ANVIL_ACCOUNTS.length
