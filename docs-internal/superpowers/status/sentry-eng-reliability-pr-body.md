## Sentry engineering-reliability instrumentation

Lights up and hardens t3rminal's already-present-but-dark Sentry telemetry, and adds monitoring for the two primary workflows (Payments E2E, Reporting) plus host anomalies.

**Design + plan (in-repo):**
- Spec: `docs-internal/superpowers/specs/2026-06-12-sentry-eng-reliability-design.md`
- Plan: `docs-internal/superpowers/plans/2026-06-12-sentry-eng-reliability.md`

### Why
The `lib/telemetry/` module shipped at init but received **zero events**: the `NEXT_PUBLIC_SENTRY_DSN` secret is unset and `tracesSampleRate` was hardcoded `0.0` in the deploy workflow (rate 0 ⇒ every span dropped at creation). This PR makes the data flow and be safe + useful for engineering reliability.

### What's in here
**Foundation**
- **PII scrub** (`lib/telemetry/scrub.ts`) wired into `beforeSend`/`beforeSendTransaction` at all init sites: hard-redacts the merchant report password (incl. `event.extra`), truncates wallet/receiving addresses to 8 chars, keeps amounts/IDs.
- Shared `commonInitOptions()` adds `environment` + `release` (commit SHA) across client/server/edge.
- Deploy workflow: trace sampling `0.0` → `1.0`, passes `NEXT_PUBLIC_SENTRY_ENVIRONMENT`.
- `captureWarning` + `isExpectedError`; SAD% string flags (`payment.sad`/`finalization.sad`/`journey.sad`, + `op.sad` on `withSpan`); e2e scope-tag so synthetic traffic is excludable.

**Monitored workflows**
- **Payments E2E:** `payment.coinage.topup` span (latency via `span.duration`), `topUp` error-kind classifier, duplicate-attempt + host-drop warnings.
- **Reporting:** generate/publish failures classified for clean alerting.
- **Host anomalies:** reorg-invalidates-settled-tx `captureError` (`lib/tx/submit.ts`), statement-store interrupt warnings.

### Metric mechanics (verified)
Custom **numeric** attributes/measurements do **not** aggregate in this project's Sentry EAP (empirically confirmed — `sum()` returns "string type field", even with `currency`/`millisecond` units). So all metrics use `span.duration` + `count`/`count_if`; amounts stay strings; **Sentry tracks payment volume, never sums money** (daily reports remain the financial source of truth).

### Verification
- `tsc --noEmit`: 0 errors
- `vitest run`: **72/72** (53 pre-existing + 19 new)
- `npm run build`: green, 17 static routes (also green with a real DSN set)
- full Playwright e2e: **16/16**

**Honest caveats:** the `topUp` span, reorg capture, and reporting classification are **compiles + reviewed only** — no e2e exercises a completed customer `topUp()` or a reorg. Scrub, helpers, SAD attrs, classifier, and init-wiring are unit-tested. Journey-milestone wiring is minimal (one milestone; sub-hook milestones skipped to avoid fragile cross-component coupling).

### Before this delivers value (follow-ups, not in this PR)
- Set the `NEXT_PUBLIC_SENTRY_DSN` repo secret (public client DSN) — until then Sentry stays disabled, including in the PR preview.
- Host-side idempotency enforcement for `topUp()`: paritytech/t3rminal-internal#170.
- Matrix alert rules (team-owned, created post-DSN).
- Hands-on smoke: trigger a real error carrying a fake secret and confirm it's redacted in Sentry.
