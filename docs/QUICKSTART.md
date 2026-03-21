[Docs](README.md) > Quickstart

# Quickstart — Scan a site in 5 minutes

## What you need

- Node.js 20 or later
- A running pa11y webservice (see below if you don't have one)

---

## Step 1 — Install

```bash
git clone https://github.com/alanna82/pally-agent.git
cd pally-agent
npm install
npm run build --workspaces
cd packages/core && npm link
```

After linking, `pally-agent` is a global command.

**Don't have a pa11y webservice?** The fastest way is Docker:

```bash
docker run -d -p 3000:3000 pally/webservice:latest
```

---

## Step 2 — Run your first scan

```bash
export DASHBOARD_WEBSERVICE_URL=http://localhost:3000   # dashboard uses DASHBOARD_WEBSERVICE_URL
export PALLY_WEBSERVICE_URL=http://localhost:3000       # CLI uses PALLY_WEBSERVICE_URL
pally-agent scan https://example.com
```

Output:
```
Discovering URLs from https://example.com...
Found 12 URLs to scan
[1/12] Scanning https://example.com/
[1/12] Done: https://example.com/
...
JSON report written to: ./pally-reports/pally-report-2026-03-18T120000Z.json
```

---

## Step 3 — View results

Open the HTML report:

```bash
pally-agent scan https://example.com --format both
open pally-reports/*.html
```

Or parse the JSON:

```bash
cat pally-reports/*.json | jq '.summary'
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
pally-agent scan https://example.com \
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
| **Solo developer** scanning your own site | **Local install + CLI** | Simplest. `npm install`, scan, done. No servers needed. Reports saved as JSON/HTML files. |
| **Solo developer** wanting AI integration | **Local install + MCP in your IDE** | Same as above, but your AI assistant (Claude/Cursor) can scan and fix for you. |
| **Small team** (2-5 developers) | **Docker Compose** (compliance + dashboard) | One `docker compose up`. Everyone accesses the dashboard at `http://your-server:5000`. Shared compliance data. |
| **Large team / enterprise** | **Kubernetes + Redis** | Full HA deployment. Shared Redis for caching/queues. Multiple dashboard replicas. SSO via OAuth2. |
| **CI/CD pipeline** | **CLI in Docker** | Run `pally-agent scan` as a pipeline step. Fail builds on violations. No servers needed — just the Docker image. |
| **Consultancy** scanning client sites | **Dashboard + compliance** (Docker or K8s) | Centralized scanning with compliance matrix. Generate reports per client per jurisdiction. |

For detailed setup instructions, see the [installation guides](getting-started/).

---

## IDE Integration

Pally Agent works as an MCP server inside any IDE that supports the Model Context Protocol. This gives your AI coding assistant 20 accessibility tools — scan sites, check compliance, propose fixes — all from your editor.

### VS Code (with Claude Code extension)

1. Install [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) from the VS Code marketplace
2. Add to `.claude/settings.json` in your project (or globally at `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "pally-agent": {
      "command": "node",
      "args": ["/path/to/pally-agent/packages/core/dist/mcp.js"]
    },
    "pally-compliance": {
      "command": "node",
      "args": ["/path/to/pally-agent/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "/path/to/pally-agent/packages/compliance/compliance.db"
      }
    }
  }
}
```

3. In Claude Code, ask: *"Scan https://my-site.com for accessibility issues and check compliance against EU regulations"*

### Cursor

1. Open Cursor Settings → MCP Servers
2. Add server with command: `node /path/to/pally-agent/packages/core/dist/mcp.js`
3. Add a second server for compliance: `node /path/to/pally-agent/packages/compliance/dist/cli.js mcp`
4. The tools appear automatically in Cursor's AI chat — ask it to scan, check compliance, or fix issues

### Windsurf

1. Open Settings → MCP
2. Add the same server commands as Cursor above
3. Use in Cascade: *"Run an accessibility audit on our staging site"*

### JetBrains IDEs (IntelliJ, WebStorm, PyCharm)

JetBrains IDEs support MCP via the [AI Assistant plugin](https://plugins.jetbrains.com/plugin/22282-ai-assistant):

1. Settings → AI Assistant → MCP Servers
2. Add: command `node`, args `["/path/to/pally-agent/packages/core/dist/mcp.js"]`
3. Use in the AI chat panel

### Neovim (with avante.nvim or similar)

For Neovim users with MCP-compatible plugins:

```lua
-- In your MCP configuration
{
  servers = {
    ["pally-agent"] = {
      command = "node",
      args = { "/path/to/pally-agent/packages/core/dist/mcp.js" },
    },
  },
}
```

### What you can do in your IDE

Once connected, your AI assistant has these capabilities:

| Ask this... | Tool used |
|-------------|-----------|
| "Scan example.com for accessibility issues" | `pally_scan` |
| "What WCAG errors does our site have?" | `pally_get_issues` |
| "Check if these issues violate EU law" | `compliance_check` |
| "Propose fixes for this file" | `pally_propose_fixes` |
| "Fix the missing alt text on line 42" | `pally_apply_fix` |
| "What regulations apply in Germany?" | `compliance_list_regulations` |
| "Check for any legal changes we should know about" | `monitor_scan_sources` |

For the full 20-tool reference, see [compliance/integrations/claude-code.md](compliance/integrations/claude-code.md).

---

## Next steps

| I want to... | Go to |
|--------------|-------|
| Understand the results | [USER-GUIDE.md](USER-GUIDE.md) |
| Configure scanning options | [reference/core-config.md](reference/core-config.md) |
| Use with Claude Code | [compliance/integrations/claude-code.md](compliance/integrations/claude-code.md) |
| Set up in CI/CD | [guides/ci-cd.md](guides/ci-cd.md) |
| Run the dashboard | [guides/dashboard-admin.md](guides/dashboard-admin.md) |

---

## New in v0.15.0

- **Org-wide accessibility score** — a 0-100 score aggregated across all scanned sites, with trend tracking over time.
- **Scan scheduling** — configure daily, weekly, or monthly recurring scans from the dashboard. No external cron needed.
- **Issue assignment lifecycle** — assign issues to team members and track them through open, assigned, in-progress, fixed, and verified states.
- **Connected repos with fix proposals** — link GitHub/GitLab repos to receive AI-generated fix suggestions (21 proposal types via MCP/A2A integration).
- **Enhanced manual testing** — step-by-step guides with good/bad examples for each manual check criterion.
- **Report comparison improvements** — side-by-side delta view with regression alerts when new issues appear.
- **Role-based UX** — four default personas (admin, developer, user, executive) with tailored navigation and default views.
- **Customizable roles & permissions** — DB-driven roles with 15 granular permissions across 7 groups. Create custom roles or modify system role permissions via Admin > Roles.
- **UI polish** — page transition animations, empty-state illustrations, and skeleton loading placeholders.

## New in v0.14.0

- **REST API** — 5 JSON endpoints at `/api/v1/*` for external data consumption (Power BI, custom integrations). Auth via `X-API-Key` header, rate limited 60/min.
- **CSV export** — download scans, issues, and trend data as CSV from the dashboard UI or via `/api/v1/export/*` endpoints.
- **Power BI integration** — connect Power BI directly to the data API. See [API Reference](reference/api-reference.md#power-bi-integration).

## New in v0.13.0

- **Runner selection** — choose between HTML_CodeSniffer and axe-core via `--runner axe` (CLI), `DASHBOARD_SCANNER_RUNNER` (env), or the scan form dropdown.
- **Incremental scanning** — re-scan only pages whose content has changed (SHA-256 content hash delta detection). Enable with the "Incremental scan" checkbox in the dashboard.
- **Trend tracking** — view error/warning/notice trends over time at `/reports/trends`, with executive summary cards on the home page.
- **Print/PDF export** — open `/reports/:id/print` for a print-optimized view; use your browser's Print dialog to save as PDF.
- **Manual testing checklists** — 27 WCAG 2.1 AA criteria at `/reports/:id/manual` with pass/fail/NA recording per scan.
- **Browser bookmarklet** — drag-to-install from `/tools/bookmarklet`; pre-fills the scan form with the current page URL.
- **Multi-worker scaling** — distribute scans across multiple pa11y webservice instances via `DASHBOARD_WEBSERVICE_URLS`.

---

*See also: [Docs home](README.md) | [USER-GUIDE.md](USER-GUIDE.md) | [guides/scanning.md](guides/scanning.md)*
