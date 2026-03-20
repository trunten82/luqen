[Docs](../README.md) > [Configuration](./) > Compliance

# Compliance Service Configuration Reference

`@pally-agent/compliance` — `compliance.config.json`, environment variables, and CLI flags.

---

## Config file: `compliance.config.json`

Place in the working directory where you run `pally-compliance serve`. All fields are optional.

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

### Field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `4000` | TCP port to listen on |
| `host` | `string` | `"0.0.0.0"` | Network interface. Use `"127.0.0.1"` for loopback-only |
| `dbAdapter` | `"sqlite" \| "mongodb" \| "postgres"` | `"sqlite"` | Database backend |
| `dbPath` | `string` | `"./compliance.db"` | SQLite file path (ignored for MongoDB/PostgreSQL) |
| `dbUrl` | `string` | `null` | Connection string for MongoDB (`mongodb://...`) or PostgreSQL (`postgres://...`) |
| `jwtKeyPair.publicKeyPath` | `string` | `"./keys/public.pem"` | RS256 public key PEM file |
| `jwtKeyPair.privateKeyPath` | `string` | `"./keys/private.pem"` | RS256 private key PEM file |
| `tokenExpiry` | `string` | `"1h"` | Access token lifetime. Accepts `"1h"`, `"30m"`, `"3600"` (seconds) |
| `refreshTokenExpiry` | `string` | `"30d"` | Refresh token lifetime |
| `rateLimit.read` | `number` | `100` | Max requests per window for read-scope endpoints |
| `rateLimit.write` | `number` | `20` | Max requests per window for write/admin endpoints |
| `rateLimit.windowMs` | `number` | `60000` | Rate limit window in milliseconds |
| `cors.origin` | `string[]` | `["http://localhost:3000"]` | Allowed CORS origins |
| `cors.credentials` | `boolean` | `true` | Allow credentials in CORS |
| `a2a.enabled` | `boolean` | `true` | Enable A2A agent card and task endpoints |
| `a2a.peers` | `string[]` | `[]` | URLs of peer A2A agents for discovery |

---

## Environment variables

| Variable | Overrides | Example |
|----------|-----------|---------|
| `COMPLIANCE_PORT` | `port` | `4000` |
| `COMPLIANCE_HOST` | `host` | `0.0.0.0` |
| `COMPLIANCE_DB_ADAPTER` | `dbAdapter` | `sqlite`, `mongodb`, `postgres` |
| `COMPLIANCE_DB_PATH` | `dbPath` | `./compliance.db` |
| `COMPLIANCE_DB_URL` | `dbUrl` | `postgres://user:pass@db:5432/compliance` |
| `COMPLIANCE_JWT_PRIVATE_KEY` | `jwtKeyPair.privateKeyPath` | `./keys/private.pem` |
| `COMPLIANCE_JWT_PUBLIC_KEY` | `jwtKeyPair.publicKeyPath` | `./keys/public.pem` |
| `COMPLIANCE_CORS_ORIGIN` | `cors.origin` | `https://app.example.com` |
| `COMPLIANCE_URL` | A2A agent card URL | `https://compliance.example.com` |
| `COMPLIANCE_REDIS_URL` | — | Optional Redis URL for caching compliance check results. When set, enables Redis-based caching with automatic fallback to no-cache. |

**Precedence:** Environment variables > `compliance.config.json` > built-in defaults.

---

## CLI reference

### `pally-compliance serve`

Start the REST + MCP + A2A server.

```bash
pally-compliance serve [--port 4000]
```

Requires JWT key files. Run `keys generate` first.

### `pally-compliance seed`

Load the baseline compliance dataset (58 jurisdictions, 62 regulations). Idempotent.

```bash
pally-compliance seed
```

### `pally-compliance mcp`

Start the MCP server on stdio for use with Claude Code.

```bash
pally-compliance mcp
```

### `pally-compliance keys generate`

Generate a new RS256 key pair for JWT signing.

```bash
pally-compliance keys generate
# Creates: ./keys/private.pem (mode 0600) and ./keys/public.pem
```

### `pally-compliance clients create`

Create a new OAuth2 client.

```bash
pally-compliance clients create \
  --name "my-app" \
  --scope "read" \
  --grant client_credentials
```

Options: `--name` (required), `--scope` (default: `"read"`), `--grant` (default: `client_credentials`)

Prints `client_id` and `client_secret` — the secret is shown **only once**.

### `pally-compliance clients list`

List all registered OAuth clients.

### `pally-compliance clients revoke <client_id>`

Delete an OAuth client. Existing tokens remain valid until expiry.

### `pally-compliance users create`

Create a user for the authorization code / password grant flow.

```bash
pally-compliance users create \
  --username admin \
  --role admin \
  --password "secure-password"
```

Roles: `admin`, `editor`, `viewer`.

---

## OAuth scope reference

| Scope | Access |
|-------|--------|
| `read` | All GET endpoints, `POST /compliance/check`, `GET /seed/status` |
| `write` | Create/update jurisdictions, regulations, requirements, propose updates |
| `admin` | Approve/reject proposals, manage sources and webhooks, seed, delete, manage OAuth clients |

---

*See also: [guides/compliance-check.md](../guides/compliance-check.md) | [compliance/README.md](../compliance/README.md) | [configuration/dashboard.md](dashboard.md)*
