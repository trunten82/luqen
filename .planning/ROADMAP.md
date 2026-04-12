# Roadmap: Luqen

## Milestones

- ✅ **v2.7.0 LLM Module** — [archived](milestones/v2.7.0-ROADMAP.md)
- ✅ **v2.8.0 Admin UX & Compliance Precision** — Phases 06-08 (shipped 2026-04-06) — [archived](milestones/v2.8.0-ROADMAP.md)
- ✅ **v2.9.0 Branding Completeness & Org Isolation** — Phases 09-12 (shipped 2026-04-06) — [archived](milestones/v2.9.0-ROADMAP.md)
- ✅ **v2.10.0 Prompt Safety & API Key Polish** — Phases 13-14 (shipped 2026-04-10) — [archived](milestones/v2.10.0-ROADMAP.md)
- ✅ **v2.11.0 Brand Intelligence** — Phases 15-21 (shipped 2026-04-12) — [archived](milestones/v2.11.0-ROADMAP.md)

## Phases

- [x] **Phase 22: Permissions Audit** - Migrate org-level routes from `admin.system` to `admin.org`; unblocks correct permission gates for all subsequent phases (completed 2026-04-12)
- [x] **Phase 23: Brand Overview Page** - Dedicated `/brand-overview` with per-site selector, org-level KPIs, and shared sparkline utility (completed 2026-04-12)
- [x] **Phase 24: Per-Dimension Trends + Score Target** - Three dimension sparklines on one SVG, org-level target line, gap display (completed 2026-04-12)
- [x] **Phase 25: Drilldown Modal** - Click sub-score dimension on report detail to see failing elements grouped by color/typography/components (completed 2026-04-12)
- [ ] **Phase 26: Typography x-height Spike** - opentype.js + Google Fonts API feasibility; may conclude "not viable" (acceptable outcome)
- [ ] **Phase 27: Historical Rescore** - Admin action: idempotent, resumable, skip-when-guideline-gone batch rescore of pre-v2.11.0 scans

## Phase Details

### Phase 22: Permissions Audit
**Goal**: Org admins can manage their own organization settings without needing global system admin privileges
**Depends on**: Nothing (first phase of v2.12.0)
**Requirements**: BPERM-01, BPERM-02, BPERM-03
**Success Criteria** (what must be TRUE):
  1. User with `admin.org` (but NOT `admin.system`) can access and save the org edit form for their own organization
  2. User with `admin.org` can toggle branding mode for their own org without `admin.system`
  3. User WITHOUT `admin.org` or `admin.system` is denied access to org edit and branding mode toggle
  4. System-wide operations (create org, delete org, list all orgs) still require `admin.system` and reject `admin.org`-only users
**Plans**: 1 plan
Plans:
- [x] 22-01-PLAN.md — Migrate branding routes to admin.org + permission matrix tests

### Phase 23: Brand Overview Page
**Goal**: Users can see all their branded sites' scores, trends, and sub-score breakdowns on a single dedicated page
**Depends on**: Phase 22
**Requirements**: BOVW-01, BOVW-02, BOVW-03, BOVW-04
**Success Criteria** (what must be TRUE):
  1. User navigates to `/brand-overview` and sees all branded sites for their org with latest score per site
  2. User selects a site from the selector and the detail panel swaps via HTMX to show that site's sparkline, sub-scores, and delta
  3. Org-level summary card displays average score, total scored sites, and improving/regressing counts
  4. Sparkline point computation is extracted into `services/sparkline.ts` and used by both overview page and home widget
**Plans**: 2 plans
Plans:
- [x] 23-01-PLAN.md — Sparkline utility extraction + brand overview route + template + sidebar link
- [x] 23-02-PLAN.md — HTMX site selector + org summary card + tests + UAT

**UI hint**: yes

### Phase 24: Per-Dimension Trends + Score Target
**Goal**: Users can track individual dimension trends over time and measure progress against an org-defined target score
**Depends on**: Phase 23
**Requirements**: BTREND-01, BTREND-02, BTREND-03, BTREND-04, BTREND-05, BTREND-06
**Success Criteria** (what must be TRUE):
  1. Brand overview sparkline SVG shows 3 colored per-dimension polylines (color, typography, components) alongside the composite line
  2. Dimensions with fewer than 2 data points show "insufficient data" instead of a polyline; unscorable entries produce natural gaps
  3. Admin sets a target score (0-100) on the overview page and a dashed horizontal target line appears on the sparkline
  4. Summary card shows "Current: X / Target: Y (gap: Z)" with green/amber/red color banding
  5. When no target is set (NULL), no target line or gap display renders
**Plans**: 2 plans
Plans:
- [x] 24-01-PLAN.md — Per-dimension sparkline extraction + gap-aware multi-series SVG polylines
- [x] 24-02-PLAN.md — Migration 044 + score target CRUD + dashed SVG line + gap display
**UI hint**: yes

### Phase 25: Drilldown Modal
**Goal**: Users can drill into a sub-score dimension to see exactly which elements are failing and why
**Depends on**: Phase 22
**Requirements**: BDRILL-01, BDRILL-02, BDRILL-03
**Success Criteria** (what must be TRUE):
  1. User clicks a sub-score row on the report detail brand score panel and a modal opens showing failing elements for that dimension
  2. Color drilldown shows WCAG 1.4.3/1.4.6/1.4.11 brand-matched issues; typography shows font/size/line-height issues; components shows brand selector mismatches
  3. Modal uses the existing `<dialog>` + `showModal()` pattern — no new JS dependencies added
**Plans**: 1 plan
Plans:
- [x] 25-01-PLAN.md — Drilldown service + endpoint + modal template + clickable sub-score rows + UAT
**UI hint**: yes

### Phase 26: Typography x-height Spike
**Goal**: Determine whether real x-height font metrics can viably improve the typography sub-score via Google Fonts API + opentype.js
**Depends on**: Nothing (independent spike)
**Requirements**: BTYPO-01, BTYPO-02, BTYPO-03, BTYPO-04
**Success Criteria** (what must be TRUE):
  1. Spike produces a working proof-of-concept that resolves a Google Font family name to x-height/cap-height/unitsPerEm metrics via opentype.js
  2. If viable: migration adds `x_height`, `cap_height`, `units_per_em` columns to `branding_fonts`; typography scorer uses x-height ratio as 4th heuristic (25% weight each)
  3. If not viable: spike document explains why (e.g., OS/2 table coverage too low, Google Fonts API limitations) and no scorer changes are made
  4. Non-Google-Fonts families gracefully fall back to existing 3-way mean scoring — no regression
**Plans**: TBD

### Phase 27: Historical Rescore
**Goal**: Org admins can backfill brand scores for scans that predate the scoring feature, making trend data complete
**Depends on**: Phase 23
**Requirements**: BRESCORE-01, BRESCORE-02, BRESCORE-03, BRESCORE-04, BRESCORE-05
**Success Criteria** (what must be TRUE):
  1. Admin clicks "Rescore historical scans" on the brand overview page and all completed scans for the org are processed
  2. Running rescore a second time skips already-scored scans (idempotent by scan_id + guideline_id check)
  3. Scans whose linked guideline no longer exists are skipped with a warning count — no unscorable rows created
  4. Rescore processes in batches of 50 and can resume from the last processed scan if interrupted
  5. Rescore always uses embedded mode (in-process calculator) regardless of org branding_mode
**Plans**: TBD
**UI hint**: yes

## Planned

- **v3.0.0** — MCP servers + dashboard agent companion (org-aware, multimodal, speech+text)

## Progress

**Execution Order:** 22 → 23 → 24 → 25 → 26 → 27
(Phase 25 and 26 can run in parallel after Phase 22; shown sequentially for simplicity)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 22. Permissions Audit | 1/1 | Complete    | 2026-04-12 |
| 23. Brand Overview Page | 2/2 | Complete    | 2026-04-12 |
| 24. Per-Dimension Trends + Score Target | 2/2 | Complete    | 2026-04-12 |
| 25. Drilldown Modal | 1/1 | Complete    | 2026-04-12 |
| 26. Typography x-height Spike | 0/? | Not started | - |
| 27. Historical Rescore | 0/? | Not started | - |
