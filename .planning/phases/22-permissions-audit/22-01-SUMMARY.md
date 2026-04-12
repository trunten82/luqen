---
phase: 22-permissions-audit
plan: 01
subsystem: auth
tags: [permissions, rbac, tenant-isolation, branding]

requires:
  - phase: 19-branding-pipeline
    provides: branding-mode routes (GET/POST branding-mode, POST branding-test)
  - phase: 08-org-management
    provides: dual-permission pattern (admin.system + admin.org) on member routes
provides:
  - admin.org users can manage branding-mode for their own organization
  - tenant isolation guards on all 3 branding routes
  - permission matrix test suite proving BPERM-01/02/03
affects: [branding-pipeline, org-management, permissions]

tech-stack:
  added: []
  patterns: [tenant-isolation-guard-on-branding-routes]

key-files:
  created:
    - packages/dashboard/tests/routes/organizations-branding-mode-permissions.test.ts
  modified:
    - packages/dashboard/src/routes/admin/organizations.ts

key-decisions:
  - "Reused existing v2.8.0 tenant isolation pattern (request.user.currentOrgId !== id) for branding routes"
  - "branding-test route asserts not-403 rather than 200 because brandingOrchestrator is not decorated in test"

patterns-established:
  - "freshStorage() + buildServer() test pattern: create org first to learn UUID, then build server with matching currentOrgId"

requirements-completed: [BPERM-01, BPERM-02, BPERM-03]

duration: 5min
completed: 2026-04-12
---

# Phase 22 Plan 01: Branding Route Permission Audit Summary

**Migrated 3 branding routes to dual admin.system/admin.org permission with tenant isolation, plus 13 permission matrix tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-12T11:05:59Z
- **Completed:** 2026-04-12T11:10:59Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Changed 3 branding routes (GET/POST branding-mode, POST branding-test) from `requirePermission('admin.system')` to `requirePermission('admin.system', 'admin.org')`
- Added tenant isolation guard to each route: non-admin users scoped to their own org via `request.user.currentOrgId`
- System-wide routes (list/create/delete org at lines 48/64/73/167) remain admin.system only
- 13 permission matrix tests covering all 3 BPERM requirements plus regression for full admin

## Task Commits

Each task was committed atomically:

1. **Task 1: Add admin.org permission + tenant isolation to branding routes** - `b5618b2` (feat)
2. **Task 2: Full regression -- existing test suites + lint** - verification only, no code changes

## Files Created/Modified
- `packages/dashboard/src/routes/admin/organizations.ts` - 3 branding routes now accept admin.org, plus tenant isolation guards
- `packages/dashboard/tests/routes/organizations-branding-mode-permissions.test.ts` - 13 permission matrix tests (NEW)

## Decisions Made
- Reused the existing v2.8.0 member management tenant isolation pattern for consistency
- branding-test endpoint test asserts `not 403` instead of `200` because `server.brandingOrchestrator` is not decorated in test context (500 = permission passed, handler ran)
- Used `freshStorage() + buildServer()` pattern to solve the UUID-matching problem for tenant isolation tests

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Permission audit complete for branding routes
- All organization routes now have correct permission gates
- Pattern established for future permission audits on other route groups

---
*Phase: 22-permissions-audit*
*Completed: 2026-04-12*
