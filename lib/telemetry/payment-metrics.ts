/**
 * Payment-specific Sentry measurements.
 *
 * These sit alongside the journey spans (journey-tracker.ts) but answer two
 * questions the journey waterfall doesn't surface cleanly:
 *
 *   1. Payment success / failure — `recordPaymentOutcome` emits a
 *      `payment.outcome` span with a numeric `payment.success` measurement
 *      (1 on success, 0 on failure). Aggregated in Sentry this is a
 *      success-rate metric, split by payment method / source.
 *
 *   2. Finalization timing — `recordFinalizationLatency` emits a
 *      `payment.finalization` span whose duration IS the time from best-block
 *      detection to GRANDPA finality, plus a `finalization.latency`
 *      measurement (ms). Failed (timed-out) finalizations are recorded with
 *      an error status so the success path and the latency tail are both
 *      queryable.
 *
 * Both are fire-and-forget: emitting a measurement never throws into the
 * caller's flow.
 */

"use client";

import * as Sentry from "@sentry/nextjs";

import { breadcrumb } from "./sentry-helpers";

export type PaymentMethodKind = "voucher" | "coins";

export type CoinagePaymentPhase =
  | "prepare"
  | "statement_wait"
  | "decrypt_match"
  | "host_topup"
  | "total";

export interface CoinagePaymentPhaseParams {
  phase: CoinagePaymentPhase;
  /** `performance.now()` timestamp from the start of this phase. */
  startedAt: number;
  paymentId?: string;
  amount?: string;
  hostEnv?: string;
  coinCount?: number;
  statementCount?: number;
  isComplete?: boolean;
  outcome?: "success" | "failure";
  reason?: string;
}

export interface PaymentOutcomeParams {
  outcome: "success" | "failure";
  /** Settings → Payment Method: standard pUSD voucher vs. W3S Coinage. */
  method: PaymentMethodKind;
  /** Decimal amount string for context (not a measurement). */
  amount?: string;
  /** Where the sale originated — "items" checkout vs. "direct" keypad. */
  source?: string;
  saleId?: string;
  terminalId?: string;
  merchantId?: string;
  /** Populated on failure — the human-readable reason. */
  reason?: string;
}

/**
 * Record a terminal payment as success or failure. Emits one
 * `payment.outcome` span carrying a `payment.success` measurement so Sentry
 * can chart success rate over time and break it down by method/source.
 */
export function recordPaymentOutcome(params: PaymentOutcomeParams): void {
  const success = params.outcome === "success";

  const attributes: Record<string, string | number | boolean> = {
    "payment.outcome": params.outcome,
    "payment.sad": success ? "false" : "true",
    "payment.method": params.method,
    "payment.source": params.source ?? "direct",
    "payment.terminal_id": params.terminalId ?? "unbound",
    "payment.merchant_id": params.merchantId ?? "unbound",
  };
  if (params.amount) attributes["payment.amount"] = params.amount;
  if (params.saleId) attributes["payment.sale_id"] = params.saleId;
  if (params.reason) attributes["payment.failure_reason"] = params.reason;

  Sentry.startSpan(
    { name: `payment:${params.outcome}`, op: "payment.outcome", attributes },
    (span) => {
      Sentry.setMeasurement("payment.success", success ? 1 : 0, "none", span);
      span.setStatus(
        success
          ? { code: 1, message: "ok" }
          : { code: 2, message: params.reason ?? "failure" },
      );
    },
  );

  breadcrumb(
    "payment",
    `payment ${params.outcome}`,
    success ? "info" : "error",
    attributes,
  );
}

/**
 * Record a W3S Coinage terminal-side phase. This breaks down the long
 * "waiting for payment" period into QR setup, statement-store delivery,
 * decrypt/match, and the native host `paymentTopUp(Coins)` call.
 */
export function recordCoinagePaymentPhase(
  params: CoinagePaymentPhaseParams,
): void {
  const outcome = params.outcome ?? "success";
  const latencyMs = Math.round(
    Math.max(0, performance.now() - params.startedAt),
  );
  const attributes: Record<string, string | number | boolean> = {
    "coinage.phase": params.phase,
    "coinage.phase_ms": latencyMs,
  };
  if (params.paymentId) attributes["coinage.payment_id"] = params.paymentId;
  if (params.amount) attributes["coinage.amount"] = params.amount;
  if (params.hostEnv) attributes["coinage.host_env"] = params.hostEnv;
  if (typeof params.coinCount === "number") {
    attributes["coinage.coin_count"] = params.coinCount;
  }
  if (typeof params.statementCount === "number") {
    attributes["coinage.statement_count"] = params.statementCount;
  }
  if (typeof params.isComplete === "boolean") {
    attributes["coinage.statement_page_complete"] = params.isComplete;
  }
  if (params.reason) attributes["coinage.failure_reason"] = params.reason;

  const startTime = (performance.timeOrigin + params.startedAt) / 1000;
  const endTime = (performance.timeOrigin + params.startedAt + latencyMs) / 1000;
  const span = Sentry.startSpanManual(
    {
      name: `coinage:${params.phase}`,
      op: `payment.coinage.${params.phase}`,
      attributes,
      startTime,
    },
    (s) => s,
  );
  Sentry.setMeasurement(
    `coinage.${params.phase}_ms`,
    latencyMs,
    "millisecond",
    span,
  );
  span.setStatus(
    outcome === "success"
      ? { code: 1, message: "ok" }
      : { code: 2, message: params.reason ?? "failure" },
  );
  span.end(endTime);

  breadcrumb(
    "payment.coinage",
    `coinage ${params.phase} ${outcome}`,
    outcome === "success" ? "info" : "error",
    attributes,
  );
}

export interface FinalizationLatencyParams {
  saleId: string;
  /** ms between best-block detection (watch registration) and the outcome. */
  latencyMs: number;
  /** true = GRANDPA finality landed; false = the watch fuse expired first. */
  finalized: boolean;
  /**
   * `performance.now()`-relative timestamp when the watch was registered.
   * When supplied the emitted span is back-dated so its on-chart duration
   * equals the measured latency.
   */
  startedAt?: number;
}

/**
 * Record the time a sale took to cross GRANDPA finality (or that it never
 * did, before the watcher's fuse expired). Emits a `payment.finalization`
 * span with a `finalization.latency` measurement in milliseconds.
 */
export function recordFinalizationLatency(
  params: FinalizationLatencyParams,
): void {
  const latencyMs = Math.round(params.latencyMs);
  const attributes: Record<string, string | number | boolean> = {
    "finalization.sale_id": params.saleId,
    "finalization.finalized": params.finalized,
    "finalization.sad": params.finalized ? "false" : "true",
    "finalization.latency_ms": latencyMs,
  };

  const hasTimeline = typeof params.startedAt === "number";
  const startTime = hasTimeline
    ? (performance.timeOrigin + params.startedAt!) / 1000
    : undefined;

  const span = Sentry.startSpanManual(
    {
      name: `finalization:${params.saleId}`,
      op: "payment.finalization",
      attributes,
      ...(startTime !== undefined ? { startTime } : {}),
    },
    (s) => s,
  );
  Sentry.setMeasurement("finalization.latency", latencyMs, "millisecond", span);
  span.setStatus(
    params.finalized
      ? { code: 1, message: "ok" }
      : { code: 2, message: "finalization_timeout" },
  );
  if (hasTimeline) {
    span.end((performance.timeOrigin + params.startedAt! + params.latencyMs) / 1000);
  } else {
    span.end();
  }
}
