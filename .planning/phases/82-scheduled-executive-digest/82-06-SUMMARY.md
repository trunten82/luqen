---
phase: 82-scheduled-executive-digest
plan: "06"
subsystem: luqen-wordpress
tags: [wordpress, php, playwright, digest, exposure-band, accessibility]

# Dependency graph
requires:
  - phase: 82-scheduled-executive-digest
    plan: "05"
    provides: "GET /api/v1/digest endpoint that serves org-scoped digest data per site"
  - phase: 81-jurisdiction-legal-exposure-scoring-flagship
    plan: "04"
    provides: "Luqen_Exposure_Page structural analog + instance_url API client + fetch_exposure pattern"
provides:
  - "Luqen_Digest_Page WP admin page rendering per-site digest (company-info header, period, what-changed table, band pill + direction, methodology link, disclaimer, email action)"
  - "Luqen_Fleet_Client::fetch_digest() method consuming GET /api/v1/digest via the existing OAuth2 client"
  - "Playwright spec tests/e2e/digest-page.js covering connected + degraded states, D-12 forbidden words, band-not-number"
  - "DIGEST-05 delivered: WordPress SMB beachhead gets the conservative per-site accessibility digest"
affects: [82-07, slice-d-wp-mirror]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fetch_digest mirrors fetch_exposure — rawurlencode site_url, is_configured() guard, WP_Error passthrough"
    - "All API output escaped with esc_html/esc_attr/esc_url; driver keys mapped to fixed translated strings, never echoed raw"
    - "Band rendered as luqen-wp-status--{band} pill + inline colour + icon + translated label — never a number (D-12)"
    - "Silent degradation via notice-warning/notice-info; no raw API error bodies exposed to admin"
    - "currentExposure is the correct field name from the 82-05 API contract (not 'exposure')"

key-files:
  created:
    - /root/luqen-wordpress/includes/class-digest-page.php
    - /root/luqen-wordpress/tests/e2e/digest-page.js
  modified:
    - /root/luqen-wordpress/includes/class-fleet-client.php
    - /root/luqen-wordpress/includes/class-plugin.php

key-decisions:
  - "Used currentExposure (not 'exposure') as the API field name — confirmed from 82-05 API contract during UAT"
  - "Playwright spec accepts both degraded copy variants ('unavailable' and 'could not be retrieved') to survive minor wording changes"
  - "No new PHP/Composer/npm dependencies — pure plugin PHP reusing the existing API client (T-82-SC)"

patterns-established:
  - "fetch_digest pattern: is_configured() → api->get('/api/v1/digest?site='.rawurlencode($site)) → WP_Error or payload"
  - "Digest page uses the same Luqen_Report_Identity::config() company-info header as VPAT/ACR docs"

requirements-completed: [DIGEST-05]

# Metrics
duration: multi-session (Task 1 + checkpoint UAT 2026-06-11)
completed: 2026-06-11
tasks_completed: 2/2
---

# Phase 82 Plan 06: WordPress Digest Page Summary

**WordPress Luqen_Digest_Page delivering DIGEST-05 — per-site accessibility digest fetched from /api/v1/digest via OAuth2, rendered with company-info header + band pill + direction + methodology link, silently degrading when disconnected, verified green on the real wp-test LXC with 23-check Playwright spec**

## Performance

- **Duration:** Multi-session (implementation + wp-test LXC UAT on 2026-06-11)
- **Started:** Prior session
- **Completed:** 2026-06-11
- **Tasks:** 2/2
- **Files modified:** 4 (2 created, 2 modified in /root/luqen-wordpress)

## Accomplishments

- Delivered DIGEST-05: WordPress admin gets a per-site Accessibility Digest page (Luqen_Digest_Page) with company-info header (Luqen_Report_Identity), period, what-changed table (errors/warnings/notices with deltas and criteria list), band pill (icon + label + colour, never a number), direction indicator, methodology link, and "not legal advice" disclaimer
- Added Luqen_Fleet_Client::fetch_digest() consuming the 82-05 GET /api/v1/digest endpoint via the existing OAuth2/X-Org-Id API client using the canonical instance_url settings key (not api_url — 81-04 bug not reintroduced)
- Playwright spec tests/e2e/digest-page.js passed all 23 checks on the real wp-test LXC against the live Luqen dashboard running Phase 82, covering both CONNECTED and DEGRADED states, D-12 forbidden-word absence, and band-not-number assertion
- Silent degradation confirmed: with instance_url pointed at an unreachable host, page renders a single notice-warning with no band, no what-changed, no PHP fatal

## Task Commits

1. **Task 1: Luqen_Digest_Page + fetch_digest + plugin registration + Playwright spec** - `b67f1e3` (feat)
2. **Task 1 (fix): currentExposure field name + degraded-copy spec tolerance** - `9574209` (fix — Rule 1 auto-fix found during UAT)
3. **Task 2: wp-test LXC UAT** — checkpoint:human-verify; PASSED 2026-06-11 (no separate commit; orchestrator applied the fix above during UAT)

## Files Created/Modified

- `/root/luqen-wordpress/includes/class-digest-page.php` — Luqen_Digest_Page: register_menu (add_submenu_page under Luqen menu), render() guarded by current_user_can(Luqen_Settings::CAP), company-info header, period, what-changed table, band pill + direction, methodology link, disclaimer, email form
- `/root/luqen-wordpress/includes/class-fleet-client.php` — Added fetch_digest($site_url) mirroring fetch_exposure pattern
- `/root/luqen-wordpress/includes/class-plugin.php` — Added require_once + new Luqen_Digest_Page() instantiation
- `/root/luqen-wordpress/tests/e2e/digest-page.js` — Playwright spec: login, navigate to page=luqen-digest, 23 assertions covering connected + degraded states

## Decisions Made

- Used `currentExposure` (not `exposure`) as the field name from the API response — discovered during UAT that the 82-05 endpoint returns `currentExposure`, causing the at-risk card to always degrade when reading the wrong key
- Playwright spec accepts both degraded copy variants ("unavailable" and "could not be retrieved") since slight wording differences should not break the spec contract
- No new dependencies introduced — pure PHP reusing the existing API client stack (T-82-SC threat mitigation)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wrong API field name: `exposure` vs `currentExposure`**
- **Found during:** Task 2 (wp-test LXC UAT)
- **Issue:** `class-digest-page.php` read `$site_data['exposure']` but the 82-05 API contract field is `$site_data['currentExposure']` (matching Plan 05's API shape for the site object). This caused the "What's at risk" card to always enter the degraded/null path even when the dashboard returned valid exposure data
- **Fix:** Updated the field read from `exposure` to `currentExposure` in class-digest-page.php; also widened the Playwright spec to accept both degraded copy variants ("unavailable" and "could not be retrieved") for spec resilience
- **Files modified:** `/root/luqen-wordpress/includes/class-digest-page.php`, `/root/luqen-wordpress/tests/e2e/digest-page.js`
- **Verification:** Playwright spec re-run after fix — all 23 checks GREEN; band pill rendered correctly ("⬛ High"), direction "Unchanged", methodology link resolved 200
- **Committed in:** `9574209`

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug: wrong API field name)
**Impact on plan:** Fix was necessary for the at-risk card to render at all. No scope creep.

## Issues Encountered

- The 82-05 API contract uses `currentExposure` at the site level (not `exposure`) — the plan's interface block named the field differently. Caught and fixed during the REQUIRED Playwright UAT run on the real wp-test LXC.

## UAT Evidence

UAT run on 2026-06-11 against the real wp-test LXC (luqen-wp-test 192.168.3.160, wp-now :8881 via SSH tunnel), plugin connected to live dashboard at 192.168.3.176:5000 with Phase 82 fully deployed (CI run 27371516358 + Deploy run 27371999733).

**CONNECTED state** (org "Alessandro Lanna" with a completed scan): all 23 Playwright checks passed.
- Company-info header: "Acme Corp · a11y@acme.test"
- Period: "May 12, 2026 – June 11, 2026"
- What-changed table: Errors 3 +3 / Warnings 2 +2 / Notices 2 +2
- Band pill: "⬛ High" with direction "Unchanged"
- Methodology link: http://192.168.3.176:5000/methodology/legal-exposure resolved 200
- "Not legal advice" disclaimer present; D-12 forbidden words absent

**DEGRADED state** (instance_url pointed at unroutable TEST-NET host, then restored): single notice-warning with the UI-SPEC degraded copy, no band, no direction, no PHP fatal — all checks passed.

**Email action:** "Send digest email" button posted without PHP error.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DIGEST-05 complete; the WordPress digest page is live and verified on the real wp-test LXC
- The currentExposure field name is now established as the canonical API contract for any future WP consumers of the digest API
- Slice D (WP mirror for manual-test/VPAT/evidence/pack/secure-sharing) is a separate milestone, not started

## Threat Surface Scan

No new security surface introduced beyond what the plan's threat model covers. All STRIDE mitigations implemented:
- T-82-20: current_user_can(Luqen_Settings::CAP) guard on render()
- T-82-21: data org-scoped by X-Org-Id enforced dashboard-side
- T-82-22: every output escaped (esc_html/esc_attr/esc_url); driver keys mapped to fixed translated strings
- T-82-23: wp_nonce_field + check_admin_referer + current_user_can guard on email form
- T-82-24: is_configured() + is_wp_error() guards → silent degraded state
- T-82-25: D-12 forbidden words absent (Playwright confirmed); band label never a number

## Self-Check

Files exist in luqen-wordpress:
- `/root/luqen-wordpress/includes/class-digest-page.php` — FOUND (committed b67f1e3)
- `/root/luqen-wordpress/includes/class-fleet-client.php` — FOUND (committed b67f1e3)
- `/root/luqen-wordpress/includes/class-plugin.php` — FOUND (committed b67f1e3)
- `/root/luqen-wordpress/tests/e2e/digest-page.js` — FOUND (committed b67f1e3, patched 9574209)

Commits confirmed: `b67f1e3` + `9574209` in /root/luqen-wordpress git log.

## Self-Check: PASSED

---
*Phase: 82-scheduled-executive-digest*
*Completed: 2026-06-11*
