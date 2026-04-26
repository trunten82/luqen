# Phase 31.2 — Deferred Items (out-of-scope discoveries)

This file tracks issues discovered during plan execution that are OUT OF SCOPE
for the plan that discovered them. Pre-existing failures in unrelated files are
not to be fixed by the plan executor.

## Pre-existing dashboard test failures (observed during 31.2-01 execution)

These 4 failures exist on master @ 6b9c230 (the plan base commit) WITHOUT any
31.2-01 changes applied. Verified by git-stashing the 31.2-01 changes and re-
running the same test files. They are NOT caused by 31.2-01 and are out of
scope for this plan (scope boundary rule).

### `tests/e2e/auth-flow-e2e.test.ts` — 2 failures
- `GET /home without auth redirects to /login` — expects `/login`, gets `/login?returnTo=%2Fhome`.
- `session is invalid after logout` — same `returnTo` query-string mismatch.

**Root cause (likely):** Commit `4337c8d` "thread returnTo through login
partials + already-auth shortcut" (master history, Phase 31.1 inline smoke
fix) introduced the `?returnTo=` query-string in redirect responses, but the
test assertions were not updated.

**Disposition:** Defer to Phase 31.1 smoke/verification follow-up or a dedicated
housekeeping commit. Not related to 31.2 scope.

### `tests/routes/oauth/authorize.test.ts` — RESOLVED by Plan 31.2-02

Plan 31.2-02's rewrite of `authorize.ts` (mcp.use gate + switch-org CTA +
scope narrowing) included a 245-line test-file rewrite that incidentally
fixed the two pre-existing failures. All 30 tests in this file now pass
as of commit 68a4b4d (post-Wave-2 merge).
