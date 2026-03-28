[Docs](../README.md) > [Configuration](./) > Dashboard

# Dashboard Configuration Reference

`@luqen/dashboard` — `dashboard.config.json`, environment variables, and CLI flags.

---

## Config file: `dashboard.config.json`

Place in the working directory where you run `luqen-dashboard serve`. All fields are optional except `sessionSecret`.

```json
{
  "port": 5000,
  "complianceUrl": "http://localhost:4000",
  "webserviceUrl": "",
  "reportsDir": "./reports",
  "dbPath": "./dashboard.db",
  "sessionSecret": "",
  "maxConcurrentScans": 2,
  "runner": "htmlcs",
  "complianceClientId": "",
  "complianceClientSecret": "",
  "catalogueUrl": "https://github.com/trunten82/luqen-plugins",
  "catalogueCacheTtl": 3600
}
```

### Field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `5000` | TCP port the server listens on |
| `complianceUrl` | `string` | `http://localhost:4000` | Base URL of the compliance service REST API |
| `webserviceUrl` | `string` | — | **Optional.** Base URL of an external pa11y webservice. When omitted, the dashboard uses the built-in pa11y scanner directly. Set this only if you have an existing pa11y-webservice deployment you want to reuse. |
| `reportsDir` | `string` | `./reports` | Directory where JSON and HTML scan reports are written |
| `dbPath` | `string` | `./dashboard.db` | Path to the SQLite database file (used by the SQLite storage adapter) |
| `sessionSecret` | `string` | — | Secret used to sign session cookies. **Required. Minimum 32 bytes.** |
| `maxConcurrentScans` | `number` | `2` | Maximum number of scans that may run simultaneously |
| `maxPages` | `number` | `50` | Maximum pages to discover and scan in full-site mode (1–1000) |
| `pluginsDir` | `string` | `./plugins` | Directory where plugin packages are installed |
| `pluginsConfigFile` | `string` | — | Optional path to a plugins configuration JSON file |
| `runner` | `"htmlcs" \| "axe"` | `"htmlcs"` | Pa11y test runner. `axe` requires `pa11y-runner-axe` installed locally (or on the external webservice if `webserviceUrl` is set). |
| `webserviceUrls` | `string[]` | — | **Optional.** Additional pa11y webservice URLs for horizontal scaling. Only relevant when `webserviceUrl` is set. Scans are distributed round-robin across all URLs (including `webserviceUrl`). |
| `complianceClientId` | `string` | — | OAuth2 client ID for auto-refreshing compliance service tokens via `client_credentials` grant. When set together with `complianceClientSecret`, manual token management is not required. |
| `complianceClientSecret` | `string` | — | OAuth2 client secret paired with `complianceClientId`. Store securely; use `DASHBOARD_COMPLIANCE_CLIENT_SECRET` env var in production. |
| `catalogueUrl` | `string` | `https://github.com/trunten82/luqen-plugins` | Base URL of the remote plugin catalogue GitHub repository. The dashboard fetches `catalogue.json` from GitHub releases at this URL. |
| `catalogueCacheTtl` | `number` | `3600` | Time-to-live in seconds for the cached plugin catalogue. The dashboard re-fetches `catalogue.json` from GitHub after this interval. Set to `0` to disable caching. |

---

## Environment variables

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `DASHBOARD_PORT` | `port` | Server port |
| `DASHBOARD_COMPLIANCE_URL` | `complianceUrl` | Compliance service base URL |
| `DASHBOARD_WEBSERVICE_URL` | `webserviceUrl` | **Optional.** External pa11y webservice URL. Omit to use the built-in scanner. |
| `DASHBOARD_REPORTS_DIR` | `reportsDir` | Report storage directory |
| `DASHBOARD_DB_PATH` | `dbPath` | SQLite database path |
| `DASHBOARD_SESSION_SECRET` | `sessionSecret` | Cookie signing secret (min 32 bytes) |
| `DASHBOARD_MAX_CONCURRENT_SCANS` | `maxConcurrentScans` | Max parallel scan limit |
| `DASHBOARD_MAX_PAGES` | `maxPages` | Maximum pages per full-site scan (1–1000, default 50) |
| `DASHBOARD_PLUGINS_DIR` | `pluginsDir` | Directory for plugin packages (default: `./plugins`) |
| `DASHBOARD_PLUGINS_CONFIG` | `pluginsConfigFile` | Path to plugins configuration file |
| `DASHBOARD_SCANNER_RUNNER` | `runner` | Pa11y test runner: `htmlcs` or `axe` (default: `htmlcs`) |
| `DASHBOARD_WEBSERVICE_URLS` | `webserviceUrls` | **Optional.** Comma-separated list of additional pa11y webservice URLs for horizontal scaling. Only relevant when `DASHBOARD_WEBSERVICE_URL` is set. |
| `DASHBOARD_CATALOGUE_URL` | `catalogueUrl` | Base URL of the remote plugin catalogue GitHub repository (default: `https://github.com/trunten82/luqen-plugins`). |
| `DASHBOARD_CATALOGUE_CACHE_TTL` | `catalogueCacheTtl` | Plugin catalogue cache TTL in seconds (default: `3600`). |
| `DASHBOARD_REDIS_URL` | — | Optional Redis URL for distributed scan queue and SSE pub/sub. |
| `COMPLIANCE_API_KEY` | — | API key for service-to-service calls to the compliance service. Set this on the compliance service side; the dashboard sends it in the `X-API-Key` header when making compliance API requests. |
| `DASHBOARD_API_KEY` | — | API key for the dashboard data API endpoints (`/api/v1/scans`, `/api/v1/trends`, etc.) and Excel/CSV export. Clients authenticate by sending `X-API-Key: <key>` in the request header. Generate keys from the admin UI at `/admin/api-keys`. |

**SMTP configuration:** Email report settings (host, port, TLS, credentials, from address) are managed entirely through the dashboard UI at **Admin > Email Reports**. No environment variables or config file entries are needed — credentials are stored in the dashboard database.

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

## Storage adapter

The dashboard uses a **StorageAdapter** architecture for all database operations. The storage adapter abstracts 14 domain repositories behind a unified interface, making the underlying database engine swappable:

`scans`, `users`, `organizations`, `schedules`, `assignments`, `repos`, `roles`, `teams`, `email`, `audit`, `plugins`, `apiKeys`, `pageHashes`, `manualTests`

Repository interfaces are defined in `packages/dashboard/src/db/interfaces/`. All routes and services consume these interfaces — never a concrete database implementation.

### Current adapters

| Adapter | Package | Status |
|---------|---------|--------|
| **SQLite** | Built-in | Default — no configuration needed |
| **PostgreSQL** | `@luqen/plugin-storage-postgres` | Coming soon |
| **MongoDB** | `@luqen/plugin-storage-mongodb` | Coming soon |

### SQLite (default)

SQLite is the built-in default storage adapter. It requires no external database server and stores all data in a single file specified by `dbPath`. This is ideal for single-server deployments, development, and small teams.

No additional configuration is needed — the dashboard uses SQLite automatically when no storage plugin is installed.

### Future storage plugins

When Postgres or MongoDB storage plugins become available, they will be installable via **Admin > Plugins** like any other plugin. The dashboard will use `resolveStorageAdapter()` to select the appropriate backend based on the active storage plugin configuration. The `dbPath` setting is specific to the SQLite adapter and will not apply when using an external database.

---

## CLI reference

### `luqen-dashboard serve`

Start the web server.

```bash
luqen-dashboard serve [options]

Options:
  -p, --port <number>    Port to listen on
  -c, --config <path>    Path to config file [default: dashboard.config.json]
```

### `luqen-dashboard migrate`

Run database migrations for the active storage adapter. Currently applies SQLite schema migrations. Safe to run multiple times.

```bash
luqen-dashboard migrate [options]

Options:
  -d, --db-path <path>   Path to SQLite database file
  -c, --config <path>    Path to config file [default: dashboard.config.json]
```

### `luqen-dashboard self-audit`

Run an accessibility scan against the dashboard itself and report any issues found. Useful for verifying the dashboard UI meets WCAG standards.

```bash
luqen-dashboard self-audit
```

---

## Compliance service integration

The dashboard calls the compliance service API for jurisdictions, regulations, and compliance checks. Authentication is handled automatically:

1. **Auto-refresh (recommended):** When `complianceClientId` and `complianceClientSecret` are set in the dashboard config, the dashboard obtains an OAuth token via `client_credentials` grant and refreshes it automatically before expiry. No manual token setup needed.

2. **Manual token (fallback):** Set `DASHBOARD_COMPLIANCE_API_KEY` to a valid OAuth token. This token will expire and must be refreshed manually.

3. **Per-org tokens (v2.1.0):** Organizations can configure their own `complianceClientId` and `complianceClientSecret` via the organization admin UI. When a user with an org context makes a request, the dashboard uses the org-specific token. If no org-specific credentials are configured, the global token is used as a fallback. Per-org tokens are cached independently via per-org `ServiceTokenManager` instances.

4. **No compliance service:** If the compliance service is unreachable, the dashboard still works but jurisdiction/regulation features are unavailable.

---

## Role reference

Roles are now **DB-managed and customizable** via **Admin > Roles** (`/admin/roles`). The four roles below are created as defaults during migration. Admins can modify their permissions or create entirely new roles. Users can also be organised into **teams** at **Admin > Teams** (`/admin/teams`) — teams are used for issue assignment and can be synced with IdP groups when SSO is active.

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
