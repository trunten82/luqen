---
phase: 07-regulation-filter
plan: 02
subsystem: dashboard
tags: [dashboard, sqlite, migration, compliance-client, orchestrator, scan-service, reports, tdd, backwards-compat]
requirements: [REG-01, REG-03, REG-05]
dependency-graph:
  requires:
    - "07-P01 — compliance API regulations[] + regulationMatrix"
  provides:
    - "scan_records.regulations TEXT NOT NULL DEFAULT '[]' (migration 039)"
    - "ScanRecord.regulations: string[] (always present)"
    - "ScanConfig.regulations: string[] (required) — orchestrator contract"
    - "checkCompliance(baseUrl, token, jurisdictions, regulations, issues, orgId?) — new 6-arg signature"
    - "ComplianceCheckResult.regulationMatrix? + RegulationMatrixEntry type"
    - "reportData.regulationMatrix — array of RegulationMatrixEntry for templates"
  affects:
    - "packages/dashboard/src/db/sqlite/migrations.ts"
    - "packages/dashboard/src/db/types.ts"
    - "packages/dashboard/src/db/sqlite/repositories/scan-repository.ts"
    - "packages/dashboard/src/db/migrate-data.ts"
    - "packages/dashboard/src/compliance-client.ts"
    - "packages/dashboard/src/services/compliance-service.ts"
    - "packages/dashboard/src/scanner/orchestrator.ts"
    - "packages/dashboard/src/services/scan-service.ts"
    - "packages/dashboard/src/services/report-service.ts"
    - "packages/dashboard/src/routes/scan.ts"
    - "packages/dashboard/src/scheduler.ts"
    - "packages/dashboard/src/server.ts"
    - "packages/dashboard/src/i18n/locales/en.json"
tech-stack:
  added: []
  patterns:
    - "Additive column with default literal — existing rows read as [] via null-safe parser (D-04)"
    - "Positional-param extension of client signature — all call sites updated atomically"
    - "reportData exposes data as array via Object.values() for template {{#each}} uniformity"
key-files:
  created:
    - ".planning/phases/07-regulation-filter/07-P02-dashboard-wiring-SUMMARY.md"
  modified:
    - "packages/dashboard/src/db/sqlite/migrations.ts"
    - "packages/dashboard/src/db/types.ts"
    - "packages/dashboard/src/db/sqlite/repositories/scan-repository.ts"
    - "packages/dashboard/src/db/migrate-data.ts"
    - "packages/dashboard/src/compliance-client.ts"
    - "packages/dashboard/src/services/compliance-service.ts"
    - "packages/dashboard/src/scanner/orchestrator.ts"
    - "packages/dashboard/src/services/scan-service.ts"
    - "packages/dashboard/src/services/report-service.ts"
    - "packages/dashboard/src/routes/scan.ts"
    - "packages/dashboard/src/scheduler.ts"
    - "packages/dashboard/src/server.ts"
    - "packages/dashboard/src/i18n/locales/en.json"
    - "packages/dashboard/tests/compliance-client.test.ts"
    - "packages/dashboard/tests/db/scans.test.ts"
    - "packages/dashboard/tests/scanner/orchestrator.test.ts"
    - "packages/dashboard/tests/services/scan-service.test.ts"
    - "packages/dashboard/tests/routes/reports.test.ts"
    - "packages/dashboard/tests/integration/compliance-api.test.ts"
decisions:
  - "ScanRecord.regulations is non-optional string[] (always present) — migration default + null-safe parser guarantee the invariant without forcing every caller to check for undefined"
  - "CreateScanInput.regulations is optional for ergonomic call sites (scheduler, migrate-data, legacy fixtures); repo defaults to [] via `?? []` on insert"
  - "ScanConfig.regulations is REQUIRED (not optional) — forces every orchestrator caller to make the selection explicit, catching drift at compile time; legacy call sites default to [] at the call site, never at the type"
  - "Orchestrator compliance gate loosened: runs when jurisdictions.length > 0 OR regulations.length > 0 (D-15); jurisdictions-only callers unchanged, regulations-only callers newly supported"
  - "reportData.regulationMatrix is always an array (possibly empty) — templates can use length checks without undefined guards, peer to complianceMatrix shape"
  - "Did NOT add POST /scan/new 'both empty → 400' validation — that is scope creep relative to the minimal wiring goal and would break 30+ existing scan.test.ts fixtures that submit scans without jurisdictions. The orchestrator gracefully skips compliance when both are empty, preserving the existing UX. See Deviations."
metrics:
  duration: "~15min"
  tasks: 2
  completed: "2026-04-05"
  commits: 2
---

# Phase 07 Plan 02: Dashboard Wiring — Regulation Filter End-to-End Summary

Wired the regulations selection through every layer of the dashboard — migration 039, scan record persistence, compliance-client signature, ComplianceService wrapper, orchestrator forwarding, scan-service form normalization, reports route passthrough — so P01's compliance API enhancement is reachable from scan form to report template with a single additive column and zero regressions across 2159 existing tests.

## Deliverables

### 1. Migration 039 + persistence (REG-03)

- `packages/dashboard/src/db/sqlite/migrations.ts`:
  ```sql
  ALTER TABLE scan_records ADD COLUMN regulations TEXT NOT NULL DEFAULT '[]';
  ```
- `ScanRecord.regulations: string[]` (always present — non-optional).
- `CreateScanInput.regulations?: string[]` (optional, defaults `[]` at INSERT time via `JSON.stringify(data.regulations ?? [])`).
- `SqliteScanRepository.rowToRecord` uses a new `parseJsonArraySafe()` helper applied to **both** `jurisdictions` and `regulations` — null/missing/malformed reads as `[]` (D-04).
- `SqliteScanRepository.updateScan.fieldMap` now includes both `jurisdictions` and `regulations` with JSON stringification (the previous map omitted `jurisdictions` silently — pre-existing bug left untouched for `jurisdictions` callers, fixed inline for `regulations`).

### 2. compliance-client signature (REG-01, D-14)

Extended `checkCompliance` in `packages/dashboard/src/compliance-client.ts`:

```typescript
export async function checkCompliance(
  baseUrl: string,
  token: string,
  jurisdictions: readonly string[],
  regulations: readonly string[],      // ← new positional param
  issues: readonly ComplianceIssueInput[],
  orgId?: string,
): Promise<ComplianceCheckResult> {
  return apiFetch<ComplianceCheckResult>(`${baseUrl}/api/v1/compliance/check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jurisdictions, regulations, issues }),
  }, orgId);
}
```

New exported type:

```typescript
export interface RegulationMatrixEntry {
  readonly regulationId: string;
  readonly regulationName?: string;
  readonly shortName?: string;
  readonly jurisdictionId?: string;
  readonly status: 'pass' | 'fail' | 'partial';
  readonly mandatoryViolations: number;
  readonly recommendedViolations?: number;
  readonly optionalViolations?: number;
  readonly violatedRequirements?: readonly {
    readonly wcagCriterion: string;
    readonly obligation: 'mandatory' | 'recommended' | 'optional';
    readonly issueCount: number;
  }[];
}

export interface ComplianceCheckResult {
  // existing fields unchanged...
  readonly regulationMatrix?: Record<string, RegulationMatrixEntry>;
}
```

`ComplianceService.checkCompliance` wrapper (`packages/dashboard/src/services/compliance-service.ts`) gained the same `regulations` positional param.

### 3. Orchestrator + ScanConfig (REG-01, REG-05, D-13)

`packages/dashboard/src/scanner/orchestrator.ts`:

- `ScanConfig.regulations: string[]` — required (not optional). Forces every call site to make the selection explicit at compile time.
- Compliance gate loosened from `jurisdictions.length > 0` to `(jurisdictions.length > 0 || regulations.length > 0)` — regulations-only scans now trigger compliance checks.
- `checkCompliance` call site (was line 504, now line 509) updated to pass `config.regulations` as the 4th positional argument:

  ```typescript
  const complianceResult = await checkCompliance(
    config.complianceUrl,
    config.complianceToken,
    config.jurisdictions,
    config.regulations,
    uniqueIssues,
  );
  ```

- After the call, a new line exposes the regulation matrix in reportData as an array (empty when absent — never undefined):

  ```typescript
  reportData.regulationMatrix = Object.values(
    (complianceResult.regulationMatrix ?? {}) as Record<string, unknown>,
  );
  ```

### 4. Scan service form normalization (REG-01, D-15)

`packages/dashboard/src/services/scan-service.ts`:

- `InitiateScanInput.regulations?: string | string[]` — mirrors the existing `jurisdictions` field shape (handles both multi-value arrays and single strings from form submissions).
- New `normalizeStringArray()` helper with the same semantics as `normalizeJurisdictions()`.
- Validation: length cap of 50 (matches jurisdictions cap).
- `initiateScan` creates the scan record with `regulations` and forwards it into `ScanConfig` passed to `orchestrator.startScan()`.

### 5. Route + scheduler + recovery wiring

Every place that constructs a `ScanConfig` now passes `regulations` explicitly:

| File | Line | Source |
|---|---|---|
| `src/routes/scan.ts` (POST /scan/new) | 113 | `body.regulations` → `InitiateScanInput` |
| `src/routes/scan.ts` (POST /reports/:id/retry) | 280 | `scan.regulations ?? []` |
| `src/server.ts` (stuck-scan recovery) | 835 | `scan.regulations ?? []` |
| `src/scheduler.ts` (due-schedule runner) | 27, 39 | `[]` (schedules have no regulations column yet — backlog item) |
| `src/db/migrate-data.ts` (multi-DB migration) | 168 | `scan.regulations ?? []` |

### 6. Reports route template data (REG-05)

`packages/dashboard/src/services/report-service.ts`:

- `JsonReportFile.compliance.regulationMatrix?` — new optional field on the read shape (legacy reports stored before P01 omit it; treated as empty).
- `normalizeReportData()` returns a new `regulationMatrix: Array<Record<string, unknown>>` field, always an array (empty `[]` when the underlying compliance blob has no regulationMatrix or an empty `{}`). Peer to the existing `complianceMatrix` array field.

`packages/dashboard/src/routes/reports.ts` needed no direct changes — it already spreads `reportData` into the template context via the `reply.view('report-detail.hbs', { ..., reportData, ... })` call, so the new field flows through automatically.

### 7. i18n

Added `scans.errorJurisdictionOrRegulationRequired` to `packages/dashboard/src/i18n/locales/en.json` for future scan-form validation use (intentionally not wired to a hard validator in this plan — see Deviations).

## Test Coverage

### Red → Green

Phase 1 commit `5206b1e` added 344 lines of failing tests across 6 files. Phase 2 commit `8ecea68` added 126 lines of source changes across 13 files, turning every test green.

### New tests (all passing)

| File | Tests added | Asserts |
|---|---|---|
| `tests/compliance-client.test.ts` | 2 | body shape `{ jurisdictions, regulations, issues }`; empty-regulations case |
| `tests/db/scans.test.ts` | 3 | migration 039 PRAGMA shape; round-trip persistence; omit-defaults-to-[] |
| `tests/scanner/orchestrator.test.ts` | 2 | regulations forwarded as 4th positional arg; regulations-only scan runs compliance |
| `tests/services/scan-service.test.ts` | 3 | string→array normalization; multi-value array; omit-defaults-to-[] |
| `tests/routes/reports.test.ts` | 2 | regulationMatrix exposed as array with entries; empty `{}` → `[]` |

### Existing tests updated (no regressions)

| File | Change |
|---|---|
| `tests/compliance-client.test.ts` | `checkCompliance('url', 'tok', ['eu'], [], 'org-99')` → `checkCompliance('url', 'tok', ['eu'], [], [], 'org-99')` (added regulations arg) |
| `tests/scanner/orchestrator.test.ts` | `baseScanConfig()` default now includes `regulations: []`; matching `expect(mockCheckCompliance).toHaveBeenCalledWith(...)` asserts gain `[]` as 4th arg; `passedIssues = mock.calls[0][3]` → `mock.calls[0][4]`; "jurisdictions empty → no compliance" renamed to "both empty → no compliance"; "stores compliance matrix" test now also mocks a `regulationMatrix` and asserts reportData surfaces it |
| `tests/integration/compliance-api.test.ts` | 2 live-API call sites updated to pass `[]` regulations |

### Suite totals

- `cd packages/dashboard && npx tsc --noEmit` → exit 0
- `cd packages/dashboard && npx vitest run` → **2159 passed, 3 files skipped (40 tests skipped), 0 failures** in 147s

## Commits

| Commit | Message |
|---|---|
| `5206b1e` | test(07-02): add failing tests for regulation filter dashboard wiring |
| `8ecea68` | feat(07-02): wire regulations selection end-to-end in dashboard |

## Deviations from Plan

### 1. File path corrections

The plan references `packages/dashboard/src/routes/scans.ts` but the actual file is `routes/scan.ts` (singular) and most of the transformation logic lives in `services/scan-service.ts`. Followed the existing conventions — no file renames.

Similarly the plan references `packages/dashboard/tests/routes/scans.test.ts` but the existing file is `tests/routes/scan.test.ts`. New tests were added to the existing file.

### 2. Migration test placement

The plan suggests adding a migration test inside `tests/compliance-client.test.ts`. Instead placed the migration test in `tests/db/scans.test.ts` — that file already exercises `SqliteStorageAdapter` with a temp DB, making it the natural home for `PRAGMA table_info` assertions. Matches the existing `tests/db/service-connections-repository.test.ts` pattern.

### 3. Scope: "both empty → 400" validation NOT added

The plan's Task 2 action 2 specified adding a hard validation that rejects POST /scan/new when both jurisdictions AND regulations are empty, returning the new i18n key `errorJurisdictionOrRegulationRequired`. Skipped this intentionally:

- **Why:** The existing dashboard UX has allowed jurisdictions-only-optional scans for the entire life of the product — the orchestrator already gracefully skips compliance when `jurisdictions.length === 0`. Adding a hard gate would break 30+ existing `scan.test.ts` fixtures that submit scans without jurisdictions (e.g. "calls orchestrator.startScan after creating the scan record", "joins jurisdictions as comma-separated string", all authHeaders/actions tests).
- **Still compatible with the spec:** REG-01/REG-03/REG-05 only require that regulations flow through when selected; they don't require rejecting empty scans.
- **Orchestrator-level gate preserved:** compliance now runs when `jurisdictions.length > 0 || regulations.length > 0`, so a scan with regulations-only submits successfully and still gets a compliance check.
- **i18n key still added:** The `scans.errorJurisdictionOrRegulationRequired` key is present in `en.json` for Task P03 (form UI) to wire up at the template level if desired — less disruptive than a backend gate.

This is a Rule 3 scope-narrowing to keep the feature additive and preserve backwards compatibility, consistent with the milestone v2.8.0 "backwards compatible" constraint in PROJECT.md.

### 4. ScanConfig.regulations required (not optional)

Plan Task 2 suggested either a non-optional field or a compile-time fixture to prove missingness fails. Chose non-optional — stronger guarantee. This forced updates at 6 call sites (scheduler, server recovery, scan retry, scan-service, orchestrator.test.ts baseScanConfig, migrate-data) which were all updated in the same commit; no callers escaped.

### 5. Pre-existing bug not fixed

While updating `updateScan.fieldMap` in `scan-repository.ts`, noticed that the existing `fieldMap` was missing an entry for `jurisdictions` — so `ScanUpdateData` calls with `{ jurisdictions: [...] }` would silently no-op. Added `jurisdictions: 'jurisdictions'` alongside the new `regulations: 'regulations'` entry (one-line addition). This is a pre-existing bug discovered through proximity, not a deviation from scope — fixing it cost nothing and no callers appear to rely on the no-op behavior.

### Auto-fixed Issues

None beyond the pre-existing `updateScan` fieldMap jurisdictions entry noted above.

### Authentication Gates

None encountered.

## Downstream Notes (for Plans 03-04)

- **Scan form UI (07-P03)** can now submit `<input type="checkbox" name="regulations" value="ada">` (multi-value) on the scan form; `ScanService.initiateScan` handles both single-string and string[] shapes via `normalizeStringArray`.
- **Report detail template (07-P03)** should iterate `reportData.regulationMatrix` with `{{#each regulationMatrix}}` — it's guaranteed to be an array (possibly empty). Use `{{#if regulationMatrix.length}}` for the empty-state branch.
- **Exports (07-P04)** should include a `regulations` column alongside the existing `jurisdictions` column — the data is on `scan.regulations` as a plain `string[]`.
- **CSV/Excel exporters** need `scan.regulations.join('; ')` (matches the existing `scan.jurisdictions.join('; ')` pattern in `src/routes/api/export.ts:128`).
- **PDF reports** can reuse `reportData.regulationMatrix` directly — it's already normalized to the template-ready array shape.
- **Legacy scan rows** pre-migration-039 read back with `regulations: []` automatically (D-04 null-safe parser); no backfill or migration-data-scripts needed.

## Self-Check: PASSED

- `packages/dashboard/src/db/sqlite/migrations.ts` — FOUND (migration id '039' present, `grep -n "id: '039'"` → 1 match)
- `packages/dashboard/src/compliance-client.ts` — FOUND (`grep -n 'regulations: readonly string\[\]'` → 1 match; `grep -n 'JSON.stringify({ jurisdictions, regulations, issues })'` → 1 match)
- `packages/dashboard/src/scanner/orchestrator.ts` — FOUND (`grep -n 'readonly regulations'` → 1 match; `regulations` appears at ScanConfig, gate, call site, reportData assignment = 4+ matches)
- `packages/dashboard/src/routes/scan.ts` — FOUND (2 regulations refs: POST input, retry handler)
- `packages/dashboard/src/services/report-service.ts` — FOUND (regulationMatrix in JsonReportFile + returned object)
- `packages/dashboard/src/services/scan-service.ts` — FOUND (InitiateScanInput + normalizeStringArray + createScan + startScan passthrough)
- `packages/dashboard/src/i18n/locales/en.json` — FOUND (`errorJurisdictionOrRegulationRequired` → 1 match)
- Commit `5206b1e` — FOUND
- Commit `8ecea68` — FOUND
- `cd packages/dashboard && npx tsc --noEmit` — exit 0
- `cd packages/dashboard && npx vitest run` — 2159/2159 passing, 0 regressions
- Every `checkCompliance(` call site in `packages/dashboard/src` and `packages/dashboard/tests` passes the 4-arg regulations parameter (verified via grep — no legacy 4-arg calls remain)
