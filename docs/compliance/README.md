# Pally Compliance Service

`@pally-agent/compliance` is a standalone accessibility compliance rule engine that maps WCAG technical issues to country-specific legal requirements. It stores regulations for 60+ jurisdictions, marks requirements as mandatory/recommended/optional, and provides a compliance check that annotates pa11y scan results with legal context and a per-jurisdiction pass/fail matrix.

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Configuration](#configuration)
4. [Authentication (OAuth2)](#authentication-oauth2)
5. [REST API Reference](#rest-api-reference)
6. [Compliance Check Guide](#compliance-check-guide)
7. [Data Model](#data-model)
8. [MCP Server](#mcp-server)
9. [A2A Agent](#a2a-agent)
10. [Database Adapters](#database-adapters)
11. [Baseline Data](#baseline-data)
12. [Update Proposals](#update-proposals)
13. [Monitored Sources](#monitored-sources)
14. [Webhooks](#webhooks)
15. [CLI Reference](#cli-reference)
16. [Troubleshooting](#troubleshooting)
17. [API Types Reference](#api-types-reference)

---

## Overview

### What it is

The Pally Compliance Service answers the question: "Given these WCAG accessibility violations, which laws are we breaking and in which countries?"

It is a self-contained HTTP service with REST API, MCP server (for Claude Code), and A2A agent protocol support. It ships with a baseline dataset covering the major accessibility regulations across 60+ jurisdictions — EU, US, UK, Germany, France, Australia, Canada, Japan, and more.

### Problem it solves

Running a pa11y accessibility scan produces technical issue codes like `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37`. This tells you there is a missing image alternative, but it does not tell you:

- Is this a legal violation in the EU? The US? The UK?
- Is it mandatory to fix, or just recommended?
- Which specific law requires it, and when did enforcement begin?
- Which sectors does the law cover?

The compliance service provides this legal context. Feed it pa11y issues and a list of jurisdictions, get back a compliance matrix with pass/fail per jurisdiction and annotated issues with regulation metadata.

### How it fits in the pally ecosystem

```
pa11y-webservice              pally-agent                  compliance service
(accessibility scanner)  →   (scan + fix agent)       →   (legal annotation)
                             ↕ MCP                         ↕ REST / MCP / A2A
                         Claude Code                    Power Automate, n8n,
                                                        other LLM agents
```

The compliance service is independent. pally-agent is one of its clients. Power Automate, n8n, and any HTTP client can call it directly.

---

## Getting Started

### Prerequisites

- Node.js 20 or later
- npm 10 or later (included with Node.js 20)
- Git

### Install from source

```bash
# Clone the monorepo
git clone https://github.com/trunten82/pally-agent.git
cd pally-agent

# Install dependencies
npm install

# Build the compliance package
cd packages/compliance
npm run build
# Note: the build script also copies src/seed/baseline.json → dist/seed/baseline.json
# automatically. No manual copy is required.
```

### Link the CLI globally (optional)

```bash
cd packages/compliance
npm link
```

This makes `pally-compliance` available as a global command.

### First run

**Step 1: Generate JWT key pair**

```bash
cd packages/compliance
pally-compliance keys generate
```

Output:
```
Key pair generated:
  ./keys/private.pem
  ./keys/public.pem
```

**Step 2: Create a config file**

Create `compliance.config.json` in the `packages/compliance` directory:

```json
{
  "port": 4000,
  "host": "0.0.0.0",
  "dbAdapter": "sqlite",
  "dbPath": "./compliance.db"
}
```

**Step 3: Start the server**

```bash
pally-compliance serve
```

Output:
```
Compliance service running on port 4000
```

**Step 4: Seed the baseline data**

In a separate terminal:

```bash
pally-compliance seed
```

Output:
```
Seed complete:
  Jurisdictions: 8
  Regulations:   10
  Requirements:  10
```

Or via the API with an admin token (see [Authentication](#authentication-oauth2) first):

```bash
curl -X POST http://localhost:4000/api/v1/seed \
  -H "Authorization: Bearer <admin-token>"
```

### Create your first OAuth client

```bash
pally-compliance clients create --name "my-app" --scope "read" --grant client_credentials
```

Output:
```
Client created:
  client_id:     01HXXXXXXXXXXXXXXXXXXXXX
  client_secret: <secret-shown-once>
  name:          my-app
  scopes:        read
```

Save the `client_secret` — it is shown only once.

### Obtain a token

```bash
curl -X POST http://localhost:4000/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "01HXXXXXXXXXXXXXXXXXXXXX",
    "client_secret": "<your-secret>",
    "scope": "read"
  }'
```

Response:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read"
}
```

### Make your first compliance check

```bash
curl -X POST http://localhost:4000/api/v1/compliance/check \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "jurisdictions": ["EU", "US"],
    "issues": [
      {
        "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
        "type": "error",
        "message": "Img element missing an alt attribute.",
        "selector": "img#logo",
        "context": "<img id=\"logo\" src=\"logo.png\">"
      }
    ]
  }'
```

The response includes a compliance matrix with pass/fail per jurisdiction and the legal regulations affected.

---

## Configuration

### Config file: `compliance.config.json`

Place this file in the working directory where you run `pally-compliance serve`. All fields are optional — the defaults shown below apply if a field is missing.

```json
{
  "port": 4000,
  "host": "0.0.0.0",
  "dbAdapter": "sqlite",
  "dbPath": "./compliance.db",
  "dbUrl": null,
  "jwtKeyPair": {
    "publicKeyPath": "./keys/public.pem",
    "privateKeyPath": "./keys/private.pem"
  },
  "tokenExpiry": "1h",
  "refreshTokenExpiry": "30d",
  "rateLimit": {
    "read": 100,
    "write": 20,
    "windowMs": 60000
  },
  "cors": {
    "origin": ["http://localhost:3000"],
    "credentials": true
  },
  "a2a": {
    "enabled": true,
    "peers": []
  }
}
```

#### Field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | `4000` | TCP port the HTTP server listens on |
| `host` | string | `"0.0.0.0"` | Network interface to bind. Use `"127.0.0.1"` for loopback-only |
| `dbAdapter` | `"sqlite" \| "mongodb" \| "postgres"` | `"sqlite"` | Database backend |
| `dbPath` | string | `"./compliance.db"` | SQLite file path (ignored for MongoDB/PostgreSQL) |
| `dbUrl` | string | `null` | Connection string for MongoDB (`mongodb://...`) or PostgreSQL (`postgres://...`) |
| `jwtKeyPair.publicKeyPath` | string | `"./keys/public.pem"` | Path to RS256 public key PEM file |
| `jwtKeyPair.privateKeyPath` | string | `"./keys/private.pem"` | Path to RS256 private key PEM file |
| `tokenExpiry` | string | `"1h"` | Access token lifetime. Accepts `"1h"`, `"30m"`, `"3600"` (seconds) |
| `refreshTokenExpiry` | string | `"30d"` | Refresh token lifetime (currently informational) |
| `rateLimit.read` | number | `100` | Max requests per window for read-scope endpoints |
| `rateLimit.write` | number | `20` | Max requests per window for write/admin endpoints |
| `rateLimit.windowMs` | number | `60000` | Rate limit window in milliseconds (60000 = 1 minute) |
| `cors.origin` | string[] | `["http://localhost:3000"]` | Allowed CORS origins. Use `["*"]` for public access |
| `cors.credentials` | boolean | `true` | Allow credentials (cookies, auth headers) in CORS |
| `a2a.enabled` | boolean | `true` | Enable A2A agent card and task endpoints |
| `a2a.peers` | string[] | `[]` | URLs of peer A2A agents for discovery |

### Environment variable overrides

Environment variables take precedence over the config file, which takes precedence over defaults.

| Variable | Overrides | Example |
|----------|-----------|---------|
| `COMPLIANCE_PORT` | `port` | `4000` |
| `COMPLIANCE_HOST` | `host` | `0.0.0.0` |
| `COMPLIANCE_DB_ADAPTER` | `dbAdapter` | `sqlite`, `mongodb`, `postgres` |
| `COMPLIANCE_DB_PATH` | `dbPath` | `./compliance.db` |
| `COMPLIANCE_DB_URL` | `dbUrl` | `mongodb://localhost:27017/compliance` |
| `COMPLIANCE_JWT_PRIVATE_KEY` | `jwtKeyPair.privateKeyPath` | `./keys/private.pem` |
| `COMPLIANCE_JWT_PUBLIC_KEY` | `jwtKeyPair.publicKeyPath` | `./keys/public.pem` |
| `COMPLIANCE_CORS_ORIGIN` | `cors.origin` | `https://app.example.com,https://admin.example.com` |
| `COMPLIANCE_URL` | A2A agent card URL | `https://compliance.example.com` |

### Precedence order

```
Environment variables  (highest priority)
  ↓
compliance.config.json
  ↓
Built-in defaults      (lowest priority)
```

---

## Authentication (OAuth2)

The compliance service implements OAuth2 with the client credentials flow for service-to-service use and the authorization code + PKCE flow for interactive use.

All API endpoints except `/api/v1/health` and `/api/v1/oauth/token` require a Bearer token.

### Creating OAuth clients

Use the CLI to create clients:

```bash
# Read-only client (for pally-agent, n8n, etc.)
pally-compliance clients create --name "pally-agent" --scope "read" --grant client_credentials

# Read/write client (for automated tools that propose updates)
pally-compliance clients create --name "monitor-bot" --scope "read write" --grant client_credentials

# Admin client (for management tools)
pally-compliance clients create --name "admin-cli" --scope "read write admin" --grant client_credentials
```

### Obtaining a token (client credentials flow)

```bash
curl -X POST http://localhost:4000/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "scope": "read"
  }'
```

You can also use HTTP Basic Auth:

```bash
curl -X POST http://localhost:4000/api/v1/oauth/token \
  -u "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" \
  -d "grant_type=client_credentials&scope=read"
```

Response:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read"
}
```

### Using tokens in requests

Include the token in the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJSUzI1NiJ9...
```

### Scope reference

| Scope | Access level |
|-------|-------------|
| `read` | All GET endpoints, `POST /compliance/check`, `GET /seed/status` |
| `write` | Create/update jurisdictions, regulations, requirements, propose updates |
| `admin` | Approve/reject update proposals, manage sources and webhooks, seed baseline, delete any entity, manage OAuth clients |

Scopes are hierarchical in practice: `admin` implies `write` and `read` access. However, scope enforcement is exact — a token with `write` scope cannot call admin-only endpoints.

### Token format

Tokens are RS256-signed JWTs containing:

```json
{
  "sub": "client-id-or-user-id",
  "scopes": ["read"],
  "iat": 1710000000,
  "exp": 1710003600
}
```

The public key for verification is available at `GET /api/v1/oauth/jwks` (JWKS format).

### PKCE flow (authorization code)

For interactive clients (admin UI, browser-based tools), use the authorization code flow with PKCE:

1. Redirect user to `GET /api/v1/oauth/authorize?response_type=code&client_id=xxx&redirect_uri=http://...&code_challenge=yyy&code_challenge_method=S256`
2. User authenticates (see `pally-compliance users create`)
3. Service redirects to `redirect_uri?code=zzz`
4. Exchange code: `POST /api/v1/oauth/token` with `grant_type=authorization_code&code=zzz&code_verifier=original_verifier`

### Revoking tokens

Tokens are stateless JWTs. Revocation is best-effort:

```bash
curl -X POST http://localhost:4000/api/v1/oauth/revoke \
  -H "Authorization: Bearer <token>"
```

To truly invalidate access, rotate the JWT key pair with `pally-compliance keys generate` and restart the server.

### Rate limiting

Rate limits are enforced per client ID:

| Scope | Default limit | Window |
|-------|--------------|--------|
| `read` | 100 req/min | 60 seconds |
| `write` / `admin` | 20 req/min | 60 seconds |

On limit exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header indicating seconds to wait.

---

## REST API Reference

**Base URL:** `http://localhost:4000/api/v1`

**Authentication:** All endpoints except `/health` and `/oauth/token` require `Authorization: Bearer <token>`.

**Pagination:** All list endpoints support `?limit=50&offset=0` (defaults shown). Maximum `limit` is 200. Response envelope:
```json
{ "data": [...], "total": 100, "limit": 50, "offset": 0 }
```

### Health

#### `GET /health`

No authentication required.

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2026-03-19T12:00:00.000Z"
}
```

### OpenAPI

#### `GET /openapi.json`
Redirects to the OpenAPI 3.1 specification JSON. No auth required.

#### `GET /docs`
Swagger UI. No auth required.

### OAuth

#### `POST /oauth/token`

Obtain an access token.

**Request body:**
```json
{
  "grant_type": "client_credentials",
  "client_id": "01HXXXXXXXXXXXXXXXXXXXXX",
  "client_secret": "your-secret",
  "scope": "read"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read"
}
```

**Errors:** `400 invalid_request`, `400 unsupported_grant_type`, `400 invalid_scope`, `401 invalid_client`

#### `POST /oauth/revoke`

Revoke a token (best-effort for stateless JWTs). Requires Bearer token.

**Response:** `{ "revoked": true }`

### Jurisdictions

#### `GET /jurisdictions`

Scope: `read`

List all jurisdictions. Supports filters:
- `?type=country` — filter by type (`supranational`, `country`, `state`)
- `?parentId=EU` — filter by parent jurisdiction

**Response:**
```json
{
  "data": [
    {
      "id": "EU",
      "name": "European Union",
      "type": "supranational",
      "iso3166": "EU",
      "createdAt": "2026-03-19T00:00:00.000Z",
      "updatedAt": "2026-03-19T00:00:00.000Z"
    },
    {
      "id": "DE",
      "name": "Germany",
      "type": "country",
      "iso3166": "DE",
      "parentId": "EU",
      "createdAt": "2026-03-19T00:00:00.000Z",
      "updatedAt": "2026-03-19T00:00:00.000Z"
    }
  ],
  "total": 8,
  "limit": 50,
  "offset": 0
}
```

#### `GET /jurisdictions/:id`

Scope: `read`

Get a single jurisdiction with regulation count.

**Response:**
```json
{
  "id": "EU",
  "name": "European Union",
  "type": "supranational",
  "iso3166": "EU",
  "regulationsCount": 2,
  "createdAt": "2026-03-19T00:00:00.000Z",
  "updatedAt": "2026-03-19T00:00:00.000Z"
}
```

#### `POST /jurisdictions`

Scope: `write`

Create a jurisdiction.

**Request body:**
```json
{
  "id": "NL",
  "name": "Netherlands",
  "type": "country",
  "iso3166": "NL",
  "parentId": "EU"
}
```

**Response:** `201 Created` with the created jurisdiction object.

#### `PATCH /jurisdictions/:id`

Scope: `write`

Update a jurisdiction. Only fields present in the body are updated.

**Request body:**
```json
{ "name": "Kingdom of the Netherlands" }
```

#### `DELETE /jurisdictions/:id`

Scope: `admin`

Delete a jurisdiction. Cascades to regulations and requirements.

**Response:** `204 No Content`

### Regulations

#### `GET /regulations`

Scope: `read`

List regulations. Supports filters:
- `?jurisdictionId=EU`
- `?status=active` — `active`, `draft`, or `repealed`
- `?scope=public` — `public`, `private`, or `all`

**Response:**
```json
{
  "data": [
    {
      "id": "EU-EAA",
      "jurisdictionId": "EU",
      "name": "European Accessibility Act",
      "shortName": "EAA",
      "reference": "Directive (EU) 2019/882",
      "url": "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019L0882",
      "enforcementDate": "2025-06-28",
      "status": "active",
      "scope": "all",
      "sectors": ["products", "services", "digital"],
      "description": "The European Accessibility Act requires certain products and services to be accessible to persons with disabilities.",
      "createdAt": "2026-03-19T00:00:00.000Z",
      "updatedAt": "2026-03-19T00:00:00.000Z"
    }
  ],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

#### `GET /regulations/:id`

Scope: `read`

Get a single regulation with its requirements.

**Response:** Regulation object plus `requirements` array.

#### `POST /regulations`

Scope: `write`

Create a regulation.

**Request body:**
```json
{
  "id": "IE-DAWA",
  "jurisdictionId": "IE",
  "name": "Disability Act Web Accessibility",
  "shortName": "DAWA",
  "reference": "Disability Act 2005",
  "url": "https://www.irishstatutebook.ie/eli/2005/act/14/enacted/en/html",
  "enforcementDate": "2005-07-01",
  "status": "active",
  "scope": "public",
  "sectors": ["government"],
  "description": "Requires public bodies to make websites accessible"
}
```

#### `PATCH /regulations/:id`

Scope: `write`

Update a regulation. Partial update — only fields in body are changed.

#### `DELETE /regulations/:id`

Scope: `admin`

Delete a regulation. Cascades to requirements.

### Requirements

#### `GET /requirements`

Scope: `read`

List requirements. Supports filters:
- `?regulationId=EU-EAA`
- `?wcagCriterion=1.1.1`
- `?obligation=mandatory`

**Response:**
```json
{
  "data": [
    {
      "id": "01HXXXXXXXXXXXXXXXXXXXXX",
      "regulationId": "EU-EAA",
      "wcagVersion": "2.1",
      "wcagLevel": "AA",
      "wcagCriterion": "*",
      "obligation": "mandatory",
      "createdAt": "2026-03-19T00:00:00.000Z",
      "updatedAt": "2026-03-19T00:00:00.000Z"
    }
  ],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

#### `GET /requirements/:id`

Scope: `read`

Get a single requirement with regulation metadata.

#### `POST /requirements`

Scope: `write`

Create a requirement.

**Request body:**
```json
{
  "regulationId": "EU-EAA",
  "wcagVersion": "2.2",
  "wcagLevel": "AA",
  "wcagCriterion": "2.4.11",
  "obligation": "recommended",
  "notes": "Focus appearance criterion added in WCAG 2.2"
}
```

#### `PATCH /requirements/:id`

Scope: `write`

Update a requirement.

#### `DELETE /requirements/:id`

Scope: `admin`

Delete a requirement.

#### `POST /requirements/bulk`

Scope: `admin`

Bulk import requirements.

**Request body:** Array of requirement objects (same format as `POST /requirements`).

**Response:** Array of created requirement objects.

### Compliance Check

#### `POST /compliance/check`

Scope: `read`

The core endpoint. Checks pa11y issues against jurisdiction legal requirements and returns a compliance matrix.

**Request body:**
```json
{
  "jurisdictions": ["EU", "US"],
  "issues": [
    {
      "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "type": "error",
      "message": "Img element missing an alt attribute.",
      "selector": "img#hero",
      "context": "<img id=\"hero\" src=\"hero.jpg\">",
      "url": "https://example.com/"
    }
  ],
  "includeOptional": false,
  "sectors": ["e-commerce"]
}
```

**Response:**
```json
{
  "matrix": {
    "EU": {
      "jurisdictionId": "EU",
      "jurisdictionName": "European Union",
      "status": "fail",
      "mandatoryViolations": 1,
      "recommendedViolations": 0,
      "optionalViolations": 0,
      "regulations": [
        {
          "regulationId": "EU-EAA",
          "regulationName": "European Accessibility Act",
          "shortName": "EAA",
          "status": "fail",
          "enforcementDate": "2025-06-28",
          "scope": "all",
          "violations": [
            {
              "wcagCriterion": "1.1.1",
              "obligation": "mandatory",
              "issueCount": 1
            }
          ]
        }
      ]
    },
    "US": {
      "jurisdictionId": "US",
      "jurisdictionName": "United States",
      "status": "fail",
      "mandatoryViolations": 1,
      "recommendedViolations": 0,
      "optionalViolations": 0,
      "regulations": [...]
    }
  },
  "annotatedIssues": [
    {
      "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "wcagCriterion": "1.1.1",
      "wcagLevel": "AA",
      "originalIssue": {
        "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
        "type": "error",
        "message": "Img element missing an alt attribute.",
        "selector": "img#hero",
        "context": "<img id=\"hero\" src=\"hero.jpg\">"
      },
      "regulations": [
        {
          "regulationId": "EU-EAA",
          "regulationName": "European Accessibility Act",
          "shortName": "EAA",
          "jurisdictionId": "EU",
          "obligation": "mandatory",
          "enforcementDate": "2025-06-28"
        },
        {
          "regulationId": "US-ADA",
          "regulationName": "Americans with Disabilities Act",
          "shortName": "ADA",
          "jurisdictionId": "US",
          "obligation": "mandatory",
          "enforcementDate": "1990-07-26"
        }
      ]
    }
  ],
  "summary": {
    "totalJurisdictions": 2,
    "passing": 0,
    "failing": 2,
    "totalMandatoryViolations": 2,
    "totalOptionalViolations": 0
  }
}
```

### Update Proposals

#### `POST /updates/propose`

Scope: `write`

Submit a proposed change to the compliance rule database.

**Request body:**
```json
{
  "source": "https://eur-lex.europa.eu/new-directive-2026",
  "type": "amendment",
  "affectedRegulationId": "EU-EAA",
  "summary": "EAA extended to cover WCAG 2.2 AA from 2027",
  "proposedChanges": {
    "action": "update",
    "entityType": "regulation",
    "entityId": "EU-EAA",
    "before": { "wcagVersion": "2.1" },
    "after": { "wcagVersion": "2.2", "enforcementDate": "2027-01-01" }
  }
}
```

**Response:** `201 Created` with the proposal object.

#### `GET /updates`

Scope: `read`

List proposals. Filter: `?status=pending|approved|rejected`

#### `GET /updates/:id`

Scope: `read`

Get a single proposal with the full diff.

#### `PATCH /updates/:id/approve`

Scope: `admin`

Approve a proposal and apply the proposed changes to the database.

**Response:** Updated proposal with `status: "approved"` and `reviewedBy`, `reviewedAt`.

#### `PATCH /updates/:id/reject`

Scope: `admin`

Reject a proposal.

### Monitored Sources

#### `GET /sources`

Scope: `read`

List all monitored sources.

**Response:**
```json
[
  {
    "id": "01HXXXXXXXXXXXXXXXXXXXXX",
    "name": "W3C WAI Policies",
    "url": "https://www.w3.org/WAI/policies/",
    "type": "html",
    "schedule": "weekly",
    "lastCheckedAt": "2026-03-19T00:00:00.000Z",
    "lastContentHash": "sha256:abc123...",
    "createdAt": "2026-03-19T00:00:00.000Z"
  }
]
```

#### `POST /sources`

Scope: `admin`

Add a monitored source.

**Request body:**
```json
{
  "name": "W3C WAI Policies",
  "url": "https://www.w3.org/WAI/policies/",
  "type": "html",
  "schedule": "weekly"
}
```

#### `DELETE /sources/:id`

Scope: `admin`

Remove a source.

#### `POST /sources/scan`

Scope: `admin`

Trigger a synchronous scan of all monitored sources. For each source, fetches content, computes SHA-256, compares to the stored hash. If changed, creates an `UpdateProposal` with `type: "amendment"`.

**Response:**
```json
{
  "scanned": 3,
  "proposalsCreated": 1,
  "proposals": [...]
}
```

### Seed

#### `POST /seed`

Scope: `admin`

Load the baseline compliance dataset. Idempotent — safe to run multiple times.

**Response:**
```json
{
  "success": true,
  "jurisdictions": 8,
  "regulations": 10,
  "requirements": 10
}
```

#### `GET /seed/status`

Scope: `read`

Check if baseline data is loaded.

**Response:**
```json
{
  "jurisdictions": 8,
  "regulations": 10,
  "requirements": 10
}
```

### Webhooks

#### `GET /webhooks`

Scope: `admin`

List all registered webhooks.

#### `POST /webhooks`

Scope: `admin`

Register a webhook.

**Request body:**
```json
{
  "url": "https://your-server.com/webhook",
  "secret": "your-shared-secret",
  "events": ["update.proposed", "regulation.created"]
}
```

**Response:** `201 Created` with webhook object.

#### `DELETE /webhooks/:id`

Scope: `admin`

Remove a webhook. Response: `204 No Content`

---

## Compliance Check Guide

### How the engine works

When you call `POST /compliance/check`, the engine:

1. **Extracts WCAG criteria** from each issue code. The code `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37` yields criterion `1.1.1` and level `AA`.

2. **Resolves jurisdiction hierarchy.** If you check `DE` (Germany), the engine also includes `EU` regulations automatically because Germany's `parentId` is `EU`. You get both EU-level and Germany-specific results.

3. **Queries requirements** matching the extracted criteria. A requirement with `wcagCriterion: "*"` at level `AA` matches all AA and A criteria — this is how the EAA and ADA are represented (they require all of WCAG 2.1 AA).

4. **Applies sector filtering.** If you pass `sectors: ["banking"]`, only regulations whose `sectors` array contains `"banking"` are included.

5. **Builds the matrix.** For each jurisdiction, groups violations by regulation, counts mandatory/recommended/optional, and sets `status: "fail"` if any mandatory violations exist.

6. **Annotates issues.** Each issue in the response includes the list of regulations it violates and the obligation level.

### Reading the matrix response

The `matrix` field is keyed by jurisdiction ID:

```json
"EU": {
  "status": "fail",           // "pass" or "fail"
  "mandatoryViolations": 3,   // legally required fixes
  "recommendedViolations": 1, // strongly advised but not legally required
  "optionalViolations": 0,    // informational only
  "regulations": [...]        // per-regulation breakdown
}
```

A jurisdiction `status` is `"fail"` only when there are mandatory violations. Recommended and optional violations do not cause failure.

### Understanding obligation levels

| Level | Meaning |
|-------|---------|
| `mandatory` | Legally required. Failure means non-compliance with the law. |
| `recommended` | Strongly advised by the regulation but not strictly required. Common in sector-specific guidance. |
| `optional` | Informational. Best practice references within the regulation. |

### Jurisdiction inheritance

When checking a member state, the engine automatically includes its parent's regulations:

| Requested | Also includes |
|-----------|---------------|
| `DE` (Germany) | `EU` (European Union) |
| `FR` (France) | `EU` (European Union) |

This means checking `DE` gives you German-specific laws (BITV 2.0) plus EU-level laws (EAA, WAD).

### Wildcard criterion matching

Most regulations require all WCAG criteria at a given level, not individual criteria. These are stored with `wcagCriterion: "*"`.

A wildcard requirement at level `AA` matches:
- All `WCAG2A` issues (level A criteria)
- All `WCAG2AA` issues (level AA criteria)

A wildcard at level `AAA` matches all three levels.

This means a single requirement `{ wcagCriterion: "*", wcagLevel: "AA" }` covers the entire WCAG 2.1 AA standard.

### Sector filtering

Use `sectors` to narrow results to regulations applicable to your industry:

```json
{
  "jurisdictions": ["EU"],
  "issues": [...],
  "sectors": ["banking"]
}
```

Only regulations with `"banking"` in their `sectors` array are included. If a regulation has `sectors: ["products", "services", "digital"]`, it will not match a `sectors: ["banking"]` filter.

### The `includeOptional` flag

By default (`includeOptional: false`), optional-obligation requirements are excluded from the matrix and annotated issues. Set `includeOptional: true` to include them in the output — useful for comprehensive audits.

---

## Data Model

### Jurisdiction

Represents a country or supranational body.

```
Jurisdiction
├── id          "EU", "US", "DE"
├── name        "European Union"
├── type        supranational | country | state
├── parentId    "EU" (links DE to EU)
├── iso3166     ISO 3166-1 alpha-2 code
├── createdAt
└── updatedAt
```

**Relationships:**
- A jurisdiction can have a parent (`parentId`), creating a hierarchy (e.g., DE → EU).
- A jurisdiction has many regulations.

**Example — EU hierarchy:**
```
EU (supranational)
├── DE (country, parentId: EU)
├── FR (country, parentId: EU)
└── [any other EU member states]
```

### Regulation

A specific law, directive, or standard within a jurisdiction.

```
Regulation
├── id              "EU-EAA", "US-ADA"
├── jurisdictionId  links to Jurisdiction.id
├── name            "European Accessibility Act"
├── shortName       "EAA"
├── reference       "Directive (EU) 2019/882"
├── url             link to official text
├── enforcementDate ISO 8601 date
├── status          active | draft | repealed
├── scope           public | private | all
├── sectors         ["e-commerce", "banking"]
├── description
├── createdAt
└── updatedAt
```

**scope** values:
- `public` — applies only to public sector / government
- `private` — applies only to private sector
- `all` — applies to both sectors

### Requirement

Maps a regulation to specific WCAG success criteria.

```
Requirement
├── id              auto-generated
├── regulationId    links to Regulation.id
├── wcagVersion     "2.0" | "2.1" | "2.2"
├── wcagLevel       "A" | "AA" | "AAA"
├── wcagCriterion   "1.1.1" | "*" (wildcard = all at level)
├── obligation      mandatory | recommended | optional
├── notes           optional clarification
├── createdAt
└── updatedAt
```

### Relationships diagram

```
Jurisdiction (1) ──< (many) Regulation (1) ──< (many) Requirement
     │
     └── parentId ──> Jurisdiction (self-referential hierarchy)
```

### Baseline data example

```json
{
  "jurisdictions": [
    { "id": "EU", "type": "supranational" },
    { "id": "DE", "type": "country", "parentId": "EU" }
  ],
  "regulations": [
    {
      "id": "EU-EAA",
      "jurisdictionId": "EU",
      "shortName": "EAA",
      "enforcementDate": "2025-06-28",
      "sectors": ["products", "services", "digital"]
    }
  ],
  "requirements": [
    {
      "regulationId": "EU-EAA",
      "wcagVersion": "2.1",
      "wcagLevel": "AA",
      "wcagCriterion": "*",
      "obligation": "mandatory"
    }
  ]
}
```

---

## MCP Server

The compliance service runs as an MCP server for use by Claude Code and other LLM agents. When running via `pally-compliance mcp`, it communicates over stdio and does not require a running HTTP server.

### Setup in Claude Code

Add to your Claude Code settings (`.claude/settings.json` or `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "pally-compliance": {
      "command": "node",
      "args": ["/absolute/path/to/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "/absolute/path/to/compliance.db"
      }
    }
  }
}
```

The MCP server runs in **local mode** by default (no OAuth required) with full admin access. This is appropriate for single-user Claude Code setups.

### Authentication for multi-user MCP

To restrict MCP access, set these env vars in the MCP server config:

```json
{
  "env": {
    "COMPLIANCE_MCP_CLIENT_ID": "your-client-id",
    "COMPLIANCE_MCP_CLIENT_SECRET": "your-client-secret",
    "COMPLIANCE_MCP_SCOPES": "read write"
  }
}
```

### All 11 MCP tools

#### `compliance_check`

Check pa11y issues against jurisdiction legal requirements.

**Input:**
```json
{
  "jurisdictions": ["EU", "US", "UK"],
  "issues": [
    {
      "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "type": "error",
      "message": "Img element missing an alt attribute.",
      "selector": "img#logo",
      "context": "<img id=\"logo\" src=\"logo.png\">"
    }
  ],
  "includeOptional": false,
  "sectors": ["e-commerce"]
}
```

**Output:** Full compliance check response (matrix + annotated issues + summary) as JSON text.

#### `compliance_list_jurisdictions`

List all jurisdictions with optional filters.

**Input:**
```json
{
  "type": "country",
  "parentId": "EU"
}
```

**Output:** Array of jurisdiction objects.

#### `compliance_list_regulations`

List regulations with optional filters.

**Input:**
```json
{
  "jurisdictionId": "US",
  "status": "active",
  "scope": "all"
}
```

**Output:** Array of regulation objects.

#### `compliance_list_requirements`

List requirements with optional filters.

**Input:**
```json
{
  "regulationId": "EU-EAA",
  "obligation": "mandatory"
}
```

**Output:** Array of requirement objects.

#### `compliance_get_regulation`

Get a single regulation by ID, including all its requirements.

**Input:**
```json
{ "id": "EU-EAA" }
```

**Output:** Regulation object with `requirements` array. Returns `{ "error": "..." }` with `isError: true` if not found.

#### `compliance_propose_update`

Submit a proposed change to the compliance rule database.

**Input:**
```json
{
  "source": "https://eur-lex.europa.eu/new-amendment",
  "type": "amendment",
  "summary": "EAA enforcement extended to cover WCAG 2.2",
  "proposedChanges": {
    "action": "update",
    "entityType": "regulation",
    "entityId": "EU-EAA",
    "before": { "wcagVersion": "2.1" },
    "after": { "wcagVersion": "2.2" }
  },
  "affectedRegulationId": "EU-EAA"
}
```

**Output:** Created UpdateProposal object with `status: "pending"`.

#### `compliance_get_pending`

List all pending update proposals awaiting review.

**Input:** `{}`

**Output:** Array of UpdateProposal objects with `status: "pending"`.

#### `compliance_approve_update`

Approve a pending proposal and apply the changes to the database.

**Input:**
```json
{
  "id": "01HXXXXXXXXXXXXXXXXXXXXX",
  "reviewedBy": "claude-code"
}
```

**Output:** Updated proposal with `status: "approved"`.

#### `compliance_list_sources`

List all monitored legal sources.

**Input:** `{}`

**Output:** Array of MonitoredSource objects.

#### `compliance_add_source`

Add a URL to monitor for regulatory changes.

**Input:**
```json
{
  "name": "W3C WAI Policies",
  "url": "https://www.w3.org/WAI/policies/",
  "type": "html",
  "schedule": "weekly"
}
```

**Output:** Created MonitoredSource object.

#### `compliance_seed`

Load the baseline compliance dataset. Idempotent.

**Input:** `{}`

**Output:**
```json
{
  "success": true,
  "counts": {
    "jurisdictions": 8,
    "regulations": 10,
    "requirements": 10
  }
}
```

---

## A2A Agent

The compliance service publishes an A2A agent card for discovery by other agents.

### Agent card

Available at `GET /.well-known/agent.json` (no auth required):

```json
{
  "name": "pally-compliance",
  "description": "Accessibility compliance rule engine — check WCAG issues against 60+ country-specific legal requirements, manage regulations, and monitor legal changes",
  "url": "http://localhost:4000",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "authentication": {
    "schemes": ["oauth2"],
    "tokenEndpoint": "/api/v1/oauth/token"
  },
  "skills": [
    {
      "id": "compliance-check",
      "description": "Check accessibility issues against jurisdiction requirements and return compliance matrix"
    },
    {
      "id": "regulation-lookup",
      "description": "Look up regulations and requirements by jurisdiction, sector, or WCAG criterion"
    },
    {
      "id": "update-management",
      "description": "Propose, review, approve, or reject updates to compliance rules"
    },
    {
      "id": "source-monitoring",
      "description": "Manage monitored legal sources and trigger scans for changes"
    }
  ]
}
```

The `url` field defaults to `http://localhost:4000` and can be overridden with the `COMPLIANCE_URL` environment variable.

### A2A task endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/a2a/tasks` | Submit a task by skill ID and input |
| `GET` | `/a2a/tasks/:id` | Get task status and result |
| `GET` | `/a2a/tasks/:id/stream` | SSE stream for task progress |
| `GET` | `/a2a/agents` | List known peer agents |

### Task lifecycle

Tasks progress through: `submitted` → `working` → `completed` (or `failed`).

**Submit a task:**
```bash
curl -X POST http://localhost:4000/a2a/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "skill": "compliance-check",
    "input": {
      "jurisdictions": ["EU"],
      "issues": [...]
    }
  }'
```

**Response:**
```json
{
  "id": "task-01HXXX",
  "status": "submitted",
  "skill": "compliance-check"
}
```

**Poll for result:**
```bash
curl http://localhost:4000/a2a/tasks/task-01HXXX \
  -H "Authorization: Bearer <token>"
```

**SSE stream:**
```bash
curl -N http://localhost:4000/a2a/tasks/task-01HXXX/stream \
  -H "Authorization: Bearer <token>"
```

### Inter-agent authentication

When pally-agent calls the compliance service via A2A, it authenticates using the OAuth2 client credentials flow:

1. pally-agent has a `client_id` and `client_secret` configured
2. Before calling A2A tasks, it obtains a token from `/api/v1/oauth/token`
3. All A2A requests include `Authorization: Bearer <token>`

---

## Database Adapters

The compliance service uses a pluggable database adapter interface. All adapters implement the same `DbAdapter` interface, so switching adapters does not require changing application code.

### SQLite (default)

SQLite is the default adapter. No external database is required — it creates a single file.

**Config:**
```json
{
  "dbAdapter": "sqlite",
  "dbPath": "./compliance.db"
}
```

**Environment:**
```bash
COMPLIANCE_DB_ADAPTER=sqlite
COMPLIANCE_DB_PATH=/var/lib/compliance/compliance.db
```

SQLite is suitable for single-instance deployments, development, and small-scale production use.

### MongoDB

```json
{
  "dbAdapter": "mongodb",
  "dbUrl": "mongodb://localhost:27017/compliance"
}
```

```bash
COMPLIANCE_DB_ADAPTER=mongodb
COMPLIANCE_DB_URL=mongodb+srv://user:pass@cluster.mongodb.net/compliance
```

### PostgreSQL

```json
{
  "dbAdapter": "postgres",
  "dbUrl": "postgres://user:password@localhost:5432/compliance"
}
```

```bash
COMPLIANCE_DB_ADAPTER=postgres
COMPLIANCE_DB_URL=postgres://user:password@db-host:5432/compliance
```

Full MongoDB and PostgreSQL adapter implementations are planned for a future release. The adapter interface is stable and the SQLite adapter serves as the reference implementation.

### Adapter contract tests

The adapter interface is verified by a shared contract test suite:

```bash
# Run against SQLite (default)
vitest run tests/db/adapter-contract.test.ts

# Run against MongoDB
DB_ADAPTER=mongodb vitest run tests/db/adapter-contract.test.ts

# Run against PostgreSQL
DB_ADAPTER=postgres vitest run tests/db/adapter-contract.test.ts
```

---

## Baseline Data

### What is included

The service ships with a baseline dataset covering 8 jurisdictions and 10 regulations:

| Jurisdiction | Type | Regulations |
|-------------|------|-------------|
| EU | supranational | EAA (European Accessibility Act), WAD (Web Accessibility Directive) |
| US | country | Section 508, ADA (Americans with Disabilities Act) |
| UK | country | Equality Act 2010, PSBAR (Public Sector Bodies Accessibility Regulations) |
| DE | country (EU) | BITV 2.0 |
| FR | country (EU) | RGAA 4.1 |
| AU | country | DDA (Disability Discrimination Act 1992) |
| CA | country | ACA (Accessible Canada Act) |
| JP | country | JIS X 8341-3 |

All regulations in the baseline use `wcagCriterion: "*"` requirements, meaning they require conformance to an entire WCAG level. Most require WCAG 2.1 AA.

### How to seed

**Via CLI:**
```bash
pally-compliance seed
```

**Via API (requires admin token):**
```bash
curl -X POST http://localhost:4000/api/v1/seed \
  -H "Authorization: Bearer <admin-token>"
```

**Via MCP tool:**
```
compliance_seed
```

The seed operation is idempotent — running it multiple times does not create duplicates. It uses upsert logic based on entity IDs.

### How to verify

```bash
curl http://localhost:4000/api/v1/seed/status \
  -H "Authorization: Bearer <token>"
```

Response:
```json
{ "jurisdictions": 8, "regulations": 10, "requirements": 10 }
```

### Adding more data

Add additional jurisdictions, regulations, and requirements after seeding:

```bash
# Add a jurisdiction
curl -X POST http://localhost:4000/api/v1/jurisdictions \
  -H "Authorization: Bearer <write-token>" \
  -H "Content-Type: application/json" \
  -d '{ "id": "NZ", "name": "New Zealand", "type": "country", "iso3166": "NZ" }'

# Add a regulation
curl -X POST http://localhost:4000/api/v1/regulations \
  -H "Authorization: Bearer <write-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "NZ-HRDA",
    "jurisdictionId": "NZ",
    "name": "Human Rights (Disability Assistance) Act",
    "shortName": "HRDA",
    "reference": "Human Rights Act 1993",
    "url": "https://www.legislation.govt.nz/",
    "enforcementDate": "1993-08-10",
    "status": "active",
    "scope": "all",
    "sectors": ["services"],
    "description": "Prohibits discrimination on grounds of disability"
  }'
```

---

## Update Proposals

The update proposal system enables human-in-the-loop review of compliance rule changes detected from monitored sources or submitted manually.

### Workflow

```
Propose → Review → Approve (applies) or Reject
```

1. **Propose:** Submit a `ProposedChange` with a summary and source reference.
2. **Review:** List pending proposals (`GET /updates?status=pending`).
3. **Approve:** `PATCH /updates/:id/approve` — applies the change and sets `status: "approved"`.
4. **Reject:** `PATCH /updates/:id/reject` — discards the change and sets `status: "rejected"`.

### Proposal types

| Type | Meaning |
|------|---------|
| `new_regulation` | A new law has been enacted |
| `amendment` | An existing regulation has been modified |
| `repeal` | A regulation has been repealed |
| `new_requirement` | A new WCAG requirement mapping |
| `new_jurisdiction` | A new jurisdiction to track |

### ProposedChange format

```typescript
interface ProposedChange {
  action: 'create' | 'update' | 'delete';
  entityType: 'jurisdiction' | 'regulation' | 'requirement';
  entityId?: string;       // required for update/delete
  before?: Record<string, unknown>; // current state
  after?: Record<string, unknown>;  // new state
}
```

**Create example** — add a new jurisdiction:
```json
{
  "action": "create",
  "entityType": "jurisdiction",
  "after": {
    "id": "NZ",
    "name": "New Zealand",
    "type": "country",
    "iso3166": "NZ"
  }
}
```

**Update example** — change an enforcement date:
```json
{
  "action": "update",
  "entityType": "regulation",
  "entityId": "EU-EAA",
  "before": { "enforcementDate": "2025-06-28" },
  "after": { "enforcementDate": "2026-01-01" }
}
```

**Delete example** — repeal a regulation:
```json
{
  "action": "delete",
  "entityType": "regulation",
  "entityId": "OLD-REG"
}
```

When a proposal is approved, the engine applies only the fields present in `after` for updates — other fields are preserved.

---

## Monitored Sources

Monitored sources are URLs that the service checks for regulatory changes. When content changes (detected by SHA-256 hash comparison), an UpdateProposal is automatically created.

### Adding a source

```bash
curl -X POST http://localhost:4000/api/v1/sources \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "W3C WAI Web Accessibility Laws and Policies",
    "url": "https://www.w3.org/WAI/policies/",
    "type": "html",
    "schedule": "weekly"
  }'
```

### Source types

| Type | Description |
|------|-------------|
| `html` | Fetch HTML page and hash the content |
| `rss` | Parse RSS/Atom feed for new entries |
| `api` | Fetch JSON API response |

### Triggering a scan

```bash
curl -X POST http://localhost:4000/api/v1/sources/scan \
  -H "Authorization: Bearer <admin-token>"
```

The scan is synchronous. For large numbers of sources, this may take several seconds.

**Response:**
```json
{
  "scanned": 3,
  "proposalsCreated": 1,
  "proposals": [
    {
      "id": "01HXXX",
      "source": "https://www.w3.org/WAI/policies/",
      "type": "amendment",
      "status": "pending",
      ...
    }
  ]
}
```

---

## Webhooks

Webhooks deliver real-time notifications when events occur in the compliance service.

### Registering a webhook

```bash
curl -X POST http://localhost:4000/api/v1/webhooks \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.com/compliance-webhook",
    "secret": "your-shared-secret-min-32-chars",
    "events": ["update.proposed", "regulation.created", "regulation.updated"]
  }'
```

### Event types

| Event | Triggered when |
|-------|---------------|
| `update.proposed` | A new UpdateProposal is submitted |
| `update.approved` | A proposal is approved and applied |
| `update.rejected` | A proposal is rejected |
| `source.scanned` | A source scan completes |
| `regulation.created` | A new regulation is created |
| `regulation.updated` | A regulation is updated |

### Webhook payload format

```json
{
  "event": "update.proposed",
  "timestamp": "2026-03-19T12:00:00.000Z",
  "data": {
    "id": "01HXXX",
    "type": "amendment",
    "summary": "EAA enforcement date changed",
    "status": "pending"
  }
}
```

### Signature verification

Every webhook delivery includes an `X-Webhook-Signature` header:

```
X-Webhook-Signature: sha256=abc123def456...
```

The value is `sha256=` followed by the hex-encoded HMAC-SHA256 of the raw request body using the webhook's `secret`.

**Node.js verification example:**

```javascript
import { createHmac } from 'node:crypto';

function verifyWebhookSignature(body, secret, signatureHeader) {
  // signatureHeader = "sha256=abc123..."
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(body, 'utf-8')
    .digest('hex');

  // Use timing-safe comparison
  const sigBuf = Buffer.from(signatureHeader, 'utf-8');
  const expBuf = Buffer.from(expected, 'utf-8');

  if (sigBuf.length !== expBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expBuf);
}

// Express.js example
app.post('/compliance-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const valid = verifyWebhookSignature(
    req.body,
    process.env.WEBHOOK_SECRET,
    req.headers['x-webhook-signature']
  );

  if (!valid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = JSON.parse(req.body);
  console.log('Received event:', payload.event);
  res.json({ received: true });
});
```

### Delivery and retries

The service delivers webhooks synchronously after the triggering action. On `5xx` response or timeout, delivery is retried up to 3 times with exponential backoff (1s, 2s, 4s).

---

## CLI Reference

### `pally-compliance serve`

Start the Fastify REST + MCP + A2A server.

```bash
pally-compliance serve
pally-compliance serve --port 4000
```

Options:
- `--port <number>` — Port to listen on (default: `4000`, overridden by config/env)

Requires JWT key files. Run `keys generate` first.

### `pally-compliance seed`

Load the baseline compliance dataset.

```bash
pally-compliance seed
```

Reads `compliance.config.json` or `COMPLIANCE_DB_PATH` to find the database.

### `pally-compliance clients create`

Create a new OAuth2 client.

```bash
pally-compliance clients create --name "pally-agent" --scope "read" --grant client_credentials
pally-compliance clients create --name "admin-tool" --scope "read write admin" --grant client_credentials
```

Options:
- `--name <name>` — Client name (required)
- `--scope <scopes>` — Space-separated scopes (default: `"read"`)
- `--grant <grantType>` — Grant type: `client_credentials` or `authorization_code` (default: `client_credentials`)

Prints `client_id` and `client_secret` — the secret is shown only once.

### `pally-compliance clients list`

List all registered OAuth clients.

```bash
pally-compliance clients list
```

Output format: `<client_id>  <name>  [<scopes>]`

### `pally-compliance clients revoke`

Delete an OAuth client. Existing tokens remain valid until expiry (stateless JWTs).

```bash
pally-compliance clients revoke 01HXXXXXXXXXXXXXXXXXXXXX
```

### `pally-compliance users create`

Create a user for the authorization code flow (interactive admin UI).

```bash
pally-compliance users create --username admin --role admin --password "secure-password"
```

Options:
- `--username <username>` — Username (required)
- `--role <role>` — Role: `admin`, `editor`, or `viewer` (default: `viewer`)
- `--password <password>` — Password (required; will prompt in a future release)

### `pally-compliance keys generate`

Generate a new RS256 key pair for JWT signing.

```bash
pally-compliance keys generate
```

Creates `./keys/private.pem` (mode 0600) and `./keys/public.pem`. Run this before the first `serve`.

### `pally-compliance mcp`

Start the MCP server on stdio for use with Claude Code.

```bash
pally-compliance mcp
```

This is the command used in Claude Code's `mcpServers` config. It connects to the SQLite database at `COMPLIANCE_DB_PATH` (or `./compliance.db`).

---

## Troubleshooting

### `Warning: JWT key files not found`

**Cause:** The server cannot find the PEM key files.

**Fix:**
```bash
pally-compliance keys generate
```

Verify the paths in `compliance.config.json` match where the files were created.

### `401 invalid_client`

**Cause:** The `client_id` does not exist, or the `client_secret` is wrong.

**Fix:**
- Check that you used the `client_id` printed by `clients create`.
- The `client_secret` is shown only at creation time and is not recoverable. If lost, create a new client and revoke the old one.

### `403 Forbidden: insufficient scope`

**Cause:** The token does not have the required scope for the endpoint.

**Fix:** Create a client with the appropriate scope (`write` or `admin`) and obtain a new token.

### `429 Too Many Requests`

**Cause:** Rate limit exceeded.

**Fix:** Check the `Retry-After` header and wait that many seconds before retrying. Increase limits in config if needed:

```json
{
  "rateLimit": {
    "read": 500,
    "write": 100,
    "windowMs": 60000
  }
}
```

### Compliance check returns empty matrix

**Cause:** The baseline data has not been seeded.

**Fix:**
```bash
pally-compliance seed
# or
curl -X POST http://localhost:4000/api/v1/seed -H "Authorization: Bearer <admin-token>"
```

### WCAG criterion not matching

**Cause:** The issue code format does not match the expected pa11y format.

**Expected format:** `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37`

The matcher extracts `1.1.1` from the `1_1_1` segment after `Guideline`. Verify your issue codes follow this pattern.

### MCP server not connecting in Claude Code

**Fix:**
1. Verify the path in `settings.json` is absolute and the file exists.
2. Verify the dist directory is built: `npm run build` in `packages/compliance`.
3. Check that `COMPLIANCE_DB_PATH` points to the correct database file.
4. Restart Claude Code after config changes.

### Database is locked (SQLite)

**Cause:** Multiple processes accessing the same SQLite file simultaneously.

**Fix:** Run only one instance of the server per SQLite file. For multi-process deployments, switch to MongoDB or PostgreSQL.

---

## API Types Reference

### Core entities

#### Jurisdiction

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier (e.g., `"EU"`, `"US"`, `"DE"`) |
| `name` | `string` | Full name (e.g., `"European Union"`) |
| `type` | `"supranational" \| "country" \| "state"` | Classification |
| `parentId` | `string?` | Parent jurisdiction ID (e.g., `"EU"` for member states) |
| `iso3166` | `string?` | ISO 3166-1 alpha-2 country code |
| `createdAt` | `string` | ISO 8601 timestamp |
| `updatedAt` | `string` | ISO 8601 timestamp |

#### Regulation

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier (e.g., `"EU-EAA"`) |
| `jurisdictionId` | `string` | Links to Jurisdiction.id |
| `name` | `string` | Full regulation name |
| `shortName` | `string` | Short name / acronym |
| `reference` | `string` | Official reference number |
| `url` | `string` | Link to official text |
| `enforcementDate` | `string` | ISO 8601 date enforcement began |
| `status` | `"active" \| "draft" \| "repealed"` | Current status |
| `scope` | `"public" \| "private" \| "all"` | Which sector it covers |
| `sectors` | `string[]` | Industry sectors (e.g., `["banking", "e-commerce"]`) |
| `description` | `string` | Human-readable description |
| `createdAt` | `string` | ISO 8601 timestamp |
| `updatedAt` | `string` | ISO 8601 timestamp |

#### Requirement

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Auto-generated unique ID |
| `regulationId` | `string` | Links to Regulation.id |
| `wcagVersion` | `"2.0" \| "2.1" \| "2.2"` | WCAG version |
| `wcagLevel` | `"A" \| "AA" \| "AAA"` | Conformance level |
| `wcagCriterion` | `string` | Criterion (e.g., `"1.1.1"`) or `"*"` for all |
| `obligation` | `"mandatory" \| "recommended" \| "optional"` | Legal obligation level |
| `notes` | `string?` | Optional clarification |
| `createdAt` | `string` | ISO 8601 timestamp |
| `updatedAt` | `string` | ISO 8601 timestamp |

#### UpdateProposal

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Auto-generated |
| `source` | `string` | URL or description of where change was detected |
| `detectedAt` | `string` | ISO 8601 timestamp |
| `type` | `"new_regulation" \| "amendment" \| "repeal" \| "new_requirement" \| "new_jurisdiction"` | Change type |
| `affectedRegulationId` | `string?` | Affected regulation (if applicable) |
| `affectedJurisdictionId` | `string?` | Affected jurisdiction (if applicable) |
| `summary` | `string` | Human-readable description |
| `proposedChanges` | `ProposedChange` | Structured diff |
| `status` | `"pending" \| "approved" \| "rejected"` | Review status |
| `reviewedBy` | `string?` | Reviewer identifier |
| `reviewedAt` | `string?` | ISO 8601 timestamp of review |
| `createdAt` | `string` | ISO 8601 timestamp |

#### Webhook

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Auto-generated |
| `url` | `string` | POST target URL |
| `secret` | `string` | Shared secret for HMAC-SHA256 |
| `events` | `string[]` | Event types to deliver |
| `active` | `boolean` | Whether webhook is enabled |
| `createdAt` | `string` | ISO 8601 timestamp |

#### MonitoredSource

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Auto-generated |
| `name` | `string` | Display name |
| `url` | `string` | URL to monitor |
| `type` | `"html" \| "rss" \| "api"` | Content type |
| `schedule` | `"daily" \| "weekly" \| "monthly"` | Check frequency |
| `lastCheckedAt` | `string?` | ISO 8601 timestamp of last scan |
| `lastContentHash` | `string?` | SHA-256 hash of last fetched content |
| `createdAt` | `string` | ISO 8601 timestamp |

### API request/response types

#### ComplianceCheckRequest

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jurisdictions` | `string[]` | Yes | Jurisdiction IDs to check |
| `issues` | `Issue[]` | Yes | Pa11y issues array |
| `includeOptional` | `boolean` | No | Include optional requirements (default: `false`) |
| `sectors` | `string[]` | No | Filter regulations by sector |

#### ComplianceCheckResponse

| Field | Type | Description |
|-------|------|-------------|
| `matrix` | `Record<string, JurisdictionResult>` | Per-jurisdiction results |
| `annotatedIssues` | `AnnotatedIssue[]` | Issues with legal context |
| `summary.totalJurisdictions` | `number` | Total jurisdictions checked |
| `summary.passing` | `number` | Jurisdictions with no mandatory violations |
| `summary.failing` | `number` | Jurisdictions with mandatory violations |
| `summary.totalMandatoryViolations` | `number` | Sum across all jurisdictions |
| `summary.totalOptionalViolations` | `number` | Sum of optional violations |

#### PaginatedResponse

| Field | Type | Description |
|-------|------|-------------|
| `data` | `T[]` | Array of items |
| `total` | `number` | Total items available |
| `limit` | `number` | Items per page requested |
| `offset` | `number` | Items skipped |
