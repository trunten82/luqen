---
phase: 29-service-mcp-tools
plan: 01
subsystem: api
tags: [mcp, branding, tools, zod, rbac, org-scoping]

# Dependency graph
requires:
  - phase: 28-mcp-foundation
    provides: "@luqen/core/mcp plugin, getCurrentToolContext, ToolMetadata, createMcpHttpPlugin, classification discipline, D-05/D-13 no-orgId-in-schema invariant"
  - phase: 28-mcp-foundation
    provides: "Empty createBrandingMcpServer stub at packages/branding/src/mcp/server.ts; registerMcpRoutes HTTP wiring at packages/branding/src/api/routes/mcp.ts"
provides:
  - "Branding MCP catalogue of 4 org-scoped tools: branding_list_guidelines, branding_get_guideline, branding_list_sites, branding_match"
  - "BRANDING_TOOL_METADATA export (4 entries, all requiredPermission='branding.view', none destructive)"
  - "createBrandingMcpServer({ db: SqliteAdapter }) factory signature (replaces empty stub)"
  - "registerMcpRoutes(app, { db }) signature (threads db to factory)"
  - "Runtime D-13 guard test iterating server._registeredTools over zod inputSchema shapes"
  - "Classification coverage test enforcing 4 org-scoped comments, 0 global, 0 TODO markers"
affects: [phase-30-dashboard-mcp, llm-mcp, brand-score-retrieval, agent-dashboard]

# Tech tracking
tech-stack:
  added: []  # No new libraries — reuses Phase 28 primitives
  patterns:
    - "Per-tool classification comment discipline applied to branding (all ORG-SCOPED variant)"
    - "Cross-org guard on single-record lookup tools (guideline.orgId !== ctx.orgId → 'not found')"
    - "Tool handler thinness — delegates to SqliteAdapter/BrandingMatcher; no business logic added"

key-files:
  created:
    - "packages/branding/src/mcp/metadata.ts (BRANDING_TOOL_METADATA — 4 entries)"
  modified:
    - "packages/branding/src/mcp/server.ts (empty stub → 4 registered tools + resolveOrgId helper)"
    - "packages/branding/src/api/routes/mcp.ts (accepts { db }, forwards to factory)"
    - "packages/branding/src/api/server.ts (single callsite updated: registerMcpRoutes(app, { db }))"
    - "packages/branding/tests/mcp/http.test.ts (3 → 6 tests, adds tool-list content, admin scope, D-13 runtime guard, classification coverage)"

key-decisions:
  - "Wired tools against SqliteAdapter (via `db`) not the in-memory GuidelineStore — PATTERNS.md example was wrong; REST uses db for parity, MCP must too"
  - "Every handler reads orgId via getCurrentToolContext() → resolveOrgId() → 'system' fallback; no handler accepts orgId from args (D-13)"
  - "Cross-org guard enforced on 3 tools (branding_get_guideline, branding_list_sites, branding_match); list tool relies on DB-layer filter via listGuidelines(orgId)"
  - "Moved classification docstring reference from literal '// orgId:' form into descriptive prose so regex /\\/\\/ orgId: ctx\\.orgId /g counts exactly 4 (1 per handler) without false positives"

patterns-established:
  - "ORG-SCOPED-only service MCP — contrasts with compliance (mixed global/org) and the LLM MCP target (all-global)"
  - "Factory-takes-{db} signature for service MCPs that back onto SqliteAdapter"

requirements-completed: [MCPT-02]

# Metrics
duration: 15min
completed: 2026-04-17
---

# Phase 29 Plan 01: Branding MCP Tool Catalogue Summary

**4 org-scoped branding MCP tools (list_guidelines, get_guideline, list_sites, match) with cross-org guards, D-13 runtime test, and classification coverage — mirrors the Phase 28 compliance template line-for-line**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-17T12:01:00Z
- **Completed:** 2026-04-17T12:07:00Z
- **Tasks:** 2 (Task 1: server+metadata+wiring; Task 2: integration tests)
- **Files modified:** 4 (1 created, 3 modified)
- **Tests:** 6/6 MCP tests pass; 78/78 full branding suite pass

## Accomplishments

- **4 tools registered** on `POST /api/v1/mcp` of the branding service: `branding_list_guidelines`, `branding_get_guideline`, `branding_list_sites`, `branding_match`
- **BRANDING_TOOL_METADATA populated** with 4 entries, all `requiredPermission: 'branding.view'`, none destructive — RBAC filter at the plugin layer now gates tool visibility
- **Factory signature upgraded** from `(_options: Record<string, never> = {})` to `(options: { db: SqliteAdapter })`, with `registerMcpRoutes(app, { db })` forwarding the adapter from `api/server.ts`
- **D-13 invariant enforced at runtime**: integration test iterates `server._registeredTools`, asserts no `orgId` key in any tool's zod inputSchema shape (plus JSON-serialisation belt-and-braces check)
- **Cross-org guards** applied on `branding_get_guideline`, `branding_list_sites`, and `branding_match` — a guideline whose `orgId !== ctx.orgId` is treated as "not found" so callers cannot probe foreign org IDs
- **Classification coverage test** proves exactly 4 `// orgId: ctx.orgId ` comments, zero `// orgId: N/A ` (branding is all-ORG-SCOPED), zero `TODO(phase-30)` markers, zero `console.log`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create BRANDING_TOOL_METADATA and upgrade createBrandingMcpServer** — `b66c902` (feat)
2. **Task 2: Extend branding MCP integration test suite** — `ca437db` (test)

## Files Created/Modified

- `packages/branding/src/mcp/metadata.ts` (NEW) — `BRANDING_TOOL_METADATA` with 4 ToolMetadata entries, all `branding.view`, none destructive
- `packages/branding/src/mcp/server.ts` (REWRITE) — empty stub → 4 registered tools, `resolveOrgId()` helper copied verbatim from compliance, classification comments on every handler, cross-org guards on 3 of 4 tools
- `packages/branding/src/api/routes/mcp.ts` (MODIFIED) — `registerMcpRoutes(app, opts: { db: SqliteAdapter })`; forwards `opts.db` to `createBrandingMcpServer`
- `packages/branding/src/api/server.ts` (MODIFIED) — single callsite updated: `await registerMcpRoutes(app, { db });`
- `packages/branding/tests/mcp/http.test.ts` (MODIFIED) — 3 → 6 tests; replaces empty-tools-list with content assertion; adds admin-scope fallback, D-13 runtime guard, and classification coverage

## Decisions Made

- **Store vs DbAdapter**: PATTERNS.md suggested `new GuidelineStore()`; the PLAN corrected this to `SqliteAdapter` (matches REST handlers in `api/server.ts` which use `db`). Kept parity with REST by using `db.listGuidelines`, `db.getGuideline`, `db.getSiteAssignments`, `db.getGuidelineForSite`.
- **Rewrote file-header docstring**: Initial header contained the literal string `'// orgId: ctx.orgId (org-scoped — ...)'` as documentation; this tripped the classification-count test by matching an extra time. Rephrased header to describe the pattern without using the literal regex target.
- **`resolveOrgId` helper**: Copied verbatim from `packages/compliance/src/mcp/server.ts` (lines 58-61) for consistency across services.
- **Admin-scope test pattern**: Used raw `signToken({ scopes: ['admin'] })` (as in the existing branding test harness) rather than importing shared `createTestApp`/`authHeader` helpers from compliance — the branding test file already has its own token-signing setup, minimising harness drift.

## Deviations from Plan

None — plan executed exactly as written. The one "correction" (DbAdapter vs GuidelineStore) was explicitly called out in the plan's `<interfaces>` block as the authoritative wiring, not a deviation.

## Issues Encountered

**Existing `returns 200 with empty tools list` test broke after Task 1 implementation** — expected behavior per the plan. The test was replaced in Task 2 with a content-assertion test that requires `names.length === 4` with all four expected names. This is the TDD GREEN→REPLACE flow the plan prescribes.

**Classification count false positive**: First draft of `server.ts` contained a JSDoc header line `* carries an explicit '// orgId: ctx.orgId (org-scoped — ...)' classification` — the regex `/\/\/ orgId: ctx\.orgId /g` matched it (5 total instead of 4). Resolved by rewriting the header to describe the pattern in prose instead of quoting the literal form. Count now exactly 4.

## D-13 Runtime Guard Outcome

`_registeredTools` exposed 4 entries after `createBrandingMcpServer({ db })` returned — the primary D-13 iteration assertion (`entries.length === 4`) succeeded on the first run, no Phase 28 fallback path was needed. Every entry's zod inputSchema shape was confirmed free of `orgId`. Belt-and-braces JSON serialization check also confirmed absence of the `"orgId"` substring across all 4 schemas.

## Divergence from PATTERNS.md

PATTERNS.md (lines 61-65, 81) showed `GuidelineStore` as the backing store. This was superseded by the plan's `<interfaces>` block which correctly identified `SqliteAdapter` (via `db`) as the authoritative target. Implementation followed the plan, not PATTERNS.md. No other divergences.

## Regressions

None — the full `npx vitest run` across the branding package reports 78/78 tests passing across 11 files, including the pre-existing matcher, parser, store, api, and auth test suites.

## Next Phase Readiness

- `branding.view` permission already defined in `packages/dashboard/src/permissions.ts`; no dashboard change required.
- Phase 29 plan 02 (LLM MCP tools) can proceed independently — it applies the same template to `packages/llm/src/mcp/server.ts` with all-GLOBAL classification (D-06).
- Phase 30 (Dashboard MCP) can reference this summary's `provides:` list when deciding where brand-score and scan-report tools belong (answer: Phase 30, per D-02 / D-04).

## Self-Check: PASSED

Verified that all claimed artifacts exist and commits are present:

- `FOUND: packages/branding/src/mcp/metadata.ts`
- `FOUND: packages/branding/src/mcp/server.ts` (4 registerTool calls, 4 classification comments, 3 cross-org guards)
- `FOUND: packages/branding/src/api/routes/mcp.ts` (accepts { db })
- `FOUND: packages/branding/src/api/server.ts` (callsite updated)
- `FOUND: packages/branding/tests/mcp/http.test.ts` (6 tests, includes D-13 runtime guard, classification coverage, admin-scope)
- `FOUND commit: b66c902` (Task 1: feat — register 4 tools)
- `FOUND commit: ca437db` (Task 2: test — expand integration suite)
- `PASS: npx tsc --noEmit` (typecheck clean)
- `PASS: npx vitest run tests/mcp/http.test.ts` (6/6 MCP tests)
- `PASS: npx vitest run` (78/78 full branding suite)

---
*Phase: 29-service-mcp-tools*
*Completed: 2026-04-17*
