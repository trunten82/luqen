[Docs](../README.md) > [Configuration](./) > Dashboard

# Dashboard Configuration Reference

`@pally-agent/dashboard` — `dashboard.config.json`, environment variables, and CLI flags.

---

## Config file: `dashboard.config.json`

Place in the working directory where you run `pally-dashboard serve`. All fields are optional except `sessionSecret`.

```json
{
  "port": 5000,
  "complianceUrl": "http://localhost:4000",
  "webserviceUrl": "http://localhost:3000",
  "reportsDir": "./reports",
  "dbPath": "./dashboard.db",
  "sessionSecret": "",
  "maxConcurrentScans": 2,
  "runner": "htmlcs"
}
```

### Field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `5000` | TCP port the server listens on |
| `complianceUrl` | `string` | `http://localhost:4000` | Base URL of the compliance service REST API |
| `webserviceUrl` | `string` | `http://localhost:3000` | Base URL of the pa11y webservice (used in health check only) |
| `reportsDir` | `string` | `./reports` | Directory where JSON and HTML scan reports are written |
| `dbPath` | `string` | `./dashboard.db` | Path to the SQLite database file |
| `sessionSecret` | `string` | — | Secret used to sign session cookies. **Required. Minimum 32 bytes.** |
| `maxConcurrentScans` | `number` | `2` | Maximum number of scans that may run simultaneously |
| `maxPages` | `number` | `50` | Maximum pages to discover and scan in full-site mode (1–1000) |
| `pluginsDir` | `string` | `./plugins` | Directory where plugin packages are installed |
| `pluginsConfigFile` | `string` | — | Optional path to a plugins configuration JSON file |
| `runner` | `"htmlcs" \| "axe"` | `"htmlcs"` | Pa11y test runner. `axe` requires `pa11y-runner-axe` installed on the webservice. |
| `webserviceUrls` | `string[]` | — | Additional pa11y webservice URLs for horizontal scaling. Scans are distributed round-robin across all URLs (including `webserviceUrl`). |

---

## Environment variables

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `DASHBOARD_PORT` | `port` | Server port |
| `DASHBOARD_COMPLIANCE_URL` | `complianceUrl` | Compliance service base URL |
| `DASHBOARD_WEBSERVICE_URL` | `webserviceUrl` | Pa11y webservice URL |
| `DASHBOARD_REPORTS_DIR` | `reportsDir` | Report storage directory |
| `DASHBOARD_DB_PATH` | `dbPath` | SQLite database path |
| `DASHBOARD_SESSION_SECRET` | `sessionSecret` | Cookie signing secret (min 32 bytes) |
| `DASHBOARD_MAX_CONCURRENT_SCANS` | `maxConcurrentScans` | Max parallel scan limit |
| `DASHBOARD_MAX_PAGES` | `maxPages` | Maximum pages per full-site scan (1–1000, default 50) |
| `DASHBOARD_PLUGINS_DIR` | `pluginsDir` | Directory for plugin packages (default: `./plugins`) |
| `DASHBOARD_PLUGINS_CONFIG` | `pluginsConfigFile` | Path to plugins configuration file |
| `DASHBOARD_SCANNER_RUNNER` | `runner` | Pa11y test runner: `htmlcs` or `axe` (default: `htmlcs`) |
| `DASHBOARD_WEBSERVICE_URLS` | `webserviceUrls` | Comma-separated list of additional pa11y webservice URLs for horizontal scaling (round-robin distribution). |
| `DASHBOARD_REDIS_URL` | — | Optional Redis URL for distributed scan queue and SSE pub/sub. |
| `COMPLIANCE_API_KEY` | — | API key for service-to-service calls to the compliance service. Set this on the compliance service side; the dashboard sends it in the `X-API-Key` header when making compliance API requests. |
| `DASHBOARD_API_KEY` | — | API key for the dashboard data API endpoints (`/api/v1/scans`, `/api/v1/trends`, etc.) and CSV export. Clients authenticate by sending `X-API-Key: <key>` in the request header. Generate keys from the admin UI at `/admin/api-keys`. |

**Precedence:** Environment variables > `dashboard.config.json` > built-in defaults.

---

## Startup validation

On startup the dashboard validates:

- `sessionSecret` is at least 32 bytes
- `port` is between 1 and 65535
- `maxConcurrentScans` is at least 1
- `maxPages` is between 1 and 1000
- `complianceUrl` is a valid URL
- `reportsDir` exists and is writable (created if missing)
- `pluginsDir` exists (created if missing)
- `dbPath` parent directory exists and is writable

Any failure exits immediately with a descriptive error message.

---

## CLI reference

### `pally-dashboard serve`

Start the web server.

```bash
pally-dashboard serve [options]

Options:
  -p, --port <number>    Port to listen on
  -c, --config <path>    Path to config file [default: dashboard.config.json]
```

### `pally-dashboard migrate`

Create or update the SQLite schema. Safe to run multiple times.

```bash
pally-dashboard migrate [options]

Options:
  -d, --db-path <path>   Path to SQLite database file
  -c, --config <path>    Path to config file [default: dashboard.config.json]
```

### `pally-dashboard self-audit`

Run an accessibility scan against the dashboard itself and report any issues found. Useful for verifying the dashboard UI meets WCAG standards.

```bash
pally-dashboard self-audit
```

---

## Required setup in the compliance service

The dashboard communicates with the compliance service using an API key for service-to-service calls. Set the `COMPLIANCE_API_KEY` environment variable on the compliance service to enable this. The dashboard sends the key in the `X-API-Key` header.

Authentication for dashboard users is handled locally by the dashboard (see [Authentication Modes](../paths/full-dashboard.md#authentication-modes)) and does not require compliance service user accounts.

---

## Role reference

Roles are now **DB-managed and customizable** via **Admin > Roles** (`/admin/roles`). The four roles below are created as defaults during migration. Admins can modify their permissions or create entirely new roles.

| Role | Default permissions | Default view |
|------|---------------------|-------------|
| `executive` | `reports.view`, `analytics.view` — read-only access to reports, org-wide accessibility score, aggregated trends, and compliance summaries | Org score dashboard |
| `user` | executive defaults + `scans.create`, `scans.view`, `testing.manual`, `reports.delete` — create scans, run manual testing, delete own reports | Report list |
| `developer` | user defaults + `issues.view`, `issues.manage`, `repos.view` — view fix proposals, manage issue assignments, access code diffs | Issue list |
| `admin` | All 15 permissions including `admin.system`, `admin.users`, `admin.roles` — full admin section (jurisdictions, regulations, users, roles, OAuth clients, webhooks, connected repos, schedules, health) | System overview |

### Permission groups

The dashboard uses 15 granular permissions organized into 7 groups:

| Group | Permissions | Description |
|-------|------------|-------------|
| **Scans** | `scans.create`, `scans.view` | Start scans, view scan history |
| **Reports** | `reports.view`, `reports.delete`, `reports.export` | View, delete, and export reports |
| **Issues** | `issues.view`, `issues.manage` | View issues, manage assignments |
| **Testing** | `testing.manual` | Run manual testing checklists |
| **Repositories** | `repos.view`, `repos.manage` | View and manage connected repositories |
| **Analytics** | `analytics.view` | View trends, org score, compliance summaries |
| **Administration** | `admin.system`, `admin.users`, `admin.roles` | System settings, user management, role management |

All templates use `perm.*` flags for authorization checks rather than hardcoded role names.

> **Note:** System roles (the four defaults above) can have their permissions modified but cannot be deleted.

---

*See also: [guides/dashboard-admin.md](../guides/dashboard-admin.md) | [deployment/docker.md](../deployment/docker.md) | [compliance-config.md](compliance-config.md)*
