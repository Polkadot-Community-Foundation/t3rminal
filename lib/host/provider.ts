/**
 * Host API PAPI providers
 *
 * Routes all chain RPC through the Polkadot Desktop host container, with a WS
 * fallback for chains the host doesn't yet expose.
 *
 * On polkadot-api v2 every layer (`getWsProvider`, product-sdk's
 * `createPapiProvider`, `createClient`) speaks `JsonRpcMessage` objects, so
 * no string↔object adapters are needed.
 */

import { createPapiProvider } from "@novasamatech/host-api-wrapper"
import { createClient, PolkadotClient } from "polkadot-api"
import { getWsProvider } from "@polkadot-api/ws-provider"

// Whether the build targets the public products devnet (standard Paseo
// 1000/1004/1010). The genesis hashes below (and the People WS default)
// differ per network, so they must switch on this flag.
const IS_DEVNET = process.env.NEXT_PUBLIC_NETWORK === "devnet"

// People / individuality parachain hosting pallet-coinage and the pUSD foreign
// asset. Genesis per SUMMIT_PLATFORM_PREREQUISITES (Summit) / the products
// devnet People chain (devnet). Constant name kept (PASEO_*) to avoid touching
// importers.
export const PASEO_INDIVIDUALITY_GENESIS = (
  IS_DEVNET
    ? "0xe6c30d6e148f250b887105237bcaa5cb9f16dd203bf7b5b9d4f1da7387cb86ec"
    : "0xbe5238f82c3553bc57ac3be43bef110bd58c49ad0744110814985195ca7d8c4e"
) as `0x${string}`
// People/individuality WS default, per target network.
export const PASEO_INDIVIDUALITY_WS = IS_DEVNET
  ? "wss://people-paseo.rotko.net"
  : "wss://summit-people-rpc.polkadot.io"

// Asset Hub — Revive contracts (T3rminalBulletinIndex). Genesis per
// SUMMIT_PLATFORM_PREREQUISITES (Summit) / standard Paseo AH (devnet). Constant
// name kept (PASEO_*) to avoid touching importers. MUST match the genesis baked
// into the .papi descriptor metadata (regenerate against the target AH — Diff
// 5), otherwise PAPI's computed `additionalSigned` diverges and every signed
// extrinsic dies with `BadProof`.
export const PASEO_ASSET_HUB_GENESIS = (
  IS_DEVNET
    ? "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2"
    : "0xf388dc6d6cdf6fb77eac3c4a91f31bc0c8642b142f1a757512ab7849f9f70660"
) as `0x${string}`
// Overridable at build time so a deploy to a different chain points the runtime
// app at the same chain its contract was deployed to.
// scripts/deploy-bulletin-index.ts writes NEXT_PUBLIC_ASSET_HUB_WS into
// .env.local; unset falls back to Summit Asset Hub.
export const PASEO_ASSET_HUB_WS =
  process.env.NEXT_PUBLIC_ASSET_HUB_WS ?? "wss://paseo-asset-hub-next-rpc.polkadot.io"

// Bulletin chain access goes through host `preimageManager.submit` (see
// lib/bulletin/client.ts) — the host's local signer is the only path that
// fits the multi-KB preimage payload, so we don't keep a direct PAPI
// client here. The merchant-signed alternative (signPayload via host)
// fails on the phone wallet's 256-byte payload ceiling.

let paseoIndividualityClient: PolkadotClient | null = null
let paseoAssetHubClient: PolkadotClient | null = null

export function getPaseoIndividualityClient(): PolkadotClient {
  if (paseoIndividualityClient) return paseoIndividualityClient
  // Pass a WS fallback so we still connect on hosts that don't yet expose this
  // chain as a known target. createPapiProvider probes host support during
  // isReady() and falls through to WS when absent.
  const provider = createPapiProvider(PASEO_INDIVIDUALITY_GENESIS, getWsProvider(PASEO_INDIVIDUALITY_WS))
  paseoIndividualityClient = createClient(provider)
  console.log("[Host Provider] Paseo Individuality client created (WS fallback)")
  return paseoIndividualityClient
}

export async function getPaseoIndividualityClientAsync(): Promise<PolkadotClient> {
  return getPaseoIndividualityClient()
}

export function getPaseoAssetHubClient(): PolkadotClient {
  if (paseoAssetHubClient) return paseoAssetHubClient
  // Route through host bridge with WS fallback. createPapiProvider probes
  // `host_feature_supported(Chain, genesis)` and falls through to the
  // provided WS provider when the host doesn't advertise the chain — so
  // standalone (regular browser tab) still works without code change.
  // Signing also goes through the host product-account signer (see
  // lib/host/accounts.ts), so chain RPC + signing share the host transport.
  const provider = createPapiProvider(PASEO_ASSET_HUB_GENESIS, getWsProvider(PASEO_ASSET_HUB_WS))
  paseoAssetHubClient = createClient(provider)
  console.log("[Host Provider] Paseo Asset Hub Next client created (host bridge + WS fallback)")
  return paseoAssetHubClient
}

export function resetClients(): void {
  if (paseoIndividualityClient) { paseoIndividualityClient.destroy(); paseoIndividualityClient = null }
  if (paseoAssetHubClient) { paseoAssetHubClient.destroy(); paseoAssetHubClient = null }
}
