# Proposals Redesign: Acknowledge vs Review Flows

**Date:** 2026-03-28
**Status:** Approved
**Scope:** Compliance proposals UI, API, and data model

## Problem

The monitor detects regulatory changes and creates "proposals" with approve/reject actions. This model is wrong for official regulatory sources — legislation changes are facts, not proposals. Additionally, three bugs affect the current implementation:

1. **Scan not updating data** — approving a proposal doesn't reliably apply changes to regulation records in the compliance DB
2. **Card text overflow** — long regulation names and URLs overflow card containers on the monitor/proposals pages
3. **No DB update via UI** — there is no working path from detected change to updated regulation record through the dashboard

## Design

### Two Distinct Flows via Tabbed UI

Single page at `/admin/proposals` with two tabs controlled by `?tab=updates` (default) or `?tab=custom`:

**Tab 1: Regulatory Updates** (official sources, `org_id = 'system'`)
- Changes detected in legislation are facts — no approve/reject
- Action: **Acknowledge** — marks as seen, applies the change to the DB, creates audit trail
- Expandable diff view showing added/removed/modified sections (reusing `analyzer.ts`)
- Optional notes field for admin commentary
- Sidebar badge shows count of unacknowledged changes

**Tab 2: Custom Proposals** (org-specific, `org_id` matches current org)
- Org-created internal policies that can be reviewed/edited/dismissed
- Actions: **Review** (apply changes) or **Dismiss** (skip with notes)
- Editable summary field allows amending proposed changes before applying

### Data Model Changes

Add three columns to `update_proposals`:

```sql
ALTER TABLE update_proposals ADD COLUMN acknowledged_by TEXT;
ALTER TABLE update_proposals ADD COLUMN acknowledged_at TEXT;
ALTER TABLE update_proposals ADD COLUMN notes TEXT;
```

New status values:
- Official sources: `pending` → `acknowledged`
- Custom proposals: `pending` → `reviewed` | `dismissed`
- Legacy statuses `approved`/`rejected` remain queryable for historical data

### API Changes

**Compliance API — new/modified endpoints:**

| Method | Path | Purpose | Scope |
|--------|------|---------|-------|
| PATCH | `/api/v1/updates/:id/acknowledge` | New. Acknowledge official change, apply to DB, write audit log | admin |
| PATCH | `/api/v1/updates/:id/review` | Renamed from `/approve`. Apply custom proposal changes | admin |
| PATCH | `/api/v1/updates/:id/dismiss` | Renamed from `/reject`. Dismiss with optional notes | admin |
| PATCH | `/api/v1/updates/:id/approve` | Legacy alias for `/review` (one release cycle) | admin |
| PATCH | `/api/v1/updates/:id/reject` | Legacy alias for `/dismiss` (one release cycle) | admin |

All three new endpoints accept optional `notes` field in the request body.

The `/acknowledge` endpoint additionally:
1. Sets `acknowledged_by` to the authenticated user
2. Sets `acknowledged_at` to current timestamp
3. Calls `applyChange()` to update the regulation/requirement/jurisdiction in the compliance DB
4. Writes an audit log entry with event type, user, timestamp, notes, and proposal ID

**Dashboard routes:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/proposals` | Updated: accepts `?tab=` param, fetches official vs custom separately |
| POST | `/admin/proposals/:id/acknowledge` | New. Calls compliance API acknowledge endpoint |
| POST | `/admin/proposals/:id/review` | Replaces `/approve`. Calls compliance API review endpoint |
| POST | `/admin/proposals/:id/dismiss` | Replaces `/reject`. Calls compliance API dismiss endpoint |

**Compliance client functions:**
- Add `acknowledgeProposal(baseUrl, token, id, notes?, orgId?)`
- Rename `approveProposal()` → `reviewProposal()`
- Rename `rejectProposal()` → `dismissProposal()`

### UI Template

Single `proposals.hbs` template with tab switching via anchor links and `?tab=` query param. Active tab uses existing `.tab-active` styling.

**Regulatory Updates tab columns:** Source Name, Jurisdiction, Change Summary, Detected Date, Status (unacknowledged/acknowledged)

**Custom Proposals tab columns:** Source, Type, Summary, Detected Date, Status (pending/reviewed/dismissed), Actions

**Diff view:** Expandable inline panel per row showing change sections from `analyzer.ts` output — green for added, red for removed, yellow for modified.

**Text overflow fix:** Apply `word-break: break-word` and use existing `.text-wrap` CSS class for table cells and card values with long content.

### Bug Fixes

**Scan not updating data / No DB update via UI:**
- Trace the `applyChange()` dispatcher to identify why `proposedChanges` JSON isn't being applied
- Ensure the acknowledge and review flows both call `applyChange()` and verify the write succeeds
- Return the updated record in the API response so the UI can confirm the change was applied

### Backward Compatibility

- Old `approved`/`rejected` statuses remain queryable for historical records
- Old API endpoints (`/approve`, `/reject`) work as aliases for one release cycle
- No data migration — `ALTER TABLE` adds nullable columns with no defaults needed

### Documentation Updates

- Update `docs/reference/openapi-compliance.yaml` — add `/acknowledge` endpoint, update `/approve` → `/review` and `/reject` → `/dismiss` with deprecation notices on old paths
- Update `docs/reference/openapi-dashboard.yaml` — add new dashboard routes
- Update `docs/reference/api-reference.md` — document the two proposal flows and new endpoints
- Update `docs/guides/` or `USER-GUIDE.md` — explain the acknowledge vs review workflow for end users

### i18n

All new UI text uses `{{t}}` keys. New keys added to all 6 locale files (en, it, de, fr, es, pt).
