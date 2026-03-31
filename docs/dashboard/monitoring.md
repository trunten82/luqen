# Monitoring Module

The monitoring module tracks regulatory source changes and manages the lifecycle of detected updates.

## Overview

Luqen monitors regulatory websites (legislation, standards bodies, government portals) for content changes. When a change is detected, a proposal is created for admin review. The module provides:

- **Automatic scheduled scanning** — sources are checked based on their configured frequency (daily/weekly/monthly)
- **Content diff detection** — paragraph-level comparison showing what was added, removed, or modified
- **Two-flow proposal management** — official regulatory changes are acknowledged; org-custom proposals are reviewed/dismissed
- **Change history with audit trail** — every action is logged with who, when, and optional notes
- **CSV export** — filterable change history exportable for compliance audits

## Pages

### Monitor Dashboard (`/admin/monitor`)

Operational overview showing:
- **KPI cards** — total sources, last scan time, up-to-date count, change pending count, stale count
- **Trigger Scan** — manual scan of all sources (forces check regardless of schedule)
- **Source table** — filterable by name/URL and status, showing last scanned, last DB update, and 3-state status badges

Source status:
- **Up to Date** (green) — scanned within schedule window, no pending changes
- **Change Pending** (amber) — content changed, awaiting acknowledgment
- **Stale** (red) — overdue for scan based on its schedule frequency

### Sources (`/admin/sources`)

Manage monitored source URLs. Add, view, or remove sources. Each source has:
- Name, URL, type (html/rss/api), schedule (daily/weekly/monthly)
- Scan Now button for immediate check of all sources

### Proposals (`/admin/proposals`)

Two-tab view for managing detected changes:

**Regulatory Updates tab** — official sources (org_id = system):
- Acknowledge flow: mark changes as seen, creates audit trail
- Mass acknowledge: select-all + bulk action
- Diff view: expandable panel showing added/removed/modified content

**Custom Proposals tab** — org-specific sources:
- Review & Apply: accept change and update compliance DB
- Dismiss: skip change with optional notes
- Mass review/dismiss via bulk actions

### Change History (`/admin/change-history`)

Audit-ready log of all resolved proposals:
- Filterable by date range, action type, source text search
- Shows: date, source, summary, type (official/custom), action taken, who, notes
- CSV export with current filters applied
- Paginated (50 per page)

## KPI Methodology (v2.4.2)

### Home Page KPIs

| KPI | Definition |
|-----|-----------|
| **Compliance Rate** | % of sites whose latest scan is compliant. Scans with jurisdictions: `confirmedViolations === 0`. Scans without: `errors === 0`. |
| **Overall Trend** | Compares errors-per-page rate between latest and previous scan per site. "Improving" if error rate decreased, "Regressing" if increased. |
| **Sites Monitored** | Count of unique URLs with at least one completed scan. |

### Trends Page KPIs

| KPI | Definition |
|-----|-----------|
| **Accessibility Score** | Per-site score: `100 - (errors × 5) / pages`. Org score = average across all sites' latest scans. Scale: 0 e/p=100, 2 e/p=90, 10 e/p=50, 20 e/p=0. |
| **Overall Change %** | Aggregate error rate change. Positive = improvement (fewer errors), negative = degradation. |
| **Site Scorecard** | Per-site score with trend (improving/regressing/stable/new) based on score comparison of latest vs previous scan. |
| **Summary Table** | Detailed error/warning/notice counts with deltas. Trend column uses errors-per-page for consistency with KPIs. |

### Design Principles

- **Errors only** in KPI calculations — warnings and notices are informational
- **Normalized per page** — fair comparison across scans with different page counts
- **Per-site averaging** — one bad site doesn't tank the org score
- **Latest scan per site** for compliance — historical bad scans don't penalize current state

## Scanner Improvements (v2.4.1)

### Authentication Header Passthrough

The URL discovery crawler now forwards authentication headers to the target site. This enables full site crawl on auth-protected deployments — previously, the crawler would only reach publicly accessible pages.

Configure via the standard `AUTH_HEADER` environment variable (see [monitor-config.md](../reference/monitor-config.md)).

### robots.txt Support

The dashboard serves a `robots.txt` that guides crawlers away from non-page URLs:
- `/api/` — REST API endpoints
- `/graphql` — GraphQL endpoint
- SSE (Server-Sent Events) endpoints

This prevents scanners and search bots from triggering API calls inadvertently.

### Content-Type Filtering

The scanner performs a HEAD request before each page scan. URLs that return a non-HTML content-type (e.g. PDF, JSON, XML) are skipped automatically. This avoids wasted scan attempts and false-positive accessibility results on binary or data responses.

### False-Positive Detection

The scanner discards results that contain only structural errors (missing `lang` attribute, missing `title` element) with no other violations. This pattern indicates that a non-HTML response was scanned and the error set is an artefact of the content-type mismatch rather than a real accessibility issue.

---

## Automatic Scanning

The source monitor scheduler runs every 15 minutes and triggers scans for sources that are due based on their schedule:
- **Daily** sources: checked if last scan was >24 hours ago
- **Weekly** sources: checked if last scan was >7 days ago
- **Monthly** sources: checked if last scan was >30 days ago

Manual "Scan Now" forces all sources to be checked immediately, regardless of schedule.

## Permissions

| Action | Required Permission |
|--------|-------------------|
| View monitor/proposals/history | `compliance.view` |
| Acknowledge/review/dismiss | `compliance.manage` |
| Trigger scan | `compliance.manage` |
| Export CSV | `compliance.view` or `audit.view` |

Org Admins have both `compliance.view` and `compliance.manage` by default.

## Sidebar Navigation

The monitoring workflow lives under the **Monitoring** group in the sidebar:
- Monitor (dashboard)
- Sources (manage URLs)
- Proposals (acknowledge/review)
- Change History (audit log)

Reference data (Jurisdictions, Regulations) is under the separate **Compliance** group.
