/**
 * T3rminal is host-only — runs exclusively inside Polkadot Desktop / dot.li.
 * No PJS extensions, no Talisman/Nova/SubWallet, no external read-only mode.
 * Accounts are derived by the host's product-account flow (see lib/host/accounts.ts).
 */
export enum WalletProviderType {
  HostAPI = "host-api",
}

export enum WalletProviderStatus {
  Connected = "connected",
  Pending = "pending",
  Disconnected = "disconnected",
  Error = "error",
}

export type Account = {
  name: string
  address: string
  displayAddress?: string
  genesisHash?: `0x${string}`
  provider: WalletProviderType
}

export type WalletProviderEntry = {
  type: WalletProviderType
  status: WalletProviderStatus
}

export type PolkadotNamespaceChainId = `polkadot:${string}`

export interface Web3State {
  providers: WalletProviderEntry[]
  account: Account | null
  error?: string
}
