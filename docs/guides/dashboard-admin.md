[Docs](../README.md) > [Guides](../README.md#how-to-guides) > Dashboard Administration Guide

# Dashboard Administration Guide

How to set up, configure, and administer the luqen dashboard.

---

## Starting the dashboard

The dashboard (`@luqen/dashboard`) is a Fastify web application that provides a browser interface for scanning, viewing reports, and managing compliance data.

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
export DASHBOARD_WEBSERVICE_URL="http://localhost:3000"

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
- Login requires the API key printed at first startup.
- Single-user mode — no user management, no roles.
- Suitable for local development and single-developer setups.

### Team mode (local users)

- Activated when at least one user account is created.
- Login with username and password (primary) or API key (fallback — available under "Sign in with API key" on the login page).
- Supports user roles (see below).
- Suitable for small teams sharing a dashboard instance.

### Enterprise mode (OAuth/SSO)

- Activated when an SSO plugin is installed (e.g., `@luqen/plugin-auth-entra` for Microsoft Entra ID).
- Login redirects to the identity provider.
- Password and API key fallback methods are available under collapsible sections on the login page.
- User roles can be mapped from SSO claims.
- Suitable for organisations with existing identity infrastructure.

> **API key login** is always available in all modes. In team and enterprise mode, it appears as a collapsible section on the login page. API key login always grants admin access.

---

## User roles

The dashboard supports four default role-based personas, each with tailored navigation and default views. Roles are **DB-managed** — admins can modify permissions on existing roles or create entirely new custom roles via **Admin > Roles**.

| Role | Default view | Default capabilities |
|------|-------------|-------------|
| **admin** | System overview | All 15 permissions. Manage users, roles, jurisdictions, regulations, webhooks, OAuth clients, connected repos, schedules, and system settings. Can delete any report. |
| **developer** | Issue list | View fix proposals and code diffs, manage assignment queue, start scans, delete own reports. Cannot access admin settings. |
| **user** | Report list | Start scans, view all reports, run manual testing checklists, delete own reports. Cannot access admin pages. |
| **executive** | Org score dashboard | Read-only. View org-wide accessibility score (0-100), aggregated trends, and compliance summaries. Cannot start scans or modify data. |

> **Note:** The dashboard distinguishes between **Dashboard Users** (accounts that log in to the web UI, managed at `/admin/users`) and **API Users (Compliance)** (accounts on the compliance service used for direct API access, managed via `luqen-compliance users create`). These are separate user stores.

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
| **Scans** | `scans.create`, `scans.schedule` |
| **Reports** | `reports.view`, `reports.view_technical`, `reports.export`, `reports.delete`, `reports.compare` |
| **Issues** | `issues.assign`, `issues.fix` |
| **Testing** | `manual_testing` |
| **Repositories** | `repos.manage` |
| **Analytics** | `trends.view` |
| **User Management** | `users.create`, `users.delete`, `users.activate`, `users.reset_password`, `users.roles` |
| **Administration** | `admin.users` (compliance API users), `admin.roles`, `admin.system` |

All dashboard templates use `perm.*` flags for authorization rather than hardcoded role name checks, so custom roles work seamlessly throughout the UI.

> **v1.0.0 note:** User management actions (create, delete, activate, reset password, change role) are now governed by individual `users.*` permissions instead of the blanket `admin` role check. This allows fine-grained delegation of user management tasks to non-admin roles.

### Dashboard Users

**Path:** `/admin/dashboard-users`

Manage Dashboard Users — accounts that log in to the web UI (separate from API Users on the compliance service).

Each user row provides:

- **Role selector** — change the user's role via a dropdown (active users only)
- **Deactivate** — prevent the user from logging in (preserves the user record)
- **Activate** — restore login access for a deactivated user
- **Reset Password** — open a modal to set a new password for the user (admin sets it directly; no email/token flow)
- **Delete** — permanently remove the user. Requires confirmation. Historical references (e.g., issue assignments created by the user) remain intact as plain text but the login account is gone

Each action is gated by a specific permission scope:

| Action | Permission |
|--------|-----------|
| View user list | Any `users.*` permission |
| Add User | `users.create` |
| Change role | `users.roles` |
| Activate / Deactivate | `users.activate` |
| Reset Password | `users.reset_password` |
| Delete | `users.delete` |

The `admin` role and API key sessions receive all `users.*` permissions by default. Custom roles can be granted individual user management permissions for delegation (e.g., a "team lead" role with only `users.activate` and `users.reset_password`).

**Self-service profile:** All authenticated users can view their profile and change their own password at `/account`, regardless of permissions. This is a built-in policy, not a permission scope.

### Teams

**Path:** `/admin/teams`

Manage teams for collaborative issue assignment:

- **Create a team** — click **New Team**, enter a name and optional description.
- **View team members** — click a team to see its current members.
- **Add members** — use the user picker dropdown to search and add dashboard users to the team.
- **Remove members** — click **Remove** next to a member, confirm the removal.
- **IdP group mapping** — when SSO is active (e.g., Azure Entra ID), you can map an IdP group to a dashboard team. Members of the IdP group are automatically added to the team on login. Configure mappings by entering the IdP group ID or name in the team settings.
- **Delete a team** — removes the team and clears all its assignments (issues return to Open status).

Teams appear alongside individual users in the assignee dropdown when assigning issues.

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

Plugin management is role-based — global admins and org admins have different capabilities.

#### Global admin: installing and managing plugins

1. Navigate to **Admin > Plugins** and open the **Plugin Catalogue** tab
2. Browse available plugins and click **Install** to download from the catalogue
3. Open the installed plugin and configure its **global default settings** (e.g., SMTP host, webhook URL)
4. Click **Save**, then **Activate** to make the plugin available system-wide
5. Optionally, enforce activation for specific organisations from the plugin's **Org Usage** panel

Global admins can also view which organisations have activated each plugin and deactivate or remove plugins globally.

#### Org admin: activating plugins for your organisation

1. Navigate to **Admin > Plugins** — you see all globally installed plugins
2. Click **Activate** on any plugin to enable it for your organisation
3. The plugin inherits global default configuration automatically
4. To customise settings for your org, open the plugin and override specific fields — non-overridden values fall back to the global defaults
5. Click **Deactivate** to disable a plugin for your org without affecting other organisations

Org admins cannot install, remove, or modify global plugin settings.

For a comprehensive guide to all available plugins with their configuration fields and setup instructions, see [Plugin Configuration Guide](../reference/plugin-guide.md).

### System

**Path:** `/admin/system`

View system health information:
- Service connectivity (compliance service, pa11y webservice)
- Storage adapter status (currently SQLite; PostgreSQL and MongoDB adapters coming as plugins)
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

### Email Reports

**Path:** `/admin/email-reports`

Configure scheduled email delivery of accessibility reports.

> **v0.18.0:** Email reports is now powered by the `@luqen/plugin-notify-email` plugin. Install and activate it from **Admin > Plugins** before creating email schedules. SMTP configuration has moved from the dashboard database to the plugin's config panel at **Admin > Plugins**. The legacy `smtp_config` table still works as a fallback if the plugin is not installed.

#### Prerequisites

1. Go to **Admin > Plugins** and install `@luqen/plugin-notify-email`
2. Configure SMTP settings in the plugin config (host, port, TLS, credentials, from address)
3. Activate the plugin — a health check verifies SMTP connectivity
4. Return to **Admin > Email Reports** to create schedules

The plugin also supports event notifications (`scan.complete`, `scan.failed`) in addition to scheduled report delivery.

#### SMTP configuration (plugin)

Configure SMTP in the plugin settings at **Admin > Plugins > Email Notifications**:

| Field | Description |
|-------|-------------|
| **Host** | SMTP server hostname (e.g., `smtp.example.com`) |
| **Port** | SMTP port (typically 587 for STARTTLS, 465 for implicit TLS) |
| **TLS** | Enable TLS encryption |
| **Username** | SMTP authentication username |
| **Password** | SMTP authentication password |
| **From address** | Sender address for outgoing reports |

The plugin runs a connectivity health check on activation. Credentials are encrypted with AES-256-GCM in the plugin config store.

#### Creating a schedule

Click **New Email Report** and fill in:

| Field | Description |
|-------|-------------|
| **Name** | A label for this schedule (e.g., "Weekly staging report") |
| **Site URL** | The site to report on (must have existing scan data) |
| **Recipients** | One or more email addresses (comma-separated) |
| **Frequency** | Daily, weekly, or monthly |
| **Format** | PDF, CSV, or both |

#### Format options

- **PDF** — uses the same print template as the browser PDF export, attached to the email.
- **CSV** — uses the same export logic as the Data API CSV endpoints, attached to the email.
- **Both** — attaches both PDF and CSV files.

The email body contains an inline-styled HTML summary with KPI metrics (errors, warnings, notices, compliance status).

#### Managing schedules

Each schedule row provides:

- **Enable / Disable** toggle — pause delivery without deleting the schedule
- **Send Now** — trigger an immediate send outside the normal schedule
- **Delete** — remove the schedule permanently

The dashboard uses [nodemailer](https://nodemailer.com/) (MIT licensed) for SMTP delivery.

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

## Setup API (admin recovery)

The dashboard exposes a JSON API endpoint for creating dashboard users via API key, useful for bootstrapping the first admin user or recovering admin access when locked out.

### `POST /api/v1/setup`

**Authentication:** API key via `Authorization: Bearer <key>` or `X-API-Key` header (not session-based).

**Request body (JSON):**

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `username` | Yes | — | Username for the new user |
| `password` | Yes | — | Password (minimum 8 characters) |
| `role` | No | `admin` | Role: `viewer`, `user`, `developer`, `admin`, or `executive` |

**Example:**

```bash
curl -X POST http://localhost:5000/api/v1/setup \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "SecurePass123!", "role": "admin"}'
```

**Response (201):**

```json
{
  "message": "User \"admin\" created with role \"admin\".",
  "user": { "id": "uuid", "username": "admin", "role": "admin" }
}
```

**Error responses:**

| Code | Reason |
|------|--------|
| 400 | Missing username/password, password < 8 chars, invalid role |
| 401 | API key missing or invalid |
| 409 | Username already exists |

---

## My Profile

**Path:** `/account`

Every logged-in user can access their profile page by clicking their username in the sidebar footer.

The profile page shows:

- **Account details** — username, role, authentication method
- **Change password** — self-service password change (only for password-based accounts)

API key and SSO users see an informational message explaining that password changes are managed elsewhere.

### Changing your password

1. Navigate to `/account` (click your username in the sidebar)
2. Enter your current password
3. Enter and confirm a new password (minimum 8 characters)
4. Click **Change Password**

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
cd packages/dashboard
rm -rf dist/views dist/static
npm run build
```

Always remove `dist/views` and `dist/static` before rebuilding to ensure stale templates and assets are cleared.

---

*See also: [QUICKSTART.md](../QUICKSTART.md) | [scanning.md](scanning.md) | [reports.md](reports.md)*
