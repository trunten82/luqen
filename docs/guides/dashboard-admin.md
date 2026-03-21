[Docs](../README.md) > [Guides](../README.md#how-to-guides) > Dashboard Administration Guide

# Dashboard Administration Guide

How to set up, configure, and administer the pally-agent dashboard.

---

## Starting the dashboard

The dashboard (`@pally-agent/dashboard`) is a Fastify web application that provides a browser interface for scanning, viewing reports, and managing compliance data.

### Required services

The dashboard depends on two external services:

| Service | Default URL | Purpose |
|---------|-------------|---------|
| **pa11y webservice** | `http://localhost:3000` | Runs accessibility scans |
| **Compliance service** | `http://localhost:4000` | Provides jurisdiction/regulation data |

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DASHBOARD_SESSION_SECRET` | Yes | — | Session encryption key (minimum 32 bytes) |
| `DASHBOARD_PORT` | No | `5000` | HTTP port |
| `DASHBOARD_COMPLIANCE_URL` | No | `http://localhost:4000` | Compliance service URL |
| `DASHBOARD_COMPLIANCE_API_KEY` | No | — | API key for solo-mode compliance access |
| `DASHBOARD_WEBSERVICE_URL` | No | `http://localhost:3000` | pa11y webservice URL |
| `DASHBOARD_DB_PATH` | No | `./dashboard.db` | SQLite database file path |
| `DASHBOARD_REPORTS_DIR` | No | `./reports` | Directory for JSON report files |
| `DASHBOARD_MAX_CONCURRENT_SCANS` | No | `2` | Default concurrency for scans |
| `DASHBOARD_COMPLIANCE_CLIENT_ID` | No | — | OAuth client ID for compliance service |
| `DASHBOARD_COMPLIANCE_CLIENT_SECRET` | No | — | OAuth client secret for compliance service |
| `DASHBOARD_PLUGINS_DIR` | No | `./plugins` | Directory for installed plugins |
| `DASHBOARD_PLUGINS_CONFIG` | No | — | Path to plugins configuration file |
| `DASHBOARD_REDIS_URL` | No | — | Redis URL for scan queue and SSE pub/sub |
| `DASHBOARD_SCANNER_RUNNER` | No | `htmlcs` | Pa11y test runner: `htmlcs` or `axe`. The `axe` runner requires `pa11y-runner-axe` on the webservice. |
| `DASHBOARD_WEBSERVICE_URLS` | No | — | Comma-separated list of additional pa11y webservice URLs for multi-worker scaling (round-robin distribution). |
| `DASHBOARD_MAX_PAGES` | No | `50` | Maximum pages per full-site scan (1-1000). |

### Starting with environment variables

```bash
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"
export DASHBOARD_COMPLIANCE_URL="http://localhost:4100"
export DASHBOARD_COMPLIANCE_API_KEY="your-api-key"
export DASHBOARD_WEBSERVICE_URL="http://192.168.3.90:4002"

node packages/dashboard/dist/cli.js serve --port 5000
```

### Starting with a config file

Create `dashboard.config.json`:

```json
{
  "port": 5000,
  "complianceUrl": "http://localhost:4100",
  "webserviceUrl": "http://localhost:3000",
  "reportsDir": "./reports",
  "dbPath": "./dashboard.db",
  "maxConcurrentScans": 2
}
```

Environment variables override config file values.

### Starting with Docker Compose

```bash
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"
docker compose up -d
```

Open `http://localhost:5000` in your browser.

---

## Authentication modes

The dashboard supports a progressive authentication model:

### Solo mode (API key)

- Default when no users exist in the database.
- Login requires the compliance service API key (`DASHBOARD_COMPLIANCE_API_KEY` or the key printed at first startup).
- Single-user mode — no user management, no roles.
- Suitable for local development and single-developer setups.

### Team mode (local users)

- Activated when at least one user account is created.
- Login with username and password.
- Supports user roles (see below).
- Suitable for small teams sharing a dashboard instance.

### Enterprise mode (OAuth/SSO)

- Activated when an SSO plugin is installed (e.g., `@pally-agent/plugin-auth-entra` for Microsoft Entra ID).
- Login redirects to the identity provider.
- User roles can be mapped from SSO claims.
- Suitable for organisations with existing identity infrastructure.

---

## User roles

The dashboard supports four default role-based personas, each with tailored navigation and default views. Roles are **DB-managed** — admins can modify permissions on existing roles or create entirely new custom roles via **Admin > Roles**.

| Role | Default view | Default capabilities |
|------|-------------|-------------|
| **admin** | System overview | All 15 permissions. Manage users, roles, jurisdictions, regulations, webhooks, OAuth clients, connected repos, schedules, and system settings. Can delete any report. |
| **developer** | Issue list | View fix proposals and code diffs, manage assignment queue, start scans, delete own reports. Cannot access admin settings. |
| **user** | Report list | Start scans, view all reports, run manual testing checklists, delete own reports. Cannot access admin pages. |
| **executive** | Org score dashboard | Read-only. View org-wide accessibility score (0-100), aggregated trends, and compliance summaries. Cannot start scans or modify data. |

> **Note:** The dashboard distinguishes between **Dashboard Users** (accounts that log in to the web UI, managed at `/admin/users`) and **API Users (Compliance)** (accounts on the compliance service used for direct API access, managed via `pally-compliance users create`). These are separate user stores.

---

## Admin pages

Admin pages are accessible from the sidebar when logged in as an admin user. Each page provides CRUD operations for a specific data type.

### Users

**Path:** `/admin/users`

Manage Dashboard User accounts (users who log in to the web UI):
- Create new users with username, password, and role
- Edit existing users (change role, reset password)
- Delete users

### Roles & Permissions Management

**Path:** `/admin/roles`

Manage the permission model for all dashboard users:

**Default roles:** The dashboard ships with four system roles — `admin`, `developer`, `user`, and `executive` — each pre-configured with appropriate permissions. System roles can have their permissions modified but cannot be deleted.

**Custom roles:** Admins can create new roles with any combination of the 15 available permissions. This is useful for specialized personas (e.g., a "QA Tester" role with only scan and manual testing permissions).

**Permission matrix:** The role editor displays checkboxes grouped into 7 categories:

| Group | Permissions |
|-------|------------|
| **Scans** | `scans.create`, `scans.view` |
| **Reports** | `reports.view`, `reports.delete`, `reports.export` |
| **Issues** | `issues.view`, `issues.manage` |
| **Testing** | `testing.manual` |
| **Repositories** | `repos.view`, `repos.manage` |
| **Analytics** | `analytics.view` |
| **Administration** | `admin.system`, `admin.users`, `admin.roles` |

All dashboard templates use `perm.*` flags for authorization rather than hardcoded role name checks, so custom roles work seamlessly throughout the UI.

### Dashboard Users

**Path:** `/admin/dashboard-users`

Manage Dashboard Users — accounts that log in to the web UI (separate from API Users on the compliance service).

### Jurisdictions

**Path:** `/admin/jurisdictions`

Manage the list of jurisdictions available for compliance checking:
- View all jurisdictions with their regulation counts
- Add new jurisdictions
- Edit jurisdiction names and metadata
- Disable jurisdictions (hides them from the scan form without deleting data)

### Regulations

**Path:** `/admin/regulations`

Manage regulations within jurisdictions:
- View regulations grouped by jurisdiction
- Add new regulations with short name, full name, URL to official text, and enforcement date
- Edit or delete regulations

### Requirements (WCAG mappings)

Linked from the regulations admin page. Map specific WCAG success criteria to regulations with obligation levels (mandatory, recommended, optional). This is the core data that drives compliance checking.

### Sources

**Path:** `/admin/sources`

Manage legal source documents tracked by the monitor service. Sources are periodically checked for changes to accessibility legislation.

### Webhooks

**Path:** `/admin/webhooks`

Configure webhook endpoints that receive notifications when:
- A scan completes
- A scan fails
- Compliance status changes

Each webhook has a URL, secret (for HMAC signature verification), and event type filters.

### OAuth Clients

**Path:** `/admin/clients`

Manage OAuth 2.0 clients for API access to the compliance service:
- Create clients with specific scopes (`read`, `write`, `admin`)
- View client IDs and rotate secrets
- Delete clients

### API Keys

**Path:** `/admin/api-keys`

Manage API keys for service-to-service authentication.

### Organizations

**Path:** `/admin/organizations`

Manage multi-tenant organizations:
- Create organizations with unique slugs
- Assign users to organizations
- Each organization has isolated scan data and compliance configuration

### Plugins

**Path:** `/admin/plugins`

View and configure installed plugins:
- Auth plugins (e.g., Entra ID SSO)
- Notification plugins (Slack, Teams)
- Storage plugins (S3, Azure Blob)

### System

**Path:** `/admin/system`

View system health information:
- Service connectivity (compliance service, pa11y webservice)
- Database status
- Active scan count
- Plugin status

### Monitor

**Path:** `/admin/monitor`

View and manage the legislation monitor:
- Source scan history
- Detected changes to accessibility laws
- Source health status

### Fix Proposals

**Path:** `/admin/proposals`

View and manage auto-generated fix proposals across scans. When connected repos are configured, proposals include AI-generated code diffs (21 suggestion types via MCP/A2A integration).

### Connected Repositories

**Path:** `/admin/repos`

Link GitHub or GitLab repositories to enable source-aware fix proposals:
- Add repos by URL with authentication tokens
- Map repos to scan URL patterns (e.g., `https://staging.example.com` maps to `github.com/org/frontend`)
- View proposal statistics per repo
- Disconnect repos when no longer needed

### Scan Schedules

**Path:** `/admin/schedules`

Manage recurring scan schedules:
- View all active schedules with next run time and last result
- Create new schedules (daily, weekly, or monthly) from existing scan configurations
- Pause, resume, or delete schedules
- View execution history per schedule

---

## Data API endpoints

The dashboard provides read-only JSON and CSV endpoints for external consumption (Power BI, custom integrations, CI/CD pipelines).

### Available endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/scans` | List scans (filters: `siteUrl`, `from`, `to`, `limit`, `offset`) |
| `GET /api/v1/scans/:id` | Single scan detail |
| `GET /api/v1/scans/:id/issues` | Issues for a scan (filters: `severity`, `criterion`) |
| `GET /api/v1/trends` | Time-series issue counts per site |
| `GET /api/v1/compliance-summary` | Latest compliance status per jurisdiction |
| `GET /api/v1/export/scans.csv` | CSV download of scans list |
| `GET /api/v1/export/scans/:id/issues.csv` | CSV download of issues |
| `GET /api/v1/export/trends.csv` | CSV download of trend data |

### Authentication

All data API endpoints require an `X-API-Key` header. Generate keys from **Settings > API Keys** (`/admin/api-keys`).

### Rate limiting

Data API endpoints are rate limited to 60 requests per minute per API key.

For full documentation with request/response examples, see [API Reference — Dashboard Data API](../reference/api-reference.md#dashboard-data-api).

---

## Session management

- Sessions are stored server-side and encrypted with `DASHBOARD_SESSION_SECRET`.
- The session secret must be at least 32 bytes.
- Sessions are invalidated when the database is reset (boot ID tracking prevents stale session reuse).
- `Session.regenerate()` is called on login to prevent session fixation.
- Rate limiting is applied to the login endpoint: 5 attempts per 15 minutes.

---

## Security features

The dashboard includes several security hardening measures:

- **Protocol validation** — only `http://` and `https://` URLs are accepted for scans
- **Open redirect prevention** — redirect targets are validated against a safe list
- **Rate limiting** — POST endpoints have configurable rate limits (login: 5/15min, scan creation: 10/10min)
- **Input clamping** — concurrency, jurisdiction count, and pagination values are bounded
- **Org isolation** — scans and reports are scoped to the current organization; cross-org access returns 404
- **Permission-based guards** — all routes check `perm.*` flags from the user's role; admin routes require `admin.system` permission and return 403 for unauthorized users

---

## Rebuilding the dashboard

After making changes to dashboard source code, rebuild from the dashboard directory:

```bash
cd /root/pally-agent/packages/dashboard
rm -rf dist/views dist/static
npm run build
```

Always remove `dist/views` and `dist/static` before rebuilding to ensure stale templates and assets are cleared.

---

*See also: [QUICKSTART.md](../QUICKSTART.md) | [scanning.md](scanning.md) | [reports.md](reports.md)*
