import { getClient } from "@/lib/papi/client";

/**
 * Confirms the chain is actually reachable right now — i.e. that a sale we're
 * about to charge can be observed and settled. Uses the cheapest query
 * (`getBestBlocks`) over the host-bridged client, with a timeout so a dead
 * connection fails fast instead of leaving the cashier staring at a spinner.
 */
export async function isChainReachable(timeoutMs = 6000): Promise<boolean> {
  // Quick gate: no radio at all → definitely can't settle.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }

  try {
    const client = await getClient();
    const blocks = await Promise.race([
      client.getBestBlocks(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("reachability timeout")), timeoutMs),
      ),
    ]);
    return Array.isArray(blocks) ? blocks.length > 0 : Boolean(blocks);
  } catch (err) {
    console.warn("[chain-reachability] chain unreachable:", err);
    return false;
  }
}
