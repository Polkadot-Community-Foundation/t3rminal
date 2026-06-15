"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isChainReachable } from "@/lib/payments/chain-reachability";

export interface ChainConnectivity {
  /** Last known reachability of the chain (so we can actually settle a sale). */
  isOnline: boolean;
  /** A reachability probe is in flight. */
  isChecking: boolean;
  /** Epoch millis of the last completed check, or null before the first. */
  lastCheckedAt: number | null;
  /** Run an immediate check (e.g. right before generating a sale QR). */
  check: () => Promise<boolean>;
}

/**
 * Polls chain reachability on an interval and exposes an on-demand `check()`.
 * Use the periodic value for an offline indicator and `check()` as a blocking
 * pre-flight before handing out a payment QR.
 */
export function useChainConnectivity(intervalMs = 15000): ChainConnectivity {
  const [isOnline, setIsOnline] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const mounted = useRef(true);

  const check = useCallback(async () => {
    setIsChecking(true);
    const reachable = await isChainReachable();
    if (mounted.current) {
      setIsOnline(reachable);
      setLastCheckedAt(Date.now());
      setIsChecking(false);
    }
    return reachable;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void check();
    const id = setInterval(() => void check(), intervalMs);

    // Re-check immediately when the OS network state flips or the app refocuses.
    const onOnline = () => void check();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);

    return () => {
      mounted.current = false;
      clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, [check, intervalMs]);

  return { isOnline, isChecking, lastCheckedAt, check };
}
