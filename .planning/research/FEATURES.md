# Feature Landscape — v2.12.0 Brand Intelligence Polish

**Domain:** Brand accessibility scoring UX / admin refinement
**Researched:** 2026-04-12
**Confidence:** HIGH (all 7 features are additive to v2.11.0 foundations already inspected in codebase)

---

## Feature 1: Brand Overview Page with Site Selector

### What It Is
A dedicated `/brand-overview` page (org-scoped, not `/admin/`) showing all branded sites for the current org with their latest brand scores, aggregated trend, and per-site sparklines. Replaces the single-site widget removed from the homepage in v2.11.0 Phase 21.

### Route Location
**Use `/brand-overview`, NOT `/admin/brand-overview`.** Rationale:
- The homepage widget was visible to all authenticated users, not just admins. The overview page is its replacement, so the same audience applies.
- Permission gate: `branding.view` (already seeded in migration 035 for Owner/Admin/Member/Viewer org roles). No new permission needed for read access.
- The `/admin/*` prefix is reserved for system-wide management (organizations, plugins, health). Brand overview is org-scoped content, like `/reports` and `/trends`.

### Data Requirements
1. **All sites for the org with latest brand score** -- `getLatestPerSite(orgId)` already exists on `ScanRepository` (line 316, scan-repository.ts). It returns the latest completed scan per site_url. Extend this or add a companion query that LEFT JOINs `brand_scores` (same pattern as `getTrendData`) to include `brand_overall`, `brand_subscore_details`, `brand_unscorable_reason`, `brand_coverage_profile` per site.
2. **Per-site sparkline data** -- For each site, call `getHistoryForSite(orgId, siteUrl, 20)` from `BrandScoreRepository`. This already exists and returns `BrandScoreHistoryEntry[]` ordered by `computedAt DESC`.
3. **Aggregated org-level trend** -- Compute org-wide average across sites' latest scores. Server-side calculation: `Math.round(sum(site.latest.overall) / scoredSiteCount)`. No new query needed -- derive from the per-site data.

### New Queries Needed
One new method on `ScanRepository` or a helper function:
```sql
-- getLatestPerSiteWithBrandScore(orgId)
SELECT sr.*, bs.overall AS brand_overall, bs.subscore_details AS brand_subscore_details,
       bs.unscorable_reason AS brand_unscorable_reason, bs.coverage_profile AS brand_coverage_profile
FROM scan_records sr
INNER JOIN (
  SELECT site_url, MAX(created_at) as max_created_at
  FROM scan_records WHERE org_id = @orgId AND status = 'completed'
  GROUP BY site_url
) latest ON sr.site_url = latest.site_url AND sr.created_at = latest.max_created_at
LEFT JOIN brand_scores bs ON bs.scan_id = sr.id
  AND bs.rowid = (SELECT MAX(rowid) FROM brand_scores WHERE scan_id = sr.id)
WHERE sr.org_id = @orgId AND sr.status = 'completed'
ORDER BY sr.created_at DESC
```
This is a merge of the existing `getLatestPerSite` and the `getTrendData` LEFT JOIN pattern. Reuses `brandScoreRowToResult` mapper.

### Template Approach
**Do NOT reuse `brand-score-widget.hbs` directly** -- it is designed for a single-site big-number tile. Create a new `brand-overview.hbs` page with:
- A site selector (dropdown or tab row) -- HTMX-powered, `hx-get="/brand-overview?site=<url>"` swaps the detail panel.
- An org-level summary card at the top (average score, total sites, sites improving/regressing).
- Per-site cards below, each containing: site URL, latest score (color-banded), 3 sub-score mini-bars (reuse `brandScoreClass` helper), inline SVG sparkline (reuse the sparkline-point computation from `home.ts`).
- Extract the sparkline-point computation from `home.ts` lines 126-148 into a shared utility `services/sparkline.ts`.

### Complexity: MEDIUM
Mostly data plumbing (query exists, just needs JOIN) + new Handlebars template. No new npm deps. HTMX site selector is a standard pattern.

---

## Feature 2: Per-Dimension Trend Sparklines

### What It Is
Currently the sparkline shows only the composite `overall` score over time. Extend to show 3 additional sparklines (or 3 colored polylines on one SVG) for color, typography, and components dimensions.

### Data Source
`getHistoryForSite` already returns `BrandScoreHistoryEntry[]` where each entry's `result` is a `ScoreResult`. When `result.kind === 'scored'`, each sub-score (`result.color`, `result.typography`, `result.components`) is a `SubScore` with `kind: 'scored' | 'unscorable'`. The `subscore_details` JSON column (migration 043) already stores per-dimension values. **No schema change needed.**

### Changes to getHistoryForSite
**None.** The method already returns full `ScoreResult` objects including sub-scores. The data is there; the route/template just needs to extract per-dimension values.

### Route Changes
In the brand overview route (and optionally report detail), extract per-dimension values from the history:
```typescript
const colorValues = history.filter(h => h.result.kind === 'scored' && h.result.color.kind === 'scored')
  .map(h => (h.result as ScoredResult).color as ScoredSubScore).map(s => s.value);
// Same for typography, components
```

### SVG Approach
**Use 3 separate `<polyline>` elements on ONE SVG.** Rationale:
- Same x-axis (time), shared viewBox -- alignment is guaranteed.
- 3 SVGs would require synchronizing viewBox, padding, and time axis independently.
- Color-code the lines: `stroke="var(--status-error)"` for color (red-ish), `stroke="var(--accent)"` for typography (green), `stroke="var(--status-info)"` for components (blue).
- Add a `<desc>` with sr-only text listing all three dimension trends for accessibility.
- When a dimension is unscorable for a given entry, skip that point (gap in the polyline). SVG polyline handles this naturally -- just omit the point.

### Empty State
If a dimension has fewer than 2 scored entries across the history, do not render its polyline (no single-dot lines). Show a text note: "Typography: insufficient data for trend".

### Complexity: LOW-MEDIUM
Data already exists. Work is template/SVG rendering + sparkline utility extension. No new queries, no schema changes.

---

## Feature 3: Score Target Line

### Storage
**Add a `brand_score_target` column to the `organizations` table.** NOT a separate table. Rationale:
- One target per org (not per-site, not per-dimension) -- a single INTEGER column is sufficient.
- The organizations table already has `branding_mode` (migration 043). Adding another column is the established pattern.
- Migration 044:
```sql
ALTER TABLE organizations ADD COLUMN brand_score_target INTEGER;
```
- NULL means "no target set" (distinct from 0). The UI shows no target line when NULL.

### UI
Two surfaces:
1. **Brand overview page** -- A number input (min=0, max=100) with a "Set target" button. Permission: `branding.manage` (already exists, Owner/Admin have it). POST to `/brand-overview/target` with `hx-post`, updates the target and re-renders the overview.
2. **Sparkline rendering** -- A horizontal dashed line on the SVG at the target score level. Computation: `y = padding + effectiveH - ((target - minVal) / range) * effectiveH`. Use `stroke-dasharray="4 2"` with `stroke="var(--status-warning)"` for the target line.

### Gap Display
On the summary card, show: "Current: 72 / Target: 85 (gap: 13 points)". Color-band the gap: green if current >= target, amber/red if below.

### OrgRepository Changes
Add `getBrandScoreTarget(orgId): number | null` and `setBrandScoreTarget(orgId, target: number | null)` -- same pattern as `getBrandingMode`/`setBrandingMode`.

### Complexity: LOW
One ALTER TABLE, two repo methods, one form input, one SVG line. Well-trodden pattern.

---

## Feature 4: Drilldown Modal

### What It Is
From the brand score panel (report detail page), user clicks a sub-score dimension (e.g., "Color Contrast: 72/100") and sees the individual failing elements grouped by that dimension.

### Data Source
The report detail route (`routes/reports.ts`, line 252) already loads `brandScore` via `storage.brandScores.getLatestForScan(id)`. The `SubScoreDetail` types provide summary counts (passes/fails for color, fontOk/sizeOk/lineHeightOk for typography, matched/total for components).

For element-level detail, the data lives in the scan's `json_report` (loaded at line 186-199 as `reportData`). The `reportData.issueGroups` already contain per-issue data including `brandMatch` annotations added by the branding matcher. **No new query needed -- filter existing report data by dimension.**

### Implementation: HTMX Modal (NOT a new route)
Use the existing HTMX modal pattern:
- Add `hx-get="/reports/:id/brand-drilldown?dimension=color"` on each sub-score row in `brand-score-panel.hbs`.
- New route handler `GET /reports/:id/brand-drilldown` returns an HTML fragment (modal content).
- The handler loads the report JSON, filters issues by dimension:
  - **Color**: issues with `criterion` matching `1.4.3`, `1.4.6`, `1.4.11` that have `brandMatch` context.
  - **Typography**: issues related to font-family, font-size, line-height from the typography scorer's heuristics.
  - **Components**: issues where the element matches a brand selector from the guideline.
- Render as a table: element selector, issue message, brand context, pass/fail status.

### Modal Pattern
Reuse the existing modal pattern from the prompt diff modal (v2.10.0) -- a `<dialog>` element with `showModal()` triggered by HTMX `hx-on::after-swap`. The dashboard already has this pattern; no new JS framework needed.

### Permission
Same as report detail viewing: `reports.view`. No additional permission needed.

### Complexity: MEDIUM
The filtering logic is the main work -- mapping dimension to WCAG criteria and branding matcher annotations. Template is straightforward (modal + table). Data already loaded.

---

## Feature 5: Typography x-height Metric (opentype.js Feasibility)

### What opentype.js Provides
**opentype.js CAN extract x-height** via `font.tables.os2.sxHeight` when `font.tables.os2.version >= 2`. It also provides `sCapHeight` for capital height. This is the standard OS/2 table data present in virtually all modern fonts (.ttf, .otf, .woff, .woff2).

Alternative: **fontkit** (npm) provides `font.capHeight` and `font.xHeight` as first-class properties. It is more ergonomic but a heavier dependency (builds on top of restructure + brotli).

### Where Font Files Come From
**This is the critical blocker.** The branding guideline stores font *family names* (e.g., "Inter", "Roboto") in `branding_fonts.family`, but NOT actual font file binaries. Options:

1. **Google Fonts API** -- If the font is a Google Font, download the .ttf via `https://fonts.google.com/download?family=Inter`. The Google Fonts API (`https://www.googleapis.com/webfonts/v1/webfonts?key=API_KEY`) returns file URLs per family+variant. **Limitation:** only covers Google Fonts (~1,800 families), not custom/commercial fonts.
2. **User upload** -- Add a font file upload field to the branding guideline form. Store in `data/fonts/` or as a BLOB. **Complexity:** HIGH (file upload UI, storage, validation, security scanning of uploaded binaries).
3. **Probe the target site** -- During `discover-branding`, fetch CSS `@font-face` declarations and download the referenced font files. **Limitation:** CORS restrictions, CDN auth, dynamic loading.

### Recommendation: Two-Tier Approach
- **Tier 1 (v2.12.0):** For Google Fonts, auto-resolve via the Google Fonts API. Match `branding_fonts.family` against the API family list. If matched, download the .ttf to a temp file, parse with opentype.js, extract `sxHeight` and `sCapHeight`, discard the file. Cache the metrics in a new `branding_fonts.x_height` and `branding_fonts.cap_height` INTEGER column (font units, not pixels).
- **Tier 2 (future):** User font file upload for custom/commercial fonts.

### Bundle Size
**opentype.js: ~180 KB minified** (not 450 KB as STATE.md estimated -- that was the unminified size). **Server-side only** -- scoring runs in Node.js during scan, never in the browser. Bundle size is irrelevant for server-side usage. Use `opentype.js` (not fontkit) because it has zero native dependencies and is pure JS.

### Integration with Typography Scorer
Current typography sub-score (`services/scoring/typography-score.ts`) uses 3 heuristics:
1. Brand font availability (is the declared font in CSS the same as the guideline font?)
2. Body text >= 16px
3. Line-height >= 1.5

Add a 4th heuristic:
4. x-height ratio: `sxHeight / unitsPerEm`. Fonts with x-height ratio >= 0.45 score higher for readability. Compare actual x-height ratio to an accessibility-optimized threshold. Weight: make the 3 existing heuristics + x-height a 4-way mean (25% each) instead of the current 3-way mean (33% each).

### Migration
```sql
-- Migration 044 (if not used by score target)
ALTER TABLE branding_fonts ADD COLUMN x_height INTEGER;
ALTER TABLE branding_fonts ADD COLUMN cap_height INTEGER;
ALTER TABLE branding_fonts ADD COLUMN units_per_em INTEGER;
```

### Complexity: HIGH
Google Fonts API integration, opentype.js parsing, font metrics caching, typography scorer update. Recommended as a spike/feasibility phase first, with the actual integration conditional on spike results.

---

## Feature 6: Fine-Grained organizations.* Permissions

### Current State
Today, org-level admin operations are gated by two permissions:
- `admin.system` -- Global system admin (manages ALL orgs). Used on: `/admin/organizations` CRUD (organizations.ts lines 48, 64, 73, 167).
- `admin.org` -- Org-level settings. Used on: `/admin/organizations/:id/members` (line 206), member management (line 275), org API keys (`org-api-keys.ts` line 134, 176).

The v2.11.0 branding mode toggle (Phase 19) was gated with `admin.system` with a documented note that finer-grained `organizations.manage` was deferred to v2.12.0 (v2.11.0-REQUIREMENTS.md, BMODE-03 note).

### What organizations.manage Means
**Do NOT introduce a new `organizations.manage` permission.** The existing `admin.org` permission ALREADY means "manage organization settings" (permissions.ts line 31: `{ id: 'admin.org', label: 'Manage organization settings', group: 'Administration' }`). It is already granted to Owner and Admin org roles.

Instead, the work is:
1. **Migrate branding mode toggle from `admin.system` to `admin.org`** -- the toggle is an org-level setting, not a system-wide one. Users with `admin.org` should be able to flip it for their own org.
2. **Audit all routes using `admin.system`** that should accept `admin.org` as alternative:
   - `GET /admin/organizations/:id/edit` -- currently `admin.system` only. Should accept `admin.org` with org-scoping (user can only edit their own org).
   - `POST /admin/organizations/:id` (update) -- same.
   - Branding mode toggle route -- switch from `admin.system` to `admin.org`.
   - `GET/POST /admin/organizations/:id/members` -- already accepts `admin.org` (line 206).
3. **Keep `admin.system` as the gate for:** creating new orgs, deleting orgs, listing ALL orgs. These are system-wide operations.

### Routes Needing Update
Based on grep of `requirePermission('admin.system')` in organizations.ts:
- Line 48: `GET /admin/organizations` (list all) -- KEEP `admin.system` only.
- Line 64: `GET /admin/organizations/new` -- KEEP `admin.system` only.
- Line 73: `POST /admin/organizations` (create) -- KEEP `admin.system` only.
- Line 167: `DELETE /admin/organizations/:id` -- KEEP `admin.system` only.
- **Need to find and update:** `GET /admin/organizations/:id` (edit form) and `POST /admin/organizations/:id` (update) -- change to `requirePermission('admin.system', 'admin.org')` with org-scoping check.

### No New Migration Needed
`admin.org` is already seeded in migration 031 (line 857) for the system admin role and in the org-level Owner role (line 863). The permission exists in `ALL_PERMISSIONS` (line 31) and in `ORG_OWNER_PERMISSIONS` (line 105). **No migration 044 needed for permissions.**

### Sidebar Visibility
The `server.ts` line 716 already computes `adminOrg: perms.has('admin.org') || perms.has('admin.system')`. Templates using `{{#if adminOrg}}` will automatically show the relevant nav items for org-level admins.

### Complexity: LOW
Route audit + permission constant swap + org-scoping guards. No schema changes, no new permissions, no new migrations for this feature alone.

---

## Feature 7: Rescore Historical Scans

### Admin Action
**Button on the brand overview page**, visible only to users with `branding.manage` permission. Label: "Rescore historical scans". Triggers an HTMX POST to `/brand-overview/rescore` which processes scans in the background and returns a progress indicator.

### Processing Logic
```
1. SELECT scan_records WHERE org_id = @orgId AND status = 'completed' ORDER BY created_at ASC
2. For each scan:
   a. Does a brand_scores row already exist for this scan+guideline combo?
      - Check: SELECT 1 FROM brand_scores WHERE scan_id = @scanId AND guideline_id = @guidelineId
      - If YES, skip (idempotent)
   b. Is the guideline still active?
      - Look up site_branding for scan.site_url + org_id to find current guideline_id
      - If no guideline linked, skip with warning
      - If guideline was deleted (getGuideline returns null), skip with warning
   c. Load scan's json_report from DB
   d. Run brandingOrchestrator.matchAndScore(issues, guideline) -- embedded mode always (historical rescoring always uses embedded, even if org is in remote mode)
   e. Insert brand_scores row via brandScoreRepository.insert()
   f. Track progress: { processed: N, skipped: M, total: T }
3. Return summary
```

### Idempotency
Check `brand_scores` table for existing row matching `(scan_id, guideline_id)` -- NOT just `scan_id` alone, because a scan could have been rescored with a different guideline version. Use:
```sql
SELECT 1 FROM brand_scores WHERE scan_id = ? AND guideline_id = ?
```
If found, skip. This makes the action safe to run multiple times.

### Resumability
Process scans in batches of 50. Track `lastProcessedScanId` in the response. If the action is interrupted (timeout, error), the user can click "Resume" which sends `lastProcessedScanId` as a query param. The handler starts from `WHERE created_at > (SELECT created_at FROM scan_records WHERE id = @lastId)`.

For v2.12.0, this can be synchronous (not a background job) with HTMX streaming -- send progress updates via `hx-trigger="every 1s"` polling a status endpoint. Or simpler: just process all at once and show a loading spinner. Orgs unlikely to have more than a few hundred scans.

### Deleted Guideline Handling
When the guideline linked to a scan's site no longer exists:
- Log a warning: "Skipping scan {id} for site {url}: guideline {guidelineId} no longer exists"
- Increment `skippedCount` in the response
- Do NOT create a brand_scores row with `unscorable_reason: 'no-guideline'` -- that would pollute the trend with artificial unscorable entries. Simply skip.

### Performance
Based on codebase inspection:
- `getLatestPerSite` shows orgs have multiple sites with multiple scans each.
- Typical org: 5-20 sites, 2-10 scans each = 10-200 scans to process.
- Large org: 50 sites, 20 scans each = 1,000 scans.
- Each rescore is cheap: load JSON from DB (already stored in `json_report` column), run pure calculator (no network call), insert one row.
- Estimated: ~50ms per scan = 1,000 scans in ~50 seconds. Acceptable for a one-time admin action with progress feedback.
- Batch size of 50 with progress reporting keeps the UI responsive.

### Migration
No schema change needed -- `brand_scores` table already exists. The rescore action writes to it using the existing `BrandScoreRepository.insert()`.

### Complexity: MEDIUM
The main work is the batch processing logic with skip/resume semantics. The UI is a button + progress display. No new tables, no new dependencies.

---

## Feature Dependencies

```
Feature 1 (Brand Overview Page) -- foundation for Features 2, 3, 7 UI
  |
  +-- Feature 2 (Per-Dimension Sparklines) -- extends sparkline on overview page
  +-- Feature 3 (Score Target) -- target line on overview page sparkline
  +-- Feature 7 (Rescore) -- button lives on overview page
  
Feature 4 (Drilldown Modal) -- independent, extends report detail page
Feature 5 (Typography x-height) -- independent spike, can run in parallel
Feature 6 (Permissions) -- should land BEFORE Feature 1 (overview page needs permission gates)
```

Suggested build order:
1. Feature 6 (Permissions audit) -- unblocks correct permission gates for all other features
2. Feature 1 (Brand Overview Page) -- provides the canvas for Features 2, 3, 7
3. Feature 2 (Per-Dimension Sparklines) -- extends the overview page
4. Feature 3 (Score Target) -- extends the overview page
5. Feature 4 (Drilldown Modal) -- independent, extends report detail
6. Feature 5 (Typography x-height) -- spike first, integration conditional
7. Feature 7 (Rescore Historical) -- admin action, can be last

---

## Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Per-site score targets | Adds complexity for marginal value -- orgs set one standard | Single org-level target (Feature 3) |
| Per-dimension targets | Same -- 3 separate target inputs is confusing UX | Composite target only |
| Automatic background rescore | Hidden processing, resource usage, stale triggers | Manual admin-triggered rescore (Feature 7) |
| Real-time WebSocket sparkline updates | Overengineered for scan-time-only updates | Server-rendered SVG, refresh on page load |
| Chart.js for sparklines | Adds client-side JS dependency, breaks zero-JS widget contract | Inline SVG polyline (existing pattern) |
| Font file upload in v2.12.0 | File upload security, storage management, validation | Google Fonts API auto-resolution for v2.12.0 (Feature 5) |
| Cross-org brand score comparison | Violates org isolation rule (PROJECT.md) | Each org sees only their own data |

---

## Sources

### Primary -- First-party codebase (HIGH)
- `packages/dashboard/src/db/sqlite/repositories/scan-repository.ts` -- getLatestPerSite, getTrendData LEFT JOIN pattern
- `packages/dashboard/src/db/interfaces/brand-score-repository.ts` -- getHistoryForSite returns full ScoreResult
- `packages/dashboard/src/db/sqlite/repositories/brand-score-row-mapper.ts` -- subscore_details JSON reconstruction
- `packages/dashboard/src/services/scoring/types.ts` -- ScoreResult/SubScore/SubScoreDetail tagged unions
- `packages/dashboard/src/permissions.ts` -- ALL_PERMISSIONS, admin.org already exists
- `packages/dashboard/src/routes/admin/organizations.ts` -- permission gates audit
- `packages/dashboard/src/auth/middleware.ts` -- requirePermission implementation
- `packages/dashboard/src/db/sqlite/migrations.ts` -- migration 043 schema, 043 is latest
- `packages/dashboard/src/views/partials/brand-score-panel.hbs` -- existing panel structure
- `packages/dashboard/src/views/partials/brand-score-widget.hbs` -- existing sparkline pattern
- `packages/dashboard/src/routes/home.ts` -- sparkline point computation (lines 126-148)
- `packages/dashboard/src/routes/reports.ts` -- report detail data plumbing

### Secondary -- External (MEDIUM)
- [opentype.js GitHub Issue #317](https://github.com/opentypejs/opentype.js/issues/317) -- sxHeight available via OS/2 table version >= 2
- [opentype.js npm](https://www.npmjs.com/package/opentype.js) -- ~180 KB, pure JS, server-side compatible
- [fontkit npm](https://www.npmjs.com/package/fontkit) -- alternative with first-class xHeight/capHeight
- [Google Fonts Developer API](https://developers.google.com/fonts/docs/developer_api) -- font file URLs per family
- [google-font-metadata npm](https://www.npmjs.com/package/google-font-metadata) -- pre-compiled metadata for all Google Fonts

### Carried from v2.11.0 Research (HIGH -- already validated)
- `.planning/milestones/v2.11.0-research/SUMMARY.md` -- scoring architecture, persistence, dual-mode decisions

---
*Research completed: 2026-04-12*
