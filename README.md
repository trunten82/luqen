# Luqen

**Know exactly where your website breaks accessibility law — and fix it before anyone else notices.**

Luqen scans your entire website for WCAG violations and tells you which laws in which countries require you to fix each one. One scan covers 58 jurisdictions (EU, US, UK, and more), so your legal and dev teams see the same picture. Run it from the command line, a browser dashboard, or your IDE — it works for a solo developer checking one page or an enterprise team monitoring hundreds of sites across multiple languages.

![Version](https://img.shields.io/badge/version-v2.6.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Tests](https://img.shields.io/badge/tests-2232%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-85%25%2B-brightgreen)
![WCAG](https://img.shields.io/badge/WCAG%202.1%20AA-verified-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)

---

## What is Luqen?

Luqen is an enterprise accessibility platform that gives teams visibility into digital accessibility and guides them toward being more accessible and inclusive. It orchestrates site-wide WCAG scanning, maps violations to legal obligations across 58 jurisdictions, tracks issues through assignment and remediation workflows, and monitors regulatory changes — all through a unified dashboard, CLI, MCP server, and REST API.

Under the hood, Luqen uses the [pa11y](https://pa11y.org/) library directly and [axe-core](https://github.com/dequelabs/axe-core) for scanning, but wraps them in a complete platform: team management, role-based access, issue assignment lifecycles, scheduled scans, email reports, plugin ecosystem, and more. The goal is not just to find accessibility problems, but to help organizations systematically fix them.

> **Why "Luqen"?** A coined name, unique to this project. Pronounced "LOO-ken".

---

## Key Features

- **WCAG 2.1 AA verified** — all 21 dashboard pages pass pa11y automated checks with correct color contrast, screen reader labels, and semantic markup
- **Authenticated scanning** — scan pages behind login using custom HTTP headers or pa11y pre-scan actions (e.g., fill in a login form before testing)
- **Site-wide scanning** via built-in pa11y scanner — sitemap + crawl discovery, concurrency control, robots.txt respect (no external pa11y-webservice required)
- **Legal compliance checking** against 58 jurisdictions and 62 regulations (EU EAA, Section 508, ADA, UK Equality Act, RGAA, BITV, JIS X 8341-3, and more), with granular per-criterion obligation mapping sourced from W3C WAI, WCAG upstream, and tenon-io
- **Confirmed violations vs needs-review** — errors are confirmed violations; notices are flagged separately, never inflating the violation count
- **Source code mapping** — maps WCAG issues to source files in Next.js, Nuxt, SvelteKit, Angular, and plain HTML projects
- **Git host integration** — connect GitHub, GitLab, and Azure DevOps repositories as PluginManager plugins; per-developer PAT credentials encrypted with AES-256-GCM; create pull requests directly from accessibility fix proposals under the developer's own identity
- **Auto-fix proposals** — generates unified diffs for common issues (missing `alt`, missing `aria-label`, missing `lang`)
- **Template issue deduplication** — issues appearing on 3+ pages are grouped into a "Template & Layout Issues" section, eliminating ~84% of duplicate noise
- **WCAG hyperlinks** — every criterion links to the official W3C Understanding WCAG 2.1 page
- **Regulation hyperlinks** — regulation badges link to official legal texts (EUR-Lex, govinfo.gov, legislation.gov.uk, etc.)
- **Professional HTML reports** — dark mode, print-friendly, filterable by severity and jurisdiction
- **Trend charts with KPI cards** — track accessibility scores over time with key performance indicator cards showing score changes, issue counts, and pass/fail rates
- **Four interfaces** — CLI for humans, MCP server for AI agents (Claude Code), OAuth2 REST API with OpenAPI/Swagger, web dashboard
- **Regulatory monitoring** — watches legal sources for changes and creates update proposals when regulations evolve
- **WAF detection** — detects and reports when a Web Application Firewall blocks scanning
- **Progressive authentication** — starts with API key (solo mode), add local users (team mode), or install an SSO plugin (enterprise mode) — no external auth service required
- **Per-org compliance tokens** — each organization can configure its own compliance API credentials, with automatic fallback to the global token for single-tenant deployments
- **Pluggable storage** — modular StorageAdapter architecture with 14 repository interfaces backed by SQLite; PostgreSQL and MongoDB adapters coming as plugins
- **Security hardening** — @fastify/helmet security headers (CSP, HSTS, X-Frame-Options), CSRF token verification on state-changing requests, XSS prevention, per-installation encryption salt, SSRF protection on scan URLs, global rate limiting, secure session cookies (httpOnly, SameSite=Strict, AES-256-GCM encrypted)
- **LLM service** — dedicated `@luqen/llm` microservice (port 4200) for provider management, model registration, and capability-based routing with automatic fallback chains; supports OpenAI, Anthropic, Ollama, and any OpenAI-compatible endpoint; capabilities (`extract-requirements`, `generate-fix`, `analyse-report`, `discover-branding`) can each have multiple models assigned at different priorities — the service tries each in order and falls through on failure
- **LLM-powered source intelligence** — upload regulation documents or add government source URLs; the LLM service routes extraction requests through the configured capability chain, creating review proposals with trust levels (`certified` for W3C sources, `extracted` for LLM-parsed content)
- **Plugin system** — 11 plugins total: in the [remote catalogue](https://github.com/trunten82/luqen-plugins) for authentication (Entra ID, Okta, Google), notifications (Slack, Teams, Email), and storage (S3, Azure Blob), plus 3 built-in git host plugins (GitHub, GitLab, Azure DevOps); managed via dashboard UI, CLI, or REST API
- **Granular permissions** — fine-grained permission scopes for user management (`users.create`, `users.delete`, `users.activate`, `users.reset_password`, `users.roles`) assignable to custom roles
- **Power BI custom connector** — Power Query M connector (.mez) wrapping the Data API for scans, trends, compliance summary, and issues data sources in Power BI Desktop
- **IdP group → team sync** — auth plugins (Entra ID, Okta, Google) read group memberships from tokens and auto-sync to dashboard teams on SSO login
- **Server-side PDF export** — PDFKit-based PDF generation at `GET /api/v1/export/scans/:id/report.pdf` with email attachment integration (no Chromium dependency)

---

## Architecture

```
                       ┌──────────────────────────┐
    Users / CI   ────► │     @luqen/dashboard     │ ◄──── Plugins
    Web browser        │         (port 5000)      │       (auth · notify · storage)
    Power BI           │                          │
                       │   Web UI · REST · GraphQL│
                       │       Scan orchestrator  │
                       └──┬────────┬──────────┬───┘
                          │        │          │         All service calls over
                          ▼        ▼          ▼          OAuth2 + RS256 JWT
                  ┌──────────┐ ┌──────────┐ ┌──────────┐
                  │  @luqen  │ │  @luqen  │ │  @luqen  │
                  │compliance│ │ branding │ │   llm    │
                  │  (4000)  │ │  (4100)  │ │  (4200)  │
                  │          │ │          │ │          │
                  │ jurisdic.│ │  colors  │ │ providers│
                  │  regs.   │ │  fonts   │ │  models  │
                  │  WCAG    │ │  logos   │ │ routing  │
                  └────┬─────┘ └──────────┘ └────▲─────┘
                       │                         │
                       └──── LLM capabilities ───┘
                              (embedded lib)

       ┌─────────────────────┐         ┌─────────────────────┐
       │    @luqen/core      │         │   @luqen/monitor    │
       │  CLI · MCP server   │         │  watches legal src  │
       │  pa11y scanner      │         │  creates proposals  │
       └─────────────────────┘         └─────────────────────┘
```

**Request flow at a glance**

| From | To | Purpose |
|------|----|---------|
| Dashboard | Compliance | Check scans against WCAG obligations; map issues to regulations |
| Dashboard | Branding | Store guidelines; retag historical scans; discover brand from URL |
| Dashboard | LLM | AI fix suggestions · report summaries · brand discovery curation |
| Compliance | LLM | Route regulation extraction through capability chains (embedded library) |
| Monitor | Compliance | Submit update proposals when legal sources change |
| Core CLI | — | Scan sites locally with no backend dependency |

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

### One-line install (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
```

The installer wizard offers three modes:

| Mode | What it installs | Best for |
|------|-----------------|----------|
| **Developer tools** | CLI only (`luqen` command) | Quick scans from the terminal |
| **Full platform** | All services on bare metal (systemd) | Production servers without Docker |
| **Docker** | All services via Docker Compose | Fastest full deployment |

### Docker install

```bash
git clone https://github.com/trunten82/luqen.git
cd luqen
export SESSION_SECRET="$(openssl rand -base64 32)"
docker compose up -d
```

Services start on ports 4000 (compliance), 4100 (branding), 4200 (LLM), and 5000 (dashboard). No external pa11y-webservice needed — scanning is built in.

### Manual install

```bash
git clone https://github.com/trunten82/luqen.git
cd luqen && npm install && npm run build --workspaces
./start.sh
```

### CLI-only (no dashboard)

```bash
cd packages/core && npm link
luqen scan https://example.com --format both
```

No `LUQEN_WEBSERVICE_URL` needed — the scanner uses the pa11y library directly. Reports are written to `./luqen-reports/`.

---

## Update & Restart

```bash
cd ~/luqen
git pull
npm install
npm run build --workspaces
systemctl restart luqen-compliance luqen-branding luqen-llm luqen-dashboard
```

Or as a one-liner:

```bash
cd ~/luqen && git pull && npm install && npm run build --workspaces && systemctl restart luqen-compliance luqen-branding luqen-llm luqen-dashboard
```

### Service management

```bash
# Status
systemctl status luqen-compliance luqen-branding luqen-llm luqen-dashboard

# Logs
journalctl -u luqen-dashboard -f
journalctl -u luqen-compliance -f
journalctl -u luqen-branding -f
journalctl -u luqen-llm -f

# Stop / Start
systemctl stop luqen-dashboard luqen-llm luqen-branding luqen-compliance
systemctl start luqen-compliance luqen-branding luqen-llm luqen-dashboard

# Disable auto-start on boot
systemctl disable luqen-dashboard luqen-llm luqen-branding luqen-compliance
```

---

## Packages

| Package | Description | Docs |
|---------|-------------|------|
| [`@luqen/core`](packages/core) | Site scanner, source mapper, fix engine, CLI, MCP server | [docs/reference/core-config.md](docs/reference/core-config.md) |
| [`@luqen/compliance`](packages/compliance) | Compliance rule engine, REST API, MCP server, source intelligence pipeline | [docs/reference/compliance-config.md](docs/reference/compliance-config.md) |
| [`@luqen/branding`](packages/branding) | Brand guideline matching service — color, font, selector matching; image upload; scan retag | [docs/branding/README.md](docs/branding/README.md) |
| [`@luqen/dashboard`](packages/dashboard) | Web dashboard — scan management, report browser, brand filter, admin UI | [docs/reference/dashboard-config.md](docs/reference/dashboard-config.md) |
| [`@luqen/llm`](packages/llm) | LLM microservice (port 4200) — provider management (Ollama, OpenAI, any OpenAI-compatible endpoint), model registry, capability-based routing with retry/fallback chains, per-org prompt overrides, OAuth2/RS256 JWT auth. Capabilities: `extract-requirements` (regulation parsing), `generate-fix` (AI WCAG fix suggestions per issue), `analyse-report` (AI executive summary + recurring pattern detection across scan history), `discover-branding` (deterministic CSS extraction + LLM-curated brand colors/fonts/logo/description from any URL) | [packages/llm/README.md](packages/llm/README.md) |
| [`@luqen/monitor`](packages/monitor) | Regulatory monitor agent — watches legal sources, creates update proposals | [docs/reference/monitor-config.md](docs/reference/monitor-config.md) |

### Plugins (11 available)

Catalogue plugins are distributed via the [plugin catalogue](https://github.com/trunten82/luqen-plugins) and installed from the dashboard UI, CLI (`luqen-dashboard plugin install <name>`), or REST API. Git host plugins are built-in and auto-activated.

| Plugin | Type | Description |
|--------|------|-------------|
| auth-entra | Auth | Azure Entra ID SSO (MSAL) |
| auth-okta | Auth | Okta OIDC |
| auth-google | Auth | Google Workspace OAuth 2.0 |
| notify-slack | Notification | Slack webhook alerts |
| notify-teams | Notification | Microsoft Teams webhook alerts |
| notify-email | Notification | SMTP email reports |
| storage-s3 | Storage | AWS S3 report storage |
| storage-azure | Storage | Azure Blob report storage |
| git-host-github | Git Host | GitHub / GitHub Enterprise PR creation |
| git-host-gitlab | Git Host | GitLab / self-hosted merge request creation |
| git-host-azure-devops | Git Host | Azure DevOps pull request creation |

LLM providers (OpenAI, Anthropic, Ollama, OpenAI-compatible) are managed directly through the `@luqen/llm` service — no plugins required. Configure them from the dashboard **Admin → LLM** page.

Catalogue plugins live in the [luqen-plugins](https://github.com/trunten82/luqen-plugins) repository. See [docs/plugins/README.md](docs/plugins/README.md) for configuration details and plugin development guide.

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

## Branding Service

The branding service (`@luqen/branding`) classifies accessibility issues as brand-related or unexpected by matching scan findings against stored color palettes, font families, and CSS selector patterns. It runs as a standalone Fastify microservice on port 4100.

```bash
cd packages/branding

# 1. Generate JWT signing keys
node dist/cli.js keys generate

# 2. Create an OAuth client for the dashboard
node dist/cli.js clients create --name dashboard --scope "read write"

# 3. Start the service (REST API on port 4100)
node dist/cli.js serve --port 4100
```

Add the credentials to `dashboard.config.json` to enable post-scan brand enrichment and the brand filter in scan reports:

```json
{
  "branding": {
    "url": "http://localhost:4100",
    "clientId": "dashboard",
    "clientSecret": "your-secret-here"
  }
}
```

See [docs/branding/README.md](docs/branding/README.md) for the full guide including image upload, scan retag, matching strategies, and the multi-brand multi-site model.

---

## LLM Service

The LLM service (`@luqen/llm`) is a dedicated Fastify microservice for managing AI providers and routing capabilities with automatic fallback chains. It runs on port 4200.

```bash
cd packages/llm

# 1. Generate RS256 JWT keys
node dist/cli.js keys generate

# 2. Create an OAuth2 client for the dashboard
node dist/cli.js clients create --name dashboard --scopes read,write,admin

# 3. Start the service (REST API on port 4200)
node dist/cli.js serve --port 4200
```

Add the credentials to `dashboard.config.json` to enable the LLM admin page:

```json
{
  "llm": {
    "url": "http://localhost:4200",
    "clientId": "dashboard",
    "clientSecret": "your-secret-here"
  }
}
```

The LLM service manages four capabilities. Each can have multiple models assigned at different priority levels — the service tries each model in priority order and falls through to the next on failure or timeout.

| Capability | Endpoint | What it does |
|------------|----------|--------------|
| `extract-requirements` | `POST /api/v1/extract-requirements` | Parses regulation documents into structured WCAG criteria with obligation levels |
| `generate-fix` | `POST /api/v1/generate-fix` | Generates AI fix suggestions for individual WCAG issues — returns fixed HTML snippet, plain-English explanation, and effort level. Dashboard shows these on report detail pages with hardcoded pattern fallback |
| `analyse-report` | `POST /api/v1/analyse-report` | Produces an executive summary, key findings, and prioritised recommendations for a scan. Detects recurring patterns across scan history for the same site |
| `discover-branding` | `POST /api/v1/discover-branding` | Takes a URL and returns colors, fonts, logo URL, brand name, and description. Uses deterministic CSS/HTML extraction (top hex colors by frequency, font families, logo img tags, meta tags) as ground truth, then calls the LLM only to curate and name the results. Gracefully falls back to deterministic-only output if LLM fails |

All capabilities support per-org prompt overrides via the **Admin → LLM → Prompts** tab. All AI-generated content is marked with a disclaimer in the dashboard UI.

For guided setup, run `bash packages/llm/installer/install-llm.sh` from the project root — it configures JWT keys, an OAuth client, provider registration, and capability assignments interactively.

The interactive API docs are at `http://localhost:4200/api/v1/docs` (Swagger UI). See [packages/llm/README.md](packages/llm/README.md) for the full configuration, CLI reference, and capability API documentation.

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
export SESSION_SECRET="$(openssl rand -base64 32)"
docker compose up -d
```

This starts the compliance service (port 4000), the branding service (port 4100), the LLM service (port 4200), and the dashboard (port 5000). The scanner uses the pa11y library directly inside the container — no external pa11y-webservice is needed. If you have an existing pa11y-webservice you want to use instead, set `PA11Y_URL` in a `.env` file for backward compatibility.

---

## MCP Integration

Luqen includes MCP (Model Context Protocol) servers for AI-assisted accessibility scanning. See [docs/QUICKSTART.md](docs/QUICKSTART.md#ide-integration) for setup with VS Code, Cursor, Windsurf, JetBrains, and Neovim.

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

The project maintains 85%+ statement coverage across 1,918 tests with 0 failures:

```
npm test --workspaces
```

Run with coverage:

```bash
npm run test:coverage --workspaces
```

---

## License

MIT — see [LICENSE](LICENSE).
