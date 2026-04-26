# Phase 08: System Brand Guideline — Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Dashboard admins maintain a **library** of system-wide brand guideline templates (multiple, not one). Each org admin can consume any system guideline per-site in two ways:

1. **Link** — assign a system guideline directly to a site. Live: edits by the dashboard admin propagate on the next scan. Org cannot mutate.
2. **Clone** — import a system guideline into the org as an independent org-owned copy. Org admin can rename and edit freely. Frozen at clone time — subsequent system-side edits do not propagate. Provenance (`cloned_from_system_guideline_id`) is recorded.

Both paths resolve through the **existing `BrandGuideline` matching pipeline** with no parallel code path. Linked system guidelines and cloned org guidelines resolve to an effective guideline before matching.

**Crucial correction from the original spec:** branding mode is NOT per-org. Branding has always been per-site via `site_branding`, and the link/clone choice happens at site-assignment time. The original SYS-02/03/04 wording ("each org has a branding mode setting") was wrong and has been rewritten.

**Scope creep prevention:**
- No "merge" mode (org primary + system fallback live combo) — dropped during discussion. Clone covers customization, link covers as-is usage. Merge reintroduces resolver complexity for a use case the clone path already satisfies.
- No migration of existing `site_branding` rows — system guidelines are purely additive.
- No parent/child org hierarchy — "multiple system templates for multiple fictions" is expressed via multiple independent system guidelines, not a hierarchy.

</domain>

<decisions>
## Implementation Decisions

### Data model
- **D-01:** System guidelines live in the existing `branding_guidelines` table with `org_id = 'system'`. No schema change for the core entity — the `'system'` sentinel is already used project-wide (scans, api_keys, api clients, regulations, etc.). **No separate `system_brand_guidelines` table.**
- **D-02:** **Multiple** system guidelines supported (not singular). Dashboard admins create, edit, and delete as many as they want.
- **D-03:** Clones are independent rows in `branding_guidelines` with `org_id = <org>` and a new `cloned_from_system_guideline_id` TEXT column added via migration. Provenance is advisory — no live link, no cascading updates.
- **D-04:** No per-org `branding_mode` column on `organizations`. The original spec's SYS-02 ("each org has a branding mode") was dropped as part of the Phase 08 reshape.
- **D-05:** `site_branding` stays exactly as-is. Nothing new on that table. The org admin picks any guideline (org-owned OR linked system) when assigning to a site — resolver is upstream of the join.

### Matching pipeline
- **D-06:** Single code path preserved. Add a thin **resolver** at the boundary of `orchestrator.ts` (around line 547 `getGuidelineForSite`) that, given a `(siteUrl, orgId)`, returns the effective guideline:
  - If the assigned `guideline_id` belongs to the org → return it as today (existing branch, unchanged)
  - If the assigned `guideline_id` belongs to `org_id = 'system'` → return the system guideline row (linked mode: live content)
  - Clones look identical to org-owned guidelines to the resolver (they ARE org-owned after cloning) — no special case
- **D-07:** No per-scan decision logic. The resolver runs once per scan start. Whatever guideline it returns flows through the existing `brandGuideline` enrichment exactly as today.

### Admin UX (dashboard admins)
- **D-08:** New dedicated page **`/admin/system-brand-guidelines`** following the Phase 06 pattern (sidebar entry, gated by `admin.system` permission, Handlebars + HTMX partials). List + create/edit/delete CRUD for system guidelines. **NOT a scope toggle on the existing `/admin/branding-guidelines` page** — separate pages prevent accidental cross-scope edits.
- **D-09:** Sidebar nav entry next to `/admin/service-connections` under the same "System Administration" group.
- **D-10:** The system guideline edit UI reuses the existing branding guideline edit form and partials verbatim (colors, fonts, selectors, logo upload). Only the list/create-entry surface is new.

### Org UX (org admins)
- **D-11:** Extend the existing **`/admin/branding-guidelines`** page (org scope) with a **"System Library"** tab/section that lists every system guideline read-only. Each row shows: name, description, thumbnail, and two actions: **"Link to site"** and **"Clone into org"**. No separate page — keeps discovery where org admins already manage their branding.
- **D-12:** "Link to site" opens the existing site-assignment modal/flow, pre-populated with the system guideline. The resulting `site_branding` row references the system guideline's id like any other.
- **D-13:** "Clone into org" clones the row (plus all colors, fonts, selectors, logo) into `org_id = <current_org>` with a new UUID, sets `cloned_from_system_guideline_id`, and optionally prompts for a new name before landing the user on the clone's edit page. Default name: `{original_name} (cloned)` or similar — user can rename immediately.
- **D-14:** System guidelines shown in the org view are **read-only**. No edit/delete buttons. Only Link and Clone actions.

### Permissions
- **D-15:** Reuse **`admin.system`** permission for all mutating operations on system guidelines (create, edit, delete). This is the same permission used for Phase 06 `/admin/service-connections`.
- **D-16:** All authenticated org members can **read** the system library (for Link/Clone). No new permission needed — reading the library is a prerequisite for using it.

### Backwards compatibility
- **D-17:** **No migration of existing data.** Every existing `branding_guidelines` row stays exactly as-is (`org_id = <org>`, no `cloned_from_system_guideline_id`). Every existing `site_branding` row keeps working unchanged.
- **D-18:** The resolver's default path (assigned guideline is org-owned) is the existing code path, untouched. Scans with no system-guideline involvement are byte-identical to today.

### Claude's Discretion
- Naming for the clone: default suffix (e.g., `(cloned)` or `(copy)`) — pick whichever reads best.
- Exact placement of the "System Library" tab inside `/admin/branding-guidelines` (tab bar at the top, collapsible section, or side panel) — pick whichever matches the existing page's layout.
- Thumbnail/preview rendering for system guidelines in the org library view — can be a simple colour-chip row if no thumbnail infrastructure exists yet.
- Audit logging for system guideline mutations — if the existing `audit` route infrastructure is easy to extend, add it; otherwise defer.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements
- `.planning/REQUIREMENTS.md` §System Brand Guideline (SYS-01..SYS-06, as amended 2026-04-05)
- `.planning/ROADMAP.md` §"Phase 08: System Brand Guideline" — goal, success criteria, depends-on

### Existing patterns to reuse (Phase 06 precedent)
- `packages/dashboard/src/routes/admin/service-connections.ts` — admin.system gating, audit hooks, sidebar entry model
- `packages/dashboard/src/routes/admin/branding-guidelines.ts` — existing per-org branding guideline CRUD; the new system page copies this shape with scope = 'system'
- `packages/dashboard/src/views/admin/` — Handlebars layout conventions for admin pages

### Matching pipeline integration points
- `packages/dashboard/src/scanner/orchestrator.ts` line ~543-624 — where `brandGuideline` is resolved per scan; this is where the single-code-path resolver hooks in
- `packages/dashboard/src/db/sqlite/repositories/branding-repository.ts` line 409 `getGuidelineForSite(siteUrl, orgId)` — current resolver; will be extended to handle system-scoped guidelines without a new code path
- `packages/dashboard/src/services/branding-retag.ts` — historical retag helper; must continue to work with cloned/linked guidelines

### Schema + migration reference
- `packages/dashboard/src/db/sqlite/migrations.ts` — migration style and numbering convention (Phase 07 added 039; Phase 08 will add 040)
- `'system'` sentinel `org_id` pattern: migrations.ts lines 167, 170, 198, 216, 237, 264, 284, 298, 389, 403 — canonical for global-scope resources

### Permission model
- `packages/dashboard/src/db/sqlite/migrations.ts` line 338 — `admin.system` role/permission seed
- Same migration file lines 664, 834-838 — admin.system usage in existing admin routes

### i18n
- `packages/dashboard/src/i18n/locales/en.json` — existing admin page keys live under `admin.*` and `branding.*`; new keys for "System Library", "Link to site", "Clone into org", empty states go here

### Related requirements (for context, not direct reuse)
- `.planning/REQUIREMENTS.md` §Service Connections (SVC-*) — Phase 06 admin page conventions
- `.planning/REQUIREMENTS.md` §Regulation Filter (REG-*) — Phase 07 single-code-path API extension pattern is a precedent for SYS-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`branding_guidelines` table + repository**: Already supports `org_id`; setting it to `'system'` creates a system guideline row with zero schema work for the core entity. Only new column needed: `cloned_from_system_guideline_id` on the same table.
- **`branding-guidelines.ts` admin route + views**: The per-org CRUD can be copied/forked as-is for the system scope. The edit form is already reusable — only the list page differs (scope filter and permission gate).
- **`getGuidelineForSite(siteUrl, orgId)` in `branding-repository.ts:409`**: The single resolver call. Extending this function (or adding a thin wrapper) is the cleanest place to introduce system-scope resolution. No new resolver service layer required.
- **`admin.system` permission**: Already seeded and enforced. Reused verbatim for all mutating operations.
- **Sidebar nav + Handlebars layout**: Phase 06 established the pattern — add one nav entry.

### Established Patterns
- **`'system'` sentinel for global scope**: Used pervasively (scans, api_keys, api clients, regulations, audit log). Matches every other global resource in the codebase — zero conceptual surprise for future developers.
- **Admin pages gated by `admin.system`**: `service-connections` set the precedent in Phase 06. Phase 08 follows the same shape: dedicated route module, route-level `preHandler` checking the permission, audit logging on mutations.
- **Handlebars + HTMX partials for admin UX**: No React, no client-side state management. Forms POST/PATCH, partials re-render server-side. Matches the rest of the dashboard.
- **Migration numbering**: Monotonic integer, one migration per schema change. Phase 07 added migration 039. Phase 08 will add 040 (for `cloned_from_system_guideline_id`).

### Integration Points
- **`orchestrator.ts` line ~547**: where `getGuidelineForSite` is called during scan setup. This is the single integration point for the resolver extension. No other scan-time branding lookups exist.
- **`branding-retag.ts`**: historical retag service. Must continue to work if a scan's assigned guideline is now a linked system guideline — the retag should look up the current content via the resolver just like the live scan path.
- **Report pipeline**: already carries `brandingGuidelineId` and `brandingGuidelineVersion` per scan (`scan_records` table). Version tracking for linked system guidelines needs to capture the version at scan time, not the current version — existing version field covers this.

### Creative options enabled / constrained
- **Enabled**: Because clones are plain `org_id = <org>` rows, every existing org-scoped tool (retag, reports, export) works on them with zero changes. Clone is effectively "copy into org" — the rest of the system doesn't notice.
- **Constrained**: The resolver must remain O(1) — it runs per scan. Can't afford to walk a linkage chain. Linked system guidelines are one DB row lookup just like org-owned guidelines.
- **Constrained**: No merge mode means no cascading-fallback resolver logic. Every site has exactly one effective guideline at scan time, always.

</code_context>

<specifics>
## Specific Ideas

From the discussion:

- **Concrete example the user gave**: "'Aperol' or 'Campari' as system, then org 'Aperol Summer' adds a golden color to 'Aperol' — effectively creating the 'Aperol Summer' guideline." This is the canonical clone flow. Downstream agents should use this example when naming test fixtures and documenting the clone UX.
- **Framing**: System guidelines are "certified templates". A parent company deploys them for internal orgs / fictions. The metaphor to have in mind is a design system released by a corporate brand team and consumed by sub-brands.
- **Org UX entry point**: "System Library" tab lives alongside the org's own guidelines list on `/admin/branding-guidelines` — the org admin shouldn't have to go to a different page to discover system templates.
- **Read-only visual**: system guidelines in the org view should look distinct enough from org-owned guidelines that no one can be confused about which is which (different badge, colour, or section header).

</specifics>

<deferred>
## Deferred Ideas

- **Merge mode (org primary + system fallback, live)**: considered and dropped. The clone path covers the "customize and keep independent" case; linking covers the "use as-is, stay in sync" case. Merge reintroduces a cascading resolver for a third mode the user did not confirm they needed. If a future use case emerges (e.g., "I want system fonts forever but my own colors"), revisit as its own phase.
- **Parent/child org hierarchy**: not in scope. "Multiple system templates for multiple fictions" is expressed via multiple independent system guidelines and org-side selection, not a hierarchical relationship between orgs.
- **Live update notifications**: when a dashboard admin edits a linked system guideline, orgs using it would benefit from a notification ("the system guideline you're using was updated — review changes before next scan"). Deferred — surface as an improvement once the base feature lands.
- **Clone drift detection**: when a clone is stale relative to its source (cloned_from_system_guideline_id), show an "updated source available" hint. Deferred — provenance metadata is already stored, a future phase can surface it.
- **Export/import of system guidelines between instances**: dashboard-to-dashboard portability (e.g., JSON round-trip). Deferred — not blocking v2.8.
- **Branding mode at per-site granularity with more modes**: the rejected merge mode could come back per-site. Deferred to a future phase if demand materializes.

</deferred>

---

*Phase: 08-system-brand-guideline*
*Context gathered: 2026-04-05*
