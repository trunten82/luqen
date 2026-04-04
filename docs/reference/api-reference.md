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
| `POST` | `/sources/scan` | `admin` | Trigger scan of all sources (async on dashboard, sync on direct API) |
| `POST` | `/sources/upload` | `admin` | Upload document content + metadata for LLM-based regulation extraction |

---

## LLM Service

Base URL: `http://localhost:4200/api/v1`

Authentication: `Authorization: Bearer <token>` on all endpoints except `/api/v1/health` and `/api/v1/oauth/token`.

Full interactive docs: `http://localhost:4200/docs` (Swagger UI).

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/oauth/token` | Obtain an access token (`client_credentials` or `password` grant) |
| `POST` | `/oauth/revoke` | Revoke a token (best-effort for stateless JWTs) |

```bash
curl -X POST http://localhost:4200/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_SECRET"
  }'
```

Response: `{ "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600, "scope": "read" }`

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Service health check |
| `GET` | `/status` | `read` | System overview: provider count, model count, capability coverage |

Response for `/status`: `{ "providers": 2, "models": 5, "capabilities": { "total": 4, "covered": 3, "coverage": 75 } }`

### Provider Management

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/providers` | `read` | List all providers (API keys omitted from responses) |
| `GET` | `/providers/:id` | `read` | Get a single provider |
| `POST` | `/providers` | `admin` | Create a provider (`name`, `type`, `baseUrl` required; `apiKey` optional) |
| `PATCH` | `/providers/:id` | `admin` | Update provider fields (`name`, `baseUrl`, `apiKey`, `status`) |
| `DELETE` | `/providers/:id` | `admin` | Delete a provider |
| `POST` | `/providers/:id/test` | `admin` | Test provider connectivity; updates status to `active` or `error` |
| `GET` | `/providers/:id/models` | `admin` | List models available from the provider's remote API |

Provider types: `ollama`, `openai`, `anthropic`, `gemini`

Provider statuses: `active`, `inactive`, `error`

```bash
# Create an Ollama provider
curl -X POST http://localhost:4200/api/v1/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Local Ollama", "type": "ollama", "baseUrl": "http://localhost:11434" }'

# Test provider connectivity
curl -X POST http://localhost:4200/api/v1/providers/PROVIDER_ID/test \
  -H "Authorization: Bearer $TOKEN"
# Response: { "ok": true, "status": "active" }
```

### Model Management

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/models` | `read` | List registered models (filter: `?providerId=`) |
| `GET` | `/models/:id` | `read` | Get a single model |
| `POST` | `/models` | `admin` | Register a model under a provider (`providerId`, `modelId`, `displayName` required) |
| `DELETE` | `/models/:id` | `admin` | Remove a registered model |

```bash
# Register a model
curl -X POST http://localhost:4200/api/v1/models \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "PROVIDER_ID",
    "modelId": "llama3",
    "displayName": "Llama 3",
    "capabilities": ["extract-requirements", "generate-fix"]
  }'
```

### Capability Assignment

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/capabilities` | `read` | List all 4 capabilities with their current model assignments |
| `PUT` | `/capabilities/:name/assign` | `admin` | Assign a model to a capability |
| `DELETE` | `/capabilities/:name/assign/:modelId` | `admin` | Remove a capability assignment (filter: `?orgId=`) |

Available capability names: `extract-requirements`, `generate-fix`, `analyse-report`, `discover-branding`

```bash
# Assign a model to a capability (with org-scoped override)
curl -X PUT http://localhost:4200/api/v1/capabilities/extract-requirements/assign \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "modelId": "MODEL_ID", "priority": 1, "orgId": "acme-corp" }'

# Remove a capability assignment for a specific org
curl -X DELETE "http://localhost:4200/api/v1/capabilities/extract-requirements/assign/MODEL_ID?orgId=acme-corp" \
  -H "Authorization: Bearer $TOKEN"
```

---

## LLM Bridge (Dashboard)

Base URL: `http://localhost:5000` (dashboard service).

The dashboard bridges the compliance service and the `@luqen/llm` service. The compliance service authenticates to the LLM service directly using OAuth2 client credentials (`COMPLIANCE_LLM_CLIENT_ID` / `COMPLIANCE_LLM_CLIENT_SECRET`). The dashboard does the same via `llmClientId` / `llmClientSecret` in its config.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/llm/extract` | Dashboard API key | Bridges compliance service to the LLM service for regulation extraction |
| `GET` | `/api/v1/llm/providers` | Dashboard API key | Lists active LLM providers (for UI dropdowns and automation) |
| `GET` | `/api/v1/llm/status` | Dashboard API key | Check if LLM service is reachable (`{available, providerCount}`) |
| `POST` | `/api/v1/sources/scan` | Dashboard API key | Trigger async source scan — returns immediately, runs in background |
| `POST` | `/api/v1/sources/upload` | Dashboard API key | Upload document for LLM parsing — returns extracted requirements and proposal |
| `POST` | `/admin/sources/upload` | Session (`admin.system`) | Proxies regulation upload to compliance service with LLM provider selector |
| `POST` | `/admin/sources/scan` | Session (`admin.system`) | Triggers background source scan (fire-and-forget, prevents 504) |

### POST /api/v1/sources/scan

Trigger an async source scan via dashboard API key. Returns immediately.

```bash
curl -X POST -H "Authorization: Bearer <DASHBOARD_API_KEY>" \
  https://luqen.example.com/api/v1/sources/scan
# Response: {"status":"started","message":"Source scan started in background"}
```

Optional query param `?force=false` to only scan sources that are due per their schedule.

### POST /api/v1/sources/upload

Upload a regulation document for LLM extraction via dashboard API key.

```bash
curl -X POST -H "Authorization: Bearer <DASHBOARD_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Section 508","regulationId":"US-508","jurisdictionId":"US","content":"...text..."}' \
  https://luqen.example.com/api/v1/sources/upload
# Response: {"message":"Extracted 23 requirement(s)","confidence":0.95,"criteriaCount":23,"proposal":{...}}
```

---

## WCAG Criteria

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/wcag-criteria` | `read` | List all 225 WCAG 2.0/2.1/2.2 criteria (filters: `?version=`, `?level=`, `?principle=`) |

---

## Seed

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `POST` | `/seed` | `admin` | Load baseline dataset (idempotent); pass `{ "force": true }` to re-run the full source intelligence pipeline |
| `GET` | `/seed/status` | `read` | Check baseline data counts |
| `POST` | `/admin/reseed` | `admin` | Shortcut for force-reseed (equivalent to `POST /seed` with `{ "force": true }`) |

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

### `DELETE /api/v1/scans/:id`

Delete a scan record and its associated report files.

**Authentication:** Requires admin role or API key. Non-admin users can only delete scans belonging to their organization.

**Example request:**

```bash
curl -X DELETE -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/scans/abc123"
```

**Success response (200):**

```json
{ "success": true }
```

**Error responses:**

| Code | Description |
|------|-------------|
| 404 | Scan not found |
| 403 | Forbidden — not admin and scan belongs to different org |

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

## Data Export

Download scan data for use in spreadsheets, Power BI, or other tools. All export endpoints require the same `X-API-Key` authentication.

### `GET /api/v1/export/scans.csv`

Download a CSV of all scans (same filters as `GET /api/v1/scans`).

**Query parameters:** `siteUrl`, `from`, `to`, `limit`, `offset` (same as the scans endpoint).

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/export/scans.csv" -o scans.csv
```

**Columns:** `id`, `siteUrl`, `scanMode`, `status`, `standard`, `pagesScanned`, `totalIssues`, `errors`, `warnings`, `notices`, `createdAt`, `completedAt`

### `GET /api/v1/export/scans/:id/issues.csv`

Download an Excel (XLSX) workbook of all issues for a specific scan. The URL retains the `.csv` suffix for backwards compatibility, but the response is an Excel file (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).

**Query parameters:** `severity`, `criterion` (same as the issues endpoint).

```bash
curl -H "X-API-Key: $LUQEN_API_KEY" \
  "http://localhost:5000/api/v1/export/scans/abc123/issues.csv" -o issues.xlsx
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

### Download buttons in the UI

The dashboard provides download buttons for data export:

- **Reports list** (`/reports`) — download button exports the scans list as CSV
- **Report detail** (`/reports/:id`) — download button exports the scan's issues as Excel (XLSX)
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

You can also use the CSV endpoints directly: set the URL to `/api/v1/export/scans.csv` and Power BI will import it as a table without needing JSON transformation. For issues export, use `/api/v1/export/scans/{id}/issues.csv` — Power BI can open the Excel (XLSX) response directly.

### Step 5: Build your dashboard

Suggested visualizations:

- **Line chart** — errors/warnings/notices over time (from trends endpoint)
- **Card** — current compliance status per jurisdiction (from compliance-summary)
- **Table** — top issues by frequency (from issues endpoint)
- **Bar chart** — issues by WCAG criterion

### Refreshing data

Set up **Scheduled Refresh** in the Power BI service to pull updated data automatically. The API key does not expire unless revoked.

---

---

## Branding Service API

Base URL: `http://localhost:4100/api/v1` (branding service). Auth: Bearer JWT token obtained from `/api/v1/oauth/token`.

Full interactive docs: `http://localhost:4100/docs` (Swagger UI).

OpenAPI spec: [`docs/reference/openapi-branding.yaml`](openapi-branding.yaml).

For full module documentation including architecture, matching strategies, template format, and dashboard integration, see [`docs/branding/README.md`](../branding/README.md).

### Authentication

```bash
curl -X POST http://localhost:4100/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_SECRET",
    "scope": "read"
  }'
```

Response: `{ "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600 }`

### Health

#### `GET /health`

No auth required.

Response: `{ "status": "ok", "version": "1.0.0", "timestamp": "..." }`

### Guidelines

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/guidelines` | `read` | List guidelines (`?orgId=` to scope by org) |
| `POST` | `/guidelines` | `write` | Create guideline |
| `GET` | `/guidelines/:id` | `read` | Get guideline with colors, fonts, and selectors |
| `PUT` | `/guidelines/:id` | `write` | Update guideline name/description |
| `DELETE` | `/guidelines/:id` | `admin` | Delete guideline (cascades to colors/fonts/selectors/sites) |

### Colors, Fonts, and Selectors

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `POST` | `/guidelines/:id/colors` | `write` | Add a color pair (foreground + background hex) |
| `DELETE` | `/guidelines/:id/colors/:colorId` | `write` | Remove a color |
| `POST` | `/guidelines/:id/fonts` | `write` | Add a font family |
| `DELETE` | `/guidelines/:id/fonts/:fontId` | `write` | Remove a font |
| `POST` | `/guidelines/:id/selectors` | `write` | Add a CSS selector pattern |
| `DELETE` | `/guidelines/:id/selectors/:selectorId` | `write` | Remove a selector |

### Site Assignments

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/guidelines/:id/sites` | `read` | List sites assigned to a guideline |
| `POST` | `/guidelines/:id/sites` | `write` | Assign a site URL to a guideline |
| `DELETE` | `/guidelines/:id/sites` | `write` | Unassign a site (body: `{ "siteUrl": "..." }`) |

### Get by Site URL

#### `GET /sites?siteUrl=...` — `read` scope

Get the guideline (with colors, fonts, and selectors) assigned to a specific site URL.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `siteUrl` | string | **(required)** The site URL to look up |

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5000/api/v1/branding/sites?siteUrl=https%3A%2F%2Fwww.campari.com"
```

Returns `404` if no guideline is assigned to that site.

### Matching

#### `POST /match` — `read` scope

Match scan issues against branding guidelines. Returns each issue annotated with a `brandingMatch` result (or null).

```bash
curl -X POST http://localhost:4100/api/v1/match \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "siteUrl": "https://www.campari.com",
    "orgId": "campari",
    "issues": [
      {
        "code": "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail",
        "type": "error",
        "message": "This element has insufficient colour contrast ratio.",
        "selector": ".brand-header h1",
        "context": "<h1 class=\"brand-header\">Welcome</h1>"
      }
    ]
  }'
```

Response:
```json
{
  "annotatedIssues": [
    {
      "code": "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail",
      "type": "error",
      "message": "This element has insufficient colour contrast ratio.",
      "selector": ".brand-header h1",
      "context": "<h1 class=\"brand-header\">Welcome</h1>",
      "brandingMatch": {
        "guidelineId": "abc-123",
        "guidelineName": "Campari Group Main Brand",
        "strategy": "selector",
        "detail": ".brand-header"
      }
    }
  ],
  "summary": {
    "total": 1,
    "brandRelated": 1,
    "unexpected": 0,
    "byStrategy": { "color": 0, "font": 0, "selector": 1 }
  }
}
```

Matching strategies applied in order: **color-pair** (Delta-E ≤ 5.0), **font** (normalized family name), **selector** (substring/prefix match).

### Image Upload

Brand images are managed through the dashboard admin routes. Upload via:

```
POST /admin/branding-guidelines/:id/image
```

- Requires `branding.manage` permission (session cookie).
- Accepts multipart form data; only image MIME types are accepted.
- Stores the file at `/uploads/{orgId}/branding-images/{slug}-{id}.{ext}` on the dashboard host.
- Returns an HTML partial (HTMX swap) with the updated image preview.
- Sets the `imagePath` field on the guideline record; visible in all subsequent GET responses.

### Scan Retag

#### `POST /api/v1/branding/retag` — `branding.manage`

Re-run branding matching on all completed scans for a given site using the currently active guideline. Use this to backfill branding tags after modifying a guideline or to trigger a manual refresh.

Note: The dashboard also triggers automatic retag internally whenever a guideline is modified (colors, fonts, selectors added/removed) or a site assignment changes. You only need to call this endpoint for explicit manual retags.

```bash
curl -X POST http://localhost:5000/api/v1/branding/retag \
  -H "Content-Type: application/json" \
  -d '{ "siteUrl": "https://www.campari.com" }'
```

**Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `siteUrl` | string | **(required)** The site URL whose scans should be retagged |

**Response:**

```json
{ "data": { "retagged": 12 } }
```

The `retagged` count reflects the number of completed scans updated. Returns `{ "data": { "retagged": 0 } }` if no active guideline is assigned or if there are no completed scans.

### Templates

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/templates/csv` | `read` | Download CSV import template |
| `GET` | `/templates/json` | `read` | Download JSON import template |

### Scope reference

| Scope | Access |
|-------|--------|
| `read` | All GETs, `POST /match`, `GET /templates` |
| `write` | Create/update guidelines; add/remove colors, fonts, selectors, sites |
| `admin` | All write + delete guidelines, manage OAuth clients |

---

## Dashboard GraphQL API — Branding

Base URL: `http://localhost:5000/graphql`. Requires a valid session cookie. All branding operations are scoped to the user's current organization.

### Queries

```graphql
# List all guidelines for the current org
query {
  brandingGuidelines {
    id name description version active imagePath
    colors { id name hexValue usage context }
    fonts { id family weights usage context }
    selectors { id pattern description }
    sites
  }
}

# Get a single guideline by ID
query {
  brandingGuideline(id: "abc-123") {
    id name version active imagePath
    colors { name hexValue } fonts { family } selectors { pattern }
    sites
  }
}

# Get the guideline assigned to a specific site URL
query {
  brandingGuidelineForSite(siteUrl: "https://www.campari.com") {
    id name version active
    colors { name hexValue usage } fonts { family weights } selectors { pattern }
  }
}
```

### Mutations

```graphql
# Create a guideline
mutation {
  createBrandingGuideline(input: { name: "Aperol Brand", description: "Primary palette" }) {
    id name active version
  }
}

# Toggle active/inactive (triggers auto-retag when activating)
mutation {
  toggleBrandingGuideline(id: "abc-123") { id name active }
}

# Delete a guideline (cascades to colors/fonts/selectors/sites)
mutation {
  deleteBrandingGuideline(id: "abc-123")
}

# Add a color (triggers auto-retag for all assigned sites)
mutation {
  addBrandColor(guidelineId: "abc-123", input: {
    name: "Aperol Orange", hexValue: "#F26522", usage: "primary", context: "Hero sections, CTAs"
  }) { id name hexValue }
}

# Remove a color (triggers auto-retag for all assigned sites)
mutation { removeBrandColor(id: "color-456") }

# Add a font (triggers auto-retag for all assigned sites)
mutation {
  addBrandFont(guidelineId: "abc-123", input: {
    family: "Montserrat", weights: ["400", "700"], usage: "heading"
  }) { id family weights }
}

# Remove a font (triggers auto-retag for all assigned sites)
mutation { removeBrandFont(id: "font-789") }

# Add a CSS selector rule (triggers auto-retag for all assigned sites)
mutation {
  addBrandSelector(guidelineId: "abc-123", input: {
    pattern: ".aperol-header", description: "Top navigation bar"
  }) { id pattern }
}

# Remove a selector (triggers auto-retag for all assigned sites)
mutation { removeBrandSelector(id: "sel-012") }

# Assign a site to a guideline (triggers retag for that site)
mutation {
  assignBrandingToSite(guidelineId: "abc-123", siteUrl: "https://www.aperol.com")
}

# Unassign a site
mutation {
  unassignBrandingFromSite(siteUrl: "https://www.aperol.com")
}

# Manually retag existing scans for a site
mutation {
  retagBrandingScans(siteUrl: "https://www.campari.com") {
    retagged
  }
}
```

The `retagBrandingScans` mutation returns a `RetagResult` with a `retagged` count indicating how many completed scans were updated with fresh branding tags.

---

*See also: [compliance/README.md](../compliance/README.md) | [branding/README.md](../branding/README.md) | [integrations/claude-code.md](claude-code.md) | [configuration/compliance.md](../configuration/compliance.md)*
