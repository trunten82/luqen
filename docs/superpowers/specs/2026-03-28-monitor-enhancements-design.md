# Monitor Enhancements: Mass Acknowledge, Change History, Source Status, Sidebar Restructure

**Date:** 2026-03-28
**Status:** Approved
**Scope:** Dashboard UI, compliance API, sidebar navigation

## Problem

The proposals page lacks bulk actions, there's no audit trail view for acknowledged changes, the monitor page doesn't show whether the DB is aligned with live source content, and the sidebar groups compliance data management with monitoring workflow.

## Design

### 1. Mass Acknowledge

**Location:** Proposals page, both tabs (Regulatory Updates and Custom Proposals).

**UI:** Checkbox column on each pending row. When 1+ rows are selected, a sticky action bar appears above the table:

```
{N} selected  [Acknowledge All]  [Clear]     (Regulatory Updates tab)
{N} selected  [Review All] [Dismiss All] [Clear]  (Custom Proposals tab)
```

**Behavior:**
- Bulk action sends N parallel requests to the existing single-item endpoints (`/acknowledge`, `/review`, `/dismiss`)
- No new compliance API endpoint — the dashboard route `POST /admin/proposals/bulk-action` accepts `{ ids: string[], action: 'acknowledge' | 'review' | 'dismiss', notes?: string }`
- Dashboard loops through IDs, calls the corresponding compliance client function for each, collects results
- On completion: rows animate out, toast shows "{N} of {total} changes acknowledged" (reports partial failures)
- "Select All Pending" checkbox in table header selects all visible pending rows
- Audit log entry written per item (existing per-action audit logging)

### 2. Change History Page

**Route:** `GET /admin/change-history`

**Purpose:** Audit-ready log of all resolved proposals (acknowledged, reviewed, dismissed). Filterable, exportable.

**Table columns:**
| Column | Source |
|--------|--------|
| Date | `acknowledgedAt` or `reviewedAt` |
| Source | `source` (URL) |
| Change Summary | `summary` |
| Type | Official (org_id = system) or Custom |
| Action | acknowledged / reviewed / dismissed |
| By | `acknowledgedBy` or `reviewedBy` |
| Notes | `notes` |

**Filters:**
- Date range (from/to date inputs)
- Action type dropdown (all / acknowledged / reviewed / dismissed)
- Source text search input

**Data source:** Queries `update_proposals` where status IN ('acknowledged', 'reviewed', 'dismissed', 'approved', 'rejected'). Includes legacy statuses for historical data.

**Export:** "Export CSV" button downloads the current filtered result set as a CSV file. The export endpoint `GET /admin/change-history/export?format=csv` applies the same filters and streams a CSV response.

**Pagination:** Server-side, 50 per page, using existing pagination pattern.

**Permissions:** `compliance.view` or `audit.view`.

### 3. Monitor Source Status

**Enhanced source table columns:**

| Column | Value |
|--------|-------|
| Name | Source name |
| URL | Source URL (with cell--wrap) |
| Schedule | daily / weekly / monthly |
| Last Scanned | `lastCheckedAt` formatted |
| Last DB Update | Most recent `acknowledgedAt` from proposals matching this source URL, or "Never" |
| Status | Computed 3-state badge |

**Status computation (per source):**
- **Up to date** (green) — no pending proposals exist for this source URL
- **Change pending** (amber) — a pending proposal exists for this source URL
- **Stale** (red) — source hasn't been scanned within its schedule window

**Updated KPI cards:**
- Sources (existing count)
- Last Scan (existing)
- Pending Changes (existing, links to proposals)
- Up to Date (new) — count of sources with "up to date" status

**No new DB columns.** Status is derived by joining `monitored_sources` with `update_proposals` on source URL. The monitor route handler computes this server-side.

### 4. Sidebar Restructure

**Before:**
```
Scans: Home, New Scan, Schedules, Reports, Trends, Bookmarklet
Compliance: Jurisdictions, Regulations, Proposals, Sources, Monitor, OAuth Clients
Plugins: ...
Users & Access: ...
Repositories: ...
System: Organizations, API Keys, API Users, Webhooks, System Health, Audit Log
```

**After:**
```
Scans: Home, New Scan, Schedules, Reports, Trends, Bookmarklet
Compliance: Jurisdictions, Regulations
Monitoring: Monitor, Sources, Proposals, Change History
Plugins: ...
Users & Access: ...
Repositories: ...
System: Organizations, OAuth Clients, API Keys, API Users, Webhooks, System Health, Audit Log
```

**Changes:**
- New "Monitoring" group — separates change tracking workflow from static compliance data
- "Change History" — new page added to Monitoring group
- OAuth Clients moved from Compliance to System
- Permission gating: Monitoring group uses `compliance.view` (same as current Compliance group)

### i18n

New keys added to all 6 locales:
- `nav.monitoring`, `nav.changeHistory`
- `admin.changeHistory.*` — page title, column headers, filters, export button, empty state
- `admin.proposals.selectAll`, `admin.proposals.selected`, `admin.proposals.acknowledgeAll`, `admin.proposals.reviewAll`, `admin.proposals.dismissAll`, `admin.proposals.clearSelection`
- `admin.monitor.lastDbUpdate`, `admin.monitor.upToDate`, `admin.monitor.changePending`

### Files Involved

- `packages/dashboard/src/views/partials/sidebar.hbs` — restructure groups
- `packages/dashboard/src/views/admin/proposals.hbs` — add checkboxes and bulk action bar
- `packages/dashboard/src/routes/admin/proposals.ts` — add bulk-action route
- `packages/dashboard/src/views/admin/change-history.hbs` — new template
- `packages/dashboard/src/routes/admin/change-history.ts` — new route handler + CSV export
- `packages/dashboard/src/server.ts` — register change-history routes
- `packages/dashboard/src/routes/admin/monitor.ts` — enhanced source status computation
- `packages/dashboard/src/views/admin/monitor.hbs` — new columns and KPI card
- `packages/dashboard/src/static/app.js` — bulk action JS handler
- `packages/dashboard/src/i18n/locales/*.json` — new keys in all 6 locales
- `packages/dashboard/src/compliance-client.ts` — add status filter for resolved proposals
