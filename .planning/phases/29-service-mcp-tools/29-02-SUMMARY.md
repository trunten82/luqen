---
phase: 29-service-mcp-tools
plan: 02
subsystem: llm-mcp
tags:
  - mcp
  - llm
  - tools
  - phase-29
requires:
  - 28-01  # @luqen/core/mcp (createMcpHttpPlugin, getCurrentToolContext, ToolMetadata)
  - 28-02  # LLM MCP transport stub (/api/v1/mcp)
provides:
  - llm-mcp-tools  # 4 GLOBAL tools wrapping existing capability executors
affects:
  - packages/llm/src/mcp/server.ts
  - packages/llm/src/mcp/metadata.ts
  - packages/llm/src/api/routes/mcp.ts
  - packages/llm/src/api/server.ts
  - packages/llm/tests/mcp/http.test.ts
tech-stack:
  added: []
  patterns:
    - "Per-tool classification comment discipline (mirrors Phase 28 compliance template)"
    - "Thin protocol-adapter layer over existing capability executors — no new fallback logic (D-09)"
    - "Factory-accepts-db injection (LlmMcpServerOptions.db: DbAdapter)"
key-files:
  created:
    - packages/llm/src/mcp/metadata.ts
  modified:
    - packages/llm/src/mcp/server.ts
    - packages/llm/src/api/routes/mcp.ts
    - packages/llm/src/api/server.ts
    - packages/llm/tests/mcp/http.test.ts
decisions:
  - "LLM MCP surface: 4 GLOBAL tools, all requiredPermission='llm.view', none destructive (D-06)"
  - "NO orgId in any tool inputSchema — orgId resolved from getCurrentToolContext() and passed to executors only for per-org prompt overrides (D-13)"
  - "No new fallback logic — tool handlers are one-call delegations to executeXxx() (D-09 preservation)"
  - "Error envelope: CapabilityNotConfiguredError / CapabilityExhaustedError pass through err.message; anything else returns generic 'Upstream LLM error' (no stack leakage)"
  - "llm_discover_branding lives on LLM MCP (NOT branding MCP) per D-08"
  - "All 4 LLM capabilities exposed via MCP, including extract-requirements (D-06 full surface coverage)"
metrics:
  duration: "~3.5 minutes"
  completed: "2026-04-17"
requirements:
  - MCPT-03
---

# Phase 29 Plan 02: LLM MCP Tools Summary

Populate the Phase 28 empty LLM MCP stub with 4 GLOBAL, non-destructive, `llm.view`-gated tools that wrap the existing LLM capability executors 1:1 — delivering MCPT-03 (generate fixes + analyse reports) plus the D-08 half of MCPT-02 (LLM-owned `discover_branding`). Zero new business logic; thin protocol-adapter layer only.

## One-liner

Register 4 LLM MCP tools (`llm_generate_fix`, `llm_analyse_report`, `llm_discover_branding`, `llm_extract_requirements`) as GLOBAL thin wrappers over existing capability executors, wired through the Phase 28 `@luqen/core/mcp` plugin with `llm.view` permission filtering and D-13 orgId-invariant enforcement.

## Registered Tools

| Tool name                    | Wraps REST endpoint                 | Description (first sentence)                                                                                                  |
| ---------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `llm_generate_fix`           | POST /api/v1/generate-fix           | Generate an AI fix suggestion for a WCAG accessibility issue. Returns fixed HTML, explanation, and effort estimate.           |
| `llm_analyse_report`         | POST /api/v1/analyse-report         | Generate an AI executive summary for a scan report. Returns summary, key findings, priorities, and recurring patterns.       |
| `llm_discover_branding`      | POST /api/v1/discover-branding      | Auto-detect brand colors, fonts, and logo from a URL. Runs via the LLM service (D-08 — not branding MCP).                    |
| `llm_extract_requirements`   | POST /api/v1/extract-requirements   | Extract structured requirements from a regulation document. Returns an array of requirement objects (Phase 2 capability).     |

All 4 tools: `requiredPermission: 'llm.view'`, `destructive: undefined`. None destructive.

## Classification Coverage

Confirmed 4 `// orgId: N/A (global — inputs supplied by caller; orgId used only for per-org prompt overrides)` handler comments in `packages/llm/src/mcp/server.ts`. Zero `// orgId: ctx.orgId` (no org-scoped tools on LLM — the service has no org-scoped tables; DB is a provider/model/prompt registry). Zero `TODO(phase-30)` markers. Classification coverage test asserts exactly 4 GLOBAL + 0 ORG-SCOPED.

## D-09 Preservation (No New Fallback Logic)

Each handler body is a single `await execute*(db, adapterFactory, params)` call followed by a single-shape payload wrap. No branching on provider availability, no duplicated fallback paths. `executeGenerateFix`'s 50-hardcoded-pattern fallback (inside the capability executor itself) is inherited by the MCP tool automatically — the MCP tool never reimplements it. Same for `executeAnalyseReport`'s degraded-shape error response.

Grep verification: `grep -cE "executeGenerateFix|executeAnalyseReport|executeDiscoverBranding|executeExtractRequirements" packages/llm/src/mcp/server.ts` → **8** (1 import + 1 call per capability — no extra occurrences that would signal new fallback branches).

## D-13 Runtime Guard (No orgId in inputSchema)

Integration test iterates `server._registeredTools` after `createLlmMcpServer({ db })`. Confirms:
- `toolNames.length === 4`
- `metadata.length === 4`
- `Object.entries(_registeredTools).length === 4`
- Every tool's extracted zod shape has no `orgId` property
- JSON-serialised schema contains no `"orgId"` substring (belt-and-braces)

Iteration reached 4 entries — Phase 28's fallback plan (which would have activated if the McpServer SDK didn't expose `_registeredTools`) did not need to activate.

## Factory + Route Wiring Changes

- `createLlmMcpServer` signature: `(_options: Record<string, never> = {})` → `(options: { readonly db: DbAdapter })`.
- `registerMcpRoutes`: `(app)` → `(app, opts: { readonly db: DbAdapter })` — forwards `db` to the factory.
- `packages/llm/src/api/server.ts` line 137: `await registerMcpRoutes(app);` → `await registerMcpRoutes(app, { db });`. The DB adapter is already in `createServer` scope (constructed from `ServerOptions.db`), so no additional plumbing was required.

The `{ capabilities: { tools: {} } }` second-argument to `new McpServer(...)` is preserved verbatim — this gate was the Phase 28 workaround for the SDK's protocol capability check. Removing it would throw "Server does not support tools" at `ListToolsRequestSchema` install time.

## Error Envelope Mapping

The MCP protocol has no HTTP status codes; tools return `{ isError: true }` to signal errors. The REST-to-MCP mapping is:

| REST status | REST trigger                       | MCP envelope                                                                 |
| ----------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| 503         | `CapabilityNotConfiguredError`     | `{ content: [{ type: 'text', text: '{"error":"<err.message>"}' }], isError: true }` |
| 504         | `CapabilityExhaustedError`         | `{ content: [{ type: 'text', text: '{"error":"<err.message>"}' }], isError: true }` |
| 502         | Any other error                    | `{ content: [{ type: 'text', text: '{"error":"Upstream LLM error"}' }], isError: true }` |

No stack traces, no DB paths, no internal error details leaked — threat T-29-17 mitigated. Grep: `grep -n "err.stack" packages/llm/src/mcp/server.ts` → no match.

## REST vs MCP Divergence

Zero divergence beyond the HTTP framing:

- REST returns HTTP status codes; MCP returns `isError: true` (protocol requirement)
- REST accepts `orgId` in the body as a fallback; MCP never accepts `orgId` from args (D-13 invariant) — uses `getCurrentToolContext().orgId` or `'system'`
- REST uses Fastify schema validation (jsonschema); MCP uses zod (SDK requirement)

All three are expected and structural, not behavioural. Inputs otherwise flow into the executors with identical shape.

## Tests

| Test | Purpose | Pass |
| --- | --- | --- |
| `returns 401 when no Bearer token is provided` | MCPI-02 baseline | yes |
| `returns 200 MCP initialize with valid Bearer` | MCPI-01 handshake | yes |
| `tools/list with read scope — returns exactly the 4 LLM tools` | Replaces Phase 28 empty-list assertion | yes |
| `tools/list admin scope — all 4 LLM tools visible via scope fallback` | MCPI-03 scope fallback | yes |
| `MCPI-04 runtime guard — NO LLM tool inputSchema contains orgId (D-13)` | D-13 iteration guard | yes |
| `Classification coverage — all 4 LLM handlers are GLOBAL, NO TODO(phase-30) deferrals` | Source-text discipline | yes |

`pnpm --filter @luqen/llm test` (vitest full suite): **258/258 passing (27 files)** — zero regressions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSDoc self-reference broke classification-count test**
- **Found during:** Task 2 (first test run)
- **Issue:** Initial `server.ts` JSDoc quoted the exact classification marker string (`// orgId: N/A ...`) inside the top-of-file comment. The `/\/\/ orgId: N\/A /g` regex in the classification-coverage test counted this as a 5th match, even though only 4 runtime handler markers exist.
- **Fix:** Rephrased the JSDoc to describe the classification marker convention without quoting the literal token. The test then counts exactly 4 runtime handler markers.
- **Files modified:** `packages/llm/src/mcp/server.ts` (JSDoc block only)
- **Commit:** c6c8e45 (included with Task 2)

### Cosmetic grep-pattern mismatches (plan acceptance criteria)

Two of the Task 1/Task 2 acceptance criterion greps do not match their intended code because the grep patterns themselves were over-specific:

1. `grep -c "server.registerTool('llm_" packages/llm/src/mcp/server.ts` returns 0 because `registerTool` uses the multi-line `registerTool(\n  'llm_...'` form (matches the compliance reference template — same pattern there also returns 0). The functional intent is satisfied: `grep -c "server.registerTool"` → 4, and the 4 tool-name literals appear on the following lines.
2. `grep -n "serialised.includes..orgId" packages/llm/tests/mcp/http.test.ts` returns no match because the actual string is `serialised.includes('"orgId"')` — 3 characters (`('"`) between `includes` and `orgId`, not the 2 implied by `..`. The functional assertion is present and stricter than the plan's form.

These are cosmetic grep misses; the underlying invariants (4 registrations, double-quoted orgId absence in serialised schemas) are verified by positive greps and by the passing test.

### No regressions encountered

Full LLM test suite remained 258/258 passing throughout. No broader codebase changes were required.

## Authentication Gates

None encountered. All execution was fully automated — no Bearer tokens, API keys, or external services needed.

## Self-Check: PASSED

- [x] `packages/llm/src/mcp/metadata.ts` exists (NEW)
- [x] `packages/llm/src/mcp/server.ts` rewritten — 4 registrations, 4 classification markers, no TODOs, no console.log, no orgId in zod
- [x] `packages/llm/src/api/routes/mcp.ts` — passes `{ db: opts.db }` to factory
- [x] `packages/llm/src/api/server.ts` line 137 — passes `{ db }` to `registerMcpRoutes`
- [x] `packages/llm/tests/mcp/http.test.ts` — 6 tests passing (2 original + 4 new)
- [x] Task 1 commit exists: 621643d
- [x] Task 2 commit exists: c6c8e45
- [x] TypeScript compiles
- [x] Full LLM test suite passes (258/258)

## Commits

| Task | Hash     | Message                                                                 |
| ---- | -------- | ----------------------------------------------------------------------- |
| 1    | 621643d  | feat(29-02): register 4 LLM MCP tools wrapping capability executors     |
| 2    | c6c8e45  | test(29-02): LLM MCP integration tests for tool-list + D-13 + classification |
