# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.10.0] - 2026-03-20

### Added
- Multi-tenancy: org-level data isolation with `org_id` column on all tables
- Organizations and org_members tables in dashboard database
- OrgDb class for organization CRUD and membership management
- Org-scoped scan CRUD (create, list, delete by org)
- Org-scoped compliance queries (jurisdictions, regulations, requirements, proposals, sources, webhooks)
- X-Org-Id header extraction in compliance service for cross-service org context
- DELETE /api/v1/orgs/:id/data endpoint for org data cleanup
- deleteOrgData() transactional cleanup across all compliance tables
- Organization management admin UI (create, list, delete orgs)
- Organization member management (add, remove, role assignment)
- Org switcher in dashboard sidebar (visible when user belongs to multiple orgs)
- Session org context with POST /orgs/switch endpoint
- GET /orgs/current JSON endpoint for org context
- Dashboard compliance client passes X-Org-Id header on all requests
- deleteOrgData() function in compliance client for org cleanup

### Changed
- ScanRecord now includes orgId field (defaults to 'system')
- All compliance filter interfaces support optional orgId
- All compliance create inputs support optional orgId
- Compliance route handlers pass org context from X-Org-Id header to database queries
- All dashboard routes pass orgId from session to compliance service and scan DB
- Sidebar shows Organizations link in admin section
- AuthUser interface extended with currentOrgId

---

## [0.9.0] - 2026-03-20

### Added
- Progressive authentication: Solo (API key) → Team (local users) → Enterprise (SSO)
- AuthService abstraction for pluggable authentication
- Dashboard users table with bcrypt password hashing
- API key generation on first start with CLI regeneration command
- Dashboard user management admin page
- Compliance service API key auth for service-to-service calls
- @pally-agent/plugin-auth-entra — Azure Entra ID SSO plugin
- SSO login flow with callback handling

### Changed
- Auth middleware refactored to delegate to AuthService
- Login page supports all three auth modes (API key, password, SSO buttons)
- Dashboard no longer requires compliance service for authentication

---

## [0.8.0] - 2026-03-20

### Added
- **Database migration framework** — versioned schema migrations with `pally-dashboard migrate`
- **Plugin system foundation** — `PluginManager` with install, configure, activate, deactivate, remove lifecycle; plugin registry with 7 built-in entries (3 auth, 2 notification, 2 storage)
- **Plugin marketplace UI** — Settings > Plugins page for browsing, installing, configuring, and activating plugins from the dashboard
- **Plugin CLI** — `pally-dashboard plugin list|install|configure|activate|deactivate|remove` subcommands
- **Plugin REST API** — `/api/v1/plugins/*` endpoints for programmatic plugin management (list, registry, install, config, activate, deactivate, remove, health)
- **AES-256-GCM encrypted plugin secrets** — config fields marked as `secret` are encrypted at rest
- **Plugin health checks** — periodic health monitoring with auto-deactivation after 3 consecutive failures
- **Auth middleware JSON API support** — admin guard returns JSON errors for API requests

---

## [0.7.0] - 2026-03-20

### Added
- User and Client REST API routes in compliance service
- Webhook test endpoint (POST /api/v1/webhooks/:id/test)
- PALLY_COMPLIANCE_URL env var for core → compliance integration
- Helpful pa11y webservice connection error with setup instructions
- Report "next steps" hints for progressive discovery
- Monitor standalone mode with .pally-monitor.json local config fallback
- Dashboard graceful degradation when compliance service unavailable
- Dynamic version strings (read from package.json at runtime)

### Fixed
- Health endpoint path mismatch (/health → /api/v1/health)
- K8s ingress rewrite-target breaking compliance API routing
- Dead sidebar link to /admin/requirements (route didn't exist)

### Removed
- Orphaned MongoDB and PostgreSQL adapter files
- Unused dependencies: mongodb, pg, @types/pg, jose
- Stale report-view.hbs template
- Dead config fields: dbAdapter, dbUrl, refreshTokenExpiry, a2a, ComplianceServiceVersion

### Documentation
- Restructured docs from component-based to path-based organization
- 5 path guides: developer CLI, IDE integration, compliance checking, full dashboard, regulatory monitoring
- 3 getting started guides: overview, quick scan, one-line install
- Consolidated MCP tools and CLI reference
- Fixed env var names, version numbers, test counts across all docs

---

## [0.6.0] - 2026-03-20

### Added

- **Dashboard self-audit** — `pally-dashboard self-audit` CLI command scans dashboard pages for WCAG 2.1 AA compliance, supports `--url`, `--port`, `--json` flags; exit code 1 when errors found
- **Report comparison** — side-by-side diff of two scan reports at `/reports/compare?a=...&b=...`, with checkboxes on reports list, summary delta cards, and new/resolved/unchanged issue tabs
- **Monitor admin UI** — `/admin/monitor` dashboard page showing source status, recent proposals, and HTMX "Trigger Scan" button
- **NPM publish prep** — all packages synced to v0.5.1, `publishConfig`, `types` fields, per-package README + LICENSE, root `.npmignore`, `scripts/publish.sh` dry-run script

### Changed

- All package versions bumped to 0.5.1 for registry publishing
- Dashboard test count: 91 → 145 (+54 tests)
- Total project tests: 704 → 758

---

## [0.5.0] - 2026-03-20

### Added

- **Regulatory monitor agent** (`@pally-agent/monitor`) — new package that watches monitored legal sources for content changes, computes SHA-256 hashes, and creates UpdateProposals in the compliance service when changes are detected
- **Monitor MCP server** — 3 tools: `monitor_scan_sources`, `monitor_status`, `monitor_add_source`
- **Monitor CLI** — `pally-monitor scan`, `pally-monitor status`, `pally-monitor mcp`, `pally-monitor serve` commands
- **Monitor A2A agent** — Agent-to-Agent protocol support via `/.well-known/agent.json` endpoint
- **npm publish preparation** — `package.json` metadata (description, keywords, repository, homepage), `LICENSE` file (MIT), and `.npmignore` files added to all publishable packages
- **Redis support** — optional Redis adapter for caching, job queue, and SSE broadcasting (used by compliance service and dashboard when `REDIS_URL` is set)

### Security

- **RSA private key removed** from repository history; keys are now generated at runtime with `pally-compliance keys generate` and stored outside the repo
- **CSRF protection** added to dashboard state-changing routes (SameSite=Strict cookies + origin validation)
- **bcrypt upgraded** from 5.1.1 to 6.x — resolves vulnerable `tar` transitive dependency

---

## [0.4.1] - 2026-03-20

### Added

- **Dashboard renders from JSON** — report viewer reads `.json` report files directly; no HTML file dependency required
- **Kubernetes manifests** — `k8s/` directory with Deployment, Service, and ConfigMap manifests for core, compliance, and dashboard; Kustomize overlays for `base`, `staging`, and `production`
- **Dashboard documentation** — `docs/dashboard/README.md` covering user guide, admin guide, configuration reference, Docker, and WCAG self-audit results
- **CHANGELOG** — this file; full version history from v0.1.0

---

## [0.4.0] - 2026-03-19

### Added

- **Web dashboard** (`@pally-agent/dashboard`) — new package providing a browser-based UI for the entire pally ecosystem
- **HTMX-powered interface** — server-rendered HTML with HTMX for interactivity, no JavaScript build step required
- **Authentication** — OAuth2 password grant flow via the compliance service; JWT stored in signed httpOnly cookies
- **Role-based access control** — three roles: `viewer` (browse reports), `user` (create scans), `admin` (full admin section)
- **New Scan form** — URL input, jurisdiction checkboxes (fetched live from compliance service), WCAG standard dropdown, concurrency slider
- **SSE scan progress** — real-time scan progress via Server-Sent Events (HTMX SSE extension); auto-redirects to report on completion
- **Reports list** — sortable, searchable, paginated table with live URL filtering (300 ms debounce, no page reload)
- **Report viewer** — HTML report embedded in dashboard layout with JSON/HTML download buttons
- **Report comparison** — side-by-side diff of two scans of the same site (new issues, resolved issues, score delta)
- **Admin: Jurisdictions** — full CRUD for compliance service jurisdictions via inline edit and HTMX modal forms
- **Admin: Regulations** — full CRUD for regulations, filterable by jurisdiction
- **Admin: Requirements** — CRUD for WCAG requirements per regulation
- **Admin: Update proposals** — review, approve, and reject compliance update proposals with before/after diff
- **Admin: Monitored sources** — list, add, delete, and trigger immediate scan of legal sources
- **Admin: Webhooks** — register, test, and delete outbound webhooks
- **Admin: Users** — create and deactivate compliance service user accounts
- **Admin: OAuth clients** — create (secret shown once) and revoke OAuth2 clients
- **Admin: System health** — service status cards, database stats, seed status, runtime info
- **Scan queue** — global semaphore limits concurrent scans to `maxConcurrentScans`; excess scans queue with `queued` status
- **Local SQLite** — `ScanRecord` table stores scan history, report paths, and issue counts
- **Docker support** — `Dockerfile` for the dashboard and `docker-compose.yml` updated to include dashboard service with health check and named volumes
- **CLI** — `pally-dashboard serve` and `pally-dashboard migrate` commands
- **WCAG 2.1 AA compliance** — self-audited; zero confirmed violations is the acceptance criterion

---

## [0.3.2] - 2026-03-19

### Fixed

- Confirmed violations are now distinguished from notices in compliance reports; notices no longer inflate the confirmed violation count
- WAF detection added to the scan crawl phase — sites blocking scanning with a Web Application Firewall are now detected and reported
- Website hostname included in report filenames (e.g. `example.com-2026-01-15T12-00-00.json`) so filenames are meaningful when multiple sites are scanned

### Changed

- Compliance integration improvements: errors are confirmed violations; notices are flagged separately and never count as violations
- Sitemap XML error handling tightened — malformed sitemaps fall back gracefully to crawl discovery

---

## [0.3.1] - 2026-03-19

### Changed

- Documentation updated for v0.3.0: hyperlinks to W3C criteria and official legal texts, template deduplication section, compliance integration guide

---

## [0.3.0] - 2026-03-18

### Added

- **WCAG hyperlinks** — every criterion in the HTML report links to the official W3C Understanding WCAG 2.1 page
- **Regulation hyperlinks** — regulation badges in the HTML report link to official legal texts (EUR-Lex, govinfo.gov, legislation.gov.uk, etc.)
- **Template issue deduplication** — issues appearing on three or more pages are collapsed into a "Template & Layout Issues" section, reducing duplicate noise by ~84%
- **Compliance-enriched reporting** — HTML reports include a legal compliance section with jurisdiction obligations and WCAG descriptions
- **Confirmed vs needs-review** — errors are confirmed violations; notices and warnings are flagged separately

### Fixed

- API route tests added; coverage raised to 80%+
- TypeScript type errors resolved across the compliance and core packages
- `results` key used from pa11y-webservice response (was incorrectly `issues`)
- Default port references in documentation changed from deployment-specific values to the generic default (3000)

---

## [0.2.0] - 2026-03-17

### Added

- **Compliance service** (`@pally-agent/compliance`) — new package providing a REST API and MCP server for jurisdiction and regulation data
- **58 jurisdictions** — EU, US, UK, DE, FR, AU, CA, and 51 more
- **62 regulations** — EU EAA, Section 508, ADA, UK Equality Act, RGAA, BITV, JIS X 8341-3, and more
- **OAuth2 / JWT authentication** — client credentials and password grant types; RS256 JWT signing
- **REST API with OpenAPI / Swagger** — full CRUD for jurisdictions, regulations, requirements, proposals, sources, webhooks, users, and OAuth clients
- **Compliance check endpoint** — `POST /api/v1/compliance/check` maps pa11y issues to legal obligations
- **MCP server** — 11 tools for AI agents: `compliance_check`, `compliance_list_jurisdictions`, `compliance_list_regulations`, and more
- **A2A agent** — Agent-to-Agent protocol support for multi-agent workflows
- **CLI** — `pally-compliance serve`, `pally-compliance mcp`, `pally-compliance keys generate`, `pally-compliance seed`, `pally-compliance clients create`
- **Update proposals** — automated detection of regulation changes from monitored legal sources
- **Webhook dispatch** — outbound webhooks on compliance events
- **Baseline seed** — 60+ jurisdictions and regulations seeded on `pally-compliance seed`
- **MongoDB and PostgreSQL adapters** — in addition to SQLite, with shared contract tests
- **Docker Compose** — `docker-compose.yml` for running compliance service and pa11y webservice together
- **WAF detection** — detects and reports when a Web Application Firewall blocks scanning (core package)
- **OAuth2 password grant** — added to compliance service to support dashboard authentication

### Changed

- Monorepo converted to npm workspaces; compliance service scaffolded as `packages/compliance`

### Wave breakdown

| Wave | Features | Tests |
|------|----------|-------|
| Wave 1 | Types, config, OAuth2, WCAG criterion matcher | — |
| Wave 2 | Checker, CRUD, proposals, seed, webhooks | 147 |
| Wave 3 | Fastify REST API, OAuth2 routes, OpenAPI | 193 |
| Wave 4 | MCP server (11 tools), A2A agent, CLI | 238 |

---

## [0.1.0] - 2026-03-16

### Added

- **`@pally-agent/core`** — initial package: site-wide WCAG accessibility scanner
- **Discovery** — robots.txt parsing, sitemap parser (with index recursion and deduplication), BFS link crawler with depth/page limits and robots filtering
- **Scanner** — pa11y webservice REST client, concurrent scanning with configurable concurrency and polling, progress events, error handling
- **Source mapping** — framework detector (Next.js, Nuxt, SvelteKit, Angular, plain HTML), routing strategies, element matching to source files
- **Fix proposals** — fix rules for common a11y issues (missing `alt`, missing `aria-label`, missing `lang`), unified diff generation
- **Reporters** — JSON and HTML reporters with timestamped output; professional HTML report with dark mode, print styles, severity filtering
- **CLI** (`pally-agent`) — `scan` and `fix` commands
- **MCP server** — 6 tools: `pally_scan`, `pally_get_issues`, `pally_propose_fixes`, `pally_apply_fix`, `pally_raw`, `pally_raw_batch`
- **Config module** — file discovery and environment variable overrides
- **Claude Code skill** — custom skill for AI-assisted accessibility scanning
- **CI/CD templates** — Azure DevOps and AWS pipeline templates

---

## Version History

| Version | Date | Highlights |
|---------|------|-----------|
| [0.9.0] | 2026-03-20 | Progressive auth (API key → local users → SSO), AuthService, Entra ID plugin |
| [0.8.0] | 2026-03-20 | Plugin system (manager, registry, marketplace UI, CLI, REST API, encrypted secrets) |
| [0.7.0] | 2026-03-20 | Path-based docs, REST API routes, dead code removal, env var fixes |
| [0.6.0] | 2026-03-20 | Dashboard self-audit, report comparison, monitor admin UI, npm publish prep |
| [0.5.0] | 2026-03-20 | Regulatory monitor agent, npm publish prep, security fixes, Redis support |
| [0.4.1] | 2026-03-20 | Dashboard JSON rendering, Kubernetes manifests, dashboard docs, CHANGELOG |
| [0.4.0] | 2026-03-19 | Web dashboard, admin UI, Docker Compose update |
| [0.3.2] | 2026-03-19 | Confirmed violations vs notices, WAF detection, hostname in filenames |
| [0.3.1] | 2026-03-19 | Documentation update for v0.3.0 |
| [0.3.0] | 2026-03-18 | WCAG/regulation hyperlinks, template deduplication, compliance enrichment |
| [0.2.0] | 2026-03-17 | Compliance service (REST API, MCP, 58 jurisdictions, 62 regulations) |
| [0.1.0] | 2026-03-16 | Core package (scanner, source mapper, fix engine, CLI, MCP) |
