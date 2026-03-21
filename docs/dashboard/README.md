# Luqen

**Browser-based interface for accessibility scanning, report management, and compliance administration.**

The Luqen is a server-rendered web application built with Fastify, Handlebars, and [HTMX](https://htmx.org/). It provides a visual interface for launching site-wide accessibility scans, monitoring progress in real time, browsing and comparing reports, and administering the compliance service — all from a standard browser with no JavaScript build step required.

---

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Configuration](#configuration)
4. [Authentication](#authentication)
5. [User Guide](#user-guide)
6. [Admin Guide](#admin-guide)
7. [Docker Deployment](#docker-deployment)
8. [Accessibility](#accessibility)
9. [CLI Reference](#cli-reference)
10. [Troubleshooting](#troubleshooting)

---

## Overview

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  @luqen/dashboard                      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │  Routes       │  │  Views       │  │  Static Assets    │ │
│  │  /login       │  │  Handlebars  │  │  htmx.min.js      │ │
│  │  /home        │  │  templates   │  │  htmx-sse.js      │ │
│  │  /scan/*      │  │  + partials  │  │  style.css        │ │
│  │  /reports/*   │  │              │  │                   │ │
│  │  /admin/*     │  │              │  │                   │ │
│  └──────┬───────┘  └──────────────┘  └───────────────────┘ │
│         │                                                   │
│  ┌──────▼───────────────────────────────────────────────┐   │
│  │                   Core Services                       │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────────┐  │   │
│  │  │ Auth     │  │ Scanner      │  │ Compliance     │  │   │
│  │  │ (JWT     │  │ Orchestrator │  │ Client         │  │   │
│  │  │  cookie, │  │ (@luqen-     │  │ (HTTP REST     │  │   │
│  │  │  roles)  │  │  agent/core) │  │  to compliance │  │   │
│  │  └──────────┘  └──────────────┘  │  service)      │  │   │
│  │                                   └────────────────┘  │   │
│  │  ┌──────────────────────────────────────────────────┐ │   │
│  │  │ SQLite DB (scan records, local state)            │ │   │
│  │  └──────────────────────────────────────────────────┘ │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  External Dependencies:                                      │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │ @luqen/   │  │ Compliance Service (REST API)    │  │
│  │ core            │  │ http://localhost:4000             │  │
│  │ (workspace dep) │  └──────────────────────────────────┘  │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

### Key design decisions

- **Fastify + Handlebars + HTMX** — server-rendered HTML with HTMX for interactivity. No JavaScript build pipeline.
- **No SPA** — progressive enhancement via HTMX. Pages degrade gracefully without JavaScript; HTMX adds live updates and partial page swaps.
- **Local SQLite** — scan records and history are stored locally in a single SQLite file.
- **Auth via compliance service** — the dashboard delegates authentication to the compliance service via an OAuth2 password grant. JWTs are verified locally using the compliance service's public key.
- **Self-auditing** — the dashboard is required to pass its own WCAG 2.1 AA accessibility audit using luqen against the EU jurisdiction. Zero confirmed violations is the acceptance criterion.

---

## Getting Started

### Prerequisites

- Node.js 20+
- The compliance service running and reachable (see [compliance docs](../compliance/README.md))
- A pa11y webservice instance (optional — used for actual scanning)
- An OAuth2 client registered in the compliance service with `password` grant type

### Install

From the monorepo root:

```bash
npm install
npm run build --workspaces
```

### First run

1. Create a config file (or rely on environment variables):

```bash
cat > dashboard.config.json <<'EOF'
{
  "port": 5000,
  "complianceUrl": "http://localhost:4000",
  "sessionSecret": "replace-this-with-a-random-32-byte-secret-here",
  "complianceClientId": "dashboard",
  "complianceClientSecret": "your-client-secret"
}
EOF
```

2. Register a dashboard OAuth client in the compliance service:

```bash
cd packages/compliance
node dist/cli.js clients create \
  --name "dashboard" \
  --scope "admin" \
  --grant password
```

3. Run the database migration:

```bash
cd packages/dashboard
node dist/cli.js migrate
```

4. Start the server:

```bash
node dist/cli.js serve
```

The dashboard is now available at `http://localhost:5000`. Log in with any user account registered in the compliance service.

---

## Configuration

### Config file

The dashboard looks for `dashboard.config.json` in the current working directory by default. All fields are optional — defaults are shown below.

```json
{
  "port": 5000,
  "complianceUrl": "http://localhost:4000",
  "webserviceUrl": "http://localhost:3000",
  "reportsDir": "./reports",
  "dbPath": "./dashboard.db",
  "sessionSecret": "",
  "maxConcurrentScans": 2,
  "complianceClientId": "",
  "complianceClientSecret": ""
}
```

### Config fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `5000` | TCP port the Fastify server listens on |
| `complianceUrl` | `string` | `http://localhost:4000` | Base URL of the compliance service REST API |
| `webserviceUrl` | `string` | `http://localhost:3000` | Base URL of the pa11y webservice (used in system health only) |
| `reportsDir` | `string` | `./reports` | Directory where JSON and HTML scan reports are written. Created automatically if missing. |
| `dbPath` | `string` | `./dashboard.db` | Path to the SQLite database file |
| `sessionSecret` | `string` | — | Secret used to sign session cookies. **Required at startup. Minimum 32 bytes.** |
| `maxConcurrentScans` | `number` | `2` | Maximum number of scans that may run simultaneously |
| `complianceClientId` | `string` | — | OAuth2 client ID registered in the compliance service |
| `complianceClientSecret` | `string` | — | OAuth2 client secret |

### Environment variables

Environment variables override the config file. They take the highest precedence.

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `DASHBOARD_PORT` | `port` | Server port |
| `DASHBOARD_COMPLIANCE_URL` | `complianceUrl` | Compliance service base URL |
| `DASHBOARD_WEBSERVICE_URL` | `webserviceUrl` | Pa11y webservice URL |
| `DASHBOARD_REPORTS_DIR` | `reportsDir` | Report storage directory |
| `DASHBOARD_DB_PATH` | `dbPath` | SQLite database path |
| `DASHBOARD_SESSION_SECRET` | `sessionSecret` | Cookie signing secret (min 32 bytes) |
| `DASHBOARD_MAX_CONCURRENT_SCANS` | `maxConcurrentScans` | Max parallel scan limit |
| `DASHBOARD_COMPLIANCE_CLIENT_ID` | `complianceClientId` | OAuth2 client ID |
| `DASHBOARD_COMPLIANCE_CLIENT_SECRET` | `complianceClientSecret` | OAuth2 client secret |

**Precedence:** Environment variables > config file > built-in defaults.

### Startup validation

On startup the dashboard validates:
- `sessionSecret` is at least 32 bytes
- `port` is between 1 and 65535
- `maxConcurrentScans` is at least 1
- `complianceUrl` is a valid URL
- `reportsDir` exists and is writable (created if missing)
- `dbPath` parent directory exists and is writable

Any validation failure exits immediately with a descriptive error message.

---

## Authentication

### Login flow

The dashboard delegates authentication to the compliance service via the OAuth2 password grant.

```
Browser                    Dashboard                    Compliance Service
  │                           │                                │
  │  POST /login              │                                │
  │  username + password      │                                │
  │──────────────────────────▶│                                │
  │                           │  POST /api/v1/oauth/token      │
  │                           │  grant_type=password           │
  │                           │  client_id=dashboard           │
  │                           │─────────────────────────────▶  │
  │                           │  { access_token, expires_in }  │
  │                           │◀─────────────────────────────  │
  │                           │  Set httpOnly signed cookie    │
  │  302 → /home              │                                │
  │◀──────────────────────────│                                │
```

The JWT is stored in an `httpOnly`, `SameSite=Strict`, signed cookie and verified locally using the compliance service's public key (fetched once from `GET /api/v1/oauth/jwks` on startup, refreshed on verification failure).

### Session management

- Sessions last as long as the JWT is valid (default: 1 hour, controlled by compliance service token config).
- After expiry, the next request redirects to `/login`.
- Logout (`POST /logout`) clears the cookie immediately.
- Cookies are signed with `sessionSecret` to prevent tampering.

### Roles

Roles are DB-managed and customizable via **Admin > Roles** (`/admin/roles`). The dashboard ships with four default roles. Admins can modify their permissions or create custom roles with any combination of 15 granular permissions.

| Role | Default permissions |
|------|-------------|
| `executive` | `reports.view`, `analytics.view` — read-only access to reports, trends, and compliance summaries |
| `user` | Executive defaults + `scans.create`, `scans.view`, `testing.manual`, `reports.delete` — create scans, manual testing, delete own reports |
| `developer` | User defaults + `issues.view`, `issues.manage`, `repos.view` — fix proposals, code diffs, assignment queue |
| `admin` | All 15 permissions — full admin section including roles, users, system settings |

### Route protection

| Route | Required permission |
|-------|---------------------|
| `GET /login` | none |
| `GET /static/*` | none |
| `GET /home` | `reports.view` or `analytics.view` |
| `GET /reports`, `GET /reports/*` | `reports.view` |
| `GET /scan/new`, `POST /scan/new` | `scans.create` |
| `GET /scan/:id/progress` | `scans.view` |
| `DELETE /reports/:id` | `reports.delete` (own reports only) |
| `GET /admin/*`, `POST /admin/*`, `PUT /admin/*`, `DELETE /admin/*` | `admin.system` |

---

## User Guide

### Starting a new scan

Navigate to **New Scan** in the sidebar (requires `user` role).

Fill in the form:

- **URL** — the target website URL (e.g. `https://example.com`). Must be a valid URL with `http` or `https` protocol.
- **Scan Mode** — choose **Single Page** (default, scans only the entered URL) or **Full Site** (discovers all pages via sitemap/crawl). Full Site mode enables template issue detection and the Templates tab in the report.
- **Jurisdictions** — select one or more jurisdictions to check compliance against (e.g. EU, US, UK). The list is fetched live from the compliance service via a searchable picker component. Maximum 50 jurisdictions per scan. Selecting jurisdictions enriches the report with legal obligation context.
- **WCAG Standard** — choose `WCAG2A`, `WCAG2AA` (default), or `WCAG2AAA`. The report displays this as a human-readable label (e.g. "WCAG 2.1 Level AA") via `formatStandard`.
- **Concurrency** — number of pages to scan in parallel (1–10, default from config).

The scan endpoint (`POST /scan/new`) is rate-limited: 10 requests per 10 minutes per session. The `scanMode` parameter accepts `single` or `site` (default: `site` for API, `single` for dashboard UI).

Click **Start Scan**. The server creates a scan record and immediately redirects to the progress page.

### Monitoring scan progress

The progress page connects to a Server-Sent Events (SSE) stream via HTMX. No polling — updates are pushed from the server as they occur.

The page shows:
- Current status (queued, running, complete, failed)
- Pages discovered and pages scanned
- Current URL being scanned
- Live issue counts (errors, warnings, notices)
- A scrolling event log

On completion the page automatically redirects to the report viewer. On failure it shows the error message and a retry button.

SSE events streamed during a scan:

| Event type | Meaning |
|------------|---------|
| `discovery` | Site discovery complete — total page count known |
| `scan_start` | Scan started |
| `page_progress` | A single page has been scanned — includes page URL and running issue counts |
| `scan_complete` | All pages scanned — compliance check in progress |
| `compliance` | Compliance check complete |
| `complete` | Report written — browser redirected to viewer (URL is validated to prevent open redirects) |
| `failed` | Scan encountered a fatal error |

### Browsing reports

The **Reports** page (`/reports`) lists all scan records as a sortable, searchable, paginated table.

**Columns:** Site URL, status, WCAG standard, pages scanned, total issues (errors / warnings / notices), confirmed violations, date.

**Search:** Type in the search box to filter by URL. Results update without a full page reload (300 ms debounce, powered by HTMX).

**Filter:** Use the status dropdown to show only `completed`, `failed`, or `running` scans.

**Sort:** Click any column header to sort ascending or descending.

**Pagination:** Navigate with Previous / Next links. Page size is controlled by the `limit` query parameter.

**Delete:** Each row has a Delete button. You can only delete reports you created. Deletion is confirmed inline and the row animates out on removal.

### Viewing a report

Click the report link in the Reports table to open the **Report Viewer** (`/reports/:id/view`).

The report uses a tabbed layout with a **summary bar** above the tabs showing total errors, warnings, and notices at a glance.

**Tabs:**

- **Compliance** — jurisdiction cards showing the count of WCAG criteria violated per jurisdiction, with regulation badges linking to official legal texts. Only visible when jurisdictions were selected.
- **Issues** — all issues grouped by WCAG criterion (e.g. "1.1.1 Non-text Content"). Each criterion group displays a severity breakdown (errors/warnings/notices counts). Includes a multi-select filter system: severity filters (Errors, Warnings, Notices) and category filters (Regulatory, Template). Filters show live counts and those with zero results are hidden automatically.
- **Templates** — issues grouped by inferred component (Navigation, Footer, Cookie Banner, Form, Header, etc.) with affected page counts. Only appears on full-site scans where template issues were detected.
- **Pages** — per-page issue breakdown for full-site scans.

Additional controls:

- **Download JSON** — downloads the raw JSON report file.
- **Download HTML** — downloads the standalone HTML report.
- **Compare** — if a previous scan of the same URL exists, a Compare link appears.

The WCAG standard displays as a human-readable label (e.g. "WCAG 2.1 Level AA") throughout the report.

The page includes print-specific CSS: printing hides sidebar and navigation and produces a clean, full-width report.

### Comparing reports

The **Compare** view (`/reports/compare?a=:id&b=:id`) shows a side-by-side diff of two scans of the same site.

- Summary cards show the delta: new issues added, issues resolved, score change.
- A table lists issues present in scan A but not B (resolved) and issues in B but not A (new).
- Only available for scans of the same site URL.

---

## Admin Guide

All admin pages are under `/admin/*` and require the `admin` role. The admin section is accessible from the **Admin** group in the sidebar, visible only to admin users.

### Managing jurisdictions

**`/admin/jurisdictions`** — full CRUD for jurisdictions stored in the compliance service.

- The table lists all jurisdictions with columns: ID, name, type, parent, regulation count.
- **Inline edit** — click a cell to edit it; save on blur or Enter.
- **Add** — click **Add Jurisdiction** to open a modal form (loaded via HTMX). Fill in name, type, and optional parent jurisdiction, then submit.
- **Delete** — click Delete on any row. A confirmation prompt appears before the request is sent.

All changes are immediately reflected in the compliance service database.

### Managing regulations

**`/admin/regulations`** — CRUD for regulations, filterable by jurisdiction.

- Use the jurisdiction dropdown to narrow the list.
- Columns: ID, name, short name, jurisdiction, enforcement date, status, scope.
- Add, inline edit, and delete follow the same HTMX modal and inline patterns as jurisdictions.

### Managing requirements

**`/admin/requirements`** — CRUD for WCAG requirements attached to regulations.

- Filter by regulation using the regulation dropdown.
- Columns: WCAG version, level, criterion, obligation, notes.
- Add via modal, delete with confirmation. Inline edit is not available (use delete + add).

### Reviewing update proposals

**`/admin/proposals`** — review and act on pending compliance update proposals generated by the monitored source scanner.

- Filter by status: `pending`, `approved`, `rejected`.
- Columns: source, type, summary, detected date, status.
- **View diff** — click a proposal to see the structured before/after comparison.
- **Approve** — applies the change via the compliance service API. Confirmation required.
- **Reject** — marks the proposal rejected. Confirmation required.

Approved proposals update the compliance service's jurisdiction/regulation data immediately.

### Managing monitored sources

**`/admin/sources`** — manage the list of legal sources the compliance service monitors for regulation changes.

- Columns: name, URL, type, schedule, last checked.
- **Add** — opens a modal to enter name, URL, and source type.
- **Scan Now** — triggers an immediate scan of all sources. New proposals are created for any detected changes.
- **Delete** — removes the source with confirmation.

### Managing webhooks

**`/admin/webhooks`** — manage outbound webhook registrations.

- Columns: URL, subscribed events, active status, created date.
- **Add** — modal form with URL input, event selection checkboxes (available events listed by the compliance service), and an optional shared secret.
- **Test** — sends a test delivery to the webhook URL and shows the HTTP response status.
- **Delete** — removes the webhook with confirmation.

### Managing users and roles

**`/admin/users`** — list and manage user accounts in the compliance service.

- Columns: username, role, created date, status.
- **Create** — modal form with username, password, and role dropdown (shows all available roles including custom ones).
- **Deactivate** — marks the user inactive (does not delete the account). Confirmation required.

Note: Dashboard Users are stored in the dashboard's local SQLite database. These are separate from API Users (Compliance) managed via `luqen-compliance users create`.

### Managing OAuth clients

**`/admin/clients`** — manage OAuth2 clients registered in the compliance service.

- Columns: name, client ID, scopes, grant types, created date.
- **Create** — modal form with name, scopes, and grant type selection. After creation, the **client secret is shown exactly once** in a copy-to-clipboard dialog. Store it immediately.
- **Revoke** — disables the client. All tokens issued to it become invalid. Confirmation required.

### System health

**`/admin/system`** — overview of service status and configuration.

Displays:
- **Service status cards** — connectivity to the compliance service and pa11y webservice (both checked live).
- **Database stats** — total scans, SQLite file size, disk usage.
- **Seed status** — jurisdiction, regulation, and requirement counts from the compliance service.
- **Configuration** — current non-sensitive config values (port, URLs, reports dir, max concurrent scans).
- **Runtime** — uptime, Node.js version, dashboard package version.

---

## Docker Deployment

See [../deployment/docker.md](../deployment/docker.md) for full Docker and Docker Compose setup instructions.

### Quick start with Docker Compose

The monorepo `docker-compose.yml` runs the compliance service and dashboard together:

```bash
# Set required secrets
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"

# Start all services
docker compose up -d
```

Services started:
- `luqen-compliance` on port 4000
- `luqen-dashboard` on port 5000

The dashboard container runs `luqen-dashboard migrate` automatically before starting the server.

### Environment variables for Docker

```bash
DASHBOARD_PORT=5000
DASHBOARD_COMPLIANCE_URL=http://compliance:4000   # service name, not localhost
DASHBOARD_WEBSERVICE_URL=http://host.docker.internal:3000
DASHBOARD_REPORTS_DIR=/app/reports
DASHBOARD_DB_PATH=/app/data/dashboard.db
DASHBOARD_SESSION_SECRET=<min 32 random bytes>
DASHBOARD_COMPLIANCE_CLIENT_ID=dashboard
DASHBOARD_COMPLIANCE_CLIENT_SECRET=<client secret>
```

### Volumes

| Volume | Mount path | Purpose |
|--------|------------|---------|
| `dashboard-data` | `/app/data` | SQLite database |
| `dashboard-reports` | `/app/reports` | Generated scan reports |

---

## Accessibility

The dashboard must meet WCAG 2.1 Level AA. Because it is part of the luqen ecosystem, it is self-audited using luqen.

### Acceptance criterion

Zero confirmed violations when scanning the running dashboard against the EU jurisdiction:

```bash
luqen scan http://localhost:5000 \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU
```

### Implementation requirements

- **Semantic HTML** — `<nav>`, `<main>`, `<header>`, `<footer>`, `<section>`, `<article>` used appropriately throughout.
- **Skip link** — "Skip to main content" is the first focusable element on every page.
- **ARIA landmarks** — `role="banner"`, `role="navigation"`, `role="main"`, `role="contentinfo"` on all layouts.
- **ARIA live regions** — all HTMX swap targets that update dynamic content carry `aria-live="polite"` or `aria-live="assertive"`.
- **Focus management** — on modal open, focus moves to the modal. On close, focus returns to the trigger element. Escape closes modals.
- **Keyboard navigation** — all interactive elements reachable via Tab. Modal traps focus. Arrow keys work in dropdowns.
- **Color** — never the sole indicator of state. Every color-coded status badge has an accompanying text label or icon.
- **Contrast** — minimum 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold).
- **Form labels** — every input has an associated `<label for="...">` element.
- **Error messages** — linked to inputs via `aria-describedby`, announced via `aria-live="assertive"`.
- **Tables** — `<th scope="col">` and `<th scope="row">` headers throughout. `<caption>` or `aria-label` on each table.
- **Images** — all `<img>` elements have `alt` attributes. Decorative images use `alt=""` and `aria-hidden="true"`.
- **Reduced motion** — CSS transitions and animations are disabled when `prefers-reduced-motion: reduce` is set.

### Responsive and dark mode

- **Responsive:** Three breakpoints: mobile (<768px, hamburger sidebar), tablet (768–1024px), desktop (>1024px, full sidebar).
- **Dark mode:** Follows `prefers-color-scheme: dark` via CSS custom properties. No toggle needed.
- **Print:** Report viewer suppresses sidebar, header, and footer on print and uses a full-width layout.

---

## CLI Reference

The dashboard package installs a `luqen-dashboard` binary.

### `luqen-dashboard serve`

Start the web server.

```
luqen-dashboard serve [options]

Options:
  -p, --port <number>    Port to listen on (overrides config)
  -c, --config <path>    Path to config file  [default: dashboard.config.json]
```

Startup sequence:
1. Load config (file + env overrides)
2. Validate config (fails fast with clear message on error)
3. Run SQLite migration (idempotent — safe to run on every start)
4. Fetch compliance service JWKS for JWT verification
5. Register Fastify plugins (views, static files, form body, secure session)
6. Register all routes
7. Start listening

### `luqen-dashboard migrate`

Create or update the SQLite schema. Safe to run multiple times (`CREATE TABLE IF NOT EXISTS`).

```
luqen-dashboard migrate [options]

Options:
  -d, --db-path <path>   Path to SQLite database file (overrides config)
  -c, --config <path>    Path to config file  [default: dashboard.config.json]
```

Reports tables created or confirmed as up to date.

---

## Troubleshooting

### `sessionSecret must be at least 32 bytes`

Set `DASHBOARD_SESSION_SECRET` to a random string of at least 32 characters:

```bash
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"
```

### `Invalid complianceUrl`

Check that `complianceUrl` (or `DASHBOARD_COMPLIANCE_URL`) is a fully qualified URL including the scheme:

```json
{ "complianceUrl": "http://localhost:4000" }
```

### Login fails with "Invalid credentials"

- Confirm the compliance service is running and reachable at `complianceUrl`.
- Confirm the dashboard OAuth client is registered with `password` grant type.
- Confirm the username and password are correct in the compliance service.

### Login fails with "OAuth2 error" or 400/401 from compliance service

- The compliance service may not have the `password` grant type enabled for the dashboard client.
- Re-register the client: `node dist/cli.js clients create --name dashboard --scope admin --grant password`.

### Scans stay in `queued` status

The `maxConcurrentScans` limit has been reached. Wait for running scans to complete, or increase the limit in config.

### Reports are missing after a server restart

Reports are stored on disk at `reportsDir`. If that directory was changed between runs, or if the container volume was not persisted, the report files may be gone. The scan record in SQLite will still show the old path; opening the report will fail.

For Docker deployments, ensure the `dashboard-reports` volume is mounted and persisted across restarts.

### SSE progress page shows no updates

- Confirm no reverse proxy is buffering the SSE stream. For nginx, add `proxy_buffering off;` and `X-Accel-Buffering: no`.
- Confirm the browser supports SSE (all modern browsers do).
- Check browser developer tools Network tab for the SSE connection status.

### Admin section shows 403 for an admin user

The JWT `role` claim must be exactly `"admin"`. Verify the user account role in the compliance service:

```bash
node dist/cli.js users list   # in packages/compliance
```

### `Cannot create reportsDir`

The dashboard process does not have write permission to the parent directory. Adjust file permissions or specify a different `reportsDir` path.
