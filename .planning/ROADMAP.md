# Luqen v2.11.0 Roadmap — Brand Intelligence

**Status:** Active
**Milestone:** v2.11.0
**Last Updated:** 2026-04-10

## Phases

- [x] **Phase 15: Scoring Model & Contract** — Pure calculator, WCAG math utility, locked weights, tagged-union score type (completed 2026-04-10)
- [ ] **Phase 16: Persistence Layer** — brand_scores schema + per-org branding mode column + repository APIs
- [ ] **Phase 17: Branding Orchestrator** — Dual-mode (embedded/remote) orchestrator invoking calculator, returning unified result
- [ ] **Phase 18: Scanner Wire-Up** — Scanner calls orchestrator, persists scores, preserves backwards compatibility
- [ ] **Phase 19: Admin UI (Mode Toggle)** — Per-org toggle between embedded and remote branding with calibration check
- [ ] **Phase 20: Report Panel** — Per-scan brand score panel on scan report
- [ ] **Phase 21: Dashboard Widget** — Org-level brand intelligence card on dashboard homepage

---

### Phase 15: Scoring Model & Contract
**Goal**: Dashboard has a single pure brand score calculator that produces identical output across embedded and remote modes, with an unambiguous "unscorable" distinction from "scored zero"
**Depends on**: Nothing (first phase of v2.11.0)
**Requirements**: BSCORE-01, BSCORE-02, BSCORE-03, BSCORE-04, BSCORE-05
**Success Criteria** (what must be TRUE):
  1. Developer can call `calculateBrandScore(brandedIssues, guideline)` and receive a tagged-union result `{ kind: 'scored', overall, color, typography, components, coverage } | { kind: 'unscorable', reason }` — no `null → 0` coercion anywhere
  2. Color contrast sub-score aggregates existing `Guideline1_4_3 / 1_4_6 / 1_4_11` matched issues through a single `wcagContrastPasses(ratio, level, isLargeText)` utility — no literal `4.5 / 3 / 7` thresholds appear anywhere else in the dashboard
  3. Typography sub-score reflects brand-font availability, body text ≥16px, and line-height ≥1.5 derived from declared CSS values
  4. Component sub-score returns `unscorable` (not `0`) when the guideline has no component selectors; otherwise computes a pure set-diff between used and brand tokens
  5. Composite score is computed via locked weights `{color: 0.50, typography: 0.30, components: 0.20}` exported from a single `weights.ts` constants module — not per-org overridable
**Plans**: 4 plans
  - [x] 15-01-PLAN.md — Types + Weights foundation (ScoreResult/SubScore/CoverageProfile/UnscorableReason tagged unions + locked WEIGHTS constant) [Wave 1]
  - [x] 15-02-PLAN.md — WCAG math utility (wcagContrastPasses single source of truth + D-18 boundary fixtures + D-07 fs-based enforcement guard) [Wave 2]
  - [x] 15-03-PLAN.md — Sub-score calculators (color pass ratio, typography 3-heuristic mean, token set-diff with bounded ReDoS-safe regex) [Wave 3]
  - [x] 15-04-PLAN.md — Composite calculator entry point (calculateBrandScore with renormalization, all 6 UnscorableReasons covered, all 4 composite paths tested) [Wave 4]

### Phase 16: Persistence Layer
**Goal**: Dashboard has a typed `brand_scores` repository persisting append-only score rows plus a per-org `branding_mode` column, both delivered by an atomic migration 043 — preserving the "not measured vs scored zero" distinction at the schema level
**Depends on**: Phase 15 (consumes `ScoreResult`/`SubScore`/`CoverageProfile`/`UnscorableReason` types)
**Requirements**: BSTORE-01
**Success Criteria** (what must be TRUE):
  1. Migration 043 atomically creates the `brand_scores` table, its two indexes (`idx_brand_scores_scan`, `idx_brand_scores_org_site`), and the `organizations.branding_mode` column (default `'embedded'`) in a single transaction — either all of it lands or none of it does
  2. `brand_scores` schema preserves "not measured vs scored zero": score columns (`overall`, `color_contrast`, `typography`, `components`) are NULLable INTEGER, `coverage_profile` is non-null TEXT (JSON), `unscorable_reason` is nullable TEXT, plus `mode` ('embedded'|'remote'), `brand_related_count`, `total_issues`, `computed_at`
  3. `BrandScoreRepository` exposes typed `insert(scoreResult, scanContext)`, `getLatestForScan(scanId)`, and `getHistoryForSite(orgId, siteUrl, limit)` methods — consumes Phase 15 `ScoreResult` on write and returns `ScoreResult` on read, with no `number | null` leakage across the boundary
  4. `OrgRepository` gains `getBrandingMode(orgId): 'embedded' | 'remote'` and `setBrandingMode(orgId, mode)` — literal types, no caching layer (matches PROJECT.md decision: per-request reads, never cached)
  5. Phase 16 is migration + repository only — no scanner/orchestrator/UI is wired in this phase; the existing dashboard test suite passes unchanged after migration runs
**Plans**: 3 plans
  - [ ] 16-01-PLAN.md — Migration 043: brand_scores table + indexes + organizations.branding_mode (atomic) + PRAGMA-introspection test [Wave 1]
  - [ ] 16-02-PLAN.md — BrandScoreRepository interface + SQLite impl + StorageAdapter wiring + ScoreResult round-trip tests [Wave 2]
  - [ ] 16-03-PLAN.md — OrgRepository.getBrandingMode/setBrandingMode extension + Organization.brandingMode domain field + round-trip tests [Wave 2]

