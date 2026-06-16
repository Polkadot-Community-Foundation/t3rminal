/**
 * Asset symbol for display — hard-coded to `PUSD_SYMBOL`.
 *
 * We intentionally do NOT read the symbol from on-chain `Assets.Metadata` any
 * more: the UI must always show the same label (terminal, receipts, reports,
 * history) regardless of what the chain reports, and without a chain round-trip.
 * The exported API is kept identical so every call site keeps working.
 */

"use client";

import { PUSD_SYMBOL } from "@/lib/utils/asset-ids";

/** Resolve the asset symbol. Kept async for call-site compatibility. */
export function warmAssetSymbol(): Promise<string> {
  return Promise.resolve(PUSD_SYMBOL);
}

/** Synchronous asset symbol. */
export function getAssetSymbol(): string {
  return PUSD_SYMBOL;
}

/** Asset symbol for display (hook form). Always the hard-coded symbol. */
export function useAssetSymbol(): string {
  return PUSD_SYMBOL;
}
