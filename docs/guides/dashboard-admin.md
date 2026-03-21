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

| Role | Capabilities |
|------|-------------|
| **admin** | Full access. Can manage users, jurisdictions, regulations, webhooks, OAuth clients, and system settings. Can delete any report. |
| **user** | Can start scans, view all reports, and delete their own reports. Cannot access admin pages. |
| **viewer** | Read-only. Can view reports but cannot start scans or delete anything. |

---

## Admin pages

Admin pages are accessible from the sidebar when logged in as an admin user. Each page provides CRUD operations for a specific data type.

### Users

**Path:** `/admin/users`

Manage dashboard user accounts:
- Create new users with username, password, and role
- Edit existing users (change role, reset password)
- Delete users

### Dashboard Users

**Path:** `/admin/dashboard-users`

Manage users specific to the dashboard's local database (separate from compliance service users).

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

View and manage auto-generated fix proposals across scans.

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
- **Admin guard** — admin routes return 403 and halt processing for non-admin users

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
