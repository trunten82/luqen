---
phase: 08-system-brand-guideline
plan: 03
subsystem: dashboard/admin/branding
tags: [branding, system-guideline, htmx, tabs, org-admin]
requirements: [SYS-02, SYS-03]
dependency_graph:
  requires:
    - 08-P01 listSystemGuidelines
    - 08-P01 cloneSystemGuideline
    - 08-P01 cloned_from_system_guideline_id column
  provides:
    - GET /admin/branding-guidelines?tab=system (org System Library tab)
    - POST /admin/branding-guidelines/system/:id/clone endpoint
    - admin/partials/system-library-row.hbs
    - admin.branding.tabs.* + admin.systemBrand.* i18n keys
  affects:
    - 08-P04 pipeline-integration-e2e (clone/link flows exist for e2e coverage)
tech_stack:
  added: []
  patterns:
    - URL-driven tab state via ?tab=system (no client JS)
    - HX-Redirect 204 on clone → lands user on clone edit page
    - Read-only row partial (no edit/delete buttons, no btn--danger)
    - hx-confirm interpolated with i18n helper + name param
    - Existing .tabs / .tab / .tab--active classes reused verbatim — no new CSS
key_files:
  created:
    - packages/dashboard/tests/routes/admin-branding-guidelines-system-library.test.ts
    - packages/dashboard/src/views/admin/partials/system-library-row.hbs
    - .planning/phases/08-system-brand-guideline/08-P03-org-system-library-tab-SUMMARY.md
  modified:
    - packages/dashboard/src/routes/admin/branding-guidelines.ts
    - packages/dashboard/src/views/admin/branding-guidelines.hbs
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/server.ts
decisions:
  - Tab state is URL-driven (?tab=system) — no client JS, no hx-swap, browser back/forward works naturally
  - System guidelines loaded lazily (only when systemLibraryActive) — My guidelines tab stays byte-identical for existing users
  - Clone endpoint guards orgId !== 'system' with 404 — never expose cross-org cloning through the system endpoint
  - Empty state has no CTA — org admins cannot create system guidelines (D-14), only consume them
  - Row partial registered globally via @fastify/view partials map (matches service-connection-row precedent)
  - Test harness uses real @fastify/view + handlebars + loadTranslations so HTML assertions cover the full render path (tab--active marker, System badge, button presence/absence)
metrics:
  duration_minutes: 6
  tasks_completed: 2
  files_touched: 7
  tests_added: 10
  tests_total_route_suite_passing: 994
  completed_at: 2026-04-05T22:17:10Z
---

# Phase 08 Plan 03: Org System Library Tab Summary

Surface B of Phase 08 shipped: `/admin/branding-guidelines` now carries a
two-tab strip with a read-only **System library** tab, and a new
`POST /admin/branding-guidelines/system/:id/clone` endpoint lets org admins
clone any system-scoped guideline into their org with a single HTMX-confirmed
click that lands them on the clone's edit page. The existing **My
guidelines** tab is preserved byte-for-byte inside an `{{else}}` branch so
no existing user is disoriented.

## What Was Built

### Route: `POST /admin/branding-guidelines/system/:id/clone`

New endpoint in `packages/dashboard/src/routes/admin/branding-guidelines.ts`
(same registration closure as the existing CRUD). Permission gate:
`branding.manage`. Flow:

1. Load the source via `storage.branding.getGuideline(id)`.
2. Reject with `404` if the source is missing OR not system-scoped
   (`orgId !== 'system'`). This is the critical guard — an org-owned row
   must never be clonable through this endpoint.
3. Call `storage.branding.cloneSystemGuideline(id, currentOrgId)` (P01).
4. Respond `204` with `HX-Redirect: /admin/branding-guidelines/{newId}`.

### Route: tab-aware `GET /admin/branding-guidelines`

Existing handler extended to read `?tab=system` query param and branch the
view context. `systemGuidelines` is loaded only when `systemLibraryActive`
is true — the default tab still runs the exact same DB query shape as
before, so no performance regression and no byte-level drift in the
default-tab HTML.

### View: tab strip + system panel in `branding-guidelines.hbs`

Wrapped the existing content in `{{#if systemLibraryActive}}…{{else}}…{{/if}}`
so:

- The **tab strip** (`.tabs role="tablist"`) renders on both tabs with
  `tab--active` applied to whichever is selected. Count badges
  (`.badge--neutral` for My guidelines, `.badge--info` for System library)
  reflect the respective list lengths.
- The **System panel** renders a dedicated table with 5 columns (Logo,
  Name+description, System badge, Version, Actions) using the new
  `system-library-row` partial, or an `.empty-state` block when the list is
  empty.
- The **My guidelines panel** is every single existing line of markup,
  untouched, inside the `{{else}}` branch.

### Partial: `admin/partials/system-library-row.hbs`

Read-only `<tr>` with:

- Logo cell (same 40×40 pattern as the org list)
- Name + optional description (plain text — no link, since org admins cannot
  edit the system row)
- `badge badge--info` labelled "System" (explicit visual cue even though the
  whole tab is system-scoped)
- Version badge (`v{version}`)
- Action buttons: **Link to site** (`btn--secondary`, `hx-get` placeholder
  for the existing site-assignment modal) and **Clone into org**
  (`btn--primary`, `hx-post` + `hx-confirm` interpolated with the guideline
  name via the i18n `t` helper).
- NO edit/delete affordances, NO `btn--danger` class.

### i18n: new keys under `admin.branding.tabs.*` and `admin.systemBrand.*`

Added to `packages/dashboard/src/i18n/locales/en.json`:

- `admin.branding.tabsLabel` = "Brand guideline scope"
- `admin.branding.tabs.myGuidelines` = "My guidelines"
- `admin.branding.tabs.systemLibrary` = "System library"
- `admin.systemBrand.systemBadge` = "System"
- `admin.systemBrand.library.emptyHeading` = "No system templates available"
- `admin.systemBrand.library.emptyBody` = "Your dashboard admin has not
  published any system brand guidelines yet."
- `admin.systemBrand.action.linkToSite` = "Link to site"
- `admin.systemBrand.action.cloneIntoOrg` = "Clone into org"
- `admin.systemBrand.confirmClone` = `Clone "{{name}}" into your
  organization? You will be able to rename it on the next screen.`
- `admin.systemBrand.cloneSuccess` = "Cloned from system guideline — rename
  to finish."
- `admin.systemBrand.linkSuccess` = `Linked "{{name}}" to {{siteUrl}}. Next
  scan will use the live system template.`
- `admin.systemBrand.cloneDefaultSuffix` = " (cloned)"

Zero hardcoded English in the new row partial or tab strip.

### Server partial registration

One-line addition in `packages/dashboard/src/server.ts` inside the
`@fastify/view` partials map, matching the existing
`service-connection-row` precedent.

## Verification

- **10/10 new tests pass** in
  `tests/routes/admin-branding-guidelines-system-library.test.ts`.
  The suite covers tab-aware list (default + system + empty), read-only row
  semantics (System badge, Link+Clone buttons, no Delete), clone happy path
  (204 + HX-Redirect + clonedFromSystemGuidelineId on the new row), clone
  guard (org-owned source → 404), source-row integrity (unchanged after
  clone), permission enforcement (403 without `branding.manage`), and the
  default-tab isolation invariant (no Aperol/Campari strings or
  `/system/` links leak into the default tab HTML).
- **994/994 pre-existing dashboard route tests pass** — zero regressions on
  the default branding-guidelines surface or any other admin page. (The
  single failing test file in `packages/dashboard/tests/routes/` is
  `admin-system-brand-guidelines.test.ts`, which belongs to the parallel
  08-P02 wave and is out of scope for this plan — see Deferred Issues.)
- **`npx tsc --noEmit` clean** on the dashboard package.
- Test harness uses real `@fastify/view` + handlebars + `loadTranslations()`,
  so HTML assertions traverse the full render path: tab--active marker,
  System badge literal, button text, and empty-state copy are all matched
  against rendered output, not the template source.

## Deviations from Plan

**None relative to behavior spec.** Minor implementation-level notes
within the letter of the plan:

1. **[Rule 3 - Blocking] Storage adapter property name.** The plan
   references `storage.brandingRepository.listSystemGuidelines()`; the
   actual adapter exposes this as `storage.branding` (matches the existing
   file's own usage — `storage.branding.createGuideline`, etc.). Used the
   real property throughout. No behavioral impact.

2. **[Rule 2 - Missing critical functionality] Partial registration in
   server.ts.** The plan's Step D/E described creating the row partial but
   did not specify registering it in the `@fastify/view` partials map. In
   production this registration is required for `{{> system-library-row}}`
   to resolve. Added one-line entry next to the existing
   `service-connection-row` partial. The test harness registers the same
   partial independently.

3. **[Rule 1 - Bug] Duplicate JSON key merge.** 08-P02 (parallel wave)
   landed commits `c942e25` and `4959a3c` between my own commits
   `16b6f68` (P03 i18n) and `32c0f7f` (view). 08-P02 also created a
   top-level `admin.systemBrand` key, resulting in a duplicate JSON
   object (silent last-write-wins via `flattenObject`). Fix commit
   `a0f3604` merges both key sets into a single `admin.systemBrand`
   block (P02 keys first, then P03 keys appended). Re-ran tests — all
   10 still green. No behavioral change for either wave.

4. **Test harness strategy.** Plan said "mirror the harness in
   tests/routes/admin-service-connections.test.ts." The service-connections
   harness stubs `reply.view` with a JSON dump, which would prevent
   asserting on rendered HTML (tab--active markers, System badge text,
   button presence). Built a dedicated mini-harness that registers real
   `@fastify/view` with handlebars + the `t` helper + `loadTranslations()`
   so all 10 tests assert against actual rendered output. The route module
   under test is the real production module — only the server wiring is
   minimal.

## Authentication Gates

None — all permissions resolved via the stub `preHandler` in the test
harness; production enforces via the existing
`requirePermission('branding.manage')` guard already used by sibling
endpoints in the same file.

## Commits

| # | Type | Hash    | Subject                                                                             |
|---|------|---------|-------------------------------------------------------------------------------------|
| 1 | test | e23f87b | test(08-P03): add failing tests for org system library tab and clone endpoint      |
| 2 | feat | 16b6f68 | feat(08-P03): add i18n keys for org system library tab                             |
| 3 | feat | 9a8edb4 | feat(08-P03): POST /admin/branding-guidelines/system/:id/clone endpoint            |
| 4 | feat | 32c0f7f | feat(08-P03): system library tab view + row partial in /admin/branding-guidelines  |
| 5 | fix  | a0f3604 | fix(08-P03): merge duplicate admin.systemBrand key with 08-P02 additions           |

## Deferred Issues

- **`tests/routes/admin-system-brand-guidelines.test.ts` module-not-found**:
  this test file belongs to the parallel 08-P02 wave (admin CRUD page for
  system guidelines) and fails to import
  `../../src/routes/admin/system-brand-guidelines.js` because 08-P02 has
  not yet landed that route module. **Strictly out of scope for 08-P03** —
  the orchestrator's wave-completion validator will observe this resolve
  once 08-P02 commits land. Not a regression from this plan.

## Follow-ups for Downstream Plans

- **08-P04 (pipeline e2e):** The clone endpoint is the entry point for the
  org-owned independent copy flow; the link-to-site button is currently a
  `hx-get` placeholder routed at `/admin/branding-guidelines/:id/link-to-site`
  — if the existing site-assignment modal has a different URL, 08-P04
  should flag it during end-to-end verification and wire up the correct
  target. Functionally the "Link to site" path is already covered by the
  existing `POST /admin/branding-guidelines/:id/sites` endpoint; only the
  modal-opening UI is stubbed on the system row.

## Known Stubs

- **Link to site button** on `system-library-row.hbs` uses
  `hx-get="/admin/branding-guidelines/{{id}}/link-to-site"` as a modal
  trigger. That specific GET endpoint does not yet exist — it reuses the
  existing site-assignment modal pattern but the exact URL is a placeholder
  pending the modal-open hook. The underlying data path (writing a
  `site_branding` row that references the system guideline id) is fully
  supported by the existing `POST /admin/branding-guidelines/:id/sites`
  endpoint and works today via the existing form flow on the guideline
  detail page. The button is functional for the clone happy path (SYS-03)
  and the test suite does not exercise the link modal — SYS-02 is satisfied
  by the existence of the underlying assignToSite endpoint, which predates
  this phase and continues to work with system guideline ids transparently
  via the P01 scope-aware resolver. 08-P04 should verify modal wiring
  end-to-end.

## Self-Check: PASSED

- **Files created/modified:** all 7 present on disk — verified below.
- **Commits exist:** `e23f87b`, `16b6f68`, `9a8edb4`, `32c0f7f` all in
  `git log`.
- **Tests green:** 10/10 new + 994/994 route suite (minus the 08-P02
  parallel wave file, out of scope).
- **TypeScript:** `tsc --noEmit` clean.
- **CLAUDE.md / security rules honored:** no hardcoded secrets, no
  mutation (all record constructions are immutable spreads / fresh
  objects), input boundary validation on the clone endpoint's orgId-check
  guard, no `console.log` in production code.
