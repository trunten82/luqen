---
phase: 10-css-import-org-api-keys
plan: "03"
subsystem: dashboard/auth
tags: [api-keys, org-scoping, ui, security, i18n]
dependency_graph:
  requires:
    - phase: 10-02
      provides: org-scoped-api-key-auth, API_KEY_RATE_LIMITS constant, ApiKeyRecord with orgId/role
  provides:
    - org-scoped-api-key-management-ui
    - revokeKey-org-id-guard
    - org-api-keys-sidebar-nav
  affects: [packages/dashboard/src/routes/admin, packages/dashboard/src/views, packages/dashboard/src/db]
tech-stack:
  added: []
  patterns: [org-scoped-route-guard, db-level-org-isolation]
key-files:
  created:
    - packages/dashboard/src/routes/admin/org-api-keys.ts
    - packages/dashboard/src/views/admin/org-api-keys.hbs
    - packages/dashboard/src/views/admin/org-api-key-form.hbs
  modified:
    - packages/dashboard/src/db/interfaces/api-key-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/api-key-repository.ts
    - packages/dashboard/src/server.ts
    - packages/dashboard/src/views/partials/sidebar.hbs
    - packages/dashboard/src/i18n/locales/en.json
key-decisions:
  - "revokeKey orgId guard: AND org_id = ? at SQL level when orgId provided — org admins cannot revoke other orgs' keys by UUID guessing"
  - "Org API key form uses dedicated org-api-key-form.hbs (not shared api-key-form.hbs) to post to /admin/org-api-keys endpoint"
  - "Rate limit column in template uses server-side computed rateLimit field from API_KEY_RATE_LIMITS[role]"
patterns-established:
  - "Org-scoped routes: always check currentOrgId at route handler start, redirect/400 if missing"
  - "DB-level isolation: revokeKey(id, orgId) passes orgId as WHERE clause to prevent cross-org writes"
requirements-completed:
  - OAK-04
duration: 12min
completed: 2026-04-06
---

# Phase 10 Plan 03: Org API Key Management UI Summary

**Org admins can self-service create/revoke API keys scoped to their org, with rate limit tier display and DB-level org_id revocation guard preventing cross-org UUID guessing.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-06T11:10:00Z
- **Completed:** 2026-04-06T11:22:00Z
- **Tasks:** 2 (+ 1 auto-approved checkpoint)
- **Files modified:** 8

## Accomplishments

- `revokeKey(id, orgId?)` hardened: passes `AND org_id = ?` SQL guard when orgId provided — cross-org revocation by UUID guessing is impossible
- `orgApiKeyRoutes` registered: list, create, revoke — all scoped to `currentOrgId` with `requirePermission('admin.org')`
- Rate limit tier column shows 200/100/50 req/min per admin/read-only/scan-only role respectively
- Sidebar nav shows "Org API Keys" only when user has org context (`orgContext.currentOrg` truthy)

## Task Commits

1. **Task 1: Harden revokeKey with org_id guard and create org API key routes** - `98c59f7` (feat)
2. **Task 2: Create org API keys template and sidebar nav entry** - `9717737` (feat)

## Files Created/Modified

- `packages/dashboard/src/db/interfaces/api-key-repository.ts` - `revokeKey(id, orgId?)` signature updated
- `packages/dashboard/src/db/sqlite/repositories/api-key-repository.ts` - revokeKey implementation with `AND org_id = ?` guard
- `packages/dashboard/src/routes/admin/org-api-keys.ts` - CRUD routes for org-scoped API key management
- `packages/dashboard/src/views/admin/org-api-keys.hbs` - Page template with rate limit column
- `packages/dashboard/src/views/admin/org-api-key-form.hbs` - Create modal with role/rate-limit display
- `packages/dashboard/src/server.ts` - Dynamic import and registration of `orgApiKeyRoutes`
- `packages/dashboard/src/views/partials/sidebar.hbs` - "Org API Keys" nav link under Users & Access
- `packages/dashboard/src/i18n/locales/en.json` - `admin.orgApiKeys.*`, `nav.orgApiKeys`, `common.revoke`

## Decisions Made

- revokeKey orgId guard at SQL level — passing orgId to route then down to DB prevents cross-org revocation
- Dedicated `org-api-key-form.hbs` rather than reusing `api-key-form.hbs` — different POST target, no orgId field needed (comes from session)
- Rate limit tier computed server-side using `API_KEY_RATE_LIMITS[role]` and stored in the view model as `rateLimit`

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None — all features are wired to the database.

## Next Phase Readiness

- OAK-04 complete: org admins can self-service manage API keys
- Phase 10 all plans complete: CSS import (10-01) + org API key auth (10-02) + org API key UI (10-03)
- Ready for E2E/verification phase

---
*Phase: 10-css-import-org-api-keys*
*Completed: 2026-04-06*
