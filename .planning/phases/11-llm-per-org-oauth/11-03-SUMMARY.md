---
phase: 11-llm-per-org-oauth
plan: "03"
subsystem: dashboard
tags: [llm, oauth, cli, backfill, organizations]

dependency_graph:
  requires:
    - phase: 11-01
      provides: createLLMOrgClient, getOrgLLMCredentials, updateOrgLLMClient
  provides:
    - backfill-llm-clients CLI command for manual per-org LLM OAuth provisioning
    - server startup backfill for automatic per-org LLM OAuth provisioning
  affects: [dashboard-startup, cli-tooling, org-isolation]

tech-stack:
  added: []
  patterns: [best-effort-backfill, getLLMClient-getToken-pattern]

key-files:
  created: []
  modified:
    - packages/dashboard/src/cli.ts
    - packages/dashboard/src/server.ts

key-decisions:
  - "Use getLLMClient().getToken() in server startup backfill — consistent with how LLMClient wraps its own token manager; no need for a separate ServiceTokenManager in the registry"
  - "Use dynamic import of ServiceTokenManager in CLI backfill command — follows existing CLI pattern of dynamic imports to keep startup fast"

patterns-established:
  - "LLM token for provisioning: obtain via getLLMClient().getToken() in server context, or new ServiceTokenManager(config.llmUrl, ...) in CLI context"

requirements-completed: [LLM-04]

duration: 8min
completed: 2026-04-06
---

# Phase 11 Plan 03: CLI Backfill + Server Startup Backfill for LLM Clients Summary

**`backfill-llm-clients` CLI command and server startup loop that provision per-org LLM OAuth clients for existing organizations, completing org isolation parity with compliance and branding**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-06T12:00:00Z
- **Completed:** 2026-04-06T12:07:55Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- CLI command `backfill-llm-clients` iterates all orgs, skips those with existing LLM credentials, creates per-org OAuth clients, and reports created/skipped/failed counts
- Server startup backfill loop extended with LLM block alongside compliance and branding — uses `getLLMClient().getToken()` for the admin token
- Both paths follow the established best-effort pattern: individual org failures are logged as warnings and never abort the loop/startup

## Task Commits

Each task was committed atomically:

1. **Task 1: CLI backfill-llm-clients command** - `68d25b4` (feat)
2. **Task 2: Add LLM to server startup backfill loop** - `c4dbda2` (feat)

## Files Created/Modified
- `packages/dashboard/src/cli.ts` - Added `backfill-llm-clients` command before `program.parse()`
- `packages/dashboard/src/server.ts` - Added `createLLMOrgClient` import + LLM block in startup backfill

## Decisions Made
- Used `getLLMClient().getToken()` in server.ts rather than building a temporary `ServiceTokenManager` from config — the `LLMClient` instance already manages token refresh internally and exposing `getToken()` was added in Plan 11-01 precisely for this use case
- CLI uses dynamic `import('./auth/service-token.js')` following the existing pattern for fast CLI startup

## Deviations from Plan

### Pre-execution: Cherry-picked Plan 11-01 task commits

- **Found during:** Worktree initialization
- **Issue:** The worktree branch (`worktree-agent-af888ca8`) was behind master and missing the Plan 11-01 task commits (`af1cfba`, `bce15de`) that added `createLLMOrgClient` and the data layer methods. The master branch only had the docs commit from 11-01; the task commits were on a different worktree branch.
- **Fix:** Merged master (fast-forward), then cherry-picked the two task commits from `worktree-agent-ab629079` before proceeding.
- **Impact:** No scope change — this was a setup deviation, not a plan deviation.

No other deviations — plan executed as written after setup.

## Issues Encountered
- Worktree was created before Plan 11-01 task commits were merged to master — required cherry-picking the prerequisite commits before starting plan execution.

## User Setup Required
None - no external service configuration required. The `backfill-llm-clients` CLI command requires a running LLM service and valid `llmUrl`/`llmClientId`/`llmClientSecret` in the config.

## Next Phase Readiness
- Phase 11 is complete: DB columns (11-01), org-routing middleware (11-02), and backfill paths (11-03) are all in place
- All three backfill paths (compliance, branding, LLM) are now consistent
- Ready for final merge to master

## Known Stubs

None — all data flows are wired end-to-end.

---
*Phase: 11-llm-per-org-oauth*
*Completed: 2026-04-06*

## Self-Check: PASSED

- FOUND: packages/dashboard/src/cli.ts
- FOUND: packages/dashboard/src/server.ts
- FOUND: 11-03-SUMMARY.md
- FOUND: commit 68d25b4 (CLI backfill command)
- FOUND: commit c4dbda2 (server startup backfill)
