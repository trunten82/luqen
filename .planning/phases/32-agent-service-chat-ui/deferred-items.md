# Phase 32 — Deferred Items

Pre-existing test failures surfaced by `/gsd:execute-phase` but NOT caused by this phase's work. Logged per execute-plan workflow scope rule; do not fix inline.

## 2026-04-20 — Plan 32-03 GREEN full-suite run

Full-suite `npx vitest run` from `packages/dashboard` revealed 2 pre-existing failures in `tests/e2e/auth-flow-e2e.test.ts` that reproduce with Plan 32-03 changes stashed:

- `Auth Flow E2E > unauthenticated access > GET /home without auth redirects to /login`
- `Auth Flow E2E > logout > session is invalid after logout`

Both assertions fail at `expect(response.headers['location']).toBe('/login')` (~line 397). These tests do not touch migrations / organizations / agent display name and have nothing to do with Plan 32-03's diff. Confirmed pre-existing via `git stash && npx vitest run tests/e2e/auth-flow-e2e.test.ts` (2 failures before my changes land).

Net new test impact from Plan 32-03: **0 regressions, +13 new passing tests**.
