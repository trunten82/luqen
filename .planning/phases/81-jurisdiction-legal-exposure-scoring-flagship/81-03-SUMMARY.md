---
phase: 81-jurisdiction-legal-exposure-scoring-flagship
plan: 03
subsystem: api
tags: [legal-exposure, methodology, fleet-api, wcag, accessibility, typescript, vitest, handlebars]

# Dependency graph
requires:
  - "81-01: deriveExposure() + ExposureInput/ExposureResult types"
  - "81-02: i18n exposure.* + fleet.* keys, rpt-exposure-card partial"
provides:
  - "packages/dashboard/src/views/methodology-legal-exposure.hbs — public methodology documentation page (EXPO-05)"
  - "packages/dashboard/src/routes/methodology.ts — public GET /methodology/legal-exposure route"
  - "packages/dashboard/src/routes/api/wp-network.ts — GET /api/v1/fleet extended with per-site exposure field"
  - "packages/dashboard/tests/routes/api/wp-network-exposure.test.ts — 5-test suite: 401, band enum, null-when-unscanned, forbidden-words, org isolation"
affects:
  - 81-04

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Public no-auth route: methodologyRoutes mirrors toolRoutes pattern exactly (HtmlPageSchema, no authenticate preHandler)"
    - "Fleet API exposure decoration: per-site Promise.all + getLatestCompletedForSite(ctx.orgId, s.url) + deriveExposure — immutable spread pattern"
    - "TDD RED/GREEN: failing tests committed first (7334a92d), GREEN implementation committed second (470d7eaf)"
    - "D-01 enforcement: ExposureSchema uses Type.String() for band — no numeric/score/percentage field; asserted in test"
    - "D-07 enforcement: forbidden-words grep on HBS template + payload assertion in test"

key-files:
  created:
    - packages/dashboard/src/views/methodology-legal-exposure.hbs
    - packages/dashboard/src/routes/methodology.ts
    - packages/dashboard/tests/routes/api/wp-network-exposure.test.ts
  modified:
    - packages/dashboard/src/routes/api/wp-network.ts
    - packages/dashboard/src/server.ts

key-decisions:
  - "D-04 resolved: WP plugin already calls GET /api/v1/fleet — extended this endpoint rather than creating a new auth surface"
  - "Exposure detail route extended too: FleetSiteSchema now includes exposure; both list and detail handlers provide it for schema consistency (Rule 1 auto-fix)"
  - "Disclaimer omitted from API payload: WP plugin renders its own localised disclaimer; the API exposes only {band, drivers, asOf}"
  - "Forbidden words avoided in HBS: 'default' contains 'fault' as substring — replaced with 'baseline' throughout the methodology page"

patterns-established:
  - "Fleet API exposure decoration: getLatestCompletedForSite scoped to ctx.orgId (not site.orgId) — the auth context's org governs what data is returned"

requirements-completed: [EXPO-03, EXPO-04, EXPO-05]

# Metrics
duration: 20min
completed: 2026-06-09
---

# Phase 81 Plan 03: Methodology Page + Fleet Exposure API Summary

**Public methodology page documenting the legal-exposure model (bands, thresholds, dated sources, disclaimers) plus GET /api/v1/fleet extended with per-site exposure {band, drivers, asOf} derived org-scoped from each site's latest completed scan.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-09T13:20:00Z
- **Completed:** 2026-06-09T13:35:00Z
- **Tasks:** 2 (methodology page + fleet API extension)
- **Files modified:** 5

## Accomplishments

- Task 1: `methodology-legal-exposure.hbs` — static documentation page with bands table (4 bands), severity-weighting thresholds, jurisdiction-applicability table (EU/EAA/NY/FL/IL/CA), ADA Title II tiers, dated data sources, disclaimer — all content sourced from `legal-exposure.ts` constants
- Task 1: `routes/methodology.ts` — public `GET /methodology/legal-exposure`, no `authenticate` preHandler, `HtmlPageSchema`, `methodologyRoutes` export
- Task 1: `server.ts` — `methodologyRoutes` registered next to `toolRoutes`
- Task 2 RED: `wp-network-exposure.test.ts` — 5 failing tests: 401 unauth, band enum, null-when-unscanned, forbidden-words, org isolation
- Task 2 GREEN: `wp-network.ts` — `ExposureSchema` (nullable band/drivers/asOf, no numeric field), extended list + detail handlers with `getLatestCompletedForSite(ctx.orgId, s.url)` + `deriveExposure`, auth unchanged

## Task Commits

1. **Task 1: Methodology page** - `55c63748` (feat)
2. **Task 2: RED failing tests** - `7334a92d` (test)
3. **Task 2: GREEN implementation** - `470d7eaf` (feat)

## Files Created/Modified

- `packages/dashboard/src/views/methodology-legal-exposure.hbs` — 215-line public methodology documentation page
- `packages/dashboard/src/routes/methodology.ts` — 22-line public route module
- `packages/dashboard/src/server.ts` — 2 lines added (import + registration)
- `packages/dashboard/src/routes/api/wp-network.ts` — ExposureSchema + extended fleet list + detail handlers
- `packages/dashboard/tests/routes/api/wp-network-exposure.test.ts` — 5-test suite

## Decisions Made

- D-04 resolved: extended the existing `GET /api/v1/fleet` (OAuth2 + X-Org-Id) rather than creating a new endpoint — the WP plugin already calls this endpoint
- Exposure detail route (`GET /api/v1/fleet/:siteId`) also extended for schema consistency: `FleetSiteSchema` now requires `exposure`, so both endpoints provide it
- API disclaimer omitted: `{ band, drivers, asOf }` only — WP renders its own localised disclaimer
- Forbidden-word hazard: `"default"` contains `"fault"` as substring (D-07 grep is case-insensitive substring match); replaced with `"baseline"` throughout the methodology page

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Extended detail route to include exposure field**
- **Found during:** Task 2 GREEN (existing wp-network-routes.test.ts regression)
- **Issue:** `FleetSiteSchema` was updated to include `exposure` but only the list route was modified. The detail route (`GET /api/v1/fleet/:siteId`) uses `FleetSiteDetailResponse` which embeds `FleetSiteSchema` — returning a site object without `exposure` caused a 500 from response schema validation.
- **Fix:** Applied the same `getLatestCompletedForSite` + `deriveExposure` pattern to the detail handler.
- **Files modified:** `packages/dashboard/src/routes/api/wp-network.ts`
- **Verification:** All 19 tests (14 original + 5 new) pass GREEN.
- **Committed in:** `470d7eaf`

**2. [Rule 1 - Bug] Replaced "default" with "baseline" in methodology page**
- **Found during:** Task 1 forbidden-words verification
- **Issue:** The word `"default"` contains `"fault"` as a substring; the D-07 grep (`-E 'fault'`) matched it, causing the forbidden-words check to fail.
- **Fix:** Replaced all occurrences of `"default"` / `"Default"` in `methodology-legal-exposure.hbs` with `"baseline"` / `"Baseline"`.
- **Files modified:** `packages/dashboard/src/views/methodology-legal-exposure.hbs`
- **Verification:** `! grep -niE '...|fault|...' src/views/methodology-legal-exposure.hbs` passes clean.
- **Committed in:** `55c63748`

---

**Total deviations:** 2 auto-fixed (Rule 1 — schema consistency + forbidden-word substring)

## Verification Results

- `! grep -niE 'compliant|100%|lawsuit-proof|will be sued|fault|guarantee' src/views/methodology-legal-exposure.hbs` → CLEAN
- `grep -q methodologyRoutes src/server.ts` → YES
- `npx tsc --noEmit` → clean (no errors)
- `npx vitest run tests/routes/api/wp-network-exposure.test.ts` → 5/5 PASS (401, band enum, null-when-unscanned, forbidden-words, org isolation)
- `npx vitest run tests/routes/wp-network-routes.test.ts` → 14/14 PASS (regression)
- `npx vitest run tests/routes/fleet-exposure.test.ts` → 14/14 PASS (regression)

## Known Stubs

None — all functionality wired to real data (deriveExposure + getLatestCompletedForSite).

## Threat Flags

No new threat surface introduced beyond what was planned. Methodology page is fully static documentation (no per-org/scan data in view context — only pageTitle/currentPath/user). Fleet API exposure uses ctx.orgId throughout; org isolation asserted by test.

## Self-Check: PASSED

- `packages/dashboard/src/views/methodology-legal-exposure.hbs` — FOUND
- `packages/dashboard/src/routes/methodology.ts` — FOUND
- `packages/dashboard/tests/routes/api/wp-network-exposure.test.ts` — FOUND
- Commit 55c63748 — FOUND (methodology page)
- Commit 7334a92d — FOUND (RED tests)
- Commit 470d7eaf — FOUND (GREEN impl)
- Forbidden-words grep — CLEAN
- methodologyRoutes in server.ts — FOUND
- npx tsc --noEmit — clean
- npx vitest run tests/routes/api/wp-network-exposure.test.ts — 5/5 PASS

---
*Phase: 81-jurisdiction-legal-exposure-scoring-flagship*
*Completed: 2026-06-09*
