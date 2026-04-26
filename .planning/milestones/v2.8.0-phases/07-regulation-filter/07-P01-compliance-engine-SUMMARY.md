---
phase: 07-regulation-filter
plan: 01
subsystem: compliance-service
tags: [api, types, checker-engine, cache, tdd, backwards-compat]
requirements: [REG-02, REG-03, REG-04]
dependency-graph:
  requires: []
  provides:
    - "ComplianceCheckRequest.regulations (optional string[])"
    - "ComplianceCheckResponse.regulationMatrix (Record<string, RegulationMatrixEntry>)"
    - "RegulationMatrixEntry type"
    - "Exported cacheKey() function for unit testing"
  affects:
    - "packages/compliance/src/types.ts"
    - "packages/compliance/src/api/routes/compliance.ts"
    - "packages/compliance/src/engine/checker.ts"
tech-stack:
  added: []
  patterns:
    - "Additive API evolution (new optional input, new required output field)"
    - "Exported-for-test stable cache key"
key-files:
  created:
    - ".planning/phases/07-regulation-filter/07-P01-compliance-engine-SUMMARY.md"
  modified:
    - "packages/compliance/src/types.ts"
    - "packages/compliance/src/api/routes/compliance.ts"
    - "packages/compliance/src/engine/checker.ts"
    - "packages/compliance/tests/api/compliance.test.ts"
    - "packages/compliance/tests/engine/checker.test.ts"
decisions:
  - "Introduced new RegulationMatrixEntry type rather than extending the existing nested RegulationResult — avoids a breaking change to the 'pass'|'fail' union inside JurisdictionResult.regulations"
  - "Exported cacheKey() from routes/compliance.ts for direct unit-test access (D-06) — cleanest alternative to header-based assertions"
  - "regulationMatrix is always present on the response as {} when no regulations requested (REG-04) — field-shape stability over field-presence optionality"
  - "Checker uses resolveJurisdictionHierarchy() for each explicit regulation's home jurisdiction — ancestors are widened too so EU-hosted regulations like eu-eaa pick up DE->EU requirements correctly"
  - "Unknown regulation ids in the request are silently skipped (no throw, no warning in tests) — future dashboards may surface this via response metadata, but the contract is non-fatal"
  - "Jurisdiction matrix + summary computation left 100% unchanged — guarantees REG-04 byte-for-byte backwards compat for jurisdictions-only callers"
metrics:
  duration: "5min"
  tasks: 2
  completed: "2026-04-05"
  commits: 4
---

# Phase 07 Plan 01: Compliance Engine — Regulation Filter Foundation Summary

Extended `@luqen/compliance` so `POST /api/v1/compliance/check` accepts an optional `regulations[]` body field and returns a new `regulationMatrix` keyed by regulationId alongside the existing jurisdiction `matrix` — with exported cache-key unit testability and zero behavioural change for jurisdictions-only callers.

## Deliverables

### 1. Typed contract (`packages/compliance/src/types.ts`)

- `ComplianceCheckRequest.regulations?: readonly string[]` — optional, last optional field before `issues` (type-level non-breaking).
- New `RegulationMatrixEntry` interface:
  ```typescript
  export interface RegulationMatrixEntry {
    readonly regulationId: string;
    readonly regulationName: string;
    readonly shortName: string;
    readonly jurisdictionId: string;           // regulation's home jurisdiction
    readonly status: 'pass' | 'fail' | 'partial';
    readonly mandatoryViolations: number;
    readonly recommendedViolations: number;
    readonly optionalViolations: number;
    readonly violatedRequirements: readonly {
      readonly wcagCriterion: string;
      readonly obligation: 'mandatory' | 'recommended' | 'optional';
      readonly issueCount: number;
    }[];
  }
  ```
- `ComplianceCheckResponse.regulationMatrix: Record<string, RegulationMatrixEntry>` — required, non-optional. `{}` when no regulations requested.
- The nested `RegulationResult` inside `JurisdictionResult.regulations` is UNTOUCHED (still `'pass' | 'fail'` union, no `partial`). Downstream code that iterates jurisdiction-scoped regulation results is unaffected.

### 2. Route layer (`packages/compliance/src/api/routes/compliance.ts`)

- `cacheKey()` is now **exported** (was private). Downstream dashboard/test code can import it directly:
  ```typescript
  import { cacheKey } from '@luqen/compliance/dist/api/routes/compliance.js';
  ```
- Stable JSON key now includes `regulations: [...(body.regulations ?? [])].sort()` — same request with different regulation scope produces distinct keys (D-06).
- Validation relaxed (D-05a): 400 is returned only when BOTH `jurisdictions` and `regulations` are empty. Error message: `'jurisdictions or regulations array is required'`.
- `body.jurisdictions` and `body.regulations` are normalized to `[]` before being passed to `checkCompliance` and `cacheKey` so downstream code can safely assume arrays.

### 3. Checker engine (`packages/compliance/src/engine/checker.ts`)

- **Step 3b (new):** For each `requestedRegulations[i]`, call `db.getRegulation(regId)`. Unknown ids are silently dropped. Known regulations' home jurisdictions are added to `resolvedJurisdictionIds` via `resolveJurisdictionHierarchy()` (ancestors included) — this is D-08 widening, ensuring requirement queries reach regulations whose home jurisdiction the caller did not explicitly list.
- **Step 7b (new):** Build `regulationMatrix`. For each explicitly requested regulation, filter `requirements` to that regulation, match against `parsedIssues`, aggregate violations per (criterion, obligation) pair, and derive status via D-12 union:
  - `mandatory > 0` → `'fail'`
  - otherwise `(recommended > 0 || optional > 0)` → `'partial'`
  - otherwise → `'pass'`
- **Step 7 (jurisdiction matrix) unchanged** — iterates the originally-requested `jurisdictions` list. For regulations-only callers this list is empty so `matrix: {}` naturally (meeting the REG-04 backwards-compat contract).
- **Step 8 (summary) unchanged** — iterates `matrix` only, so jurisdictions-only summary numbers are byte-for-byte identical.

## Test Coverage

### API tests (`tests/api/compliance.test.ts`) — 6 new

| # | Name | Asserts |
|---|---|---|
| A | REG-02 accept regulations[] | 200 + `regulationMatrix` object present |
| B | regulations-only (empty jurisdictions) | 200 (NOT 400) |
| C | both empty → 400 | error = 'jurisdictions or regulations array is required' |
| D | regulationMatrix default {} | field present as `{}` when regulations omitted |
| E | REG-04 legacy shape preserved | exhaustive top-level keys = `[annotatedIssues, matrix, regulationMatrix, summary]` |
| F | cacheKey divergence (D-06) | direct import, assert keys differ + sort-stable |

### Engine tests (`tests/engine/checker.test.ts`) — 6 new

| # | Name | Asserts |
|---|---|---|
| T1 | D-31 jurisdictions-only unchanged | `regulationMatrix === {}`, matrix/summary populated |
| T2 | REG-03 mixed | both matrices populated, summary unchanged |
| T3 | regulations-only | `matrix: {}`, `regulationMatrix['eu-eaa']` populated |
| T4 | D-08 home-jurisdiction widening | us-508 matched via widened US set |
| T5 | unknown regulation id | no throw, key absent from regulationMatrix |
| T6 | D-12 status union | fail/partial/pass triangulation including inline scratch regulation |

### Existing tests preserved — 0 regressions

All pre-existing compliance tests continue to pass unchanged:
- `tests/engine/checker.test.ts` — 14 pre-existing tests (shape, EU failing, EU passing, multi-jurisdiction, DE→EU inheritance, annotated issues, explicit 1.1.1, includeOptional, sectors filter, summary consistency, unparseable codes, dedup, per-criterion counts)
- `tests/api/compliance.test.ts` — 7 pre-existing tests (matrix, annotated, inheritance, summary, empty, validation, auth)
- **Full compliance suite: 531 → 537 tests, all passing.**

## Commits

| Commit | Message |
|---|---|
| `bb5d4ee` | test(07-01): add failing tests for regulations filter contract |
| `73709a5` | feat(07-01): extend types, validation, and cache key for regulations filter |
| `3a70533` | test(07-01): add failing tests for checker regulationMatrix |
| `afb45fa` | feat(07-01): checker builds regulationMatrix from explicit regulations |

## Deviations from Plan

### Test file location

The plan references `packages/compliance/src/engine/checker.test.ts` (co-located), but the actual project convention places engine tests in `packages/compliance/tests/engine/checker.test.ts`. Followed the existing convention (Rule 3 — blocking mismatch resolved by aligning with codebase). All 6 new engine tests were added to the existing `tests/engine/checker.test.ts` file.

### Snapshot testing

Plan suggested `toMatchSnapshot` for Test E (REG-04). Instead used an exhaustive top-level-key assertion (`Object.keys(body).sort()` equality) — stronger than a stored snapshot and avoids snapshot-file maintenance. Also asserts `regulationMatrix === {}` directly.

### Placeholder in Task 1

Task 1's type change (making `regulationMatrix` a required response field) forced an immediate checker update in the same commit — otherwise `tsc` would fail. Added a minimal `regulationMatrix: {} = {}` placeholder in the Task 1 commit; Task 2 then replaced it with the real population loop. This is a benign split-commit sequence consistent with TDD's "keep build green between steps".

### Auto-fixed Issues

None — plan executed cleanly.

### Authentication Gates

None encountered.

## Downstream Notes (for Plans 02-04)

- **Dashboard wiring (07-P02)** can import the exported `cacheKey` directly from the compliance package if it needs to prewarm or invalidate cache entries for specific requests.
- **Scan form UI (07-P03)** should send `regulations: []` (empty array) on jurisdictions-only submissions — the route accepts both `undefined` and `[]` identically, but explicit `[]` makes the contract self-documenting.
- **Exports (07-P04)** should iterate `response.regulationMatrix` as a first-class peer to `response.matrix`; both are always present.
- **Status filtering:** downstream code handling `RegulationMatrixEntry.status` must cover three cases (`'pass' | 'fail' | 'partial'`), NOT the two cases of nested `RegulationResult.status`.

## Self-Check: PASSED

- `packages/compliance/src/types.ts` — FOUND (modified)
- `packages/compliance/src/api/routes/compliance.ts` — FOUND (modified)
- `packages/compliance/src/engine/checker.ts` — FOUND (modified)
- `packages/compliance/tests/api/compliance.test.ts` — FOUND (modified)
- `packages/compliance/tests/engine/checker.test.ts` — FOUND (modified)
- Commit `bb5d4ee` — FOUND
- Commit `73709a5` — FOUND
- Commit `3a70533` — FOUND
- Commit `afb45fa` — FOUND
- `cd packages/compliance && npx tsc --noEmit` — exit 0
- `cd packages/compliance && npx vitest run` — 537/537 passing
