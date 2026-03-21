# Luqen

**Digital accessibility platform — scan, track, and guide teams toward WCAG compliance.**

![Version](https://img.shields.io/badge/version-v1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Tests](https://img.shields.io/badge/tests-1025%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)

---

## What is Luqen?

Luqen is an enterprise accessibility platform that gives teams visibility into digital accessibility and guides them toward being more accessible and inclusive. It orchestrates site-wide WCAG scanning, maps violations to legal obligations across 58 jurisdictions, tracks issues through assignment and remediation workflows, and monitors regulatory changes — all through a unified dashboard, CLI, MCP server, and REST API.

Under the hood, Luqen uses [pa11y](https://pa11y.org/) and [axe-core](https://github.com/dequelabs/axe-core) for scanning, but wraps them in a complete platform: team management, role-based access, issue assignment lifecycles, scheduled scans, email reports, plugin ecosystem, and more. The goal is not just to find accessibility problems, but to help organizations systematically fix them.

> **Why "Luqen"?** A coined name, unique to this project. Pronounced "LOO-ken".

---

## Key Features

- **Site-wide scanning** via pa11y webservice — sitemap + crawl discovery, concurrency control, robots.txt respect
- **Legal compliance checking** against 58 jurisdictions and 62 regulations (EU EAA, Section 508, ADA, UK Equality Act, RGAA, BITV, JIS X 8341-3, and more)
- **Confirmed violations vs needs-review** — errors are confirmed violations; notices are flagged separately, never inflating the violation count
- **Source code mapping** — maps WCAG issues to source files in Next.js, Nuxt, SvelteKit, Angular, and plain HTML projects
- **Auto-fix proposals** — generates unified diffs for common issues (missing `alt`, missing `aria-label`, missing `lang`)
- **Template issue deduplication** — issues appearing on 3+ pages are grouped into a "Template & Layout Issues" section, eliminating ~84% of duplicate noise
- **WCAG hyperlinks** — every criterion links to the official W3C Understanding WCAG 2.1 page
- **Regulation hyperlinks** — regulation badges link to official legal texts (EUR-Lex, govinfo.gov, legislation.gov.uk, etc.)
- **Professional HTML reports** — dark mode, print-friendly, filterable by severity and jurisdiction
- **Four interfaces** — CLI for humans, MCP server for AI agents (Claude Code), OAuth2 REST API with OpenAPI/Swagger, web dashboard
- **Regulatory monitoring** — watches legal sources for changes and creates update proposals when regulations evolve
- **WAF detection** — detects and reports when a Web Application Firewall blocks scanning
- **Progressive authentication** — starts with API key (solo mode), add local users (team mode), or install an SSO plugin (enterprise mode) — no external auth service required
- **Plugin system** — extensible via plugins for authentication (Entra ID, Okta, Google), notifications (Slack, Teams), storage (S3, Azure Blob), and custom scanners; managed via dashboard UI, CLI, or REST API

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      luqen monorepo                    │
│                                                              │
│  ┌───────────────────────────┐                               │
│  │   @luqen/dashboard  │  Web UI (browser)             │
│  │                           │  ─ start scans, view reports  │
│  │  luqen-dashboard serve    │  ─ HTMX, no JS build step     │
│  │  luqen-dashboard migrate  │  ─ admin: jurisdictions,      │
│  └──────────┬────────────────┘    users, webhooks, health    │
│             │ HTTP (REST)                                     │
│             ▼                                                │
│  ┌───────────────────────────┐  ┌───────────────────────────┐│
│  │  @luqen/compliance  │  │   @luqen/monitor    ││
│  │                           │  │                           ││
│  │  luqen-compliance serve   │  │  luqen-monitor scan       ││
│  │  luqen-compliance mcp     │  │  luqen-monitor mcp        ││
│  │  ─ 58 jurisdictions       │◄─┤  ─ watches legal sources  ││
│  │  ─ 62 regulations         │  │  ─ creates proposals      ││
│  │  ─ OAuth2 / JWT auth      │  │  ─ SHA-256 change detect  ││
│  └──────────┬────────────────┘  └───────────────────────────┘│
│             │ uses as library                                 │
│             ▼                                                │
│  ┌───────────────────────────┐                               │
│  │   @luqen/core       │  CLI + MCP server             │
│  │                           │  ─ site scan & crawl          │
│  │  luqen scan ...     │  ─ source mapping             │
│  │  luqen fix  ...     │  ─ fix proposals              │
│  └──────────┬────────────────┘  ─ HTML/JSON reports          │
│             │ HTTP                                            │
│             ▼                                                │
│  ┌───────────────────────────┐                               │
│  │   pa11y webservice        │  External service             │
│  │   (Docker / remote)       │  (not in this repo)           │
│  └───────────────────────────┘                               │
└──────────────────────────────────────────────────────────────┘
```

---

## Composition Paths

Pick the path that matches your use case:

| Path | Persona | Components | Time |
|------|---------|------------|------|
| Quick scan | Developer | Core CLI | 30 sec |
| IDE integration | Developer | Core MCP | 5 min |
| CI/CD gate | Dev/QA | Core CLI | 10 min |
| Compliance check | Dev/Legal | Core + Compliance | 10 min |
| Compliance API | Automation | Compliance | 5 min |
| Full dashboard | All | All services | 15 min |
| Regulatory monitoring | Legal | Monitor + Compliance | 10 min |
| Everything | Org-wide | All packages | 5 min |

See [docs/paths/](docs/paths/) for detailed guides on each path.

---

## Quick Start

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for the full step-by-step guide.

```bash
git clone https://github.com/trunten82/luqen.git
cd luqen && npm install && npm run build --workspaces
cd packages/core && npm link

export PALLY_WEBSERVICE_URL=http://localhost:3000
luqen scan https://example.com --format both
```

Reports are written to `./luqen-reports/`.

---

## Packages

| Package | Description | Docs |
|---------|-------------|------|
| [`@luqen/core`](packages/core) | Site scanner, source mapper, fix engine, CLI, MCP server | [docs/reference/core-config.md](docs/reference/core-config.md) |
| [`@luqen/compliance`](packages/compliance) | Compliance rule engine, REST API, MCP server | [docs/reference/compliance-config.md](docs/reference/compliance-config.md) |
| [`@luqen/dashboard`](packages/dashboard) | Web dashboard — scan management, report browser, admin UI | [docs/reference/dashboard-config.md](docs/reference/dashboard-config.md) |
| [`@luqen/monitor`](packages/monitor) | Regulatory monitor agent — watches legal sources, creates update proposals | [docs/reference/monitor-config.md](docs/reference/monitor-config.md) |
| [`@luqen/plugin-auth-entra`](packages/plugin-auth-entra) | Azure Entra ID SSO plugin for dashboard enterprise auth | [docs/paths/enterprise-sso.md](docs/paths/enterprise-sso.md) |

---

## Compliance Service Setup

```bash
cd packages/compliance

# 1. Generate JWT signing keys (required before first start)
node dist/cli.js keys generate

# 2. Seed baseline data (58 jurisdictions, 62 regulations)
node dist/cli.js seed

# 3. Start the server (REST + MCP + A2A on port 4000)
node dist/cli.js serve --port 4000

# 4. Create an OAuth2 client for the core scanner
node dist/cli.js clients create \
  --name "luqen" \
  --scope "read" \
  --grant client_credentials
```

The REST API is documented at `http://localhost:4000/docs` (Swagger UI).

---

## Dashboard

The dashboard is a browser-based UI for managing accessibility scans and administering the compliance service. No JavaScript build step — it uses HTMX for live updates.

```bash
# Generate a session secret (required)
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"

# Start all services (compliance + dashboard)
docker compose up -d
```

Open `http://localhost:5000` and log in with a compliance service user account. See [docs/reference/dashboard-config.md](docs/reference/dashboard-config.md) for the full guide.

---

## Monitor Agent

The regulatory monitor agent (`@luqen/monitor`) watches monitored legal sources for content changes and creates UpdateProposals in the compliance service when a change is detected.

```bash
cd packages/monitor
npm run build

# Run a one-off scan of all monitored sources
node dist/cli.js scan

# Show status (source count, last scan, pending proposals)
node dist/cli.js status

# Or if installed globally via npm link
luqen-monitor scan
luqen-monitor status

# Start MCP server for Claude Code
luqen-monitor mcp
```

Set environment variables before running:

```bash
export MONITOR_COMPLIANCE_URL=http://localhost:4000
export MONITOR_COMPLIANCE_CLIENT_ID=<client-id>
export MONITOR_COMPLIANCE_CLIENT_SECRET=<client-secret>
```

---

## Docker

```bash
docker compose up
```

This starts the compliance service (port 4000) and the dashboard (port 5000). For pa11y webservice, run it separately and set `PALLY_WEBSERVICE_URL` in a `.env` file.

---

## Claude Code Integration

Add all MCP servers to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "luqen": {
      "command": "node",
      "args": ["/root/luqen/packages/core/dist/mcp.js"]
    },
    "luqen-compliance": {
      "command": "node",
      "args": ["/root/luqen/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "/root/luqen/packages/compliance/compliance.db"
      }
    },
    "luqen-monitor": {
      "command": "node",
      "args": ["/root/luqen/packages/monitor/dist/cli.js", "mcp"],
      "env": {
        "MONITOR_COMPLIANCE_URL": "http://localhost:4000",
        "MONITOR_COMPLIANCE_CLIENT_ID": "<client-id>",
        "MONITOR_COMPLIANCE_CLIENT_SECRET": "<client-secret>"
      }
    }
  }
}
```

Build first: `npm run build --workspaces`

This gives Claude Code **20 MCP tools**: 6 for scanning/fixing (`luqen_scan`, `luqen_get_issues`, `luqen_propose_fixes`, `luqen_apply_fix`, `luqen_raw`, `luqen_raw_batch`), 11 for compliance (`compliance_check`, `compliance_list_jurisdictions`, `compliance_list_regulations`, and more), and 3 for regulatory monitoring (`monitor_scan_sources`, `monitor_status`, `monitor_add_source`).

---

## Documentation

- [docs/getting-started/](docs/getting-started/) — overview, quick scan, one-line install
- [docs/paths/](docs/paths/) — composition path guides for each use case
- [docs/reference/](docs/reference/) — config reference, API reference, CLI reference
- [docs/deployment/](docs/deployment/) — Docker, Kubernetes, cloud deployment
- [docs/QUICKSTART.md](docs/QUICKSTART.md) — get scanning in 5 minutes
- [docs/USER-GUIDE.md](docs/USER-GUIDE.md) — plain-language guide for non-technical users
- [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md) — security audit findings
- [docs/LICENSING.md](docs/LICENSING.md) — license details
- [CHANGELOG.md](CHANGELOG.md) — full version history

---

## Test Suite

```bash
npm test --workspaces
```

Expected output:
```
packages/core:              186 tests passing
packages/compliance:        424 tests passing
packages/dashboard:         315 tests passing
packages/monitor:            71 tests passing
packages/plugin-auth-entra:  29 tests passing
✓ 1025 tests passed
```

Run with coverage:

```bash
npm run test:coverage --workspaces
```

---

## License

MIT — see [LICENSE](LICENSE).
