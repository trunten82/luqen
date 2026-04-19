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

### `tests/routes/oauth/authorize.test.ts` — 2 failures
- Test 5 `GET /oauth/authorize — renders adminScopeBlocked card` — expects
  `body.data.adminScopeBlocked === true`; got `false`.
- Test 11 `POST /oauth/authorize/consent — returns 403 when a non-admin forges
  admin.system in consent POST` — expects 403; got 302.

**Root cause (likely):** Commit `33177ef` "fix(31.1): login returnTo, graceful
scope gate, alert markup (smoke gaps)" (master history) changed the
admin-scope gate to render inline alerts rather than blocking with a separate
consent-view flag. The test still asserts the pre-graceful contract.

**Disposition:** Defer to Phase 31.1 smoke/verification follow-up. Plan 31.2-02
(`mcp.use` gate on /oauth/authorize) will touch the same handler and may
incidentally update the assertions; if not, a dedicated docs commit should
follow 31.2 completion.
