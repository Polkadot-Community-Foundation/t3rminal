/**
 * Host resource-allowance claim.
 *
 * Asks the host (Polkadot Desktop/Mobile) to grant the on-chain quotas that
 * Paseo Asset Hub Next runtime extensions require:
 *   - `BulletinAllowance`         — preimage submits to Paseo Bulletin
 *   - `SmartContractAllowance(0)` — REQUIRED for `Revive.call`. Without it
 *     the chain's `AsPgas` signed-extension has no PGAS budget and rejects
 *     every signed extrinsic with `InvalidTransaction::BadProof`.
 *   - `AutoSigning`               — best-effort; host returns `NotAvailable`
 *     today but we still request so it activates the moment it ships.
 *
 * Single batched `requestResourceAllocation([...])` call; cached for the page
 * lifetime so the host modal only opens once. Already-granted outcomes are
 * idempotent on the host side too.
 */

"use client";

import { hostApi } from "@novasamatech/host-api-wrapper";
import { enumValue } from "@novasamatech/host-api";

let cached: Promise<void> | null = null;

export function claimDefaultAllowances(): Promise<void> {
  if (cached) return cached;
  cached = doClaim().catch((err) => {
    cached = null; // allow retry on failure
    throw err;
  });
  return cached;
}

async function doClaim(): Promise<void> {
  console.info("[allowances] requesting BulletinAllowance + SmartContractAllowance(0) + AutoSigning");
  const result = await hostApi.requestResourceAllocation(
    enumValue("v1", [
      enumValue("BulletinAllowance", undefined),
      enumValue("SmartContractAllowance", 0),
      enumValue("AutoSigning", undefined),
    ]),
  );
  result.match(
    (response) => {
      const outcomes = ((response as { value?: unknown }).value as { tag?: string }[]) ?? [];
      const order = ["BulletinAllowance", "SmartContractAllowance(0)", "AutoSigning"] as const;
      outcomes.forEach((o, i) => console.info(`[allowances] ${order[i]}: ${o.tag ?? "unknown"}`));
    },
    (err: unknown) => {
      console.warn("[allowances] requestResourceAllocation failed:", err);
    },
  );
}
