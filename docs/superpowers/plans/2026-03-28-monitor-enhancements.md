# Monitor Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mass acknowledge, change history page with CSV export, enhanced monitor source status, and restructured sidebar navigation.

**Architecture:** Dashboard-only changes — no new compliance API endpoints. Bulk actions loop over existing single-item endpoints. Change History queries existing `update_proposals` table. Monitor status computed server-side by joining sources with proposals. Sidebar splits Compliance group into Compliance + Monitoring.

**Tech Stack:** TypeScript, Fastify, Handlebars, HTMX, plain JS fetch, CSV streaming

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/dashboard/src/views/partials/sidebar.hbs` | Modify | Split Compliance into Compliance + Monitoring groups |
| `packages/dashboard/src/views/admin/proposals.hbs` | Modify | Add checkboxes and bulk action bar |
| `packages/dashboard/src/routes/admin/proposals.ts` | Modify | Add POST /admin/proposals/bulk-action |
| `packages/dashboard/src/static/app.js` | Modify | Add bulkProposalAction JS handler |
| `packages/dashboard/src/static/style.css` | Modify | Add bulk-bar and col--check styles |
| `packages/dashboard/src/views/admin/change-history.hbs` | Create | Change History page template |
| `packages/dashboard/src/routes/admin/change-history.ts` | Create | Change History route + CSV export |
| `packages/dashboard/src/server.ts` | Modify | Register change-history routes |
| `packages/dashboard/src/routes/admin/monitor.ts` | Modify | Enhanced source status with last DB update |
| `packages/dashboard/src/views/admin/monitor.hbs` | Modify | New columns and KPI card |
| `packages/dashboard/src/i18n/locales/*.json` | Modify | New keys in all 6 locales |

---

### Task 1: Sidebar Restructure

**Files:**
- Modify: `packages/dashboard/src/views/partials/sidebar.hbs:85-147`
- Modify: `packages/dashboard/src/i18n/locales/en.json`

- [ ] **Step 1: Update the sidebar template**

In `packages/dashboard/src/views/partials/sidebar.hbs`, replace the Compliance section (lines 85-147) with two separate sections. The first section keeps "Compliance" with just Jurisdictions and Regulations. A new "Monitoring" section follows with Monitor, Sources, Proposals, and Change History links. Move the OAuth Clients link from the old Compliance section into the System section (after Webhooks, before System Health).

The Compliance section becomes:
```handlebars
    {{!-- Compliance section — reference data --}}
    {{#if perm.complianceView}}
    <span class="sidebar__section-label">{{t "nav.compliance"}}</span>

    <a class="sidebar__item {{#if (startsWith currentPath '/admin/jurisdictions')}}is-active{{/if}}"
       href="/admin/jurisdictions"
       aria-current="{{#if (startsWith currentPath '/admin/jurisdictions')}}page{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
        <path d="M10 6v8M6 10h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      {{t "nav.jurisdictions"}}
    </a>

    <a class="sidebar__item {{#if (startsWith currentPath '/admin/regulations')}}is-active{{/if}}"
       href="/admin/regulations"
       aria-current="{{#if (startsWith currentPath '/admin/regulations')}}page{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/>
        <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      {{t "nav.regulations"}}
    </a>
```

The new Monitoring section:
```handlebars
    {{!-- Monitoring section — change tracking workflow --}}
    <span class="sidebar__section-label">{{t "nav.monitoring"}}</span>

    <a class="sidebar__item {{#if (startsWith currentPath '/admin/monitor')}}is-active{{/if}}"
       href="/admin/monitor"
       aria-current="{{#if (startsWith currentPath '/admin/monitor')}}page{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="2" y="3" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
        <path d="M5 10l3-3 3 4 4-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7 18h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      {{t "nav.monitor"}}
    </a>

    <a class="sidebar__item {{#if (startsWith currentPath '/admin/sources')}}is-active{{/if}}"
       href="/admin/sources">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zM4 10h12" stroke="currentColor" stroke-width="1.5"/>
        <path d="M10 2c-2 2-3 5-3 8s1 6 3 8m0-16c2 2 3 5 3 8s-1 6-3 8" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      {{t "nav.sources"}}
    </a>

    <a class="sidebar__item {{#if (startsWith currentPath '/admin/proposals')}}is-active{{/if}}"
       href="/admin/proposals">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M11 5H6a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-5M14 3l3 3-8 8H6v-3l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      {{t "nav.proposals"}}
    </a>

    <a class="sidebar__item {{#if (startsWith currentPath '/admin/change-history')}}is-active{{/if}}"
       href="/admin/change-history">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4 4h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" stroke="currentColor" stroke-width="1.5"/>
        <path d="M6 8h8M6 11h8M6 14h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      {{t "nav.changeHistory"}}
    </a>
    {{/if}}
```

Close the `complianceView` guard after the Monitoring section, not after Compliance.

- [ ] **Step 2: Add i18n keys to en.json**

Add to the `"nav"` section:
```json
"monitoring": "Monitoring",
"changeHistory": "Change History"
```

- [ ] **Step 3: Build and verify**

Run: `cd /root/luqen && npm run build -w packages/dashboard 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/views/partials/sidebar.hbs packages/dashboard/src/i18n/locales/en.json
git commit -m "feat: restructure sidebar — split Compliance into Compliance + Monitoring groups"
```

---

### Task 2: Mass Acknowledge — Proposals Template Checkboxes and Bulk Action Bar

**Files:**
- Modify: `packages/dashboard/src/views/admin/proposals.hbs`

- [ ] **Step 1: Add bulk action bar and checkboxes to Regulatory Updates tab**

Add a bulk action bar div before the table, a checkbox header column, and a checkbox cell in each pending row. The bulk bar:
```handlebars
<div id="bulk-bar-updates" class="bulk-bar" hidden>
  <span id="bulk-count-updates">0</span> {{t "admin.proposals.selected"}}
  <button type="button" class="btn btn--sm btn--primary" data-action="bulkProposalAction" data-bulk-action="acknowledge" data-tab="updates">
    {{t "admin.proposals.acknowledgeAll"}}
  </button>
  <button type="button" class="btn btn--sm btn--ghost" data-action="bulkClear" data-tab="updates">
    {{t "admin.proposals.clearSelection"}}
  </button>
</div>
```

Header checkbox (first th):
```handlebars
<th scope="col" class="col--check"><input type="checkbox" data-action="bulkSelectAll" data-tab="updates" aria-label="{{t 'admin.proposals.selectAll'}}"></th>
```

Row checkbox (first td, only for pending rows):
```handlebars
<td class="col--check">{{#if isPending}}<input type="checkbox" class="bulk-check" data-tab="updates" data-id="{{id}}" data-action="bulkToggle">{{/if}}</td>
```

Update empty state colspan from 6 to 7.

- [ ] **Step 2: Add same pattern to Custom Proposals tab**

Same structure with `data-tab="custom"` and two action buttons (Review All + Dismiss All):
```handlebars
<div id="bulk-bar-custom" class="bulk-bar" hidden>
  <span id="bulk-count-custom">0</span> {{t "admin.proposals.selected"}}
  <button type="button" class="btn btn--sm btn--primary" data-action="bulkProposalAction" data-bulk-action="review" data-tab="custom">
    {{t "admin.proposals.reviewAll"}}
  </button>
  <button type="button" class="btn btn--sm btn--danger" data-action="bulkProposalAction" data-bulk-action="dismiss" data-tab="custom">
    {{t "admin.proposals.dismissAll"}}
  </button>
  <button type="button" class="btn btn--sm btn--ghost" data-action="bulkClear" data-tab="custom">
    {{t "admin.proposals.clearSelection"}}
  </button>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/views/admin/proposals.hbs
git commit -m "feat: proposals template — checkboxes and bulk action bar"
```

---

### Task 3: Mass Acknowledge — JS Handler, Route, and CSS

**Files:**
- Modify: `packages/dashboard/src/static/app.js`
- Modify: `packages/dashboard/src/routes/admin/proposals.ts`
- Modify: `packages/dashboard/src/static/style.css`

- [ ] **Step 1: Add bulk action CSS**

Add to `packages/dashboard/src/static/style.css`:
```css
.bulk-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  background: var(--surface-alt, var(--bg-secondary));
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
}
.col--check { width: 2.5rem; text-align: center; }
```

- [ ] **Step 2: Add JS handlers in app.js**

Add four action handlers to the `actions` object in `packages/dashboard/src/static/app.js`:

`bulkToggle`: counts checked `.bulk-check` inputs per tab, updates the count span and shows/hides the bulk bar.

`bulkSelectAll`: toggles all `.bulk-check` inputs for the given tab, then calls `bulkToggle`.

`bulkClear`: unchecks all `.bulk-check` inputs and the select-all checkbox for the given tab, then calls `bulkToggle`.

`bulkProposalAction`: collects checked IDs, POSTs to `/admin/proposals/bulk-action` with `{ ids, action, notes }`, removes succeeded rows with fade-out animation, shows toast with count. Uses `document.createElement` for toast DOM creation (not innerHTML with user data). The server response `{ succeeded: string[], failed: string[] }` is trusted same-origin JSON.

- [ ] **Step 3: Add bulk-action route in proposals.ts**

Add `POST /admin/proposals/bulk-action` route after the dismiss route. Accepts `{ ids: string[], action: 'acknowledge' | 'review' | 'dismiss', notes?: string }`. Maps action to the corresponding compliance client function (`acknowledgeProposal`, `reviewProposal`, `dismissProposal`). Fires all requests in parallel with `Promise.all`, collects succeeded/failed arrays. Writes audit log per succeeded item with `{ bulk: true }` in details. Returns `{ succeeded, failed }`.

- [ ] **Step 4: Build and verify**

Run: `cd /root/luqen && npm run build -w packages/dashboard 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/static/app.js packages/dashboard/src/static/style.css packages/dashboard/src/routes/admin/proposals.ts
git commit -m "feat: mass acknowledge — bulk action route, JS handler, CSS"
```

---

### Task 4: Change History — Route Handler and Template

**Files:**
- Create: `packages/dashboard/src/routes/admin/change-history.ts`
- Create: `packages/dashboard/src/views/admin/change-history.hbs`
- Modify: `packages/dashboard/src/server.ts`

- [ ] **Step 1: Create the change history route handler**

Create `packages/dashboard/src/routes/admin/change-history.ts` with:

`GET /admin/change-history` — requires `compliance.view` or `audit.view`. Fetches all proposals via `listUpdateProposals`, filters to resolved statuses (acknowledged, reviewed, dismissed, approved, rejected). Applies optional filters: date range (from/to), action type, source text search. Sorts by date descending. Paginates server-side at 50 per page. Returns view data with entries, total count, page/totalPages, and filter values.

`GET /admin/change-history/export` — same filters, streams CSV response with headers: Date, Source, Summary, Type, Action, By, Notes. Uses `"` escaping for CSV values. Sets `content-disposition: attachment` header.

Helper functions:
- `filterAndFormat()` — filters proposals by status/date/search, maps to display records with formatted dates and Official/Custom type labels
- `toCsv()` — converts record array to CSV string with header row

- [ ] **Step 2: Create the change history template**

Create `packages/dashboard/src/views/admin/change-history.hbs` with:
- Export CSV button linking to `/admin/change-history/export` with current filter params
- Filter bar form with date range inputs, action dropdown, search text input, and Filter button
- Results count
- Data table with columns: Date, Source, Summary, Type (badge), Action (badge), By, Notes
- Pagination nav (Prev/Next) when totalPages > 1
- Empty state when no entries

- [ ] **Step 3: Register the route in server.ts**

Import `changeHistoryRoutes` and call `await changeHistoryRoutes(server, config.complianceUrl)` after `proposalRoutes`.

- [ ] **Step 4: Build and verify**

Run: `cd /root/luqen && npm run build -w packages/dashboard 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/routes/admin/change-history.ts packages/dashboard/src/views/admin/change-history.hbs packages/dashboard/src/server.ts
git commit -m "feat: change history page with filterable log and CSV export"
```

---

### Task 5: Monitor Source Status Enhancement

**Files:**
- Modify: `packages/dashboard/src/routes/admin/monitor.ts:17-110`
- Modify: `packages/dashboard/src/views/admin/monitor.hbs`

- [ ] **Step 1: Update MonitorSourceView and MonitorViewData interfaces**

Add to `MonitorSourceView`:
```typescript
readonly lastDbUpdateDisplay: string;
readonly status: 'up_to_date' | 'change_pending' | 'stale';
```

Add to `MonitorViewData`:
```typescript
readonly upToDateCount: number;
```

- [ ] **Step 2: Update buildMonitorViewData**

Build a map of source URL to most recent resolved date from proposals (status in acknowledged/reviewed/approved). Build a set of source URLs with pending proposals. For each source, compute:
- `lastDbUpdateDisplay` from the map (or "Never")
- `status`: 'stale' if `isSourceStale()`, 'change_pending' if URL is in pending set, 'up_to_date' otherwise

Compute `upToDateCount` from sources with `status === 'up_to_date'`.

The proposals list passed to `buildMonitorViewData` must include `acknowledgedAt` and `source` fields. The `MonitorProposal` type alias already maps to `UpdateProposal` which has these.

- [ ] **Step 3: Update monitor.hbs source table**

Add "Last DB Update" column header after "Last Checked". Add corresponding `<td>` with `{{lastDbUpdateDisplay}}`.

Replace the status badge logic to use the 3-state `status` field:
- `up_to_date` = green badge "Up to Date"
- `change_pending` = amber badge "Change Pending"
- `stale` = red badge "Stale"

Add 4th KPI card for "Up to Date" count with `text--success` styling.

- [ ] **Step 4: Build and verify**

Run: `cd /root/luqen && npm run build -w packages/dashboard 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/routes/admin/monitor.ts packages/dashboard/src/views/admin/monitor.hbs
git commit -m "feat: monitor source status — 3-state badges, last DB update, up-to-date KPI"
```

---

### Task 6: i18n — All 6 Locales

**Files:**
- Modify: `packages/dashboard/src/i18n/locales/en.json`
- Modify: `packages/dashboard/src/i18n/locales/it.json`
- Modify: `packages/dashboard/src/i18n/locales/de.json`
- Modify: `packages/dashboard/src/i18n/locales/fr.json`
- Modify: `packages/dashboard/src/i18n/locales/es.json`
- Modify: `packages/dashboard/src/i18n/locales/pt.json`

- [ ] **Step 1: Add English keys**

Nav section: `"monitoring": "Monitoring"`, `"changeHistory": "Change History"`

New `admin.changeHistory` block:
```json
"changeHistory": {
  "pageTitle": "Change History",
  "from": "From",
  "to": "To",
  "action": "Action",
  "allActions": "All Actions",
  "search": "Search",
  "searchPlaceholder": "Search by source or summary...",
  "filter": "Filter",
  "exportCsv": "Export CSV",
  "results": "result(s)",
  "colDate": "Date",
  "colType": "Type",
  "colAction": "Action Taken",
  "colBy": "By",
  "colNotes": "Notes",
  "noEntries": "No change history records found."
}
```

Add to `admin.proposals`: `"selectAll"`, `"selected"`, `"acknowledgeAll"`, `"reviewAll"`, `"dismissAll"`, `"clearSelection"`

Add to `admin.monitor`: `"lastDbUpdate"`, `"upToDate"`, `"changePending"`, `"sourcesAligned"`

- [ ] **Step 2: Translate all new keys for it, de, fr, es, pt**

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/i18n/locales/*.json
git commit -m "feat: i18n — monitor enhancements translations for all 6 locales"
```

---

### Task 7: Build, Test and Verify

- [ ] **Step 1: Build all packages**

Run: `cd /root/luqen && npm run build -w packages/core -w packages/compliance -w packages/dashboard -w packages/monitor 2>&1 | tail -10`

- [ ] **Step 2: Run full test suite and fix failures**

Run: `cd /root/luqen && npx vitest run 2>&1 | tail -15`

Fix any test failures caused by sidebar HTML changes, new fields in monitor view data, or bulk-action route expectations.

- [ ] **Step 3: Commit fixes**

```bash
git add -A
git commit -m "test: fix tests for monitor enhancements"
```
