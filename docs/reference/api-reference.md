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

*See also: [compliance/README.md](../compliance/README.md) | [integrations/claude-code.md](claude-code.md) | [configuration/compliance.md](../configuration/compliance.md)*
