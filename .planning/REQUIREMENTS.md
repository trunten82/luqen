# Requirements — v2.11.0 Brand Intelligence

**Milestone:** v2.11.0 Brand Intelligence
**Goal:** Give orgs a quantified, trended brand accessibility score and per-org deployment flexibility (embedded vs remote branding service).

---

## v1 Requirements

### Brand Scoring (BSCORE)

- [ ] **BSCORE-01**: User can see a 0-100 color contrast sub-score derived from existing WCAG 1.4.3 / 1.4.6 / 1.4.11 issues matched to brand colors
- [ ] **BSCORE-02**: User can see a 0-100 typography sub-score based on brand font availability, minimum 16px body text, and line-height ≥1.5
- [ ] **BSCORE-03**: User can see a 0-100 component sub-score derived from brand token vs used token set-diff (N/A when guideline has no component selectors)
- [ ] **BSCORE-04**: System computes a composite overall brand score using locked `{color: 0.50, typography: 0.30, components: 0.20}` weights — not per-org customizable
- [ ] **BSCORE-05**: System handles unscorable cases (no guideline linked, empty guideline, missing category data) with tagged-union score type — never `null → 0` coercion

### Persistence & Trend (BSTORE)

- [ ] **BSTORE-01**: System applies migration 043 adding `brand_scores` table (nullable score columns + `coverage_profile` + `unscorable_reason`) and `organizations.branding_mode` column
- [ ] **BSTORE-02**: System writes one append-only `brand_scores` row per scan completion (scanner orchestrator), including composite + 3 sub-scores + coverage profile + mode + timestamps
- [ ] **BSTORE-03**: System writes one append-only `brand_scores` row per retag completion (branding-retag) without overwriting prior rows — trend preserves history
- [ ] **BSTORE-04**: User can see brand score history via server-side LEFT JOIN queries that include pre-v2.11.0 scans (NULL handled as empty-state, not zero)
- [ ] **BSTORE-05**: User can see brand-related issue count vs total issue count (`X of Y issues are on brand elements`) on report panel — cheap differentiator from existing matcher output
- [ ] **BSTORE-06**: System does NOT backfill historical scans — pre-v2.11.0 scans render empty-state, never fake `0` scores

### Orchestrator Dual-Mode (BMODE)

- [ ] **BMODE-01**: System provides a `BrandingAdapter` interface with `EmbeddedBrandingAdapter` (wraps existing in-process path) and `RemoteBrandingAdapter` (finally instantiates dormant `BrandingService`) — both return unified `BrandedIssue[]` shape
- [ ] **BMODE-02**: System provides a `BrandingOrchestrator` in the dashboard that reads `orgs.branding_mode` per-request (no caching) and routes match+score calls to the correct adapter; `ServiceClientRegistry` is unchanged
- [ ] **BMODE-03**: Admin user (permission `organizations.manage`) can flip per-org branding mode via org edit page with two-step confirmation and a "Reset to system default" action
- [ ] **BMODE-04**: Admin user can click a test-connection button that routes through the **production** code path and returns `routedVia: 'embedded' | 'service'` + success/failure status
- [ ] **BMODE-05**: System marks scans as `degraded` with `unscorable_reason` when service-mode branding is unreachable — NEVER silently reroutes to embedded; trend line renders dashed gap for degraded segments

### UI Surfaces (BUI)

- [ ] **BUI-01**: User can see a Brand Score panel on the report detail page showing composite + 3 sub-scores, delta vs previous scan, brand-vs-non-brand counter, and empty-state for pre-v2.11.0 scans
- [ ] **BUI-02**: User can see a Brand Score widget on the home dashboard showing big number + trend arrow + delta + inline SVG `<polyline>` sparkline (zero-JS, accessible with sr-only description)
- [ ] **BUI-03**: All new UI strings (panel, widget, admin mode toggle, empty states, degraded explanations) are translated via `{{t}}` helpers across en/fr/it/pt/de/es
- [ ] **BUI-04**: Branding service appears in System Health page, sidebar links, and any newly added admin sections with consistent status / badge / link patterns matching compliance and LLM services

---

## Future Requirements (deferred, not in v2.11.0)

- **BSCORE-f01**: Per-dimension trend semantics (separate sparklines for color / typography / components) — v2.12.0+
- **BSCORE-f02**: Score target line (org sets goal, widget shows gap) — v2.12.0+
- **BSCORE-f03**: Drilldown modal from widget to individual failing elements — v2.12.0+
- **BSCORE-f04**: Typography x-height metric (requires opentype.js feasibility spike) — v2.12.0+
- **BSCORE-f05**: Letter/word-spacing metrics — v2.12.0+
- **BSTORE-f01**: Optional admin action "Rescore historical scans" — idempotent, resumable, skip-when-guideline-gone — v2.12.0+
- **BSTORE-f02**: Retention policy for `brand_scores` table (>10k scans/day) — v2.12.0+
- **BMODE-f01**: Per-org branding OAuth credentials (not just routing) — only if a real need emerges

---

## Out of Scope (v2.11.0)

- **Per-org weight customization** — breaks cross-tenant comparability and permanently corrupts trend lines when changed
- **APCA / WCAG 3.0 scoring** — spec still draft as of 2026-04; would fragment trend history if switched later
- **A/B/C/D/F letter grades** — numeric scores are sufficient and industry-standard
- **Cross-org leaderboards** — org isolation rule; comparability between orgs is not a feature
- **Hot-swap mid-scan mode flips** — mode changes take effect on the next scan only; eliminates race-condition surface
- **Custom sub-score dimensions** — users cannot add new categories; breaks weight-lock invariant
- **Email alerts on regression** — no alerting infrastructure in v2.11.0; handled by existing scan notifications
- **Backfill of historical scores** — PROJECT.md Decision: `0` is never a substitute for "not measured"
- **Silent dual-mode cross-fallback** — service outage produces degraded scan, never reroutes transparently
- **Per-org branding OAuth credentials** — all orgs share the global branding OAuth client; `X-Org-Id` header provides isolation
- **Chart library for sparkline** — inline SVG `<polyline>` is sufficient; no new dep
- **Scoring inside `@luqen/branding` package** — single calculator in dashboard ensures identical output across embedded and remote modes

---

## Traceability

Every v1 requirement is mapped to exactly one phase. UI i18n sweep (BUI-03) is anchored to Phase 21 as a cross-cutting sweep-and-verify phase covering strings introduced in phases 19, 20, and 21.

| REQ-ID     | Phase | Success Criterion |
|------------|-------|-------------------|
| BSCORE-01  | 15    | Color contrast sub-score uses single `wcagContrastPasses` utility — no literal thresholds elsewhere |
| BSCORE-02  | 15    | Typography sub-score reflects font availability + body ≥16px + line-height ≥1.5 |
| BSCORE-03  | 15    | Component sub-score returns `unscorable` (not `0`) when guideline has no component selectors |
| BSCORE-04  | 15    | Composite uses locked `{color:0.50, typography:0.30, components:0.20}` weights from `weights.ts` |
| BSCORE-05  | 15    | Calculator returns tagged union `{scored | unscorable}` — no `null → 0` coercion |
| BSTORE-01  | 16    | Migration 043 atomically adds `brand_scores` table + indexes + `organizations.branding_mode` column |
| BSTORE-02  | 18    | Every new scan writes one append-only `brand_scores` row with composite + 3 sub-scores + coverage |
| BSTORE-03  | 18    | Every retag run writes one additional `brand_scores` row — prior rows preserved |
| BSTORE-04  | 18    | Trend queries use LEFT JOIN — pre-v2.11.0 scans render empty-state, no fabricated zeros |
| BSTORE-05  | 20    | Report panel shows `X of Y issues are on brand elements` counter from existing matcher output |
| BSTORE-06  | 18    | No backfill migration exists; pre-v2.11.0 scans carry NULL scores forever |
| BMODE-01   | 17    | `BrandingAdapter` interface satisfied by both `EmbeddedBrandingAdapter` and `RemoteBrandingAdapter` |
| BMODE-02   | 17    | `BrandingOrchestrator` reads `orgs.branding_mode` per-request; `ServiceClientRegistry` unchanged |
| BMODE-03   | 19    | Admin with `admin.system` flips mode via two-step confirmation + "Reset to system default" (permission locked as `admin.system` in Phase 19 Plan 01 `<permission_decision>`; a finer-grained org-scoped manage permission is a v2.12.0+ followup) |
| BMODE-04   | 19    | Test-connection button routes through production code path, returns `routedVia: 'embedded'|'service'` |
| BMODE-05   | 17    | Service outage → scan tagged `degraded` with `unscorable_reason`, NEVER silent cross-route |
| BUI-01     | 20    | Report detail shows composite + 3 sub-scores + delta + brand-vs-non-brand counter + empty state |
| BUI-02     | 21    | Home dashboard widget: big number + trend arrow + delta + inline SVG `<polyline>` sparkline |
| BUI-03     | 21    | All new strings across phases 19/20/21 translated via `{{t}}` in en/fr/it/pt/de/es (sweep phase) |
| BUI-04     | 19    | Branding service appears on System Health, sidebar, admin sections with consistent patterns |

**Coverage:** 20/20 v1 requirements mapped ✓ — no orphans, no duplicates.

---
*Last updated: 2026-04-10 — traceability populated by gsd-roadmapper*
