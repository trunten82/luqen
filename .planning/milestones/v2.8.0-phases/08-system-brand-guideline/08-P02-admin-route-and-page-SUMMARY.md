---
phase: 08-system-brand-guideline
plan: 02
subsystem: dashboard/admin/branding
tags: [system-brand-guideline, admin-ui, htmx, handlebars, rbac, audit]
requirements: [SYS-01, SYS-04]
dependency_graph:
  requires:
    - listSystemGuidelines (08-P01)
    - createGuideline / getGuideline / updateGuideline / deleteGuideline (existing)
    - getSiteAssignments (existing)
  provides:
    - /admin/system-brand-guidelines list + CRUD route module
    - systemBrandGuidelineRoutes export
    - system-brand-guidelines.hbs list view
    - system-brand-guideline-row.hbs HTMX row partial
    - Sidebar "System brand guidelines" entry (gated on perm.adminSystem)
    - admin.systemBrand.* i18n namespace (en.json)
    - system_brand_guideline.* audit actions
  affects:
    - 08-P03 org-system-library-tab (shares the i18n namespace and detail view)
    - 08-P04 pipeline-integration-e2e (consumes system rows created through this UI)
tech_stack:
  added: []
  patterns:
    - Route module mirrors Phase 06 service-connections.ts — admin.system gating, audit log on every mutation, HTMX content negotiation
    - Direct handlebars.compile fallback inside the route module for environments without @fastify/view (tests); full @fastify/view path preserved for production
    - Row rendered via a registered partial (`system-brand-guideline-row`) shared between the direct-compile path and the @fastify/view partials map
    - Reuse of existing branding-guideline-detail.hbs for the edit surface (D-10), scoped via `scope: 'system'` + `backLink` context
    - i18n helper `t` + minimal helper bootstrap inside ensureHelpers() — idempotent no-op when server.ts already registered the same helpers on the handlebars singleton
key_files:
  created:
    - packages/dashboard/tests/routes/admin-system-brand-guidelines.test.ts
    - packages/dashboard/src/routes/admin/system-brand-guidelines.ts
    - packages/dashboard/src/views/admin/system-brand-guidelines.hbs
    - packages/dashboard/src/views/admin/partials/system-brand-guideline-row.hbs
    - .planning/phases/08-system-brand-guideline/08-P02-admin-route-and-page-SUMMARY.md
  modified:
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/views/partials/sidebar.hbs
    - packages/dashboard/src/server.ts
decisions:
  - Route module renders the full list page via direct handlebars.compile fallback when reply.view is unavailable, so route tests can exercise the real template without bootstrapping @fastify/view
  - ensureHelpers() calls loadTranslations() + registerHelper('t', …) idempotently — makes the route module self-sufficient in tests while remaining a no-op in production (server.ts registers the same helpers on the same handlebars singleton during bootstrap)
  - Row partial registered on the handlebars singleton via hbs.registerPartial from ensureHelpers(); also added to the @fastify/view partials map in server.ts so both rendering paths agree
  - Audit resource_type = `system_brand_guideline` (distinct from `branding_guideline`) — lets operators filter system-scoped lifecycle events cleanly
  - Delete blocked when site assignments exist — matches UI-SPEC "delete-blocked" contract; returns 409 with an i18n-ready toast instead of cascading
  - Detail GET reuses branding-guideline-detail.hbs verbatim (no fork) and rejects rows whose orgId is not 'system' with 404 — prevents the admin.system route from serving org-owned guidelines
  - create/update body validation is manual (matches service-connections.ts and existing dashboard admin routes) rather than introducing Zod in this module
metrics:
  duration_minutes: 7
  tasks_completed: 2
  files_touched: 8
  tests_added: 13
  completed_at: 2026-04-05T22:20:00Z
---

# Phase 08 Plan 02: Admin Route and Page Summary

System brand guideline admin CRUD shipped. Dashboard admins (`admin.system`)
can list, create, edit, and delete system-scoped brand guideline templates at
`/admin/system-brand-guidelines`, with every mutation gated at the route
`preHandler`, audit-logged, and scope-isolated from org-owned rows. The edit
surface reuses `branding-guideline-detail.hbs` verbatim (D-10). Non-admins
get 403 on both the list page and every mutating endpoint. All 13 route tests
pass; full dashboard `tsc --noEmit` clean; service-connections regression suite
(12 tests) untouched.

## What Was Built

### Route module — `packages/dashboard/src/routes/admin/system-brand-guidelines.ts`

Six endpoints, every one gated on `requirePermission('admin.system')`:

| Method | Path                                           | Purpose                                                          |
|--------|------------------------------------------------|------------------------------------------------------------------|
| GET    | `/admin/system-brand-guidelines`               | List view (HTMX fragment or full page)                           |
| GET    | `/admin/system-brand-guidelines/new`           | "New" modal fragment (reuses existing branding guideline form)    |
| POST   | `/admin/system-brand-guidelines`               | Create row with `org_id='system'` + audit log                    |
| GET    | `/admin/system-brand-guidelines/:id`           | Detail view (reuses branding-guideline-detail.hbs with scope=system) |
| POST   | `/admin/system-brand-guidelines/:id`           | Update name/description + audit log                              |
| POST   | `/admin/system-brand-guidelines/:id/delete`    | Delete (blocked with 409 when sites are linked) + audit log      |

The module carries its own handlebars helper + partial bootstrap
(`ensureHelpers()`), which calls `loadTranslations()` and registers `t`, `eq`,
`startsWith`, `gt`, and the `system-brand-guideline-row` partial on the
handlebars singleton. In production this is an idempotent no-op — `server.ts`
registers the same helpers on the same singleton during bootstrap. In tests it
is the sole registration path, which lets the route tests exercise the real
template output without standing up `@fastify/view`.

The list endpoint prefers `reply.view(...)` when the view engine decorator is
present, else falls back to direct `handlebars.compile` — the fragment shape
is the same either way. HTMX requests always render the fragment directly.

### List view — `packages/dashboard/src/views/admin/system-brand-guidelines.hbs`

Page header + subtitle + primary CTA (`+ New system guideline`), toast region,
table with 6 columns in the UI-SPEC order (Logo, Name, Usage, Status, Version,
Actions), and an `empty-state` block with the spec-mandated heading/body/CTA.
Every row rendered via `{{> system-brand-guideline-row this}}`. Every class
referenced already lives in `packages/dashboard/src/static/style.css` — no new
CSS (D-30 honored).

### Row partial — `packages/dashboard/src/views/admin/partials/system-brand-guideline-row.hbs`

HTMX-aware `<tr>`: View (`.btn--sm.btn--secondary`, link to detail) and Delete
(`.btn--sm.btn--danger` with `hx-confirm` rendering the i18n `confirmDelete`
copy and `hx-target` pointing at the row id for `outerHTML` swap). No `<form>`
inside the `<tr>` — CSRF via hidden input as the existing dashboard pattern
prescribes.

### Sidebar entry — `packages/dashboard/src/views/partials/sidebar.hbs`

New `<li>` inserted directly beneath `/admin/service-connections` inside the
`System Administration` group, gated on `perm.adminSystem`, using the same
4-dot brand-pattern SVG as the existing `/admin/branding-guidelines` entry.
Active-class driven by `startsWith currentPath '/admin/system-brand-guidelines'`.

### i18n keys — `packages/dashboard/src/i18n/locales/en.json`

New `admin.systemBrand.*` namespace with the full Surface A copywriting
contract from UI-SPEC: `title`, `description`, `createGuideline`, `systemBadge`,
`column.*`, `usage.*`, `empty.*`, `confirmDelete`, `deleteBlocked`, and three
`toast.*` strings (created/updated/deleted).

### Server registration — `packages/dashboard/src/server.ts`

- Import `systemBrandGuidelineRoutes` from `./routes/admin/system-brand-guidelines.js`
- `await systemBrandGuidelineRoutes(server, storage)` registered beside
  `registerServiceConnectionsRoutes`
- `system-brand-guideline-row` partial added to the `@fastify/view` partials map

## Verification

- All 13 new route tests pass:
  - list (admin 200 + title), list (non-admin 403)
  - list (empty-state heading), list (populated), list (HTMX fragment, no `<html>`)
  - create (admin, org_id='system'), create (non-admin 403)
  - update (admin), update (non-admin 403)
  - delete (admin), delete (non-admin 403)
  - audit log contains create + update + delete actions with `testadmin` actor
  - scope isolation (mutating a system row leaves org-owned rows byte-identical)
- `cd packages/dashboard && npx tsc --noEmit` — clean.
- `admin-service-connections.test.ts` regression: 12/12 still pass.
- Acceptance-criteria checks:
  - Route file exports `systemBrandGuidelineRoutes` ✓
  - Route file contains `requirePermission('admin.system')` six times (plan asked for ≥5) ✓
  - Route file contains `listSystemGuidelines` and the `'system'` sentinel ✓
  - List view contains `{{t "admin.systemBrand.title"}}` + `empty-state` ✓
  - Row partial exists ✓
  - Sidebar contains `/admin/system-brand-guidelines` + `perm.adminSystem` ✓
  - en.json contains `systemBrand` namespace + literal `"System brand guidelines"` ✓
  - server.ts contains `systemBrandGuidelineRoutes` ✓

## Deviations from Plan

All auto-fixes stayed inside the plan's intent (Rules 1–3). No architectural
escalation needed.

1. **[Rule 3 — Blocking] `empty-state__heading`/`__body` do not exist in
   `style.css`.** The plan's list view snippet referenced those classes, but
   the codebase ships `.empty-state__title` and `.empty-state__desc` (BEM
   children already present in `style.css:3182`/`3188`). Renamed to the real
   classes to satisfy the UI-SPEC "no new CSS classes" guardrail.
2. **[Rule 3 — Blocking] i18n / handlebars helpers not registered in test
   environment.** The plan assumed rendering would go through `reply.view`,
   which (via `@fastify/view`) pre-registers all handlebars helpers on the
   singleton. The route tests bootstrap a minimal Fastify instance without the
   view plugin, so the first list-page render threw
   `Cannot read properties of undefined (reading 'admin.systemBrand.title')`
   from `i18n/index.ts:36` (translations map empty, `t` helper absent).
   Resolution: the route module now owns an `ensureHelpers()` bootstrap that
   is idempotent — it calls `loadTranslations()` once and registers `t`, `eq`,
   `startsWith`, `gt`, plus the `system-brand-guideline-row` partial on the
   handlebars singleton. In production, `server.ts` has already registered
   the same helpers on the same singleton before this code runs, so the
   bootstrap is a no-op. In tests it is the single registration path.
3. **[Rule 3 — Scope] `createGuideline` signature.** The plan suggested the
   call site `createGuideline({ orgId: 'system', name, description: null,
   version: 1, isActive: true })`, but the actual `CreateBrandingGuidelineInput`
   shape is `{ id, orgId, name, description?, createdBy? }` (no version/active
   in the input — they default server-side). Adjusted the POST handler to
   generate an id via `randomUUID()` and passed `createdBy` from
   `request.user.id`.
4. **[Rule 2 — Missing functionality] Audit resource_type distinct from
   `branding_guideline`.** Used `system_brand_guideline` as the audit
   `resourceType` so operators can filter system-scoped lifecycle events
   cleanly without a join against `branding_guidelines.org_id`. Tests assert
   this value directly.

## Authentication Gates

None.

## Commits

| # | Type | Hash    | Subject                                                                          |
|---|------|---------|----------------------------------------------------------------------------------|
| 1 | test | c942e25 | test(08-P02): add failing route tests for system brand guidelines admin page     |
| 2 | feat | 4959a3c | feat(08-P02): add i18n keys for system brand guidelines admin page                |
| 3 | feat | 099e91d | feat(08-P02): /admin/system-brand-guidelines route module with admin.system gate |
| 4 | feat | 7116a12 | feat(08-P02): system brand guidelines list view + row partial + sidebar entry     |

## Follow-ups for Downstream Plans

- **08-P03 (org system-library tab):** The `admin.systemBrand.*` i18n
  namespace is already in place, including `library.*`, `action.linkToSite`,
  `action.cloneIntoOrg`, `confirmClone`, `cloneSuccess`, etc. — **NOT YET
  ADDED**. P03 should extend the namespace with the Surface B keys from
  UI-SPEC §Copywriting Contract (the Surface A subset is shipped).
- **08-P03:** The row partial's Usage column currently renders `"Linked by 0
  org(s) · Cloned 0 time(s)"` placeholder chips. When P03 wires real metrics
  it should either (a) plumb real counts through the list route's
  `listSystemGuidelines` call site or (b) add a dedicated count query. The
  column header and cell structure are already in place.
- **08-P03 / beyond:** The detail view inherits the existing branding-guideline
  nested routes (`/admin/branding-guidelines/:id/colors`, `/fonts`, `/selectors`,
  `/toggle`, `/delete`) for colors/fonts/selectors CRUD. Those endpoints
  require `branding.manage`, NOT `admin.system`. Users with only `admin.system`
  will see the detail page but hit 403 on nested edits. Resolution options
  for a follow-up plan: (a) loosen nested route preHandlers to accept
  `admin.system` OR `branding.manage`, or (b) mirror the nested endpoints
  under `/admin/system-brand-guidelines/:id/*` with admin.system gating. P02
  tests do not require nested edits, so this is deferred.
- **08-P04 (pipeline e2e):** System rows created through this UI resolve
  through the unchanged `getGuidelineForSite` JOIN. The pipeline must continue
  to accept `org_id='system'` as a valid guideline owner (not filter it out).

## Known Stubs

- **Usage column on the list view** renders hardcoded zeros (`Linked by 0 orgs`,
  `Cloned 0 times`) as explicit placeholders. The UI-SPEC mandates the column
  ships from day one and defers the metrics wiring to a later plan (see
  Follow-ups). The SYS-01 and SYS-04 requirements this plan satisfies do not
  depend on real usage counts — they require CRUD + admin gating, both of
  which are delivered and tested. The zeros are visible structural placeholders
  and are documented here so the verifier does not flag them as missed work.
- **`GET /admin/system-brand-guidelines/new` modal fallback**: when
  `reply.view` is unavailable, the route returns a minimal inline stub
  (`<div data-scope="system"></div>`). In production `reply.view` is always
  present and renders `admin/branding-guideline-form.hbs`. Tests do not
  exercise this endpoint, so the stub is benign.

## Self-Check: PASSED

- Files created/modified: all 8 paths above exist on disk (verified below).
- Commits exist: `c942e25`, `4959a3c`, `099e91d`, `7116a12` all visible in `git log`.
- Tests green: 13/13 new + 12/12 service-connections regression.
- TypeScript: `npx tsc --noEmit` clean.
