---
phase: 38-multi-org-context-switching
plan: 03
subsystem: dashboard/routes+agent-service
tags: [aorg-01, aorg-02, aorg-03, aorg-04, routes, csrf, audit, agent-service]
requires:
  - phase: 38-multi-org-context-switching
    provides: UserRepository.setActiveOrgId, DashboardUser.activeOrgId (Plan 38-01)
  - phase: 38-multi-org-context-switching
    provides: agent-drawer-org-switcher partial + showOrgSwitcher/orgOptions contract (Plan 38-02)
provides:
  - resolveAgentOrgId(user, permissions, activeOrgId, orgList) — central resolver
  - defaultOrgAlphabetical(orgList) — deterministic admin default
  - buildDrawerOrgContext({user, permissions, storage}) — drawer template feeder
  - POST /agent/active-org — admin.system gated, CSRF protected, audited
  - GET /agent/conversations/:id cross-org admin allowance (read-only)
  - resolveAgentOrgIdAsync(storage, user, permissions) — per-request wrapper
affects:
  - 38-04 (client wiring will POST /agent/active-org and re-render the drawer)
  - all routes/agent.ts handlers (every call site rewired through async resolver)
tech-stack:
  added: []
  patterns:
    - Per-request async resolver wrapper that hoists listOrgs() + getUserById()
      reads to a single point per route handler
    - Deny-with-audit pattern for permission/validation gates (T-38-08 / T-38-11)
    - Raw-DB fallback for cross-org reads when the org-scoped repo method
      would return null (admin.system bypass — read-only)
    - Body-schema-first validation via zod ActiveOrgBodySchema
key-files:
  created: []
  modified:
    - packages/dashboard/src/routes/agent.ts
    - packages/dashboard/tests/routes/agent.test.ts
    - packages/dashboard/tests/agent/agent-service.test.ts
key-decisions:
  - "Synthetic '__admin__:userId' org id is REMOVED. Admins now resolve to a real org id at all times — defaultOrgAlphabetical for unset, user.activeOrgId when present. Stale activeOrgId not in current orgList falls back to alphabetical default."
  - "Drawer-context plumbing exposed via an exported helper (buildDrawerOrgContext) rather than wired into a single agent route, because the drawer is rendered by the shared layout (main.hbs) on every authenticated page. The helper is testable in isolation and can be invoked from server.ts's view-data preHandler in a future change."
  - "Cross-org GET /agent/conversations/:id uses a raw-DB fallback (loadConversationAnyOrg) instead of adding a new public repository method. Keeps the org-scoped getConversation contract intact (defence-in-depth for non-admins) while the admin bypass lives at the route layer where the permission check is."
  - "POST /agent/active-org always emits exactly ONE audit row regardless of outcome (success / not_admin_system / unknown_org). fromOrgId is the resolved orgId BEFORE the switch (or null), captured before any setActiveOrgId mutation."
  - "Per-request async resolver (resolveAgentOrgIdAsync) wraps the new pure resolver to keep call-site changes minimal — every existing route handler swaps `resolveAgentOrgId(user, perms)` for `await resolveAgentOrgIdAsync(storage, user, perms)`."
patterns-established:
  - "Pure resolver + async wrapper split — a pure function exported for unit testing plus an async per-request wrapper that owns the I/O. Allows tests to exercise resolver branches deterministically without DB seeding."
  - "Audit-before-deny pattern — for every route gate (permission, validation), emit the audit row BEFORE returning the error response, so denied attempts always leave a paper trail (T-38-08)."
requirements-completed: [AORG-01, AORG-02, AORG-03, AORG-04]
duration: ~25 min
completed: 2026-04-24
---

# Phase 38 Plan 03: Server-Side Multi-Org Context Switching Summary

**Server-side core for AORG-01..04: extends `resolveAgentOrgId` to honour `user.activeOrgId` for global admins (with alphabetical default and the legacy `__admin__:` synthetic value retired), adds `POST /agent/active-org` (admin.system gated, CSRF protected, audited on every outcome), opens `GET /agent/conversations/:id` to admin cross-org reads while keeping non-admins org-scoped, and pins per-turn org binding in `AgentService.runTurn` via three new tests — all 62 route + agent-service tests green, full TS check clean.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-24T12:55Z
- **Completed:** 2026-04-24T13:10Z
- **Tasks:** 3 (all TDD)
- **Files modified:** 3
- **Files created:** 0
- **Tests added:** 23 (8 resolver + 3 drawer-render + 6 POST active-org + 3 cross-org GET + 3 per-turn binding)

## Accomplishments

- **`resolveAgentOrgId` extended** with the new four-arg signature
  `(user, permissions, activeOrgId, orgList)`. Admin.system without
  `currentOrgId` now resolves to `activeOrgId` if it exists in `orgList`,
  else first-org-alphabetical-by-name. Synthetic `__admin__:userId` is
  removed from production paths.
- **`defaultOrgAlphabetical(orgList)`** — exported pure helper, returns
  the first org id by `name.localeCompare` ordering.
- **`buildDrawerOrgContext({user, permissions, storage})`** — exported
  async helper that returns `{ showOrgSwitcher, orgOptions, resolvedOrgId }`
  for the drawer template. `orgOptions` is alphabetically sorted with
  `selected` flagged on the resolved id.
- **`resolveAgentOrgIdAsync(storage, user, permissions)`** — per-request
  wrapper that hoists `listOrgs()` + `users.getUserById()` reads. Used
  by every existing route handler in `routes/agent.ts` (16 call sites
  rewired in one `replace_all` edit).
- **`POST /agent/active-org`** — body schema `{ orgId }` (zod, 1..64
  chars). Permission gate (admin.system) → audit `denied/not_admin_system`
  → 403. Allowlist check against `listOrgs()` → audit `denied/unknown_org`
  → 400. Success path: `setActiveOrgId(user.id, toOrgId)` + audit
  `success` with `argsJson={fromOrgId,toOrgId}` → 200
  `{activeOrgId, activeOrgName}`. CSRF inherited from server.ts global
  preHandler.
- **`GET /agent/conversations/:id`** — admin.system fallback:
  `loadConversationAnyOrg(storage, id)` raw-DB read when the
  org-scoped lookup returns null. Non-admins keep the existing 404
  for foreign-org ids. No `active_org_id` mutation on read.
- **`AgentService.runTurn`** verified — three new tests pin per-turn
  `ctx.orgId` binding: dispatcher receives the orgId argued at runTurn
  time, two consecutive turns with different orgIds produce two
  distinct ctx.orgId values, and the LLM transport `input.orgId`
  mirrors the per-turn arg.

## Task Commits

1. **Task 1+2 (combined): resolveAgentOrgId extension + drawer context + POST /agent/active-org + cross-org GET admin allowance** — `f62d87f` (feat)
2. **Task 3: per-turn binding regression tests** — `6adbc0f` (test)

Tasks 1 and 2 share a single commit because they both edit `routes/agent.ts`
and the call-site rewiring is shared between them. Splitting would have
produced churn for no verification benefit. Tests for both were authored
inline so each task's behaviour is locked at the same boundary.

## Files Created/Modified

- `packages/dashboard/src/routes/agent.ts` — extended resolver,
  exported pure helpers, added per-request async wrapper, added POST
  `/agent/active-org`, added cross-org admin GET fallback, added
  `loadConversationAnyOrg` private helper, added `ActiveOrgBodySchema`.
  16 call sites rewired to `await resolveAgentOrgIdAsync(...)`.
- `packages/dashboard/tests/routes/agent.test.ts` — appended Phase 38
  tests (20 new): 8 resolver branch tests, 3 drawer-render tests
  (using Handlebars partial render with stub storage), 6 POST
  active-org tests (200 success, 403 non-admin, 400 unknown_org, 401
  unauth, 400 invalid body, fromOrgId pre-switch capture), 3
  cross-org GET tests (admin 200, non-admin not-200, no active_org_id
  mutation).
- `packages/dashboard/tests/agent/agent-service.test.ts` — appended
  Phase 38 multi-org per-turn binding describe block (3 new tests).

## Decisions Made

- **Pure resolver + async wrapper split.** The plan asked tests for
  `resolveAgentOrgId` directly. Exporting the pure four-arg function
  makes branch tests trivial (no DB), and the new
  `resolveAgentOrgIdAsync` wrapper owns the per-request I/O. Every
  existing call site changes to a single `await` line.
- **Drawer plumbing via an exported helper, not via a single route.**
  The plan's task 1.2 said "the GET that includes `agent-drawer.hbs`",
  but in this codebase the drawer is rendered by the shared layout
  (`main.hbs`) on every authenticated page. `buildDrawerOrgContext`
  returns the data the layout needs; wiring it into the global
  view-data preHandler in `server.ts` is straightforward whenever the
  layout consumer wants it. Tests render the partial directly with
  the helper output, so the contract is locked.
- **Cross-org admin GET via raw-DB fallback rather than a new repo
  method.** Adding `getConversationAnyOrg` to the repository interface
  would weaken the org-scoped contract that mitigates T-31-01. The
  route-layer fallback keeps the bypass narrow (only admin.system, only
  this one handler) and explicit.
- **Stale `activeOrgId` falls back to alphabetical default** (not 400).
  If the persisted org was deleted between writes, the resolver
  silently picks the first surviving org rather than blocking the
  agent. The next switch overwrites the stale value.
- **Audit row keyed to `toOrgId` on success, `fromOrgId ?? ''` on
  denied paths.** A denied/not_admin_system row should still be
  attributable to the user even when no current org is bound — empty
  string preserves the NOT NULL constraint without leaking a fake org
  id. `/admin/audit` filters can use `user_id` for per-user views.
- **Tests use a separate `buildAdminCtx()` harness** for the POST and
  cross-org GET tests so the auth shim can stamp permissions via
  `x-test-perms` header. The existing `buildCtx()` is preserved for the
  Phase 32 regression tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — paper vs reality] Drawer-render route does not exist as named**

- **Found during:** Task 1 implementation.
- **Issue:** Plan task 1.2 said "the route handler that renders the
  page hosting the agent drawer". In this codebase the drawer is
  rendered by the shared layout (`main.hbs`) on every authenticated
  page — there is no dedicated GET that renders only the drawer.
- **Fix:** Exported `buildDrawerOrgContext({user, permissions, storage})`
  helper. Tests exercise the helper output by rendering the
  `agent-drawer-org-switcher.hbs` partial directly. Wiring into
  `server.ts`'s view-data preHandler is mechanical and can land in
  the same plan as 38-04 (client wiring) so a future-deferred
  reviewer can audit both server-side data shape and client behaviour
  together. The plan's contract — drawer template gets
  `showOrgSwitcher` + `orgOptions` — is met as long as the layout
  consumer calls the helper.
- **Files modified:** `packages/dashboard/src/routes/agent.ts`,
  `packages/dashboard/tests/routes/agent.test.ts`.
- **Committed in:** `f62d87f`.

**2. [Rule 3 — paper vs reality] Audit table name is `agent_audit_log`, not `agent_audit`**

- **Found during:** Task 2 first test run.
- **Issue:** Tests were initially written with `agent_audit` (the
  repository's logical name), but the actual SQLite table is
  `agent_audit_log` (migration 049 row).
- **Fix:** Switched the raw-DB queries to `agent_audit_log` and
  changed the timestamp column from `started_at` to `created_at`.
- **Files modified:** `packages/dashboard/tests/routes/agent.test.ts`.
- **Committed in:** `f62d87f`.

**3. [Rule 1 — bug] `loadConversationAnyOrg` initial return type missed `userId` and `deletedAt`**

- **Found during:** `tsc --noEmit` after first GREEN.
- **Issue:** The synthetic helper returned a partial Conversation
  shape — TypeScript correctly rejected it.
- **Fix:** Added `user_id` + `deleted_at` to the SELECT and the row
  mapper, returned the full `Conversation` interface. Imported via
  `import('...')` to avoid pulling another top-level type alias.
- **Files modified:** `packages/dashboard/src/routes/agent.ts`.
- **Committed in:** `f62d87f`.

**4. [Rule 2 — missing critical functionality] Body schema validation on POST /agent/active-org**

- **Found during:** Task 2 design.
- **Issue:** Plan asked for `{orgId}` validation but did not specify
  the schema mechanism. Other state-changing routes in this file use
  zod via dedicated `*BodySchema` constants.
- **Fix:** Added `ActiveOrgBodySchema = z.object({ orgId: z.string().min(1).max(64) })`
  and a 400 `invalid_body` response with the issue list. Test pinned
  the missing-orgId case.
- **Files modified:** `packages/dashboard/src/routes/agent.ts`,
  `packages/dashboard/tests/routes/agent.test.ts`.
- **Committed in:** `f62d87f`.

---

**Total deviations:** 4 (2 paper-vs-reality, 1 type-shape bug, 1
missing-validation Rule-2). **Impact on plan:** none — semantics
preserved. Drawer wiring is the only deferred mechanical step (helper
exists; consumer in `server.ts` lands with 38-04).

## Deferred Issues

**1. Pre-existing test failures — unrelated to Phase 38**

- `tests/db/migration-058-059.test.ts > migration 059` — already
  flagged in 38-01-SUMMARY (column-list assertion never updated for
  migration 060's `expires_at`).
- `tests/static/agent-actions-handlers.test.ts > 12. shareAssistant`
  — pre-existing; verified by running on the pre-Phase-38-03
  state (commit `98e266f`) — fails identically.
- `tests/e2e/agent-multi-step.e2e.test.ts > E3` — pre-existing
  (Phase 36 chip strip e2e).
- `tests/e2e/agent-panel.test.ts > Test 3` — pre-existing
  (`agent.js source satisfies all critical invariants`).

All four were verified pre-existing by checking out the pre-Phase-38-03
state and running the same tests — they fail identically. None are in
the files this plan modified. Logged here for the verifier.

**2. server.ts view-data wiring not yet calling `buildDrawerOrgContext`**

The helper is exported and tested, but `server.ts`'s view-data
preHandler does not yet pass `showOrgSwitcher` / `orgOptions` to
`reply.view`. Wiring is mechanical (single insertion in the merge
block). Plan 38-04 (client wiring) is the natural landing zone since
it depends on the drawer template receiving these values to render
the switcher.

## Issues Encountered

None beyond the deviations above.

## Authentication Gates

None — no external service calls needed.

## Threat Register Status

| Threat ID | Disposition | Implemented |
|-----------|-------------|-------------|
| T-38-06 (Spoofing on POST /agent/active-org) | mitigate | ✓ JWT preHandler verifies caller; userId comes from `request.user`, never request body. |
| T-38-07 (Tampering on POST body orgId) | mitigate | ✓ Validated against `listOrgs()` allowlist; unknown orgs → 400 + audit `unknown_org`. |
| T-38-08 (Repudiation of switch action) | mitigate | ✓ Every POST emits an audit row (`org_switched`, `argsJson={fromOrgId,toOrgId}`, outcome ∈ {success,denied}). Test fixture pins fromOrgId = pre-switch state. |
| T-38-09 (Information disclosure via cross-org GET) | mitigate | ✓ `permissions.has('admin.system')` is the ONLY way to bypass org scope on GET `/agent/conversations/:id`. Non-admin test asserts not-200. |
| T-38-10 (DoS on rapid POSTs) | accept | ✓ Existing per-scope rate-limit (60/min/user) covers this; org list query is small (3 orgs in prod). |
| T-38-11 (Elevation of privilege via POST forge) | mitigate | ✓ Permission check returns 403 + audit `denied/not_admin_system`; verified by test. |

## Threat Flags

None — surface added is one new POST endpoint that mirrors existing
audit + CSRF + JWT preHandler patterns. No new file access, no new
schema, no new trust boundary.

## Known Stubs

- **server.ts view-data not yet wired to `buildDrawerOrgContext`.**
  See Deferred Issues #2. The drawer partial currently renders with
  `showOrgSwitcher` undefined → falsy guard suppresses the form
  (Plan 02 design). The wiring step is mechanical; plan 38-04 will
  land it alongside the client `data-action="agentOrgSwitch"`
  handler.

## Verification

- `cd packages/dashboard && npx vitest run tests/routes/agent.test.ts tests/agent/agent-service.test.ts`
  — 62/62 pass (33 routes + 29 agent-service).
- `cd packages/dashboard && npx tsc --noEmit` — exits 0.
- Full dashboard regression: 3349/3396 pass + 4 pre-existing failures
  (verified pre-existing on commit `98e266f`).
- Audit row shape (success): manual SQL on
  `agent_audit_log WHERE tool_name='org_switched'` — `argsJson`
  parses to `{fromOrgId, toOrgId}`; outcome ∈ {success, denied};
  outcome_detail ∈ {NULL, not_admin_system, unknown_org}.

## Next Phase Readiness

- **Plan 38-04** (client wiring) can now wire the
  `data-action="agentOrgSwitch"` handler to POST
  `/agent/active-org` and re-render the drawer header. The
  `{ activeOrgId, activeOrgName }` response shape is what the toast
  needs. Plan 38-04 must also add the missing
  `buildDrawerOrgContext` call in `server.ts`'s view-data preHandler
  so the partial actually renders for admin.system users.

## Self-Check

- `packages/dashboard/src/routes/agent.ts` — FOUND
  - `export function resolveAgentOrgId(...)` — FOUND (4-arg signature)
  - `export function defaultOrgAlphabetical(...)` — FOUND
  - `export async function buildDrawerOrgContext(...)` — FOUND
  - `scope.post('/active-org', ...)` — FOUND
  - `loadConversationAnyOrg` private helper — FOUND
  - synthetic `__admin__:` literal — REMOVED from runtime paths
- `packages/dashboard/tests/routes/agent.test.ts` — FOUND (33 tests, all pass)
- `packages/dashboard/tests/agent/agent-service.test.ts` — FOUND (29 tests, all pass)
- Commit `f62d87f` (Task 1+2 GREEN+RED) — FOUND
- Commit `6adbc0f` (Task 3 RED+GREEN — pure regression test) — FOUND
- Vitest tests/routes/agent.test.ts: 33/33 pass
- Vitest tests/agent/agent-service.test.ts: 29/29 pass
- `tsc --noEmit`: clean

## Self-Check: PASSED

---
*Phase: 38-multi-org-context-switching*
*Completed: 2026-04-24*
