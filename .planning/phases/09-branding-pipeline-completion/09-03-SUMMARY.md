---
phase: 09-branding-pipeline-completion
plan: "03"
subsystem: dashboard/branding
tags: [branding, fixtures, integration-test, aperol, bst-01, bst-02, tdd]
dependency_graph:
  requires: [09-01, 09-02]
  provides: [aperol-brand-fixtures, branding-pipeline-aperol-tests]
  affects: []
tech_stack:
  added: []
  patterns: [fixture-driven integration tests, service-layer TDD with real SQLite]
key_files:
  created:
    - packages/dashboard/tests/fixtures/aperol-brand/guideline.json
    - packages/dashboard/tests/fixtures/aperol-brand/scan-report.json
    - packages/dashboard/tests/integration/branding-pipeline-aperol.test.ts
  modified: []
decisions:
  - "Tests went directly to GREEN — implementation from plans 01+02 already satisfies all pipeline assertions; no additional implementation required"
  - "Fixture brand-relevance detection uses hex color match in context HTML + CSS selector substring match — consistent with BrandingMatcher logic"
  - "Amber (#FF8C00) included as secondary color so T4 (guideline update retag) proves coverage expansion"
metrics:
  duration: "2 minutes"
  completed: "2026-04-06"
  tasks_completed: 2
  files_changed: 3
---

# Phase 09 Plan 03: Aperol Brand Pipeline Integration Tests Summary

**One-liner:** Created Aperol brand fixtures (4 colors, 2 fonts, 2 selectors, 10-issue scan) and a 4-test full pipeline integration test proving create->assign->scan->retag->enrichment with no false positives, idempotency, and color expansion.

## What Was Done

### Task 1: Aperol Brand Snapshot Fixtures

Created two fixture files in `packages/dashboard/tests/fixtures/aperol-brand/`:

**guideline.json** — Aperol brand guideline:
- 4 colors: Aperol Orange (`#FF5F15`), White (`#FFFFFF`), Dark (`#1A1A1A`), Aperol Amber (`#FF8C00`)
- 2 fonts: Aperol Display (display, weights 400/700/900) and Helvetica Neue (body, weights 300/400/500)
- 2 selectors: `.hero-banner` and `.brand-cta`

**scan-report.json** — Realistic pa11y-shaped scan report:
- 2 pages: homepage and `/cocktails`
- 10 issues total (WCAG2AA codes, types, messages, selectors, context HTML)
- 4 brand-relevant issues: 3 referencing `#FF5F15` in context, 1 referencing `#FF8C00`, 2 using `.brand-cta` selector
- 6 non-brand issues: missing alt text, empty anchor, search input contrast, navigation structure, heading hierarchy

### Task 2: Aperol Brand Pipeline Integration Test

Created `packages/dashboard/tests/integration/branding-pipeline-aperol.test.ts` with 4 tests:

**T1 (BST-02 full pipeline):** `create guideline from fixture -> assignToSite -> insert completed scan with fixture jsonReport -> retagAllSitesForGuideline -> verify scan.brandRelatedCount > 0 and report.branding.guidelineId matches`

**T2 (no false positives):** After retag, all non-brand issues (no color hex / no brand selector in context) have `undefined` brandMatch; all brand-tagged issues have `brandMatch.matched === true`

**T3 (idempotent retag):** Running `retagAllSitesForGuideline` twice yields identical `brandRelatedCount` in the DB row and identical `report.branding.brandRelatedCount` in jsonReport

**T4 (guideline update retag):** Seeds guideline with only Aperol Orange; retags; records count. Adds Aperol Amber; retags again. Verifies `countWithBothColors >= countWithOrangeOnly`

## Deviations from Plan

**TDD RED/GREEN note:** Tests went directly to GREEN — no RED phase needed. The `branding-retag.ts` service (plan 01) and `branding-repository.ts` patterns (existing) already implement all pipeline steps. The plan's `tdd="true"` attribute is appropriate for new features; here the tests validate existing implementation through a new fixture-driven scenario.

## Self-Check

### Files Created

- `packages/dashboard/tests/fixtures/aperol-brand/guideline.json` — created
- `packages/dashboard/tests/fixtures/aperol-brand/scan-report.json` — created
- `packages/dashboard/tests/integration/branding-pipeline-aperol.test.ts` — created

### Commits

- `b9d5ec8`: feat(09-03): Aperol brand snapshot fixtures
- `8aaa53e`: test(09-03): Aperol brand pipeline integration tests (BST-01, BST-02)

### Verification

- `node -e "..."` fixture parse: guideline colors: 4 fonts: 2, scan pages: 2 issues: 10 ✓
- `npx vitest run tests/integration/branding-pipeline-aperol.test.ts`: 4/4 passed ✓
- Full integration suite: 133 passed, 36 skipped (expected — missing services), 0 failed ✓

## Known Stubs

None — all fixture data flows through real pipeline (real BrandingMatcher, real SQLite, real retag service).

## Self-Check: PASSED
