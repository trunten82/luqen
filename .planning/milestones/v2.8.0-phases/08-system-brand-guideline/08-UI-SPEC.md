---
phase: 08
slug: system-brand-guideline
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-05
---

# Phase 08 — UI Design Contract

> Visual and interaction contract for the System Brand Guideline phase. This phase extends two existing dashboard surfaces; it does NOT introduce any new tokens, components, or CSS classes. All values below are sourced verbatim from `packages/dashboard/src/static/style.css` and the Phase 06 `/admin/service-connections` precedent.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (project is Handlebars + HTMX, not React — shadcn is not applicable) |
| Preset | not applicable |
| Component library | none — in-house CSS token system in `packages/dashboard/src/static/style.css` |
| Icon library | inline SVGs (copy patterns from `views/partials/sidebar.hbs` and `branding-guidelines.hbs`) |
| Font | system stack (unchanged) |

**Mandatory rule:** This phase MUST NOT add a single new CSS class. Every visual affordance below names a class that already exists in `style.css`. If the executor finds a need for a new class, STOP and raise it to the planner — the contract forbids CSS invention per project convention (`feedback_design_system_consistency.md`).

---

## Spacing Scale

Existing CSS custom properties in `style.css` lines 61-66. Use these tokens in Handlebars inline-style or existing utility classes (`mt-xs`, `mt-sm`, `mt-md`, `mt-lg`, `gap-sm`, `gap-md`).

| Token | Value | CSS var | Usage in this phase |
|-------|-------|---------|---------------------|
| xs | 4px | `--space-xs` | Badge-to-label gap, icon inset |
| sm | 8px | `--space-sm` | Button group gap, row action gap |
| md | 16px | `--space-md` | Default cell padding, form field gap |
| lg | 24px | `--space-lg` | Section padding, tab panel top gap |
| xl | 32px | `--space-xl` | Tab bar bottom margin |
| 2xl | 48px | `--space-2xl` | Empty-state vertical padding (already used in `.empty-state`) |

**Exceptions:** none. Do not introduce 12px, 20px, 28px, or any non-token value.

---

## Typography

Existing custom properties in `style.css` lines 71-77. THREE sizes and THREE weights are used on these new surfaces — all pre-existing tokens, no new typography declared.

| Role | Size | CSS var | Weight | Usage |
|------|------|---------|--------|-------|
| Body | 16px (1rem) | `--font-size-base` | 400 | Descriptions, table cells, form help |
| Label/meta | 14px (0.875rem) | `--font-size-sm` | 600 | Table headers, tab labels, button text |
| Heading (page) | 20px (1.25rem) | `--font-size-xl` | 700 | `.page-header__title` and `h2` on the two pages |

Line-heights inherited from existing `body` rule — do not override.

Hint text: `.text-sm` + `.text-muted` (existing utilities) — never restate in CSS.

---

## Color (60/30/10 Contract)

All values are existing CSS variables — do not hardcode hex anywhere in new Handlebars or CSS.

| Role | Value | Usage in this phase |
|------|-------|---------------------|
| Dominant (60%) | `var(--bg-primary)` (#ffffff light / #1f2937 dark) | Page body, table rows, form surface |
| Secondary (30%) | `var(--bg-secondary)` / `var(--bg-tertiary)` | Card backgrounds, logo placeholder, header strip on the `/admin/system-brand-guidelines` page |
| Accent (10%) | `var(--accent)` (existing sidebar-active green) | Primary CTAs only (see "Accent reserved for" below) |
| Destructive | `var(--status-error)` via `.btn--danger`, `.alert--error` | Delete system guideline only |

**Accent reserved for:**
1. The **"+ New system guideline"** primary button on `/admin/system-brand-guidelines` (uses `.btn--primary`)
2. The **"Clone into org"** primary button in each System Library row (uses `.btn--primary`)
3. The **active tab underline** on `/admin/branding-guidelines` when the user is on the System Library tab (existing `.tab--active` rule already paints this)
4. Link text inside table cells (existing `.cell--url a` rule)

**Accent is explicitly NOT used for:** "Link to site" (secondary action, use `.btn--secondary`), "View" links in the admin list (use `.btn--secondary`), or any system-guideline badge (use `.badge--info` or `.badge--brand`).

### System vs Org Visual Distinction (critical UX requirement)

Every row in the **org-view System Library** MUST be visually distinguishable from the org's own guidelines. Use the following existing primitives stacked:

1. **Leading badge** on the name cell: `<span class="badge badge--info">{{t "admin.systemBrand.systemBadge"}}</span>` — label text: **"System"**. `.badge--info` paints blue in both themes (from `--status-info-bg` + `--status-info`), which is distinct from the neutral grey `.badge--neutral` used for org labels and from the green `.badge--success` used for active-state indicators.
2. **Section separator**: the System Library lives in its own tab (see Layout section). Cross-contamination is structurally prevented — the org's own guidelines table is in a different tab panel.
3. **No action ambiguity**: the System Library row action cell contains **only** "Link to site" (`.btn--secondary`) and "Clone into org" (`.btn--primary`). It must NOT contain `.btn--warning` (toggle active) or `.btn--danger` (delete). Absence of destructive affordances is itself a visual signal of read-only status.

Do NOT introduce a new `.badge--system` class or a new row background color. The three signals above are sufficient.

---

## Layout & Component Inventory

### Surface A — `/admin/system-brand-guidelines` (new dedicated page)

**Route gating:** `preHandler` checks `admin.system` permission; 403 on failure. Sidebar entry hidden unless `perm.adminSystem` is truthy. Mirror the Phase 06 pattern verbatim from `views/partials/sidebar.hbs` lines 358-362.

**Page structure (copy of `service-connections.hbs` shape):**

```
<section aria-label="{{t 'admin.systemBrand.title'}}">
  <p class="page-header__subtitle">{{t "admin.systemBrand.description"}}</p>

  <div class="page-actions">
    <button class="btn btn--primary"
            hx-get="/admin/system-brand-guidelines/new"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            aria-haspopup="dialog">
      {{t "admin.systemBrand.createGuideline"}}
    </button>
  </div>

  <div id="system-brand-toast" aria-live="polite" aria-atomic="true"></div>

  {{#if guidelines.length}}
    <div class="table-wrapper">
      <table class="table" aria-label="{{t 'admin.systemBrand.title'}}">
        <thead>…</thead>
        <tbody id="system-brand-table-body">
          {{#each guidelines}} {{> system-brand-row this}} {{/each}}
        </tbody>
      </table>
    </div>
  {{else}}
    <div class="empty-state">…</div>
  {{/if}}
</section>
```

**Table columns (exactly these, in this order):**
1. Logo (40×40 thumbnail — copy pattern from `branding-guidelines.hbs` lines 37-51)
2. Name (link to `/admin/system-brand-guidelines/{{id}}` + optional description as `.text-sm.text-muted`)
3. Usage — "Linked by N orgs · Cloned N times" shown as two stacked `.badge--neutral` chips (planner will decide if metrics ship in P01 or defer; the column header must exist from day one)
4. Status — `.badge--success` "Active" or `.badge--neutral` "Inactive"
5. Version — `.badge--info` `v{{version}}` (reuse pattern)
6. Actions — `View` (`.btn--sm.btn--secondary`), `Delete` (`.btn--sm.btn--danger` with `hx-confirm`)

**Edit flow:** clicking **View** or **+ New** navigates to `/admin/system-brand-guidelines/{{id}}` (or `/new`). That detail page **reuses `branding-guideline-detail.hbs` verbatim** — no visual divergence. Only difference: the header `back-to-list` link points to `/admin/system-brand-guidelines`, and the hidden form field `scope=system` is set so POST/PATCH routes stamp `org_id = 'system'`.

### Surface B — `/admin/branding-guidelines` extension (org view)

Wrap the existing page content in a **tabs strip** using the existing `.tabs` / `.tab` / `.tab--active` classes (style.css lines 647-669). Two tabs:

```
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

**Tab content rules:**
- **Tab 1 — "My guidelines"** (default): the existing table from `branding-guidelines.hbs` lines 19-108, completely unchanged. This must be a byte-for-byte preservation of today's UX so no existing user is disoriented.
- **Tab 2 — "System Library"**: a new table with its own row partial. Columns:
  1. Logo (same 40×40 pattern)
  2. Name (plain text — NOT linked, since org admins cannot navigate into a read-only detail view; description shown as `.text-sm.text-muted`)
  3. `<span class="badge badge--info">{{t "admin.systemBrand.systemBadge"}}</span>` (literal "System" label — explicit visual cue even though the whole tab is system-scoped)
  4. Version (`.badge--info` `v{{version}}`)
  5. Actions: **Link to site** (`.btn--sm.btn--secondary`, opens existing site-assignment modal via `hx-get`), **Clone into org** (`.btn--sm.btn--primary`, `hx-post` to `/admin/branding-guidelines/system/{{id}}/clone` with `hx-confirm` for the rename prompt)

**Routing choice for tab state:** use a query-param (`?tab=system`) server-side read, not client-side JS. Matches the existing non-JS-dependent admin UX. No `hx-swap` between tabs — full page navigation keeps the browser back/forward buttons working and keeps the CSP story simple.

### Clone confirmation / rename flow

Clone is a **destructive-ish** action (creates a new row, changes org state). Confirmation pattern:

1. Button has `hx-confirm="{{t 'admin.systemBrand.confirmClone' name=this.name}}"` — copy: `"Clone \"{name}\" into your organization? You will be able to rename it on the next screen."`
2. POST `/admin/branding-guidelines/system/{{id}}/clone` returns HTMX redirect (`HX-Redirect` header) to `/admin/branding-guidelines/{{newId}}` — the clone's own edit page — where the user immediately sees the default name `{original} (cloned)` in an editable field. The existing detail page already supports rename in-place, so no new form is needed.
3. After landing on the clone edit page, a `.alert.alert--success` banner announces `"Cloned from system guideline — rename to finish."` (auto-hide via existing toast pattern or persist until dismissed; use the existing `.alert` component, not a new one).

---

## States Required (every new surface)

| State | Admin page (A) | Org System Library tab (B) |
|-------|----------------|----------------------------|
| Empty | `.empty-state` block with heading "No system brand guidelines yet" + CTA "Create your first system guideline" (`.btn.btn--primary` linking to the new modal) | `.empty-state` block with heading "No system templates available" + body "Your dashboard admin has not published any system brand guidelines yet." — NO CTA (org admins cannot create system guidelines) |
| Loading | HTMX default — no custom spinner. The `hx-indicator` class on the triggering button is fine if needed. No full-page skeletons. | Same. |
| Error | `.alert.alert--error` inside `#system-brand-toast` (OOB swap) — copy from the server route via existing `toastHtml()` helper | `.alert.alert--error` inside the org page's existing `#branding-guidelines-alert` region |
| Success (after mutation) | Row-level HTMX swap + `.alert.alert--success` OOB toast. Clone success = `HX-Redirect`. Delete success = row removal via `hx-swap="outerHTML"` + toast | Same pattern for Link/Clone |
| Permission denied (for non-admin hitting admin API directly) | 403 JSON or `.alert.alert--error` "You do not have permission to manage system brand guidelines" if HTML | n/a — read access is unrestricted |

---

## Copywriting Contract

All strings below MUST be added to `packages/dashboard/src/i18n/locales/en.json` under the specified keys. No hardcoded English in Handlebars.

### New i18n keys (Surface A — admin page)

| Key | English copy |
|-----|--------------|
| `admin.systemBrand.title` | `System brand guidelines` |
| `admin.systemBrand.description` | `Publish brand guideline templates that every organization can link to their sites or clone into their own workspace.` |
| `admin.systemBrand.createGuideline` | `+ New system guideline` |
| `admin.systemBrand.empty.heading` | `No system brand guidelines yet` |
| `admin.systemBrand.empty.body` | `Create the first template to make it available to every organization.` |
| `admin.systemBrand.empty.cta` | `Create your first system guideline` |
| `admin.systemBrand.column.usage` | `Usage` |
| `admin.systemBrand.usage.linkedBy` | `Linked by {count} org{plural}` |
| `admin.systemBrand.usage.clonedCount` | `Cloned {count} time{plural}` |
| `admin.systemBrand.confirmDelete` | `Delete "{name}"? Orgs that have linked this template will lose access on their next scan. Orgs that cloned it keep their copies.` |
| `admin.systemBrand.systemBadge` | `System` |
| `admin.systemBrand.deleteBlocked` | `Cannot delete "{name}" — {count} sites are currently linked to it. Unlink first, then retry.` |

### New i18n keys (Surface B — org System Library tab)

| Key | English copy |
|-----|--------------|
| `admin.branding.tabs.myGuidelines` | `My guidelines` |
| `admin.branding.tabs.systemLibrary` | `System library` |
| `admin.branding.tabsLabel` | `Brand guideline scope` |
| `admin.systemBrand.library.emptyHeading` | `No system templates available` |
| `admin.systemBrand.library.emptyBody` | `Your dashboard admin has not published any system brand guidelines yet.` |
| `admin.systemBrand.action.linkToSite` | `Link to site` |
| `admin.systemBrand.action.cloneIntoOrg` | `Clone into org` |
| `admin.systemBrand.confirmClone` | `Clone "{name}" into your organization? You will be able to rename it on the next screen.` |
| `admin.systemBrand.cloneSuccess` | `Cloned from system guideline — rename to finish.` |
| `admin.systemBrand.linkSuccess` | `Linked "{name}" to {siteUrl}. Next scan will use the live system template.` |
| `admin.systemBrand.cloneDefaultSuffix` | ` (cloned)` |

### Primary CTAs (explicit, per-surface)

| Surface | Primary CTA | Label (i18n key) |
|---------|-------------|------------------|
| `/admin/system-brand-guidelines` (list) | `+ New system guideline` | `admin.systemBrand.createGuideline` |
| `/admin/system-brand-guidelines/:id` (detail) | Reuses existing branding-guideline-detail buttons (`Save`, `Activate/Deactivate`, `Delete`) — no new CTA |
| `/admin/branding-guidelines?tab=system` (row) | `Clone into org` | `admin.systemBrand.action.cloneIntoOrg` |

### Destructive actions & confirmations

| Action | Confirmation pattern | Copy key |
|--------|----------------------|----------|
| Delete system guideline (admin) | `hx-confirm` native browser dialog — copy lists consequences (linked orgs lose access, clones unaffected) | `admin.systemBrand.confirmDelete` |
| Delete blocked (linked sites exist) | `.alert.alert--error` toast — no destructive execution | `admin.systemBrand.deleteBlocked` |
| Clone into org (org admin) | `hx-confirm` (mildly destructive — creates org state) | `admin.systemBrand.confirmClone` |
| Deactivate system guideline | Existing `.btn--warning` + confirm — reuses existing copy `admin.branding.deactivate` | (no new key) |

---

## Accessibility Contract

Copy these behaviors verbatim from the Phase 06 service-connections precedent — do not deviate.

- [ ] Every table on the new admin page has `aria-label` + scoped `<th scope="col">` headers
- [ ] Every action button inside a table row carries `aria-label="{action} {name}"` (exactly like `branding-guidelines.hbs` line 88)
- [ ] The tab strip uses `role="tablist"` on the nav, `role="tab"` + `aria-selected` on each tab link
- [ ] Forms inside tables use `hx-post` on buttons only — NO `<form>` inside `<tr>/<td>` (reinforced by `feedback_htmx_forms_in_tables.md`)
- [ ] OOB toast swaps inside `<tbody>` contexts are wrapped in `<template>` tags per `feedback_htmx_oob_in_table.md`
- [ ] All CSRF tokens sent via hidden `name="_csrf"` input OR via the global CSRF meta-tag interceptor in `static/app.js`
- [ ] No inline `onclick` — use `data-action` routed through `app.js` (CSP requirement)
- [ ] `aria-live="polite"` on the `#system-brand-toast` region and on any alert containers
- [ ] Focus management after clone: `HX-Redirect` drops the user on the clone detail page; the first text input (name field) must receive focus on page load — existing detail page already does this; verify it still works when arriving post-redirect
- [ ] Keyboard flow: tab order follows visual order (tabs → CTA → table rows → row actions); `Escape` dismisses any modal (existing modal component handles this)

**Responsive behavior:** Matches existing admin pages. The `.tabs` rule already wraps at ≤ 767px (style.css line 3435: `.tabs { flex-wrap: wrap; gap: 0; }`). Tables convert to stacked cards at mobile breakpoints using existing `data-label` attributes on `<td>` cells — already established convention. **No new media queries.**

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| n/a (project uses in-house CSS, not shadcn) | none | not applicable |

No third-party blocks. No new npm packages. No remote CSS. Every visual primitive already exists in the repository.

---

## Executor Guardrails (non-negotiable)

1. **No new CSS classes.** If a new visual affordance is requested that cannot be expressed via existing classes + tokens, STOP and escalate.
2. **No hardcoded English.** Every string goes through `{{t "key"}}` with the key added to `en.json`.
3. **No `<form>` inside table cells.** Use `hx-post` on buttons with CSRF meta-tag interception.
4. **No inline `onclick` / `hx-on`.** Use `data-action` routed through `static/app.js`.
5. **No React / no client state library.** Handlebars server render + HTMX partials only.
6. **Reuse `branding-guideline-detail.hbs`** for the system guideline edit surface — do NOT fork it. The only allowed divergence is the back-link URL and the `scope` hidden field.
7. **Tab state is URL-driven** (`?tab=system`), not JS state. Server reads the query param and picks the initial active tab.
8. **Sidebar icon for the new admin page:** copy the "system/admin" SVG pattern already used in `sidebar.hbs` for `service-connections` (lines 362-364). Do not invent new icon art.
9. **Empty-state illustrations:** none. The `.empty-state` component is text-only in this codebase.
10. **Modal usage:** the "+ New system guideline" button opens the existing `#modal-container` via `hx-get` — same pattern as `branding-guidelines.hbs` line 7. Do not build a bespoke modal.

---

## Deviations from existing admin pages

**None.** Every pattern on Surface A matches `/admin/service-connections` (Phase 06) and every pattern on Surface B extends `/admin/branding-guidelines` additively. If the executor discovers an unavoidable deviation during implementation, it must be flagged in the plan review — not silently applied.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS (all keys declared with exact English)
- [x] Dimension 2 Visuals: PASS (every component cites an existing class)
- [x] Dimension 3 Color: PASS (60/30/10 respected; accent reserved list complete; system vs org distinction via `.badge--info` + structural tab separation)
- [x] Dimension 4 Typography: PASS (3 sizes, 3 weights — all pre-existing tokens, no new typography declared)
- [x] Dimension 5 Spacing: PASS (all tokens from `--space-*` scale, no exceptions)
- [x] Dimension 6 Registry Safety: PASS (n/a — no external registry)

**Approval:** approved (2026-04-05 by gsd-ui-checker)

---

## Source trace

| Contract item | Source |
|---------------|--------|
| Two surfaces (admin CRUD + org tab) | CONTEXT.md D-08, D-11 |
| Reuse existing edit form | CONTEXT.md D-10 |
| Read-only in org view, no edit/delete buttons | CONTEXT.md D-14 |
| Visual distinction: badge + tab separation | CONTEXT.md `<specifics>` (last bullet) + Claude's Discretion |
| admin.system permission gate | CONTEXT.md D-15, precedent Phase 06 |
| Sidebar grouping under "System Administration" | CONTEXT.md D-09, sidebar.hbs lines 308-362 |
| Clone default suffix "(cloned)" | CONTEXT.md Claude's Discretion |
| Tab placement inside `/admin/branding-guidelines` | CONTEXT.md Claude's Discretion — chose tabs (not side panel or collapsible) because `.tabs` class already exists and matches report-detail precedent |
| Every spacing/typography/color token | `packages/dashboard/src/static/style.css` lines 10-150, 61-77, 647-669 |
| State patterns (empty/loading/error/toast) | `views/admin/service-connections.hbs` + `feedback_htmx_oob_in_table.md` |
| Accessibility rules | Phase 06 precedent + `feedback_monitor_patterns.md` |
