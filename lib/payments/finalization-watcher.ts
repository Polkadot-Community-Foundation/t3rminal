/**
 * Module-level background watcher that promotes a sale from "in best-block"
 * to "finalized" without holding up the merchant UI.
 *
 * Flow:
 *   1. Terminal page persists a sale to local DB as soon as the listener
 *      reports best-block inclusion — merchant can move on immediately.
 *   2. Terminal page calls `watchForFinalization(saleId, blockHash)` and
 *      drops the reference.
 *   3. A single PAPI `finalizedBlock$` subscription (lazily started on the
 *      first registration) ticks on every finalized block. When a tick's
 *      hash matches a pending registration, we stamp `finalizedAt` on the
 *      DB row, drop the registration, and — if the set is empty — tear
 *      the subscription down.
 *   4. Each registration has a 10-minute fuse so a chain that goes silent
 *      doesn't leak watches indefinitely.
 *
 * Side-effect-free wrt React: nothing here is hook-bound, the watcher
 * survives navigation, and the only public surface is `watchForFinalization`.
 */

"use client";

import { getClient } from "@/lib/papi/client";
import { markSaleFinalized } from "@/lib/storage";
import { recordFinalizationLatency } from "@/lib/telemetry";

interface PendingFinalization {
  blockHash: string;
  /** setTimeout id for the per-registration fuse. */
  timer: ReturnType<typeof setTimeout>;
  /** `performance.now()` at registration — drives the finality latency metric. */
  registeredAt: number;
}

const REGISTRATION_TTL_MS = 10 * 60 * 1000;

// Keyed by `saleId` — unique per sale. Two sales that happened to land in the
// same block share the same `blockHash` but each has its own entry here, so
// both get stamped `finalizedAt` when that block crosses finality.
const pending = new Map<string, PendingFinalization>();
let subscription: { unsubscribe(): void } | null = null;
let starting: Promise<void> | null = null;

function teardownIfIdle(): void {
  if (pending.size === 0 && subscription) {
    subscription.unsubscribe();
    subscription = null;
  }
}

async function ensureSubscribed(): Promise<void> {
  if (subscription || starting) return starting ?? undefined;
  starting = (async () => {
    try {
      const client = await getClient();
      type FinalizedBlock = { hash: string; number: number };
      const obs = (client as unknown as {
        finalizedBlock$: { subscribe(observer: { next(b: FinalizedBlock): void; error(e: unknown): void }): { unsubscribe(): void } };
      }).finalizedBlock$;
      subscription = obs.subscribe({
        next(block) {
          // Iterate ALL pending entries on each finalized tick — handles the
          // (rare) case where multiple sales landed in the same block; every
          // matching saleId gets stamped, not just the first.
          for (const [saleId, entry] of pending) {
            if (entry.blockHash !== block.hash) continue;
            pending.delete(saleId);
            clearTimeout(entry.timer);
            recordFinalizationLatency({
              saleId,
              latencyMs: performance.now() - entry.registeredAt,
              finalized: true,
              startedAt: entry.registeredAt,
            });
            markSaleFinalized(saleId).catch((err) => {
              console.warn(`[FinalizationWatcher] markSaleFinalized(${saleId}) failed:`, err);
            });
            console.info(`[FinalizationWatcher] ${saleId} finalized in block ${block.hash.slice(0, 10)}…`);
          }
          teardownIfIdle();
        },
        error(err) {
          console.warn("[FinalizationWatcher] subscription error:", err);
          // Reset so a new caller can re-arm. Existing fuses still run; they
          // just won't be stamped finalized (chain trouble — that's accurate).
          subscription = null;
        },
      });
    } finally {
      starting = null;
    }
  })();
  return starting;
}

/**
 * Register a sale to be stamped `finalizedAt` once its inclusion block
 * crosses finality. Idempotent for the same `saleId`; safe to call multiple
 * times. Multiple sales sharing the same `blockHash` are tracked separately.
 */
export function watchForFinalization(saleId: string, blockHash: string): void {
  if (pending.has(saleId)) return;
  const registeredAt = performance.now();
  const timer = setTimeout(() => {
    pending.delete(saleId);
    recordFinalizationLatency({
      saleId,
      latencyMs: performance.now() - registeredAt,
      finalized: false,
      startedAt: registeredAt,
    });
    console.warn(`[FinalizationWatcher] ${saleId} fuse expired without finalization (block ${blockHash.slice(0, 10)}…)`);
    teardownIfIdle();
  }, REGISTRATION_TTL_MS);
  pending.set(saleId, { blockHash, timer, registeredAt });
  void ensureSubscribed();
}
