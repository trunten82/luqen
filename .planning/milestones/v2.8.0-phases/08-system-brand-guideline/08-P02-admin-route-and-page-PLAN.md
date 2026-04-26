---
phase: 08-system-brand-guideline
plan: 02
type: execute
wave: 2
depends_on: [08-01]
files_modified:
  - packages/dashboard/src/routes/admin/system-brand-guidelines.ts
  - packages/dashboard/src/views/admin/system-brand-guidelines.hbs
  - packages/dashboard/src/views/admin/partials/system-brand-guideline-row.hbs
  - packages/dashboard/src/views/partials/sidebar.hbs
  - packages/dashboard/src/i18n/locales/en.json
  - packages/dashboard/src/server.ts
  - packages/dashboard/tests/routes/admin-system-brand-guidelines.test.ts
autonomous: true
requirements: [SYS-01, SYS-04]
objective: >
  New /admin/system-brand-guidelines page: dashboard admins (admin.system)
  CRUD system brand guidelines. Sidebar entry added under System
  Administration. List view + CRUD endpoints are new; the detail/edit
  surface reuses branding-guideline-detail.hbs verbatim (D-10) with a
  scope=system hidden field. Non-admin users get 403.
must_haves:
  truths:
    - "A user with admin.system opens /admin/system-brand-guidelines and sees a list of system guidelines (or an empty state)"
    - "A user without admin.system gets 403 on the list page AND on every mutating endpoint"
    - "Clicking + New system guideline opens the existing modal and POSTs create an org_id='system' row"
    - "Clicking View navigates to /admin/system-brand-guidelines/:id which renders the existing branding-guideline-detail.hbs with scope=system"
    - "Edit (PATCH) and Delete work with hx-confirm and return the expected HTMX row swap + toast"
    - "Sidebar shows a new System brand guidelines entry under System Administration, gated on perm.adminSystem"
  artifacts:
    - path: "packages/dashboard/src/routes/admin/system-brand-guidelines.ts"
      provides: "Route module: GET list, GET detail, POST create, POST update, POST delete"
      exports: ["systemBrandGuidelineRoutes"]
    - path: "packages/dashboard/src/views/admin/system-brand-guidelines.hbs"
      provides: "List page template"
      min_lines: 30
    - path: "packages/dashboard/src/views/admin/partials/system-brand-guideline-row.hbs"
      provides: "Table row HTMX partial"
    - path: "packages/dashboard/src/views/partials/sidebar.hbs"
      provides: "Sidebar entry under System Administration"
      contains: "/admin/system-brand-guidelines"
    - path: "packages/dashboard/src/i18n/locales/en.json"
      provides: "All admin.systemBrand.* keys from UI-SPEC"
      contains: "admin.systemBrand.title"
  key_links:
    - from: "packages/dashboard/src/server.ts"
      to: "systemBrandGuidelineRoutes"
      via: "server.register"
      pattern: "systemBrandGuidelineRoutes"
    - from: "/admin/system-brand-guidelines/:id"
      to: "packages/dashboard/src/views/admin/branding-guideline-detail.hbs"
      via: "reused template with scope=system hidden field"
      pattern: "branding-guideline-detail"
---

<objective>
Deliver Surface A from the UI spec: dedicated admin CRUD page for system
brand guidelines at /admin/system-brand-guidelines. Follows the Phase 06
service-connections pattern verbatim (route gating, Handlebars + HTMX
partials, audit on mutations, sidebar entry). The detail/edit page reuses
the existing branding-guideline-detail.hbs — the only divergence is the
back-link URL and a scope=system hidden field (D-10).

Purpose: Lets dashboard admins manage the system brand guideline library.
Output: Working admin page, sidebar entry, i18n keys, route module with
permission gate, row-level HTMX updates, and integration tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-system-brand-guideline/08-CONTEXT.md
@.planning/phases/08-system-brand-guideline/08-UI-SPEC.md
@.planning/phases/08-system-brand-guideline/08-P01-data-foundation-PLAN.md
@packages/dashboard/src/routes/admin/service-connections.ts
@packages/dashboard/src/routes/admin/branding-guidelines.ts
@packages/dashboard/src/views/admin/service-connections.hbs
@packages/dashboard/src/views/admin/branding-guidelines.hbs
@packages/dashboard/src/views/admin/branding-guideline-detail.hbs
@packages/dashboard/src/views/partials/sidebar.hbs
@packages/dashboard/src/i18n/locales/en.json

<interfaces>
Repository methods available from P01:
```typescript
listSystemGuidelines(): Promise<readonly BrandingGuidelineRecord[]>
// Plus existing: createGuideline, getGuideline, updateGuideline, deleteGuideline
```

Route pattern to follow (packages/dashboard/src/routes/admin/service-connections.ts):
- `export async function systemBrandGuidelineRoutes(server, storage, ...)`
- Every route gated with `preHandler: requirePermission('admin.system')`
- Audit writes on every mutation via existing audit helper (check how service-connections.ts uses it — most likely `storage.auditLog.insert` or `writeAudit(request, …)`)
- HTMX content negotiation: check `request.headers['hx-request']` to return fragment vs full page
- Use `toastHtml()` from `./helpers.js` for OOB toast fragments
- Forms inside tables → button hx-post with data-action routed through static/app.js (NO `<form>` inside `<tr>`)
- OOB swaps inside tbody contexts MUST be wrapped in `<template>` tags (feedback_htmx_oob_in_table.md)

Sidebar entry format (from views/partials/sidebar.hbs — service-connections precedent):
```handlebars
{{#if perm.adminSystem}}
<li>
  <a href="/admin/system-brand-guidelines" class="{{#if (eq activePage 'system-brand-guidelines')}}active{{/if}}">
    <svg>...</svg>{{t "admin.systemBrand.title"}}
  </a>
</li>
{{/if}}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write failing route + view tests for /admin/system-brand-guidelines</name>
  <files>packages/dashboard/tests/routes/admin-system-brand-guidelines.test.ts</files>
  <read_first>
    - packages/dashboard/tests/routes/admin-service-connections.test.ts (THE template — follow exact structure for server bootstrap, auth stub, HTMX header usage, audit assertions)
    - packages/dashboard/src/routes/admin/service-connections.ts (route shape)
    - .planning/phases/08-system-brand-guideline/08-CONTEXT.md (D-08, D-10, D-15)
    - .planning/phases/08-system-brand-guideline/08-UI-SPEC.md (list columns, CTA copy, i18n keys)
  </read_first>
  <behavior>
    - Test 1 (list: admin can view): GET /admin/system-brand-guidelines with admin.system perm returns 200 with HTML containing the i18n-rendered title "System brand guidelines".
    - Test 2 (list: non-admin 403): GET /admin/system-brand-guidelines without admin.system returns 403.
    - Test 3 (list: empty state): with zero system guidelines, response HTML contains the empty-state heading string "No system brand guidelines yet".
    - Test 4 (list: populated): seed two system guidelines via the repository; response HTML contains both names.
    - Test 5 (create: POST /admin/system-brand-guidelines with admin.system and valid body creates a row with org_id='system'). Assert via repo.listSystemGuidelines() length increases by 1.
    - Test 6 (create: non-admin 403): POST without permission returns 403 and no row is created.
    - Test 7 (update: PATCH/POST /admin/system-brand-guidelines/:id updates name/description for a system guideline).
    - Test 8 (update: non-admin 403).
    - Test 9 (delete: POST /admin/system-brand-guidelines/:id/delete with admin.system removes the row).
    - Test 10 (delete: non-admin 403).
    - Test 11 (audit log): after a create/update/delete the audit helper is invoked (assert via mock or audit-table read, whichever admin-service-connections.test.ts uses).
    - Test 12 (scope isolation): mutating a system guideline does not touch any org-owned row (create two orgs' guidelines before + after and verify they're untouched).
    - Test 13 (HTMX fragment): GET /admin/system-brand-guidelines with `hx-request: true` header returns a fragment, not a full page (response does NOT contain `<html`).
  </behavior>
  <action>
    Mirror packages/dashboard/tests/routes/admin-service-connections.test.ts exactly for the bootstrap phase. Use vitest, build a Fastify instance, register systemBrandGuidelineRoutes (which does not exist yet — that's the point), stub auth via the same helper the reference test uses.

    Seed helper: `await repo.createGuideline({ orgId: 'system', name, description: null, version: 1, isActive: true })`.

    Permission flip: reference test sets request user permissions via an auth stub — reuse the same stub. A "non-admin" user has `permissions: []` or an empty permission set.

    The file MUST import `systemBrandGuidelineRoutes` from `../../src/routes/admin/system-brand-guidelines.js` so the import alone fails cleanly before the file exists.

    Tests MUST FAIL on first run because the route module doesn't exist yet.

    Run:
    ```
    cd packages/dashboard && npx vitest run tests/routes/admin-system-brand-guidelines.test.ts
    ```
    Expected: FAIL with "Cannot find module '../../src/routes/admin/system-brand-guidelines'" or equivalent.
  </action>
  <verify>
    <automated>cd packages/dashboard && npx vitest run tests/routes/admin-system-brand-guidelines.test.ts 2>&1 | grep -E "(FAIL|Cannot find module|is not a function)" || exit 1</automated>
  </verify>
  <acceptance_criteria>
    - File packages/dashboard/tests/routes/admin-system-brand-guidelines.test.ts exists
    - File contains "systemBrandGuidelineRoutes"
    - File contains "admin.system"
    - File contains "'system'" (quoted system sentinel)
    - File contains at least 13 `it(` or `test(` entries
    - Running the test file FAILS (RED phase) with a module-not-found error on systemBrandGuidelineRoutes
  </acceptance_criteria>
  <done>
    A failing test file committed as `test(08-P02): add failing route tests for system brand guidelines admin page`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement route module, list view, row partial, sidebar entry, and i18n keys</name>
  <files>
    packages/dashboard/src/routes/admin/system-brand-guidelines.ts,
    packages/dashboard/src/views/admin/system-brand-guidelines.hbs,
    packages/dashboard/src/views/admin/partials/system-brand-guideline-row.hbs,
    packages/dashboard/src/views/partials/sidebar.hbs,
    packages/dashboard/src/i18n/locales/en.json,
    packages/dashboard/src/server.ts
  </files>
  <read_first>
    - packages/dashboard/src/routes/admin/service-connections.ts (copy structure verbatim)
    - packages/dashboard/src/views/admin/service-connections.hbs (list shape)
    - packages/dashboard/src/views/admin/branding-guidelines.hbs (logo thumbnail pattern, table columns)
    - packages/dashboard/src/views/admin/branding-guideline-detail.hbs (to verify the existing `scope` hidden field support — may need to add one)
    - packages/dashboard/src/views/partials/sidebar.hbs (Phase 06 service-connections entry — copy-paste pattern)
    - packages/dashboard/src/i18n/locales/en.json (where admin.* keys live)
    - packages/dashboard/src/server.ts (how service-connections routes are registered)
    - .planning/phases/08-system-brand-guideline/08-UI-SPEC.md (EVERY string and column defined here)
    - packages/dashboard/tests/routes/admin-system-brand-guidelines.test.ts (Task 1 tests — the target)
    - packages/dashboard/src/static/style.css (verify every class referenced already exists: .page-header__subtitle, .page-actions, .btn, .btn--primary, .btn--secondary, .btn--sm, .btn--danger, .table, .table-wrapper, .empty-state, .badge, .badge--info, .badge--neutral, .badge--success, .tabs, .tab, .tab--active, .alert, .alert--error, .alert--success)
  </read_first>
  <action>
    STEP A — i18n keys.
    Add every key listed in UI-SPEC §Copywriting Contract to packages/dashboard/src/i18n/locales/en.json under the appropriate nested path. Keys from Surface A:
    - admin.systemBrand.title = "System brand guidelines"
    - admin.systemBrand.description = "Publish brand guideline templates that every organization can link to their sites or clone into their own workspace."
    - admin.systemBrand.createGuideline = "+ New system guideline"
    - admin.systemBrand.empty.heading = "No system brand guidelines yet"
    - admin.systemBrand.empty.body = "Create the first template to make it available to every organization."
    - admin.systemBrand.empty.cta = "Create your first system guideline"
    - admin.systemBrand.column.usage = "Usage"
    - admin.systemBrand.usage.linkedBy = "Linked by {count} org{plural}"
    - admin.systemBrand.usage.clonedCount = "Cloned {count} time{plural}"
    - admin.systemBrand.confirmDelete = "Delete \"{name}\"? Orgs that have linked this template will lose access on their next scan. Orgs that cloned it keep their copies."
    - admin.systemBrand.systemBadge = "System"
    - admin.systemBrand.deleteBlocked = "Cannot delete \"{name}\" — {count} sites are currently linked to it. Unlink first, then retry."
    Follow the existing JSON nesting style.

    STEP B — Route module: packages/dashboard/src/routes/admin/system-brand-guidelines.ts
    Signature:
    ```typescript
    export async function systemBrandGuidelineRoutes(
      server: FastifyInstance,
      storage: StorageAdapter,
    ): Promise<void>
    ```

    Endpoints:
    - GET /admin/system-brand-guidelines — preHandler: requirePermission('admin.system'). Load `storage.brandingRepository.listSystemGuidelines()`. If `hx-request` header set, render partial fragment; otherwise render full page via existing Handlebars setup (mirror service-connections.ts renderPage helper). Set activePage='system-brand-guidelines' so the sidebar highlights.
    - GET /admin/system-brand-guidelines/new — returns the modal fragment. Reuse packages/dashboard/src/views/admin/branding-guideline-form.hbs (create modal) — pass `scope: 'system'` so the form POSTs to /admin/system-brand-guidelines.
    - POST /admin/system-brand-guidelines — preHandler admin.system. Validate body manually (match existing dashboard route style — NOT Zod; service-connections.ts uses manual validation). Call `storage.brandingRepository.createGuideline({ orgId: 'system', name, description, version: 1, isActive: true })`. Write audit log. Return 201 + row partial on HTMX, 302 redirect on full page.
    - GET /admin/system-brand-guidelines/:id — preHandler admin.system. Load via getGuideline, assert row.orgId === 'system' (else 404). Render branding-guideline-detail.hbs with ctx `{ guideline, scope: 'system', backLink: '/admin/system-brand-guidelines' }`. If the existing branding-guideline-detail.hbs does not yet branch on `scope` for the back link and form action, extend it minimally (one `{{#if (eq scope "system")}}...{{else}}...{{/if}}`) — do not fork the template.
    - POST /admin/system-brand-guidelines/:id — preHandler admin.system. Verify row.orgId === 'system'; update via existing updateGuideline. Audit. Return row partial.
    - POST /admin/system-brand-guidelines/:id/delete — preHandler admin.system. Verify row.orgId === 'system'; check linked-site count via getSiteAssignments — if >0, return 409 with a toast rendering admin.systemBrand.deleteBlocked (delete-blocked state per UI spec). Otherwise delete, audit, return empty row swap + success toast.

    All mutation handlers MUST write audit_log. Follow the exact helper service-connections.ts uses (find it while reading the reference file).

    Register in packages/dashboard/src/server.ts next to the service-connections registration:
    ```typescript
    await server.register(async (s) => {
      await systemBrandGuidelineRoutes(s, storage);
    });
    ```
    Import at the top of server.ts.

    STEP C — List view: packages/dashboard/src/views/admin/system-brand-guidelines.hbs
    Follow UI-SPEC §Surface A structure exactly. Columns in order: Logo, Name (with description), Usage (stacked badges — render placeholder zeros if metrics aren't yet wired, the column still ships), Status, Version, Actions. Header uses `{{t "admin.systemBrand.title"}}`. Empty state uses admin.systemBrand.empty.heading/body/cta with the `.empty-state` class. + New button uses `.btn.btn--primary` with `hx-get="/admin/system-brand-guidelines/new"` hx-target="#modal-container".

    NO new CSS classes. Every class must be grep-findable in packages/dashboard/src/static/style.css.

    STEP D — Row partial: packages/dashboard/src/views/admin/partials/system-brand-guideline-row.hbs
    Renders a `<tr>` with the 6 columns. Actions cell uses button elements with hx-post / hx-get and hx-confirm — NO `<form>` tag inside the row. aria-label on each button uses `{action} {name}` format.

    STEP E — Sidebar: packages/dashboard/src/views/partials/sidebar.hbs
    Add a new `<li>` entry directly beneath the existing /admin/service-connections entry, inside the same "System Administration" group. Gate with `{{#if perm.adminSystem}}`. Copy the SVG icon pattern from service-connections entry — do not invent new icon art. Use `{{t "admin.systemBrand.title"}}` for the label. Set the active-class based on `activePage === 'system-brand-guidelines'`.

    STEP F — Run tests (GREEN):
    ```
    cd packages/dashboard && npx vitest run tests/routes/admin-system-brand-guidelines.test.ts
    ```
    Expected: all 13 tests pass.

    STEP G — Regression:
    ```
    cd packages/dashboard && npx vitest run tests/routes/admin-service-connections.test.ts
    cd packages/dashboard && npx tsc --noEmit
    ```
    Both must pass.

    Commit atoms:
    1. `feat(08-P02): add i18n keys for system brand guidelines admin page`
    2. `feat(08-P02): /admin/system-brand-guidelines route module with admin.system gate`
    3. `feat(08-P02): system brand guidelines list view + row partial + sidebar entry`
  </action>
  <verify>
    <automated>cd packages/dashboard && npx vitest run tests/routes/admin-system-brand-guidelines.test.ts && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - packages/dashboard/src/routes/admin/system-brand-guidelines.ts exists and exports "systemBrandGuidelineRoutes"
    - packages/dashboard/src/routes/admin/system-brand-guidelines.ts contains `requirePermission('admin.system')` at least 5 times (one per endpoint)
    - packages/dashboard/src/routes/admin/system-brand-guidelines.ts contains "orgId: 'system'"
    - packages/dashboard/src/routes/admin/system-brand-guidelines.ts contains "listSystemGuidelines"
    - packages/dashboard/src/views/admin/system-brand-guidelines.hbs exists
    - packages/dashboard/src/views/admin/system-brand-guidelines.hbs contains `{{t "admin.systemBrand.title"}}`
    - packages/dashboard/src/views/admin/system-brand-guidelines.hbs contains "empty-state"
    - packages/dashboard/src/views/admin/partials/system-brand-guideline-row.hbs exists
    - packages/dashboard/src/views/partials/sidebar.hbs contains "/admin/system-brand-guidelines"
    - packages/dashboard/src/views/partials/sidebar.hbs contains "perm.adminSystem"
    - packages/dashboard/src/i18n/locales/en.json contains "admin.systemBrand" OR equivalent nested key structure containing "systemBrand"
    - packages/dashboard/src/i18n/locales/en.json contains "System brand guidelines"
    - packages/dashboard/src/server.ts contains "systemBrandGuidelineRoutes"
    - NO new CSS classes: grep for class= in the new .hbs files yields only tokens already in style.css (checker will verify)
    - `cd packages/dashboard && npx vitest run tests/routes/admin-system-brand-guidelines.test.ts` exits 0 with all 13 tests passing
    - `cd packages/dashboard && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    SYS-01 (create/edit/delete multiple system guidelines) and SYS-04 (admin.system gate) are satisfied. Admin can navigate to the page, create/edit/delete rows, see empty state and populated list, and non-admin users cannot. All tests green. No new CSS classes.
  </done>
</task>

</tasks>

<verification>
- All 13 route/view tests pass
- TypeScript compiles clean (tsc --noEmit)
- Sidebar shows new entry under System Administration for admin users only
- grep confirms no new CSS classes invented — every class used exists in packages/dashboard/src/static/style.css
- grep confirms no hardcoded English — every user-facing string goes through `{{t "..."}}`
- The edit page loads branding-guideline-detail.hbs with scope=system and the correct back-link
</verification>

<success_criteria>
SYS-01 and SYS-04 delivered. A dashboard admin can manage the full
system-brand-guideline library CRUD from /admin/system-brand-guidelines.
Non-admins are blocked at route preHandler with 403. All mutations
write audit log entries. UI spec Surface A is delivered byte-for-byte.
</success_criteria>

<output>
After completion, create `.planning/phases/08-system-brand-guideline/08-P02-admin-route-and-page-SUMMARY.md`
</output>
