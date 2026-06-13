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

1. **No DSN reaches the build.** `.env.example` ships `NEXT_PUBLIC_SENTRY_DSN=` empty, and
   `enabled` is false without it. The prod build (`deploy-frontend.yml:62`) reads the DSN from
   a GitHub repo secret `NEXT_PUBLIC_SENTRY_DSN` that is currently unset → empty → disabled.
   (The Sentry **project already exists** — see below — but has received zero events.)
2. **`tracesSampleRate` is `0.0`** — both as the init-site default *and* hardcoded in
   `deploy-frontend.yml:66`. With rate 0, Sentry makes a negative sampling decision at
   root-span creation, so **every** journey/payment span is dropped before it leaves the
   browser. The timing code runs but emits nothing. Raising it requires editing the workflow,
   not just env.

### Sentry project (confirmed 2026-06-12)

The project exists already (created 2026-06-11, likely by todor):

- Org `paritytech` · Team `paritytech` · Project `t3rminal` · Platform `javascript-nextjs`
- Region: EU (`de.sentry.io`)
- `firstEvent: null` — nothing has ever been ingested
- Public client DSN: `https://d525dec6a98895f678ca4f0e726a9bd7@o4511059872841728.ingest.de.sentry.io/4511547331903568`
  (a browser DSN is public by design — safe to ship in the bundle / commit)

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

### 1. Setup / prerequisites (goal 0)

The project + DSN already exist (see above). Remaining wiring:

- **Human-only action (Ionut/admin):** set the GitHub repo secret
  `NEXT_PUBLIC_SENTRY_DSN` = the public DSN above. (Repo secrets can't be set from this
  session.) This is the switch that turns production ingestion on, so it should be flipped
  **after** the PII scrub lands — see ordering note below.
- **Code change (this branch):** in `deploy-frontend.yml` change
  `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` from `'0.0'` to `'1.0'`, and add
  `NEXT_PUBLIC_SENTRY_ENVIRONMENT: production`.
- Local smoke testing uses `.env.local` (gitignored) with the DSN + sampling raised.
- Source-map upload (`SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN`) stays optional,
  as today.

**Safety ordering — scrub before ingestion.** Because §4 identifies real secrets/PII that
could otherwise reach the wire, the PII scrub (§4) + hardening must merge **before** the DSN
secret is set in prod. Sequence: implement on branch → merge → then set the repo secret. Local
`.env.local` testing is fine throughout (no real merchant data).

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

## Metric mechanics — what aggregates in Sentry (verified 2026-06-13)

Empirically tested against the live `t3rminal` project (raw numeric envelope, no SDK, zero
prior events, recognized units): **custom numeric span attributes and measurements do NOT
aggregate in EAP** — `sum()`/`avg()`/`p95()` 400 with *"its a string type field"* and the
values come back `null`. This holds even for `setMeasurement(..., "millisecond"|"currency"|
"byte")`. The constraint is the EAP backend, not the SDK or project history. See memory
`t3rminal-sentry-numeric-eap`.

**Consequence — design every metric around what works natively:**

| Metric | How (native, works) | NOT |
|---|---|---|
| Payment success rate | `count_if(payment.outcome, equals, success) / count()` (string attr) | the dead `setMeasurement("payment.success")` |
| Finalization latency p50/p95 | `p95(span.duration)` on `span.op:payment.finalization` (span is back-dated to the real latency) | `measurements.finalization.latency` (string/null) |
| `topUp()` latency | `p95(span.duration)` on the new `payment.coinage.topup` span | a numeric attr |
| Total e2e payment duration | `p95(span.duration)` on `journey.terminal-payment` | — |
| Transaction **volume** | `count()` of successful `payment.outcome` spans | — |
| Total **revenue** (sum of amounts) | **local aggregation** — pull events via the events API and sum in a script (triangle-deploy `tools/lib/sentry-events.mjs` pattern) | any custom numeric attr/measurement |

**Decisions this locks in:**
- `payment.amount` stays a **string** attribute (display/filter/drill-down). No
  `payment.amount_value` measurement — withdrawn (verified it wouldn't aggregate).
- All SAD/outcome/status flags stay **strings** (`"true"`/`"false"`/`"error"`) — `count_if`
  is the aggregation path, which is exactly why §5 initialises them to a default value.
- The existing `setMeasurement(...)` calls in `payment-metrics.ts` are harmless but **must not
  be relied on**; primary metrics use `span.duration` + `count_if`. (Cleanup/removal optional.)

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

## Monitored workflows (team requirements, 2026-06-13)

Two primary workflows get explicit monitoring + alerting, plus cross-cutting host anomalies.
All metrics use the native patterns above (`span.duration` + `count`/`count_if`), never custom
numeric attrs.

### Workflow 1 — Payments E2E (W3S coinage)

Flow: `use-coinage-payment.ts` — subscribe to statement store (`:173`) → decrypt envelope
(`:188`) → match id+amount (`:198`) → `manager.topUp()` (`:221`) → paid (`:225`).

- **`topUp()` latency / errors** — wrap `:221` in a `payment.coinage.topup` span; its duration
  IS the host-call latency (`p95(span.duration)`). On error set status + classified
  `topup.error_kind` (timeout/declined/host/unknown) string attr.
- **Retries / duplicate risk** — track `topup.attempt` (string) incremented on the `:234`
  retry path; on attempt > 1 emit `captureWarning("topUp retry — possible duplicate", {paymentId, attempt})`.
  This is the detection half of [#170](https://github.com/paritytech/t3rminal-internal/issues/170);
  enforcement (host idempotency key) is tracked there, not here.
- **Total e2e duration** — add journey milestones to `terminal-payment`: `armed`,
  `statement-received`, `decrypted`, `matched`, `topup-start`, `paid`. Duration =
  `span.duration` on `journey.terminal-payment`.
- **Volume** — `count()` of successful `payment.outcome` spans. **Amount stays a string**
  (drill-down/filter only; never summed — see non-goal below).
- **Statement-store / host drop** — the subscription re-arms on `sub.onInterrupt` (`:249`) →
  `captureWarning("statement subscription interrupted")`. Standalone host (`:157`, coins can
  never arrive) → `captureWarning("no Polkadot host — coins undetectable")`.

### Workflow 2 — Reporting (notify on failure only)

- **Fails to generate** — daily-report finalize/save (`use-daily-report.ts:293,336`) + receipt
  build (`receipts/receipt-generator.ts`). Already throws + `captureError`; ensure classified
  **unexpected** (so it alerts) with a stable `report.phase` attr.
- **Fails to publish to bulletin** — `use-bulletin.ts:107` (`bulletin.upload-report`). Same:
  unexpected + alert-ready.

### Cross-cutting host anomalies

- **Re-org invalidating a settled tx** — `lib/tx/submit.ts:305-318` already detects a tx that
  finalizes failed *after* we resolved it on best-block, but only `console.warn`s (`:310`).
  Upgrade to `captureError("reorg invalidated settled tx", { block, dispatchError })` — a
  silent data-integrity event today. High value.
- **Host network drops** — the statement-subscription interrupt above; plus any RPC/ws
  reconnect site as it's found (currently thin — one site).

### Alerting model (rules created post-DSN, via the team's Matrix path)

- **Issue alerts** (error/message events → Matrix): report generate/publish failures, reorg
  invalidation, `topUp` errors, duplicate-topUp warnings.
- **Metric alerts** (span data): `p95(span.duration) > threshold` on
  `payment.coinage.topup` (timeouts), finalization-timeout rate, duplicate count.
- All filtered to `environment:production !tag:e2e-*` (e2e scope tag from §8).

### Explicit non-goal

**Sentry does not produce financial reports.** It tracks payment *volume* (`count()`) and
*reliability*; it never sums amounts/revenue. Authoritative financial totals live in the daily
reports. `payment.amount` exists only as a per-event string for debugging a specific payment.

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
| `lib/payments/coinage/use-coinage-payment.ts` | `payment.coinage.topup` span + attempt/retry warning + subscription-interrupt/standalone-host warnings + journey milestones |
| `lib/tx/submit.ts` | reorg `captureError` at `:310` |
| `lib/hooks/use-daily-report.ts` | report-generate failures classified unexpected + `report.phase` |
| `lib/hooks/use-bulletin.ts` | bulletin-publish failure classified unexpected + alert-ready |
| `e2e/fixtures.ts` | set the `e2e-*` tag signal at one chokepoint |
| `.github/workflows/deploy-frontend.yml` | sampling `'0.0'`→`'1.0'`; add `NEXT_PUBLIC_SENTRY_ENVIRONMENT` |
| `.env.example` | document `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `_RELEASE`, sampling guidance |
| `tests/telemetry-*.test.ts` | new vitest tests (scrub, sad, classification, warning) — vitest only collects `tests/**/*.test.ts`, env `node` |

## Open items for the human

- ~~Create the Sentry project + DSN~~ — **done** (exists in `paritytech`, DSN above).
- Set the GitHub repo secret `NEXT_PUBLIC_SENTRY_DSN` = the DSN above — **deferred to
  deploy time** (decided 2026-06-12, concurrent work in the repo). Value:
  `https://d525dec6a98895f678ca4f0e726a9bd7@o4511059872841728.ingest.de.sentry.io/4511547331903568`.
  This is the deploy-time activation switch; it must land only once the scrub is merged
  (ordering note in §1). Command: `gh secret set NEXT_PUBLIC_SENTRY_DSN --repo paritytech/t3rminal --body '<dsn>'`.
- Matrix delivery path is owned by the team; the Sentry alert rule is created post-ingestion.
