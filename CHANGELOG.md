# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.4.0] - 2026-03-22

### Changed
- **StorageAdapter architecture** — replaced the monolithic `ScanDb` class (1,886 lines) with a modular `StorageAdapter` interface backed by 14 pluggable repositories. The built-in SQLite adapter is the default and requires no configuration changes. This refactoring prepares the dashboard for PostgreSQL and MongoDB storage plugins (`@luqen/plugin-storage-postgres`, `@luqen/plugin-storage-mongodb`) in a future release.
- `resolveStorageAdapter()` factory selects the appropriate storage backend based on configuration
- New `StorageConfig` type: `{ type: 'sqlite', sqlite?: { dbPath: string } }`
- All dashboard routes and services now consume the `StorageAdapter` interface instead of direct database calls

### Documentation
- Configuration reference updated with Storage Adapter section
- Plugin guide and plugin development guide updated with storage adapter plugin information
- Deployment guides (Docker, Kubernetes) updated with storage adapter notes
- Install scripts annotated with future `--db-adapter` flag placeholder

---

## [1.3.0] - 2026-03-22

### Added
- **GraphQL API** — Full GraphQL endpoint at `/graphql` using mercurius. Covers scans, issues, assignments, trends, compliance, users, teams, orgs, roles, and audit log. Permission-gated queries and mutations. GraphiQL playground available at `/graphiql`.
- **Multi-language UI (i18n)** — Dashboard supports 6 languages: English, Italian, Spanish, French, German, and Portuguese. Language switcher in sidebar. Handlebars `{{t}}` helper with JSON locale files. Falls back to English for missing translations.
- **Full i18n coverage** — All dashboard templates converted to use translation keys: home, new scan, reports list, schedules, audit log, dashboard users, login, profile, and sidebar. No hardcoded English UI strings remain.
- **Language preference on profile page** — Users can set their preferred language from the My Profile page (`/account`). Saved to session and applied immediately.
- **User-selectable page limit** — Full-site scans now show a "Max Pages" field (1–1000) on the advanced scan form, overriding the server default per scan.
- **Auto-refreshing compliance service token** — The dashboard automatically obtains and refreshes OAuth tokens for compliance API calls using `client_credentials` grant. Eliminates the need for the manual `DASHBOARD_COMPLIANCE_API_KEY` environment variable.

### Fixed
- Scanner sending `runner` field in pa11y webservice task creation payload, causing "Invalid request payload input" (400). Runner is now passed at task run time instead.
- SSE live progress on scan page not updating — Fastify was buffering the raw stream. Fixed with `reply.hijack()` and event buffering for late-connecting clients.
- Build script not cleaning `dist/views` before copying, causing stale pre-i18n templates to persist.
- Mercurius v14 incompatible with Fastify 5 — upgraded to mercurius v15.

### Documentation
- New GraphQL schema reference (`docs/reference/graphql-schema.md`)
- i18n section added to dashboard README with locale architecture, language switching, and guide for adding new locales

### Chores
- `mercurius` and `graphql` added as dashboard dependencies
- Build script now cleans `dist/views`, `dist/static`, `dist/i18n` before copying to prevent stale files

---

## [1.1.0] - 2026-03-21

### Added
- **Granular user management permissions** — 5 new permission scopes (`users.create`, `users.delete`, `users.activate`, `users.reset_password`, `users.roles`) replace the blanket admin role check for user operations. Permissions are assignable to custom roles for delegation.
- **User lifecycle management** — activate/deactivate users, admin password reset, permanent user deletion. Historical references (assignments, scans) are preserved when users are deleted.
- **Self-service profile page** (`/account`) — all users can view their profile and change their own password. Accessible via username link in sidebar footer.
- **Setup API** (`POST /api/v1/setup`) — create dashboard users via API key authentication. Used for bootstrapping the first admin user or recovering admin access when locked out.
- **API key login in all modes** — API key authentication is now available as a fallback on the login page in team and enterprise modes (previously solo-mode only).
- **Power BI custom connector** — Power Query M connector (.mez) wrapping the Data API for use in Power BI Desktop. Supports scans, trends, compliance summary, and issues data sources.
- **IdP group → team sync** — auth-entra plugin now reads group memberships from Entra ID tokens and auto-syncs to dashboard teams on SSO login. Configurable via `groupMapping`, `syncMode`, and `autoCreateTeams` settings.
- **Server-side PDF generation** — Puppeteer-based PDF export at `GET /api/v1/export/scans/:id/report.pdf`. Integrates with email report attachments. Graceful fallback when Puppeteer is not installed.
- **Sidebar reorganization** — admin navigation split into sections: Compliance, Plugins, Integrations, Users & Access, System.

### Security
- All admin routes migrated from hardcoded `adminGuard` to permission-based `requirePermission()` guards
- New security administration guide (`docs/guides/security-administration.md`)
- DB migration 015 seeds new user management permissions for admin role

### Documentation
- OpenAPI 3.1 spec updated to v0.2.0 with setup, user management, account, and PDF export endpoints
- Dashboard admin guide updated with permission matrix, user management actions, setup API
- New Power BI integration guide
- New security administration guide

### Chores
- Root package.json bumped to v1.1.0
- `alanna82` git remote updated to luqen repo
- MIT license added to all plugin package.json files
- Remaining "Pally" references cleaned from docs and source

---

## [1.0.0] - 2026-03-21

### Breaking Changes
- **Rebrand:** pally-agent → Luqen
- All package names changed from `@pally-agent/*` to `@luqen/*`
- CLI commands renamed: `pally-agent` → `luqen`, `pally-dashboard` → `luqen-dashboard`, `pally-compliance` → `luqen-compliance`, `pally-monitor` → `luqen-monitor`
- MCP tool names renamed: `pally_scan` → `luqen_scan`, `pally_get_issues` → `luqen_get_issues`, etc.
- Environment variables renamed: `PALLY_*` → `LUQEN_*`
- Config file renamed: `.pally-agent.json` → `.luqen.json`
- Redis keys renamed: `pally:*` → `luqen:*`
- Webhook header renamed: `X-Pally-Signature` → `X-Luqen-Signature`

All features from v0.22.0 are unchanged. This is a naming-only change.

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
- @luqen/plugin-notify-slack — Slack notification plugin via webhooks
- Notification events: scan.complete, scan.failed, violation.found, regulation.changed
- Rich Slack Block Kit message formatting for all event types
- Configurable event filtering (subscribe to specific event types)
- @luqen/plugin-notify-teams — Microsoft Teams notification plugin via webhooks
- @luqen/plugin-storage-s3 — AWS S3 report/scan storage plugin (native AWS4 signing)
- @luqen/plugin-storage-azure — Azure Blob Storage plugin (native SharedKey auth)
- Monitor multi-tenant: X-Org-Id header support, --org-id CLI flag, MONITOR_ORG_ID env var
- Hybrid compliance queries: read operations return system + org data combined

### Changed
- ScanRecord now includes orgId field (defaults to 'system')
- All compliance filter interfaces support optional orgId
- All compliance create inputs support optional orgId
- Compliance route handlers pass org context from X-Org-Id header to database queries
- All dashboard routes pass orgId from session to compliance service and scan DB
- Sidebar shows Organizations link in admin section
- Consolidated admin route helpers (getToken, getOrgId, toastHtml, escapeHtml) into shared module

### Fixed
- adminGuard missing return after reply — allowed handler chain to continue after 403
- Open redirect via unvalidated Referer header in org switch endpoint
- X-Org-Id header now only accepted from API key auth (not JWT) — prevents tenant spoofing
- Scan records now checked for org ownership on direct access — prevents cross-org scan viewing
- Rate limiting added to POST /login (5 attempts per 15 minutes)
- Org slug validation enforces lowercase alphanumeric + hyphens only
- Password no longer trimmed before hashing
- bulkCreateRequirements now includes org_id column
- Org deletion now triggers compliance data cleanup via DELETE /api/v1/orgs/:id/data
- Handlebars helpers registered directly on instance for @fastify/view v10 compatibility
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
- @luqen/plugin-auth-entra — Azure Entra ID SSO plugin
- SSO login flow with callback handling

### Changed
- Auth middleware refactored to delegate to AuthService
- Login page supports all three auth modes (API key, password, SSO buttons)
- Dashboard no longer requires compliance service for authentication

---

## [0.8.0] - 2026-03-20

### Added
- **Database migration framework** — versioned schema migrations with `luqen-dashboard migrate`
- **Plugin system foundation** — `PluginManager` with install, configure, activate, deactivate, remove lifecycle; plugin registry with 7 built-in entries (3 auth, 2 notification, 2 storage)
- **Plugin marketplace UI** — Settings > Plugins page for browsing, installing, configuring, and activating plugins from the dashboard
- **Plugin CLI** — `luqen-dashboard plugin list|install|configure|activate|deactivate|remove` subcommands
- **Plugin REST API** — `/api/v1/plugins/*` endpoints for programmatic plugin management (list, registry, install, config, activate, deactivate, remove, health)
- **AES-256-GCM encrypted plugin secrets** — config fields marked as `secret` are encrypted at rest
- **Plugin health checks** — periodic health monitoring with auto-deactivation after 3 consecutive failures
- **Auth middleware JSON API support** — admin guard returns JSON errors for API requests

---

## [0.7.0] - 2026-03-20

### Added
- User and Client REST API routes in compliance service
- Webhook test endpoint (POST /api/v1/webhooks/:id/test)
- LUQEN_COMPLIANCE_URL env var for core → compliance integration
- Helpful pa11y webservice connection error with setup instructions
- Report "next steps" hints for progressive discovery
- Monitor standalone mode with .luqen-monitor.json local config fallback
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

- **Dashboard self-audit** — `luqen-dashboard self-audit` CLI command scans dashboard pages for WCAG 2.1 AA compliance, supports `--url`, `--port`, `--json` flags; exit code 1 when errors found
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

- **Regulatory monitor agent** (`@luqen/monitor`) — new package that watches monitored legal sources for content changes, computes SHA-256 hashes, and creates UpdateProposals in the compliance service when changes are detected
- **Monitor MCP server** — 3 tools: `monitor_scan_sources`, `monitor_status`, `monitor_add_source`
- **Monitor CLI** — `luqen-monitor scan`, `luqen-monitor status`, `luqen-monitor mcp`, `luqen-monitor serve` commands
- **Monitor A2A agent** — Agent-to-Agent protocol support via `/.well-known/agent.json` endpoint
- **npm publish preparation** — `package.json` metadata (description, keywords, repository, homepage), `LICENSE` file (MIT), and `.npmignore` files added to all publishable packages
- **Redis support** — optional Redis adapter for caching, job queue, and SSE broadcasting (used by compliance service and dashboard when `REDIS_URL` is set)

### Security

- **RSA private key removed** from repository history; keys are now generated at runtime with `luqen-compliance keys generate` and stored outside the repo
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

- **Web dashboard** (`@luqen/dashboard`) — new package providing a browser-based UI for the entire Luqen ecosystem
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
- **CLI** — `luqen-dashboard serve` and `luqen-dashboard migrate` commands
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

- **Compliance service** (`@luqen/compliance`) — new package providing a REST API and MCP server for jurisdiction and regulation data
- **58 jurisdictions** — EU, US, UK, DE, FR, AU, CA, and 51 more
- **62 regulations** — EU EAA, Section 508, ADA, UK Equality Act, RGAA, BITV, JIS X 8341-3, and more
- **OAuth2 / JWT authentication** — client credentials and password grant types; RS256 JWT signing
- **REST API with OpenAPI / Swagger** — full CRUD for jurisdictions, regulations, requirements, proposals, sources, webhooks, users, and OAuth clients
- **Compliance check endpoint** — `POST /api/v1/compliance/check` maps pa11y issues to legal obligations
- **MCP server** — 11 tools for AI agents: `compliance_check`, `compliance_list_jurisdictions`, `compliance_list_regulations`, and more
- **A2A agent** — Agent-to-Agent protocol support for multi-agent workflows
- **CLI** — `luqen-compliance serve`, `luqen-compliance mcp`, `luqen-compliance keys generate`, `luqen-compliance seed`, `luqen-compliance clients create`
- **Update proposals** — automated detection of regulation changes from monitored legal sources
- **Webhook dispatch** — outbound webhooks on compliance events
- **Baseline seed** — 60+ jurisdictions and regulations seeded on `luqen-compliance seed`
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

- **`@luqen/core`** — initial package: site-wide WCAG accessibility scanner
- **Discovery** — robots.txt parsing, sitemap parser (with index recursion and deduplication), BFS link crawler with depth/page limits and robots filtering
- **Scanner** — pa11y webservice REST client, concurrent scanning with configurable concurrency and polling, progress events, error handling
- **Source mapping** — framework detector (Next.js, Nuxt, SvelteKit, Angular, plain HTML), routing strategies, element matching to source files
- **Fix proposals** — fix rules for common a11y issues (missing `alt`, missing `aria-label`, missing `lang`), unified diff generation
- **Reporters** — JSON and HTML reporters with timestamped output; professional HTML report with dark mode, print styles, severity filtering
- **CLI** (`luqen`) — `scan` and `fix` commands
- **MCP server** — 6 tools: `luqen_scan`, `luqen_get_issues`, `luqen_propose_fixes`, `luqen_apply_fix`, `luqen_raw`, `luqen_raw_batch`
- **Config module** — file discovery and environment variable overrides
- **Claude Code skill** — custom skill for AI-assisted accessibility scanning
- **CI/CD templates** — Azure DevOps and AWS pipeline templates

---

## Version History

| Version | Date | Highlights |
|---------|------|-----------|
| [1.4.0] | 2026-03-22 | StorageAdapter architecture (14 pluggable repositories, SQLite default, Postgres/MongoDB coming) |
| [1.3.0] | 2026-03-22 | GraphQL API (mercurius), multi-language UI (i18n — 6 languages) |
| [1.1.0] | 2026-03-21 | Granular permissions, user lifecycle, Power BI connector, IdP group sync, PDF export, setup API |
| [1.0.0] | 2026-03-21 | Rebrand pally-agent → Luqen |
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
