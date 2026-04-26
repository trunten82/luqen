# Project Research Synthesis — v2.11.0 Brand Intelligence

**Project:** Luqen v2.11.0 — Brand Intelligence
**Domain:** Brand accessibility scoring + per-org dual-mode orchestrator routing (additive)
**Researched:** 2026-04-10
**Confidence:** HIGH

---

## Executive Summary

v2.11.0 is an **additive milestone** layered on mature v2.8.0–v2.10.0 foundations (service-connections registry, branding matcher, retag pipeline). It ships two orthogonal capabilities: (1) a quantified 0–100 brand accessibility score with color-contrast, typography, and component sub-scores persisted per scan for trending, and (2) a per-org dual-mode orchestrator that routes branding match+score through the existing embedded in-process path OR the long-dormant remote `@luqen/branding` REST service. **No new npm dependencies are required** — the recommended path uses a ~40-line in-tree `wcag-math.ts` module and reuses the Chart.js CDN already sanctioned by `views/trends.hbs`.

The critical architectural finding is that **the remote branding service has zero scan-time consumers today** — `BrandingService` (the dashboard client class) is defined but never instantiated, and the scanner orchestrator (`scanner/orchestrator.ts:547`) imports `BrandingMatcher` in-process. v2.11.0 is the first milestone where "embedded vs remote" becomes a user-visible choice. This truth drives the key design decisions: scoring must live in the **dashboard** as a pure calculator (identical output regardless of mode), the orchestrator must live **above** `ServiceClientRegistry` (not inside it), and fallback between modes must be **explicit and non-silent** to avoid silently corrupting trend data.

Top risks are: score normalization drift (guidelines with unequal category coverage), WCAG AA/AAA threshold confusion across packages, trend schema drift if score categories are stored as nullable wide columns, and silent dual-mode fallback during service outages. All four are preventable with early contract decisions: tagged-union score type, single-source `wcagContrastPasses()` utility, normalized score persistence with `coverage_profile` + `unscorable_reason`, and a no-cross-route policy where service outages produce **degraded scans** rather than silent embedded reruns.

---

## Key Findings

### Recommended Stack

**Zero new npm dependencies.** See STACK.md for full rationale.

**Core (all already present — reuse):**
- TypeScript 5.9.3 / Fastify 5 — monorepo standard
- better-sqlite3 11.x — new `brand_scores` table via migration 043
- Zod 4.3.6 — score payload boundary validation
- Handlebars 4.7.8 — new `brand-score-panel.hbs` + `brand-score-widget.hbs` partials
- Chart.js 4.5.1 (CDN) — already loaded in `views/trends.hbs:171`; CSP already whitelists `cdn.jsdelivr.net` (`server.ts:228`)
- Inline SVG `<polyline>` — hand-rolled sparkline for dashboard widget (zero-JS, no new dep)

**New in-tree code (no libraries):**
- `wcag-math.ts` — ~40 lines, WCAG 2.1 relative luminance + contrast ratio (spec frozen)
- `typography-score.ts` — heuristics on declared CSS values (body ≥16px, line-height ≥1.5×, brand-font adherence)
- `token-score.ts` — pure set-diff between used tokens and brand tokens

**Explicitly NOT:** `colorjs.io` (80 KB+ overkill), `apca-w3` (WCAG 3 draft would mismatch scanner), `opentype.js` / `fontkit` (450 KB+, no font files available), any second charting library.

### Expected Features

See FEATURES.md. Must-have for v2.11.0 coherence:

- **TS-1** Color contrast sub-score (aggregates existing `Guideline1_4.1_4_3` / `1_4_6` / `1_4_11` issue codes)
- **TS-2** 0–100 normalization with **pinned 50/30/20 weights** (locked)
- **TS-3** Typography sub-score (reduced scope: font availability + min 16px body + line-height ≥1.5)
- **TS-4** Component sub-score (SelectorMatcher aggregation; `N/A` not `0` when selectors empty)
- **TS-5** Composite score with fixed weights
- **TS-6** Per-scan score persistence (new `brand_scores` table, append-only)
- **TS-7** Report detail panel (composite + 3 sub-scores + delta)
- **TS-8** Graceful "no guideline linked" state
- **TS-9** Per-org dual-mode routing (embedded / remote)
- **TS-10** Test-connection button for remote branding service
- **TS-11** Org dashboard widget (big number + trend arrow + inline SVG sparkline)
- **D-1** Brand vs non-brand issue split counters (cheap win)
- **D-4** "Reset to system default" on per-org mode

**Defer to v2.12.0:** D-2 (per-dimension trend semantics), D-3 (score target line), D-5 (drilldown modal), x-height metric, letter/word-spacing metrics.

**Anti-features (explicitly NOT building):** per-org weight customization, APCA/WCAG 3 scoring, A/B/C/D/F letter grades, cross-org leaderboards, hot-swap mid-scan, custom sub-score dimensions, email alerts on regression.

### Architecture Approach

One new orchestration layer in the dashboard; **zero changes** to `ServiceClientRegistry`. Pattern: Adapter + Orchestrator. Both `EmbeddedBrandingAdapter` (wraps existing in-process path) and `RemoteBrandingAdapter` (finally instantiates the dormant `BrandingService`) satisfy the same interface and return the same `BrandedIssue[]` shape. `BrandScoreCalculator` (pure function, no IO) runs in the dashboard on whichever adapter's output was returned. Scores persist to dashboard-local `brand_scores` so trend queries never depend on the remote service being up.

**Major components:**

1. **`BrandingOrchestrator`** (NEW, dashboard) — single entry point for "match + score" at scan and retag time. Reads `orgs.branding_mode` per-request and picks the adapter. **No caching.**
2. **`EmbeddedBrandingAdapter`** (NEW wrapper around existing code) — mechanical extraction of the current `storage.branding` + in-process `BrandingMatcher` path behind the interface.
3. **`RemoteBrandingAdapter`** (NEW) — thin wrapper over `BrandingService` (which itself uses `ServiceClientRegistry.getBrandingTokenManager()`, unchanged).
4. **`BrandScoreCalculator`** (NEW, pure) — `(brandedIssues, guideline) → ScoreBreakdown`. Same result regardless of which adapter produced the input.
5. **`BrandScoreRepository`** (NEW) — CRUD over new `brand_scores` table.
6. **`ScannerOrchestrator`** (MODIFIED, `scanner/orchestrator.ts:547`) — replace inline `storage.branding.getGuidelineForSite` + dynamic import with orchestrator calls.
7. **`branding-retag.ts`** (MODIFIED) — same replacement.
8. **Score panel + widget partials** (NEW Handlebars) — server-side render only, never browser-side HTMX to the branding service.

**Migration 043 (LOCKED):**

```sql
CREATE TABLE IF NOT EXISTS brand_scores (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scan_records(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  guideline_id TEXT,
  guideline_version INTEGER,
  overall INTEGER,                         -- NULL when unscorable
  color_contrast INTEGER,                  -- NULL when no applicable data
  typography INTEGER,
  components INTEGER,
  coverage_profile TEXT NOT NULL,          -- JSON: which categories contributed
  unscorable_reason TEXT,                  -- 'empty-guideline' | 'no-guideline' | NULL
  brand_related_count INTEGER NOT NULL DEFAULT 0,
  total_issues INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL,                      -- 'embedded' | 'remote'
  computed_at TEXT NOT NULL
);
CREATE INDEX idx_brand_scores_scan ON brand_scores(scan_id);
CREATE INDEX idx_brand_scores_org_site ON brand_scores(org_id, site_url, computed_at);

ALTER TABLE organizations
  ADD COLUMN branding_mode TEXT NOT NULL DEFAULT 'embedded';
```

Note: Architecture originally proposed `NOT NULL` on all score columns; Pitfalls #3 and #4 argue for nullable + `coverage_profile` + `unscorable_reason` to preserve "not measured" vs "scored zero" distinction. This synthesis **locks in nullable + coverage profile**.

### Critical Pitfalls (top 5 from PITFALLS.md)

1. **Score normalization drift across unequal category coverage** (Pitfalls #1, #3, #4 combined) — Unweighted mean across optional categories produces non-comparable scores when a guideline gains a category. **Avoid:** tagged-union score type `{ kind: 'scored' | 'unscorable', coverage }`, persist `coverage_profile` per row, never `null → 0` coercion, never backfill historical `0`. **Phase:** Scoring Model (before persistence/UI).

2. **WCAG AA/AAA threshold confusion across packages** (Pitfall #2) — Literal `4.5`/`3`/`7` inlined at comparison sites causes dashboard vs service disagreement. **Avoid:** single `wcagContrastPasses(ratio, level, isLargeText)` utility, no literals elsewhere, fixture tests at boundaries (4.49/4.50/4.51/6.99/7.00/7.01). **Phase:** Scoring Model.

3. **Dual-mode silent fallback corrupts trend data** (Pitfall #6) — `try { service } catch { embedded }` silently switches data sources during outage, producing fake regressions. **Avoid:** service-mode failure → scan marked `degraded` with `unscorable_reason`, NEVER rerouted. Trend line renders dashed gap for degraded segments. **Phase:** Dual-Mode phase (contract in PROJECT.md Decisions before code).

4. **Pre-v2.11.0 scans rendering `undefined` / broken panels** (Pitfall #8) — Old scans have no scores; INNER JOIN drops them; templates without guards render empty. **Avoid:** `LEFT JOIN` with explicit NULL filter, `{{#if brandScore}}` guards, open an old scan as part of UAT. **Phase:** Report UI Integration.

5. **Per-scan scoring blows up scan latency** (Pitfall #10) — Naive impl adds a second HTTP call to branding service on every scan. **Avoid:** scoring runs on data ALREADY matched during the scan (one `matchIssues` call, not two). Baseline benchmark in PR, <15% regression gate. **Phase:** Scoring Integration.

Secondary watchlist: HTMX OOB inside `<tr>` requires `<template>` wrapping (Pitfall #9, v2.9.0 lesson); credential leakage (#7) is only relevant IF per-org secrets are introduced — they are NOT in v2.11.0.

---

## Reconciliation of Research Divergences

### 1. Scoring location — RESOLVED: Dashboard, not `@luqen/branding`

**Divergence:** Stack proposed `packages/branding/src/scoring/` + new `POST /api/v1/score` endpoint. Architecture insisted the calculator lives in the dashboard as a pure function.

**Decision:** Scoring lives in the **dashboard**:
- `packages/dashboard/src/services/brand-score-calculator.ts` — pure `(BrandedIssue[], BrandGuideline) → ScoreBreakdown`
- `packages/dashboard/src/services/scoring/wcag-math.ts`
- `packages/dashboard/src/services/scoring/typography-score.ts`
- `packages/dashboard/src/services/scoring/token-score.ts`

**Rationale against Stack's proposal:**
- The remote `@luqen/branding` service has **zero scan-time consumers today** — `BrandingService` is defined but never instantiated. Adding a `POST /api/v1/score` endpoint inside a service that isn't wired into the scan path would mean building route/auth/tests for something the dashboard would *also* need in-process for embedded mode.
- If scoring lived in the branding service, embedded mode would need its own copy → two codepaths → Pitfall #2 (AA/AAA drift across packages) becomes inevitable.
- Scoring is a pure read-only aggregation on top of `BrandedIssue[]`. Both adapters return the same unified shape. Placing the pure function at the adapter boundary means **one implementation runs identically regardless of mode**.
- Dashboard SQLite is local; scoring queries never depend on the remote service being up (reinforces Pitfall #6 prevention).

**Consequence for `@luqen/branding`:** No new scoring code lands there in v2.11.0. Its `matcher/` is reused unchanged. If a future milestone adds real consumers, scoring can be lifted into a shared package without losing a line.

### 2. Dual-mode mechanism — RESOLVED: `BrandingOrchestrator` above an untouched `ServiceClientRegistry`

**Divergence:** Stack proposed reusing `ServiceClientRegistry` via a new `OrgBrandingResolver` + `orgs.branding_mode` column. Architecture proposed a new `BrandingOrchestrator` one layer up with zero registry changes. Pitfalls proposed mirroring `reload()` with `reloadOrg(orgId)`.

**Decision:** New **`BrandingOrchestrator`** at `packages/dashboard/src/services/branding-orchestrator.ts`, above `ServiceClientRegistry`. The registry is **unchanged**. There is **no `reloadOrg`** because there is **no per-org cache to invalidate**.

**Rationale:**
- The registry's contract is "one live client per service, hot-swappable on URL/secret change." That is exactly right because **there is only one remote branding service**. Dual-mode is per-org *routing*, not per-org *clients*. All orgs in `service` mode share the same `brandingTokenManager`.
- Mirroring `reload()` with `reloadOrg()` would solve a cache-invalidation problem this design deliberately doesn't create: `BrandingOrchestrator.matchForSite()` reads `orgs.branding_mode` **per-request** (one SQLite lookup, trivially cheap next to the scan). No module-level map, no startup cache, no request-scope cache. When admin flips mode, the next scan sees the new value — no invalidation needed.
- Pitfall #5 (stale cache) is prevented by writing the "no cache" rule into PROJECT.md Decisions. Code-review checklist: any `const mode = await getMode(orgId)` outside a request handler is rejected.
- Stack's `OrgBrandingResolver` and Architecture's `BrandingOrchestrator` are the same idea with different names. "Orchestrator" wins because it correctly implies "chooses + coordinates match AND score AND persistence" which "resolver" undersells.

**What changes in `ServiceClientRegistry`:** Nothing. Zero lines. `BrandingService` finally gets instantiated in `server.ts` and the orchestrator depends on it via constructor injection.

### 3. Composite score weights — RESOLVED: LOCK 50/30/20 for v2.11.0

**Divergence:** Features proposed hardcoded 50/30/20. Pitfalls flagged weights as an open question.

**Decision:** **Lock** `{color: 0.50, typography: 0.30, components: 0.20}` as constants in `packages/dashboard/src/services/scoring/weights.ts`. Not per-org overridable. Documented in PROJECT.md Key Decisions.

**Rationale:**
- Competitive parity: every serious scorer pins weights for cross-tenant comparability.
- Anti-feature A-1 (per-org customization) breaks trend lines permanently — historical scores mean something different the moment weights change.
- Color dominates because contrast is highest user-facing impact and where scanner data is most complete.
- Orgs wanting different priorities can view sub-scores directly (the report panel and widget expose all three alongside the composite).
- Revisit v2.12.0+ behind a `schemaVersion` bump so old scores render with a "Legacy" band (Pitfall #1 recovery strategy).

### 4. Backfill strategy — RESOLVED: Forward-only, no backfill

**Divergence:** Architecture and Pitfalls both flagged as open. Features assumed forward-only.

**Decision:** **No backfill.** Existing pre-v2.11.0 scans have no `brand_scores` rows. Trend widgets render "no trend yet" until new scans accumulate. Report detail pages show an empty-state panel for pre-v2.11.0 scans.

**Rationale:**
- Matches v2.8.0 retag precedent (forward-only, retag on next scan).
- Avoids a long, resumable migration that would need to rescore history under guidelines that may have changed/been deleted.
- Pitfall #8 is addressed by explicit `{{#if brandScore}}` template guards + LEFT JOIN, NOT by fake zero scores.
- An **optional** admin action "Rescore historical scans" can be added in v2.12.0+ if users ask — idempotent, skip-when-guideline-gone, progress-reporting, resumable. **Not v2.11.0.**
- PROJECT.md Decision to log: "Historical brand score backfills forbidden — `0` is never a substitute for 'not measured.'"

### 5. Migration number — LOCKED: 043

Both Stack and Architecture confirm 042 is latest in `packages/dashboard/src/db/sqlite/migrations.ts`. Migration 043 is a single atomic change containing `brand_scores` table, its two indexes, and the `organizations.branding_mode` column. Either the whole milestone's schema lands or none of it does.

---

## Implications for Roadmap

Suggested 7-phase structure. Every phase leaves master deployable.

### Phase 15: Scoring Model & Contract
**Rationale:** All other phases depend on the score type and contrast utility. Must land before persistence/adapters/UI.
**Delivers:** Pure `BrandScoreCalculator` with tagged-union return, `wcag-math.ts`, `typography-score.ts`, `token-score.ts`, locked weights constants, unit + property/fuzz tests proving no NaN, no null propagation, coverage profile preserved.
**Addresses:** TS-1, TS-2, TS-3 (reduced), TS-4, TS-5
**Avoids:** Pitfalls #1, #2, #4

### Phase 16: Persistence Layer (Migration 043 + Repository)
**Rationale:** Repo must exist before scanner writes scores; calculator contract (Phase 15) determines schema shape. Once 043 lands, all new code is unreached.
**Delivers:** Migration 043, `BrandScoreRepository` interface + SQLite impl, `OrgRepository.getBrandingMode/setBrandingMode`.
**Avoids:** Pitfall #3 (nullable score columns + coverage profile — no wide NOT NULL columns; no backfill zero)

### Phase 17: Adapters & BrandingOrchestrator
**Rationale:** Depends on Phases 15–16; must exist before scanner rewire.
**Delivers:** `BrandingAdapter` interface, `EmbeddedBrandingAdapter` (extraction refactor), `RemoteBrandingAdapter` (finally instantiates dormant `BrandingService`), `BrandingOrchestrator` with per-request mode resolution AND explicit no-cross-route fallback policy.
**Avoids:** Pitfalls #5, #6
**Decision gate before code:** PROJECT.md logs "Dual-mode fallback policy: service mode outage → scan marked degraded with `unscorable_reason`. Never silent cross-route."

### Phase 18: Scanner & Retag Integration
**Rationale:** "Moment of truth." Requires Phases 15–17 complete. Feature-flag if risk is uncomfortable.
**Delivers:** `scanner/orchestrator.ts:547` rewire, `services/branding-retag.ts` rewire, every completed scan writes a `brand_scores` row, latency baseline + <15% regression gate in PR.
**Avoids:** Pitfall #10 (one `matchIssues` call per scan, not two; scoring failure non-blocking per v2.9.0 retag pattern)

### Phase 19: Admin Dual-Mode UI
**Rationale:** Mode toggle useless until Phases 17–18 prove two real paths work.
**Delivers:** `GET/POST /admin/orgs/:id/branding-mode`, toggle on org edit page, two-step confirmation, "Reset to system default" button, test-connection button routing through **same production code path** and echoing `routedVia: 'embedded' | 'service'`.
**Addresses:** TS-9, TS-10, D-4
**Avoids:** Pitfall #5 (no short-circuit test button), UX mode-flip-without-confirmation. Permission: `organizations.manage` (existing).

### Phase 20: Report Detail Brand Score Panel
**Rationale:** Depends on Phase 18; visual-only.
**Delivers:** `views/partials/brand-score-panel.hbs` on `report-detail.hbs`, server-side data via `storage.brandScores.getLatestForScan`, 4 progress bars color-banded by existing `style.css` classes (green ≥85, amber 70–84, red <70), delta arrow vs previous, explicit `{{#if brandScore}}` guard for pre-v2.11.0 scans.
**Addresses:** TS-7, TS-8, D-1
**Avoids:** Pitfall #8
**UAT:** Open a pre-v2.11.0 scan and verify empty-state rendering, not `undefined` / `NaN%` / broken layout.

### Phase 21: Home Dashboard Brand Score Widget
**Rationale:** Depends on Phase 18. Can ship parallel to Phase 20.
**Delivers:** `views/partials/brand-score-widget.hbs`, server-render on home route, big number + trend arrow + delta + inline SVG `<polyline>` sparkline, graceful 0/1-score empty states, mobile breakpoint verified.
**Addresses:** TS-11
**Avoids:** Pitfall #9 (if widget is ever OOB-swapped from a `<tr>` action, wrap in `<template>`)
**UAT:** Mobile layout, sparkline on 5–10 scan history, widget update after fresh scan.

### Phase Ordering Rationale

- Scoring first because its type is a contract every layer depends on.
- Persistence second because the repo depends on calculator output shape.
- Adapters + orchestrator third because scanner rewire needs the orchestrator ready.
- Scanner rewire fourth — highest-risk phase, requires all preceding. Latency benchmark gate.
- Admin UI fifth — meaningless without two working paths + proven scan integration.
- Report panel + widget last — pure UI, can swap order or ship in parallel.

### Research Flags

**Phases likely needing `/gsd-research-phase` during planning:**
- **Phase 17 (Adapters & Orchestrator)** — First real consumer of `BrandingService`. Research needed: existing `POST /api/v1/match` request/response contract shape match vs embedded matcher output, token manager behavior under load, degraded-scan data path end-to-end.
- **Phase 18 (Scanner Integration)** — Latency baseline methodology (sites, run count, cold/warm), retag edge cases (retag producing `unscorable` when new guideline is empty), feature-flag design.

**Phases with standard patterns (skip research-phase):**
- **Phase 15 (Scoring Model)** — WCAG 2.1 math frozen, heuristics straightforward, tagged-union is standard TS.
- **Phase 16 (Persistence)** — Same pattern as the last 42 migrations.
- **Phase 19 (Admin UI)** — v2.8.0 service-connections admin page is the direct template.
- **Phase 20 (Report Panel)** — Standard Handlebars partial + existing `style.css` classes.
- **Phase 21 (Widget)** — Well-worn home-tile pattern; ~15 lines of inline SVG; only risk is HTMX OOB caveat (known lesson).

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | First-party codebase inspection; zero new deps; all reuse targets verified in files |
| Features | MEDIUM-HIGH | Scoring methodology HIGH (WCAG 2.1 canonical); dual-mode UX MEDIUM (v2.8.0 internal precedent); competitor comparison MEDIUM (vendor docs) |
| Architecture | HIGH | First-party codebase inspection with exact file/line refs; the dormant `BrandingService` stub is a smoking gun for the correct dual-mode shape |
| Pitfalls | HIGH | Grounded in v2.8.0–v2.10.0 incidents in this same codebase |

**Overall: HIGH.** Additive milestone on mature foundations. Main unknowns are operational (latency baseline, retag edge cases), not design-level.

### Gaps to Address

- **Branding service availability assumption** — Validate in Phase 17 planning: is `@luqen/branding` actually running on lxc-luqen? Which port? Can we OAuth now? If not, Phase 17 needs a stubbed integration target and Phase 19 test-connection becomes the first real end-to-end validation.
- **Retag + score interaction** — When retag produces new `BrandedIssue[]`, append new row (not replace). Architecture and Pitfall #3 both support append; lock in Phase 16.
- **Coverage profile serialization** — JSON blob vs normalized `brand_score_categories` table? Pitfall #3 strongly prefers normalized; Architecture used JSON. Resolve in Phase 16: lock normalized table, OR justify JSON with explicit "always filter `WHERE json_extract(coverage_profile, '$.color') IS NOT NULL`" rule.
- **Scoring weights file location** — `packages/dashboard/src/services/scoring/weights.ts`. If a future milestone lifts scoring into a shared package, weights move too. Document this in a comment block.
- **Per-org OAuth client for branding** — OUT of scope. All orgs share global branding OAuth client; `X-Org-Id` header handles isolation. If future work introduces per-org branding secrets, Pitfall #7 activates and security-reviewer must run.
- **Latency benchmark methodology** — TBD in Phase 18 planning (sites, runs, cold/warm protocol).
- **i18n coverage** — All new UI strings (score labels, empty states, mode language, degraded explanations) use `{{t}}` across en/fr/it/pt/de/es. Track in each phase's Done definition.

---

## Sources

### Primary — First-party codebase (HIGH)

- `/root/luqen/packages/dashboard/src/services/service-client-registry.ts`
- `/root/luqen/packages/dashboard/src/services/branding-service.ts` — defined-but-unused remote wrapper; instantiated in Phase 17
- `/root/luqen/packages/dashboard/src/services/branding-retag.ts` — existing embedded path
- `/root/luqen/packages/dashboard/src/scanner/orchestrator.ts` (lines 540–590)
- `/root/luqen/packages/dashboard/src/db/sqlite/migrations.ts` (lines 1011–1155) — 042 latest; 043 is next
- `/root/luqen/packages/dashboard/src/db/interfaces/branding-repository.ts`
- `/root/luqen/packages/dashboard/src/views/trends.hbs` (line 171) — Chart.js 4 CDN pattern
- `/root/luqen/packages/dashboard/src/server.ts` (line 228) — CSP whitelist `cdn.jsdelivr.net`
- `/root/luqen/packages/dashboard/src/views/report-detail.hbs` (lines 94, 270)
- `/root/luqen/packages/branding/src/api/server.ts` (lines 505–547) — remote `POST /api/v1/match`
- `/root/luqen/packages/branding/src/matcher/index.ts`
- `/root/luqen/packages/branding/src/matcher/color-matcher.ts`
- `/root/luqen/packages/branding/src/utils/color-utils.ts`
- `/root/luqen/packages/branding/src/types.ts`
- `/root/luqen/packages/dashboard/src/branding-client.ts`
- `/root/luqen/.planning/PROJECT.md`

### Secondary — WCAG / methodology (MEDIUM)

- WCAG 2.1 SC 1.4.3, 1.4.6, 1.4.11, 1.4.12 (W3C Understanding docs)
- WebAIM Contrast, Typefaces and Fonts
- Section508.gov Fonts and Typography
- Chart.js 4.5.1 API docs

### Secondary — Competitor scoring (MEDIUM, vendor docs)

- Siteimprove Accessibility Site Target Score, Compliance Progress
- Monsido accessibility features review
- W3C Design Tokens Community Group

---
*Research completed: 2026-04-10*
*Ready for roadmap: yes*
