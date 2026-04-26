---
quick_id: 260418-lg8
description: "Strip jsonReport/jsonReportPath from dashboard_list_reports MCP response"
commit: 910a3de
completed_at: 2026-04-18
---

# Quick Task 260418-lg8 Summary

## One-liner

Added `SlimScanReport` allowlist projection inside `dashboard_list_reports` handler, dropping `jsonReport` (~200KB per scan) and `jsonReportPath` from MCP list responses while leaving `storage.scans.listScans()` untouched.

## What Changed

### `packages/dashboard/src/mcp/tools/data.ts`

- Added `import type { ScanRecord }` to the existing import block.
- Defined `interface SlimScanReport` — an explicit allowlist of the fields MCP clients actually need (id, siteUrl, status, standard, jurisdictions, regulations, createdBy, createdAt, orgId, plus optional counts and timestamps).
- Defined `function toSlimScanReport(scan: ScanRecord): SlimScanReport` — immutable projection that constructs a fresh object from the allowlist. Spread-then-drop was deliberately rejected: enumerable fields like `jsonReport` would survive `JSON.stringify` even after deletion.
- Changed the `dashboard_list_reports` handler body: `rows.map(toSlimScanReport)` before serialisation. The `listScans()` call itself is unchanged.

### `packages/dashboard/tests/mcp/data-tools.test.ts`

- Appended new `describe` block: _"dashboard_list_reports strips jsonReport (260418-lg8)"_.
- Single test: stubs `listScans` to return two `ScanRecord` rows with `jsonReport` (~205 stringified issues) and `jsonReportPath` populated, then asserts:
  - Serialised payload contains neither string `"jsonReport"` nor `"jsonReportPath"` anywhere.
  - `meta.count` and `data.length` are both 2.
  - Every row lacks both properties at the object level.
  - Key fields (`id`, `siteUrl`, `status`, `createdAt`) are preserved.
  - `scan-a.totalIssues === 205` and `scan-a.siteUrl === 'https://www.sky.it'` survive projection.

## Brand-scores Audit Decision

`dashboard_list_brand_scores` (data.ts lines 307–340) already projects to a slim record: it destructures only `scan.id`, `scan.siteUrl`, `scan.completedAt`, and pairs them with `storage.brandScores.getLatestForScan(scan.id)`. The `ScoreResult` type is structurally bounded (no free-text payloads, no embedded JSON blobs). No change needed.

## Verification

- `tsc --noEmit` on `packages/dashboard`: zero errors.
- `vitest run packages/dashboard/tests/mcp/data-tools.test.ts`: **17/17 passing** (16 pre-existing + 1 new).
- Classification coverage test (6 org-scoped comments): still green — `toSlimScanReport` is placed above `registerDataTools` and carries no classification comment.
- D-17 invariant test (no `orgId` in any zod schema): still green.
- String-coercion tests (z.coerce.number()): still green — no schema touched.

## MCP response bound

List responses are now bounded by the number of rows × (metadata fields only). The dominant unbounded term — `jsonReport` strings of up to ~200KB each — is absent. The full pa11y payload remains available exclusively via `dashboard_get_report`.

## Commit

`910a3de` — fix(dashboard-mcp): strip jsonReport from dashboard_list_reports
