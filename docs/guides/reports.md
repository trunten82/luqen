[Docs](../README.md) > [Guides](../README.md#how-to-guides) > Reports Guide

# Reports Guide

How to read, filter, and compare accessibility reports in the dashboard and CLI.

---

## Report layout

Dashboard reports use a **4-tab layout** with a summary bar at the top. Additional features include print/PDF export, manual testing checklists, and trend tracking — described after the tab sections below.

### Summary bar

The summary bar appears above all tabs and shows at-a-glance metrics:

- **Pages scanned** — total number of pages in the scan
- **Total issues** — combined count of all accessibility issues
- **Errors** — confirmed violations (red)
- **Warnings** — potential issues needing human review (amber)
- **Notices** — informational flags (blue)

---

## Tab 1: Compliance

Visible only when jurisdictions were selected during the scan.

Each jurisdiction is displayed as a card showing:

- **Jurisdiction name and ID** (e.g., "European Union (EU)")
- **Status badge** — FAIL (red), REVIEW (amber), or PASS (green)
- **WCAG criteria violated** — count of unique WCAG criteria that fail mandatory requirements, deduplicated across regulations
- **Regulation tags** — badges for each regulation in the jurisdiction, colour-coded by obligation:
  - Red = mandatory
  - Amber = recommended
  - Blue = optional

Cards are sorted with failing jurisdictions first.

---

## Tab 2: Issues

All issues grouped by **WCAG criterion** (e.g., "1.1.1 Non-text Content"). This is the primary working view for fixing issues.

### Criterion groups

Each group header shows:

- **WCAG criterion number and title** (e.g., "1.1.1 Non-text Content") linked to the W3C specification
- **Severity breakdown** — counts of errors, warnings, and notices within the group
- **Regulation tags** — badges for all regulations that require this criterion
- **Component tags** — if template issues exist in this group, the inferred component names are shown (e.g., "Navigation", "Footer")

Expanding a group reveals each individual issue with:

- Severity icon (error/warning/notice)
- The issue message
- The CSS selector
- The HTML context snippet
- Regulation badges (if any)

### Sorting

Groups are sorted by priority:

1. Regulatory + template issues (highest priority — legal requirement, appears across pages)
2. Regulatory issues (legal requirement)
3. Template issues (cross-page, high impact)
4. Other issues

Within each tier, groups are sorted by total issue count (descending).

---

## Tab 3: Templates

Visible only on **Full Site** scans where template issues were detected.

Template issues are accessibility problems that appear identically on 3 or more pages — typically from shared components like headers, footers, and navigation. Pally-agent detects these by fingerprinting each issue (code + selector + context) and grouping duplicates.

### Component grouping

Template issues are grouped by **inferred component**:

| Component | Detected by |
|-----------|-------------|
| Navigation | `nav`, `navbar`, `menu`, `hamburger`, `sidebar`, `offcanvas` |
| Header | `header`, `site-header`, `masthead`, `topbar` |
| Footer | `footer`, `site-footer`, `colophon` |
| Cookie Banner | `cookie`, `consent`, `gdpr`, `onetrust`, `iubenda` |
| Form | `form`, `input`, `select`, `textarea`, `search-form` |
| Document Head | `html > head`, `title`, `meta`, `link` |
| Modal / Popup | `modal`, `popup`, `dialog`, `lightbox`, `overlay` |
| Social Links | `social`, `share`, `facebook`, `twitter`, `linkedin` |
| Media / Carousel | `img`, `video`, `audio`, `carousel`, `slider`, `gallery` |
| Card / Listing | `card`, `listing`, `grid-item`, `product-card` |
| Breadcrumb | `breadcrumb` |
| Widget / Sidebar | `widget`, `aside`, `sidebar` |
| CTA / Banner | `cta`, `call-to-action`, `banner`, `hero` |
| Shared Layout | Fallback for issues that don't match a known pattern |

Each component group shows:

- **Component name**
- **Issue count** — number of distinct template issues in this component
- **Affected pages** — number of pages where this component's issues appear
- Expandable list of individual issues with severity, WCAG criterion, and regulation tags

Template deduplication removes approximately 84% of duplicate noise on typical sites.

---

## Tab 4: Pages

Visible on Full Site scans. Shows a per-URL breakdown of issues.

- Pages are sorted by issue count (most issues first).
- Each page row shows the URL, total issue count, and severity breakdown.
- Expanding a page reveals its issue table (issues that were not deduplicated as template issues).

---

## Filter system

The Issues tab provides a multi-select filter panel:

### Severity filters

Toggle independently:

- **Errors** — show/hide confirmed violations
- **Warnings** — show/hide potential issues
- **Notices** — show/hide informational flags

Each filter button shows a live count of matching issues. Filters with zero matches are hidden automatically.

### Category filters

Toggle independently:

- **Regulatory** — show/hide issues linked to at least one regulation
- **Template** — show/hide issues detected as cross-page duplicates

### Behaviour

- Multiple filters can be active simultaneously (they combine with AND logic within a category, OR between severity filters).
- Counts update live as filters are toggled.
- All filters default to "on" — everything is shown initially.

---

## Print / PDF export

Each report has a print-optimized view at `/reports/:id/print`. This is a standalone page that strips navigation, filters, and interactive elements — designed for `window.print()`.

To export a report as PDF:

1. Open the report in the dashboard.
2. Click the **Print** button (or navigate directly to `/reports/:id/print`).
3. Use your browser's Print dialog (Ctrl+P / Cmd+P) and select "Save as PDF" as the destination.

The print layout includes the summary bar, compliance matrix, issues list, and template groups in a linear format suitable for paper or PDF.

---

## Manual testing checklists

Automated scanning covers approximately 30-40% of WCAG criteria. The manual testing feature provides structured checklists for the criteria that require human judgement.

**Path:** `/reports/:id/manual`

The checklist includes 27 WCAG 2.1 AA success criteria that cannot be fully automated, such as:

- Meaningful alternative text (1.1.1 — beyond just checking for presence)
- Logical reading order (1.3.2)
- Visible focus indicators (2.4.7)
- Consistent navigation (3.2.3)
- Error identification and suggestions (3.3.1, 3.3.3)

For each criterion, testers record:

| Status | Meaning |
|--------|---------|
| **Pass** | The criterion is satisfied |
| **Fail** | The criterion is not met — record a description of the failure |
| **N/A** | The criterion does not apply to this page/site |

Results are saved per scan and persist across sessions. Manual test results appear alongside automated findings in the full report view.

---

## Trend tracking

The dashboard tracks scan results over time for each URL.

**Trends page:** `/reports/trends` displays Chart.js line charts plotting error, warning, and notice counts across successive scans of the same URL. Use this to monitor whether accessibility is improving or regressing.

**Home page cards:** The dashboard home page shows executive summary cards with trend indicators for recently scanned URLs — arrows showing whether issue counts are increasing, decreasing, or stable compared to the previous scan.

---

## Report comparison

Compare two reports to see what changed between scans.

### Using comparison

1. Go to the **Reports** list page.
2. Select two completed reports (they should be for the same site, scanned at different times).
3. The comparison view shows:
   - **Added issues** — new issues not present in the earlier scan
   - **Removed issues** — issues that were fixed since the earlier scan
   - **Unchanged issues** — issues present in both scans
   - **Summary delta** — change in error, warning, and notice counts

The comparison URL format is:

```
/reports/compare?a=<scan-id-A>&b=<scan-id-B>
```

Both scans must be completed with JSON report files available.

---

## JSON report structure

The CLI and dashboard both produce JSON reports. The structure is:

```json
{
  "summary": {
    "url": "https://example.com",
    "pagesScanned": 12,
    "pagesFailed": 0,
    "totalIssues": 47,
    "byLevel": {
      "error": 8,
      "warning": 15,
      "notice": 24
    }
  },
  "pages": [
    {
      "url": "https://example.com/",
      "discoveryMethod": "sitemap",
      "issueCount": 5,
      "issues": [
        {
          "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
          "type": "error",
          "message": "Img element missing an alt attribute.",
          "selector": "html > body > header > img",
          "context": "<img src=\"logo.svg\">",
          "wcagCriterion": "1.1.1",
          "wcagTitle": "Non-text Content",
          "wcagUrl": "https://www.w3.org/WAI/WCAG21/Understanding/non-text-content",
          "regulations": [
            { "shortName": "EAA", "obligation": "mandatory", "jurisdictionId": "EU" }
          ]
        }
      ]
    }
  ],
  "errors": [],
  "compliance": { "..." : "see compliance-check.md" },
  "templateIssues": [
    {
      "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "type": "error",
      "message": "Img element missing an alt attribute.",
      "selector": "html > body > header > img",
      "context": "<img src=\"logo.svg\">",
      "affectedPages": ["https://example.com/", "https://example.com/about", "..."],
      "affectedCount": 12
    }
  ]
}
```

### Key fields for API consumers

| Field | Type | Description |
|-------|------|-------------|
| `summary.byLevel.error` | number | Total confirmed violations — use this for pass/fail decisions |
| `pages[].issues[].type` | string | `error`, `warning`, or `notice` |
| `pages[].issues[].code` | string | Full pa11y rule code including WCAG criterion |
| `pages[].discoveryMethod` | string | `sitemap` or `crawl` |
| `compliance.matrix` | object | Per-jurisdiction pass/fail with regulation detail |
| `templateIssues` | array | Issues appearing on 3+ pages (deduplicated from `pages`) |

---

## CSV export

Download scan data as CSV files directly from the dashboard or via the API.

### From the dashboard UI

- **Reports list** (`/reports`) — click the **Download CSV** button to export the scans list.
- **Report detail** (`/reports/:id`) — click the **Download CSV** button to export the scan's issues.
- **Trends page** (`/reports/trends`) — click the **Download CSV** button to export trend data.

### From the API

Three CSV endpoints are available (requires `X-API-Key` header):

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/export/scans.csv` | Scans list (supports `siteUrl`, `from`, `to`, `limit`, `offset` filters) |
| `GET /api/v1/export/scans/:id/issues.csv` | Issues for a scan (supports `severity`, `criterion` filters) |
| `GET /api/v1/export/trends.csv` | Trend data (supports `siteUrl`, `from`, `to` filters) |

```bash
curl -H "X-API-Key: $PALLY_API_KEY" \
  "http://localhost:5000/api/v1/export/scans.csv" -o scans.csv
```

See [API Reference — CSV Export](../reference/api-reference.md#csv-export) for full details.

---

## Reports list

The dashboard's **Reports** page shows all completed and in-progress scans with:

- Search by URL
- Filter by status (queued, running, completed, failed)
- Pagination (20 per page). The `limit` parameter is clamped to 1-100.
- Delete action (available to the scan creator or admins)
- HTMX-powered live table updates

---

*See also: [USER-GUIDE.md](../USER-GUIDE.md) | [scanning.md](scanning.md) | [compliance-check.md](compliance-check.md)*
