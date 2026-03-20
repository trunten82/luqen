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
  "complianceClientId": "",
  "complianceClientSecret": ""
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
| `complianceClientId` | `string` | — | OAuth2 client ID registered in the compliance service |
| `complianceClientSecret` | `string` | — | OAuth2 client secret |
| `pluginsDir` | `string` | `./plugins` | Directory where plugin packages are installed |
| `pluginsConfigFile` | `string` | — | Optional path to a plugins configuration JSON file |

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
| `DASHBOARD_COMPLIANCE_CLIENT_ID` | `complianceClientId` | OAuth2 client ID |
| `DASHBOARD_COMPLIANCE_CLIENT_SECRET` | `complianceClientSecret` | OAuth2 client secret |
| `DASHBOARD_PLUGINS_DIR` | `pluginsDir` | Directory for plugin packages (default: `./plugins`) |
| `DASHBOARD_PLUGINS_CONFIG` | `pluginsConfigFile` | Path to plugins configuration file |
| `DASHBOARD_REDIS_URL` | — | Optional Redis URL for distributed scan queue and SSE pub/sub. |

**Precedence:** Environment variables > `dashboard.config.json` > built-in defaults.

---

## Startup validation

On startup the dashboard validates:

- `sessionSecret` is at least 32 bytes
- `port` is between 1 and 65535
- `maxConcurrentScans` is at least 1
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

The dashboard authenticates via the compliance service's OAuth2 password grant. Before starting the dashboard:

```bash
# Create a dashboard OAuth client
pally-compliance clients create \
  --name "dashboard" \
  --scope "admin" \
  --grant password

# Create at least one user
pally-compliance users create \
  --username admin \
  --role admin \
  --password "your-secure-password"
```

---

## Role reference

| Role | Permissions in dashboard |
|------|--------------------------|
| `viewer` | Browse and view reports, compare reports |
| `user` | viewer + create scans, delete own reports |
| `admin` | user + full admin section (jurisdictions, regulations, users, OAuth clients, webhooks, health) |

---

*See also: [guides/dashboard-admin.md](../guides/dashboard-admin.md) | [installation/docker.md](../installation/docker.md) | [configuration/compliance.md](compliance.md)*
