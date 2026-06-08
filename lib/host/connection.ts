/**
 * Host API connection
 *
 * Uses createAccountsProvider from host-api-wrapper with sandboxTransport
 * to connect to accounts. Works on both Desktop (webview) and dot.li (iframe).
 *
 * Why host-api-wrapper, not product-sdk: product-sdk is frozen at 0.7.9-4
 * (last release 2026-05-13). The maintainers continued development in
 * @novasamatech/host-api-wrapper, which is what p2p-market uses. Only
 * host-api-wrapper has a `getProductAccountSigner(account, "createTransaction")`
 * that actually accepts the second argument — product-sdk's version is
 * signPayload-only and routes through PJS, which throws on Asset Hub Next's
 * `AuthorizeValueTransfer` / `AsPgas` / `AsRingAlias` / `EthSetOrigin`.
 *
 * Only the accounts/signing path is migrated; the rest of t3rminal still
 * imports product-sdk (preimageManager, hostLocalStorage, papi provider,
 * permissions) since those slots haven't been touched in newer versions.
 */

import {
  sandboxProvider,
  sandboxTransport,
  createAccountsProvider,
} from "@novasamatech/host-api-wrapper"
import { isInHost } from "./detect"

let accountsProvider: ReturnType<typeof createAccountsProvider> | null = null
let connected = false

export function getAccountsProvider() {
  if (!accountsProvider) {
    accountsProvider = createAccountsProvider(sandboxTransport)
  }
  return accountsProvider
}

export async function connectToHost(): Promise<boolean> {
  if (!isInHost()) return false
  if (connected) return true

  if (!sandboxProvider.isCorrectEnvironment()) {
    console.log("[Host] Not in correct environment")
    return false
  }

  try {
    const provider = getAccountsProvider()
    connected = true
    console.log("[Host] Transport ready")
    return true
  } catch (e: any) {
    console.log(`[Host] Connection error: ${e?.message || e}`)
    return false
  }
}

export function isHostConnected(): boolean {
  return connected
}
