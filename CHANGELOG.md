# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
| [0.5.0] | 2026-03-20 | Regulatory monitor agent, npm publish prep, security fixes, Redis support |
| [0.4.1] | 2026-03-20 | Dashboard JSON rendering, Kubernetes manifests, dashboard docs, CHANGELOG |
| [0.4.0] | 2026-03-19 | Web dashboard, admin UI, Docker Compose update |
| [0.3.2] | 2026-03-19 | Confirmed violations vs notices, WAF detection, hostname in filenames |
| [0.3.1] | 2026-03-19 | Documentation update for v0.3.0 |
| [0.3.0] | 2026-03-18 | WCAG/regulation hyperlinks, template deduplication, compliance enrichment |
| [0.2.0] | 2026-03-17 | Compliance service (REST API, MCP, 58 jurisdictions, 62 regulations) |
| [0.1.0] | 2026-03-16 | Core package (scanner, source mapper, fix engine, CLI, MCP) |
