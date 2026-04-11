# Luqen v2.11.0 Roadmap — Brand Intelligence

**Status:** Active
**Milestone:** v2.11.0
**Last Updated:** 2026-04-10

## Phases

- [x] **Phase 15: Scoring Model & Contract** — Pure calculator, WCAG math utility, locked weights, tagged-union score type (completed 2026-04-10)
- [x] **Phase 16: Persistence Layer** — brand_scores schema + per-org branding mode column + repository APIs (completed 2026-04-11)
- [x] **Phase 17: Branding Orchestrator** — Dual-mode (embedded/remote) orchestrator invoking calculator, returning unified result (completed 2026-04-11)
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
  - [x] 16-01-PLAN.md — Migration 043: brand_scores table + indexes + organizations.branding_mode (atomic) + PRAGMA-introspection test [Wave 1]
  - [x] 16-02-PLAN.md — BrandScoreRepository interface + SQLite impl + StorageAdapter wiring + ScoreResult round-trip tests [Wave 2]
  - [x] 16-03-PLAN.md — OrgRepository.getBrandingMode/setBrandingMode extension + Organization.brandingMode domain field + round-trip tests [Wave 2]

### Phase 17: Branding Orchestrator
**Goal**: Dashboard has a single `BrandingOrchestrator` that, on each request, reads `orgs.branding_mode` (via Phase 16's OrgRepository) and routes "match + score" to either an embedded adapter (refactored in-process matcher) or a remote adapter (instantiates the dormant `BrandingService`), returning a unified scored result — with an explicit no-cross-route fallback policy that marks service-mode outages as `degraded` rather than silently rerouting to embedded mode
**Depends on**: Phase 15 (`calculateBrandScore`), Phase 16 (`OrgRepository.getBrandingMode`, `ScoreResult` types ready for downstream persistence)
**Requirements**: BMODE-01, BMODE-02, BMODE-05
**Success Criteria** (what must be TRUE):
  1. `BrandingAdapter` interface defines a single typed `matchForSite(input): Promise<BrandedIssue[]>` method (or equivalently shaped contract); both `EmbeddedBrandingAdapter` and `RemoteBrandingAdapter` implement it and return the same `BrandedIssue[]` shape — no shape divergence between modes
  2. `EmbeddedBrandingAdapter` is a mechanical extraction of the existing in-process branding matcher path (currently inlined in `scanner/orchestrator.ts`) — same matcher, same output, behind the new interface; refactor only, no behavior change
  3. `RemoteBrandingAdapter` instantiates the dormant `BrandingService` (which uses the existing `ServiceClientRegistry.getBrandingTokenManager()`), calls the remote `POST /api/v1/match`, and returns `BrandedIssue[]` — `ServiceClientRegistry` is **unchanged** (zero new methods, zero modified methods)
  4. `BrandingOrchestrator.matchAndScore(input)` reads `orgs.branding_mode` per-request via `OrgRepository.getBrandingMode(orgId)`, picks the adapter, calls Phase 15's `calculateBrandScore` on the returned `BrandedIssue[]`, and returns a unified `ScoredMatchResult` consumed by Phase 18 — NO caching, NO module-level state, NO request-scope memoization (grep for `cache` in orchestrator returns 0)
  5. When the remote adapter throws (service outage, OAuth failure, network error), `BrandingOrchestrator` returns a `degraded` result tagged with the originating mode and an `unscorable_reason` — NEVER falls back to embedded mode silently. An explicit unit test proves a failing remote adapter does NOT invoke the embedded adapter.
**Plans**: 3 plans
  - [x] 17-01-PLAN.md — BrandingAdapter interface + EmbeddedBrandingAdapter (refactor of in-process matcher path) + contract test [Wave 1]
  - [x] 17-02-PLAN.md — RemoteBrandingAdapter wrapping dormant BrandingService + type-guard validation + RemoteBrandingMalformedError + 10 request/response/error tests [Wave 2]
  - [x] 17-03-PLAN.md — BrandingOrchestrator (per-request mode read, no-cross-route fallback, calculator wiring) + server.ts DI wiring + 10 unit tests + UAT-17-01 branding service liveness checkpoint [Wave 3]
