---
phase: 30-dashboard-mcp-external-clients
plan: 04
subsystem: packages/dashboard/src/mcp
tags: [mcp, dashboard, resources, rbac, mcpi-05, sdk-1.27.1]

# Dependency graph
requires:
  - phase: 28-mcp-foundation
    provides: createMcpHttpPlugin factory, Bearer-only preHandler, ToolContext ALS
  - phase: 30-01
    provides: ResourceMetadata interface, filterResourcesByPermissions/Scope, ListResourcesRequestSchema + ReadResourceRequestSchema overrides on createMcpHttpPlugin
  - phase: 30-02
    provides: registerResources stub + DASHBOARD_RESOURCE_METADATA hook + resourceMetadata threading through createMcpHttpPlugin in routes/api/mcp.ts
provides:
  - "Two ResourceTemplates registered on the dashboard MCP: scan://report/{id} and brand://score/{siteUrl}"
  - "DASHBOARD_RESOURCE_METADATA populated with 2 entries (scan→reports.view, brand→branding.view) consumed by the 30-01 RBAC override"
  - "JSON content envelopes (mimeType: 'application/json') for both resource families per D-11"
  - "URL-encoded siteUrl on brand:// list, decoded on read (D-09)"
  - "Cross-org guard on scan:// readCallback (scan.orgId match)"
  - "D-17 invariant extended to resources — no template variable named orgId"
affects: [30-06-external-client-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ResourceTemplate({list: async () => ({resources: [...]})}) — SDK 1.27.1 list-callback pattern; required (even if undefined per the SDK signature)"
    - "Per-handler resolveOrgId() helper colocated in resources.ts (mirror of tools/data.ts) — keeps resources file self-contained"
    - "Read-callback envelope: {contents: [{uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(payload, null, 2)}]} — exact shape the SDK setReadResourceRequestHandlers expects"
    - "URL-encoded segment in brand://score/{siteUrl} so '/', '?', '#' survive in the path; decoded once with decodeURIComponent before repository lookup"
    - "ResourceMetadata re-export from resources.ts as a type alias of @luqen/core/mcp.ResourceMetadata — preserves the symbol that 30-02 callers imported during the stub period"

key-files:
  created:
    - packages/dashboard/tests/mcp/resources.test.ts
  modified:
    - packages/dashboard/src/mcp/resources.ts

key-decisions:
  - "Status literal is 'completed' (not 'complete' as written in the plan draft) — matches ScanRecord.status enum value; same Rule 1 carry-over fix as 30-02"
  - "The 'no perms' resources/list test asserts 2 entries (not 0 as the plan drafted) because the @luqen/core/mcp 30-01 override falls back to scope-based filtering when ctx.permissions is empty, and the route's coarse scope gate requires 'read' — so a truly empty case (no perms AND no scopes) cannot reach resources/list at all"
  - "ResourceMetadata is re-exported as a type alias (rather than removed) so any external code that imported it from this module during the 30-02 stub window keeps compiling — the alias resolves to @luqen/core/mcp's canonical type"
  - "brand:// readCallback uses storage.brandScores.getHistoryForSite(orgId, siteUrl, 1) instead of a dedicated getLatestForSite — the existing repo method already filters by orgId at the SQL layer (cross-org rows are invisible) and returns rows ordered DESC, so [0] is the latest"
  - "scan:// list uses storage.scans.listScans({orgId, status: 'completed', limit: 50}) — the repo orders by created_at DESC; strict completed_at-DESC ordering would require a new repo method and is deferred (documented inline)"

patterns-established:
  - "Resources file owns its own resolveOrgId() helper rather than importing from tools/data.ts — preserves the modular boundary that lets 30-03/04/05 develop in parallel"
  - "SDK private-field access: server._registeredResourceTemplates is the SDK 1.27.1 internal that the D-17 guard test reads to enumerate URI templates without invoking them — same pattern that the 30-01 http-plugin uses"
  - "Test scaffolding inlined per file (makeStubStorage / makeStubScanService / buildAppWithResources) rather than imported from data-tools.test.ts — keeps Wave 2 plans diff-isolated"

requirements-completed:
  - MCPI-05

# Metrics
duration: ~5 min
completed: 2026-04-18
---

# Phase 30 Plan 04: Dashboard MCP Resources Summary

**Two URI-addressable ResourceTemplates registered on the dashboard MCP server (`scan://report/{id}` + `brand://score/{siteUrl}`), each gated by the @luqen/core/mcp Resources RBAC override delivered by Wave 1 plan 30-01, completing MCPI-05.**

## Performance

- **Duration:** ~5 min (started 2026-04-18T08:01:32Z, final commit 08:07:08Z)
- **Tasks:** 2 (both TDD-tagged, both green on first verification pass after one Rule 1 test fix)
- **Files created:** 1 (`tests/mcp/resources.test.ts`)
- **Files modified:** 1 (`src/mcp/resources.ts` — replaced 30-02 stub)

## What Shipped

### 1. Two ResourceTemplate registrations (`packages/dashboard/src/mcp/resources.ts`)

| Resource | URI Template | List scope | Read envelope | Permission |
|----------|--------------|------------|---------------|------------|
| `scan-report` | `scan://report/{id}` | last 50 completed scans for caller's org | `{contents: [{mimeType: 'application/json', text: JSON.stringify({scan, report}, null, 2)}]}` | `reports.view` |
| `brand-score` | `brand://score/{siteUrl}` | latest brand score per site (typically <50 sites/org) | `{contents: [{mimeType: 'application/json', text: JSON.stringify({siteUrl, computedAt, score}, null, 2)}]}` | `branding.view` |

Both templates declare `list` callbacks (REQUIRED per the SDK 1.27.1 `ResourceTemplate({list})` constructor signature — even when `undefined` would be permitted, both populate it for D-10 list scope). Both readCallbacks return JSON content per D-11.

### 2. `DASHBOARD_RESOURCE_METADATA` populated

```typescript
export const DASHBOARD_RESOURCE_METADATA: readonly LuqenResourceMetadata[] = [
  { uriScheme: 'scan',  requiredPermission: 'reports.view' },
  { uriScheme: 'brand', requiredPermission: 'branding.view' },
];
```

This is consumed by `createMcpHttpPlugin` (via `routes/api/mcp.ts`'s already-threaded `resourceMetadata: DASHBOARD_RESOURCE_METADATA`). Plan 30-01's `ListResourcesRequestSchema` override calls `filterResourcesByPermissions` against this metadata; plan 30-01's `ReadResourceRequestSchema` override re-checks the gate on every read and throws `McpError(InvalidParams, 'Forbidden')` on scheme denial. No additional plumbing was needed in plan 30-04.

### 3. `ResourceMetadata` type re-export

`packages/dashboard/src/mcp/resources.ts` re-exports `ResourceMetadata` as an alias of `@luqen/core/mcp.ResourceMetadata`. This preserves the symbol any 30-02-era importer might depend on while collapsing the type to the single source of truth in `@luqen/core/mcp`.

### 4. Cross-org guards

- **scan://report/{id}**: `await storage.scans.getScan(id)`; if `scan === null || scan.orgId !== orgId`, throws `Error("Resource ${uri} not found")`. Indistinguishable from a genuinely missing resource — no existence leak (T-30-04-03).
- **brand://score/{siteUrl}**: `storage.brandScores.getHistoryForSite(orgId, siteUrl, 1)` — the repository's SQL filter already enforces org_id, so cross-org rows are invisible. Empty history → throws `Error("Resource ${uri} not found")` (T-30-04-04).

### 5. URL-encoding round-trip (D-09)

- **List**: `uri: \`brand://score/${encodeURIComponent(scan.siteUrl)}\`` — '/' '?' '#' survive in the path segment.
- **Read**: `decodeURIComponent(variables['siteUrl'] as string)` before passing to the repository.
- **Test C4** captures `getHistoryForSite`'s `siteUrl` argument and asserts it matches the original `'https://example.com'` — proving the round-trip works end-to-end through the SDK's URI template match.

### 6. D-17 extended to resources

`packages/dashboard/tests/mcp/resources.test.ts > Group D` iterates `server._registeredResourceTemplates` and asserts no URI template's `.toString()` contains `{orgId}`. Two templates are registered (`scan-report`, `brand-score`); both contain only the variables `{id}` and `{siteUrl}` respectively. Same pattern as the data-tools D-17 runtime guard.

## Test Surface

10 new integration tests, organised into four describe blocks:

| Group | Test | Purpose |
|-------|------|---------|
| A — Metadata shape | A1 | `DASHBOARD_RESOURCE_METADATA.length === 2`; correct schemes + perms |
| B — `resources/list` RBAC | B1 | `reports.view` only → 2 `scan://` entries, 0 `brand://` |
| B — `resources/list` RBAC | B2 | `branding.view` only → 2 `brand://` entries, 0 `scan://` |
| B — `resources/list` RBAC | B3 | Both perms → 2 entries (one of each family) |
| B — `resources/list` RBAC | B4 | No perms + read scope → 2 entries (scope-fallback documents real behavior) |
| C — `resources/read` gating | C1 | `reports.view` reads `scan://report/abc` → JSON content with `payload.scan.id === 'abc'` |
| C — `resources/read` gating | C2 | Wrong perm reads `scan://report/abc` → JSON-RPC error with `message: 'Forbidden'` |
| C — `resources/read` gating | C3 | Cross-org `scan.orgId === 'other-org'` → JSON-RPC error matching `/not found/i` |
| C — `resources/read` gating | C4 | `brand://score/https%3A%2F%2Fexample.com` → captured `siteUrl === 'https://example.com'` |
| D — D-17 guard | D1 | Iterate `_registeredResourceTemplates`; no template contains `{orgId}` |

All 10 pass on first verification run after the one Rule 1 fix described below.

## SDK 1.27.1 Nuances Discovered

1. **`ResourceTemplate` `list` callback is REQUIRED** even when an empty list is acceptable — the constructor signature `{list: ListResourcesCallback | undefined}` accepts `undefined` but both Phase 30 templates populate it because D-10 list scope is non-empty.

2. **`registerResource(name, ResourceTemplate, ResourceMetadata, readCallback)`** — the third positional argument is the SDK's OWN `ResourceMetadata` type (`Omit<Resource, 'uri'|'name'>` — `title`, `description`, `mimeType`, `annotations`). It is distinct from the `@luqen/core/mcp.ResourceMetadata` type used for the RBAC filter (`{uriScheme, requiredPermission?}`). The plan called this collision out and we resolved it by importing the Luqen one as `LuqenResourceMetadata` and supplying the SDK one inline as the 3rd arg.

3. **Read response envelope `contents[]` shape** — each entry must include `uri` (string, typically `uri.toString()` from the URL parsed by the SDK), `mimeType`, and either `text` or `blob`. The SDK does not coerce `URL` to string; passing the URL object directly produces a JSON `{}` blob in the JSON-RPC response.

4. **Thrown errors in readCallback** are wrapped by the SDK protocol layer into JSON-RPC `error` objects with `code: ErrorCode.InternalError` and `message: error.message`. This is why the cross-org guard test (C3) matches `/not found/i` against the JSON-RPC `error.message` rather than a structured envelope.

5. **`McpServer._registeredResourceTemplates` shape** — `{[name]: {resourceTemplate: {uriTemplate: {toString(): string, match(uri): Record<string, string> | null}}, metadata, readCallback}}`. The D-17 test calls `.uriTemplate.toString()` to retrieve the original template string (e.g. `'scan://report/{id}'`) for the `{orgId}` substring check. Same private-field access pattern that 30-01's http-plugin uses for the override.

## Phase 28 / 30-01 / 30-02 Regression Check

| Suite | Tests | Result |
|-------|-------|--------|
| `packages/dashboard/tests/mcp/` | 40 (30 baseline + 10 new) | PASS |
| `packages/core/tests/` | 225 | PASS |
| `packages/dashboard` `tsc --noEmit` | — | exit 0 |

No regressions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Scan status literal `'complete'` vs `'completed'`**

- **Found during:** Task 1 — initial draft of `resources.ts` used the plan's literal `status: 'complete'` in the `scan://` list filter. The TypeScript compiler immediately rejected it because `ScanRecord.status` is the typed union `'queued' | 'running' | 'completed' | 'failed'` (verified at `packages/dashboard/src/db/types.ts:35`).
- **Fix:** Replaced the literal with `status: 'completed'` everywhere it appeared. Documented the deviation in the file's docstring (head of `resources.ts`) so future readers see the rationale.
- **Files modified:** `packages/dashboard/src/mcp/resources.ts`.
- **Carry-over:** This is the same Rule 1 fix recorded in `30-02-SUMMARY.md` against `packages/dashboard/src/mcp/tools/data.ts` — the plan template for both tools and resources used the wrong literal. Both files now agree on the real enum value.
- **Committed in:** `c5170c4` (Task 1 commit).

**2. [Rule 1 — Bug] "no perms caller sees empty list" test expectation incorrect for live system**

- **Found during:** Task 2 — first vitest run failed Test B4 (expected 0 entries, got 2).
- **Issue:** The plan asserts that a caller with no permissions sees an empty `resources/list` response. In the live system, the @luqen/core/mcp 30-01 override falls back to **scope-based** filtering when `ctx.permissions` is empty (see `packages/core/src/mcp/http-plugin.ts:215-218`). The route's coarse scope gate requires `read` scope (`requiredScope: 'read'` in `routes/api/mcp.ts`), so the only way to reach `resources/list` is to already have `read` scope; that scope satisfies the scope-fallback for both `reports.view` and `branding.view` (both view-tier perms), so the override emits both families. A truly empty result requires neither perms NOR scopes, which is unreachable through the auth gate.
- **Fix:** Rewrote Test B4 to assert the actual end-to-end behavior — `result.resources.length === 2`, with one `scan://` entry and one `brand://` entry. Added a 12-line comment block in the test body explaining why the plan's draft assertion was unreachable in the live system, so any future planner sees the analysis. The test still proves the override is wired through (entries appear via the override's emit path, not the SDK default), and it documents that the override's scope-fallback path is exercised.
- **Files modified:** `packages/dashboard/tests/mcp/resources.test.ts`.
- **Verification:** Test passes; 30-01 / 30-02 / Phase 28 suites unaffected.
- **Committed in:** `77d0a28` (Task 2 commit).

### Setup-only adjustments (not source changes)

**3. [Rule 3 — Blocking Setup] `node_modules` symlink + `@luqen/core` rebuild**

- Fresh worktree had no `node_modules/`. Symlinked worktree root `node_modules` → `/root/luqen/node_modules` (same approach 30-01 / 30-02 used).
- The consumed `@luqen/core/dist/mcp/index.d.ts` was the pre-30-01 build (no `ResourceMetadata` export). Re-ran `cd /root/luqen/packages/core && npx tsc` to rebuild the dist with the 30-01 source changes already merged into the source tree. After rebuild, `@luqen/core/mcp` exports `ResourceMetadata` and the dashboard typecheck passes cleanly.
- Neither change touched committed source files.

### Plan-acceptance grep formatting nuance

The plan's acceptance criteria included `grep -n "server.registerResource('scan-report'" ...` and `grep -n "server.registerResource('brand-score'" ...`. These single-line literal greps return zero matches against my source because Prettier auto-wraps each `server.registerResource(...)` invocation across multiple lines (`server.registerResource(\n    'scan-report',\n    ...`). A multiline grep (`server\.registerResource\(\s*'scan-report'`) returns the expected matches at lines 59-60 + 116-117. The plan's `<verification>` block — the authoritative set — tests `grep -c "server.registerResource(" ... === 2` and that returns 2. Spirit of the acceptance criteria is met without any source change.

## Threat Flags

No new trust-boundary surface beyond what the PLAN's threat register (T-30-04-01..10) already enumerates. The two ResourceTemplate readCallbacks read from existing org-scoped repository methods (`storage.scans.getScan`, `storage.scans.getReport`, `storage.brandScores.getHistoryForSite`, `storage.brandScores.getLatestForScan`) — all of which SQL-bind `org_id` at the query layer. URI parsing is delegated to the SDK's `ResourceTemplate.uriTemplate.match`; multi-segment paths like `scan://report/../../../etc/passwd` do not match the single-segment `{id}` template and fall through to "Resource not found" via the 30-01 override (T-30-04-05 mitigated). No new auth paths, no new endpoints.

## Next Phase Readiness

- **Plan 30-06 (external client verification):** can use `resources/list` and `resources/read` against this dashboard MCP via Claude Desktop or MCP Inspector. The smoke test should assert `resources/list` returns at least one `scan://` URI for a `reports.view`-equipped Bearer token and at least one `brand://` URI for a `branding.view`-equipped Bearer token. The Forbidden error path is covered here in unit-level integration tests; manual external-client verification only needs to confirm the JSON content shape.
- **No blocking work remains for resources** — the file layout (resources.ts owning its own helpers + metadata) means future resource families (e.g. `audit://`, `report-history://` deferred to Phase 33) can be added incrementally without touching server.ts or the shared http-plugin.

## Self-Check: PASSED

Verified against the worktree HEAD (`77d0a28`):

- [x] `packages/dashboard/src/mcp/resources.ts` exists at 171 lines (verified via `wc -l`).
- [x] `packages/dashboard/tests/mcp/resources.test.ts` exists at 482 lines.
- [x] Commit `c5170c4` present in `git log --oneline -5` (Task 1 — feat).
- [x] Commit `77d0a28` present in `git log --oneline -5` (Task 2 — test).
- [x] `cd packages/dashboard && npx tsc --noEmit` exits 0.
- [x] `cd packages/dashboard && npx vitest run tests/mcp/` reports 5 files / 40 tests / 0 failures.
- [x] `cd packages/core && npx vitest run` reports 27 files / 225 tests / 0 failures (no regression in 30-01).
- [x] `git diff --diff-filter=D --name-only HEAD~2 HEAD` is empty (no accidental deletions).
- [x] All 11 plan `<verification>` checks pass (registerResource×2, scan/brand URI literals present, encode/decode present, uriScheme literals present, cross-org guard present, no `{orgId}`, no `console.log`).

## TDD Gate Compliance

Plan marked `type: execute` (not `type: tdd`), but both tasks were annotated `tdd="true"`. The plan ordered Task 1 = implementation, Task 2 = tests — opposite of strict RED→GREEN ordering. Both tasks were committed atomically with their own `feat`/`test` prefix (`c5170c4` feat, `77d0a28` test). All 10 new tests passed on the first run after one Rule 1 expectation fix (Test B4), with no implementation changes required between Task 1 and Task 2. This matches the pattern set by 30-02.

---

*Phase: 30-dashboard-mcp-external-clients*
*Plan: 04*
*Completed: 2026-04-18*
