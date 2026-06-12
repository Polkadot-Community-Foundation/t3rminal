# Sentry Eng-Reliability Instrumentation — Design

**Date:** 2026-06-12
**Status:** Approved (brainstorm), pending spec review
**Branch:** `feat/sentry-eng-reliability`

## Goal

Make t3rminal observable for **engineering reliability**: when payments, finality,
report uploads, or any flow break in the field, an engineer should (a) be notified of
errors and (b) be able to diagnose them from Sentry spans + breadcrumbs without the
merchant's phone in hand.

The two concrete asks driving this:

- **(a)** Any error notifies the team in Matrix.
- **(b)** Spans/timing are instrumented and actually flowing.

Primary consumer: **engineering** (not product analytics, not fleet ops — those can be
layered on later from the same data).

## Current state (what already exists)

t3rminal already ships a full `lib/telemetry/` module, committed at init:

- `sentry-helpers.ts` — `withSpan` / `breadcrumb` / `captureError`
- `journey-tracker.ts` — multi-phase user-journey spans (terminal-payment, items-checkout,
  daily-report-save/finalize, report-decrypt, bulletin-index-read, encryption-key-set,
  authenticate, page-load)
- `payment-metrics.ts` — `recordPaymentOutcome` + `recordFinalizationLatency`
- `span-ops.ts` — span-op catalog
- `lib/components/sentry-tags.tsx` — merchant/terminal scope tags, mounted in root layout
- `instrumentation.ts` + `instrumentation-client.ts` + `sentry.{server,edge}.config.ts` —
  init sites; replay-on-error enabled; DSN-gated (`enabled: dsn.length > 0`)
- `next.config.ts` wraps `withSentryConfig` (source-map upload gated on auth-token env)

**This is good instrumentation that is currently dark.** Two reasons:

1. **No DSN.** `.env.example` ships `NEXT_PUBLIC_SENTRY_DSN=` empty, and `enabled` is false
   without it. Nothing is sent.
2. **`tracesSampleRate` defaults to `0.0`** at all four init sites. With rate 0, Sentry
   makes a negative sampling decision at root-span creation, so **every** journey/payment
   span is dropped before it leaves the browser. The timing code runs but emits nothing.

Errors (`captureException`) are *not* gated by `tracesSampleRate` — they flow as soon as a
DSN exists. Spans need both a DSN and a non-zero rate.

## Scope decisions (and what's explicitly out)

The triangle-deploy `sentry-instrumentation-spec.md` is written for a `@sentry/node` CLI.
t3rminal is a static-export `@sentry/nextjs` **browser** app. We apply the
platform-agnostic patterns and drop the CLI-only ones.

**In scope:**

- DSN wiring + non-zero trace sampling (turn the lights on)
- `environment` + reliable `release` on all init sites
- PII sanitisation via `beforeSend` / `beforeSendTransaction` (browser-adapted)
- SAD% friction flag on key root spans
- `captureWarning` helper wired at transient-friction sites
- Expected-vs-unexpected error classification
- E2E/test-traffic tagging so prod dashboards + the Matrix alert exclude test runs

**Out of scope (this pass):**

- **Matrix delivery wiring** — the team already has a Matrix delivery path. We design the
  Sentry-side alert *filter* so it routes cleanly, but do not build the bridge here.
- **Dashboards** — deferred to a separate, confirm-first phase once a project exists and
  real span traffic is flowing.
- **CLI-only spec items** — `flush(5000)` in finally (long-lived browser page, not a
  short-lived process), `serverName`/host anonymisation (no server), opt-in/opt-out via
  `GITHUB_REPOSITORY`/`RUNNER_NAME` (DSN-gating is the browser equivalent and already done),
  the `/Users/`–`/home/` filesystem path scrub regex (a sandboxed browser doesn't emit
  filesystem stack traces).

## Design

### 1. Setup / prerequisites (goal 0) — human + config

- **Ionut (org admin):** create a Sentry **Next.js / browser** project in the `paritytech`
  org; provide the DSN.
- Wire deploy env:
  - `NEXT_PUBLIC_SENTRY_DSN=<dsn>`
  - `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=1.0` (prod/preview — low-volume terminal, trace
    every payment; local stays `0.0`)
  - `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production|preview` (defaults to `local` when unset)
- Source-map upload (`SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN`) stays optional,
  as today.

### 2. Init hardening (all four Sentry init sites)

Add to every `Sentry.init`:

- `environment`: read `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (fallback `"local"`).
- `release`: read `NEXT_PUBLIC_SENTRY_RELEASE`, fallback to the package version
  (`@parity/t3rminal-v1@0.1.0`). The `withSentryConfig` plugin only injects a release when
  source maps upload; setting it explicitly guarantees the attribute is always present so
  `release:` filters and post-release monitoring work.
- `beforeSend` / `beforeSendTransaction`: see §4.

The client init keeps the existing replay-on-error config unchanged.

### 3. Trace sampling

Raise `tracesSampleRate` via env (default `0.0` for safety/local; `1.0` in prod/preview).
No code change to the read logic — only the deployed env value and documentation. Once set,
the existing journey/payment/finalization spans flow.

### 4. PII policy (browser-adapted scrub) — **approved**

A new `lib/telemetry/scrub.ts` exposes `scrubEvent` / `scrubTransaction`, wired into
`beforeSend` / `beforeSendTransaction` at every init site. Rules:

| Field | Policy | Why |
|---|---|---|
| `reportPassword` | **Hard-redact** wherever it appears (message, exception value, breadcrumb message, span attrs, request data) | The one true secret; must never reach the wire |
| Receiving / wallet addresses | **Truncate** to first 8 chars + `…` | Groupable without storing the full address |
| `merchantKey` (admin public key) | Keep as-is | Public identifier; already a scope tag |
| `merchantId` / `terminalId` | Keep | Operational — identifies the affected terminal |
| Payment `amount`, `saleId` (ULID) | Keep | Debugging value; not PII |

The scrubber walks the four places PII can hide in an error event (message, exception
values, breadcrumb messages, span/request data) and the span-attribute map on transactions.
Address truncation reuses an 8-char `truncateAddress` helper. `reportPassword` redaction is
value-based (redact any occurrence of the known secret string) so it is caught even if it
leaks into an unexpected field.

### 5. SAD% friction flag (goal b)

Add a `*.sad` string attribute (`"false"` default, flipped to `"true"` on any
retry/timeout/warning) to the key root spans:

- `payment.outcome` → `payment.sad`
- `payment.finalization` → `finalization.sad` (flip `true` on timeout)
- journey spans → `journey.sad`

Initialised to `"false"` at span creation (not just set on error) so the SAD% ratio has a
valid denominator. This is the leading indicator for "payments complete but something is
degrading" that a raw failure rate misses.

### 6. `captureWarning` helper (goal b)

Add `captureWarning(message, context?)` to `sentry-helpers.ts`:

- `addBreadcrumb({ level: "warning" })` — into the trace timeline
- `captureMessage(message, { level: "warning" })` — standalone, queryable warning event
- mark the active root span's `*.sad = "true"`
- entire body wrapped in try-catch (telemetry must never throw into app flow)

Wired at the transient-friction sites:

- RPC / websocket reconnect (chain client)
- finalization timeout (already a recorded outcome — add the warning)
- bulletin / IPFS upload retry
- host-storage errors that recover (`StorageErr` paths)

Use stable, machine-readable message prefixes (e.g. `"RPC reconnect"`, `"Finalization
timeout"`) so future dashboard/alert queries can match on `title:`.

### 7. Expected-vs-unexpected error classification

A small `isExpectedError(reason)` predicate distinguishes user/external causes from bugs:

- **Expected** (user/external — do **not** mark `internal_error`): insufficient funds,
  user-cancelled, network offline, terminal unbound / no admin config, payment declined,
  finalization timeout.
- **Unexpected** (bug — mark `setStatus({ code: 2, message: "internal_error" })`):
  everything else.

Applied in the payment/journey failure paths. This is what keeps the **future Matrix
alert** from firing on every declined payment — the alert filters on real, unexpected,
non-test errors.

### 8. E2E / test-traffic isolation

Playwright runs set a **runtime** signal, not a build-time env var (a static-export build
bakes `NEXT_PUBLIC_*` at build time, so it can't vary per test run). The chokepoint in
`e2e/fixtures.ts` calls `page.addInitScript` to set `window.__T3RMINAL_E2E_TAG = "e2e-<suite>"`
before any app code runs. The telemetry layer reads that flag and attaches a `tag` attribute
to spans **and** a matching scope tag to events, under the `e2e-*` namespace. Set once at the
fixture chokepoint, not per-test. Prod dashboards and the Matrix alert exclude `tag:e2e-*`.

### 9. Errors → Matrix (goal a) — Sentry-side only

Errors reach Sentry Issues once the DSN is set (already instrumented). This pass makes them
*alert-ready*:

- expected/unexpected classification (§7) so only bugs are alert-worthy,
- e2e tagging (§8) so test runs don't fire,
- `environment` (§2) so the alert scopes to `production`.

The intended alert filter (to be created in Sentry once the project exists, routed via the
team's existing Matrix path): `environment:production !tag:e2e-* level:error`. Building the
Matrix bridge itself is out of scope here.

## Testing

Vitest unit tests (the app uses `vitest run`):

- **scrub**: `reportPassword` redacted from message / exception / breadcrumb / span attrs;
  wallet address truncated to 8 chars; `merchantId`/`amount`/`saleId` pass through unchanged.
- **sad default**: a clean payment outcome emits `payment.sad = "false"`; a warned/failed
  one emits `"true"`.
- **isExpectedError**: known user-error strings classify expected; an arbitrary bug string
  classifies unexpected.
- **captureWarning**: no-op when Sentry disabled (no DSN); does not throw.

Manual smoke test (with a real DSN in `.env.local`, sampling raised):

- run a payment → confirm one `payment.outcome` span + the `journey:terminal-payment` span
  land with expected attributes and **no `reportPassword`** anywhere;
- force an error → confirm one Sentry Issue with `environment`, `release`, merchant/terminal
  tags, and no secrets.

## File-touch summary

| File | Change |
|---|---|
| `lib/telemetry/scrub.ts` | **new** — `scrubEvent` / `scrubTransaction` / `truncateAddress` |
| `lib/telemetry/sentry-helpers.ts` | add `captureWarning`, `isExpectedError` |
| `lib/telemetry/payment-metrics.ts` | `payment.sad` / `finalization.sad` defaults + flips |
| `lib/telemetry/journey-tracker.ts` | `journey.sad` default + flip on `fail()` |
| `lib/telemetry/index.ts` | export new helpers |
| `instrumentation-client.ts` | `environment`, `release`, `beforeSend(Transaction)` |
| `sentry.server.config.ts` / `sentry.edge.config.ts` | same init hardening |
| `e2e/fixtures.ts` | set the `e2e-*` tag signal at one chokepoint |
| `.env.example` | document `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `_RELEASE`, sampling guidance |
| `lib/telemetry/*.test.ts` | new vitest tests (scrub, sad, classification, warning) |

## Open items for the human

- Create the Sentry project + DSN (Ionut / org admin).
- Confirm/lay down the deploy env values (DSN, sampling=1.0, environment).
- Matrix delivery path is owned by the team; the Sentry alert rule is created post-DSN.
