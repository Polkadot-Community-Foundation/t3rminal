/**
 * Shared Sentry.init options used by all three entry points
 * (client / server / edge) so PII scrubbing, environment, and release are
 * identical everywhere and defined once.
 */

import * as Sentry from "@sentry/nextjs";

import { scrubEvent, scrubTransaction } from "./scrub";

type SentryInitOptions = Parameters<typeof Sentry.init>[0];

export function commonInitOptions(): Partial<NonNullable<SentryInitOptions>> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";
  const tracesSampleRate = Number(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.0",
  );
  return {
    dsn,
    enabled: dsn.length > 0,
    tracesSampleRate,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "local",
    // Reuse the commit SHA the deploy workflow already injects; explicit
    // override wins. Undefined → SDK/build-plugin default.
    release:
      process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
      process.env.NEXT_PUBLIC_COMMIT_SHA ||
      undefined,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubTransaction,
  };
}
