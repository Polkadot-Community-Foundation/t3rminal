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
  return Sentry.startSpan({ name, op, attributes }, (span) => {
    let result: T;
    try {
      result = fn(span);
    } catch (error) {
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
  });
}
