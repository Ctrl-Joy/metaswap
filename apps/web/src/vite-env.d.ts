/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_RPC_URL?: string
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
}
