# Stack Research — v2.11.0 Brand Intelligence

**Domain:** Brand accessibility scoring + per-org dual-mode routing (additive to existing Luqen monorepo)
**Researched:** 2026-04-10
**Confidence:** HIGH

## TL;DR

**No new architectural dependencies required.** Every capability needed for v2.11.0 either already exists in the codebase, or can be satisfied by a ~25 KB in-tree math module plus reuse of the Chart.js CDN pattern already sanctioned in `views/trends.hbs`. The dual-mode orchestrator is a pure reuse of the v2.8.0 `ServiceClientRegistry` pattern — no new infrastructure, only a new `BrandingResolver` abstraction behind a feature flag column.

## Recommended Stack

### Core Technologies (all already present — reuse)

| Technology | Current Version | Purpose | Why Recommended |
|------------|-----------------|---------|-----------------|
| TypeScript | 5.9.3 | Type system | Already the monorepo standard — no change |
| Fastify | 5.x | HTTP server | All services already on Fastify 5; branding service REST API is already exposed here |
| better-sqlite3 | 11.x | Score + trend persistence | Already used by `@luqen/branding` and `@luqen/dashboard`; trend rows are a new table alongside `branding_guidelines` |
| Zod | 4.3.6 | Score payload validation | Already the mandated boundary-validation library; new scoring endpoints validate with Zod schemas |
| Handlebars | 4.7.8 | Brand-score panel templates | Dashboard render pipeline — new `brand-score-panel.hbs` partial, no new engine |
| HTMX | (CDN) | Score panel loading + trend widget refresh | OOB swap patterns from v2.10.0 (see `feedback_htmx_oob_in_table.md`) apply directly to the score card |
| Chart.js | 4.5.1 (CDN) | Trend visualization | **Already in use in `views/trends.hbs`** via `cdn.jsdelivr.net`; CSP `scriptSrc` already whitelists this CDN (`server.ts:228`). Reuse the exact same pattern for a brand-score trend line — zero infra change |

### Supporting Libraries (additive)

Two tiny additions only — both pure-TS with no native deps — plus one in-tree math module (preferred).

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **In-tree `wcag-math.ts`** | n/a | WCAG 2.1 relative luminance + contrast ratio from hex pairs | **Preferred.** ~40 lines of pure math (sRGB→linear→luminance→ratio). Matches the existing hand-rolled `color-utils.ts` / `normalizeHex` philosophy in `@luqen/branding`. Zero dependency surface, zero supply-chain risk, trivially testable. See "Why in-tree over a package" below |
| `wcag-contrast` | 3.0.0 | Alternative: drop-in WCAG 2.1 contrast math | Fallback only if reviewer objects to hand-rolled math. 25 KB, ESM (`module` field in package.json), last published 2019 but **spec hasn't changed** (WCAG 2.1 relative luminance is frozen). 33k weekly downloads, BSD-2 license. Single transitive dep: `relative-luminance@^2.0.0` |
| `diff@5` | 5.2.2 | Already present | Not needed here — listed only to confirm it's a reuse target, not a new install |

**NOT recommended:**
- `colorjs.io` (0.6.1) — modern, well-maintained, zero-dep ESM, but 80 KB+ gzipped. Overkill for hex-pair contrast ratio; brings a full LCH/OKLab color-space engine we don't use. Reconsider only if v2.12+ wants APCA / WCAG 3 contrast.
- `apca-w3` — WCAG 3 is still a Working Draft (not a standard). Brand score must match what scanners flag against WCAG 2.1, so mixing APCA scoring would produce confusing "brand says AA but scanner flags fail" results.

### Development Tools (all already present)

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest 4.1 | Unit + integration tests for scoring modules | Branding package already uses Vitest; add `scoring/*.test.ts` alongside existing `matcher/*.test.ts` |
| tsc --noEmit | Lint / typecheck | Existing `npm run lint` in each package |
| Playwright (dashboard) | E2E for score panel + trend widget | Existing suite; add one E2E covering the new dashboard widget per `feedback_ui_phase_uat.md` (UI phases need human UAT) |

## Installation

**Zero new dependencies required** if we go with the in-tree math module (recommended). If reviewer prefers the package:

```bash
# Optional, only if choosing wcag-contrast over in-tree math
npm install --workspace=@luqen/branding wcag-contrast@3.0.0
```

No other installs. Chart.js stays on the CDN (same URL and CSP rule already live).

## Answers to Specific Questions

### 1. WCAG contrast ratio from hex pairs — **in-tree math module in `@luqen/branding`**

The code lives at `packages/branding/src/scoring/wcag-math.ts` and exposes:

```ts
export function relativeLuminance(hex: string): number;   // WCAG 2.1 §1.4.3 formula
export function contrastRatio(fg: string, bg: string): number;
export function passesAA(ratio: number, largeText: boolean): boolean;   // 4.5 / 3.0
export function passesAAA(ratio: number, largeText: boolean): boolean;  // 7.0 / 4.5
```

**Why in-tree over `wcag-contrast`:**
1. The math is ~40 lines and frozen by W3C — no maintenance burden
2. `@luqen/branding` already has `utils/color-utils.ts` doing hex normalization by hand; this is the same philosophy
3. Zero new dependency = zero supply-chain surface for the core scoring feature
4. `wcag-contrast` itself is 6 years stale (last publish 2019) — choosing it now means either pinning a stale dep or auditing a tiny amount of code regardless
5. Directly testable against the canonical WCAG 2.1 examples (black/white = 21.0, #767676/#FFFFFF = 4.54)

**Inputs:** normalized 6-digit hex strings (reuse `normalizeHex` from `utils/color-utils.ts`).
**Outputs:** numeric ratio + boolean AA/AAA per text-size threshold — the score aggregator converts these to 0–100 per guideline.

### 2. Typography readability scoring — **heuristic module in `@luqen/branding`, no library needed**

Lives at `packages/branding/src/scoring/typography-score.ts`.

Inputs are what the scanner already captures in `MatchableIssue.context` plus the brand's `BrandFont[]`:
- Font-family (already extracted by `font-matcher.ts` — reuse)
- Declared `font-size`, `line-height` from CSS context (extract via existing regex approach like `FONT_FAMILY_RE`)
- Generic family membership (serif/sans-serif/etc — already enumerated in `css-parser.ts`)

Heuristics (all computable from numeric CSS values, no font-metrics library):
- **Minimum body size**: ≥16 px → full credit, 14–16 px → partial, <14 px → zero
- **Line-height ratio**: ≥1.5× body / ≥1.2× heading → full credit (WCAG 1.4.12)
- **Brand-font adherence**: used family ∈ `BrandFont[]` (exact match, then fallback-chain tolerance)

**Why no library:** True x-height / x-advance measurement requires loading actual font files (opentype.js, fontkit) — 200+ KB dependency trees, async file IO, zero value over the three heuristics above for an accessibility score. The scanner doesn't provide raw text nodes to measure anyway.

**Rejected:** `opentype.js` (font parsing, 450 KB), `font-metrics` (browser-only), `css-font-parser` (unmaintained).

### 3. Component token compliance scoring — **pure set-diff module, no library**

Lives at `packages/branding/src/scoring/token-score.ts`.

**Inputs** (all already in the existing data model):
- Brand tokens: `BrandGuideline.colors[].hexValue` + `BrandGuideline.fonts[].family` + `BrandGuideline.selectors[].pattern`
- Used tokens: hex colors + font families + selectors extracted from `MatchableIssue.context` across every issue on a scan — this extraction already exists (`extractColorsFromContext` in `utils/color-utils.ts`, `extractFirstFont` in `font-matcher.ts`)

**Algorithm:**
```
usedBrandColors = intersect(usedColors, brandColors)
foreignColors   = usedColors \ brandColors
colorAdherence  = |usedBrandColors| / (|usedBrandColors| + |foreignColors|) * 100
```

Same pattern for fonts and selectors. Weighted rollup → single 0–100 per guideline dimension.

**Why no library:** This is JavaScript `Set` difference / intersection. Any library (`lodash.difference`, etc.) adds a dependency for three lines of code. Reject.

### 4. Trend visualization — **reuse Chart.js 4 CDN (already live in trends.hbs)**

**Evidence this is already sanctioned:**
- `packages/dashboard/src/views/trends.hbs:171` loads `https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js`
- `packages/dashboard/src/server.ts:228` CSP `scriptSrc` whitelist already contains `cdn.jsdelivr.net`
- Existing org-wide + per-site line charts with tooltips, per-point colors, delta-direction markers — all reusable visual grammar for the brand-score line

**Recommendation:**
- **Trend detail (report detail page, historical view):** full Chart.js line chart, mirroring the `renderChart(siteUrl)` pattern in `trends.hbs`
- **Dashboard widget summary tile:** **inline SVG sparkline**, hand-written. ~15 lines of Handlebars + SVG `<polyline>`. No JS, no layout shift, HTMX-friendly, zero new code at runtime. Pattern:
  ```hbs
  <svg viewBox="0 0 100 30" class="brand-score-sparkline" aria-hidden="true">
    <polyline points="{{sparklinePoints}}" fill="none" stroke="currentColor" stroke-width="2"/>
  </svg>
  ```
  The server computes `sparklinePoints` from the last N scores in a helper — same approach as the existing `{{{trendArrow}}}` helper.

**Why not a sparkline library:** `chartist`, `peity`, `sparkline.js` all require a DOM+JS pass for a visual that is 15 lines of server-rendered SVG. The dashboard values zero-JS patterns (see `feedback_htmx_forms_in_tables.md`, native `<details>` decision for Revoked keys in v2.10.0).

**Why not a second charting library:** Chart.js is already on the page via CDN and already understood by the team. Adding a second library for sparklines violates "no bloat" and the "design-system consistency" feedback in memory.

### 5. Per-org dual-mode routing — **direct reuse of `ServiceClientRegistry` pattern**

**YES, reuse the v2.8.0 pattern.** The existing `ServiceClientRegistry` (`packages/dashboard/src/services/service-client-registry.ts`) already solves the exact problem with one small extension.

**What exists today (Phase 06, v2.8.0):**
- `ServiceClientRegistry.create()` builds three clients (compliance, branding, LLM) from encrypted DB rows with config fallback
- `reload(serviceId)` atomically swaps a client at runtime — no restart
- `BrandingService` consumes a **getter** (`BrandingTokenManagerGetter`) so hot-swaps are invisible to route handlers
- Destroy-old-after-new-succeeds exception safety contract

**What v2.11.0 needs to add:**

1. **New DB column** `orgs.branding_mode` (SQLite dashboard): `'embedded' | 'service'`, default `'service'` (backwards compatible — existing installs keep using the remote branding service)
2. **New resolver** `OrgBrandingResolver` — thin wrapper around `BrandingService` that reads the org's `branding_mode`:
   - `'service'` → call `BrandingService` (existing REST-over-OAuth2 path)
   - `'embedded'` → call the `@luqen/branding` package **in-process** (`BrandingStore` + matcher APIs that the branding service itself wraps)
3. **No new registry** — the existing `ServiceClientRegistry.getBrandingTokenManager()` is still the single source for the REST client. The resolver just decides whether to use it or skip it per request.

**Critical reuse points:**
- **The `@luqen/branding` package is already a library**, not only a service — `packages/dashboard` already imports it (`"@luqen/branding": "*"` in `package.json`). Embedded mode simply calls the library directly with a local SQLite handle instead of crossing the HTTP boundary.
- **The hot-swap contract is already proven** — admin CRUD on service connections already rebuilds clients via `registry.reload()`. Toggling an org's `branding_mode` is a simpler DB-only change (no client rebuild needed, just a different code path at request time).
- **Config-file fallback still works** — if an org has `branding_mode = 'service'` but no `brandingUrl` configured, the existing per-service fallback (`resolveConnection`, D-14) kicks in, unchanged.

**What NOT to build:**
- A second registry
- A new encrypted-config repository
- New OAuth clients (embedded mode bypasses auth entirely — it's in-process)

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| In-tree `wcag-math.ts` | `wcag-contrast@3.0.0` | Only if reviewer rejects hand-rolled math. Still acceptable (ESM, BSD-2, 25 KB, spec-frozen) |
| Chart.js 4 CDN (reuse) | `apexcharts`, `plotly.js`, `echarts` | Never for this milestone — we already have Chart.js live, and any alternative is a gratuitous second chart engine |
| Inline SVG sparkline | `peity`, `chartist` sparkline mode | Only if we need interactive sparklines (hover tooltips on the dashboard tile) — not in scope for v2.11.0 |
| Heuristic typography scoring | `opentype.js` font-metric extraction | Only if a future milestone gains access to raw font files (not the case — scanner only gives CSS context strings) |
| `ServiceClientRegistry` reuse | New `BrandingModeRegistry` | Never — two registries = two sources of truth, violates D-07/D-08 decisions logged in v2.8.0 |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `colorjs.io` | 80 KB+ for a feature that needs 40 lines of WCAG 2.1 math | In-tree `wcag-math.ts` |
| `apca-w3` | WCAG 3 Working Draft — would mismatch scanner's WCAG 2.1 findings and confuse users | `wcag-math.ts` with WCAG 2.1 thresholds (4.5/3.0/7.0/4.5) |
| `chartjs-plugin-*` (trendline, zoom, annotation) | Feature creep — vanilla Chart.js already handles trend-colored points in `trends.hbs` | Copy the existing `trendPointColors` / `trendPointRadii` helpers from `trends.hbs` |
| `opentype.js` / `fontkit` | 450 KB+ native-ish deps; require raw font files we don't have | Heuristic scoring on declared CSS values |
| `d3` / `d3-selection` | Massive lib for a sparkline; conflicts with the zero-JS dashboard ethos | Server-rendered SVG `<polyline>` |
| A second registry for dual-mode | Duplicates v2.8.0 D-07/D-08 single-ownership contract | Extend `ServiceClientRegistry` consumption via `OrgBrandingResolver` |
| Raw `form` tags inside score tables | Banned by `feedback_htmx_forms_in_tables.md` | `hx-post` on buttons with CSRF via meta-tag interceptor |

## Stack Patterns by Variant

**If org is in `embedded` branding mode:**
- `OrgBrandingResolver` calls `@luqen/branding` library functions directly
- No outbound HTTP, no OAuth token, lowest latency
- Uses the dashboard's own SQLite connection (new `branding_*` tables co-located) OR a dedicated embedded DB file — decision for `/gsd-research-phase` STACK sub-research
- Score computation runs in the same process as the dashboard

**If org is in `service` branding mode (default, existing behavior):**
- `OrgBrandingResolver` delegates to `BrandingService` → `ServiceClientRegistry.getBrandingTokenManager()` → REST call over OAuth2
- Zero behavior change vs v2.10.0
- Score computation runs in `@luqen/branding` service process

**If trend history has <2 points (new site):**
- Dashboard widget shows the current score number only, no sparkline, no trend arrow (prevents misleading single-dot charts)
- Chart.js detail view still renders a single point with an empty-state label — same pattern as `trends.hbs` `{{#if hasTrends}}`

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Chart.js 4.5.1 (CDN) | Existing CSP `scriptSrc: cdn.jsdelivr.net` | Already proven working in production (`trends.hbs`) |
| better-sqlite3 11.x | Node 22+ (prebuilt binaries) | Already pinned — new `brand_score_*` tables fit the existing `CREATE TABLE IF NOT EXISTS` pattern in `sqlite-adapter.ts` |
| Fastify 5 + @fastify/helmet 13 | CSP stays unchanged | No new inline scripts needed (sparkline is pure SVG, Chart.js already whitelisted) |
| `wcag-contrast@3.0.0` (if chosen) | `"module"` field present → ESM import works in Node 22 ESM packages | Use `import { hex } from 'wcag-contrast'` — not CJS `require` |
| Zod 4.3.6 | New score endpoint schemas | Reuse the `z.object({...}).strict()` convention from LLM capability schemas |

## Integration Points (downstream consumer guide)

**For the `@luqen/branding` package:**
- New folder: `packages/branding/src/scoring/` (`wcag-math.ts`, `typography-score.ts`, `token-score.ts`, `aggregator.ts`, plus tests)
- New API route (in `api/server.ts`): `POST /api/v1/score` returning per-guideline + overall 0–100 numbers + sub-scores
- New store tables: `brand_scores` (scan_id, guideline_id, dimension, score, timestamp) for trend persistence
- Reuse existing: `normalizeHex`, `extractColorsFromContext`, `FONT_FAMILY_RE`, `CONTRAST_CODES`

**For the `@luqen/dashboard` package:**
- Reuse existing: `ServiceClientRegistry.getBrandingTokenManager()`, `BrandingService.matchIssues`, CSP rules, Handlebars partial layout, `{{{json ...}}}` helper for chart payloads
- New: `services/org-branding-resolver.ts` (wraps `BrandingService` with mode-switch)
- New: `db/sqlite/migrations/043-orgs-branding-mode.sql` — adds `branding_mode` column with `'service'` default (backwards-compatible)
- New: `views/partials/brand-score-panel.hbs` (report detail integration)
- New: `views/partials/brand-score-widget.hbs` (dashboard tile with inline SVG sparkline)
- Chart.js stays a CDN reference — do NOT add it to `package.json`

**For existing `service-client-registry.ts`:**
- **Zero changes required.** The resolver consumes the existing getter.

## Sources

- `/root/luqen/packages/dashboard/src/views/trends.hbs` — HIGH: confirms Chart.js 4 CDN is the sanctioned pattern (line 171)
- `/root/luqen/packages/dashboard/src/server.ts` — HIGH: CSP whitelist for `cdn.jsdelivr.net` (line 228)
- `/root/luqen/packages/dashboard/src/services/service-client-registry.ts` — HIGH: full v2.8.0 hot-swap contract to reuse
- `/root/luqen/packages/dashboard/src/services/branding-service.ts` — HIGH: getter-based client consumption pattern to reuse
- `/root/luqen/packages/branding/src/matcher/color-matcher.ts` — HIGH: existing WCAG contrast-code taxonomy + hex extraction
- `/root/luqen/packages/branding/src/utils/color-utils.ts` — HIGH: existing hex normalization to reuse
- `/root/luqen/packages/branding/src/types.ts` — HIGH: `BrandColor` / `BrandFont` / `BrandSelector` data model already present
- `/root/luqen/packages/branding/src/db/sqlite-adapter.ts` — HIGH: in-tree `CREATE TABLE IF NOT EXISTS` pattern for new `brand_scores` table
- `/root/luqen/packages/dashboard/package.json` — HIGH: confirms Chart.js is NOT an npm dep (CDN-only), `@luqen/branding` already a workspace dep
- `https://github.com/tmcw/wcag-contrast/blob/master/package.json` (raw) — HIGH: confirmed ESM `module` field, single dep `relative-luminance@^2.0.0`, last publish 2019 but spec-stable
- `https://github.com/color-js/color.js/blob/main/package.json` (raw) — HIGH: colorjs.io 0.6.1 current, full-featured but oversized for this use case
- `https://www.chartjs.org/docs/latest/api/` — HIGH: Chart.js 4.5.1 current stable, API unchanged from what `trends.hbs` uses
- `feedback_design_system_consistency.md` / `feedback_htmx_forms_in_tables.md` / `feedback_ui_phase_uat.md` (memory) — HIGH: dashboard coding ethos (reuse CSS classes, zero-JS where possible, UI phases need UAT)
- `project_backlog_branding_phase2.md` (memory) — MEDIUM: confirms v2.11.0 is the correct milestone slot for brand a11y score + dual-mode orchestrator

---

*Stack research for: Luqen v2.11.0 Brand Intelligence*
*Researched: 2026-04-10*
