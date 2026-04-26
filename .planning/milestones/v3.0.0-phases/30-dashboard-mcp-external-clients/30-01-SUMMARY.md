---
phase: 30-dashboard-mcp-external-clients
plan: 01
subsystem: packages/core/src/mcp
tags:
  - mcp
  - core
  - resources
  - infrastructure
  - rbac
requirements:
  - MCPI-05
dependency_graph:
  requires:
    - "@modelcontextprotocol/sdk@1.27.1 — ListResourcesRequestSchema, ReadResourceRequestSchema, McpError, ErrorCode exports"
    - "Phase 28 http-plugin foundation — getCurrentToolContext ALS, filterToolsByPermissions/Scope pattern"
  provides:
    - "ResourceMetadata interface (@luqen/core/mcp)"
    - "filterResourcesByPermissions + filterResourcesByScope (@luqen/core/mcp)"
    - "createMcpHttpPlugin.options.resourceMetadata — optional RBAC filter for Resources"
    - "ListResourcesRequestSchema override (gated on non-empty resourceMetadata)"
    - "ReadResourceRequestSchema override (gated on non-empty resourceMetadata)"
  affects:
    - "Phase 30-04 (dashboard resources registration) — will consume resourceMetadata parameter"
    - "Phase 28 services (compliance/branding/llm/dashboard) — unchanged, resourceMetadata defaults to []"
tech_stack:
  added: []
  patterns:
    - "SDK private-field access for _registeredResources / _registeredResourceTemplates (mirrors Phase 28 _registeredTools pattern)"
    - "Metadata-driven RBAC filter (ResourceMetadata[] passed to plugin, not hardcoded scheme table)"
    - "URI scheme parsed via indexOf('://') — 'scan-evil://...' correctly distinct from 'scan'"
key_files:
  created:
    - "packages/core/tests/mcp/resource-filter.test.ts"
    - "packages/core/tests/mcp/http-plugin-resources.test.ts"
  modified:
    - "packages/core/src/mcp/types.ts"
    - "packages/core/src/mcp/tool-filter.ts"
    - "packages/core/src/mcp/http-plugin.ts"
    - "packages/core/src/mcp/index.ts"
decisions:
  - "ResourceMetadata uses uriScheme WITHOUT '://' separator (e.g. 'scan' not 'scan://') — keeps filter key simple"
  - "Resource overrides ONLY register when resourceMetadata.length > 0 — preserves Phase 28 backwards-compat"
  - "ReadResourceRequestSchema re-computes allowedSchemes on every read — does NOT trust the list filter (threat T-30-01-02)"
  - "Forbidden error uses exact literal 'Forbidden' — no URI echo, no row data (threat T-30-01-03)"
  - "filterResourcesByScope mirrors filterToolsByScope's write-vs-read-tier logic exactly — '.manage'/'.delete'/'admin.system'/'admin.org' require write+ scope"
metrics:
  completed_date: "2026-04-18"
  duration_minutes: 9
---

# Phase 30 Plan 01: MCP Resources RBAC Filter Infrastructure Summary

One-liner: Metadata-driven RBAC filter for MCP Resources added to @luqen/core/mcp — `ResourceMetadata` + `filterResourcesByPermissions/Scope` + `createMcpHttpPlugin` overrides gate `resources/list` and `resources/read` by URI scheme per caller, identical shape to the existing tool filter.

## What Shipped

1. **`ResourceMetadata` interface** (`packages/core/src/mcp/types.ts`)
   - `readonly uriScheme: string` — scheme WITHOUT `://` separator (e.g. `'scan'`)
   - `readonly requiredPermission?: string` — optional; `undefined` means visible to all authenticated callers (D-04 carry-forward)

2. **`filterResourcesByPermissions` / `filterResourcesByScope`** (`packages/core/src/mcp/tool-filter.ts`)
   - Drop-in parallels of `filterToolsByPermissions` / `filterToolsByScope`
   - `filterResourcesByScope` honours the same scope-hierarchy rules (`admin > write > read`, with `.manage`/`.delete`/`admin.system`/`admin.org` requiring write+)
   - Re-exported from the `@luqen/core/mcp` barrel alongside the existing tool-filter exports

3. **Extended `createMcpHttpPlugin`** (`packages/core/src/mcp/http-plugin.ts`)
   - New option `readonly resourceMetadata?: readonly ResourceMetadata[]`
   - When provided and non-empty, installs two SDK request-handler overrides AFTER the existing tools/list override:
     - `ListResourcesRequestSchema` → filter static resources + template-list results by allowed URI schemes
     - `ReadResourceRequestSchema` → re-check RBAC on every read, throw `McpError(ErrorCode.InvalidParams, 'Forbidden')` on scheme denial
   - When omitted or empty, the plugin skips override registration entirely — SDK defaults remain authoritative (Phase 28 backwards-compat for compliance/branding/llm/dashboard)

4. **Unit + integration tests** (`packages/core/tests/mcp/*.test.ts`)
   - `resource-filter.test.ts`: 10 unit tests — permission matching, scope hierarchy, empty input, admin.system write+ gating
   - `http-plugin-resources.test.ts`: 7 integration tests — caller with reports.view sees only `scan://`, caller with branding.view sees only `brand://`, both perms see both, scope fallback (read scope + empty perms), read succeeds on permitted scheme, read throws Forbidden on denied scheme, unknown URI path returns not-found

## Patterns Used

### SDK Private-Field Access

The SDK's `McpServer` keeps resource registries on `_registeredResources` and `_registeredResourceTemplates` (not public APIs). The plugin casts `mcpServer as unknown as { _registeredResources?: ..., _registeredResourceTemplates?: ... }` inside a local variable, exactly like Phase 28 does for `_registeredTools`. This is a documented departure from strict type safety — the SDK's resource dispatch in `@modelcontextprotocol/sdk/dist/esm/server/mcp.js` (`setResourceRequestHandlers`) performs the same field access internally, so we are mirroring its authoritative behaviour.

If SDK >=1.28 renames or removes these fields, Task 1's pre-flight SDK version check will catch it (see 30-01-PLAN.md `action` step 0).

### Metadata-Driven Filter (vs. Hardcoded Scheme Table)

The plan considered two approaches for the filter:
1. **Hardcoded scheme → permission table inside the plugin** (e.g. `if (uri.startsWith('scan://')) return hasPerm('reports.view')`)
2. **Metadata-driven** — caller passes `resourceMetadata: [{uriScheme: 'scan', requiredPermission: 'reports.view'}, ...]`

We committed to (2) because:
- Matches the Phase 28 `toolMetadata` pattern exactly — one mental model, not two
- Plugin stays generic — every service (dashboard, future agent) registers its own scheme/permission mapping
- Filter functions (`filterResourcesByPermissions`, `filterResourcesByScope`) are directly unit-testable without spinning up a full Fastify app

### Defence in Depth on Read

`ReadResourceRequestSchema` does NOT trust the list filter to have already excluded URIs — it re-computes `allowedSchemes` on every read and throws Forbidden before touching the SDK's read dispatch. This mitigates threat T-30-01-02 (EoP: caller with only `branding.view` directly reads `scan://report/xxx` to bypass list filter).

## SDK 1.27.1 Nuances Discovered

1. **`McpError` constructor signature** — confirmed `new McpError(ErrorCode.InvalidParams, message)`. The codes export lives on `ErrorCode` (not on McpError static). Message strings propagate to JSON-RPC `error.message` but are wrapped by the protocol layer (caller never sees stack traces).

2. **`ErrorCode.InvalidParams` vs `ErrorCode.InvalidRequest`** — the SDK's own `ReadResourceRequestSchema` default uses `InvalidParams` for both the `disabled` and `not found` paths. We followed that precedent for `Forbidden` to stay consistent; JSON-RPC clients see the same error-code class for all resource-read failure modes.

3. **`ResourceTemplate` list callback shape** — `list: async (extra) => ({ resources: [...] })`. The `extra` parameter is unused in our override (we pass it through) but must be accepted because the SDK's listCallback signature requires it.

4. **Static vs. template resource merge order** — SDK default emits static first, then templates. Template metadata is spread BEFORE the entry so per-entry fields win (e.g. a template-level `mimeType` is overridden by an entry-level `mimeType`). We mirrored this exactly.

5. **URL construction** — `new URL(uri)` on a scheme like `scan://report/abc` works because the Node URL parser accepts arbitrary schemes. The parsed URL is what the SDK's `readCallback` expects. No validation needed beyond the scheme allow-check.

## Phase 28 Regression Check

The plan's backwards-compat guarantee was: Phase 28 call sites continue to work unchanged because `resourceMetadata` defaults to empty. Verified:

- `packages/core/**/*.test.ts` — 225/225 tests pass (27 test files)
- `packages/compliance/tests/mcp/*.test.ts` — 28/28 pass (3 files)
- `packages/branding/tests/mcp/*.test.ts` — 6/6 pass (1 file)
- `packages/llm/tests/mcp/*.test.ts` — 6/6 pass (1 file)
- `packages/dashboard/tests/mcp/*.test.ts` — 19/19 pass (3 files)

Zero Phase 28 regressions. The existing tools/list filter behaviour is untouched.

## Security Invariants Preserved

- **No `console.log`** anywhere in http-plugin.ts — verified by `grep -c console.log` → 0
- **Bearer-only auth** — plugin still rejects unauthenticated requests with 401 at the route handler; the `ctx == null` branch in the resource overrides is defence-in-depth (threat T-30-01-08)
- **Forbidden error payload** — exact literal string `'Forbidden'`, no URI echo, no row data (threat T-30-01-03)
- **URI scheme parsing** — `indexOf('://')` means `scan-evil://...` yields `'scan-evil'` (distinct from `'scan'`) and `scan//...` (missing colon) yields `''` (empty, never matches) — threat T-30-01-04 mitigated

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking Setup] Node modules missing in worktree**
- **Found during:** Environment setup before Task 1
- **Issue:** Fresh worktree had no `node_modules/` — tests and typecheck would not run.
- **Fix:** Symlinked worktree root `node_modules` to the main repo's `node_modules`. Verified SDK resolves correctly (`@modelcontextprotocol/sdk/server/mcp.js` imports the McpServer class).
- **Files modified:** none (symlink outside tracked tree)
- **Commit:** none (not a source change)

**2. [Rule 3 — Plan-referenced Files Missing from Worktree] Phase 30 planning directory not in git**
- **Found during:** Initial file read at startup
- **Issue:** Plan files (`30-01-PLAN.md`, `30-CONTEXT.md`, `30-PATTERNS.md`) live in the parent repo working tree but were not committed, so the fresh worktree branched from `15f3f4c1` had no visibility into them.
- **Fix:** Copied the six PLAN files + CONTEXT + PATTERNS + DISCUSSION-LOG from the parent repo into the worktree so the executor could reference them. They remain untracked in the worktree; the parent repo owns them.
- **Files modified:** none tracked

Neither deviation changed source code or tests. Both were setup-only.

### Intentional Test-Path Choice

Plan specified tests at `packages/core/tests/mcp/*.test.ts`. The package's existing convention is `packages/core/src/mcp/__tests__/*.test.ts`. The repo's `vitest.config.ts` includes BOTH paths (`tests/**/*.test.ts` + `src/**/__tests__/*.test.ts`), so placing the new tests at the plan-specified `tests/mcp/` location is valid and was followed verbatim. No deviation.

## Commits

| # | Commit  | Message                                                                             |
| - | ------- | ----------------------------------------------------------------------------------- |
| 1 | 7edb074 | `test(30-01): add failing tests for filterResourcesByPermissions/Scope` (TDD RED)   |
| 2 | 2927186 | `feat(30-01): implement ResourceMetadata + resource filters` (TDD GREEN)            |
| 3 | 593d5c2 | `test(30-01): add failing integration tests for Resources RBAC overrides` (TDD RED) |
| 4 | c9cc108 | `feat(30-01): extend createMcpHttpPlugin with Resources RBAC overrides` (TDD GREEN) |

## Verification Evidence

```
cd packages/core && npx tsc --noEmit
# exit 0

cd packages/core && npx vitest run tests/mcp/resource-filter.test.ts
# Test Files  1 passed (1)
#      Tests  10 passed (10)

cd packages/core && npx vitest run tests/mcp/http-plugin-resources.test.ts
# Test Files  1 passed (1)
#      Tests  7 passed (7)

cd packages/core && npx vitest run
# Test Files  27 passed (27)
#      Tests  225 passed (225)
```

All success criteria from `30-01-PLAN.md` met:
- [x] `@luqen/core/mcp` exports `ResourceMetadata`, `filterResourcesByPermissions`, `filterResourcesByScope`
- [x] `createMcpHttpPlugin` accepts optional `resourceMetadata` and installs overrides when non-empty
- [x] Integration tests prove permission-based list filtering + read-gate Forbidden throwing
- [x] Phase 28 services continue to work (resourceMetadata defaults to empty → overrides skip registration)
- [x] Unit tests cover edge cases (empty input, no-perm-required resource, scope hierarchy, manage-permission-requires-write)
- [x] TypeScript compiles cleanly; core + service suites all pass

## Test Files

- `packages/core/tests/mcp/resource-filter.test.ts` — 10 unit tests
- `packages/core/tests/mcp/http-plugin-resources.test.ts` — 7 integration tests

## Self-Check: PASSED

Verified artifacts exist:
- [x] `packages/core/src/mcp/types.ts` — `export interface ResourceMetadata` found at line 61
- [x] `packages/core/src/mcp/tool-filter.ts` — `export function filterResourcesByPermissions` and `filterResourcesByScope` found
- [x] `packages/core/src/mcp/index.ts` — `ResourceMetadata`, `filterResourcesByPermissions`, `filterResourcesByScope` re-exported
- [x] `packages/core/src/mcp/http-plugin.ts` — `ListResourcesRequestSchema` + `ReadResourceRequestSchema` setRequestHandler calls present; `McpError(..., 'Forbidden')` present; no `console.log`
- [x] `packages/core/tests/mcp/resource-filter.test.ts` — exists, 10 tests pass
- [x] `packages/core/tests/mcp/http-plugin-resources.test.ts` — exists, 7 tests pass

Verified commits in git log:
- [x] `7edb074` test(30-01) RED — resource filter failing tests
- [x] `2927186` feat(30-01) GREEN — resource filter implementation
- [x] `593d5c2` test(30-01) RED — http plugin resources failing tests
- [x] `c9cc108` feat(30-01) GREEN — http plugin resources overrides

## TDD Gate Compliance

Plan marked `type: execute` (not `type: tdd` at plan level), but both tasks were annotated `tdd="true"`. Both tasks followed the RED → GREEN cycle with separate commits:

- Task 1: RED (`7edb074`) → GREEN (`2927186`) — 10/10 tests fail, then 10/10 pass
- Task 2: RED (`593d5c2`) → GREEN (`c9cc108`) — 3/3 scheme-gated integration tests fail, then 7/7 pass

No REFACTOR commits were necessary — both implementations were clean on first pass (mirror of Phase 28 pattern).
