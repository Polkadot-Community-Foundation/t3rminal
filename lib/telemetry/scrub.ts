/**
 * PII scrub for Sentry. Wired into `beforeSend` / `beforeSendTransaction` at
 * every init site (via `sentry-init.ts`). Three mechanisms:
 *
 *  1. Value-based secret redaction — any string registered via `registerSecret`
 *     (e.g. the merchant's report password) is replaced with `[redacted]`
 *     wherever it appears, including free text.
 *  2. Key-based redaction — values whose KEY looks sensitive
 *     (password/secret/mnemonic/privateKey) are redacted in structured maps.
 *  3. Address truncation — values whose key looks like an address are
 *     truncated to 8 chars so they stay groupable without storing the full SS58.
 *
 * Browser-adapted: we deliberately do NOT ship the CLI spec's `/Users/`–`/home/`
 * filesystem-path regex — a sandboxed browser doesn't emit those.
 */

import type { ErrorEvent, TransactionEvent } from "@sentry/core";

const REDACTED = "[redacted]";
const SENSITIVE_KEY_RE = /password|secret|mnemonic|privatekey|seed/i;
const ADDRESS_KEY_RE = /address/i;

// Only register non-trivial secrets — redacting a 2-char string would corrupt
// unrelated text. Module-level (per-runtime); the client bundle registers the
// report password when the admin payload loads.
const secrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  if (typeof value === "string" && value.length >= 8) secrets.add(value);
}

/** Test-only: reset the registry between cases. */
export function _clearSecretsForTest(): void {
  secrets.clear();
}

/** Truncate an opaque identifier (SS58 / wallet address) to 8 chars + ellipsis. */
export function truncateAddress(addr: string | undefined | null): string | undefined {
  if (!addr) return addr ?? undefined;
  return addr.length > 8 ? `${addr.slice(0, 8)}…` : addr;
}

function scrubText(s: string): string {
  let out = s;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}

/** Redact/truncate a structured key→value map in place. */
function scrubDataMap(data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      data[k] = REDACTED;
    } else if (typeof v === "string") {
      data[k] = ADDRESS_KEY_RE.test(k) ? (truncateAddress(v) ?? v) : scrubText(v);
    }
  }
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  try {
    if (typeof event.message === "string") event.message = scrubText(event.message);
    for (const ex of event.exception?.values ?? []) {
      if (typeof ex.value === "string") ex.value = scrubText(ex.value);
    }
    for (const bc of event.breadcrumbs ?? []) {
      if (typeof bc.message === "string") bc.message = scrubText(bc.message);
      if (bc.data) scrubDataMap(bc.data as Record<string, unknown>);
    }
    const traceData = (event.contexts?.trace?.data ?? null) as Record<string, unknown> | null;
    if (traceData) scrubDataMap(traceData);
    // `captureError(err, tags, extra)` routes its 3rd arg into `event.extra` —
    // scrub it too, or that becomes a blind spot. NOTE: scrubDataMap only walks
    // top-level string values; a secret nested inside an object value would not
    // be reached (known limitation — keep `extra` payloads flat).
    if (event.extra) scrubDataMap(event.extra as Record<string, unknown>);
  } catch {
    // telemetry must never throw
  }
  return event;
}

export function scrubTransaction(event: TransactionEvent): TransactionEvent {
  try {
    for (const span of event.spans ?? []) {
      if (span.data) scrubDataMap(span.data as Record<string, unknown>);
    }
    const traceData = (event.contexts?.trace?.data ?? null) as Record<string, unknown> | null;
    if (traceData) scrubDataMap(traceData);
  } catch {
    // telemetry must never throw
  }
  return event;
}
