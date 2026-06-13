# Autonomous run status — Sentry eng-reliability

**Branch:** `feat/sentry-eng-reliability` (rebased onto origin/main `43f1478`)
**Started:** 2026-06-13 (overnight, autonomous; user asleep)
**Mandate:** implement spec/plan, build the app, run unit + e2e tests. **DO NOT MERGE.** DSN may be set locally for testing.
**Spec:** `docs-internal/superpowers/specs/2026-06-12-sentry-eng-reliability-design.md`
**Plan:** `docs-internal/superpowers/plans/2026-06-12-sentry-eng-reliability.md`

## Ground rules in effect
- Don't merge. Don't push to main. Branch isolation (own branch only).
- Verify artifacts (git diff/log), not claims. Dispatch Sonnet for multi-file edits, arm ScheduleWakeup(270s) before each.
- DSN for local smoke only via `.env.local` (gitignored); never commit it. Scrub must be implemented before any real-data ingestion (n/a for synthetic local).
- Resume is user-initiated; this file + branch commits are the recovery artifact.

## Task ledger (plan has Phase 1: T1–9, Phase 2: T10–13)
| Task | State | Evidence |
|---|---|---|
| Baseline: `npm ci` | DONE | exit 0; @sentry/nextjs 10.56.0, vitest 3.2.6, pw 1.60.0; lockfile untouched |
| Baseline: build (`npm run build`) | DONE | Next 16.2.7, compiled OK, tsc OK, 17 static pages |
| Baseline: unit (`npx vitest run`) | DONE | 8 files / 53 tests pass (565ms) |
| Baseline: e2e (`npx playwright test`) | FEASIBLE | home.spec 2/2 pass 7.4s; webServer=next dev:5199 reused. |
| FINAL e2e (full, on branch) | DONE | **16/16 pass, 19.6s** (daily-reports, history, home, payment-flow, terminal) telemetry disabled (no DSN) |
| T1 scrub module + tests | DONE | e764056; verified git+tsc, vitest confirming |
| T2 isExpectedError + captureWarning (+R-A op.sad) | DONE | f4b0719 |
| T3 payment/finalization SAD | DONE | ac10b55 |
| T4 journey SAD + markSad | DONE | 3e5da4d |
| T5 shared init opts wiring (+R-B wiring test) | DONE | 199b6f3; uses Parameters<typeof Sentry.init>[0]; types from @sentry/core |
| T6 e2e scope-tag | DONE | 199b6f3 (fixtures.ts re-parents 3 exports via taggedBase.extend) |
| T7 register secret + exports | DONE | a348a49 |
| T8 deploy workflow + .env.example | DONE | 2892da5 (sampling 1.0, env=production) |
| T9 local smoke (DSN) | DONE (partial) | build with real DSN+sampling set inline = green; live-event app-level scrub round-trip DEFERRED to hands-on (needs interactive Sentry check; prod ingestion deferred to DSN-secret-at-deploy anyway). Binding scrub proof = unit tests + wiring test. |
| T10 reorg capture (submit.ts) | DONE (compiles-only) | 0b13cc1; barrel import survives output:export build; no e2e exercises reorg |
| T11 topUp span + classifier | DONE | 8729bff; classifier TDD-verified; hook wiring compiles-only (no e2e completes topUp) |
| T12 reporting alert-readiness | DONE (compiles-only) | ee59626; isExpectedError on existing captureError calls |
| T13 journey milestones | DONE (minimal) | 6440281; added qr-generated for coins path; sub-hook milestones skipped (fragile cross-component coupling) |
| Phase 2 verify: tsc/vitest/build | DONE | tsc 0, vitest 72/72, build green (17 routes) |

## Progress notes
- **Phase 1 VERIFIED** (not just claimed): independent `git log` (7 commits), diff-stat (18 files, all in-lane), `tsc --noEmit` exit 0, `vitest run` 70/70. Fixture change isolated: `payment-flow.spec` 1/1 + `home.spec` 2/2 pass.
- **Advisor fix landed** (a057fb3): `scrubEvent` now also scrubs `event.extra` (where `captureError`'s 3rd arg lands) — was a blind spot. Known limitation recorded in code: scrubDataMap walks top-level strings only, not nested objects (keep `extra` flat).

## FINAL SUMMARY (2026-06-13, batch complete — NOT merged)
- Branch `feat/sentry-eng-reliability`, **13 commits ahead of origin/main**, clean tree (only `bin/` untracked).
- **Verified independently:** tsc 0 errors · vitest **72/72** · `npm run build` green (17 routes) · full e2e **16/16** · build green with real DSN set.
- Phase 1 (T1–8 + R-A/R-B + extra-scrub fix) and Phase 2 (T10–13) all landed. Per-task evidence in ledger above.
- **NOT merged** (per instruction). No PR opened. DSN repo-secret NOT set (deferred to deploy).

## What was NOT done / deferred (honest list)
- **Behaviorally unverified (compiles + reviewed only):** the `topUp()` span/warnings, reorg `captureError`, and reporting classification — no e2e exercises a completed customer `topUp()` or a reorg, so these are proven to compile + reviewed for correctness, not run. (Unit-tested: scrub, helpers, SAD attrs, classifier, init wiring.)
- **T13 minimal:** only the coins `qr-generated` journey milestone added; sub-hook milestones (statement-received/decrypted/matched/topup-start) skipped to avoid fragile cross-component coupling. `journey.duration_ms` still spans full e2e.
- **Live-event scrub round-trip** not run autonomously (deferred to hands-on Sentry check when DSN secret is set).
- **Idempotency enforcement:** tracked in t3rminal-internal#170 (out of scope here).
- **Matrix alert rules:** team-owned; created post-DSN.

## UNBLOCKED + SHIPPED TO PR (2026-06-13 ~09:25Z)
Write access granted (push+maintain). Executed the runbook:
- Branch pushed; **PR #14 open**: https://github.com/paritytech/t3rminal/pull/14
- **DSN secret SET** (`NEXT_PUBLIC_SENTRY_DSN`) — `maintain` covered it; preview will build with telemetry ENABLED (sampling 1.0).
- CI on the PR: Socket Security ✓, CLA ✓; **Deploy Frontend** (pr14- preview) + **E2E Tests** in progress — being watched to terminal state.
- Next: confirm preview URL + CI green; hands-on live-event scrub smoke against the preview (Sentry now on).

## (historical) BLOCKED ON WRITE ACCESS (2026-06-13) — staged, ready to fire
`EnderOfWorlds007` (the session's gh/git account) has **read-only** on `paritytech/t3rminal`
(`push:false, admin:false`; can't set secrets). Ionut is asking maintainers to grant write
(Saturday — delay expected). Branch is fully committed locally; nothing else is in flight.

**The instant `EnderOfWorlds007` has push (+ admin/secrets for the DSN), run exactly this:**
```bash
cd /Users/ionut/Documents/GitHub/t3rminal
git fetch origin && git rebase origin/main           # branch is docs+telemetry; expect clean
git push -u origin feat/sentry-eng-reliability
gh pr create --repo paritytech/t3rminal --base main --head feat/sentry-eng-reliability \
  --title "Sentry engineering-reliability instrumentation" \
  --body-file docs-internal/superpowers/status/sentry-eng-reliability-pr-body.md
# DSN so the PR preview sends telemetry (needs repo admin/secrets perm):
gh secret set NEXT_PUBLIC_SENTRY_DSN --repo paritytech/t3rminal \
  --body 'https://d525dec6a98895f678ca4f0e726a9bd7@o4511059872841728.ingest.de.sentry.io/4511547331903568'
```
Then: PR `pull_request` trigger deploys a `pr<N>-` preview app; verify CI to a terminal state;
do the hands-on live-event scrub smoke against the preview (Sentry now enabled).
If only push (not admin) is granted: open the PR; ask an admin to set the secret.

## Resume / next steps for the human
- Review the branch; when ready: set repo secret `NEXT_PUBLIC_SENTRY_DSN` (value in spec/memory), open PR (rebase on origin/main first), merge, then hands-on smoke (trigger a real error carrying a fake secret → confirm redacted in Sentry).

## How to resume
1. `cd /Users/ionut/Documents/GitHub/t3rminal && git checkout feat/sentry-eng-reliability`
2. Read this file's ledger; continue from first PENDING/IN-PROGRESS row.
3. Re-verify with `git log --oneline origin/main..HEAD` and `npx vitest run`.
