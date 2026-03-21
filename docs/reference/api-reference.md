[Docs](../README.md) > [Integrations](./) > API Reference

# REST API Quick Reference

All endpoints for `@pally-agent/compliance`. Base URL: `http://localhost:4000/api/v1`

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

Base URL: `http://localhost:5000` (dashboard service). Requires user role authentication via session cookie.

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

Base URL: `http://localhost:5000` (dashboard service). All plugin endpoints require admin role authentication via session cookie.

### `GET /api/v1/plugins`

List installed plugins. Returns an array of plugin records with masked secrets.

Response: `[{ "id": "...", "packageName": "...", "type": "auth", "version": "1.0.0", "config": {...}, "status": "active", "installedAt": "...", "activatedAt": "..." }]`

### `GET /api/v1/plugins/registry`

List all plugins available in the registry. Each entry includes an `installed` boolean.

Response: `[{ "name": "auth-entra", "displayName": "Azure Entra ID", "type": "auth", "version": "1.0.0", "description": "...", "packageName": "...", "icon": "entra", "installed": false }]`

### `POST /api/v1/plugins/install`

Install a plugin from the registry.

Request: `{ "packageName": "@pally-agent/plugin-notify-slack" }`

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

Base URL: `http://localhost:5000` (dashboard service). All organization endpoints require admin role authentication via session cookie.

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

*See also: [compliance/README.md](../compliance/README.md) | [integrations/claude-code.md](claude-code.md) | [configuration/compliance.md](../configuration/compliance.md)*
