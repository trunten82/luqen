[Docs](README.md) > Quickstart

# Quickstart — Scan a site in 5 minutes

## What you need

- Node.js 20 or later
- npm (bundled with Node.js)

No external pa11y-webservice is needed — the scanner uses the pa11y library directly.

---

## Step 1 — Install

**Option A: One-line installer (Linux)**

```bash
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
```

The wizard offers three modes: Developer tools (CLI only), Full platform (bare metal), or Docker.

**Option B: Docker**

```bash
git clone https://github.com/trunten82/luqen.git
cd luqen
export SESSION_SECRET="$(openssl rand -base64 32)"
docker compose up -d
```

Open `http://localhost:5000` for the dashboard. Skip to [Step 3](#step-3--view-results).

**Option C: Manual**

```bash
git clone https://github.com/trunten82/luqen.git
cd luqen
npm install
npm run build --workspaces
cd packages/core && npm link
```

After linking, `luqen` is a global command.

---

## Step 2 — Run your first scan

```bash
luqen scan https://example.com
```

Output:
```
Discovering URLs from https://example.com...
Found 12 URLs to scan
[1/12] Scanning https://example.com/
[1/12] Done: https://example.com/
...
JSON report written to: ./luqen-reports/luqen-report-2026-03-18T120000Z.json
```

---

## Step 3 — View results

Open the HTML report:

```bash
luqen scan https://example.com --format both
open luqen-reports/*.html
```

Or parse the JSON:

```bash
cat luqen-reports/*.json | jq '.summary'
```

---

## Optional: Add compliance checking

Annotate every WCAG violation with the legal regulations that require it:

```bash
# 1. Start the compliance service
cd packages/compliance
node dist/cli.js keys generate
node dist/cli.js seed
node dist/cli.js serve &

# 2. Create an OAuth client
node dist/cli.js clients create --name scanner --scope read --grant client_credentials
# → note the client_id and client_secret

# 3. Scan with compliance
luqen scan https://example.com \
  --format both \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US,UK \
  --compliance-client-id $CLIENT_ID \
  --compliance-client-secret $CLIENT_SECRET
```

The HTML report now shows a per-jurisdiction pass/fail table and regulation badges on every issue.

---

## Which setup is right for you?

| You are... | Recommended setup | Why |
|------------|-------------------|-----|
| **Solo developer** scanning your own site | **Local install + CLI** | Simplest. `npm install`, scan, done. No external services needed. Reports saved as JSON/HTML files. |
| **Solo developer** wanting AI integration | **Local install + MCP in your IDE** | Same as above, but your AI assistant (Claude/Cursor) can scan and fix for you. |
| **Small team** (2-5 developers) | **Docker Compose** (compliance + dashboard) | One `docker compose up`. Everyone accesses the dashboard at `http://your-server:5000`. Shared compliance data. |
| **Large team / enterprise** | **Kubernetes + Redis** | Full HA deployment. Shared Redis for caching/queues. Multiple dashboard replicas. SSO via OAuth2. |
| **CI/CD pipeline** | **CLI in Docker** | Run `luqen scan` as a pipeline step. Fail builds on violations. No servers needed — just the Docker image. |
| **Consultancy** scanning client sites | **Dashboard + compliance** (Docker or K8s) | Centralized scanning with compliance matrix. Generate reports per client per jurisdiction. |

For detailed setup instructions, see the [installation guides](getting-started/).

---

## IDE Integration

> **Connecting from external MCP clients (v3.0+).** Luqen v3.0 added Streamable HTTP MCP endpoints on every service (compliance, branding, llm, dashboard) at `/api/v1/mcp`, with OAuth 2.1 + PKCE + Dynamic Client Registration. Claude Desktop, Cursor, Windsurf, and custom clients should follow [guides/mcp-integration.md](guides/mcp-integration.md). The stdio recipes below are the legacy `@luqen/core`-only path for purely local scanning.

Luqen also ships a stdio MCP server in `@luqen/core`. This gives your AI coding assistant accessibility tools — scan sites, check compliance, propose fixes — directly from your editor.

### VS Code (with Claude Code extension)

1. Install [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) from the VS Code marketplace
2. Add to `.claude/settings.json` in your project (or globally at `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "luqen": {
      "command": "node",
      "args": ["/path/to/luqen/packages/core/dist/mcp.js"]
    },
    "luqen-compliance": {
      "command": "node",
      "args": ["/path/to/luqen/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "/path/to/luqen/packages/compliance/compliance.db"
      }
    }
  }
}
```

3. In Claude Code, ask: *"Scan https://my-site.com for accessibility issues and check compliance against EU regulations"*

### Cursor

1. Open Cursor Settings → MCP Servers
2. Add server with command: `node /path/to/luqen/packages/core/dist/mcp.js`
3. Add a second server for compliance: `node /path/to/luqen/packages/compliance/dist/cli.js mcp`
4. The tools appear automatically in Cursor's AI chat — ask it to scan, check compliance, or fix issues

### Windsurf

1. Open Settings → MCP
2. Add the same server commands as Cursor above
3. Use in Cascade: *"Run an accessibility audit on our staging site"*

### JetBrains IDEs (IntelliJ, WebStorm, PyCharm)

JetBrains IDEs support MCP via the [AI Assistant plugin](https://plugins.jetbrains.com/plugin/22282-ai-assistant):

1. Settings → AI Assistant → MCP Servers
2. Add: command `node`, args `["/path/to/luqen/packages/core/dist/mcp.js"]`
3. Use in the AI chat panel

### Neovim (with avante.nvim or similar)

For Neovim users with MCP-compatible plugins:

```lua
-- In your MCP configuration
{
  servers = {
    ["luqen"] = {
      command = "node",
      args = { "/path/to/luqen/packages/core/dist/mcp.js" },
    },
  },
}
```

### What you can do in your IDE

Once connected, your AI assistant has these capabilities:

| Ask this... | Tool used |
|-------------|-----------|
| "Scan example.com for accessibility issues" | `luqen_scan` |
| "What WCAG errors does our site have?" | `luqen_get_issues` |
| "Check if these issues violate EU law" | `compliance_check` |
| "Propose fixes for this file" | `luqen_propose_fixes` |
| "Fix the missing alt text on line 42" | `luqen_apply_fix` |
| "What regulations apply in Germany?" | `compliance_list_regulations` |
| "Check for any legal changes we should know about" | `monitor_scan_sources` |

For the full 20-tool reference, see [compliance/integrations/claude-code.md](compliance/integrations/claude-code.md).

---

## Next steps

| I want to... | Go to |
|--------------|-------|
| Understand the results | [USER-GUIDE.md](USER-GUIDE.md) |
| Use the in-dashboard agent companion | [guides/agent-companion.md](guides/agent-companion.md) |
| Connect an external MCP client (Claude Desktop, Cursor, Windsurf, custom) | [guides/mcp-integration.md](guides/mcp-integration.md) |
| Switch organisations as a global admin | [guides/multi-org-switching.md](guides/multi-org-switching.md) |
| Configure scanning options | [reference/core-config.md](reference/core-config.md) |
| Set up in CI/CD | [guides/ci-cd.md](guides/ci-cd.md) |
| Run the dashboard | [guides/dashboard-admin.md](guides/dashboard-admin.md) |

---

## Update & Restart

Pull the latest code, rebuild, and restart services:

```bash
cd ~/luqen
git pull
npm install
npm run build --workspaces
systemctl restart luqen-compliance luqen-llm luqen-dashboard
```

Or as a one-liner:

```bash
cd ~/luqen && git pull && npm install && npm run build --workspaces && systemctl restart luqen-compliance luqen-llm luqen-dashboard
```

### Service management

| Action | Command |
|--------|---------|
| **Status** | `systemctl status luqen-compliance luqen-llm luqen-dashboard` |
| **Dashboard logs** | `journalctl -u luqen-dashboard -f` |
| **Compliance logs** | `journalctl -u luqen-compliance -f` |
| **LLM logs** | `journalctl -u luqen-llm -f` |
| **Stop all** | `systemctl stop luqen-dashboard luqen-llm luqen-compliance` |
| **Start all** | `systemctl start luqen-compliance luqen-llm luqen-dashboard` |
| **Restart all** | `systemctl restart luqen-compliance luqen-llm luqen-dashboard` |
| **Disable auto-start** | `systemctl disable luqen-dashboard luqen-llm luqen-compliance` |

### Clean reinstall

```bash
systemctl stop luqen-dashboard luqen-llm luqen-compliance
systemctl disable luqen-dashboard luqen-llm luqen-compliance
rm -rf ~/luqen /etc/systemd/system/luqen-*.service
systemctl daemon-reload
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
```

---

## What's new in v3.1.0

- **Agent history** — stacked AI-titled conversation list with debounced search, infinite-scroll, resume, soft-delete + audit. See [guides/agent-history.md](guides/agent-history.md).
- **Multi-step tool use** — parallel-dispatch tool calls with shared 3-retry budget, 5-step iteration cap, chip-strip transparency UI. See [guides/multi-step-tools.md](guides/multi-step-tools.md).
- **Streaming UX + share permalinks** — stop / retry / edit-and-resend on the most-recent turn, copy-as-markdown, `/agent/share/:shareId` permalinks. See [guides/streaming-share-links.md](guides/streaming-share-links.md).
- **Multi-org switching** — native `<select>` switcher in the drawer header (admin.system only); JWT-driven `ToolContext.orgId`. See [guides/multi-org-switching.md](guides/multi-org-switching.md).

v3.0.0 (2026-04-24) shipped Streamable HTTP MCP endpoints + OAuth 2.1 + PKCE + DCR on every service plus the in-dashboard agent companion (text + speech, SSE streaming, native-dialog tool confirmation, persistent history, audit log).

For the per-version installer changelog see [deployment/installer-changelog.md](deployment/installer-changelog.md). For the full history see [CHANGELOG.md](../CHANGELOG.md).

> **Note:** Chromium is only required for the pa11y scanner (installed automatically by pa11y). The dashboard itself does not require Chromium.

---

*See also: [Docs home](README.md) | [USER-GUIDE.md](USER-GUIDE.md) | [guides/scanning.md](guides/scanning.md)*
