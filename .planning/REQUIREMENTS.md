# Requirements — v2.12.0 Brand Intelligence Polish

**Milestone:** v2.12.0 Brand Intelligence Polish
**Goal:** Close the branding story — dedicated brand overview page, per-dimension trends, score targets, element-level drilldown, typography x-height spike, fine-grained org permissions, and historical rescore.

---

## v1 Requirements

### Permissions Audit (BPERM)

- [ ] **BPERM-01**: Org admin with `admin.org` permission can edit their own organization settings without requiring global `admin.system`
- [ ] **BPERM-02**: Org admin with `admin.org` permission can toggle branding mode for their own org (migrated from `admin.system` gate)
- [ ] **BPERM-03**: System-wide operations (create org, delete org, list all orgs) remain gated by `admin.system` only — no permission downgrade

### Brand Overview Page (BOVW)

- [ ] **BOVW-01**: User with `branding.view` can access `/brand-overview` showing all branded sites for their org with latest brand score per site
- [ ] **BOVW-02**: User can select a site from a dropdown/tab row to view that site's detail panel (sparkline, sub-scores, delta) via HTMX swap
- [ ] **BOVW-03**: User can see an org-level summary card showing average score, total scored sites, and count of improving vs regressing sites
- [ ] **BOVW-04**: System extracts sparkline point computation from `home.ts` into a shared `services/sparkline.ts` utility reused by overview and any future sparkline consumers

### Per-Dimension Trends (BTREND)

- [ ] **BTREND-01**: User can see three per-dimension trend polylines (color, typography, components) on a single SVG alongside the composite sparkline on the brand overview page
- [ ] **BTREND-02**: System skips dimension polyline points for entries where that dimension is unscorable, producing a natural gap in the line
- [ ] **BTREND-03**: Dimension with fewer than 2 scored entries across history does not render its polyline — shows "insufficient data" text instead
- [ ] **BTREND-04**: User with `branding.manage` can set an org-level brand score target (0-100 integer) via the brand overview page
- [ ] **BTREND-05**: System renders a horizontal dashed target line on the sparkline SVG when a target is set; no line when target is NULL
- [ ] **BTREND-06**: User can see current score vs target gap on the summary card, color-banded green (met) or amber/red (below)

### Drilldown Modal (BDRILL)

- [ ] **BDRILL-01**: User can click a sub-score dimension on the report detail brand score panel to open a drilldown modal showing failing elements for that dimension
- [ ] **BDRILL-02**: Drilldown modal groups failing elements by dimension (color: WCAG 1.4.3/1.4.6/1.4.11 brand-matched issues; typography: font/size/line-height issues; components: brand selector mismatches)
- [ ] **BDRILL-03**: Drilldown modal uses existing `<dialog>` + `showModal()` pattern from v2.10.0 prompt diff modal — no new JS framework

### Typography x-height (BTYPO)

- [ ] **BTYPO-01**: System can resolve Google Fonts family names to .ttf file URLs via Google Fonts API and extract x-height, cap-height, and unitsPerEm via opentype.js (server-side only)
- [ ] **BTYPO-02**: System caches extracted font metrics in `branding_fonts.x_height`, `branding_fonts.cap_height`, `branding_fonts.units_per_em` columns (migration 044 or 045)
- [ ] **BTYPO-03**: Typography scorer incorporates x-height ratio (sxHeight / unitsPerEm) as a 4th heuristic, reweighting to 25% each across all four heuristics — only when metrics are available; falls back to 3-way mean otherwise
- [ ] **BTYPO-04**: Spike phase may conclude "not viable" if Google Fonts coverage is too low or opentype.js OS/2 table support is unreliable — that outcome is acceptable and documented

### Historical Rescore (BRESCORE)

- [ ] **BRESCORE-01**: Admin with `branding.manage` can trigger "Rescore historical scans" from the brand overview page, processing all completed scans for the org
- [ ] **BRESCORE-02**: Rescore is idempotent — skips scans that already have a `brand_scores` row for the current guideline (checked by scan_id + guideline_id)
- [ ] **BRESCORE-03**: Rescore is resumable — processes in batches of 50, tracks lastProcessedScanId, user can resume from where it stopped
- [ ] **BRESCORE-04**: Rescore skips scans whose linked guideline no longer exists with a logged warning — never creates unscorable rows for deleted guidelines
- [ ] **BRESCORE-05**: Rescore always uses embedded mode (in-process calculator), never remote branding service, regardless of org branding_mode setting

---

## Future Requirements (deferred, not in v2.12.0)

- **BTYPO-f01**: User font file upload for custom/commercial fonts not on Google Fonts — requires file upload UI, storage, security scanning
- **BTYPO-f02**: Letter-spacing and word-spacing metrics as additional typography heuristics
- **BTREND-f01**: Per-site score targets (separate target per site, not just org-level)
- **BTREND-f02**: Per-dimension targets (separate target per color/typography/components)
- **BRESCORE-f01**: Retention policy for `brand_scores` table when row count exceeds threshold
- **BMODE-f01**: Per-org branding OAuth credentials (not just routing) — only if a real need emerges

---

## Out of Scope (v2.12.0)

- **Chart.js / D3 for sparklines** — inline SVG polyline is sufficient; zero client-side JS dependency
- **Real-time WebSocket sparkline updates** — server-rendered SVG refreshed on page load
- **Cross-org brand score comparison** — violates org isolation rule
- **Automatic background rescore** — hidden processing; admin-triggered only
- **Font file upload** — deferred to future; Google Fonts API covers Tier 1
- **Per-site or per-dimension targets** — single org-level target is sufficient UX
- **Custom sub-score dimensions** — breaks weight-lock invariant from v2.11.0

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| BPERM-01 | 22 | Pending |
| BPERM-02 | 22 | Pending |
| BPERM-03 | 22 | Pending |
| BOVW-01 | 23 | Pending |
| BOVW-02 | 23 | Pending |
| BOVW-03 | 23 | Pending |
| BOVW-04 | 23 | Pending |
| BTREND-01 | 24 | Pending |
| BTREND-02 | 24 | Pending |
| BTREND-03 | 24 | Pending |
| BTREND-04 | 24 | Pending |
| BTREND-05 | 24 | Pending |
| BTREND-06 | 24 | Pending |
| BDRILL-01 | 25 | Pending |
| BDRILL-02 | 25 | Pending |
| BDRILL-03 | 25 | Pending |
| BTYPO-01 | 26 | Pending |
| BTYPO-02 | 26 | Pending |
| BTYPO-03 | 26 | Pending |
| BTYPO-04 | 26 | Pending |
| BRESCORE-01 | 27 | Pending |
| BRESCORE-02 | 27 | Pending |
| BRESCORE-03 | 27 | Pending |
| BRESCORE-04 | 27 | Pending |
| BRESCORE-05 | 27 | Pending |

**Coverage:** 25/25 v1 requirements mapped -- no orphans, no duplicates.

---
*Last updated: 2026-04-12 -- requirements defined by gsd-roadmapper*
