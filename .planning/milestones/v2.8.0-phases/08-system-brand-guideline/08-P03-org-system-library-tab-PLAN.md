---
phase: 08-system-brand-guideline
plan: 03
type: execute
wave: 2
depends_on: [08-01]
files_modified:
  - packages/dashboard/src/routes/admin/branding-guidelines.ts
  - packages/dashboard/src/views/admin/branding-guidelines.hbs
  - packages/dashboard/src/views/admin/partials/system-library-row.hbs
  - packages/dashboard/src/i18n/locales/en.json
  - packages/dashboard/tests/routes/admin-branding-guidelines-system-library.test.ts
autonomous: true
requirements: [SYS-02, SYS-03]
objective: >
  Extend /admin/branding-guidelines (org view) with a "System Library" tab
  listing every system guideline read-only. Each row exposes two actions:
  Link to site (reuses the existing site-assignment flow, writes a
  site_branding row referencing the system guideline id) and Clone into
  org (POSTs to /admin/branding-guidelines/system/:id/clone which creates
  an org-owned independent copy via P01's cloneSystemGuideline and
  responds with HX-Redirect to the clone's edit page). System guidelines
  remain read-only from the org view — no edit/delete buttons.
must_haves:
  truths:
    - "Org admin sees two tabs on /admin/branding-guidelines: 'My guidelines' (default) and 'System library'"
    - "The System library tab lists every system guideline with a System badge, Link and Clone buttons, and NO edit/delete affordances"
    - "Clicking Link to site opens the existing site-assignment flow, and on save a site_branding row references the system guideline id (not a copy)"
    - "Clicking Clone into org fires an hx-confirm, then POSTs and receives an HX-Redirect to /admin/branding-guidelines/{newId}"
    - "The clone is an org-owned independent row with cloned_from_system_guideline_id set; the source system row is untouched"
    - "Tab state is URL-driven via ?tab=system — no client JS state; browser back/forward works"
    - "My guidelines tab remains byte-for-byte unchanged for existing users"
  artifacts:
    - path: "packages/dashboard/src/routes/admin/branding-guidelines.ts"
      provides: "Tab-aware GET handler + POST /system/:id/clone endpoint"
      contains: "cloneSystemGuideline"
    - path: "packages/dashboard/src/views/admin/branding-guidelines.hbs"
      provides: "Tab strip wrapping existing table; new tab panel renders the system library"
      contains: "systemLibraryActive"
    - path: "packages/dashboard/src/views/admin/partials/system-library-row.hbs"
      provides: "Read-only row for a system guideline in the org view"
    - path: "packages/dashboard/src/i18n/locales/en.json"
      provides: "admin.branding.tabs.* + admin.systemBrand.action.* + confirmClone/cloneSuccess/linkSuccess/cloneDefaultSuffix keys"
      contains: "systemLibrary"
  key_links:
    - from: "POST /admin/branding-guidelines/system/:id/clone"
      to: "brandingRepository.cloneSystemGuideline(sourceId, currentOrgId)"
      via: "route handler calls repo, responds HX-Redirect"
      pattern: "cloneSystemGuideline"
    - from: "GET /admin/branding-guidelines?tab=system"
      to: "brandingRepository.listSystemGuidelines()"
      via: "handler reads tab query param, branches view context"
      pattern: "listSystemGuidelines"
---

<objective>
Deliver Surface B from the UI spec: extend the existing
/admin/branding-guidelines page (org scope) with a System Library tab.
Preserves the current My guidelines tab byte-for-byte and adds a new
read-only list of system guidelines with Link and Clone actions. Link
writes a site_branding row pointing at the system guideline's id
(resolver handles it transparently via P01). Clone calls
cloneSystemGuideline and HX-Redirects to the clone's edit page so the
user can rename immediately (D-13).

Purpose: Lets org admins discover and consume the system library from
their own branding-guidelines page without a separate destination.
Output: New route endpoint, tab-aware view, row partial, i18n keys,
tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-system-brand-guideline/08-CONTEXT.md
@.planning/phases/08-system-brand-guideline/08-UI-SPEC.md
@.planning/phases/08-system-brand-guideline/08-P01-data-foundation-PLAN.md
@packages/dashboard/src/routes/admin/branding-guidelines.ts
@packages/dashboard/src/views/admin/branding-guidelines.hbs

<interfaces>
Repository methods from P01:
```typescript
listSystemGuidelines(): Promise<readonly BrandingGuidelineRecord[]>
cloneSystemGuideline(sourceId: string, targetOrgId: string, overrides?: { name?: string }): Promise<BrandingGuidelineRecord>
```

Tab precedent: Phase 07 P03 added report-detail sub-tabs using the
existing .tabs / .tab / .tab--active classes from style.css — grep for
"tab--active" in the views to see the pattern.

HX-Redirect pattern (existing):
```typescript
return reply.header('HX-Redirect', `/admin/branding-guidelines/${newId}`).code(204).send();
```

Current org context: the existing branding-guidelines.ts route handlers
already resolve orgId from request.user. Reuse the same helper.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write failing tests for tab-aware list + clone endpoint</name>
  <files>packages/dashboard/tests/routes/admin-branding-guidelines-system-library.test.ts</files>
  <read_first>
    - packages/dashboard/tests/routes/admin-service-connections.test.ts (test harness pattern)
    - packages/dashboard/src/routes/admin/branding-guidelines.ts (current handlers and orgId resolution)
    - .planning/phases/08-system-brand-guideline/08-CONTEXT.md (D-11, D-12, D-13, D-14, D-16)
    - .planning/phases/08-system-brand-guideline/08-UI-SPEC.md (Surface B section)
  </read_first>
  <behavior>
    - Test 1 (default tab): GET /admin/branding-guidelines (no query) as an org admin returns HTML showing the My guidelines tab active (tab--active applied to "My guidelines" link). Existing org-owned rows appear.
    - Test 2 (system tab): GET /admin/branding-guidelines?tab=system returns HTML with System library tab active. Seeded system guidelines are listed.
    - Test 3 (system tab empty): with zero system guidelines, response contains "No system templates available".
    - Test 4 (system tab rows read-only): system library row HTML contains "Link to site" and "Clone into org" buttons, and does NOT contain "Edit" or "Delete" buttons.
    - Test 5 (system badge): system library row HTML contains the System badge text.
    - Test 6 (clone happy path): POST /admin/branding-guidelines/system/:sourceId/clone as an org admin returns 204 with an HX-Redirect header pointing to /admin/branding-guidelines/{newId}. After the call, repo.listGuidelines('org-a') contains a row whose clonedFromSystemGuidelineId === sourceId.
    - Test 7 (clone: source must be system): POST /admin/branding-guidelines/system/:orgOwnedId/clone returns 400 or 404.
    - Test 8 (clone: read-only auth sufficient, no mutation on system row): after the clone, repo.getGuideline(sourceId) returns the UNTOUCHED source (name unchanged, version unchanged).
    - Test 9 (my guidelines tab unchanged): the default tab's HTML does not contain any "System library" strings from Surface B and matches the pre-phase snapshot in shape (at minimum: existing rows render without extra scaffolding).
    - Test 10 (clone requires auth): POST with no user / unauthenticated returns 401/403.
  </behavior>
  <action>
    Create packages/dashboard/tests/routes/admin-branding-guidelines-system-library.test.ts mirroring the harness in tests/routes/admin-service-connections.test.ts.

    Seed two system guidelines (via repo.createGuideline with orgId='system') and one org-owned guideline under 'org-a'. Stub auth to return an org-a member with branding.manage permission.

    Import the branding guideline routes factory from `../../src/routes/admin/branding-guidelines.js` — it already exists and the tests exercise the NEW endpoint + tab behavior that Task 2 will add. Tests will fail until Task 2 lands.

    Run:
    ```
    cd packages/dashboard && npx vitest run tests/routes/admin-branding-guidelines-system-library.test.ts
    ```
    Expected: FAIL with either route-not-found for /system/:id/clone or tab marker missing from HTML.
  </action>
  <verify>
    <automated>cd packages/dashboard && npx vitest run tests/routes/admin-branding-guidelines-system-library.test.ts 2>&1 | grep -E "(FAIL|404|Not Found|expect)" || exit 1</automated>
  </verify>
  <acceptance_criteria>
    - File packages/dashboard/tests/routes/admin-branding-guidelines-system-library.test.ts exists
    - File contains "tab=system"
    - File contains "/system/" and "/clone"
    - File contains "cloned_from_system_guideline_id" OR "clonedFromSystemGuidelineId"
    - File contains "HX-Redirect"
    - File contains at least 10 `it(` or `test(` entries
    - Test file FAILS on first run (RED)
  </acceptance_criteria>
  <done>
    Failing test file committed as `test(08-P03): add failing tests for org system library tab and clone endpoint`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add tab-aware list, System Library row partial, clone endpoint, and i18n keys</name>
  <files>
    packages/dashboard/src/routes/admin/branding-guidelines.ts,
    packages/dashboard/src/views/admin/branding-guidelines.hbs,
    packages/dashboard/src/views/admin/partials/system-library-row.hbs,
    packages/dashboard/src/i18n/locales/en.json
  </files>
  <read_first>
    - packages/dashboard/src/routes/admin/branding-guidelines.ts (full file — understand existing GET, POST, auth resolution)
    - packages/dashboard/src/views/admin/branding-guidelines.hbs (current structure; MUST remain byte-for-byte inside the default tab panel)
    - packages/dashboard/src/static/style.css (grep for ".tabs", ".tab", ".tab--active" to confirm classes exist — do NOT add new ones)
    - packages/dashboard/src/views/partials/sidebar.hbs (sanity: the badge--info class already exists and is used)
    - .planning/phases/08-system-brand-guideline/08-UI-SPEC.md (Surface B — every column, every i18n key, every accessibility rule)
    - packages/dashboard/tests/routes/admin-branding-guidelines-system-library.test.ts (Task 1 tests are the target)
  </read_first>
  <action>
    STEP A — i18n keys.
    Add to packages/dashboard/src/i18n/locales/en.json:
    - admin.branding.tabs.myGuidelines = "My guidelines"
    - admin.branding.tabs.systemLibrary = "System library"
    - admin.branding.tabsLabel = "Brand guideline scope"
    - admin.systemBrand.library.emptyHeading = "No system templates available"
    - admin.systemBrand.library.emptyBody = "Your dashboard admin has not published any system brand guidelines yet."
    - admin.systemBrand.action.linkToSite = "Link to site"
    - admin.systemBrand.action.cloneIntoOrg = "Clone into org"
    - admin.systemBrand.confirmClone = "Clone \"{name}\" into your organization? You will be able to rename it on the next screen."
    - admin.systemBrand.cloneSuccess = "Cloned from system guideline — rename to finish."
    - admin.systemBrand.linkSuccess = "Linked \"{name}\" to {siteUrl}. Next scan will use the live system template."
    - admin.systemBrand.cloneDefaultSuffix = " (cloned)"
    (If admin.systemBrand.systemBadge was not added in P02 for any reason, add it here: "System".)

    STEP B — Route: extend the existing GET /admin/branding-guidelines handler in packages/dashboard/src/routes/admin/branding-guidelines.ts.

    1. Read `tab` query param: `const tab = (request.query as any)?.tab === 'system' ? 'system' : 'mine';`
    2. Always load the org's own guidelines via existing listGuidelines(orgId) — the My guidelines tab must be unchanged even when inactive (SSR renders both panels' content OR only the active one; follow the existing template structure — if only the active panel is rendered, add the mine data only when tab === 'mine' and system data only when tab === 'system').
    3. When tab === 'system', load `const systemGuidelines = await storage.brandingRepository.listSystemGuidelines();`.
    4. Pass `{ tab, systemLibraryActive: tab === 'system', guidelines, systemGuidelines }` to the template.

    STEP C — Add new endpoint: POST /admin/branding-guidelines/system/:id/clone (in the same route file, inside the same registration closure).
    ```typescript
    server.post(
      '/admin/branding-guidelines/system/:id/clone',
      { preHandler: requirePermission('branding.manage') },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const orgId = request.user!.orgId; // or however the file resolves current org
        // Guard: source must exist and be system-scoped
        const source = await storage.brandingRepository.getGuideline(id);
        if (!source || source.orgId !== 'system') {
          return reply.code(404).send({ error: 'System guideline not found' });
        }
        const clone = await storage.brandingRepository.cloneSystemGuideline(id, orgId);
        // Audit
        // writeAudit(request, 'branding.clone_system', { sourceId: id, newId: clone.id });
        return reply.header('HX-Redirect', `/admin/branding-guidelines/${clone.id}`).code(204).send();
      },
    );
    ```
    Match the exact audit helper used elsewhere in the file.

    STEP D — View: packages/dashboard/src/views/admin/branding-guidelines.hbs
    Wrap the existing content in a `.tabs` strip + two `.tab-panel` containers. The existing table moves inside the `mine` panel VERBATIM — do not modify a single row of the existing markup; just wrap it.

    Tab strip:
    ```handlebars
    <nav class="tabs" role="tablist" aria-label="{{t 'admin.branding.tabsLabel'}}">
      <a class="tab {{#unless systemLibraryActive}}tab--active{{/unless}}"
         href="/admin/branding-guidelines"
         role="tab"
         aria-selected="{{#unless systemLibraryActive}}true{{else}}false{{/unless}}">
        {{t "admin.branding.tabs.myGuidelines"}}
        <span class="badge badge--neutral">{{guidelines.length}}</span>
      </a>
      <a class="tab {{#if systemLibraryActive}}tab--active{{/if}}"
         href="/admin/branding-guidelines?tab=system"
         role="tab"
         aria-selected="{{#if systemLibraryActive}}true{{else}}false{{/if}}">
        {{t "admin.branding.tabs.systemLibrary"}}
        <span class="badge badge--info">{{systemGuidelines.length}}</span>
      </a>
    </nav>
    ```

    System panel body (renders only when systemLibraryActive):
    - If systemGuidelines.length === 0 → `.empty-state` block using the library.emptyHeading / library.emptyBody keys. NO CTA (org admins cannot create).
    - Otherwise a `<table>` with: Logo, Name + description, System badge column, Version, Actions (Link to site + Clone into org). Reuse `{{> partials/admin/system-library-row this}}`.

    STEP E — Row partial: packages/dashboard/src/views/admin/partials/system-library-row.hbs
    Renders a `<tr>`. Button elements (not `<form>`):
    - Link to site: `.btn.btn--sm.btn--secondary`, hx-get opening the existing site-assignment modal pre-populated with the system guideline's id. Aria label "Link to site — {{name}}".
    - Clone into org: `.btn.btn--sm.btn--primary`, `hx-post="/admin/branding-guidelines/system/{{id}}/clone"`, `hx-confirm="{{t 'admin.systemBrand.confirmClone' name=name}}"`, aria label "Clone {{name}} into organization".
    - Wrap any OOB swap targets in `<template>` tags if this row is ever returned as a tbody fragment (per feedback_htmx_oob_in_table.md).
    - System badge span: `<span class="badge badge--info">{{t "admin.systemBrand.systemBadge"}}</span>`.
    - NO edit/delete buttons (D-14).

    STEP F — Run tests (GREEN):
    ```
    cd packages/dashboard && npx vitest run tests/routes/admin-branding-guidelines-system-library.test.ts
    ```
    Expected: all 10 tests pass.

    STEP G — Regression:
    ```
    cd packages/dashboard && npx vitest run tests/routes/ && npx tsc --noEmit
    ```
    Both must pass — critical: existing branding-guidelines tests must not break because the My guidelines tab content is unchanged.

    Commits:
    1. `feat(08-P03): add i18n keys for org system library tab`
    2. `feat(08-P03): POST /admin/branding-guidelines/system/:id/clone endpoint`
    3. `feat(08-P03): system library tab view + row partial in /admin/branding-guidelines`
  </action>
  <verify>
    <automated>cd packages/dashboard && npx vitest run tests/routes/admin-branding-guidelines-system-library.test.ts && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - packages/dashboard/src/routes/admin/branding-guidelines.ts contains "/admin/branding-guidelines/system/:id/clone" (or path-param equivalent)
    - packages/dashboard/src/routes/admin/branding-guidelines.ts contains "cloneSystemGuideline"
    - packages/dashboard/src/routes/admin/branding-guidelines.ts contains "HX-Redirect"
    - packages/dashboard/src/routes/admin/branding-guidelines.ts contains "tab === 'system'" OR "tab: 'system'" OR "systemLibraryActive"
    - packages/dashboard/src/views/admin/branding-guidelines.hbs contains `role="tablist"`
    - packages/dashboard/src/views/admin/branding-guidelines.hbs contains "systemLibraryActive"
    - packages/dashboard/src/views/admin/branding-guidelines.hbs contains `{{t "admin.branding.tabs.myGuidelines"}}`
    - packages/dashboard/src/views/admin/branding-guidelines.hbs contains `{{t "admin.branding.tabs.systemLibrary"}}`
    - packages/dashboard/src/views/admin/partials/system-library-row.hbs exists
    - packages/dashboard/src/views/admin/partials/system-library-row.hbs contains `hx-post="/admin/branding-guidelines/system/`
    - packages/dashboard/src/views/admin/partials/system-library-row.hbs contains "hx-confirm"
    - packages/dashboard/src/views/admin/partials/system-library-row.hbs does NOT contain "btn--danger"
    - packages/dashboard/src/i18n/locales/en.json contains "systemLibrary"
    - packages/dashboard/src/i18n/locales/en.json contains "confirmClone"
    - `cd packages/dashboard && npx vitest run tests/routes/admin-branding-guidelines-system-library.test.ts` exits 0
    - `cd packages/dashboard && npx tsc --noEmit` exits 0
    - `cd packages/dashboard && npx vitest run tests/routes/` exits 0 (no regression in existing branding-guideline tests)
  </acceptance_criteria>
  <done>
    SYS-02 (link to site) and SYS-03 (clone into org with provenance) are satisfied. Org admins see a System Library tab and can link or clone system guidelines. Cloning HX-Redirects to the clone's edit page. All tests green.
  </done>
</task>

</tasks>

<verification>
- All 10 new tests pass
- TypeScript compiles clean
- My guidelines tab HTML is byte-identical to pre-phase (grep diff of key structural landmarks)
- grep confirms no new CSS classes invented
- grep confirms no hardcoded English in the new partial
- The clone endpoint refuses non-system sources with 404
</verification>

<success_criteria>
SYS-02 and SYS-03 delivered. Org admins can discover system guidelines
from their own branding page, link them to sites, or clone them into
their org. System guidelines remain read-only from the org view. Clones
have provenance via cloned_from_system_guideline_id. Source system
guidelines are untouched by clone operations.
</success_criteria>

<output>
After completion, create `.planning/phases/08-system-brand-guideline/08-P03-org-system-library-tab-SUMMARY.md`
</output>
