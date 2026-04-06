---
phase: 11-llm-per-org-oauth
plan: "01"
subsystem: dashboard
tags: [llm, oauth, organizations, migration, database]
dependency_graph:
  requires: []
  provides: [llm-per-org-columns, createLLMOrgClient, org-creation-hook]
  affects: [organizations, llm-client, service-client-registry]
tech_stack:
  added: []
  patterns: [per-org-oauth-client-provisioning, best-effort-service-client-creation]
key_files:
  created: []
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
    - packages/dashboard/src/db/types.ts
    - packages/dashboard/src/db/interfaces/org-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/org-repository.ts
    - packages/dashboard/src/llm-client.ts
    - packages/dashboard/src/routes/admin/organizations.ts
    - packages/dashboard/src/server.ts
decisions:
  - "Expose getToken() and baseUrl getter on LLMClient rather than adding a separate llmTokenManager to ServiceClientRegistry — avoids duplicating the token refresh lifecycle"
  - "Pass getLLMClient getter to organizationRoutes following the same getter-per-request pattern used for brandingTokenManager"
metrics:
  duration: "8m"
  completed_date: "2026-04-06"
  tasks: 2
  files: 7
---

# Phase 11 Plan 01: LLM Per-Org DB Columns + Provisioning Hook Summary

Migration 041 + per-org LLM OAuth client auto-creation on org creation following the compliance/branding pattern.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Migration, types, repository for LLM per-org columns | 904d584 | migrations.ts, types.ts, org-repository interface + sqlite impl |
| 2 | createLLMOrgClient function + org creation hook | 2daaafd | llm-client.ts, organizations.ts, server.ts |

## What Was Built

**Task 1 — Data layer:**
- Migration 041 (`add-llm-client-to-orgs`): adds `llm_client_id TEXT` and `llm_client_secret TEXT` columns to the organizations table
- `Organization` interface in `db/types.ts` gains `readonly llmClientId?: string` and `readonly llmClientSecret?: string`
- `OrgRepository` interface gains `getOrgLLMCredentials()` and `updateOrgLLMClient()` methods
- `SqliteOrgRepository` implements both methods and maps `llm_client_id`/`llm_client_secret` through `rowToOrg()`

**Task 2 — Provisioning:**
- `LLMClient` gains `getToken()` (proxies internal token manager) and `baseUrl` getter (exposes normalized base URL) — both needed for standalone provisioning without a separate token manager
- `createLLMOrgClient(llmUrl, adminToken, orgId, orgSlug)` standalone function added to `llm-client.ts` — follows `createBrandingOrgClient` pattern exactly; creates `dashboard-{slug}` client with `read`/`write` scopes and `client_credentials` grant
- `organizationRoutes()` gains optional `getLLMClient` getter parameter (defaults to `() => null`)
- Org creation handler auto-creates LLM OAuth client after branding client provisioning; failure is best-effort (logged warning, never blocks org creation)
- `server.ts` passes `getLLMClient` to `organizationRoutes`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] LLM token manager not accessible from organizations.ts**

- **Found during:** Task 2
- **Issue:** The plan called for `llmTokenManager.getToken()` but unlike compliance/branding, the LLM service has no standalone `ServiceTokenManager` in the registry — only `LLMClient` (which wraps its own private token manager). Passing a raw URL and token manager would require adding a new field to `ServiceClientRegistry`.
- **Fix:** Added `getToken()` and `baseUrl` public accessors to `LLMClient`, then passed the `getLLMClient` getter (already available in server.ts) to `organizationRoutes`. This avoids duplicating the token refresh lifecycle.
- **Files modified:** `packages/dashboard/src/llm-client.ts`
- **Commit:** 2daaafd

## Known Stubs

None — all data flows are wired. The `llm_client_id`/`llm_client_secret` columns are populated on new org creation when the LLM service is configured.

## Self-Check: PASSED
