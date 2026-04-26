---
phase: 06-service-connections-ui
plan: 04
type: execute
wave: 4
depends_on: [06-03]
files_modified:
  - packages/dashboard/src/views/admin/service-connections.hbs
  - packages/dashboard/src/views/admin/partials/service-connection-row.hbs
  - packages/dashboard/src/views/admin/partials/service-connection-edit-row.hbs
  - packages/dashboard/src/routes/admin/service-connections.ts
  - packages/dashboard/src/i18n/locales/en.json
  - packages/dashboard/src/views/layouts/admin-sidebar.hbs
autonomous: true
requirements: [SVC-01, SVC-02, SVC-03, SVC-04]
must_haves:
  truths:
    - "An admin opens /admin/service-connections and sees a table with three rows (compliance, branding, llm) showing URL, client ID, hasSecret badge, last updated, status"
    - "Clicking Edit opens an HTMX inline form with URL, Client ID, Client Secret (password input with placeholder showing last rotated date)"
    - "Leaving the Client Secret field blank and saving keeps the existing secret"
    - "Clicking Test sends current form values to the test endpoint and renders the result inline (ok/error badge with latency or error message)"
    - "All visible text comes from {{t}} i18n keys under admin.serviceConnections.*"
    - "The page appears in the admin sidebar navigation"
  artifacts:
    - path: "packages/dashboard/src/views/admin/service-connections.hbs"
      provides: "Full-page Handlebars template listing three service connections in a table"
    - path: "packages/dashboard/src/views/admin/partials/service-connection-row.hbs"
      provides: "HTMX partial for a single row (swapped on save)"
    - path: "packages/dashboard/src/views/admin/partials/service-connection-edit-row.hbs"
      provides: "HTMX partial for the inline edit form (swapped on Edit click)"
    - path: "packages/dashboard/src/i18n/locales/en.json"
      provides: "admin.serviceConnections.* translation keys"
      contains: "admin.serviceConnections.title"
    - path: "packages/dashboard/src/views/layouts/admin-sidebar.hbs"
      provides: "Navigation entry linking to /admin/service-connections (admin-only)"
  key_links:
    - from: "views/admin/service-connections.hbs"
      to: "/admin/service-connections"
      via: "HTMX hx-get for row swap on save"
      pattern: "hx-get=\"/admin/service-connections"
    - from: "views/admin/partials/service-connection-edit-row.hbs"
      to: "/admin/service-connections/:id"
      via: "hx-post for save"
      pattern: "hx-post=\"/admin/service-connections"
    - from: "views/admin/partials/service-connection-edit-row.hbs"
      to: "/admin/service-connections/:id/test"
      via: "hx-post for test button"
      pattern: "/test"
---

<objective>
Deliver the admin UI for service connections: a single page at /admin/service-connections with a table of three rows, an HTMX inline edit form per row, a test button, and i18n coverage. All styling uses existing Emerald design tokens and CSS classes.

Purpose: SVC-01..04 require a user-facing admin page. The API exists after plan 03 — this plan renders it.

Output: Handlebars views (page + 2 partials), route additions for HTML rendering, i18n keys, sidebar navigation entry.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-service-connections-ui/06-CONTEXT.md
@packages/dashboard/src/views/admin/clients.hbs
@packages/dashboard/src/routes/admin/clients.ts
@packages/dashboard/src/routes/admin/llm.ts
@packages/dashboard/src/i18n/locales/en.json
@packages/dashboard/src/static/style.css
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add i18n keys + sidebar navigation entry</name>
  <files>
    packages/dashboard/src/i18n/locales/en.json,
    packages/dashboard/src/views/layouts/admin-sidebar.hbs
  </files>
  <read_first>
    - packages/dashboard/src/i18n/locales/en.json (find `admin.clients.*` block to match structure)
    - packages/dashboard/src/views/layouts/admin-sidebar.hbs (find where /admin/clients and /admin/llm links live, match their pattern)
    - .planning/phases/06-service-connections-ui/06-CONTEXT.md (D-23)
  </read_first>
  <action>
    Per D-23:

    1. In `en.json`, add an `admin.serviceConnections` block with these keys (use existing nesting style in the file — flat dotted keys or nested objects, whichever the file uses):

    ```
    admin.serviceConnections.title = "Service Connections"
    admin.serviceConnections.description = "Manage outbound OAuth connections to compliance, branding, and LLM services."
    admin.serviceConnections.column.service = "Service"
    admin.serviceConnections.column.url = "URL"
    admin.serviceConnections.column.clientId = "Client ID"
    admin.serviceConnections.column.status = "Status"
    admin.serviceConnections.column.lastUpdated = "Last updated"
    admin.serviceConnections.column.actions = "Actions"
    admin.serviceConnections.service.compliance = "Compliance"
    admin.serviceConnections.service.branding = "Branding"
    admin.serviceConnections.service.llm = "LLM"
    admin.serviceConnections.status.ok = "OK"
    admin.serviceConnections.status.error = "Error"
    admin.serviceConnections.status.untested = "Untested"
    admin.serviceConnections.status.notConfigured = "Not configured"
    admin.serviceConnections.fallback.db = "From database"
    admin.serviceConnections.fallback.config = "From config file (fallback)"
    admin.serviceConnections.action.edit = "Edit"
    admin.serviceConnections.action.test = "Test connection"
    admin.serviceConnections.action.save = "Save"
    admin.serviceConnections.action.cancel = "Cancel"
    admin.serviceConnections.action.clearSecret = "Clear secret"
    admin.serviceConnections.form.url = "Service URL"
    admin.serviceConnections.form.clientId = "OAuth Client ID"
    admin.serviceConnections.form.clientSecret = "OAuth Client Secret"
    admin.serviceConnections.form.clientSecretPlaceholder = "●●●●●●●● (leave blank to keep)"
    admin.serviceConnections.form.clientSecretHint = "Leave blank to keep current secret. Type a new value to replace."
    admin.serviceConnections.toast.saved = "Saved and clients reloaded"
    admin.serviceConnections.toast.reloadFailed = "Save succeeded but client reload failed: {{error}}"
    admin.serviceConnections.test.running = "Testing..."
    admin.serviceConnections.test.success = "Success ({{latencyMs}}ms)"
    admin.serviceConnections.test.failureOauth = "OAuth failed: {{error}}"
    admin.serviceConnections.test.failureHealth = "Health check failed: {{error}}"
    ```

    2. In `admin-sidebar.hbs`, add a new nav entry for "Service Connections" linking to `/admin/service-connections`. Place it adjacent to the existing `/admin/clients` or `/admin/llm` entries (choose based on visual grouping). Mirror the permission-gated template conditional used by those entries (`{{#if can.dashboardAdmin}}` or whatever the existing pattern is — read it first).
  </action>
  <verify>
    <automated>grep -c "admin.serviceConnections" packages/dashboard/src/i18n/locales/en.json &amp;&amp; grep -n "/admin/service-connections" packages/dashboard/src/views/layouts/admin-sidebar.hbs</automated>
  </verify>
  <done>
    i18n keys present; sidebar entry renders for admins only.
  </done>
  <acceptance_criteria>
    - `grep -c "admin.serviceConnections" packages/dashboard/src/i18n/locales/en.json` returns at least 25
    - `grep -n "admin.serviceConnections.title" packages/dashboard/src/i18n/locales/en.json` returns a match
    - `grep -n "/admin/service-connections" packages/dashboard/src/views/layouts/admin-sidebar.hbs` returns a match
    - No hardcoded English strings in the sidebar entry (uses {{t}})
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Handlebars page + row partial + edit-form partial</name>
  <files>
    packages/dashboard/src/views/admin/service-connections.hbs,
    packages/dashboard/src/views/admin/partials/service-connection-row.hbs,
    packages/dashboard/src/views/admin/partials/service-connection-edit-row.hbs
  </files>
  <read_first>
    - packages/dashboard/src/views/admin/clients.hbs (full file — mirror layout, table structure, CSS class usage)
    - packages/dashboard/src/views/admin/llm.hbs (HTMX partial pattern + tab layout if applicable)
    - packages/dashboard/src/static/style.css (grep for `.admin-table`, `.btn`, `.badge`, `.form-field` and other tokens currently used in clients.hbs — reuse verbatim)
    - .planning/phases/06-service-connections-ui/06-CONTEXT.md (D-16, D-17, D-18, D-19, D-24, D-25)
  </read_first>
  <action>
    Per D-16..D-25:

    1. Create `views/admin/service-connections.hbs` — the full-page template extending the admin layout (same extends/partial directive as `clients.hbs`). Contains:
       - Page header with `{{t 'admin.serviceConnections.title'}}` + description
       - Table with columns: Service, URL, Client ID, Status, Last updated, Actions
       - For each connection in `{{connections}}`, render `{{> admin/partials/service-connection-row connection}}`
       - Each row has `id="service-connection-row-{{serviceId}}"` to be targeted by HTMX swaps
       - Reuse EXACT CSS classes found in clients.hbs (do not invent new classes — D-24)

    2. Create `views/admin/partials/service-connection-row.hbs`:
       - `<tr id="service-connection-row-{{serviceId}}">`
       - Columns: service name (localized), url, clientId, status badge (`{{#if hasSecret}}...{{/if}}` + `{{#if source}}{{t 'admin.serviceConnections.fallback.config'}}{{/if}}`), updatedAt, actions
       - Actions cell: Edit button with `hx-get="/admin/service-connections/{{serviceId}}/edit"` and `hx-target="#service-connection-row-{{serviceId}}"` and `hx-swap="outerHTML"`
       - Test button with `hx-post="/admin/service-connections/{{serviceId}}/test"` (no body, uses stored values) targeting a `#test-result-{{serviceId}}` span

    3. Create `views/admin/partials/service-connection-edit-row.hbs` — an inline edit row with NO `<form>` element (forms cannot live inside `<tr>`/`<td>` — violates HTML + project rule feedback_htmx_forms_in_tables.md):
       - Root element is `<tr id="service-connection-row-{{serviceId}}">` (replaces the read-only row via `hx-swap="outerHTML"`)
       - Inputs live directly inside `<td>` cells — no wrapping form tag anywhere in this partial
       - Fields (bare inputs inside `<td>`):
         - URL: `<input type="url" name="url" value="{{url}}" required>`
         - Client ID: `<input type="text" name="clientId" value="{{clientId}}" required>`
         - Client Secret: `<input type="password" name="clientSecret" placeholder="{{t 'admin.serviceConnections.form.clientSecretPlaceholder'}}">` (NEVER has value attribute — D-18, D-19)
         - Hint text using `admin.serviceConnections.form.clientSecretHint`
       - Save button: `<button hx-post="/admin/service-connections/{{serviceId}}" hx-include="closest tr" hx-target="closest tr" hx-swap="outerHTML">{{t 'admin.serviceConnections.action.save'}}</button>` — `hx-include="closest tr"` sweeps up all sibling input values from the row
       - Cancel button: `<button hx-get="/admin/service-connections/{{serviceId}}/row" hx-target="closest tr" hx-swap="outerHTML">{{t 'admin.serviceConnections.action.cancel'}}</button>`
       - Test button: `<button hx-post="/admin/service-connections/{{serviceId}}/test" hx-include="closest tr" hx-target="#test-result-{{serviceId}}">{{t 'admin.serviceConnections.action.test'}}</button>`
       - Clear Secret button: `<button hx-post="/admin/service-connections/{{serviceId}}/clear-secret" hx-confirm="{{t 'admin.serviceConnections.action.clearSecret'}}?" hx-target="closest tr" hx-swap="outerHTML">{{t 'admin.serviceConnections.action.clearSecret'}}</button>`
       - CSRF: Do NOT add a hidden `{{csrfToken}}` input. Dashboard uses a global HTMX header interceptor that reads `<meta name="csrf-token">` and sets `X-CSRF-Token` on every HTMX request — read `views/admin/clients.hbs`, `views/admin/monitor.hbs`, or `views/admin/api-keys.hbs` to confirm the pattern, and rely on it here.
       - A `<span id="test-result-{{serviceId}}"></span>` for inline test result rendering (placed in the actions cell)
       - All visible text uses `{{t}}`

    4. In `routes/admin/service-connections.ts` (created in P03), add HTML-rendering variants:
       - `GET /admin/service-connections` with HTML accept → renders full page (fetch list from repo, mask secrets, compute `source: 'db'|'config'` per row for the fallback badge)
       - `GET /admin/service-connections/:id/edit` → renders edit-row partial
       - `GET /admin/service-connections/:id/row` → re-renders row partial (for Cancel)
       - The existing POST endpoints from P03 MUST support HTMX: on save success, respond with the re-rendered row partial (HTML) when `Accept: text/html` or `HX-Request` header present, and JSON otherwise. Use the pattern from `routes/admin/clients.ts` for content negotiation — read it and match.
       - **Toast rendering (D-22):** On `POST /admin/service-connections/:id` the HTMX HTML response MUST return the re-rendered row partial PLUS an out-of-band swap containing a toast element. On success (HTTP 200): `<div id="service-conn-toast" hx-swap-oob="true" class="toast toast--success">{{t 'admin.serviceConnections.toast.saved'}}</div>`. On reload failure (HTTP 500, DB row still updated, old client preserved): `<div id="service-conn-toast" hx-swap-oob="true" class="toast toast--error">{{t 'admin.serviceConnections.toast.reloadFailed'}} — {{errorMessage}}</div>`. Before emitting, **grep `packages/dashboard/src/static/style.css` for existing toast class names** and match them verbatim — do NOT invent new classes (D-24). Substitute the real class names (e.g. `.toast`, `.toast--success`, `.toast--error` or whatever the project uses) into the fragments above.
       - The base `views/admin/service-connections.hbs` page MUST include `<div id="service-conn-toast"></div>` as the persistent target element for the OOB swap (place it near the page header, outside the table).
       - Test endpoint: when called via HTMX, return a fragment like `<span class="badge badge-success">{{t 'admin.serviceConnections.test.success' latencyMs=42}}</span>` — otherwise JSON.

    5. All three views use ONLY existing CSS classes. If you find you need a class that doesn't exist in style.css, use the closest existing class. Do not edit style.css.
  </action>
  <verify>
    <automated>ls packages/dashboard/src/views/admin/service-connections.hbs packages/dashboard/src/views/admin/partials/service-connection-row.hbs packages/dashboard/src/views/admin/partials/service-connection-edit-row.hbs &amp;&amp; cd packages/dashboard &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <done>
    Three view files exist; route serves HTML on text/html accept; TypeScript compiles.
  </done>
  <acceptance_criteria>
    - Three new .hbs files exist
    - `grep -n "hx-post=\"/admin/service-connections" packages/dashboard/src/views/admin/partials/service-connection-edit-row.hbs` returns a match
    - `grep -c "{{t" packages/dashboard/src/views/admin/service-connections.hbs` returns at least 5 (proves i18n usage, not hardcoded text)
    - `grep -n "type=\"password\"" packages/dashboard/src/views/admin/partials/service-connection-edit-row.hbs` returns a match
    - `grep -n "value=" packages/dashboard/src/views/admin/partials/service-connection-edit-row.hbs | grep -i secret` returns NOTHING (secret input never has value attribute per D-19)
    - `grep -n "/admin/service-connections/:id/edit\|serviceConnections.*edit\|/edit" packages/dashboard/src/routes/admin/service-connections.ts` returns a match (edit partial route exists)
    - **W2:** `grep -n "<form" packages/dashboard/src/views/admin/partials/service-connection-edit-row.hbs` returns NOTHING (no form tag inside the tr partial)
    - **W2:** `grep -n "hx-include" packages/dashboard/src/views/admin/partials/service-connection-edit-row.hbs` returns at least one match
    - **W2:** `grep -n "hx-post" packages/dashboard/src/views/admin/partials/service-connection-edit-row.hbs` returns at least one match
    - **W1:** `grep -n "hx-swap-oob" packages/dashboard/src/views/admin/partials/service-connection-row.hbs` returns a match (or in a dedicated toast fragment partial if the implementer splits it out — the OOB swap must appear in the save-response HTML)
    - **W1:** `grep -n "service-conn-toast" packages/dashboard/src/views/admin/service-connections.hbs` returns a match (base-view contains the OOB target div)
    - `cd packages/dashboard && npx tsc --noEmit` exits 0
  </acceptance_criteria>
</task>

</tasks>

<verification>
- Navigate to /admin/service-connections as admin in a local dashboard instance renders 3 rows (manual smoke; automated test in P05)
- TypeScript clean
- All visible text is wrapped in {{t}} — no English literals in the templates
- No new CSS classes added to style.css
</verification>

<success_criteria>
- SVC-01 visible list rendered with 3 rows
- SVC-02 edit form with URL + clientId + clientSecret inputs
- SVC-03 secret field has no value attribute and placeholder indicates last-rotated / blank-to-keep
- SVC-04 Test button calls the test endpoint and renders the result inline
- All text via i18n keys under admin.serviceConnections.*
- Navigation entry present for admins only
</success_criteria>

<output>
After completion, create `.planning/phases/06-service-connections-ui/06-04-SUMMARY.md` documenting views, HTMX targets, i18n key count, and any CSS class reuse notes.
</output>
