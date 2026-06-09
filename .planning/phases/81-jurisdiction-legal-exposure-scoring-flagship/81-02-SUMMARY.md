---
phase: 81-jurisdiction-legal-exposure-scoring-flagship
plan: "02"
subsystem: dashboard
tags: [exposure, i18n, fleet, report-detail, legal, wcag, accessibility]
dependency_graph:
  requires: ["81-01"]
  provides: ["rpt-exposure-card.hbs", "fleet exposure column", "exposure i18n 6-locale", "report-detail exposure wiring"]
  affects: ["packages/dashboard/src/routes/reports.ts", "packages/dashboard/src/routes/fleet.ts", "packages/dashboard/src/views/fleet.hbs", "packages/dashboard/src/views/report-detail.hbs"]
tech_stack:
  added: []
  patterns: ["exposure band decoration (decorateWithExposure)", "fleet sort helper (sortByExposure)", "fleet summary helper (computeFleetExposureSummary)", "BAND_VIEW_PROPS map", "conditional HBS states (band/noPendingScan/noJurisdictions/unavailable)"]
key_files:
  created:
    - packages/dashboard/src/views/partials/rpt-exposure-card.hbs
    - packages/dashboard/tests/routes/fleet-exposure.test.ts
  modified:
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/i18n/locales/de.json
    - packages/dashboard/src/i18n/locales/es.json
    - packages/dashboard/src/i18n/locales/fr.json
    - packages/dashboard/src/i18n/locales/it.json
    - packages/dashboard/src/i18n/locales/pt.json
    - packages/dashboard/src/routes/reports.ts
    - packages/dashboard/src/routes/fleet.ts
    - packages/dashboard/src/views/report-detail.hbs
    - packages/dashboard/src/views/fleet.hbs
    - packages/dashboard/src/static/style.css
decisions:
  - "adaTitleIiDeadlineExpired is the real key emitted by legal-exposure.ts (not adaTitleIiPassed); both keys included in all 6 locale files for forward-compatibility"
  - "exposure.methodologyDisclaimer rewrote 'non-compliant' phrase to avoid triggering D-07 forbidden-words grep on 'compliant'"
  - "decorateWithExposure, sortByExposure, computeFleetExposureSummary exported from fleet.ts so behavioral tests assert them directly without Fastify injection complexity"
metrics:
  duration: "~45 minutes"
  completed: "2026-06-09"
  tasks_completed: 2
  files_changed: 11
---

# Phase 81 Plan 02: Dashboard Exposure Card + Fleet Wiring + 6-Locale i18n Summary

Conservative exposure indicator (EXPO-01/02/03) surfaced on two dashboard views via the `deriveExposure` model shipped in Plan 01.

## What Was Built

### Task 1: i18n + exposure card partial + CSS + report-detail wiring

**6-locale i18n (en/de/es/fr/it/pt):**
- Extended `fleet.*` namespace with `exposureBand`, `exposureBandLabel`, `highestExposure` in all 6 locales
- Added new `exposure.*` namespace (cardTitle, band.{lower,moderate,elevated,high}, bandAriaLabel.{4 keys}, driver.{5 keys including adaTitleIiDeadlineExpired}, driversListLabel, asOf, methodologyLink, methodologyLinkSr, disclaimer, noPendingScan, noJurisdictions, unavailable, methodologyTitle, methodologyDisclaimerHeading, methodologyDisclaimer) in all 6 locales with correct DE/ES/FR/IT/PT translations
- D-07 forbidden-words clean on all new exposure.* and fleet.* keys

**rpt-exposure-card.hbs partial:**
- Band badge: label + unique icon + colour token (WCAG 1.4.1 — colour never sole differentiator)
- Drivers list (`<ul aria-label="{{t "exposure.driversListLabel"}}">`) iterating `exposure.drivers` with `{{t (concat "exposure.driver." this.key) this.params}}`
- Methodology link with `aria-label` combining methodologyLink + methodologyLinkSr; 44px touch target (WCAG 2.5.5)
- Disclaimer with `role="note"` via `.alert.alert--info.rpt-exposure-card__disclaimer`
- Four conditional states: full card (band present), noPendingScan, noJurisdictions, unavailable

**CSS (style.css):** `rpt-exposure-card` left-border accent block; no new colour values; reuses `--status-info/warning/error` tokens; `rpt-exposure-band--high` filter override for depth distinction

**report-detail.hbs:** `{{#if exposure}}{{> rpt-exposure-card exposure=exposure t=t}}{{/if}}` after share-panel

**reports.ts:** Imports `deriveExposure` + `ExposureBand`; `BAND_VIEW_PROPS` map (band → badgeModifier + bandIcon); exposure computed in all 3 GET /reports/:id view paths:
- Scan not completed → `{ noPendingScan: true }`
- Completed, no jurisdictions → `{ noJurisdictions: true }`
- Completed, derive error → `{ unavailable: true }` (no error detail leaked — T-81-05)
- Full path: `deriveExposure({ jurisdictions, regulations, findings: { errors, warnings, notices, confirmedViolations } })` + viewProps attached

### Task 2: Fleet exposure decoration + column + stat (TDD)

**fleet.ts — new exports:**
- `BAND_VIEW_PROPS` + `EXPOSURE_RANK` ordinal map (high:4, elevated:3, moderate:2, lower:1)
- `decorateWithExposure<T>(decorated)` — derives exposure from each site's org-scoped `latestScan`; null when scan absent; try/catch on deriveExposure (no error leakage); attaches badgeModifier + bandIcon
- `computeFleetExposureSummary(sites)` → `{ highBandCount }`
- `sortByExposure(sites)` — sorts by EXPOSURE_RANK descending; null-exposure sites rank 0 (last)

**Both handler paths** (`/fleet` org + `/admin/fleet` admin) now call: `decorateWithLatestScan` → `decorateWithExposure` → `sortByExposure`; pass `fleetExposureSummary` in view context; admin 403 guard untouched; org scope preserved (T-81-04: no cross-org query introduced)

**fleet.hbs:**
- Exposure `<th>` with `.table-sort-btn` (data-sort="exposure", aria-sort="descending") between "Last scan" and "Actions"
- `<td data-label="{{t 'fleet.exposureBand'}}">` per row: rpt-badge (label+icon+colour, WCAG 1.4.1) or em-dash for null
- "Highest exposure" stat in stat-grid: rpt-badge--error-light pill when highBandCount > 0, em-dash otherwise

**fleet-exposure.test.ts (14 behavioral tests, all GREEN):**
- decorateWithExposure: null for no scan; Lower/High band derivation; multi-site; field preservation
- computeFleetExposureSummary: highBandCount=0 (no High sites); count=2 (two High sites); empty list
- sortByExposure: High>Elevated>Moderate>Lower ordering; null-exposure last; empty array; same-band stability
- Integration: both handler paths produce exposure field; highBandCount computation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] adaTitleIiDeadlineExpired key mismatch**
- **Found during:** Pre-execution reading of legal-exposure.ts
- **Issue:** UI-SPEC and PATTERNS.md listed driver key as `adaTitleIiPassed`; the actual key emitted by `legal-exposure.ts` is `adaTitleIiDeadlineExpired` (renamed to avoid "pass" as a substring per D-07)
- **Fix:** Added `adaTitleIiDeadlineExpired` as the primary key AND kept `adaTitleIiPassed` as an alias in all 6 locale files for forward-compatibility
- **Files modified:** All 6 locale files

**2. [Rule 1 - Bug] Forbidden-words false positive in exposure.methodologyDisclaimer**
- **Found during:** D-07 validation before Task 1 commit
- **Issue:** The methodologyDisclaimer from PATTERNS.md verbatim copy included "does not assert that any site is non-compliant" — the word "compliant" triggers the D-07 grep even in a negative assertion
- **Fix:** Rewrote to "does not assert any WCAG or regulatory verdict for any site" — preserves the defensive intent without the forbidden substring
- **Files modified:** All 6 locale files (methodologyDisclaimer values)

## TDD Gate Compliance

Task 2 followed full RED/GREEN cycle:
- RED: `test(81-02)` commit `ad1dcf44` — 14 tests failing (decorateWithExposure not exported)
- GREEN: `feat(81-02)` commit `402ce4f4` — 14 tests passing (fleet.ts exports implemented)

## Known Stubs

None. All new surfaces wire real data from `deriveExposure`. The methodology page (`/methodology/legal-exposure`) is linked from the card but not implemented in this plan (EXPO-05, deferred).

## Threat Flags

No new threat surface beyond what the threat model already covers. T-81-04 (cross-org isolation) addressed: `decorateWithExposure` uses each site's own `s.latestScan` from `getLatestCompletedForSite(s.orgId, s.url)` — no new cross-org storage queries. T-81-05 (XSS) addressed: band/icon are enum-derived constants; drivers rendered via i18n keys with HBS escaping.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| rpt-exposure-card.hbs exists | FOUND |
| fleet-exposure.test.ts exists | FOUND |
| 81-02-SUMMARY.md exists | FOUND |
| Commit f2fa5c84 (Task 1) | FOUND |
| Commit ad1dcf44 (TDD RED) | FOUND |
| Commit 402ce4f4 (Task 2 GREEN) | FOUND |
| tests/i18n/index.test.ts | 21 passed |
| tests/routes/fleet-exposure.test.ts | 14 passed |
| tsc --noEmit | CLEAN |
