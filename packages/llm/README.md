# @luqen/llm

LLM provider management and AI capabilities service. A Fastify microservice that manages LLM providers (Ollama, OpenAI, and more), registers models, and routes AI capabilities to specific models with org-scoped overrides.

## Install

```bash
npm install @luqen/llm
```

## Usage

```bash
npx luqen-llm serve
```

## Quick Start

```bash
# 1. Generate RS256 JWT keys
luqen-llm keys generate

# 2. Start the service
luqen-llm serve

# 3. Create an OAuth2 client for inter-service access (e.g. dashboard or compliance)
luqen-llm clients create --name dashboard --scopes read,write,admin
# → note the client_id and client_secret
```

The service starts on port 4200 by default. Interactive API docs are available at `http://localhost:4200/api/v1/docs` (Swagger UI).

Machine-to-machine callers (dashboard, compliance service) authenticate using **OAuth2 client credentials**. Pass `clientId` and `clientSecret` from the `clients create` output into your dashboard config (`llmClientId` / `llmClientSecret`) or compliance env vars (`COMPLIANCE_LLM_CLIENT_ID` / `COMPLIANCE_LLM_CLIENT_SECRET`).

## Installer

The fastest way to configure the service from scratch:

```bash
bash installer/install-llm.sh
```

The interactive wizard configures:
1. JWT RS256 key pair (in `./keys/`)
2. OAuth client for the calling service (dashboard, compliance, etc.)
3. LLM provider registration (Ollama or OpenAI)
4. Model registration and assignment to all four capabilities

**Non-interactive / CI mode:**

```bash
bash installer/install-llm.sh --non-interactive --provider-type ollama --provider-url http://localhost:11434 --model llama3.2 --client-name dashboard
```

**Idempotency:** Re-running the installer detects existing keys and clients and skips re-creation.

## Configuration

### llm.config.json

Place `llm.config.json` in the working directory:

```json
{
  "port": 4200,
  "host": "0.0.0.0",
  "dbPath": "./llm.db",
  "jwtKeyPair": {
    "publicKeyPath": "./keys/public.pem",
    "privateKeyPath": "./keys/private.pem"
  },
  "tokenExpiry": "1h",
  "cors": {
    "origin": ["http://localhost:5000"]
  }
}
```

### Environment variables

All environment variables override values in `llm.config.json`.

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PORT` | Port to listen on | `4200` |
| `LLM_HOST` | Host/bind address | `0.0.0.0` |
| `LLM_DB_PATH` | Path to SQLite database file | `./llm.db` |
| `LLM_JWT_PRIVATE_KEY_PATH` | Path to RS256 private key PEM | `./keys/private.pem` |
| `LLM_JWT_PUBLIC_KEY_PATH` | Path to RS256 public key PEM | `./keys/public.pem` |
| `LLM_JWT_EXPIRY` | Token expiry duration (e.g. `1h`, `30m`) | `1h` |
| `LLM_CORS_ORIGIN` | Comma-separated allowed CORS origins | `http://localhost:5000` |

## API Endpoints Overview

Base URL: `http://localhost:4200/api/v1`

Authentication: `Authorization: Bearer <token>` on all endpoints except `/api/v1/health` and `/api/v1/oauth/token`.

### OAuth

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/oauth/token` | Obtain access token (`client_credentials` or `password` grant) |
| `POST` | `/oauth/revoke` | Revoke token (best-effort for stateless JWTs) |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health (no auth required) |
| `GET` | `/status` | System overview — provider count, model count, capability coverage (`read` scope) |

### Provider Management

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/providers` | `read` | List all providers |
| `GET` | `/providers/:id` | `read` | Get a single provider |
| `POST` | `/providers` | `admin` | Create a provider |
| `PATCH` | `/providers/:id` | `admin` | Update a provider |
| `DELETE` | `/providers/:id` | `admin` | Delete a provider |
| `POST` | `/providers/:id/test` | `admin` | Test provider connectivity and update status |
| `GET` | `/providers/:id/models` | `admin` | List models available from the provider's API |

### Model Management

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/models` | `read` | List registered models (filter: `?providerId=`) |
| `GET` | `/models/:id` | `read` | Get a single model |
| `POST` | `/models` | `admin` | Register a model under a provider |
| `DELETE` | `/models/:id` | `admin` | Remove a registered model |

### Capability Assignment

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/capabilities` | `read` | List all 4 capabilities with their current model assignments |
| `PUT` | `/capabilities/:name/assign` | `admin` | Assign a model to a capability (with optional priority and orgId) |
| `DELETE` | `/capabilities/:name/assign/:modelId` | `admin` | Remove a capability assignment (filter: `?orgId=`) |

**Available capabilities:** `extract-requirements`, `generate-fix`, `analyse-report`, `discover-branding`

## Capability Endpoints

All capability endpoints require `Authorization: Bearer <token>` with at minimum `read` scope. They return `{ error, statusCode }` on failure.

### Common error responses

| Status | Meaning |
|--------|---------|
| `400` | Invalid or missing required request field |
| `401` | Missing or invalid bearer token |
| `502` | Upstream LLM provider returned an unexpected error |
| `503` | No model assigned to capability (capability not configured) |
| `504` | All assigned models failed or timed out (capability exhausted) |

---

### POST /api/v1/extract-requirements

Extract structured accessibility requirements from a regulation document using AI.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Full text of the regulation document |
| `regulationId` | string | Yes | Unique identifier for the regulation (e.g. `"wcag-2.2"`) |
| `regulationName` | string | Yes | Human-readable regulation name |
| `jurisdictionId` | string | No | Jurisdiction ID for contextual filtering |
| `orgId` | string | No | Organisation ID for per-org prompt overrides |

**Response 200**

| Field | Type | Description |
|-------|------|-------------|
| `requirements` | array | Extracted requirement objects |
| `model` | string | Model name used for this request |
| `provider` | string | Provider name used for this request |
| `attempts` | number | Number of model attempts before success |

**Example**

```bash
curl -X POST http://localhost:4200/api/v1/extract-requirements \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Section 1.1.1: All non-text content must have a text alternative...",
    "regulationId": "wcag-2.2",
    "regulationName": "WCAG 2.2"
  }'
```

---

### POST /api/v1/generate-fix

Generate an AI-powered fix suggestion for a WCAG accessibility issue.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wcagCriterion` | string | Yes | WCAG success criterion (e.g. `"1.1.1 Non-text Content"`) |
| `issueMessage` | string | Yes | Accessibility issue description from the scanner |
| `htmlContext` | string | Yes | HTML snippet containing the problematic element |
| `cssContext` | string | No | Relevant CSS for the element |
| `orgId` | string | No | Organisation ID for per-org prompt overrides |

**Response 200**

| Field | Type | Description |
|-------|------|-------------|
| `fixedHtml` | string | Corrected HTML snippet |
| `explanation` | string | Human-readable explanation of the fix |
| `effortLevel` | string | Fix effort estimate: `"low"`, `"medium"`, or `"high"` |
| `model` | string | Model name used for this request |
| `provider` | string | Provider name used for this request |
| `attempts` | number | Number of model attempts before success |

**Example**

```bash
curl -X POST http://localhost:4200/api/v1/generate-fix \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "wcagCriterion": "1.1.1 Non-text Content",
    "issueMessage": "Image element missing alt attribute",
    "htmlContext": "<img src=\"logo.png\">"
  }'
```

---

### POST /api/v1/analyse-report

Generate an AI executive summary for a completed accessibility scan report, including pattern detection across prior scans.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `siteUrl` | string | Yes | URL of the scanned site |
| `totalIssues` | number | Yes | Total issue count from the scan |
| `issuesList` | array | Yes | Top issues from the scan (see schema below) |
| `complianceSummary` | string | No | Compliance matrix summary text |
| `recurringPatterns` | string[] | No | Recurring criteria codes from prior scans |
| `orgId` | string | No | Organisation ID for per-org prompt overrides |

**issuesList item schema**

| Field | Type | Description |
|-------|------|-------------|
| `criterion` | string | WCAG criterion code (e.g. `"1.1.1"`) |
| `message` | string | Issue description |
| `count` | number | Number of occurrences |
| `level` | string | WCAG level: `"A"`, `"AA"`, or `"AAA"` |

**Response 200**

| Field | Type | Description |
|-------|------|-------------|
| `summary` | string | AI-generated executive summary paragraph |
| `keyFindings` | string[] | Bullet-point key findings |
| `priorities` | string[] | Ordered remediation priorities |
| `patterns` | string[] | Detected recurring patterns |
| `model` | string | Model name used for this request |
| `provider` | string | Provider name used for this request |
| `attempts` | number | Number of model attempts before success |

**Example**

```bash
curl -X POST http://localhost:4200/api/v1/analyse-report \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "siteUrl": "https://example.com",
    "totalIssues": 47,
    "issuesList": [
      { "criterion": "1.1.1", "message": "Missing alt text", "count": 12, "level": "A" }
    ]
  }'
```

---

### POST /api/v1/discover-branding

Auto-detect brand colors, fonts, and logo from a website URL using AI-assisted HTML/CSS analysis.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | URL to fetch and analyse for brand signals (must be `http://` or `https://`) |
| `orgId` | string | No | Organisation ID for per-org prompt overrides |

**Response 200**

| Field | Type | Description |
|-------|------|-------------|
| `colors` | string[] | Detected hex color values (e.g. `["#003087", "#FFD700"]`) |
| `fonts` | string[] | Detected font family names (e.g. `["Inter", "Georgia"]`) |
| `logoUrl` | string | Detected logo URL (if found; empty string otherwise) |
| `brandName` | string | Detected brand name (if found; empty string otherwise) |
| `model` | string | Model name used for this request |
| `provider` | string | Provider name used for this request |
| `attempts` | number | Number of model attempts before success |

**Example**

```bash
curl -X POST http://localhost:4200/api/v1/discover-branding \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com" }'
```

---

## CLI Commands Reference

### luqen-llm serve

Start the LLM provider management service.

```bash
luqen-llm serve [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--port <number>` | Port to listen on (default: `4200`) |

**Prerequisites:** JWT keys must be generated first with `luqen-llm keys generate`.

---

### luqen-llm keys generate

Generate an RS256 JWT key pair.

```bash
luqen-llm keys generate [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--dir <dir>` | Output directory (default: `./keys`) |

**Example:**

```bash
luqen-llm keys generate
# Keys written to ./keys/
#   ./keys/private.pem
#   ./keys/public.pem
```

---

### luqen-llm clients create

Create a new OAuth2 client for machine-to-machine access.

```bash
luqen-llm clients create --name <name> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--name <name>` | **(required)** Client display name |
| `--scopes <scopes>` | Comma-separated scopes (default: `read`) |
| `--org <orgId>` | Organisation ID (default: `system`) |

**Example:**

```bash
luqen-llm clients create --name "compliance-service" --scopes "read,admin"
# Client created:
#   ID:     abc123
#   Secret: secret456
#   Scopes: read, admin
```

---

### luqen-llm clients list

List all OAuth2 clients.

```bash
luqen-llm clients list
```

---

### luqen-llm users create

Create a new user for password-based token access.

```bash
luqen-llm users create --username <username> --password <password> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--username <username>` | **(required)** Username |
| `--password <password>` | **(required)** Password |
| `--role <role>` | Role: `viewer`, `editor`, or `admin` (default: `admin`) |

**Example:**

```bash
luqen-llm users create --username admin --password secret --role admin
# User created: admin (admin)
```

---

## License

MIT
