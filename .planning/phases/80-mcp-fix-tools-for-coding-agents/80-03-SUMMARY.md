---
phase: 80-mcp-fix-tools-for-coding-agents
plan: "03"
subsystem: dashboard-mcp
tags: [mcp, rbac, llm, scan, fix, auth, security]
dependency_graph:
  requires: ["80-02"]
  provides: ["dashboard_scan_page live on MCP endpoint", "dashboard_generate_fix live on MCP endpoint"]
  affects: ["packages/dashboard/src/mcp", "packages/dashboard/src/routes/api/mcp.ts", "packages/dashboard/src/server.ts"]
tech_stack:
  added: []
  patterns: ["per-call LlmAccess callback (mirrors ComplianceAccess)", "conditional tool registration with toolNames parity", "DirectScanner injection from server.ts lifecycle"]
key_files:
  created: []
  modified:
    - packages/dashboard/src/mcp/metadata.ts
    - packages/dashboard/src/mcp/server.ts
    - packages/dashboard/src/routes/api/mcp.ts
    - packages/dashboard/src/server.ts
    - packages/dashboard/tests/mcp/scan-fix-tools.test.ts
    - packages/dashboard/tests/mcp/tool-metadata-drift.test.ts
decisions:
  - "scan tool registered unconditionally when scanner provided (always in production); fix tool registered only when llmAccess provided — mirrors registerComplianceTools guard"
  - "toolNames uses spread conditionals so count parity matches actual registration in both branches"
  - "llmAccess resolves getLLMClient() per call (no cached secret) so admin rotations propagate without restart"
  - "DirectScanner instantiated once per server lifecycle in server.ts (stateless; pa11y pa11y)"
  - "Neither tool has destructive:true — D-09 never-apply guarantee"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-07T19:40:00Z"
  tasks_completed: 3
  files_modified: 6
---

# Phase 80 Plan 03: Wire Scan + Fix Agent Tools into Dashboard MCP Server Summary

Dashboard MCP server now exposes `dashboard_scan_page` (gated by `scans.create`) and `dashboard_generate_fix` (gated by `issues.fix`) behind the existing OAuth2 JWT + `mcp.use` + per-tool RBAC stack, with full e2e auth/RBAC/never-apply test coverage.

## What Was Built

**Task 1 — metadata.ts + server.ts registration (commit b1bd72ec)**

- Added `DASHBOARD_AGENT_TOOL_METADATA` to `metadata.ts` with two entries: `dashboard_scan_page → scans.create` and `dashboard_generate_fix → issues.fix`. Neither has `destructive: true` (D-09).
- Spread `DASHBOARD_AGENT_TOOL_METADATA` into `DASHBOARD_TOOL_METADATA`.
- `permissions.ts` was NOT edited — both permission ids already existed.
- Added `scanner?` and `llmAccess?` to `DashboardMcpServerOptions`.
- Imported `registerScanTools/SCAN_TOOL_NAMES` from `tools/scan.ts` and `registerFixTools/FIX_TOOL_NAMES/LlmAccess` from `tools/fix.ts`.
- Scan tool registered when `scanner` provided; fix tool registered when `llmAccess` provided (mirrors `registerComplianceTools` guard).
- `toolNames` uses spread conditionals for parity with what is actually registered; keeps the drift test green in both branches.
- Updated drift test stub to pass `scanner` + `llmAccess` stubs so both new tools are counted in invariant 5.

**Task 2 — routes/api/mcp.ts + server.ts wiring (commit 66875257)**

- Added `LlmAccess` type re-export from `mcp/server.ts`.
- Added `llmAccess?`, `scanner?`, and `LlmAccess` import to `McpRouteOptions`.
- `registerMcpRoutes` passes both through to `createDashboardMcpServer`.
- `server.ts`: imported `DirectScanner` from `@luqen/core`.
- Built `mcpLlmAccess`: resolves `getLLMClient()` per call → `llmClient.getToken()` → `{ baseUrl, token }` or `null`; secret rotations propagate without restart.
- Instantiated `mcpDirectScanner = new DirectScanner()` once per server lifecycle.
- Passed both into `registerMcpRoutes` alongside existing `mcpComplianceAccess`.
- `mcp.use` connection gate and JWT verification path unchanged.

**Task 3 — e2e integration tests + drift fix (commit 37a2e186)**

- Appended full integration `describe` blocks to `scan-fix-tools.test.ts`.
- **RBAC tools/list filtering**: caller without `scans.create` doesn't see `dashboard_scan_page`; caller without `issues.fix` doesn't see `dashboard_generate_fix`; caller with both sees both (MCPFIX-05).
- **tools/call runtime guard**: calling `dashboard_generate_fix` without `issues.fix` returns rejection; calling `dashboard_scan_page` without `scans.create` rejected (MCPFIX-05 http-plugin guard).
- **Unauthenticated 401**: request without `Authorization` header returns 401 (T-80-12, mcp.use gate unchanged).
- **Authorized happy path**: authorized caller gets structured scan findings (MCPFIX-01); fix response contains `wcagCriterion + diff + fixedHtml + explanation + effort + legalContext + disclaimer === DRAFT_DISCLAIMER` (MCPFIX-02..04 + D-10).
- **legalContext degrade**: `complianceAccess = null` → `legalContext: null`, `isError` not set (D-06 graceful).
- **Never-apply**: `DASHBOARD_AGENT_TOOL_METADATA` entries assert no `destructive: true` (D-09).

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met in order.

## Verification

- `npx tsc -p packages/dashboard/tsconfig.json --noEmit`: clean (no output)
- `npx vitest run packages/dashboard/tests/mcp/scan-fix-tools.test.ts packages/dashboard/tests/mcp/tool-metadata-drift.test.ts`: 42 tests pass across 4 test files
- `git diff --quiet packages/dashboard/src/permissions.ts`: exits 0 (unchanged)
- Grep over scan.ts/fix.ts: `destructive` only appears in comments (`Non-destructive`) and `{ destructiveHint: false }` — no `destructive: true`, no `writeFile`, no `initiateScan`, no `applyFix`, no `.write(` calls

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns beyond what was planned. The LLM service HTTP access follows the existing `ComplianceAccess` pattern exactly (same callback contract, same nullable-graceful-degrade). No new trust boundary introduced.

## Known Stubs

None — both tools are fully wired. `dashboard_scan_page` uses a real `DirectScanner` in production; `dashboard_generate_fix` calls the live LLM service endpoint. Tests use controlled stubs but the production code paths are complete.

## Self-Check

- [x] `packages/dashboard/src/mcp/metadata.ts` modified: FOUND
- [x] `packages/dashboard/src/mcp/server.ts` modified: FOUND
- [x] `packages/dashboard/src/routes/api/mcp.ts` modified: FOUND
- [x] `packages/dashboard/src/server.ts` modified: FOUND
- [x] `packages/dashboard/tests/mcp/scan-fix-tools.test.ts` modified: FOUND
- [x] `packages/dashboard/tests/mcp/tool-metadata-drift.test.ts` modified: FOUND
- [x] Commit b1bd72ec: FOUND
- [x] Commit 66875257: FOUND
- [x] Commit 37a2e186: FOUND

## Self-Check: PASSED
