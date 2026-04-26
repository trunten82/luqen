---
slug: mcp-limit-string-coercion
status: resolved
trigger: |
  DATA_START
  dashboard_list_reports limit parameter fails with type validation error — MCP sends limit as string, server Zod schema expects number
  DATA_END
created: 2026-04-18
updated: 2026-04-18
resolved: 2026-04-18
tdd_mode: false
---

# Debug Session: mcp-limit-string-coercion

## Symptoms (from Phase 30 manual walkthrough)

- **Expected behavior**: Calling `dashboard_list_reports` with `{ limit: 10 }` (or any integer) via an external MCP client (Claude Desktop + `mcp-remote` bridge) should return a paginated list of scans for the caller's org.
- **Actual behavior**: Claude Desktop reports "the MCP bridge is rejecting my numeric input with a type validation error (it's arriving as a string on the server side)". Claude cannot page results; the default `limit=50` response exceeds Claude Desktop's 1 MB tool-result cap.
- **Error messages**: Type validation error from the server (Zod) — `limit` expected number, received string.
- **Timeline**: First surfaced 2026-04-18 during the first live Phase 30 SC#4 Claude Desktop walkthrough. Phase 30 plans 30-02 through 30-06 were committed without a live external-client run (the MCP Inspector smoke test in 30-06 uses direct `fetch()` JSON-RPC and passes numeric literals so the bug does not fire in CI).
- **Reproduction**:
  1. Connect Claude Desktop via the provided `claude_desktop_config.json` (mcp-remote → `http://<host>:5000/api/v1/mcp`, Bearer RS256 JWT, scope=read).
  2. Ask Claude: "list the most recent scan reports".
  3. Claude first calls `dashboard_list_reports` with no args → response > 1 MB → Claude Desktop truncates.
  4. Claude retries with `{ limit: 10 }` (or similar) → server returns type-validation error.

## Known Evidence (pre-loaded)

- Tool schema in `packages/dashboard/src/mcp/tools/data.ts:118-124`:
  ```ts
  limit: z.number().int().min(1).max(200).optional().describe('Page size (default 50)')
  ```
- `z.number()` does NOT coerce string input in Zod — an LLM-produced `"10"` fails with `expected number, received string`.
- Same pattern appears in other dashboard MCP tool schemas (e.g. `dashboard_query_issues.limit`, `dashboard_list_brand_scores.limit`) — also affected.
- `dashboard_update_org.brandScoreTarget` in admin.ts also affected.
- MCP SDK 1.27.1 does not auto-coerce client args against the Zod schema at the SDK layer — schema parsing happens inside each tool registration.
- `mcp-remote` is the stdio↔HTTP bridge; it forwards JSON-RPC verbatim. The string/number choice is upstream (LLM-produced tool_use or SDK serialization).
- Industry norm for LLM-facing Zod: `z.coerce.number().int()…` so string-typed numerics from LLMs validate cleanly.

## Evidence

- **Audit of numeric fields**: 5 fields across 2 files
  - `data.ts`: `dashboard_list_reports.limit`, `dashboard_list_reports.offset`, `dashboard_query_issues.limit`, `dashboard_list_brand_scores.limit`
  - `admin.ts`: `dashboard_update_org.brandScoreTarget`
- **Test confirmation (RED)**: 4 of 5 new coercion tests failed before fix — confirmed bug was real and reproducible.
- **Test confirmation (GREEN)**: All 16 tests in data-tools.test.ts pass after fix; inspector-smoke.test.ts 6/6 pass.

## Eliminated Hypotheses

- mcp-remote re-serialization bug: eliminated — the bridge forwards JSON-RPC verbatim; the issue is Zod schema strictness on the server side.
- MCP SDK layer auto-coercion: eliminated — SDK 1.27.1 does not coerce; parsing is per-tool.

## Resolution

- **root_cause**: `z.number()` in dashboard MCP tool inputSchemas rejects JSON string numerics (`"10"`) that LLMs (Claude via mcp-remote) routinely emit. Zod's non-coercing `z.number()` requires a JS number primitive; the coercing variant `z.coerce.number()` casts the string before validation.
- **fix**: Replaced `z.number()` with `z.coerce.number()` on all 5 numeric inputSchema fields across `packages/dashboard/src/mcp/tools/data.ts` and `packages/dashboard/src/mcp/tools/admin.ts`. Bounds (int, min, max) are preserved. Handlers receive a coerced number so downstream contracts are unchanged. Non-numeric strings (`"abc"`) still fail validation correctly.
- **commits**:
  - `bde4906` — test(30): add coercion tests for LLM-produced string numeric args
  - `6e522af` — fix(30): coerce numeric MCP tool args to accept LLM-produced strings
- **files changed**:
  - `packages/dashboard/src/mcp/tools/data.ts` — 4 fields coerced
  - `packages/dashboard/src/mcp/tools/admin.ts` — 1 field coerced
  - `packages/dashboard/tests/mcp/data-tools.test.ts` — 5 new coercion test cases (+ 1 negative case)
