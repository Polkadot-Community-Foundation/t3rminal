# Sentry Eng-Reliability Instrumentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make t3rminal's already-present-but-dark Sentry telemetry actually flow and be safe + useful for engineering reliability — PII scrubbing, error classification, friction (SAD%) flags, test-traffic exclusion, and the config that turns spans on.

**Architecture:** The app already has `lib/telemetry/`. We add a PII scrub layer wired into the Sentry `beforeSend`/`beforeSendTransaction` hooks, two helper functions (`isExpectedError`, `captureWarning`), SAD% string attributes on the payment/finalization/journey spans, an e2e scope-tag, and a shared init-options module so the three init sites stay DRY. We change the deploy workflow to raise trace sampling and pass `environment`.

**Tech Stack:** `@sentry/nextjs` ^10.54, Next.js static export, Vitest (`tests/**/*.test.ts`, env `node`), TypeScript.

**Spec:** `docs-internal/superpowers/specs/2026-06-12-sentry-eng-reliability-design.md`

**Branch:** `feat/sentry-eng-reliability` (already created; gpgsign disabled for iteration).

---

## Design notes that shape the tasks

- **Journeys emit at completion (back-dated), not as an active span.** So the spec's
  `captureWarning → getActiveSpan().setAttribute("sad","true")` flip works for
  `withSpan`-wrapped operations (e.g. `bulletin.upload-report`) but NOT for journeys. SAD on
  journeys is handled by a `markSad(type)` method + `fail()` setting it.
- **E2E exclusion this pass = scope tag only.** Errors (events) carry a `tag` scope tag so the
  future Matrix alert can exclude `tag:e2e-*`. Per-span `tag` attributes (for dashboards) are
  deferred with the dashboards phase — not needed for the active goals.
- **`reportPassword` redaction is value-based.** A module-level secret registry scrubs any
  registered secret out of free text; the admin-QR load path registers it. Plus key-based
  redaction for structured maps (keys matching `password|secret|mnemonic|privateKey`).
- **Release = commit SHA**, reusing the existing `NEXT_PUBLIC_COMMIT_SHA` already passed by the
  deploy workflow, overridable via `NEXT_PUBLIC_SENTRY_RELEASE`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/telemetry/scrub.ts` | PII scrub: secret registry, key-based redaction, address truncation, `scrubEvent`/`scrubTransaction` | **create** |
| `lib/telemetry/sentry-init.ts` | Shared `commonInitOptions()` (environment, release, beforeSend, beforeSendTransaction) for all init sites | **create** |
| `lib/telemetry/sentry-helpers.ts` | add `isExpectedError`, `captureWarning` | modify |
| `lib/telemetry/payment-metrics.ts` | `payment.sad` / `finalization.sad` attributes | modify |
| `lib/telemetry/journey-tracker.ts` | `journey.sad` attr + `markSad()` + `fail()` sets it | modify |
| `lib/telemetry/index.ts` | export `captureWarning`, `isExpectedError` | modify |
| `lib/config/admin-qr.ts` | register `reportPassword` as a secret on load | modify |
| `instrumentation-client.ts` | use `commonInitOptions()`; set e2e scope tag after init | modify |
| `sentry.server.config.ts` | use `commonInitOptions()` | modify |
| `sentry.edge.config.ts` | use `commonInitOptions()` | modify |
| `e2e/fixtures.ts` | `addInitScript` to set `window.__T3RMINAL_E2E_TAG` | modify |
| `.github/workflows/deploy-frontend.yml` | sampling `'0.0'`→`'1.0'`; add `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | modify |
| `.env.example` | document new env vars | modify |
| `tests/telemetry-scrub.test.ts` | scrub unit tests | **create** |
| `tests/telemetry-helpers.test.ts` | `isExpectedError` + `captureWarning` tests | **create** |
| `tests/telemetry-sad.test.ts` | SAD attribute tests (payment/journey, mocked Sentry) | **create** |

---

## Task 1: PII scrub module

**Files:**
- Create: `lib/telemetry/scrub.ts`
- Test: `tests/telemetry-scrub.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/telemetry-scrub.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

import {
  truncateAddress,
  registerSecret,
  _clearSecretsForTest,
  scrubEvent,
  scrubTransaction,
} from "@/lib/telemetry/scrub";

afterEach(() => _clearSecretsForTest());

describe("truncateAddress", () => {
  it("truncates long addresses to 8 chars + ellipsis", () => {
    expect(truncateAddress("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY")).toBe("5GrwvaEF…");
  });
  it("leaves short strings and falsy values untouched", () => {
    expect(truncateAddress("5Grwva")).toBe("5Grwva");
    expect(truncateAddress(undefined)).toBeUndefined();
    expect(truncateAddress("")).toBe("");
  });
});

describe("scrubEvent — registered secrets", () => {
  it("redacts a registered secret from message, exception value, and breadcrumb message", () => {
    registerSecret("S3CR3T-report-password-value-aaaaaaaaaaaaa");
    const ev = {
      message: "boom with S3CR3T-report-password-value-aaaaaaaaaaaaa in it",
      exception: { values: [{ value: "threw S3CR3T-report-password-value-aaaaaaaaaaaaa" }] },
      breadcrumbs: [{ message: "leaked S3CR3T-report-password-value-aaaaaaaaaaaaa here" }],
    } as any;
    const out = scrubEvent(ev) as any;
    expect(out.message).not.toContain("S3CR3T");
    expect(out.message).toContain("[redacted]");
    expect(out.exception.values[0].value).not.toContain("S3CR3T");
    expect(out.breadcrumbs[0].message).not.toContain("S3CR3T");
  });

  it("redacts values under sensitive keys and truncates address keys in breadcrumb data", () => {
    const ev = {
      breadcrumbs: [
        { message: "x", data: { reportPassword: "anything-here", receivingAddress: "5GrwvaEF5zXb26Fz9rcQpDWS57Ct" } },
      ],
    } as any;
    const out = scrubEvent(ev) as any;
    expect(out.breadcrumbs[0].data.reportPassword).toBe("[redacted]");
    expect(out.breadcrumbs[0].data.receivingAddress).toBe("5GrwvaEF…");
  });
});

describe("scrubTransaction", () => {
  it("scrubs span data and contexts.trace.data", () => {
    registerSecret("S3CR3T-pw-bbbbbbbbbbbbbbbbbbbbbbbbb");
    const ev = {
      spans: [{ data: { "payment.note": "has S3CR3T-pw-bbbbbbbbbbbbbbbbbbbbbbbbb", "signer.address": "5GrwvaEF5zXb26Fz9rcQpDWS" } }],
      contexts: { trace: { data: { reportPassword: "zzz", "payment.amount": "12.50" } } },
    } as any;
    const out = scrubTransaction(ev) as any;
    expect(out.spans[0].data["payment.note"]).not.toContain("S3CR3T");
    expect(out.spans[0].data["signer.address"]).toBe("5GrwvaEF…");
    expect(out.contexts.trace.data.reportPassword).toBe("[redacted]");
    expect(out.contexts.trace.data["payment.amount"]).toBe("12.50");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telemetry-scrub.test.ts`
Expected: FAIL — `Cannot find module '@/lib/telemetry/scrub'`.

- [ ] **Step 3: Implement `lib/telemetry/scrub.ts`**

```ts
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

import type { ErrorEvent, TransactionEvent } from "@sentry/nextjs";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telemetry-scrub.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/telemetry/scrub.ts tests/telemetry-scrub.test.ts
git commit -m "feat(telemetry): PII scrub module (secret registry, key redaction, address truncation)"
```

---

## Task 2: `isExpectedError` + `captureWarning` helpers

**Files:**
- Modify: `lib/telemetry/sentry-helpers.ts`
- Test: `tests/telemetry-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/telemetry-helpers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => {
  const calls: any = { breadcrumbs: [], messages: [], rootSetAttrs: [] };
  const fakeRoot = { setAttribute: (k: string, v: unknown) => calls.rootSetAttrs.push([k, v]) };
  return {
    addBreadcrumb: (b: unknown) => calls.breadcrumbs.push(b),
    captureMessage: (m: string, o: unknown) => calls.messages.push([m, o]),
    getActiveSpan: () => ({}),
    getRootSpan: () => fakeRoot,
    __calls: calls,
  };
});

import * as Sentry from "@sentry/nextjs";
import { isExpectedError, captureWarning } from "@/lib/telemetry/sentry-helpers";

describe("isExpectedError", () => {
  it("classifies user/external causes as expected", () => {
    for (const m of [
      "Insufficient funds for this payment",
      "Payment cancelled by user",
      "Network offline — check your connection",
      "Terminal is not bound — scan an admin QR",
      "finalization_timeout",
    ]) {
      expect(isExpectedError(m)).toBe(true);
    }
  });
  it("classifies arbitrary bugs as unexpected", () => {
    expect(isExpectedError("Cannot read properties of undefined (reading 'foo')")).toBe(false);
    expect(isExpectedError(undefined)).toBe(false);
  });
});

describe("captureWarning", () => {
  it("emits a breadcrumb + message and marks the root span sad", () => {
    captureWarning("RPC reconnect", { attempt: 2 });
    const calls = (Sentry as any).__calls;
    expect(calls.breadcrumbs.at(-1)).toMatchObject({ level: "warning", message: "RPC reconnect" });
    expect(calls.messages.at(-1)[0]).toBe("RPC reconnect");
    expect(calls.rootSetAttrs.at(-1)).toEqual(["op.sad", "true"]);
  });
  it("never throws", () => {
    expect(() => captureWarning("x")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telemetry-helpers.test.ts`
Expected: FAIL — `isExpectedError`/`captureWarning` not exported.

- [ ] **Step 3: Implement — append to `lib/telemetry/sentry-helpers.ts`**

Add these exports at the end of the file (after `withSpan`):

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telemetry-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/telemetry/sentry-helpers.ts tests/telemetry-helpers.test.ts
git commit -m "feat(telemetry): add isExpectedError + captureWarning helpers"
```

---

## Task 3: SAD attributes on payment + finalization spans

**Files:**
- Modify: `lib/telemetry/payment-metrics.ts`
- Test: `tests/telemetry-sad.test.ts` (created here, extended in Task 4)

- [ ] **Step 1: Write the failing test**

Create `tests/telemetry-sad.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const startSpanAttrs: Array<Record<string, unknown>> = [];

vi.mock("@sentry/nextjs", () => ({
  startSpan: (opts: any, cb: any) => {
    startSpanAttrs.push(opts.attributes ?? {});
    return cb({ setStatus: () => {}, setAttribute: () => {} });
  },
  startSpanManual: (opts: any, cb: any) => {
    startSpanAttrs.push(opts.attributes ?? {});
    return cb({ setStatus: () => {}, setAttribute: () => {}, end: () => {} });
  },
  setMeasurement: () => {},
  addBreadcrumb: () => {},
}));

import { recordPaymentOutcome, recordFinalizationLatency } from "@/lib/telemetry/payment-metrics";

beforeEach(() => { startSpanAttrs.length = 0; });

describe("payment.sad", () => {
  it("is 'false' on success and 'true' on failure", () => {
    recordPaymentOutcome({ outcome: "success", method: "voucher" });
    expect(startSpanAttrs.at(-1)!["payment.sad"]).toBe("false");
    recordPaymentOutcome({ outcome: "failure", method: "coins", reason: "declined" });
    expect(startSpanAttrs.at(-1)!["payment.sad"]).toBe("true");
  });
});

describe("finalization.sad", () => {
  it("is 'false' when finalized and 'true' on timeout", () => {
    recordFinalizationLatency({ saleId: "s1", latencyMs: 1200, finalized: true });
    expect(startSpanAttrs.at(-1)!["finalization.sad"]).toBe("false");
    recordFinalizationLatency({ saleId: "s2", latencyMs: 9000, finalized: false });
    expect(startSpanAttrs.at(-1)!["finalization.sad"]).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telemetry-sad.test.ts`
Expected: FAIL — `payment.sad` is `undefined`.

- [ ] **Step 3: Implement — edit `lib/telemetry/payment-metrics.ts`**

In `recordPaymentOutcome`, add the sad attribute to the `attributes` object (right after `"payment.outcome": params.outcome,`):

```ts
    "payment.sad": success ? "false" : "true",
```

In `recordFinalizationLatency`, add to the `attributes` object (after `"finalization.finalized": params.finalized,`):

```ts
    "finalization.sad": params.finalized ? "false" : "true",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telemetry-sad.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/telemetry/payment-metrics.ts tests/telemetry-sad.test.ts
git commit -m "feat(telemetry): SAD% string attrs on payment + finalization spans"
```

---

## Task 4: SAD attribute + `markSad` on journey spans

**Files:**
- Modify: `lib/telemetry/journey-tracker.ts`
- Test: `tests/telemetry-sad.test.ts` (extend)

- [ ] **Step 1: Write the failing test — append to `tests/telemetry-sad.test.ts`**

```ts
import { journeyTracker } from "@/lib/telemetry/journey-tracker";

describe("journey.sad", () => {
  it("defaults to 'false' on a clean complete()", () => {
    journeyTracker.start("page-load");
    journeyTracker.complete("page-load");
    const attrs = startSpanAttrs.find((a) => a["journey.type"] === "page-load")!;
    expect(attrs["journey.sad"]).toBe("false");
  });

  it("is 'true' after markSad(), and 'true' on fail()", () => {
    journeyTracker.start("authenticate");
    journeyTracker.markSad("authenticate");
    journeyTracker.complete("authenticate");
    const ok = startSpanAttrs.find((a) => a["journey.type"] === "authenticate")!;
    expect(ok["journey.sad"]).toBe("true");

    journeyTracker.start("items-checkout");
    journeyTracker.fail("items-checkout", "boom");
    const failed = startSpanAttrs.find((a) => a["journey.type"] === "items-checkout")!;
    expect(failed["journey.sad"]).toBe("true");
  });
});
```

Note: the Task 3 mock records `opts.attributes` for `startSpanManual`, which journeys use — so journey attrs land in `startSpanAttrs`. (Phase spans also push their attributes; filter by `journey.type` and the presence of `journey.sad` — phase spans carry `journey.type` too but not `journey.duration_ms`. If a test is ambiguous, match on `a["journey.duration_ms"] !== undefined`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telemetry-sad.test.ts -t journey.sad`
Expected: FAIL — `markSad` is not a function / `journey.sad` undefined.

- [ ] **Step 3: Implement — edit `lib/telemetry/journey-tracker.ts`**

(a) Add a `sad` field to the `ActiveJourney` interface:

```ts
interface ActiveJourney<T> {
  type: T;
  startedAt: number;
  milestones: Map<string, number>;
  attributes: Record<string, string | number | boolean>;
  sad: boolean;
}
```

(b) In `start()`, initialise it — set `sad: false` in the object passed to `this.active.set`:

```ts
    this.active.set(type, {
      type,
      startedAt: startedAt ?? performance.now(),
      milestones: new Map(),
      attributes,
      sad: false,
    });
```

(c) Add a public method (place after `addAttributes`):

```ts
  /** Mark an in-flight journey as "sad" (completed but with friction). */
  markSad(type: T): void {
    const journey = this.active.get(type);
    if (journey) journey.sad = true;
  }
```

(d) In `fail()`, set sad true before emitting — add `journey.sad = true;` immediately after the `const resolvedReason = ...` line.

(e) In `_emitSpan`, add the attribute to the `attributes` object (after `"journey.duration_ms": Math.round(totalMs),`):

```ts
      "journey.sad": journey.sad ? "true" : "false",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telemetry-sad.test.ts`
Expected: PASS (all SAD tests).

- [ ] **Step 5: Commit**

```bash
git add lib/telemetry/journey-tracker.ts tests/telemetry-sad.test.ts
git commit -m "feat(telemetry): journey.sad attr + markSad()"
```

---

## Task 5: Shared init options + wire scrub/environment/release into all init sites

**Files:**
- Create: `lib/telemetry/sentry-init.ts`
- Modify: `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`

- [ ] **Step 1: Create `lib/telemetry/sentry-init.ts`**

```ts
/**
 * Shared Sentry.init options used by all three entry points
 * (client / server / edge) so PII scrubbing, environment, and release are
 * identical everywhere and defined once.
 */

import type { BrowserOptions } from "@sentry/nextjs";

import { scrubEvent, scrubTransaction } from "./scrub";

export function commonInitOptions(): Partial<BrowserOptions> {
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
```

- [ ] **Step 2: Edit `sentry.server.config.ts`** — replace the body with:

```ts
/**
 * Sentry server-side init. With `output: 'export'` we don't ship a Node
 * server, but the file is required by `@sentry/nextjs`. Production deploys
 * never execute this.
 */

import * as Sentry from "@sentry/nextjs";

import { commonInitOptions } from "@/lib/telemetry/sentry-init";

Sentry.init(commonInitOptions());
```

- [ ] **Step 3: Edit `sentry.edge.config.ts`** — same pattern:

```ts
/**
 * Sentry edge-runtime init. Kept so the Next.js + Sentry build plugin doesn't
 * complain. We don't ship edge routes.
 */

import * as Sentry from "@sentry/nextjs";

import { commonInitOptions } from "@/lib/telemetry/sentry-init";

Sentry.init(commonInitOptions());
```

- [ ] **Step 4: Edit `instrumentation-client.ts`** — replace the `Sentry.init({...})` block (the one starting `const dsn = ...` through the closing `});`) with:

```ts
import { commonInitOptions } from "@/lib/telemetry/sentry-init";
import { getE2eTag } from "@/lib/telemetry/e2e-tag";

Sentry.init({
  ...commonInitOptions(),
  // Keep error-only session replay (no session recording, 100% on error).
  integrations: [Sentry.replayIntegration()],
  replaysSessionSampleRate: 0.0,
  replaysOnErrorSampleRate: 1.0,
});

// Tag synthetic E2E traffic so production error alerts can exclude it.
const e2eTag = getE2eTag();
if (e2eTag) Sentry.setTag("tag", e2eTag);
```

Leave the existing `installLogCapture()` call and the dev `missingSlots` filter untouched; only the DSN/init block changes. Keep `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;` at the bottom. Place the new `import` lines with the other imports at the top. (`getE2eTag` is created in Task 6 — this file won't typecheck until Task 6 lands; that's expected, they commit together in Task 6.)

- [ ] **Step 5: Build-check**

Run: `npx tsc --noEmit` — expect ONE error about missing `@/lib/telemetry/e2e-tag` (resolved in Task 6). All other type errors must be zero.

- [ ] **Step 6: Commit** (combined with Task 6 — do not commit a non-compiling tree alone). Proceed directly to Task 6.

---

## Task 6: E2E scope-tag plumbing

**Files:**
- Create: `lib/telemetry/e2e-tag.ts`
- Modify: `e2e/fixtures.ts`

- [ ] **Step 1: Create `lib/telemetry/e2e-tag.ts`**

```ts
/**
 * Reads the synthetic-traffic tag that the Playwright suite injects at runtime
 * (see e2e/fixtures.ts). A static-export build bakes NEXT_PUBLIC_* at build
 * time, so the tag must be a runtime window flag, not an env var.
 */

declare global {
  interface Window {
    __T3RMINAL_E2E_TAG?: string;
  }
}

export function getE2eTag(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const tag = window.__T3RMINAL_E2E_TAG;
  return typeof tag === "string" && tag.length > 0 ? tag : undefined;
}
```

- [ ] **Step 2: Wire the fixture — edit `e2e/fixtures.ts`**

Find the base test/fixture that sets up each `page` (the project extends Playwright's `test` with fixtures). In the `page` setup, before navigation, add an init script. Concretely, locate the existing `page` fixture override (or add one) and inside it call:

```ts
    await page.addInitScript(() => {
      (window as unknown as { __T3RMINAL_E2E_TAG?: string }).__T3RMINAL_E2E_TAG =
        "e2e-t3rminal";
    });
```

If `fixtures.ts` does not already override the `page` fixture, add this override using Playwright's `test.extend`:

```ts
import { test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      (window as unknown as { __T3RMINAL_E2E_TAG?: string }).__T3RMINAL_E2E_TAG =
        "e2e-t3rminal";
    });
    await use(page);
  },
});
```

(Match the file's existing export style — if it already re-exports a customized `test`, extend that instead of `base`. Read the file first; do not blindly append a second `test` export.)

- [ ] **Step 3: Build-check**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors (the Task 5 missing-module error is now resolved).

- [ ] **Step 4: Full unit test run**

Run: `npx vitest run`
Expected: all telemetry tests PASS; pre-existing suite unchanged.

- [ ] **Step 5: Commit** (Tasks 5 + 6 together)

```bash
git add lib/telemetry/sentry-init.ts lib/telemetry/e2e-tag.ts \
  instrumentation-client.ts sentry.server.config.ts sentry.edge.config.ts e2e/fixtures.ts
git commit -m "feat(telemetry): shared init opts (scrub/env/release) + e2e scope tag"
```

---

## Task 7: Register the report password as a secret + export helpers

**Files:**
- Modify: `lib/config/admin-qr.ts`, `lib/telemetry/index.ts`

- [ ] **Step 1: Edit `lib/telemetry/index.ts`** — add to the `sentry-helpers` re-export line:

```ts
export { withSpan, breadcrumb, captureError, captureWarning, isExpectedError } from "./sentry-helpers";
```

- [ ] **Step 2: Register the secret on payload load — edit `lib/config/admin-qr.ts`**

Add the import at the top (with the other `@/lib/...` imports):

```ts
import { registerSecret } from "@/lib/telemetry/scrub";
```

In `importAdminQrConfig`, register the report password before persisting (first line of the function body):

```ts
  registerSecret(payload.reportPassword);
```

And in `loadAdminQrPayload`, after a successful parse and before `return parsed as T3rminalConfigQrPayloadV2;`, register it so a reload (new page load) re-registers:

```ts
    registerSecret((parsed as { reportPassword?: string }).reportPassword);
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run tests/admin-qr-import.test.ts`
Expected: PASS — existing admin-qr tests still green (registering a secret is a pure side-effect that doesn't change import behaviour).

- [ ] **Step 4: Commit**

```bash
git add lib/telemetry/index.ts lib/config/admin-qr.ts
git commit -m "feat(telemetry): register report password as a scrub secret; export new helpers"
```

---

## Task 8: Deploy workflow + `.env.example`

**Files:**
- Modify: `.github/workflows/deploy-frontend.yml`, `.env.example`

- [ ] **Step 1: Edit `.github/workflows/deploy-frontend.yml`**

Change line 66 from:

```yaml
          NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0.0'
```

to:

```yaml
          NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '1.0'
          NEXT_PUBLIC_SENTRY_ENVIRONMENT: production
```

(Leave `NEXT_PUBLIC_SENTRY_DSN: ${{ secrets.NEXT_PUBLIC_SENTRY_DSN }}` on line 62 unchanged — the secret is set by the human after this branch merges.)

- [ ] **Step 2: Edit `.env.example`** — under the existing Sentry block, add:

```
# Environment label shown in Sentry (production / preview / local). Defaults to
# "local" when unset.
NEXT_PUBLIC_SENTRY_ENVIRONMENT=
# Release identifier. Defaults to NEXT_PUBLIC_COMMIT_SHA (set by CI), else unset.
# NEXT_PUBLIC_SENTRY_RELEASE=
```

And update the traces comment to note prod uses 1.0 (the deploy workflow sets it).

- [ ] **Step 3: Verify**

Run: `grep -n "TRACES_SAMPLE_RATE\|SENTRY_ENVIRONMENT" .github/workflows/deploy-frontend.yml`
Expected: shows `'1.0'` and `production`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-frontend.yml .env.example
git commit -m "chore(telemetry): raise prod trace sampling to 1.0, pass environment, document env"
```

---

## Task 9: Local smoke test (manual — proves data flows before prod)

**Files:** none (verification only).

- [ ] **Step 1:** Create `.env.local` (gitignored) with:

```
NEXT_PUBLIC_SENTRY_DSN=https://d525dec6a98895f678ca4f0e726a9bd7@o4511059872841728.ingest.de.sentry.io/4511547331903568
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=1.0
NEXT_PUBLIC_SENTRY_ENVIRONMENT=local
```

- [ ] **Step 2:** `npm run dev`, open the terminal page, run one payment flow (test data), and trigger one deliberate error path (e.g. read a non-existent report CID).

- [ ] **Step 3:** In Sentry (org `paritytech`, project `t3rminal`, `de.sentry.io`), confirm via API:

```bash
SENTRY_TOKEN="$(security find-generic-password -s sentry-api-token -w)"
curl -s -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://de.sentry.io/api/0/organizations/paritytech/events/?dataset=spans&field=span.op&field=journey.sad&field=payment.sad&query=&statsPeriod=1h" \
  | python3 -m json.tool | head -40
```

Expected: rows for `journey.*` / `payment.outcome` spans with `journey.sad`/`payment.sad` present.

- [ ] **Step 4:** Confirm **no secret leaked**: check the most recent issue/transaction for any occurrence of the report password — there must be none. Confirm `environment:local` and the `tag` is absent (not an e2e run).

- [ ] **Step 5:** Delete `.env.local` (or keep locally; it's gitignored). Do NOT commit it.

---

## Phase 2 — Monitored workflows (team reqs)

Depends on Phase 1 (Tasks 1–9). These instrument the two primary workflows + host anomalies
using **only** native metric patterns (`span.duration`, `count`/`count_if`) — no numeric attrs.
Errors here are classified via `isExpectedError` (Task 2) so only real bugs alert.

### Task 10: Reorg-invalidation capture (`lib/tx/submit.ts`)

**Files:** Modify `lib/tx/submit.ts`

- [ ] **Step 1:** Add the telemetry import at the top (after the `polkadot-api` import):

```ts
import { captureError } from "@/lib/telemetry"
```

- [ ] **Step 2:** At the reorg branch (`:308-312`, the `if (settled)` inside the `finalized`
  `!event.ok` case), replace the bare `console.warn(...)` with a capture that creates a Sentry
  issue (this is a real data-integrity event — a tx the user saw succeed was reverted):

```ts
                if (settled) {
                  console.warn(
                    "[tx] Transaction failed after best-block (reorg). Consumer received a stale success result.",
                    { formatted, block: event.block }
                  )
                  captureError(
                    new Error(`reorg invalidated settled tx: ${formatted}`),
                    { component: "tx", phase: "reorg-after-best-block" },
                    { block: event.block }
                  )
                } else {
```

- [ ] **Step 3:** Verify: `npx tsc --noEmit` passes. (submit.ts runs in the browser; the
  telemetry barrel is `"use client"` — fine.)

- [ ] **Step 4:** Commit:

```bash
git add lib/tx/submit.ts
git commit -m "feat(telemetry): capture reorg that invalidates a settled tx"
```

### Task 11: topUp() span + error-kind classifier (`lib/payments/coinage`)

**Files:** Create `lib/payments/coinage/topup-error.ts`; Modify `use-coinage-payment.ts`; Test `tests/telemetry-topup-error.test.ts`

- [ ] **Step 1: Write the failing test** for the error classifier — create `tests/telemetry-topup-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyTopupError } from "@/lib/payments/coinage/topup-error";

describe("classifyTopupError", () => {
  it("maps known host shapes to stable kinds", () => {
    expect(classifyTopupError(new Error("request timed out"))).toBe("timeout");
    expect(classifyTopupError({ tag: "Declined", value: { reason: "insufficient" } })).toBe("declined");
    expect(classifyTopupError(new Error("host bridge unavailable"))).toBe("host");
    expect(classifyTopupError(new Error("weird"))).toBe("unknown");
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/telemetry-topup-error.test.ts` → FAIL (module missing).

- [ ] **Step 3:** Implement `lib/payments/coinage/topup-error.ts`:

```ts
/** Stable, queryable kind for a topUp() failure (string attr → count_if). */
export type TopupErrorKind = "timeout" | "declined" | "host" | "unknown";

export function classifyTopupError(err: unknown): TopupErrorKind {
  const text =
    err instanceof Error ? err.message
    : typeof err === "string" ? err
    : (() => { const o = err as Record<string, unknown> | null;
        const tag = o && typeof o.tag === "string" ? o.tag : "";
        const reason = o && typeof (o.value as Record<string, unknown>)?.reason === "string"
          ? String((o.value as Record<string, unknown>).reason) : "";
        return `${tag} ${reason}`; })();
  if (/time?d?\s?out|timeout/i.test(text)) return "timeout";
  if (/declin|insufficient|reject/i.test(text)) return "declined";
  if (/host|bridge|unavailable|disconnect/i.test(text)) return "host";
  return "unknown";
}
```

- [ ] **Step 4:** Run `npx vitest run tests/telemetry-topup-error.test.ts` → PASS.

- [ ] **Step 5:** Wire the span + attempt counter into `use-coinage-payment.ts`. Add imports:

```ts
import { withSpan, captureWarning, SpanOp } from "@/lib/telemetry";
import { classifyTopupError } from "./topup-error";
```

  Add an attempt counter beside `processed` (`:133`): `let topupAttempts = 0;`

  Replace the `await manager.topUp(...)` call (`:221`) + its catch so the call is wrapped in a
  span whose duration is the host-call latency, attempts are counted, and a retry (attempt > 1)
  emits a duplicate-risk warning (ties to #170):

```ts
                topupAttempts += 1;
                if (topupAttempts > 1) {
                  captureWarning("topUp retry — possible duplicate", {
                    paymentId: id, attempt: topupAttempts,
                  });
                }
                try {
                  await withSpan(
                    "coinage topUp",
                    "payment.coinage.topup",
                    () => manager.topUp(0n, { type: "coins", keys: claimed.coins }),
                    { "topup.attempt": String(topupAttempts) },
                  );
                  if (cancelled) return;
                  log("  claim ok — paid");
                  setStatus("paid");
                  onPaidRef.current?.({
                    paymentId: id, amount: claimed.amount,
                    coinCount: claimed.coins.length, timestamp: Number(claimed.timestamp),
                  });
                } catch (err) {
                  if (cancelled) return;
                  processed = false;
                  const detail = describeError(err);
                  log(`  claim FAILED: ${detail}`);
                  console.error("[coinage] raw topUp error:", err);
                  captureWarning(`topUp failed: ${classifyTopupError(err)}`, { paymentId: id, attempt: topupAttempts });
                  setStatus("error");
                  setError(detail);
                }
```

- [ ] **Step 6:** Add host-drop warnings — at the standalone-host branch (`:163`) and the
  `sub.onInterrupt` re-subscribe (`:251`), add:

```ts
// standalone branch, after the existing log(...):
captureWarning("no Polkadot host — coins undetectable", { paymentId: id });
```
```ts
// inside sub.onInterrupt(...), after the existing log(...):
captureWarning("statement subscription interrupted — host drop", { paymentId: id });
```

- [ ] **Step 7:** Verify: `npx tsc --noEmit` passes; `npx vitest run` all green.

- [ ] **Step 8:** Commit:

```bash
git add lib/payments/coinage/topup-error.ts lib/payments/coinage/use-coinage-payment.ts tests/telemetry-topup-error.test.ts
git commit -m "feat(telemetry): topUp() span + error-kind + duplicate/host-drop warnings"
```

### Task 12: Reporting failure alert-readiness

**Files:** Modify `lib/hooks/use-daily-report.ts`, `lib/hooks/use-bulletin.ts`

The pipeline catches already call `captureError` (so failures already become Sentry issues →
the team's issue-alert picks them up). This task only makes them **alert-clean**: a stable
`report.phase` tag, and not letting *expected* causes (offline, unbound) alert as bugs.

- [ ] **Step 1:** In `use-daily-report.ts` final catch (`:336`), enrich the existing
  `captureError` with classification:

```ts
import { captureError, isExpectedError } from "@/lib/telemetry"; // ensure isExpectedError is imported
// ...in the catch:
        captureError(
          err,
          { component: "daily-report", phase: finalize ? "finalize" : "save",
            expected: isExpectedError(message) },
          { date }
        );
```

- [ ] **Step 2:** In `use-bulletin.ts` upload catch (`:107`), same enrichment:

```ts
        captureError(err, {
          component: "bulletin", phase: "upload-report",
          expected: isExpectedError(message),
        });
```

  (Add `isExpectedError` to the existing `@/lib/telemetry` import.)

- [ ] **Step 3:** Verify `npx tsc --noEmit`. The Sentry issue-alert rule (created post-DSN)
  filters `!expected:true environment:production !tag:e2e-*` so declined/offline don't page.

- [ ] **Step 4:** Commit:

```bash
git add lib/hooks/use-daily-report.ts lib/hooks/use-bulletin.ts
git commit -m "feat(telemetry): classify report generate/publish failures for clean alerting"
```

### Task 13: Journey milestones for e2e payment duration

**Files:** Modify the terminal page / coinage wiring (read the `terminal-payment` journey
start site first — likely `app/terminal/page.tsx` — to place milestones)

- [ ] **Step 1:** Locate where `journeyTracker.start("terminal-payment", ...)` is called
  (`grep -rn 'terminal-payment' app lib`). Confirm the journey spans QR-shown → paid.
- [ ] **Step 2:** Add `journeyTracker.milestone("terminal-payment", "<name>")` at: armed/QR
  shown, statement-received, decrypted, matched, topup-start, paid — wiring the coinage hook's
  callbacks to the active journey (the hook exposes status transitions via `setStatus` and the
  `onPaid` callback; thread milestone calls through those rather than importing the tracker deep
  into the hook if the journey is owned by the page).
- [ ] **Step 3:** Verify `npx tsc --noEmit`; confirm in a local smoke run that
  `journey.terminal-payment` shows the milestone waterfall and `span.duration` = total e2e time.
- [ ] **Step 4:** Commit:

```bash
git commit -am "feat(telemetry): terminal-payment journey milestones for e2e duration"
```

> **Note:** Task 13's exact placement needs the journey-start site read at implementation time
> (not read during planning). The other Phase-2 tasks are fully concrete.

## Advisor refinements (2026-06-13) — fold into the named tasks

**R-A (in Task 2): reconcile `op.sad` so `captureWarning`'s flip isn't orphaned.** `captureWarning`
sets `op.sad="true"` on the active root span, but nothing initialises/reads `op.sad`. Make
`withSpan` default it so it's a real, ratio-able friction flag for `withSpan`-wrapped operations
(journeys use `markSad` instead, since they have no active span during the flow). In
`sentry-helpers.ts` `withSpan`, pass `attributes: { "op.sad": "false", ...attributes }` to
`Sentry.startSpan`, and in its error branch add `span.setAttribute("op.sad", "true")`. Add to
`tests/telemetry-helpers.test.ts`:

```ts
import { withSpan } from "@/lib/telemetry/sentry-helpers";
describe("withSpan op.sad", () => {
  it("defaults op.sad false and flips true on throw", () => {
    const seen: Array<Record<string, unknown>> = [];
    // reuse the @sentry/nextjs mock from this file: have startSpan push opts.attributes
    // and a span stub whose setAttribute records into the same array's last entry.
    // (If the existing mock lacks startSpan, extend it; assert "op.sad" === "false"
    //  on success and that setAttribute("op.sad","true") fires in the catch.)
  });
});
```
(The executing agent: extend the file's existing `@sentry/nextjs` mock to capture `startSpan`
attributes + `setAttribute` calls, mirroring `tests/telemetry-sad.test.ts`.)

**R-B (in Task 5): lock the scrub *attachment*, not just the functions.** Pure-function tests +
tsc don't prove `beforeSend` is wired; a refactor dropping it passes every check. Create
`tests/telemetry-init-wiring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { commonInitOptions } from "@/lib/telemetry/sentry-init";
import { scrubEvent, scrubTransaction } from "@/lib/telemetry/scrub";

describe("commonInitOptions wiring", () => {
  it("attaches the PII scrub hooks", () => {
    const o = commonInitOptions();
    expect(o.beforeSend).toBe(scrubEvent);
    expect(o.beforeSendTransaction).toBe(scrubTransaction);
  });
  it("reads environment + DSN-gates enabled", () => {
    const o = commonInitOptions();
    expect(typeof o.environment).toBe("string");
    expect(o.enabled).toBe((process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").length > 0);
  });
});
```

**R-C (Task 9 → autonomous):** the manual smoke can't run while the user's asleep. Minimum
autonomous proof = R-A + R-B unit/wiring tests + a build with a real DSN set. Steps: write
`.env.local` (gitignored) with the DSN + `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=1.0` +
`NEXT_PUBLIC_SENTRY_ENVIRONMENT=local`, run `npm run build` (proves the wired init compiles with
a live DSN), then **best-effort** drive a Playwright page that calls
`Sentry.captureException(new Error("smoke <registeredSecret>"))` and query the project for the
event, asserting the secret is absent. If the app-level path is flaky autonomously, the wiring
test (R-B) + scrub unit tests (T1) are the binding proof; note the app-level check as deferred.

## Self-review notes

- **Spec coverage:** §1 setup → Task 8 + Task 9; §2 init hardening → Task 5; §3 sampling → Task 8; §4 PII → Task 1 + Task 7; §5 SAD → Tasks 3–4; §6 captureWarning → Task 2 (helper shipped; broad call-site wiring deferred — only one real WS-reconnect site exists, best wired after seeing real data); §7 expected/unexpected → Task 2; §8 e2e tag → Task 6 (scope-tag scope; per-span attr deferred with dashboards); §9 Matrix-readiness → satisfied by Tasks 2/5/6, bridge out of scope.
- **Deferred (explicitly, not forgotten):** captureWarning call-site wiring at the coinage WS-reconnect (`lib/payments/coinage/use-coinage-payment.ts:170`) and any future retry loops; per-span e2e `tag` attribute; dashboards; the Sentry alert rule. These need either real data or human/infra steps.
- **`op.sad` ratio caveat:** `captureWarning` flips `op.sad="true"` on the active `withSpan` root, but `withSpan` does not yet initialise `op.sad="false"` on success — so a SAD% *ratio* over `withSpan` ops lacks a denominator until that init is added in the dashboard phase. The standalone warning **events** (`captureMessage`) are the actionable signal now; the per-domain `payment.sad`/`journey.sad`/`finalization.sad` attributes (Tasks 3–4) are correctly initialised and ratio-ready.
- **Ordering reminder:** the human sets the `NEXT_PUBLIC_SENTRY_DSN` repo secret only AFTER this branch merges (scrub must be live before real merchant data is ingested). Local smoke (Task 9) is safe pre-merge.
