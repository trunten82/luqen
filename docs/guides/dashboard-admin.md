[Docs](../README.md) > [Guides](./) > Dashboard Admin

# Dashboard Guide

User guide and admin reference for the pally-agent dashboard.

---

## Starting the dashboard

```bash
# Quickest way — Docker Compose
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"
docker compose up -d
```

Open `http://localhost:5000` and log in with a user account from the compliance service.

For manual setup, see [installation/local.md](../installation/local.md) or [installation/docker.md](../installation/docker.md).

---

## User guide

### Starting a new scan

Navigate to **New Scan** in the sidebar (requires `user` role).

Fill in the form:

| Field | Description |
|-------|-------------|
| **URL** | Target website URL (e.g. `https://example.com`) |
| **Jurisdictions** | Select one or more jurisdictions for compliance checking. List is fetched from the compliance service. |
| **WCAG Standard** | `WCAG2A`, `WCAG2AA` (default), or `WCAG2AAA` |
| **Concurrency** | Pages to scan in parallel (1–10) |

Click **Start Scan**. The browser redirects to the progress page immediately.

### Monitoring progress

The progress page connects to a Server-Sent Events stream — updates are pushed from the server in real time.

| Event | Meaning |
|-------|---------|
| `discovery` | Site discovery complete — total page count known |
| `scan_start` | Scan started |
| `scan_complete` | All pages scanned — compliance check in progress |
| `compliance` | Compliance check complete |
| `complete` | Report written — browser redirects to viewer |
| `failed` | Scan encountered a fatal error |

On completion the page redirects automatically to the report viewer.

### Browsing reports

The **Reports** page (`/reports`) lists all scans as a sortable, searchable table.

**Columns:** URL, status, WCAG standard, pages scanned, total issues (errors/warnings/notices), confirmed violations, date.

**Search:** Filter by URL — updates with 300 ms debounce via HTMX.

**Sort:** Click any column header.

**Pagination:** Previous/Next links.

**Delete:** Each row has a Delete button. You can only delete your own reports.

### Viewing a report

Click any report to open the **Report Viewer**. Additional controls:

- **Download JSON** — raw JSON report
- **Download HTML** — standalone self-contained HTML
- **Compare** — if a previous scan of the same URL exists, a Compare link appears
- **Compliance summary** — per-jurisdiction pass/fail breakdown at the top

### Comparing reports

The **Compare** view (`/reports/compare?a=:id&b=:id`) shows side-by-side diff of two scans of the same site:

- Delta cards: new issues added, issues resolved, score change
- Table: issues resolved between scans, new issues introduced

---

## Admin guide

All admin pages are under `/admin/*` and require the `admin` role.

### Jurisdictions (`/admin/jurisdictions`)

Full CRUD for jurisdictions in the compliance service.

- **Inline edit** — click a cell to edit, save on blur or Enter
- **Add** — modal form via HTMX
- **Delete** — confirmation required

### Regulations (`/admin/regulations`)

CRUD for regulations, filterable by jurisdiction.

- Columns: ID, name, short name, jurisdiction, enforcement date, status, scope
- Add, inline edit, delete

### Requirements (`/admin/requirements`)

CRUD for WCAG requirements attached to regulations.

- Filter by regulation
- Columns: WCAG version, level, criterion, obligation, notes
- Add via modal, delete with confirmation

### Update proposals (`/admin/proposals`)

Review and act on pending compliance rule change proposals.

- Filter by status: `pending`, `approved`, `rejected`
- **View diff** — structured before/after comparison
- **Approve** — applies the change via the compliance service API
- **Reject** — marks the proposal rejected

### Monitored sources (`/admin/sources`)

Manage legal sources the compliance service watches for regulation changes.

- **Add** — modal with name, URL, and source type
- **Scan Now** — triggers immediate scan of all sources; new proposals created for detected changes
- **Delete** — removes the source

### Webhooks (`/admin/webhooks`)

Manage outbound webhook registrations.

- **Add** — URL, event selection checkboxes, optional shared secret
- **Test** — sends a test delivery and shows the HTTP response status
- **Delete** — removes with confirmation

### Users (`/admin/users`)

Manage user accounts in the compliance service.

| Role | Dashboard permissions |
|------|-----------------------|
| `viewer` | View reports, compare |
| `user` | viewer + create scans, delete own reports |
| `admin` | user + full admin section |

- **Create** — modal with username, password, role
- **Deactivate** — marks inactive (does not delete)

### OAuth clients (`/admin/clients`)

Manage OAuth2 clients registered in the compliance service.

- **Create** — name, scopes, grant type. After creation, the **client secret is shown exactly once** in a copy-to-clipboard dialog. Store it immediately.
- **Revoke** — disables the client. All tokens issued to it become invalid.

### System health (`/admin/system`)

- Service connectivity: compliance service and pa11y webservice
- Database stats: total scans, SQLite file size
- Seed status: jurisdiction, regulation, requirement counts
- Runtime: uptime, Node.js version, package version

---

## Troubleshooting

### `sessionSecret must be at least 32 bytes`

```bash
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"
```

### Login fails with "Invalid credentials"

- Confirm the compliance service is running at `complianceUrl`
- Confirm the dashboard OAuth client is registered with `password` grant type
- Confirm the username and password are correct

### Scans stay in `queued` status

The `maxConcurrentScans` limit has been reached. Wait for running scans to complete, or increase the limit in config.

### SSE progress shows no updates

Add to your reverse proxy:
```nginx
proxy_buffering off;
add_header X-Accel-Buffering no;
```

### Reports missing after restart

Reports are stored on disk at `reportsDir`. If the directory or volume was not persisted, the files are gone. The scan record in SQLite still exists but opening the report will fail.

---

*See also: [configuration/dashboard.md](../configuration/dashboard.md) | [installation/docker.md](../installation/docker.md) | [dashboard/README.md](../dashboard/README.md)*
