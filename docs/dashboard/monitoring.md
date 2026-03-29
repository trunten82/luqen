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
