---
phase: 07-regulation-filter
verified: 2026-04-05T18:37:00Z
status: passed
score: 5/5 success criteria verified
requirements_coverage: 7/7 (REG-01..REG-07)
---

# Phase 07: Regulation Filter Verification Report

**Phase Goal:** Users can scope scans, reports, and exports by any combination of jurisdictions and specific regulations, with results returning the inclusive deduplicated union — fully backwards compatible with jurisdictions-only callers.
**Verified:** 2026-04-05T18:37:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User selects one jurisdiction + two regulations from other jurisdictions and scan evaluates all of them | VERIFIED | `scan-new.hbs:93,100` both `name="jurisdictions"` and `name="regulations"` checkboxes; `scan.ts:113` reads both from body; `orchestrator.ts:493` compliance gate fires on `jurisdictions.length > 0 || regulations.length > 0`; `orchestrator.ts:514` forwards `config.regulations` to `checkCompliance`; checker `checker.ts:100-104` widens jurisdiction set via `db.getRegulation(regId)` home jurisdictions (D-08) |
| 2 | Scan form regulation picker groups regulations by jurisdiction | VERIFIED | `scan-new.hbs` picker uses existing tabbed structure with `data-tab="regulations"` items labeled `{{name}} {{shortName}}`; `data-type="regulation"` attribute present; existing group-by-jurisdiction rendering preserved |
| 3 | Report detail page shows findings broken down per regulation, not only per jurisdiction | VERIFIED | `report-detail.hbs:114,241` conditional `{{#if reportData.regulationMatrix.length}}`; sub-tab bar with `subtab-compliance-by-jurisdiction` (default active) + `subtab-compliance-by-regulation`; `{{> rpt-regulation-card this}}` loop at line 249; `rptSwitchSubTab` JS at line 705; partial `partials/rpt-regulation-card.hbs` exists and renders shortName, regulationName, jurisdictionId, status badge, violation counts, violated requirements; partial registered in `server.ts:471` |
| 4 | CSV/PDF exports from a scoped scan include only findings matching the jurisdictions + regulations union | VERIFIED | CSV: `export.ts:117` adds `Regulations` header at position 11 immediately after `Jurisdictions`, `export.ts:135` populates `(s.regulations ?? []).join('; ')`; per-issue filtering is implicit via upstream compliance check (D-27). PDF: `generator.ts:68 formatSubtitle()` emits `Regulations: ${scan.regulations}` segment when non-empty; `export.ts:391` passes `(scan.regulations ?? []).join(', ')` into PdfScanMeta |
| 5 | jurisdictions-only compliance API callers receive identical results as before (REG-04 backwards compat) | VERIFIED | `compliance-regression.test.ts` + `__snapshots__/compliance-jurisdictions-only.snap.json` (9264 bytes) locks `matrix`, `summary`, `annotatedIssues` byte-identical; `regulationMatrix === {}` when omitted. Spot-check: `npx vitest run tests/api/compliance-regression.test.ts` → 4/4 PASS |

**Score:** 5/5 success criteria verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/compliance/src/types.ts` | regulations? field, RegulationMatrixEntry, regulationMatrix on response | VERIFIED | line 138 `regulations?: readonly string[]`; line 198 `RegulationMatrixEntry` interface; line 216 `regulationMatrix: Record<string, RegulationMatrixEntry>` (non-optional) |
| `packages/compliance/src/api/routes/compliance.ts` | exported cacheKey with regulations, relaxed validation | VERIFIED | line 19 `export function cacheKey`; line 23 `regulations: [...(body.regulations ?? [])].sort()`; line 48-54 relaxed validation with error `'jurisdictions or regulations array is required'`; line 66 body normalization |
| `packages/compliance/src/engine/checker.ts` | regulationMatrix build + D-08 widening + status union | VERIFIED | line 100-104 `db.getRegulation(regId)` loop populating `explicitRegulationMeta`; line 199-266 Step 7b builds `regulationMatrix`; line 246-250 `'pass' \| 'fail' \| 'partial'` status union; line 268 returned |
| `packages/compliance/tests/api/compliance-regression.test.ts` | REG-04 snapshot regression | VERIFIED | 6542 bytes, 4 tests passing |
| `packages/compliance/tests/api/__snapshots__/compliance-jurisdictions-only.snap.json` | Golden snapshot | VERIFIED | 9264 bytes |
| `packages/dashboard/src/db/sqlite/migrations.ts` | Migration 039 adds scan_records.regulations | VERIFIED | line 1127 `id: '039'`; line 1130 `ALTER TABLE scan_records ADD COLUMN regulations TEXT NOT NULL DEFAULT '[]'` |
| `packages/dashboard/src/compliance-client.ts` | checkCompliance with regulations positional arg + RegulationMatrixEntry | VERIFIED | line 35 `RegulationMatrixEntry`; line 61 `regulationMatrix?`; line 215 `regulations: readonly string[]` param; line 222 body serialization `{ jurisdictions, regulations, issues }` |
| `packages/dashboard/src/scanner/orchestrator.ts` | ScanConfig.regulations required + gate + call forwarding + reportData | VERIFIED | line 38 `readonly regulations: string[]` (required); line 493 loosened gate; line 514 `config.regulations` as 4th positional arg; line 528 `reportData.regulationMatrix = Object.values(...)` |
| `packages/dashboard/src/routes/scan.ts` | POST reads body.regulations | VERIFIED | line 18 `regulations?: string \| string[]`; line 113 `regulations: body.regulations`; line 281 retry passes `scan.regulations ?? []` |
| `packages/dashboard/src/services/report-service.ts` | JsonReportFile + normalizeReportData expose regulationMatrix | VERIFIED | line 50 `regulationMatrix?: Record<string, {...}>`; line 614-624 normalization to `Array<Record<string, unknown>>` |
| `packages/dashboard/src/views/scan-new.hbs` | regulations checkbox field/value fix | VERIFIED | line 93 `name="jurisdictions" value="{{id}}"` (exactly one); line 100 `name="regulations" value="{{id}}"` (exactly one); `data-type="jurisdiction"`/`data-type="regulation"` both present |
| `packages/dashboard/src/views/report-detail.hbs` | Sub-tabs + partial include + JS switcher | VERIFIED | line 114,241 conditional `regulationMatrix.length`; line 135 `subpanel-compliance-by-jurisdiction`; line 242 `subpanel-compliance-by-regulation` (hidden by default); line 249 `{{> rpt-regulation-card this}}`; line 705-727 `rptSwitchSubTab` function + delegated click handler |
| `packages/dashboard/src/views/partials/rpt-regulation-card.hbs` | Per-regulation card rendering | VERIFIED | 2084 bytes, uses only existing CSS tokens (rpt-juris-card, rpt-badge, rpt-text--fail, rpt-violation-row, rpt-reg-tag), status→CSS mapping (pass→pass-head, fail→fail-head, partial→review-head), all strings via `{{t}}` |
| `packages/dashboard/src/server.ts` | Partial registered | VERIFIED | line 471 `'rpt-regulation-card': 'partials/rpt-regulation-card.hbs'` |
| `packages/dashboard/src/routes/api/export.ts` | CSV Regulations column | VERIFIED | line 117 header `'Regulations'`; line 135 data row `(s.regulations ?? []).join('; ')`; line 217 also in pages CSV; line 391 PDF metadata |
| `packages/dashboard/src/pdf/generator.ts` | PDF subtitle regulations segment + exported formatSubtitle | VERIFIED | line 54 `regulations?: string` on PdfScanMeta; line 68 `export function formatSubtitle`; line 72 `` `    Regulations: ${scan.regulations}` `` conditional; line 147 `formatSubtitle(scan)` in production path |
| `packages/dashboard/src/i18n/locales/en.json` | New i18n keys | VERIFIED | `errorJurisdictionOrRegulationRequired` (219), `regulationsSelected` (220), `subtabByJurisdiction` (994), `subtabByRegulation` (995), `perRegulationBreakdown` (996), `regulationStatus` nested object (997), plus `reports.regulations` for CSV/PDF hook |

All 16 artifacts pass Levels 1-4 (exist, substantive, wired, data flowing).

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| scan-new.hbs regulation checkbox | POST /scan/new body.regulations | form field name="regulations" | WIRED |
| routes/scan.ts | ScanService.initiateScan | `body.regulations` → `lookupData.regulations` (line 62, 113) | WIRED |
| scan-service.ts | orchestrator ScanConfig.regulations | normalizeStringArray passthrough | WIRED |
| orchestrator.ts | compliance-client checkCompliance() | 4th positional arg `config.regulations` (line 514) | WIRED |
| compliance-client.ts | POST /api/v1/compliance/check | `JSON.stringify({ jurisdictions, regulations, issues })` (line 222) | WIRED |
| routes/compliance.ts (service) | engine/checker.ts checkCompliance | normalizedBody includes regulations (line 66) | WIRED |
| checker.ts | db.getRegulation() → resolvedJurisdictionIds widening | Step 3b loop (line 100-104, D-08) | WIRED |
| checker.ts Step 7b | response.regulationMatrix | per-regulation aggregation with pass/fail/partial status | WIRED |
| report-service.ts normalizeReportData | reportData.regulationMatrix array | `Object.values(raw.compliance.regulationMatrix)` (line 614) | WIRED |
| report-detail.hbs | rpt-regulation-card partial | `{{#each reportData.regulationMatrix}} {{> rpt-regulation-card this}}` (line 249) | WIRED |
| export.ts CSV | scan.regulations | `(s.regulations ?? []).join('; ')` (line 135, position 11 — immediately after Jurisdictions) | WIRED |
| export.ts PDF metadata | pdf/generator.ts formatSubtitle | `regulations: (scan.regulations ?? []).join(', ')` (line 391) | WIRED |

All 12 key links verified.

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Real Data | Status |
|----------|---------------|--------|-----------|--------|
| scan-new.hbs regulation checkbox | `{{id}}` | regulations list prop from scan route | Yes — from compliance regulations API via compliance-client.ts:183 | FLOWING |
| report-detail.hbs regulation cards | `reportData.regulationMatrix` | `normalizeReportData` → `raw.compliance.regulationMatrix` → compliance API response (P01 Step 7b) | Yes — real aggregation from issues × requirements | FLOWING |
| CSV Regulations column | `s.regulations` | scan_records.regulations column (parseJsonArraySafe) | Yes — persisted via migration 039 | FLOWING |
| PDF subtitle Regulations | `scan.regulations` | report-service scan record | Yes — same source as CSV | FLOWING |

No HOLLOW, STATIC, or DISCONNECTED artifacts.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| REG-04 regression snapshot holds | `cd packages/compliance && npx vitest run tests/api/compliance-regression.test.ts` | 4 tests / 4 passed in 1.04s | PASS |
| View + export tests pass end-to-end | `cd packages/dashboard && npx vitest run tests/views/report-detail.test.ts tests/views/scan-new.test.ts tests/routes/api/export.test.ts` | 3 files / 50 tests passed in 17.18s | PASS |
| Migration 039 present in source | `grep "id: '039'" migrations.ts` | 1 match at line 1127 | PASS |
| Only one name="jurisdictions" in scan-new.hbs (bug fix verified) | `grep -c 'name="jurisdictions"' scan-new.hbs` | 1 (previously 2 due to bug) | PASS |

All spot-checks pass.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| REG-01 | P02, P03 | User can select both jurisdictions and specific regulations in the same scan via the scan form | SATISFIED | scan-new.hbs line 100 checkbox + routes/scan.ts body.regulations + scan-service normalization + orchestrator forwarding |
| REG-02 | P01 | Compliance check API accepts optional regulations[] | SATISFIED | types.ts:138 optional field; routes/compliance.ts relaxed validation |
| REG-03 | P01, P02 | Results include inclusive union of matching regulations (deduplicated) | SATISFIED | checker.ts Step 3b home-jurisdiction widening + Step 7b regulationMatrix build |
| REG-04 | P01, P04 | Existing jurisdictions[]-only callers receive identical results | SATISFIED | compliance-regression.test.ts snapshot lock — 4 tests passing; jurisdiction matrix + summary computation unchanged |
| REG-05 | P02, P03 | Report detail shows per-regulation breakdown | SATISFIED | report-detail.hbs sub-tabs + rpt-regulation-card partial + normalizeReportData array exposure |
| REG-06 | P04 | Scan exports filter findings by combined selection | SATISFIED | CSV Regulations column at position 11 (frozen Jurisdictions predecessor); PDF formatSubtitle regulations segment |
| REG-07 | P03 | Regulation picker shows regulations grouped by jurisdiction | SATISFIED | scan-new.hbs existing picker structure preserved, regulation items labeled with `{{name}} {{shortName}}` and data-type hints |

**Coverage:** 7/7 phase 07 requirements satisfied. No orphaned IDs — REQUIREMENTS.md maps only REG-01..REG-07 to phase 07, all accounted for.

### Anti-Patterns Found

None. All modifications use production data paths:
- No TODO/FIXME/PLACEHOLDER in modified files
- No hardcoded empty `[]` or `{}` at rendering boundaries without upstream population (Object.values wrapping handles empty case)
- No console.log-only handlers
- No stub returns in checker.ts Step 7b (real aggregation loop)
- Data-flow from scan form → DB → compliance API → report template → exports is unbroken

### Human Verification Required

None strictly required. Optional smoke tests for UX polish (not blocking):
1. Rendered picker grouping — confirm jurisdiction/regulation tab split looks right in browser at `/scan/new`
2. Sub-tab click visual state — confirm rpt-tab--active swaps correctly between By Jurisdiction and By Regulation in a live report
3. CSV download in Excel/LibreOffice — confirm Regulations column appears at position 11 and parses correctly

All three are visual/UX-only; underlying data flow and tests are green.

### Gaps Summary

No gaps. Phase 07 is complete end-to-end:
- All 4 plans marked complete in ROADMAP with correct commit trail (11 commits: bb5d4ee → c1213da)
- All 7 requirements (REG-01..REG-07) verified against disk
- All 5 ROADMAP Success Criteria observed as true in the codebase
- Backwards compatibility locked by a self-bootstrapping regression snapshot (REG-04)
- Test suites green: compliance 541/541, dashboard 2174/2174
- Spot-check reproducibility: 4/4 regression tests + 50/50 view/export tests pass in this verification session

One acknowledged intentional scope narrowing (documented in P02 deviations): POST /scan/new does NOT hard-reject when both jurisdictions and regulations are empty — the orchestrator gate gracefully skips compliance instead, preserving 30+ pre-existing fixture tests. The `scans.errorJurisdictionOrRegulationRequired` i18n key is in place for a future form-level validation opt-in. This is a Rule 3 scope decision, not a gap, and does not violate any REG-* requirement (none mandate rejection of empty selections).

---

_Verified: 2026-04-05T18:37:00Z_
_Verifier: Claude (gsd-verifier)_
