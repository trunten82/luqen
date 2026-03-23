[Docs](README.md) > Architecture

# Architecture

System design, data flow, and technology stack for the luqen monorepo.

---

## System overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         luqen monorepo                           │
│                                                                  │
│  ┌───────────────────────────┐  ┌──────────────────────────────┐ │
│  │   @luqen/dashboard        │  │   Plugin Catalogue           │ │
│  │                           │  │   (GitHub: luqen-plugins)    │ │
│  │  Web UI + REST API        │◄─┤                              │ │
│  │  ─ start scans            │  │  catalogue.json              │ │
│  │  ─ view reports           │  │  8 plugin tarballs (.tgz)    │ │
│  │  ─ manage plugins         │  └──────────────────────────────┘ │
│  │  ─ team & role admin      │                                   │
│  │  ─ HTMX, no JS build step│  ┌──────────────────────────────┐ │
│  │                           │  │   Plugins (installed)        │ │
│  │  StorageAdapter (14 repos)│◄─┤  auth: entra, okta, google   │ │
│  │  SQLite (built-in)        │  │  notify: slack, teams, email │ │
│  └──────────┬────────────────┘  │  storage: s3, azure          │ │
│             │ HTTP (REST)       └──────────────────────────────┘ │
│             ▼                                                    │
│  ┌───────────────────────────┐  ┌───────────────────────────┐   │
│  │  @luqen/compliance        │  │   @luqen/monitor          │   │
│  │  ─ 58 jurisdictions       │◄─┤  ─ watches legal sources  │   │
│  │  ─ 62 regulations         │  │  ─ creates proposals      │   │
│  │  ─ OAuth2 / JWT auth      │  │  ─ SHA-256 change detect  │   │
│  └──────────┬────────────────┘  └───────────────────────────┘   │
│             │ uses as library                                    │
│             ▼                                                    │
│  ┌───────────────────────────┐                                   │
│  │   @luqen/core             │  CLI + MCP server                 │
│  │  ─ site scan & crawl      │  ─ source mapping                 │
│  │  ─ fix proposals          │  ─ HTML/JSON reports              │
│  │  ─ pa11y (built-in)       │                                   │
│  └───────────────────────────┘                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Packages

| Package | Purpose | Port | Binary |
|---------|---------|------|--------|
| `@luqen/core` | Site scanner, source mapper, fix engine, CLI, MCP | — | `luqen` |
| `@luqen/compliance` | Rule engine, REST API, MCP, A2A agent | 4000 | `luqen-compliance` |
| `@luqen/dashboard` | Web UI for scans, reports, admin | 5000 | `luqen-dashboard` |
| `@luqen/monitor` | Regulatory change monitor | — | `luqen-monitor` |

---

## Communication protocols

| From | To | Protocol | Purpose |
|------|----|----------|---------|
| `core` | `pa11y` (built-in) | Library call | Run accessibility tests directly (no external service needed) |
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
1. User runs: luqen scan https://example.com

2. Discovery
   ├── Fetch /robots.txt → extract Disallow rules + Sitemap directive
   ├── Fetch /sitemap.xml → extract <loc> URLs (recursive for sitemap index)
   └── (optional) BFS crawl → follow <a href> links, same domain only

3. Scan
   ├── For each URL (up to concurrency limit):
   │   ├── Run pa11y directly (built-in library call)
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
   ├── Write JSON: luqen-report-<timestamp>.json
   └── Write HTML: luqen-report-<timestamp>.html (self-contained)
```

---

## Core package internals

```
@luqen/core
├── Interfaces
│   ├── CLI (commander)        — luqen scan / fix
│   └── MCP server (stdio)     — 6 tools for AI agents
│
└── Core library
    ├── Discovery              — robots.txt, sitemap, BFS crawl
    ├── Scanner                — pa11y library (built-in), concurrency, retry
    ├── Reporter               — JSON schema, HTML template, template dedup
    ├── Source Mapper          — framework detection, URL→file mapping
    ├── Fix Engine             — diff generation, interactive / MCP application
    └── Config Manager         — file discovery, env overrides, precedence
```

---

## Dashboard storage architecture

The dashboard uses a **StorageAdapter** pattern for all database operations. The `StorageAdapter` interface defines 14 domain repositories, each encapsulating a specific data domain:

```
StorageAdapter
├── connect() / disconnect() / migrate() / healthCheck()
│
├── scans: ScanRepository
├── users: UserRepository
├── organizations: OrgRepository
├── schedules: ScheduleRepository
├── assignments: AssignmentRepository
├── repos: RepoRepository
├── roles: RoleRepository
├── teams: TeamRepository
├── email: EmailRepository
├── audit: AuditRepository
├── plugins: PluginRepository
├── apiKeys: ApiKeyRepository
├── pageHashes: PageHashRepository
└── manualTests: ManualTestRepository
```

The built-in `SqliteStorageAdapter` implements all 14 repositories using better-sqlite3. The `resolveStorageAdapter()` factory in `packages/dashboard/src/db/factory.ts` selects the adapter based on a `StorageConfig` object. PostgreSQL and MongoDB adapters are planned as plugins.

All dashboard routes and services depend on the `StorageAdapter` interface — never on a concrete database implementation. This makes the storage backend fully swappable without changing business logic.

---

## Plugin system architecture

Plugins extend the dashboard with authentication providers, notification channels, and storage backends. They are distributed via a remote catalogue hosted on GitHub and installed as tarballs — no npm required.

```
Discovery:   GitHub repo (trunten82/luqen-plugins)
               │
               ▼
             catalogue.json ──→ Dashboard fetches (1hr cache, local fallback)
               │
Install:     Download .tgz from GitHub release
               │
               ▼
             Verify SHA-256 checksum
               │
               ▼
             Extract to pluginsDir/packages/{name}/
               │
Activate:    dynamic import(pluginPath) → instance.activate(config)
               │
Runtime:     PluginManager holds activeInstances map
             Background health checks every 30s
             Auto-deactivate on repeated failures
```

**Plugin types:**

| Type | Interface | Methods |
|------|-----------|---------|
| Auth | `AuthPlugin` | authenticate, getLoginUrl, handleCallback, getUserInfo, getLogoutUrl, refreshToken |
| Notification | `NotificationPlugin` | send(event) |
| Storage | `StoragePlugin` | save, load, delete |
| Scanner | `ScannerPlugin` | evaluate, rules |

**Key files:**
- `src/plugins/manager.ts` — lifecycle: install, configure, activate, deactivate, remove, health
- `src/plugins/registry.ts` — async remote catalogue fetch with cache + fallback
- `src/plugins/crypto.ts` — AES-256-GCM encryption for plugin config secrets
- `src/plugins/types.ts` — all plugin interfaces
- `plugin-registry.json` — local fallback catalogue
- `scripts/build-plugin-tarball.sh` — build distributable plugin tarballs

See [docs/plugins/README.md](../plugins/README.md) for the full plugin development guide.

---

## Compliance service internals

```
@luqen/compliance
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
    └── Database               — SQLite (better-sqlite3)
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
| Database (compliance) | SQLite (better-sqlite3) |
| Database (dashboard) | SQLite via StorageAdapter (14 repositories); PostgreSQL/MongoDB plugins planned |
| Authentication | OAuth2 (client credentials + PKCE), RS256 JWT; pluggable SSO via auth plugins |
| Plugin distribution | Remote catalogue (GitHub), tarball download, SHA-256 verified |
| Accessibility scanner | pa11y library (direct, built-in); optional pa11y-webservice fallback |
| HTML parsing (crawl) | cheerio |
| Testing | Vitest |
| Build | tsc |
| Container | Docker, Docker Compose |
| Orchestration | Kubernetes + Kustomize |

---

## Package dependency graph

```
@luqen/dashboard
    └── depends on @luqen/compliance (HTTP REST client)
    └── depends on @luqen/core (Node.js library import)

@luqen/monitor
    └── depends on @luqen/compliance (HTTP REST client)

@luqen/core
    └── no internal dependencies (standalone)

@luqen/compliance
    └── no internal dependencies (standalone)
```

---

## MCP tool inventory

| Server | Tools | Description |
|--------|-------|-------------|
| `luqen` (core) | `luqen_scan` | Site-wide scan with discovery |
| | `luqen_get_issues` | Filter issues from a report |
| | `luqen_propose_fixes` | Generate fix proposals |
| | `luqen_apply_fix` | Apply a single fix |
| | `luqen_raw` | Single-page pa11y passthrough |
| | `luqen_raw_batch` | Multi-page pa11y passthrough |
| `luqen-compliance` | `compliance_check` | Check issues against jurisdictions |
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
| `luqen-monitor` | `monitor_scan_sources` | Scan all monitored sources |
| | `monitor_status` | Show source count and pending proposals |
| | `monitor_add_source` | Add a source to monitor |

**Total: 20 MCP tools** across 3 servers.

---

*See also: [Docs home](README.md) | [integrations/claude-code.md](integrations/claude-code.md) | [integrations/api-reference.md](integrations/api-reference.md)*
