[Docs](README.md) > Architecture

# Architecture

System design, data flow, and technology stack for the pally-agent monorepo.

---

## System overview

```
┌──────────────────────────────────────────────────────────────┐
│                      pally-agent monorepo                    │
│                                                              │
│  ┌───────────────────────────┐                               │
│  │   @pally-agent/dashboard  │  Web UI (browser)             │
│  │                           │  ─ start scans, view reports  │
│  │  pally-dashboard serve    │  ─ HTMX, no JS build step     │
│  │  pally-dashboard migrate  │  ─ admin: jurisdictions,      │
│  └──────────┬────────────────┘    users, webhooks, health    │
│             │ HTTP (REST)                                     │
│             ▼                                                │
│  ┌───────────────────────────┐                               │
│  │  @pally-agent/compliance  │  REST API + MCP server        │
│  │                           │  ─ 58 jurisdictions           │
│  │  pally-compliance serve   │  ─ 62 regulations             │
│  │  pally-compliance mcp     │  ─ OAuth2 / JWT auth          │
│  └──────────┬────────────────┘  ─ SQLite + OpenAPI           │
│             │ uses as library                                 │
│             ▼                                                │
│  ┌───────────────────────────┐                               │
│  │   @pally-agent/core       │  CLI + MCP server             │
│  │                           │  ─ site scan & crawl          │
│  │  pally-agent scan ...     │  ─ source mapping             │
│  │  pally-agent fix  ...     │  ─ fix proposals              │
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

## Packages

| Package | Purpose | Port | Binary |
|---------|---------|------|--------|
| `@pally-agent/core` | Site scanner, source mapper, fix engine, CLI, MCP | — | `pally-agent` |
| `@pally-agent/compliance` | Rule engine, REST API, MCP, A2A agent | 4000 | `pally-compliance` |
| `@pally-agent/dashboard` | Web UI for scans, reports, admin | 5000 | `pally-dashboard` |
| `@pally-agent/monitor` | Regulatory change monitor | — | `pally-monitor` |

---

## Communication protocols

| From | To | Protocol | Purpose |
|------|----|----------|---------|
| `core` | `pa11y webservice` | HTTP REST | Submit scan tasks, poll results |
| `core` | `compliance` | HTTP REST | Send issues for annotation after scan |
| `core` | `compliance` | A2A (HTTP + SSE) | Agent-to-agent task streaming |
| `dashboard` | `compliance` | HTTP REST | Auth delegation, admin CRUD |
| `dashboard` | `core` | Node.js library import | Orchestrate scans |
| Claude Code | `core` | MCP (stdio) | 6 scanning and fix tools |
| Claude Code | `compliance` | MCP (stdio) | 11 compliance tools |
| Claude Code | `monitor` | MCP (stdio) | 3 monitoring tools |
| External systems | `compliance` | HTTP REST + OAuth2 | n8n, Power Automate, custom clients |
| `compliance` | External systems | Webhooks (HTTPS POST) | Regulation change notifications |

---

## Data flow: scan to report

```
1. User runs: pally-agent scan https://example.com

2. Discovery
   ├── Fetch /robots.txt → extract Disallow rules + Sitemap directive
   ├── Fetch /sitemap.xml → extract <loc> URLs (recursive for sitemap index)
   └── (optional) BFS crawl → follow <a href> links, same domain only

3. Scan
   ├── For each URL (up to concurrency limit):
   │   ├── POST /tasks → pa11y webservice (submit scan)
   │   ├── GET /tasks/:id → poll with exponential backoff
   │   └── Collect results (issues, errors)
   └── Aggregate results

4. Enrichment (if --compliance-url is set)
   ├── Extract all WCAG issue codes
   ├── POST /api/v1/compliance/check → compliance service
   └── Merge regulation annotations + jurisdiction matrix into report

5. Template deduplication
   └── Issues appearing on 3+ pages (same code+selector+context)
       are moved to templateIssues array

6. Source mapping (if --repo is set)
   ├── Detect framework (Next.js, Nuxt, SvelteKit, Angular, HTML)
   ├── Map URL paths to source file paths
   └── Search source files for offending elements (CSS selector + context)

7. Report generation
   ├── Write JSON: pally-report-<timestamp>.json
   └── Write HTML: pally-report-<timestamp>.html (self-contained)
```

---

## Core package internals

```
@pally-agent/core
├── Interfaces
│   ├── CLI (commander)        — pally-agent scan / fix
│   └── MCP server (stdio)     — 6 tools for AI agents
│
└── Core library
    ├── Discovery              — robots.txt, sitemap, BFS crawl
    ├── Scanner                — pa11y webservice client, concurrency, retry
    ├── Reporter               — JSON schema, HTML template, template dedup
    ├── Source Mapper          — framework detection, URL→file mapping
    ├── Fix Engine             — diff generation, interactive / MCP application
    └── Config Manager         — file discovery, env overrides, precedence
```

---

## Compliance service internals

```
@pally-agent/compliance
├── Interfaces
│   ├── REST API (Fastify)     — OpenAPI 3.1, Swagger UI at /docs
│   ├── MCP server (stdio)     — 11 compliance tools
│   └── A2A agent              — /.well-known/agent.json, task endpoints
│
└── Core engine
    ├── Rule engine            — WCAG criterion extraction, wildcard matching
    ├── Jurisdiction resolver  — parent hierarchy (DE → EU)
    ├── Compliance checker     — matrix builder, obligation scoring
    ├── Update proposals       — propose/approve/reject workflow
    ├── Source monitor         — SHA-256 hash comparison, change detection
    └── Database adapters      — SQLite (default), MongoDB, PostgreSQL
```

---

## Technology stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.x, Node.js 20+ |
| CLI framework | commander |
| MCP | `@modelcontextprotocol/sdk` |
| HTTP server (compliance, A2A) | Fastify |
| HTTP server (dashboard) | Fastify + Handlebars + HTMX |
| Database (compliance) | SQLite (better-sqlite3), MongoDB, PostgreSQL |
| Database (dashboard) | SQLite |
| Authentication | OAuth2 (client credentials + PKCE), RS256 JWT |
| Accessibility scanner | pa11y via pa11y-webservice REST API |
| HTML parsing (crawl) | cheerio |
| Testing | Vitest |
| Build | tsc |
| Container | Docker, Docker Compose |
| Orchestration | Kubernetes + Kustomize |

---

## Package dependency graph

```
@pally-agent/dashboard
    └── depends on @pally-agent/compliance (HTTP REST client)
    └── depends on @pally-agent/core (Node.js library import)

@pally-agent/monitor
    └── depends on @pally-agent/compliance (HTTP REST client)

@pally-agent/core
    └── no internal dependencies (standalone)

@pally-agent/compliance
    └── no internal dependencies (standalone)
```

---

## MCP tool inventory

| Server | Tools | Description |
|--------|-------|-------------|
| `pally-agent` (core) | `pally_scan` | Site-wide scan with discovery |
| | `pally_get_issues` | Filter issues from a report |
| | `pally_propose_fixes` | Generate fix proposals |
| | `pally_apply_fix` | Apply a single fix |
| | `pally_raw` | Single-page pa11y passthrough |
| | `pally_raw_batch` | Multi-page pa11y passthrough |
| `pally-compliance` | `compliance_check` | Check issues against jurisdictions |
| | `compliance_list_jurisdictions` | List jurisdictions |
| | `compliance_list_regulations` | List regulations |
| | `compliance_list_requirements` | List WCAG requirements |
| | `compliance_get_regulation` | Get regulation + requirements |
| | `compliance_propose_update` | Submit a rule change proposal |
| | `compliance_get_pending` | List pending proposals |
| | `compliance_approve_update` | Approve and apply a proposal |
| | `compliance_list_sources` | List monitored sources |
| | `compliance_add_source` | Add a monitored source |
| | `compliance_seed` | Load baseline data |
| `pally-monitor` | `monitor_scan_sources` | Scan all monitored sources |
| | `monitor_status` | Show source count and pending proposals |
| | `monitor_add_source` | Add a source to monitor |

**Total: 20 MCP tools** across 3 servers.

---

*See also: [Docs home](README.md) | [integrations/claude-code.md](integrations/claude-code.md) | [integrations/api-reference.md](integrations/api-reference.md)*
