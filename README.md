# Pally Agent

**Site-wide WCAG accessibility scanning with legal compliance mapping — CLI, MCP server, and REST API.**

![Version](https://img.shields.io/badge/version-v0.3.2-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Tests](https://img.shields.io/badge/tests-489%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)

---

## What is Pally Agent?

Running pa11y on one page at a time is tedious, and translating WCAG violations into legal obligations requires specialist knowledge of dozens of jurisdictions. Pally Agent orchestrates site-wide accessibility scanning via a pa11y webservice instance — discovering all pages, aggregating results, mapping issues to source files, and proposing concrete code fixes. The companion compliance service maps every WCAG violation to the regulations that require it across 58 jurisdictions and 62 regulations, so you know exactly what is a legal obligation and what is best practice.

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
- **Three interfaces** — CLI for humans, MCP server for AI agents (Claude Code), OAuth2 REST API with OpenAPI/Swagger
- **WAF detection** — detects and reports when a Web Application Firewall blocks scanning

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     pally-agent monorepo                │
│                                                         │
│  ┌──────────────────────────┐                           │
│  │   @pally-agent/core      │  CLI + MCP server         │
│  │                          │  ─ site scan & crawl      │
│  │  pally-agent scan ...    │  ─ source mapping         │
│  │  pally-agent fix  ...    │  ─ fix proposals          │
│  └──────────┬───────────────┘  ─ HTML/JSON reports      │
│             │ HTTP                                       │
│             ▼                                           │
│  ┌──────────────────────────┐                           │
│  │   pa11y webservice       │  External service         │
│  │   (Docker / remote)      │  (not in this repo)       │
│  └──────────────────────────┘                           │
│                                                         │
│  ┌──────────────────────────┐                           │
│  │  @pally-agent/compliance │  REST API + MCP server    │
│  │                          │  ─ 58 jurisdictions       │
│  │  pally-compliance serve  │  ─ 62 regulations         │
│  │  pally-compliance mcp    │  ─ OAuth2 / JWT auth      │
│  └──────────────────────────┘  ─ SQLite + OpenAPI       │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
git clone https://github.com/your-org/pally-agent.git
cd pally-agent
npm install
npm run build --workspaces

# Scan a site (requires pa11y webservice running)
cd packages/core
node dist/cli.js scan https://example.com --format json,html

# Or if installed globally via npm link
pally-agent scan https://example.com --format json,html

# Compliance-enriched scan
pally-agent scan https://example.com \
  --format both \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US,UK \
  --compliance-client-id $CLIENT_ID \
  --compliance-client-secret $CLIENT_SECRET
```

Reports are written to `./pally-reports/`.

---

## Packages

| Package | Description | Docs |
|---------|-------------|------|
| [`@pally-agent/core`](packages/core) | Site scanner, source mapper, fix engine, CLI, MCP server | [docs/README.md](docs/README.md) |
| [`@pally-agent/compliance`](packages/compliance) | Compliance rule engine, REST API, MCP server | [docs/compliance/README.md](docs/compliance/README.md) |

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
  --name "pally-agent" \
  --scope "read" \
  --grant client_credentials
```

The REST API is documented at `http://localhost:4000/docs` (Swagger UI).

---

## Docker

```bash
docker compose up
```

This starts pa11y webservice (port 3000) and the compliance service (port 4000).

---

## Claude Code Integration

Add both MCP servers to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "pally-agent": {
      "command": "node",
      "args": ["/root/pally-agent/packages/core/dist/mcp.js"]
    },
    "pally-compliance": {
      "command": "node",
      "args": ["/root/pally-agent/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "/root/pally-agent/packages/compliance/compliance.db"
      }
    }
  }
}
```

Build first: `npm run build --workspaces`

This gives Claude Code 17 tools: 6 for scanning/fixing (`pally_scan`, `pally_get_issues`, `pally_propose_fixes`, `pally_apply_fix`, `pally_raw`, `pally_raw_batch`) and 11 for compliance (`compliance_check`, `compliance_list_jurisdictions`, `compliance_list_regulations`, and more).

---

## Documentation

- [docs/README.md](docs/README.md) — full core package docs (CLI, MCP tools, source mapping, reports, configuration)
- [docs/compliance/README.md](docs/compliance/README.md) — compliance service docs (REST API, MCP tools, jurisdictions, regulations)

---

## Test Suite

```bash
npm test --workspaces
```

Expected output:
```
packages/core: 489 tests passing
packages/compliance: included in total
✓ 489 tests passed
```

Run with coverage:

```bash
npm run test:coverage --workspaces
```

---

## License

MIT — see [LICENSE](LICENSE).
