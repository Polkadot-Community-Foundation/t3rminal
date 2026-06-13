/**
 * Bulletin gateway helper.
 *
 * Daily reports read primarily through the host preimage API (see
 * `lib/bulletin/client.ts`). The host store only resolves preimages this host
 * itself submitted, so reports created on another device/session — or before
 * propagation — fall back to a read here.
 *
 * That fallback hits ONLY the dedicated Parity-run gateway
 * (`paseo-bulletin-next-ipfs.polkadot.io`, same trust domain as the Bulletin
 * chain). We deliberately do NOT race third-party web2 gateways
 * (dweb.link / ipfs.io / nftstorage.link): those would leak the CID and access
 * pattern off-chain and trigger host web-domain prompts.
 */

const BULLETIN_GATEWAY = "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/" as const

export const BULLETIN_ENDPOINTS = {
  /** Dedicated v2 gateway — read fallback + share / "Open in IPFS" links. */
  paseo: {
    gateway: BULLETIN_GATEWAY,
  },
} as const

/**
 * Read JSON for a CID from the dedicated Bulletin gateway only (no third-party
 * gateway race). Used as the fallback when the host preimage lookup can't
 * serve a report (e.g. uploaded elsewhere, or not yet propagated).
 */
export async function readJsonFromGateway<T = unknown>(
  cid: string,
  timeoutMs = 30000,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = `${BULLETIN_GATEWAY}${cid}`
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`${url} -> ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } finally {
    clearTimeout(timer)
  }
}
