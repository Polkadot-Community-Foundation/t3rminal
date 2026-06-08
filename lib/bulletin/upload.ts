/**
 * IPFS gateway helpers.
 *
 * The app is built as a static export (`next.config.ts: output: 'export'`),
 * so we can't have an API route to proxy IPFS reads. Daily reports are stored
 * via `preimageManager.submit` to Paseo Bulletin Next (which pins them to
 * Paseo Bulletin Next's IPFS service); to read them, we hit the dedicated v2
 * gateway first and fall back to public DHT gateways if it's slow.
 *
 *   - `paseo-bulletin-next-ipfs.polkadot.io` — v2 dedicated gateway; closest
 *     to source for content uploaded via the v2 bulletin chain.
 *   - `dweb.link`, `ipfs.io`, `nftstorage.link` — public gateways with
 *     `access-control-allow-origin: *`, well-connected to DHT. Useful when
 *     the v2 gateway lags right after upload (DHT propagation delay).
 *
 * `readFromGateway` races them in parallel and returns the first body to
 * arrive. `readJsonFromGateway` is the JSON wrapper.
 */

const GATEWAYS = [
  "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://nftstorage.link/ipfs/",
] as const

export const BULLETIN_ENDPOINTS = {
  /** Public gateway used for share links / "Open in IPFS" buttons. */
  paseo: {
    gateway: GATEWAYS[0],
  },
} as const

/**
 * Race fetches across all known gateways. First successful response wins;
 * remaining requests are aborted. Throws an aggregated error only if every
 * gateway fails.
 */
export async function readFromGateway(
  cid: string,
  timeoutMs = 30000
): Promise<Uint8Array> {
  const masterController = new AbortController()
  const masterTimeout = setTimeout(() => masterController.abort(), timeoutMs)

  const attempts = GATEWAYS.map(async (gateway) => {
    const url = `${gateway}${cid}`
    const response = await fetch(url, { signal: masterController.signal })
    if (!response.ok) {
      throw new Error(`${url} -> ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    return { gateway, bytes: new Uint8Array(buffer) }
  })

  try {
    const winner = await Promise.any(attempts)
    masterController.abort()
    console.log("[Bulletin] Fetched via", winner.gateway)
    return winner.bytes
  } catch (e) {
    if (e instanceof AggregateError) {
      const detail = e.errors.map((er) => (er instanceof Error ? er.message : String(er))).join(" | ")
      throw new Error(`All IPFS gateways failed: ${detail}`)
    }
    throw e
  } finally {
    clearTimeout(masterTimeout)
  }
}

export async function readJsonFromGateway<T = unknown>(cid: string, timeoutMs = 30000): Promise<T> {
  const bytes = await readFromGateway(cid, timeoutMs)
  const decoder = new TextDecoder()
  return JSON.parse(decoder.decode(bytes)) as T
}
