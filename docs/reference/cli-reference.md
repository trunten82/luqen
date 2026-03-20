# CLI Reference

All CLI commands across the four Pally Agent packages.

---

## @pally-agent/core (`pally-agent`)

### pally-agent scan \<url\>

Discover and scan URLs for accessibility issues.

```bash
pally-agent scan https://example.com [options]
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
pally-agent scan https://example.com

# Scan with HTML report, higher concurrency, and source mapping
pally-agent scan https://example.com \
  --format html \
  --concurrency 5 \
  --repo ./my-website

# Scan with compliance enrichment
pally-agent scan https://example.com \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US
```

---

### pally-agent fix \[url\]

Propose and interactively apply accessibility fixes.

```bash
pally-agent fix [url] --repo <path> [options]
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
pally-agent fix https://example.com --repo ./my-website

# Fix from an existing report
pally-agent fix --from-report ./reports/scan.json --repo ./my-website
```

---

## @pally-agent/compliance (`pally-compliance`)

### pally-compliance serve

Start the Fastify REST + MCP + A2A server.

```bash
pally-compliance serve [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--port <number>` | Port to listen on (default: `4000`) |

**Prerequisites:** JWT keys must be generated first with `pally-compliance keys generate`.

**Example:**

```bash
pally-compliance serve --port 4000
```

---

### pally-compliance seed

Load the baseline compliance dataset (jurisdictions, regulations, requirements).

```bash
pally-compliance seed
```

**Example:**

```bash
pally-compliance seed
# Seed complete:
#   Jurisdictions: 8
#   Regulations:   12
#   Requirements:  45
```

---

### pally-compliance clients create

Create a new OAuth2 client.

```bash
pally-compliance clients create --name <name> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--name <name>` | **(required)** Client name |
| `--scope <scopes>` | Space-separated scopes (default: `read`) |
| `--grant <grantType>` | Grant type (default: `client_credentials`) |

**Example:**

```bash
pally-compliance clients create --name "my-scanner" --scope "read write"
# Client created:
#   client_id:     abc123
#   client_secret: secret456
```

---

### pally-compliance clients list

List all OAuth2 clients.

```bash
pally-compliance clients list
```

---

### pally-compliance clients revoke \<id\>

Delete an OAuth2 client.

```bash
pally-compliance clients revoke <client-id>
```

**Example:**

```bash
pally-compliance clients revoke abc123
```

---

### pally-compliance users create

Create a new user.

```bash
pally-compliance users create --username <username> --password <password> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--username <username>` | **(required)** Username |
| `--password <password>` | **(required)** Password |
| `--role <role>` | User role: `admin`, `editor`, or `viewer` (default: `viewer`) |

**Example:**

```bash
pally-compliance users create --username admin --password secret --role admin
```

---

### pally-compliance keys generate

Generate an RS256 JWT key pair and save to `./keys/`.

```bash
pally-compliance keys generate
# Key pair generated:
#   ./keys/private.pem
#   ./keys/public.pem
```

---

### pally-compliance mcp

Start the MCP server on stdio (for use with Claude Code or Claude Desktop).

```bash
pally-compliance mcp
```

---

## @pally-agent/dashboard (`pally-dashboard`)

### pally-dashboard serve

Start the dashboard web server.

```bash
pally-dashboard serve [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --port <number>` | Port to listen on (overrides config) |
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

**Example:**

```bash
pally-dashboard serve --port 3000
```

---

### pally-dashboard migrate

Create or update the SQLite database schema.

```bash
pally-dashboard migrate [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-d, --db-path <path>` | Path to SQLite database file (overrides config) |
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

**Example:**

```bash
pally-dashboard migrate --db-path ./data/dashboard.db
```

---

### pally-dashboard self-audit

Scan the dashboard itself for WCAG 2.1 AA accessibility issues.

```bash
pally-dashboard self-audit [options]
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
pally-dashboard self-audit --url http://localhost:3000

# Output as JSON
pally-dashboard self-audit --json
```

---

### pally-dashboard api-key

Display or regenerate the dashboard API key. The API key is generated automatically on first start and is used for solo-mode authentication and programmatic API access.

```bash
pally-dashboard api-key [subcommand] [options]
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
pally-dashboard api-key

# Regenerate the API key
pally-dashboard api-key regenerate
```

---

### pally-dashboard plugin list

List all installed plugins.

```bash
pally-dashboard plugin list [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

Output columns: ID, Package, Type, Version, Status.

---

### pally-dashboard plugin install \<package\>

Install a plugin from the registry.

```bash
pally-dashboard plugin install <package> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

**Example:**

```bash
pally-dashboard plugin install @pally-agent/plugin-notify-slack
```

---

### pally-dashboard plugin configure \<id\>

Configure an installed plugin with key=value pairs.

```bash
pally-dashboard plugin configure <id> --set <key=value...> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--set <pairs...>` | One or more `key=value` pairs |
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

**Example:**

```bash
pally-dashboard plugin configure abc-123 --set webhookUrl=https://hooks.slack.com/xxx channel=#a11y
```

---

### pally-dashboard plugin activate \<id\>

Activate an installed plugin. The plugin is loaded, its `activate()` hook is called, and periodic health checks begin.

```bash
pally-dashboard plugin activate <id> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

---

### pally-dashboard plugin deactivate \<id\>

Deactivate a running plugin. Calls the plugin's `deactivate()` hook and stops health checks.

```bash
pally-dashboard plugin deactivate <id> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

---

### pally-dashboard plugin remove \<id\>

Remove an installed plugin. Deactivates it first if active, then deletes the database record and package files.

```bash
pally-dashboard plugin remove <id> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `dashboard.config.json`) |

---

## @pally-agent/monitor (`pally-monitor`)

### pally-monitor scan

Run one full scan cycle over all monitored legal sources.

```bash
pally-monitor scan [options]
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
pally-monitor scan

# Scan from a local file
pally-monitor scan --sources-file ./sources.json
```

---

### pally-monitor status

Show current monitor status (source count, last scan time, pending proposals).

```bash
pally-monitor status
```

---

### pally-monitor mcp

Start the MCP server on stdio (for use with Claude Code or Claude Desktop).

```bash
pally-monitor mcp
```

---

### pally-monitor serve

Start an HTTP server with A2A endpoints.

```bash
pally-monitor serve [options]
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
pally-monitor serve --port 4200
```
