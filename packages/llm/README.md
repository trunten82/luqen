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

# 2. Create an admin user
luqen-llm users create --username admin --password secret --role admin

# 3. Start the service
luqen-llm serve
```

The service starts on port 4200 by default. Interactive API docs are available at `http://localhost:4200/docs` (Swagger UI).

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
| `LLM_API_KEY` | Optional static API key for machine access | — |

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
