/**
 * pUSD on Paseo Individuality (Next v2) testnet.
 *
 * Asset ID 50_000_413. Genesis metadata sets decimals=6, matching the runtime's
 * `UnderlyingAssetUnit = 10^4` (so $0.01 = 10^4 units, $1 = 10^6). The Android
 * wallet's PayDeepLinkHandler interprets the deeplink `amount` parameter
 * directly as planks at this 6-decimal scale via `asset.amountFromPlanks(...)`.
 *
 * Registered as a foreign asset whose key in pallet_assets is an XCM Location,
 * NOT a plain integer. On v2 individuality the live `Assets.Transferred` event
 * carries Parachain(1500) (the next-people-paseo system parachain id), even
 * though the runtime config docs reference Parachain(1000) (Asset Hub). We
 * match leniently — any parents=1 X3(Parachain(*), PalletInstance(50),
 * GeneralIndex(50_000_413)) is pUSD as far as merchant accounting is concerned.
 */

export const PUSD_ASSET_ID = BigInt(50_000_413);
export const PUSD_DECIMALS = 6;
export const PUSD_SYMBOL = "CASH";

export const PUSD_LOCATION = {
  parents: 1,
  interior: {
    type: "X3" as const,
    value: [
      { type: "Parachain" as const, value: 1500 },
      { type: "PalletInstance" as const, value: 50 },
      { type: "GeneralIndex" as const, value: PUSD_ASSET_ID },
    ],
  },
};

/** Match a decoded Assets.Transferred `asset_id` against the pUSD Location. */
export function isPusdAssetId(assetId: unknown): boolean {
  if (!assetId || typeof assetId !== "object") return false;
  const a = assetId as { parents?: number; interior?: { type?: string; value?: unknown } };
  if (a.parents !== 1) return false;
  const interior = a.interior;
  if (!interior || interior.type !== "X3" || !Array.isArray(interior.value)) return false;
  const [j0, j1, j2] = interior.value as Array<{ type?: string; value?: unknown }>;
  // Parachain id varies (1000 on Asset Hub, 1500 on individuality v2) — only
  // require the slot type matches; index is informational here.
  if (j0?.type !== "Parachain") return false;
  if (j1?.type !== "PalletInstance" || j1.value !== 50) return false;
  if (j2?.type !== "GeneralIndex") return false;
  const idx = j2.value;
  if (typeof idx === "bigint") return idx === PUSD_ASSET_ID;
  if (typeof idx === "number") return BigInt(idx) === PUSD_ASSET_ID;
  if (typeof idx === "string") {
    try { return BigInt(idx) === PUSD_ASSET_ID; } catch { return false; }
  }
  return false;
}

/** pUSD-only display name. */
export function getAssetName(_assetId: string): string {
  return PUSD_SYMBOL;
}

/** pUSD has 18 decimals. */
export function getDecimalsForAsset(_assetId?: string): number {
  return PUSD_DECIMALS;
}
