# Luqen

**Know exactly where your website breaks accessibility law — and fix it before anyone else notices.**

Luqen scans your entire website for WCAG violations and tells you which laws in which countries require you to fix each one. One scan covers 58 jurisdictions (EU, US, UK, and more), so your legal and dev teams see the same picture. Run it from the command line, a browser dashboard, an in-dashboard agent companion, or your IDE — it works for a solo developer checking one page or an enterprise team monitoring hundreds of sites across multiple languages.

![Version](https://img.shields.io/badge/version-v3.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Tests](https://img.shields.io/badge/tests-2300%2B%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-85%25%2B-brightgreen)
![WCAG](https://img.shields.io/badge/WCAG%202.1%20AA-verified-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)

---

## What's new in v3.1.0

- **Agent history** — stacked, AI-titled conversation list with debounced search, infinite-scroll pagination, resume, soft-delete + audit, and rename. See [docs/guides/agent-history.md](docs/guides/agent-history.md).
- **Multi-step tools** — parallel-dispatch tool calls with a shared 3-retry budget, a 5-step iteration cap, a chip-strip transparency UI, and rationale capture across providers. See [docs/guides/multi-step-tools.md](docs/guides/multi-step-tools.md).
- **Streaming UX + share permalinks** — stop / retry / edit-and-resend on the most-recent turn, copy-as-markdown, and org-scoped `/agent/share/:shareId` permalinks with default 30-day expiry. See [docs/guides/streaming-share-links.md](docs/guides/streaming-share-links.md).
- **Multi-org switching** — native `<select>` org switcher in the drawer header (admin.system only), force-new-conversation on switch, JWT-driven `ToolContext.orgId` propagation. See [docs/guides/multi-org-switching.md](docs/guides/multi-org-switching.md).

v3.0.0 (2026-04-24) shipped Streamable HTTP MCP endpoints + OAuth 2.1 + PKCE + DCR on every service, plus the in-dashboard agent companion (text + speech, SSE streaming, native-dialog tool confirmation, persistent history, audit log).

---

## What is Luqen?

Luqen is an enterprise accessibility platform that gives teams visibility into digital accessibility and guides them toward being more accessible and inclusive. It orchestrates site-wide WCAG scanning, maps violations to legal obligations across 58 jurisdictions, tracks issues through assignment and remediation workflows, and monitors regulatory changes — all through a unified dashboard, agent companion, CLI, MCP servers, and REST API.

Under the hood, Luqen uses the [pa11y](https://pa11y.org/) library directly and [axe-core](https://github.com/dequelabs/axe-core) for scanning, but wraps them in a complete platform: team management, role-based access, issue assignment lifecycles, scheduled scans, email reports, plugin ecosystem, and more. The goal is not just to find accessibility problems, but to help organizations systematically fix them.

> **Why "Luqen"?** A coined name, unique to this project. Pronounced "LOO-ken".

---

## Key Features

- **WCAG 2.1 AA verified** — all dashboard pages pass pa11y automated checks with correct color contrast, screen reader labels, and semantic markup.
- **Authenticated scanning** — scan pages behind login using custom HTTP headers or pa11y pre-scan actions.
- **Site-wide scanning** via built-in pa11y scanner — sitemap + crawl discovery, concurrency control, robots.txt respect.
- **Legal compliance checking** against 58 jurisdictions and 62 regulations (EU EAA, Section 508, ADA, UK Equality Act, RGAA, BITV, JIS X 8341-3, …).
- **Confirmed violations vs needs-review** — errors are confirmed violations; notices are flagged separately.
- **Source code mapping** — maps WCAG issues to source files in Next.js, Nuxt, SvelteKit, Angular, and plain HTML projects.
- **Git host integration** — GitHub, GitLab, Azure DevOps; per-developer PATs encrypted with AES-256-GCM; create PRs from accessibility fix proposals.
- **Auto-fix proposals** — generates unified diffs for common issues (missing `alt`, `aria-label`, `lang`).
- **Template issue deduplication** — issues on 3+ pages are grouped into "Template & Layout Issues", removing ~84% of duplicate noise.
- **Five interfaces** — CLI for humans, per-service Streamable HTTP MCP for external AI agents (OAuth 2.1 + PKCE + DCR), in-dashboard agent companion (text + speech), OAuth2 REST API with live `/docs` (Swagger UI), web dashboard.
- **Regulatory monitoring** — watches legal sources for changes and creates update proposals when regulations evolve.
- **Progressive authentication** — start with API key (solo), add local users (team), or install an SSO plugin (enterprise).
- **Per-org compliance tokens** — each organization can configure its own compliance API credentials, with global-token fallback.
- **Pluggable storage** — modular StorageAdapter with 14 repository interfaces; SQLite default, PostgreSQL and MongoDB available as plugins.
- **Security hardening** — @fastify/helmet (CSP, HSTS, X-Frame-Options), CSRF, XSS prevention, per-installation encryption salt, SSRF protection, global rate limiting, AES-256-GCM session cookies.
- **LLM service** — dedicated `@luqen/llm` microservice (port 4200) for provider management, model registry, and capability-based routing with automatic fallback chains. Supports OpenAI, Anthropic, Ollama, and any OpenAI-compatible endpoint. Capabilities: `extract-requirements`, `generate-fix`, `analyse-report`, `discover-branding`.
- **LLM-powered source intelligence** — upload regulation documents or add government source URLs; the LLM service routes extraction through the configured capability chain.
- **Plugin system** — 11 plugins in the [remote catalogue](https://github.com/trunten82/luqen-plugins): auth (Entra ID, Okta, Google), notifications (Slack, Teams, Email), storage (S3, Azure Blob); plus 3 built-in git host plugins.
- **Granular permissions** — fine-grained scopes (e.g. `users.create`, `users.delete`, `mcp.use`, `admin.org`, `admin.system`) assignable to custom roles.
- **Power BI custom connector** — Power Query M connector wrapping the Data API for scans, trends, compliance summary, and issues data sources.
- **IdP group → team sync** — auth plugins read group memberships from tokens and auto-sync to dashboard teams on SSO login.
- **Server-side PDF export** — PDFKit-based generation at `GET /api/v1/export/scans/:id/report.pdf` (no Chromium dependency).

---

## Agent companion

Luqen v3.0+ ships an in-dashboard conversational agent. Drawer-launched, text + speech input (Web Speech API where supported), SSE streaming, native-dialog confirmation for destructive tool calls, context hints (recent scans + active guidelines injected per turn), token-budget compaction at 85% of model max, persistent history with rolling 20-turn window, and an `/admin/audit` viewer with CSV export.

See [docs/guides/agent-companion.md](docs/guides/agent-companion.md) for the full surface (audience subsections for end users and admins).

---

## MCP integration

Every Luqen service (compliance, branding, llm, dashboard) exposes a Streamable HTTP MCP endpoint at `/api/v1/mcp` with OAuth 2.1 Authorization Code + PKCE + Dynamic Client Registration. External MCP clients — Claude Desktop, Cursor, Windsurf, IDE plugins — connect via the documented OAuth flow; tool visibility = RBAC ∩ scope, gated by the `mcp.use` permission per org.

See [docs/guides/mcp-integration.md](docs/guides/mcp-integration.md) for end-user and admin setup, including the `mcp-remote` bridge for stdio clients and direct Streamable HTTP for native clients.

The Luqen `@luqen/core` package also ships a stdio MCP server (`packages/core/dist/mcp.js`) for purely local scanning use; see [docs/QUICKSTART.md#ide-integration](docs/QUICKSTART.md#ide-integration) for that legacy path.

---

## Architecture

```
                       ┌──────────────────────────┐
    Users / CI   ────► │     @luqen/dashboard     │ ◄──── Plugins
    Web browser        │         (port 5000)      │       (auth · notify · storage)
    Power BI           │   Web UI · REST · MCP    │
                       │   Agent companion        │
                       │   Scan orchestrator      │
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
                  │   MCP    │ │   MCP    │ │   MCP    │
                  └────┬─────┘ └──────────┘ └────▲─────┘
                       │                         │
                       └──── LLM capabilities ───┘
                              (embedded lib)

       ┌─────────────────────┐         ┌─────────────────────┐
       │    @luqen/core      │         │   @luqen/monitor    │
       │  CLI · stdio MCP    │         │  watches legal src  │
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
| External MCP client | Any service `/api/v1/mcp` | Tool calls over Streamable HTTP, gated by OAuth 2.1 scopes + `mcp.use` |
| Core CLI | — | Scan sites locally with no backend dependency |

---

## Composition Paths

Pick the path that matches your use case:

| Path | Persona | Components | Time |
|------|---------|------------|------|
| Quick scan | Developer | Core CLI | 30 sec |
| IDE / agent integration | Developer | Per-service MCP + OAuth 2.1 | 5 min |
| CI/CD gate | Dev/QA | Core CLI | 10 min |
| Compliance check | Dev/Legal | Core + Compliance | 10 min |
| Compliance API | Automation | Compliance | 5 min |
| Full dashboard | All | All services | 15 min |
| Regulatory monitoring | Legal | Monitor + Compliance | 10 min |
| Everything | Org-wide | All packages | 5 min |

See [docs/paths/](docs/paths/) for detailed guides on each path.

---

## Quick start

The canonical end-to-end install walkthrough lives at
[docs/getting-started/installation.md](docs/getting-started/installation.md), with
per-environment-variable detail in
[docs/deployment/installer-env-vars.md](docs/deployment/installer-env-vars.md) and
the per-version installer changelog at
[docs/deployment/installer-changelog.md](docs/deployment/installer-changelog.md).

### One-line install (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
```

The wizard offers three modes:

| Mode | What it installs | Best for |
|------|-----------------|----------|
| **Developer tools** | CLI only (`luqen` command) | Quick scans from the terminal |
| **Full platform** | All services on bare metal (systemd / launchd / NSSM) | Production servers without Docker |
| **Docker** | All services via Docker Compose | Fastest full deployment |

macOS users run `install.command`; Windows users run `install.ps1`. All three scripts cover the v3.1.0 env-var set (including `*_PUBLIC_URL` for OAuth issuer + MCP discovery) and migrate to head migration 061 in one pass.

### Docker install

```bash
git clone https://github.com/trunten82/luqen.git
cd luqen
export SESSION_SECRET="$(openssl rand -base64 32)"
docker compose up -d
```

Services start on ports 4000 (compliance), 4100 (branding), 4200 (LLM), and 5000 (dashboard). Scanning is built in — no external pa11y-webservice required.

### CLI-only

```bash
cd packages/core && npm link
luqen scan https://example.com --format both
```

Reports are written to `./luqen-reports/`.

---

## Service setup

Each service follows the same pattern: generate JWT keys, create an OAuth2 client, then start. The end-to-end install guide covers this for all four services in one pass; per-service details live in the package READMEs:

| Service | Port | Setup guide |
|---------|------|-------------|
| `@luqen/compliance` | 4000 | [docs/reference/compliance-config.md](docs/reference/compliance-config.md) |
| `@luqen/branding` | 4100 | [docs/branding/README.md](docs/branding/README.md) |
| `@luqen/llm` | 4200 | [packages/llm/README.md](packages/llm/README.md) |
| `@luqen/dashboard` | 5000 | [docs/reference/dashboard-config.md](docs/reference/dashboard-config.md) |
| `@luqen/monitor` | — | [docs/reference/monitor-config.md](docs/reference/monitor-config.md) |

Live OpenAPI docs are served at `/docs` per service (Swagger UI). Committed JSON snapshots live under [docs/reference/openapi/](docs/reference/openapi/).

For the LLM service in particular, run `bash packages/llm/installer/install-llm.sh` from the project root for an interactive setup that configures JWT keys, an OAuth client, providers, and capability assignments.

---

## Update & restart

```bash
cd ~/luqen
git pull && npm install && npm run build --workspaces
systemctl restart luqen-compliance luqen-branding luqen-llm luqen-dashboard
```

For full service-management commands (status, logs, stop/start, disable, clean reinstall) see [docs/QUICKSTART.md#update--restart](docs/QUICKSTART.md#update--restart).

---

## Packages

| Package | Description | Docs |
|---------|-------------|------|
| [`@luqen/core`](packages/core) | Site scanner, source mapper, fix engine, CLI, stdio MCP server | [docs/reference/core-config.md](docs/reference/core-config.md) |
| [`@luqen/compliance`](packages/compliance) | Compliance rule engine, REST API, MCP endpoint, source intelligence | [docs/reference/compliance-config.md](docs/reference/compliance-config.md) |
| [`@luqen/branding`](packages/branding) | Brand-guideline matching service — colour, font, selector matching; image upload; scan retag | [docs/branding/README.md](docs/branding/README.md) |
| [`@luqen/dashboard`](packages/dashboard) | Web dashboard — scan management, agent companion, admin UI, MCP endpoint | [docs/reference/dashboard-config.md](docs/reference/dashboard-config.md) |
| [`@luqen/llm`](packages/llm) | LLM microservice — providers, model registry, capability-based routing with retry/fallback, per-org prompt overrides | [packages/llm/README.md](packages/llm/README.md) |
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

LLM providers (OpenAI, Anthropic, Ollama, OpenAI-compatible) are managed directly through the `@luqen/llm` service — no plugins required. Configure them from **Admin → LLM**.

See [docs/plugins/README.md](docs/plugins/README.md) for plugin development.

---

## Documentation

- **Start here:** [docs/README.md](docs/README.md) — full documentation index
- **Quick start:** [docs/QUICKSTART.md](docs/QUICKSTART.md) — get scanning in 5 minutes
- **End-user guide:** [docs/USER-GUIDE.md](docs/USER-GUIDE.md) — plain-language walkthrough
- **Install guide:** [docs/getting-started/installation.md](docs/getting-started/installation.md) — end-to-end v3.1.0 install
- **Guides:** [docs/guides/](docs/guides/) — narrative how-tos including [agent-companion.md](docs/guides/agent-companion.md), [mcp-integration.md](docs/guides/mcp-integration.md), [agent-history.md](docs/guides/agent-history.md), [multi-step-tools.md](docs/guides/multi-step-tools.md), [streaming-share-links.md](docs/guides/streaming-share-links.md), [multi-org-switching.md](docs/guides/multi-org-switching.md), [prompt-templates.md](docs/guides/prompt-templates.md)
- **Reference:** [docs/reference/](docs/reference/) — config + API + CLI reference, including the machine-generated [rbac-matrix.md](docs/reference/rbac-matrix.md) and per-service OpenAPI snapshots in [reference/openapi/](docs/reference/openapi/) (`compliance.json`, `branding.json`, `llm.json`, `dashboard.json`, `mcp.json`) — live `/docs` Swagger UI per service
- **Deployment:** [docs/deployment/](docs/deployment/) — Docker, Kubernetes, cloud, plus [installer-env-vars.md](docs/deployment/installer-env-vars.md) and [installer-changelog.md](docs/deployment/installer-changelog.md)
- **Security:** [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md)
- **Licensing:** [docs/LICENSING.md](docs/LICENSING.md)
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)

---

## Test suite

```bash
npm test --workspaces
```

The project maintains 85%+ statement coverage across 2,300+ tests. Run with coverage:

```bash
npm run test:coverage --workspaces
```

---

## Built on

Luqen is built on proven open-source components.

### Accessibility scanning

| Component | Role |
|-----------|------|
| [pa11y](https://github.com/pa11y/pa11y) | Core WCAG scanner — Luqen drives pa11y directly, no webservice required |
| [axe-core](https://github.com/dequelabs/axe-core) | Secondary accessibility rule engine (used via pa11y) |
| [Puppeteer](https://github.com/puppeteer/puppeteer) | Headless Chrome for page rendering during scans |

### Web framework

| Component | Role |
|-----------|------|
| [Fastify](https://fastify.dev) | HTTP server for the dashboard and all microservices |
| [@fastify/secure-session](https://github.com/fastify/fastify-secure-session) | Encrypted cookie sessions (AES-256-GCM) |
| [@fastify/csrf-protection](https://github.com/fastify/csrf-protection) | CSRF token generation and verification |
| [@fastify/helmet](https://github.com/fastify/fastify-helmet) | Security headers (CSP, HSTS, X-Frame-Options) |
| [@fastify/rate-limit](https://github.com/fastify/fastify-rate-limit) | Per-route rate limiting |
| [@fastify/multipart](https://github.com/fastify/fastify-multipart) | File upload handling (CSS import, fixtures) |
| [@fastify/swagger](https://github.com/fastify/fastify-swagger) | OpenAPI spec generation across all services |

### Frontend

| Component | Role |
|-----------|------|
| [HTMX](https://htmx.org) | Hypermedia-driven UI — partial page swaps without a JS build step |
| [Handlebars](https://handlebarsjs.com) | Server-side HTML templating |

### Database

| Component | Role |
|-----------|------|
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Synchronous SQLite driver — primary storage backend |
| [ioredis](https://github.com/redis/ioredis) | Redis client for job queues and distributed rate limiting |

### Auth & security

| Component | Role |
|-----------|------|
| [jose](https://github.com/panva/jose) | RS256 JWT signing and verification for OAuth2 service auth |
| [bcrypt](https://github.com/kelektiv/node.bcrypt.js) | Password hashing for local user accounts |
| [Zod](https://zod.dev) | Runtime schema validation for API inputs |

### AI / LLM

| Component | Role |
|-----------|------|
| [Ollama](https://ollama.com) | Local LLM inference — default provider for the `@luqen/llm` service |
| [OpenAI Node SDK](https://github.com/openai/openai-node) | API client for OpenAI and any OpenAI-compatible endpoint |

### Export & reporting

| Component | Role |
|-----------|------|
| [PDFKit](https://pdfkit.org) | Server-side PDF report generation (no Chromium dependency) |
| [ExcelJS](https://github.com/exceljs/exceljs) | Excel export for scan results and trends |

### Testing

| Component | Role |
|-----------|------|
| [Vitest](https://vitest.dev) | Unit and integration test runner |
| [Playwright](https://playwright.dev) | End-to-end browser testing |

---

## License

MIT — see [LICENSE](LICENSE).
