"use client";

import * as Sentry from "@sentry/nextjs";
import type { SeverityLevel } from "@sentry/nextjs";

/**
 * Add a breadcrumb to the Sentry timeline. Use for important user actions
 * that aren't full journeys but provide useful debugging context when an
 * error later occurs.
 */
export function breadcrumb(
  category: string,
  message: string,
  level: SeverityLevel = "info",
  data?: Record<string, unknown>,
): void {
  Sentry.addBreadcrumb({ category, message, level, data });
}

/**
 * Report an error to Sentry with optional tags + extra metadata. Returns
 * the Sentry event ID for reference (useful in error toasts: "report id X").
 */
export function captureError(
  error: unknown,
  tags?: Record<string, string | number | boolean>,
  extra?: Record<string, unknown>,
): string | undefined {
  return Sentry.captureException(error, {
    ...(tags && { tags }),
    ...(extra && { extra }),
  });
}

/**
 * Wrap a sync or async function in a Sentry performance span. Automatically
 * sets span status (ok/error) and rethrows so callers can still handle the
 * error normally.
 */
export function withSpan<T>(
  name: string,
  op: string,
  fn: (span: Sentry.Span) => T,
  attributes?: Record<string, string | number | boolean>,
): T {
  return Sentry.startSpan(
    { name, op, attributes: { "op.sad": "false", ...attributes } },
    (span) => {
      let result: T;
      try {
        result = fn(span);
      } catch (error) {
        span.setAttribute("op.sad", "true");
        span.setStatus({
          code: 2,
          message: error instanceof Error ? error.message : "unknown_error",
        });
        throw error;
      }
      if (result instanceof Promise) {
        return result.then(
          (value) => {
            span.setStatus({ code: 1, message: "ok" });
            return value;
          },
          (error) => {
            span.setAttribute("op.sad", "true");
            span.setStatus({
              code: 2,
              message: error instanceof Error ? error.message : "unknown_error",
            });
            throw error;
          },
        ) as T;
      }
      span.setStatus({ code: 1, message: "ok" });
      return result;
    },
  );
}

/**
 * Expected = user mistake or external constraint (not a bug). These must not
 * inflate the unexpected-failure rate or trip the error alert. Everything not
 * matched here is treated as unexpected (a real bug).
 */
const EXPECTED_ERROR_RE =
  /insufficient funds|cancel(?:led|ed)? by user|user cancel|declined|offline|no (?:internet|connection|network)|not bound|no admin config|unbound|finalization_timeout|timed? ?out/i;

export function isExpectedError(reason: string | undefined | null): boolean {
  if (!reason) return false;
  return EXPECTED_ERROR_RE.test(reason);
}

/**
 * Record transient, non-fatal friction (retries, reconnects, timeouts that
 * recovered). Emits a breadcrumb (trace timeline) + a standalone warning event
 * (queryable in error-events), and marks the active root span `op.sad = "true"`
 * so SAD% counts it. Never throws into the caller.
 */
export function captureWarning(
  message: string,
  context?: Record<string, unknown>,
): void {
  try {
    Sentry.addBreadcrumb({ level: "warning", message, data: context });
    Sentry.captureMessage(message, { level: "warning", extra: context });
    const active = Sentry.getActiveSpan();
    const root = active ? Sentry.getRootSpan(active) : null;
    if (root) root.setAttribute("op.sad", "true");
  } catch {
    // telemetry must never throw
  }
}
