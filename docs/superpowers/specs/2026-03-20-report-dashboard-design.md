# Report Dashboard Redesign

**Date:** 2026-03-20
**Status:** Approved
**Author:** alanna82 + Claude

## Problem Statement

The current report-detail view is a direct port of the standalone static HTML report crammed into the dashboard layout. It suffers from:

1. Contradictory compliance data — summary says "failed" but jurisdiction cards show "pass"
2. Duplicate jurisdiction rendering (cards + table with different data)
3. No regulation tags on individual errors
4. Flat error list with no grouping or drill-down — unusable for sites with hundreds of issues
5. No progressive disclosure — everything visible at once

## Design Goals

1. **Executive summary first** — stakeholders see compliance status immediately
2. **Developer drill-down** — developers find what to fix, in priority order
3. **Regulatory violations prominent** — mandatory violations at the top
4. **Template dedup** — shared component issues highlighted for max-impact fixes
5. **Counts by default, detail on demand** — nothing expanded until clicked

## Non-Goals

- Trend analysis / comparison between scans (separate feature)
- Inline fix suggestions (future)
- Export to PDF (future)

## Architecture

Three-tab layout rendered with HTMX (no full page reload). Tab state in URL hash.

### Tab 1: Compliance Overview (`#compliance`)

**Summary bar** (compact, inline — not big cards):
```
Pages: 12 | Issues: 47 | Errors: 8 | Warnings: 23 | Notices: 16
```
Single line of badge-style counters.

**Compliance Matrix** — one card per jurisdiction:
- Jurisdiction name + ISO code
- Status badge: PASS (green), FAIL (red), REVIEW (amber)
- Confirmed violations (errors matching mandatory regulations)
- Needs manual review (warnings/notices matching regulations)
- Regulation tags as pills (clickable → official source URL)
- Tags colored by obligation: red=mandatory, amber=recommended, blue=optional

**No table.** Cards only. No duplication.

**Empty state:** "No jurisdictions selected during scan. Run a new scan with jurisdictions to see compliance analysis."

### Tab 2: Issues (`#issues`)

Three collapsible sections in priority order:

**Section 1: Regulatory Violations** (red accent border)
- Only issues where `regulations` array contains at least one mandatory entry
- Grouped by WCAG criterion (e.g. "1.1.1 — Non-text Content")
- Group header shows: criterion, title, count, regulation tags
- Collapsed by default
- Expanded view: individual issues with severity badge, message, selector (monospace), context (monospace), WCAG link (→ W3C Understanding doc), regulation tags

**Section 2: Template & Layout Issues** (purple accent border)
- Issues with `affectedCount >= 3` (same code+selector+context on 3+ pages)
- Group header: issue type badge, WCAG criterion + title, "Affects N pages" label, "Fix once, fix everywhere" hint
- Collapsed by default
- Expanded view: message, selector, context, expandable affected pages list

**Section 3: Other Issues** (neutral border)
- All remaining issues (not regulatory, not template)
- Grouped by WCAG criterion with count
- Collapsed by default
- Same expanded format as Section 1

**Filtering toolbar** above all sections:
- Severity filter buttons: All | Errors | Warnings | Notices
- Search box: filter by message text

### Tab 3: Pages (`#pages`)

Per-page URL breakdown:
- One collapsed row per scanned page URL
- Shows: URL (truncated), error/warning/notice counts as badges
- Click to expand → full issue table for that page
- Search by URL
- Sorted by issue count (most issues first)

### Interaction Patterns

**Expand/collapse:** Click group header → toggle body. Chevron indicator.

**Tab switching:** Buttons with `role="tablist"` / `role="tab"`. HTMX swaps the tab panel content. URL hash updates (`#compliance`, `#issues`, `#pages`).

**Regulation tag click:** Opens official source URL in new tab.

**WCAG criterion click:** Opens W3C Understanding doc in new tab.

### Data Requirements

The `normalizeReportData` function in `reports.ts` must provide:

```typescript
{
  summary: { pagesScanned, totalIssues, byLevel: { error, warning, notice } },
  compliance: { summary: { passing, failing }, matrix: [...] },
  complianceMatrix: [{ jurisdictionId, jurisdictionName, reviewStatus, confirmedViolations, needsReview, regulations: [...] }],
  regulatoryIssues: [{ criterion, title, count, regulations, issues: [...] }],
  templateIssues: [{ type, code, criterion, title, message, selector, context, regulations, affectedPages, affectedCount }],
  otherIssues: [{ criterion, title, count, issues: [...] }],
  pages: [{ url, issueCount, issues: [...] }],
}
```

Each issue object:
```typescript
{
  type: 'error' | 'warning' | 'notice',
  code: string,
  message: string,
  selector: string,
  context: string,
  wcagCriterion?: string,
  wcagTitle?: string,
  wcagDescription?: string,
  wcagUrl?: string,
  regulations?: [{ shortName, url, obligation }],
}
```

### Grouping Logic (in normalizeReportData)

1. Enrich all issues with WCAG data + regulation annotations (already done)
2. Extract template issues (code+selector+context fingerprint on 3+ pages)
3. From remaining: separate regulatory (has mandatory regulation) from other
4. Group regulatory by `wcagCriterion`
5. Group other by `wcagCriterion`
6. Sort each group: errors first, then warnings, then notices

### CSS / Styling

Use dashboard design system variables throughout. No inline `<style>` block — move report styles to the main `style.css` under a `.rpt-*` namespace.

Mobile: tabs stack as buttons, issue groups render as cards (same card pattern as admin tables).

## Implementation Notes

- Replace the entire `report-detail.hbs` template
- Update `normalizeReportData` in `reports.ts` to produce the grouped data structure
- Move the inline `<style>` block to `style.css`
- Keep the inline `<script>` for expand/collapse/filter (small, page-specific)
- Tab switching via HTMX targeting a `#report-tab-content` div, or pure JS show/hide (simpler)

## Success Criteria

1. Compliance matrix shows consistent pass/fail — no contradictions
2. No duplicate jurisdiction cards
3. Every error with a regulation shows the regulation tag
4. Default view shows only counts — nothing expanded
5. Template issues grouped and labeled "fix once, fix everywhere"
6. Regulatory violations appear first, clearly distinguished
7. Report is usable for a site with 500+ issues
8. Works on mobile
