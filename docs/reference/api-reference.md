[Docs](../README.md) > [Integrations](./) > API Reference

# REST API Quick Reference

All endpoints for `@luqen/compliance`. Base URL: `http://localhost:4000/api/v1`

Authentication: `Authorization: Bearer <token>` on all endpoints except `/health` and `/oauth/token`.

Full interactive docs: `http://localhost:4000/docs` (Swagger UI).

---

## Authentication

### `POST /oauth/token`

Obtain an access token.

```bash
curl -X POST http://localhost:4000/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_SECRET",
    "scope": "read"
  }'
```

Response: `{ "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600 }`

### `POST /oauth/revoke`

Revoke a token (best-effort for stateless JWTs). Requires Bearer token.

### `GET /oauth/jwks`

JWKS public key endpoint for token verification.

---

## Health

### `GET /health`

No auth required.

Response: `{ "status": "ok", "version": "0.1.0", "timestamp": "..." }`

---

## Compliance Check

### `POST /compliance/check` — `read` scope

Check pa11y issues against jurisdiction legal requirements.

```bash
curl -X POST http://localhost:4000/api/v1/compliance/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jurisdictions": ["EU", "US"],
    "issues": [
      {
        "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
        "type": "error",
        "message": "Img element missing an alt attribute.",
        "selector": "img#hero",
        "context": "<img id=\"hero\" src=\"hero.jpg\">"
      }
    ],
    "includeOptional": false,
    "sectors": []
  }'
```

Response: `{ "matrix": {...}, "annotatedIssues": [...], "summary": {...} }`

Accepts request bodies up to 10 MB to accommodate large site scans.

---

## Jurisdictions

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/jurisdictions` | `read` | List all (filters: `?type=`, `?parentId=`) |
| `GET` | `/jurisdictions/:id` | `read` | Get one with regulation count |
| `POST` | `/jurisdictions` | `write` | Create |
| `PATCH` | `/jurisdictions/:id` | `write` | Partial update |
| `DELETE` | `/jurisdictions/:id` | `admin` | Delete (cascades to regulations) |

---

## Regulations

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/regulations` | `read` | List all (filters: `?jurisdictionId=`, `?status=`, `?scope=`) |
| `GET` | `/regulations/:id` | `read` | Get one with requirements |
| `POST` | `/regulations` | `write` | Create |
| `PATCH` | `/regulations/:id` | `write` | Partial update |
| `DELETE` | `/regulations/:id` | `admin` | Delete (cascades to requirements) |

---

## Requirements

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/requirements` | `read` | List all (filters: `?regulationId=`, `?wcagCriterion=`, `?obligation=`) |
| `GET` | `/requirements/:id` | `read` | Get one |
| `POST` | `/requirements` | `write` | Create |
| `PATCH` | `/requirements/:id` | `write` | Partial update |
| `DELETE` | `/requirements/:id` | `admin` | Delete |
| `POST` | `/requirements/bulk` | `admin` | Bulk import |

---

## Update Proposals

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/updates` | `read` | List proposals (filter: `?status=pending\|approved\|rejected`) |
| `GET` | `/updates/:id` | `read` | Get one with full diff |
| `POST` | `/updates/propose` | `write` | Submit a proposed change |
| `PATCH` | `/updates/:id/approve` | `admin` | Approve and apply |
| `PATCH` | `/updates/:id/reject` | `admin` | Reject |

---

## Monitored Sources

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/sources` | `read` | List all monitored sources |
| `POST` | `/sources` | `admin` | Add a source |
| `DELETE` | `/sources/:id` | `admin` | Remove a source |
| `POST` | `/sources/scan` | `admin` | Trigger synchronous scan of all sources |

---

## Seed

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `POST` | `/seed` | `admin` | Load baseline dataset (idempotent) |
| `GET` | `/seed/status` | `read` | Check baseline data counts |

---

## Webhooks

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/webhooks` | `admin` | List all registered webhooks |
| `POST` | `/webhooks` | `admin` | Register a webhook |
| `DELETE` | `/webhooks/:id` | `admin` | Remove a webhook |

Webhook events: `update.proposed`, `update.approved`, `update.rejected`, `source.scanned`, `regulation.created`, `regulation.updated`

Signature verification: `X-Webhook-Signature: sha256=<hmac-sha256-of-body>`

---

## A2A Task Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/.well-known/agent.json` | Agent card (no auth) |
| `POST` | `/a2a/tasks` | Submit a task |
| `GET` | `/a2a/tasks/:id` | Get task status and result |
| `GET` | `/a2a/tasks/:id/stream` | SSE stream for progress |
| `GET` | `/a2a/agents` | List known peer agents |

---

## Dashboard Scan API

Base URL: `http://localhost:5000` (dashboard service). Requires user authentication via session cookie.

All dashboard endpoints respect the user's permission set (derived from their assigned role). For example, `POST /scan/new` requires the `scans.create` permission, report endpoints require `reports.view`, and all `/admin/*` endpoints require the `admin.system` permission. See the [Role reference](dashboard-config.md#role-reference) for the full permission matrix.

### `POST /scan/new`

Start a new accessibility scan.

Parameters:

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Target URL (required, must be `http` or `https`) |
| `scanMode` | `string` | `single` or `site` (default: `site` for API, `single` for dashboard UI) |
| `standard` | `string` | `WCAG2A`, `WCAG2AA` (default), or `WCAG2AAA` |
| `jurisdictions` | `string[]` | Jurisdiction codes for compliance enrichment (max 50) |
| `concurrency` | `number` | Pages to scan in parallel (1-10) |

Rate limited: 10 requests per 10 minutes per session.

---

## Dashboard Plugin API

Base URL: `http://localhost:5000` (dashboard service). All plugin endpoints require the `admin.system` permission via session cookie.

### `GET /api/v1/plugins`

List installed plugins. Returns an array of plugin records with masked secrets.

Response: `[{ "id": "...", "packageName": "...", "type": "auth", "version": "1.0.0", "config": {...}, "status": "active", "installedAt": "...", "activatedAt": "..." }]`

### `GET /api/v1/plugins/registry`

List all plugins available in the registry. Each entry includes an `installed` boolean.

Response: `[{ "name": "auth-entra", "displayName": "Azure Entra ID", "type": "auth", "version": "1.0.0", "description": "...", "packageName": "...", "icon": "entra", "installed": false }]`

### `POST /api/v1/plugins/install`

Install a plugin from the registry.

Request: `{ "packageName": "@luqen/plugin-notify-slack" }`

Response (201): `{ "id": "...", "packageName": "...", "type": "notification", "version": "1.0.0", "config": {}, "status": "inactive", "installedAt": "..." }`

Errors: `400` if packageName missing or not in registry, `500` on install failure.

### `PATCH /api/v1/plugins/:id/config`

Update plugin configuration. Secret fields are encrypted with AES-256-GCM before storage.

Request: `{ "config": { "webhookUrl": "https://...", "channel": "#a11y" } }`

Response: `{ "id": "...", "packageName": "...", "config": {...}, "status": "inactive", ... }`

Errors: `400` if config missing, `404` if plugin not found.

### `POST /api/v1/plugins/:id/activate`

Activate an installed plugin. Loads the plugin module, calls `activate()`, and starts health checks.

Response: `{ "id": "...", "status": "active", "activatedAt": "...", ... }`

Errors: `404` if not found, `500` on activation failure (status set to `error`).

### `POST /api/v1/plugins/:id/deactivate`

Deactivate a running plugin. Calls `deactivate()` and stops health checks.

Response: `{ "id": "...", "status": "inactive", ... }`

Errors: `404` if not found.

### `DELETE /api/v1/plugins/:id`

Remove an installed plugin. Deactivates first if active, deletes the database record and package files.

Response: `204 No Content`

Errors: `404` if not found.

### `GET /api/v1/plugins/:id/health`

Check health of an active plugin.

Response: `{ "ok": true }` or `{ "ok": false, "message": "Health check failed (2/3)" }`

After 3 consecutive failures, the plugin is marked `unhealthy` (or auto-deactivated if `autoDeactivateOnFailure` is set).

Errors: `404` if not found.

---

## Pagination

All list endpoints support: `?limit=50&offset=0` (defaults shown, max limit: 200).

Response envelope:
```json
{ "data": [...], "total": 100, "limit": 50, "offset": 0 }
```

---

## Scope reference

| Scope | Access |
|-------|--------|
| `read` | All GETs, `POST /compliance/check`, `GET /seed/status` |
| `write` | Create/update jurisdictions, regulations, requirements, propose updates |
| `admin` | All write + approve/reject proposals, manage sources/webhooks, seed, delete, manage OAuth clients |

---

## Multi-Tenancy Headers

### `X-Org-Id`

Optional header sent on all `/api/v1/*` requests. Defaults to `"system"` when omitted.

When present, the header scopes all CRUD operations (jurisdictions, regulations, requirements, compliance checks, etc.) to the specified organization. Records created under an org are only visible to requests carrying the same `X-Org-Id`.

```bash
curl -H "Authorization: Bearer $TOKEN" \
     -H "X-Org-Id: acme-corp" \
     http://localhost:4000/api/v1/jurisdictions
```

System-level seed data (org_id = `"system"`) is readable by all organizations but cannot be modified through org-scoped requests.

---

## Organization Data Cleanup

### `DELETE /api/v1/orgs/:id/data` — `admin` scope

Remove all data belonging to a specific organization. Use this when decommissioning an org.

- Returns `204 No Content` on success.
- Returns `400 Bad Request` if `:id` is `"system"` (system data cannot be bulk-deleted).

```bash
curl -X DELETE http://localhost:4000/api/v1/orgs/acme-corp/data \
  -H "Authorization: Bearer $TOKEN"
```

---

## Dashboard API — Organization Management

Base URL: `http://localhost:5000` (dashboard service). All organization endpoints require the `admin.system` permission via session cookie.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/organizations` | List all organizations (HTML page) |
| `POST` | `/admin/organizations` | Create a new organization |
| `POST` | `/admin/organizations/:id/delete` | Delete an organization |
| `GET` | `/admin/organizations/:id/members` | List members of an organization |
| `POST` | `/admin/organizations/:id/members` | Add a member to an organization |
| `POST` | `/admin/organizations/:id/members/:userId/remove` | Remove a member from an organization |
| `POST` | `/orgs/switch` | Switch the active organization context for the current session |
| `GET` | `/orgs/current` | Get the current organization context (JSON response) |

---

## Dashboard Data API

Base URL: `http://localhost:5000/api/v1` (dashboard service).

These read-only endpoints expose scan data as JSON for external consumption (Power BI, custom integrations, reporting tools). They are separate from the compliance service API above.

### Authentication

All data API endpoints require an API key passed in the `X-API-Key` header.

To obtain an API key:

1. Log in to the dashboard as an admin.
2. Go to **Settings > API Keys** (`/admin/api-keys`).
3. Click **Generate Key** and copy the value.

```bash
# All examples below use this header
export LUQEN_API_KEY="your-api-key-here"
```

### Rate limiting

All data API endpoints are rate limited to **60 requests per minute** per API key. Exceeding the limit returns `429 Too Many Requests` with a `Retry-After` header.

---

### `GET /api/v1/scans`

List scans with optional filters. Returns paginated results.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `siteUrl` | string | Filter by site URL (exact match) |
| `from` | string | Start date (ISO 8601, e.g. `2026-01-01`) |
| `to` | string | End date (ISO 8601) |
| `limit` | number | Results per page (default: 20, max: 100) |
| `offset` | number | Skip N results (default: 0) |

**Example request:**

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/scans?siteUrl=https://example.com&from=2026-01-01&limit=10"
```

**Example response:**

```json
{
  "data": [
    {
      "id": "abc123",
      "siteUrl": "https://example.com",
      "scanMode": "site",
      "status": "completed",
      "standard": "WCAG2AA",
      "pagesScanned": 12,
      "totalIssues": 47,
      "errors": 8,
      "warnings": 15,
      "notices": 24,
      "createdAt": "2026-03-15T10:30:00Z",
      "completedAt": "2026-03-15T10:32:45Z"
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

---

### `GET /api/v1/scans/:id`

Get full detail for a single scan.

**Example request:**

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/scans/abc123"
```

**Example response:**

```json
{
  "id": "abc123",
  "siteUrl": "https://example.com",
  "scanMode": "site",
  "status": "completed",
  "standard": "WCAG2AA",
  "runner": "htmlcs",
  "pagesScanned": 12,
  "totalIssues": 47,
  "errors": 8,
  "warnings": 15,
  "notices": 24,
  "jurisdictions": ["EU", "US"],
  "compliance": {
    "EU": { "status": "fail", "mandatoryViolations": 3 },
    "US": { "status": "fail", "mandatoryViolations": 5 }
  },
  "createdAt": "2026-03-15T10:30:00Z",
  "completedAt": "2026-03-15T10:32:45Z"
}
```

---

### `GET /api/v1/scans/:id/issues`

Get issues for a specific scan with optional severity and criterion filters.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `severity` | string | Filter by severity: `error`, `warning`, or `notice` |
| `criterion` | string | Filter by WCAG criterion (e.g. `1.1.1`) |
| `limit` | number | Results per page (default: 50, max: 200) |
| `offset` | number | Skip N results (default: 0) |

**Example request:**

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/scans/abc123/issues?severity=error&limit=20"
```

**Example response:**

```json
{
  "data": [
    {
      "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "type": "error",
      "message": "Img element missing an alt attribute.",
      "selector": "html > body > header > img",
      "context": "<img src=\"logo.svg\">",
      "wcagCriterion": "1.1.1",
      "wcagTitle": "Non-text Content",
      "pageUrl": "https://example.com/",
      "regulations": [
        { "shortName": "EAA", "obligation": "mandatory", "jurisdictionId": "EU" }
      ]
    }
  ],
  "total": 8,
  "limit": 20,
  "offset": 0
}
```

---

### `GET /api/v1/scans/:id/fixes`

Get AI-generated fix proposals for a scan. Requires connected repos to be configured.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by proposal status: `pending`, `applied`, `dismissed` |
| `limit` | number | Results per page (default: 50, max: 200) |
| `offset` | number | Skip N results (default: 0) |

**Example request:**

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/scans/abc123/fixes?status=pending"
```

**Example response:**

```json
{
  "data": [
    {
      "id": "fix-001",
      "scanId": "abc123",
      "issueCode": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "wcagCriterion": "1.1.1",
      "repo": "github.com/org/frontend",
      "filePath": "src/components/Header.tsx",
      "lineRange": [12, 12],
      "diff": "- <img src=\"logo.svg\">\n+ <img src=\"logo.svg\" alt=\"Company logo\">",
      "status": "pending",
      "createdAt": "2026-03-15T10:33:00Z"
    }
  ],
  "total": 21,
  "limit": 50,
  "offset": 0
}
```

---

### `GET /api/v1/trends`

Time-series data showing issue counts per site across scans. Use this to build trend charts in Power BI or other tools.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `siteUrl` | string | Filter to a specific site URL |
| `from` | string | Start date (ISO 8601) |
| `to` | string | End date (ISO 8601) |

**Example request:**

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/trends?siteUrl=https://example.com"
```

**Example response:**

```json
{
  "data": [
    {
      "siteUrl": "https://example.com",
      "scanId": "abc123",
      "scanDate": "2026-03-15T10:30:00Z",
      "errors": 8,
      "warnings": 15,
      "notices": 24,
      "pagesScanned": 12
    },
    {
      "siteUrl": "https://example.com",
      "scanId": "def456",
      "scanDate": "2026-03-08T10:30:00Z",
      "errors": 12,
      "warnings": 18,
      "notices": 30,
      "pagesScanned": 12
    }
  ]
}
```

---

### `GET /api/v1/compliance-summary`

Latest compliance status per jurisdiction across all sites (or for a specific site). Useful for executive dashboards.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `siteUrl` | string | Filter to a specific site URL |

**Example request:**

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/compliance-summary"
```

**Example response:**

```json
{
  "data": [
    {
      "siteUrl": "https://example.com",
      "scanId": "abc123",
      "scanDate": "2026-03-15T10:30:00Z",
      "jurisdictions": {
        "EU": { "status": "fail", "mandatoryViolations": 3 },
        "US": { "status": "fail", "mandatoryViolations": 5 },
        "UK": { "status": "pass", "mandatoryViolations": 0 }
      }
    }
  ]
}
```

---

## CSV Export

Download scan data as CSV files for use in spreadsheets, Power BI, or other tools. All CSV endpoints require the same `X-API-Key` authentication.

### `GET /api/v1/export/scans.csv`

Download a CSV of all scans (same filters as `GET /api/v1/scans`).

**Query parameters:** `siteUrl`, `from`, `to`, `limit`, `offset` (same as the scans endpoint).

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/export/scans.csv" -o scans.csv
```

**Columns:** `id`, `siteUrl`, `scanMode`, `status`, `standard`, `pagesScanned`, `totalIssues`, `errors`, `warnings`, `notices`, `createdAt`, `completedAt`

### `GET /api/v1/export/scans/:id/issues.csv`

Download a CSV of all issues for a specific scan.

**Query parameters:** `severity`, `criterion` (same as the issues endpoint).

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/export/scans/abc123/issues.csv" -o issues.csv
```

**Columns:** `code`, `type`, `message`, `selector`, `context`, `wcagCriterion`, `wcagTitle`, `pageUrl`, `regulations`

### `GET /api/v1/export/trends.csv`

Download a CSV of trend data across scans.

**Query parameters:** `siteUrl`, `from`, `to` (same as the trends endpoint).

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/export/trends.csv" -o trends.csv
```

**Columns:** `siteUrl`, `scanId`, `scanDate`, `errors`, `warnings`, `notices`, `pagesScanned`

### CSV download buttons in the UI

The dashboard provides download buttons for CSV export:

- **Reports list** (`/reports`) — download button exports the scans list as CSV
- **Report detail** (`/reports/:id`) — download button exports the scan's issues as CSV
- **Trends page** (`/reports/trends`) — download button exports trend data as CSV

---

## Power BI Integration

Connect Power BI to the luqen data API to build accessibility dashboards and compliance reports.

### Step 1: Get your API key

1. Log in to the dashboard as an admin.
2. Go to **Settings > API Keys** (`/admin/api-keys`).
3. Generate a key and copy it.

### Step 2: Add a Web data source in Power BI

1. Open Power BI Desktop.
2. Click **Get Data > Web**.
3. Select **Advanced**.
4. Enter the URL: `http://your-dashboard-host:5000/api/v1/scans`
5. Add an HTTP request header:
   - Name: `X-API-Key`
   - Value: your API key
6. Click **OK**.

### Step 3: Transform the data

1. Power BI opens the Power Query editor.
2. The JSON response contains a `data` array — expand it into rows.
3. Set column types (dates, numbers) as needed.
4. Click **Close & Apply**.

### Step 4: Add more data sources

Repeat Step 2 for the other endpoints:

- `/api/v1/trends` — for time-series charts
- `/api/v1/compliance-summary` — for compliance status
- `/api/v1/scans/{id}/issues` — for issue-level detail

You can also use the CSV endpoints directly: set the URL to `/api/v1/export/scans.csv` and Power BI will import it as a table without needing JSON transformation.

### Step 5: Build your dashboard

Suggested visualizations:

- **Line chart** — errors/warnings/notices over time (from trends endpoint)
- **Card** — current compliance status per jurisdiction (from compliance-summary)
- **Table** — top issues by frequency (from issues endpoint)
- **Bar chart** — issues by WCAG criterion

### Refreshing data

Set up **Scheduled Refresh** in the Power BI service to pull updated data automatically. The API key does not expire unless revoked.

---

*See also: [compliance/README.md](../compliance/README.md) | [integrations/claude-code.md](claude-code.md) | [configuration/compliance.md](../configuration/compliance.md)*
