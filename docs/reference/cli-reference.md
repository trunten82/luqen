# CLI Reference

All CLI commands across the Luqen packages.

---

## @luqen/core (`luqen`)

### luqen scan \<url\>

Discover and scan URLs for accessibility issues.

```bash
luqen scan https://example.com [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--standard <standard>` | WCAG standard: `WCAG2A`, `WCAG2AA`, or `WCAG2AAA` |
| `--concurrency <number>` | Number of concurrent scans |
| `--repo <path>` | Path to source repository for source mapping |
| `--output <dir>` | Output directory for reports |
| `--format <format>` | Report format: `json`, `html`, or `both` (default: `json`) |
| `--also-crawl` | Also crawl the site in addition to using sitemaps |
| `--config <path>` | Path to configuration file |
| `--compliance-url <url>` | URL of the compliance service for legal enrichment |
| `--jurisdictions <list>` | Comma-separated jurisdiction IDs (default: `EU,US`) |
| `--compliance-client-id <id>` | OAuth client ID for the compliance service |
| `--compliance-client-secret <secret>` | OAuth client secret for the compliance service |

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Clean -- no issues found |
| `1` | Issues found |
| `2` | Partial failure (page-level errors) |
| `3` | Fatal error |

**Examples:**

```bash
# Basic scan with default settings
luqen scan https://example.com

# Scan with HTML report, higher concurrency, and source mapping
luqen scan https://example.com \
  --format html \
  --concurrency 5 \
  --repo ./my-website

# Scan with compliance enrichment
luqen scan https://example.com \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US
```

---

### luqen fix \[url\]

Propose and interactively apply accessibility fixes.

```bash
luqen fix [url] --repo <path> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--repo <path>` | **(required)** Path to source repository |
| `--from-report <path>` | Load scan results from an existing JSON report |
| `--config <path>` | Path to configuration file |
| `--standard <standard>` | WCAG standard: `WCAG2A`, `WCAG2AA`, or `WCAG2AAA` |

Either a URL or `--from-report` must be provided.

**Interactive prompts:** For each proposed fix, you are prompted with:
- `[y]es` -- apply the fix
- `[n]o` -- skip the fix
- `[s]how diff` -- preview the change
- `[a]bort all` -- stop processing remaining fixes

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Success |
| `3` | Fatal error |

**Examples:**

```bash
# Fix from a live scan
luqen fix https://example.com --repo ./my-website

# Fix from an existing report
luqen fix --from-report ./reports/scan.json --repo ./my-website
```

---

## @luqen/compliance (`luqen-compliance`)

### luqen-compliance serve

Start the Fastify REST + MCP + A2A server.

```bash
luqen-compliance serve [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--port <number>` | Port to listen on (default: `4000`) |

**Prerequisites:** JWT keys must be generated first with `luqen-compliance keys generate`.

**Example:**

```bash
luqen-compliance serve --port 4000
```

---

### luqen-compliance seed

Load the baseline compliance dataset (jurisdictions, regulations, requirements).

```bash
luqen-compliance seed
```

**Example:**

```bash
luqen-compliance seed
# Seed complete:
#   Jurisdictions: 8
#   Regulations:   12
#   Requirements:  45
```

---

### luqen-compliance clients create

Create a new OAuth2 client.

```bash
luqen-compliance clients create --name <name> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--name <name>` | **(required)** Client name |
| `--scope <scopes>` | Space-separated scopes (default: `read`) |
| `--grant <grantType>` | Grant type (default: `client_credentials`) |

**Example:**

```bash
luqen-compliance clients create --name "my-scanner" --scope "read write"
# Client created:
#   client_id:     abc123
#   client_secret: secret456
```

---

### luqen-compliance clients list

List all OAuth2 clients.

```bash
luqen-compliance clients list
```

---

### luqen-compliance clients revoke \<id\>

Delete an OAuth2 client.

```bash
luqen-compliance clients revoke <client-id>
```

**Example:**

```bash
luqen-compliance clients revoke abc123
```

---

### luqen-compliance users create

Create a new user.

```bash
luqen-compliance users create --username <username> --password <password> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--username <username>` | **(required)** Username |
| `--password <password>` | **(required)** Password |
| `--role <role>` | User role: `admin`, `editor`, or `viewer` (default: `viewer`) |

**Example:**

```bash
luqen-compliance users create --username admin --password secret --role admin
```

---

### luqen-compliance keys generate

Generate an RS256 JWT key pair and save to `./keys/`.

```bash
luqen-compliance keys generate
# Key pair generated:
#   ./keys/private.pem
#   ./keys/public.pem
```

---

### luqen-compliance mcp

Start the MCP server on stdio (for use with Claude Code or Claude Desktop).

```bash
luqen-compliance mcp
```

---

## @luqen/dashboard (`luqen-dashboard`)

### luqen-dashboard serve

Start the dashboard web server.

```bash
luqen-dashboard serve [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --port <number>` | Port to listen on (overrides config) |
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

**Example:**

```bash
luqen-dashboard serve --port 3000
```

---

### luqen-dashboard migrate

Create or update the SQLite database schema.

```bash
luqen-dashboard migrate [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-d, --db-path <path>` | Path to SQLite database file (overrides config) |
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

**Example:**

```bash
luqen-dashboard migrate --db-path ./data/dashboard.db
```

---

### luqen-dashboard self-audit

Scan the dashboard itself for WCAG 2.1 AA accessibility issues.

```bash
luqen-dashboard self-audit [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--url <url>` | URL of a running dashboard instance to audit |
| `-p, --port <number>` | Port for auto-started dashboard (default: from config) |
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |
| `--json` | Output raw JSON instead of formatted summary |

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | No errors found |
| `1` | Accessibility errors found |

**Example:**

```bash
# Audit a running instance
luqen-dashboard self-audit --url http://localhost:3000

# Output as JSON
luqen-dashboard self-audit --json
```

---

### luqen-dashboard api-key

Display or regenerate the dashboard API key. The API key is generated automatically on first start and is used for solo-mode authentication and programmatic API access.

```bash
luqen-dashboard api-key [subcommand] [options]
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `show` | Display the current API key (default if no subcommand given) |
| `regenerate` | Generate a new API key and invalidate the previous one |

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |
| `-d, --db-path <path>` | Path to SQLite database file (overrides config) |

**Examples:**

```bash
# Show the current API key
luqen-dashboard api-key

# Regenerate the API key
luqen-dashboard api-key regenerate
```

---

### luqen-dashboard plugin list

List all installed plugins.

```bash
luqen-dashboard plugin list [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

Output columns: ID, Package, Type, Version, Status.

---

### luqen-dashboard plugin install \<package\>

Install a plugin from the registry.

```bash
luqen-dashboard plugin install <package> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

**Example:**

```bash
luqen-dashboard plugin install @luqen/plugin-notify-slack
```

---

### luqen-dashboard plugin configure \<id\>

Configure an installed plugin with key=value pairs.

```bash
luqen-dashboard plugin configure <id> --set <key=value...> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--set <pairs...>` | One or more `key=value` pairs |
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

**Example:**

```bash
luqen-dashboard plugin configure abc-123 --set webhookUrl=https://hooks.slack.com/xxx channel=#a11y
```

---

### luqen-dashboard plugin activate \<id\>

Activate an installed plugin. The plugin is loaded, its `activate()` hook is called, and periodic health checks begin.

```bash
luqen-dashboard plugin activate <id> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

---

### luqen-dashboard plugin deactivate \<id\>

Deactivate a running plugin. Calls the plugin's `deactivate()` hook and stops health checks.

```bash
luqen-dashboard plugin deactivate <id> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

---

### luqen-dashboard plugin remove \<id\>

Remove an installed plugin. Deactivates it first if active, then deletes the database record and package files.

```bash
luqen-dashboard plugin remove <id> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

---

## @luqen/llm (`luqen-llm`)

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

**Example:**

```bash
luqen-llm serve --port 4200
```

---

### luqen-llm keys generate

Generate an RS256 JWT key pair and save to the specified directory.

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

## @luqen/monitor (`luqen-monitor`)

### luqen-monitor scan

Run one full scan cycle over all monitored legal sources.

```bash
luqen-monitor scan [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--sources-file <path>` | Path to a local sources JSON file (standalone mode) |

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | All sources scanned successfully |
| `1` | One or more sources had errors |

**Example:**

```bash
# Scan using compliance service sources
luqen-monitor scan

# Scan from a local file
luqen-monitor scan --sources-file ./sources.json
```

---

### luqen-monitor status

Show current monitor status (source count, last scan time, pending proposals).

```bash
luqen-monitor status
```

---

### luqen-monitor mcp

Start the MCP server on stdio (for use with Claude Code or Claude Desktop).

```bash
luqen-monitor mcp
```

---

### luqen-monitor serve

Start an HTTP server with A2A endpoints.

```bash
luqen-monitor serve [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--port <port>` | Port to listen on (default: `4200`) |

**Endpoints:**

| Path | Method | Description |
|------|--------|-------------|
| `/.well-known/agent.json` | GET | A2A agent card |
| `/health` | GET | Health check |

**Example:**

```bash
luqen-monitor serve --port 4200
```
