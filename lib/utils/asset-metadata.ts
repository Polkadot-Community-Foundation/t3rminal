/**
 * Live asset symbol, pulled from on-chain metadata instead of hard-coding it.
 *
 * pUSD lives on Paseo Individuality as a pallet_assets entry keyed by an XCM
 * Location (not a plain integer). Its display symbol is stored in
 * `Assets.Metadata`, so we read it from the chain and cache it. `PUSD_SYMBOL`
 * stays the fallback until the first read resolves (or if the chain is
 * unreachable), so the UI never blanks out.
 *
 * The Parachain id in the Location varies between runtimes (1000 on Asset Hub,
 * 1500 on individuality v2 — see asset-ids.ts), so rather than guessing the
 * exact storage key we scan `Assets.Metadata` entries and match leniently with
 * `isPusdAssetId`, the same matcher the payment listener uses.
 */

"use client";

import { useEffect, useState } from "react";
import { paseo_individuality } from "@parity/product-sdk-descriptors/paseo-individuality";

import { getClient } from "@/lib/papi/client";
import { PUSD_SYMBOL, isPusdAssetId } from "@/lib/utils/asset-ids";

let cachedSymbol = PUSD_SYMBOL;
let inflight: Promise<string> | null = null;

async function load(): Promise<string> {
  const client = await getClient();
  const api = client.getTypedApi(paseo_individuality);
  const entries = await api.query.Assets.Metadata.getEntries();

  for (const entry of entries) {
    const location = entry.keyArgs[0];
    if (!isPusdAssetId(location)) continue;
    const symbol = new TextDecoder().decode(entry.value.symbol).trim();
    if (symbol) cachedSymbol = symbol;
    break;
  }
  return cachedSymbol;
}

/**
 * Resolve the asset symbol from chain metadata (once; subsequent calls reuse
 * the in-flight/cached result). Never rejects to the caller — on failure the
 * cached fallback is returned.
 */
export function warmAssetSymbol(): Promise<string> {
  if (!inflight) {
    inflight = load().catch(() => {
      inflight = null; // allow a later retry
      return cachedSymbol;
    });
  }
  return inflight;
}

/** Synchronous read of the cached symbol — fallback until {@link warmAssetSymbol} resolves. */
export function getAssetSymbol(): string {
  return cachedSymbol;
}

/**
 * Reactive asset symbol for display. Returns the cached fallback immediately,
 * then re-renders with the on-chain symbol once it loads.
 */
export function useAssetSymbol(): string {
  const [symbol, setSymbol] = useState(cachedSymbol);

  useEffect(() => {
    let alive = true;
    void warmAssetSymbol().then((resolved) => {
      if (alive) setSymbol(resolved);
    });
    return () => {
      alive = false;
    };
  }, []);

  return symbol;
}
