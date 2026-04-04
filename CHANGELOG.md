# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.6.1] - 2026-04-03

### Fixed

- **LLM service auth** — inter-service authentication now uses OAuth2 client credentials (`clientId` + `clientSecret`) instead of raw API keys, consistent with the compliance and branding services. Set `llmClientId` / `llmClientSecret` in `dashboard.config.json` (env: `DASHBOARD_LLM_CLIENT_ID` / `DASHBOARD_LLM_CLIENT_SECRET`) and `COMPLIANCE_LLM_CLIENT_ID` / `COMPLIANCE_LLM_CLIENT_SECRET` for the compliance service. Create clients with `luqen-llm clients create --name <name> --scopes read,write,admin`.
- **install.sh** — now creates two LLM OAuth clients (one for dashboard, one for compliance) during installation and injects credentials into `dashboard.config.json` and the compliance systemd unit
- **start.sh** — now creates LLM OAuth clients on first run and exports `DASHBOARD_LLM_CLIENT_ID`, `DASHBOARD_LLM_CLIENT_SECRET`, `COMPLIANCE_LLM_CLIENT_ID`, `COMPLIANCE_LLM_CLIENT_SECRET`
- **Removed `LLM_API_KEY`** — the `LLM_API_KEY` environment variable (static API key bypass) is no longer supported; all machine access uses OAuth2 client credentials

---

## [2.6.0] - 2026-04-03

### Added

**@luqen/llm — new standalone LLM service**
- **New `@luqen/llm` package** — Fastify microservice running on port 4200 for LLM provider management and capability routing
- **Provider management** — CRUD, connectivity testing, and remote model listing for `ollama`, `openai`, `anthropic`, and `gemini` provider types
- **Ollama and OpenAI adapters** — built-in provider adapters with health checking and model enumeration; additional provider types (Anthropic, Gemini) to follow
- **Model registration** — register and manage models under providers; models carry capability hints for assignment
- **Capability-based model assignment** — map the 4 capabilities (`extract-requirements`, `generate-fix`, `analyse-report`, `discover-branding`) to models with priority ordering
- **Org-scoped overrides** — capability assignments can be scoped to a specific organisation, with system-level defaults as fallback
- **OAuth2 authentication** — RS256 JWT, `client_credentials` and `password` grant types, same pattern as `@luqen/compliance` and `@luqen/branding`
- **`luqen-llm` CLI** — `serve`, `keys generate`, `clients create`, `clients list`, `users create`
- **`GET /api/v1/status`** — system overview endpoint reporting provider count, model count, and capability coverage percentage

### Removed

- **Dashboard LLM plugin system** (breaking change) — the four dashboard LLM plugins (`@luqen/plugin-llm-anthropic`, `@luqen/plugin-llm-openai`, `@luqen/plugin-llm-gemini`, `@luqen/plugin-llm-ollama`) and the `IComplianceLLMProvider` plugin interface have been removed from the dashboard plugin architecture. LLM functionality is now provided exclusively by the `@luqen/llm` service. If you were using dashboard LLM plugins directly, migrate to the new service — see [packages/llm/README.md](packages/llm/README.md).

---

**Dynamic plugin configuration (v1.1.0 LLM plugins)**
- **`dynamic-select` config field type** — plugins can declare config fields with `type: "dynamic-select"` and a `dependsOn` array; the dashboard renders a dropdown with a refresh button that fetches options at runtime via `GET /admin/plugins/:id/config-options`
- **`getConfigOptions(fieldKey, currentConfig)`** — new optional method on the plugin interface; returns available options for dynamic config fields
- All 4 LLM plugins updated to use `dynamic-select` for model selection (queries provider APIs for available models)

**LLM pipeline**
- **`POST /api/v1/llm/extract`** — dashboard endpoint that bridges the compliance service and the active LLM plugin; accepts optional `pluginId` to target a specific LLM plugin
- **`GET /api/v1/llm/plugins`** — lists active LLM plugins (used by the UI to populate the LLM Provider dropdown)
- **Dashboard auto-registration** — at startup, the dashboard generates an API key and calls `POST /api/v1/admin/register-llm` on the compliance service with retry logic
- **`POST /api/v1/sources/upload`** (compliance) — accepts document content + metadata for LLM-based regulation extraction
- **`POST /admin/sources/upload`** (dashboard) — proxies regulation uploads with LLM plugin selector (`pluginId`)
- **Upload Regulation form** — new form on the Sources admin page with LLM Provider dropdown
- **`DashboardLLMBridge`** — compliance service component that delegates LLM extraction to the dashboard
- **First-time government source extraction** — newly added government sources run LLM extraction immediately (not just on subsequent content changes)

**Trust levels**
- **`trustLevel` field on proposals** — `certified` (W3C/WCAG structured sources) or `extracted` (LLM-parsed sources)
- Certified proposals are auto-acknowledged (no admin action required)
- Extracted proposals require Review + Dismiss in the dashboard UI
- Source category mapping: `w3c-policy`/`wcag-upstream` -> certified; `government`/`generic` -> extracted

**Compliance engine enhancements**
- **Wildcard requirement matching** — regulations specifying `wcagCriterion='*'` (all WCAG AA) now match any violation
- **`findRequirementsByCriteria`** — includes wildcard rows in results
- **Async source scan** — `POST /admin/sources/scan` fires in background (prevents 504 timeout)
- **Sources page Parser column** — shows LLM/W3C/WCAG/Generic badges indicating which parser handles each source
- **Regulations page jurisdiction filter** — fixed missing partial template

**Source intelligence API**
- **`POST /api/v1/sources/scan`** — API-key accessible endpoint to trigger async source scan for automation
- **`POST /api/v1/sources/upload`** — API-key accessible endpoint to upload regulation documents for LLM parsing
- **Reseed auto-scan** — reseed now automatically triggers a source scan, ensuring monitor timestamps stay current
- **Duplicate proposal prevention** — source scans check all existing proposals (not just pending) to avoid re-creating proposals for sources with dynamic page content
- **US regulation expansion** — 10 US regulations total: Section 508, ADA, ADA Title II Web Rule (2024), Section 255, ACAA, CVAA, California Gov Code 7405, Illinois IITAA, Colorado HB21-1110, New York Web A11y
- **Stale source fixes** — Greece (EUR-Lex URL), Colombia (updated to Resolución 1519/2020)

**Plugin loader**
- ES class constructors detected correctly (checks `prototype.activate`)

**Compliance service — granular WCAG mapping**
- **`wcag_criteria` table** — 225 WCAG 2.0/2.1/2.2 success criteria seeded on startup; used by the engine to expand wildcard requirements and validate criterion codes
- **Per-criterion requirement mapping** — requirements now support individual criterion targets (e.g. `"1.4.3"`) alongside existing wildcards (`"*"`); granular entries take precedence over wildcards for obligation level
- **Regulation inheritance** — child regulations inherit requirements from parent regulations (e.g. EU member-state laws inherit EU-level criteria)
- **`GET /api/v1/wcag-criteria`** — new endpoint listing all 225 criteria (filters: `?version=`, `?level=`, `?principle=`)
- **`POST /api/v1/admin/reseed`** — shortcut endpoint for force-reseed (equivalent to `POST /seed` with `{ "force": true }`)
- **`POST /api/v1/seed` with `{ "force": true }`** — re-runs full source intelligence pipeline and refreshes the `wcag_criteria` table

**Compliance service — source intelligence pipeline**
- **W3C WAI parser (`W3cPolicyParser`)** — parses W3C WAI Laws & Policies YAML into jurisdiction/regulation records (https://www.w3.org/WAI/policies/)
- **WCAG upstream parser (`WcagUpstreamParser`)** — extracts per-criterion obligation levels from W3C WCAG Quick Reference (https://www.w3.org/WAI/WCAG21/quickref/)
- **tenon-io integration** — community WCAG criterion metadata used as supplementary source (https://github.com/tenon-io/wcag-as-json)
- **`sourceCategory` field** — monitored sources now carry `w3c-policy`, `wcag-upstream`, `government`, or `generic` to route to the correct parser
- **Requirement differ** — structured diff between old and new requirement sets; only changed records are written; diff summary attached to seed result
- **`IComplianceLLMProvider` interface** — standard interface for pluggable LLM extraction from unstructured regulatory content

**Compliance service — force-reseed mechanism**
- Auto-reseed on startup when database is empty
- Scheduled reseed (default: weekly, configurable via `reseedSchedule` cron in config)
- "Force Reseed" button on System Health admin page in the dashboard

**4 new LLM plugins** (available in the remote catalogue)
- **`@luqen/plugin-llm-anthropic`** — Claude (claude-3-5-haiku / claude-3-5-sonnet); requires `ANTHROPIC_API_KEY`
- **`@luqen/plugin-llm-openai`** — GPT-4o / any OpenAI-compatible endpoint; requires `OPENAI_API_KEY` or custom `baseUrl`
- **`@luqen/plugin-llm-gemini`** — Gemini 1.5 Flash / Pro; requires `GEMINI_API_KEY`
- **`@luqen/plugin-llm-ollama`** — local Ollama instance; configurable `baseUrl` and model name

**Dashboard UX improvements**
- **Smart compliance cards** — compliance matrix cards collapse when all jurisdictions show identical results; expand when results differ across regulations
- **Regulation filter** — compliance matrix page now has a regulation dropdown filter
- **Per-criterion obligation display** — report shows per-criterion obligation level (mandatory/recommended/optional) when granular mappings exist
- **Reseed button on System Health** — admin can trigger a force-reseed directly from the dashboard without CLI access
- **Brand filter count updates** — filter bar pill counts update live as brand filter is applied/cleared
- **Deactivated brand visual indicators** — inactive branding guidelines show a visual indicator in the guidelines list
- **Scan retry/cancel** — stuck scans (in-progress beyond timeout) can be retried or cancelled from the scan list
- **OAuth client backfill** — on startup, the dashboard creates missing OAuth clients for all existing orgs automatically

### Changed
- Plugin catalogue now lists 12 catalogue plugins (up from 8); total plugin count is 15 including built-in git host plugins

---

## [2.5.0] - 2026-03-31

### Added
- **New package: `@luqen/branding`** — standalone brand guideline matching service for accessibility findings
  - REST API with OAuth2 client_credentials authentication (port 4100)
  - CLI: `luqen-branding serve`, `keys generate`, `clients create/list/revoke`
  - Three matching strategies: color-pair (contrast issues), font-family, CSS selector rules
  - GuidelineParser: CSV, JSON template import; PDF parsing via LLM plugin interface
  - GuidelineStore: in-memory implementation + IBrandingStore interface for custom backends
  - SQLite database with full CRUD for guidelines, colors, fonts, selectors, site assignments
  - OpenAPI spec and Swagger UI at `/api/v1/docs`
- **Brand-aware accessibility analysis** — scanner enriches findings with branding context
  - Multi-brand, multi-site model (e.g., Campari Group → Aperol, Campari, Grand Marnier)
  - Each brand guideline assigned to one or more sites
  - Post-scan enrichment tags issues as "Brand-Related" or "Unexpected"
  - Version tracking per scan enables future re-tagging without re-scanning
- **Admin UI: Brand Guidelines** — full management interface
  - Guidelines list page with status, site count, version
  - Tabbed detail page: Colors (visual swatches), Fonts, Selector Rules, Site Assignments, Import/Export
  - CSV and JSON template download/upload for bulk guideline creation
  - Sidebar navigation with branding section (6 locales: en, it, de, es, fr, pt)
- **Report integration** — brand-related findings in scan reports
  - Filter bar: All / Unexpected / Brand-Related toggle
  - Inline brand badge on matched issues (no background tint — severity drives visual hierarchy)
  - Match detail line showing why each issue matched (color pair, font, or selector rule)
  - Dual KPI display: overall compliance rate + rate excluding brand-related
  - Brand KPI card with guideline name and version reference
- **Permissions** — `branding.view` and `branding.manage` (org-scoped RBAC)
- **Dashboard ↔ Branding OAuth integration** — auto-refreshing service tokens via ServiceTokenManager
- **Installer updated** — `install.sh` and `start.sh` include branding service setup, JWT keys, OAuth client creation, systemd service

### Documentation
- OpenAPI spec: `docs/reference/openapi-branding.yaml`
- Module guide: `docs/branding/README.md`
- API reference updated with branding service endpoints

---

## [2.4.2] - 2026-03-31

### Added
- **DELETE /api/v1/scans/:id** — REST endpoint for deleting scan records (admin or org-scoped)
- **X-Org-Id header** — admin API keys can operate in the context of any organization
- **Scan endpoints in OpenAPI spec** — GET /api/v1/scans, GET /api/v1/scans/:id, DELETE /api/v1/scans/:id with Scan schema

### Fixed
- **KPI: Compliance rate** — now shows % of SITES currently compliant (latest scan per site) instead of counting all historical scans; scans with jurisdictions use confirmedViolations, without use errors === 0
- **KPI: Overall trend** — uses errors-per-page (normalized) instead of raw issue counts; correctly shows "Improving" when error rates decrease across sites
- **KPI: Accessibility score** — errors-only (not warnings/notices), per-site average with weight 5 per error/page (was 10, too aggressive for commercial sites)
- **KPI: Overall change %** — positive = improvement, negative = degradation (intuitive sign convention); Handlebars template handles 0% correctly
- **KPI: Summary table trend** — uses errors-per-page for trend direction (consistent with KPIs and scorecard)
- **KPI: Home trend card** — color-coded green/red/neutral matching direction
- **Admin org scoping** — admin users see all scans in home and trends (matching reports page behavior)
- **Scan progress deduplication** — each page appears once in progress feed (was showing start + complete events)

---

## [2.4.1] - 2026-03-29

### Added
- **robots.txt** — dashboard serves robots.txt to guide crawlers away from non-page URLs (/api/, /graphql, SSE endpoints)
- **Crawler auth headers** — URL discovery crawler now passes authentication headers, enabling full site crawl on auth-protected sites
- **Scanner content-type filter** — HEAD check skips non-HTML URLs before scanning
- **False-positive filter** — scanner discards structural-only errors (missing lang/title) that indicate a non-HTML response was scanned

### Fixed
- **WCAG compliance (0 errors)** — full EU compliance achieved across 50 pages:
  - Contrast: `--bg-tertiary` lightened, jurisdiction ID uses `--text-secondary`, review status card darkened
  - Duplicate IDs: clients template uses `{{id}}` instead of undefined `{{clientId}}`
  - Unlabelled inputs: bulk assignee select, change-history search input
  - Duplicate toast-container: removed from proposals template (layout provides it)
- **Rate limiter** — authenticated requests get 2000 req/min (vs 100 anonymous); returns HTML error page for browsers via onSend hook
- **Stale threshold** — respects source schedule (daily=24h, weekly=7d, monthly=30d)
- **Monitor source filter** — text search + status dropdown for large source lists
- **Assignee scoping** — bulk assign picker shows only org members for non-admin users
- **i18n audit** — 57 new keys, 13 templates fixed, all hardcoded text replaced

---

## [2.4.0] - 2026-03-28

### Added
- **Proposals redesign** — two-flow system: acknowledge official regulatory changes vs review/dismiss org-custom proposals
- **Mass acknowledge** — select-all checkbox and bulk action bar on proposals page for batch operations
- **Change History page** — filterable audit log of all acknowledged/reviewed/dismissed changes with CSV export
- **Content diff view** — proposals show what changed (added/removed/modified sections) with color-coded inline diff
- **Monitor source status** — 3-state badges (up-to-date/change-pending/stale) with schedule-aware thresholds
- **Monitor KPI cards** — sources count, last scan, up-to-date, change pending, stale counts
- **Monitor source filter** — text search and status filter for large source lists
- **Automatic source scanning** — scheduler checks sources based on their frequency (daily/weekly/monthly)
- **Sidebar restructure** — split Compliance (reference data) from Monitoring (change tracking workflow)
- **Source content storage** — old content stored in DB for meaningful diffs on next scan
- **i18n** — all new strings in 6 locales

### Fixed
- **Acknowledge 400 error** — content-hash-only proposals no longer crash applyChange
- **lastCheckedAt field mismatch** — dashboard now uses correct field name from API
- **Scan duplicate proposals** — scanner skips sources with existing pending proposals
- **First scan baseline** — initial scan records hash without creating proposals
- **Stale threshold** — respects source schedule (daily=24h, weekly=7d, monthly=30d) instead of hardcoded 24h
- **Mobile overflow** — tab styling, card text, table cells, filter bars all wrap correctly
- **Select-all on mobile** — moved from thead (hidden on mobile) to always-visible bulk bar

---

## [2.3.1] - 2026-03-28

### Added
- **E2E test suite** — 44 new tests: plugin admin lifecycle (16), scan flow (15), auth flow (13)
- **Compare page redesign** — clear Baseline/Latest labels, outcome banners, KPI cards with deltas, collapsible scan details, explanation text per tab
- **Monitor: token caching** — in-memory cache with 60s safety margin, reduces OAuth calls
- **Monitor: content cache** — file-based cache for meaningful source diffs between scans
- **Monitor: pending proposals** — `getStatus()` now returns real pending proposal count
- **Monitor: README** — complete rewrite with env vars, CLI commands, MCP integration

### Fixed
- **Bulk compare** — HTMX partial now includes checkbox column (was missing, breaking compare after search/filter)
- **Compare button label** — "vs Previous" instead of ambiguous "Compare"
- **i18n completeness** — all new strings added to 6 locales (en, it, de, es, fr, pt)

---

## [2.3.0] - 2026-03-28

### Added
- **Pa11y auth guide** — comprehensive examples for Bearer tokens, cookies, basic auth, form login, cookie consent on the New Scan page with links to Pa11y docs
- **Org deploy pre-check** — plugin org deploy picker shows which orgs already have the plugin active (checked + disabled)
- **Audit log org scoping** — global admins see all entries, org admins see only their org; added Org column
- **Compliance orgId in responses** — Jurisdiction, Regulation, Requirement API responses now include `orgId` field
- **OAuth client org management** — org-scoped listing, ownership-protected revoke, Owner column with org name
- **Webhook org context** — webhook dispatch events now include orgId for org-scoped delivery

### Changed
- **Home page** — removed quick scan form (too many hidden variables), replaced with link to full scan page
- **Org deploy UI** — collapsible `<details>` with scrollable list
- **Plugin config UX** — inline toggle in card instead of jumping to top of page

### Fixed
- **Plugin configure button** — replaced HTMX with plain fetch to avoid attribute inheritance issues
- **Plugin cascade delete** — removing a global plugin now deletes all org-specific copies
- **Plugin activation lifecycle** — activate marks as enabled immediately; code loading is best-effort with "needs config" hint
- **Factory plugin loading** — plugins using `export default function createPlugin()` pattern now loaded correctly
- **Toast messages** — alerts persist after operations
- **Scheduler orgId** — always passed to scan config, not just for incremental scans
- **Admin JWT org context** — compliance service honors X-Org-Id header for admin JWTs without embedded orgId
- **Toast messages** — moved message area outside auto-refreshing section so alerts persist

### Changed
- **Org deploy UI** — collapsible `<details>` with scrollable list, replacing always-visible checkbox grid
- **Plugin config UX** — inline toggle in card instead of jumping to top of page

---

## [2.2.3] - 2026-03-28

### Added
- **Plugin org-scoping UX**: Global admin sees per-org usage, org admin sees activate/configure for their org
- **Activate for org**: Global admin can enforce plugin activation on any org
- **Org-scoped actions**: Org admins see "Activate for org" / "Deactivate" / "Configure" (no global Remove)
- **Org usage badges**: Global admin sees which orgs activated each plugin and if they use custom config

### Changed
- Plugin catalogue only shown to global admin (org admins see installed plugins only)
- Git host plugins now proper catalogue tarballs (removed registerBuiltIn)
- Repo connections support org assignment via dropdown

### Fixed
- Plugin test signature for storage parameter
- Source mapper URL prefix stripping for remote repos
- CI green on Node.js 22

---

## [2.2.2] - 2026-03-27

### Added
- **Git host plugin architecture** — GitHub, GitLab, and Azure DevOps are now proper PluginManager plugins (type `git-host`), built-in and auto-activated. Admins install via the Plugins page; configuration is managed through the Git Hosts admin page.
- **Per-developer PAT credentials** — developers store Personal Access Tokens per git host, encrypted at rest with AES-256-GCM and validated against the platform API on save.
- **PR creation from fix proposals** — select accessibility fixes from a scan report and create a pull request on the connected repository under the developer's own identity.
- **RemoteSourceMapper** — FileReader abstraction with URL prefix stripping enables source-mapping for remote repositories without local clones.
- **Admin git host management** — configure git hosts per organization via **Admin > Git Hosts** (add host, set API URL, assign to org).
- **Org-scoped repo connections** — admins assign repositories to organizations via an org dropdown on the Connected Repos page.
- **Compliance system badges** — system-created compliance items are shown with a "System" badge on list views to distinguish them from user-created items.
- **Sidebar reorganization** — new "Repositories" section in the sidebar containing Connected Repos, Git Hosts, and Git Credentials links.
- **SSRF unit tests** — 15 tests covering all private IP ranges (IPv4 loopback, link-local, RFC 1918, IPv6) for git host URL validation.

### Changed
- **CI Node.js 22** — GitHub Actions CI upgraded from Node.js 20 to Node.js 22.

### Security
- **SSRF validation on git host URLs** — all git host API URLs are validated against private/reserved IP ranges before any outbound request.
- **Strengthened scrypt parameters** — increased key derivation cost for password hashing.
- **128-bit session salt** — session salt upgraded from 64-bit to 128-bit.
- **HTML escaping hardening** — additional output escaping in templates to prevent XSS.
- **npm audit clean** — resolved all npm audit findings (0 vulnerabilities).

### Testing
- **2232+ tests passing** across all packages.

---

## [2.1.0] - 2026-03-27

### Added
- **Authenticated WCAG scanning** — scan pages behind login using custom HTTP headers or pa11y pre-scan actions. New "Authentication" section on the scan form with Custom Headers and Pre-scan Actions textareas. Full `actions` and `headers` parameter support through the scanner chain (DirectScanOptions, ScanOptions, CreateScannerOptions, ScanConfig, InitiateScanInput).
- **Per-org compliance tokens** — organizations can now configure their own `complianceClientId` and `complianceClientSecret` for compliance API access. Token management uses per-org `ServiceTokenManager` cache with automatic fallback to the global token. Server preHandler injects `_orgServiceToken` when the user has an org context.
- **Plugin page auto-refresh** — plugin section now auto-reloads via `hx-trigger="pluginChanged from:body"` after install, remove, activate, or deactivate operations.

### Fixed
- **WCAG 2.1 AA color contrast** — darkened CSS custom properties across the entire dashboard for correct contrast ratios: `--text-muted` (#9ca3af to #64748b), `--text-secondary` (#6b7280 to #4b5563), `--accent` (#16a34a to #15803d), `--status-error` (#dc2626 to #b91c1c), `--status-warning` (#d97706 to #b45309), `--status-info` (#2563eb to #1d4ed8), `--status-queued` (#d97706 to #b45309).
- **Sidebar contrast** — added explicit `background-color` on sidebar footer and locale sections for correct contrast computation; added sidebar-specific color overrides for ghost/secondary buttons.
- **Sidebar locale form** — added `sr-only` submit button for screen reader accessibility.
- **Scan URL autocomplete** — changed `autocomplete="url"` to `autocomplete="off"` on scan URL inputs.
- **Login page inline styles** — moved inline styles from summary elements to CSS classes.
- **All 21 dashboard pages now pass WCAG 2.1 AA** (pa11y verified).

---

## [1.9.0] - 2026-03-24

### Changed
- **PDF export rewritten with PDFKit** — server-side PDF generation no longer depends on Puppeteer or Chromium. Reports are generated using PDFKit, eliminating the ~400 MB Chromium dependency.
- **normalizeReportData extracted to shared service** — report data normalization is now a reusable service consumed by the report viewer, PDF exporter, email scheduler, and Excel export.
- **Microservices refactor** — extracted `scan-service.ts` (URL validation, SSRF protection, orchestration), `compliance-service.ts` (token management, caching, jurisdiction lookups), and `report-service.ts` (normalization, enrichment). Routes are now thin wrappers.
- **Mercurius upgraded to v16.8.0** — fixes CSRF and queryDepth bypass vulnerabilities.
- **Plugins removed from main repo** — all plugins now live in [luqen-plugins](https://github.com/trunten82/luqen-plugins). The `packages/plugins` directory has been removed.
- **HTMX partials render without layout** — HTMX requests (modals, table fragments) now return only the template fragment, not a full HTML page. Prevents DOM corruption when injecting content.
- **Inline event handlers migrated to app.js** — all `onclick`, `oninput`, `onchange`, and `hx-on::` attributes replaced with `data-action` event delegation in a single external JS file.
- **Build script cleans dist/** — `rm -rf dist` runs before `tsc` to prevent stale compiled files.

### Added
- **Favicon** — SVG shield with checkmark in brand blue (#0056b3).
- **Trend KPI cards** — sites monitored, total scans, accessibility score, and improvement/regression direction indicators with color-coded chart data points.
- **Power BI connector** — Power Query M script with DAX measures for accessibility KPIs.
- **Webhook notifications** — scan.completed and scan.failed events dispatched to registered webhook URLs with HMAC signing.
- **GitHub Actions CI** — build and test pipeline runs on push to master and PRs.
- **Sidebar hover fix** — white text on hover, brighter backgrounds for better visibility.

### Security
- **@fastify/helmet** — CSP, X-Frame-Options, HSTS, X-Content-Type-Options, Referrer-Policy headers on all responses.
- **CSP nonces** — inline scripts use per-request nonces instead of `unsafe-inline`.
- **CSRF verification** — global preHandler validates CSRF tokens on all state-changing requests.
- **GraphQL SSRF protection** — createScan mutation now validates URLs against the same blocklist as the REST endpoint.
- **XSS prevention** — `json` Handlebars helper escapes `</script>` sequences in inline JSON.
- **Per-installation session salt** — random salt persisted to DB, replaces hardcoded default.
- **Session sameSite: lax** — changed from `strict` for reverse proxy compatibility.

### Fixed
- **Installer** — OAuth client created with `admin` scope (was `read write`). Removed env var overrides from systemd service. Added getcwd guard. Explicit build order (core → compliance → dashboard).
- **Compliance CLI DB path** — documented that CLI must run from `packages/compliance` directory to use the correct database.

### Testing
- **1764 tests passing, 0 failures** across 90 test files.

---

## [1.8.0] - 2026-03-23

### Added
- **Direct pa11y scanner** — the core scanner now uses the pa11y library directly instead of requiring an external pa11y-webservice. No separate webservice process needed for scanning. The `webserviceUrl` config field is now optional and retained for backward compatibility with existing pa11y-webservice deployments.
- **Docker deployment** — root `Dockerfile` (multi-stage, Node 20) and `docker-compose.yml` for one-command deployment of compliance + dashboard services. Includes health checks, named volumes, and automatic first-run setup (key generation, data seeding).
- **Installer rewrite** — the `install.sh` wizard now offers 3 modes: Developer tools (CLI only), Full platform (bare metal with systemd), and Docker (docker compose). Input validation and `curl | bash` compatibility via re-exec.

### Changed
- `webserviceUrl` is now **optional** in both `.luqen.json` (core) and `dashboard.config.json` (dashboard). When omitted, the scanner uses the built-in pa11y library. When set, the scanner falls back to the external pa11y-webservice for backward compatibility.
- Architecture simplified: pa11y-webservice is no longer a required external dependency.

### Documentation
- Architecture diagrams updated to show pa11y as built-in (no external webservice box)
- Quick Start updated with 3 install modes (Developer tools, Full platform, Docker)
- CLI-only instructions no longer require `LUQEN_WEBSERVICE_URL`
- Docker deployment guide updated with new `docker-compose.yml` instructions
- `webserviceUrl` marked as optional in dashboard and core config references

---

## [1.6.0] - 2026-03-23

### Added
- **auth-okta plugin** — Single sign-on via Okta OIDC with IdP group-to-team sync. Supports `orgUrl`, `clientId`, `clientSecret`, `redirectUri`, group claim mapping, and `additive`/`mirror` sync modes.
- **auth-google plugin** — Single sign-on via Google OAuth 2.0 / OpenID Connect with optional Google Workspace group sync via Admin SDK (requires domain-wide delegation). Supports `hostedDomain` restriction.
- **8 plugins fully available** — all 8 catalogue plugins are now installable: auth-entra, auth-okta, auth-google, notify-slack, notify-teams, notify-email, storage-s3, storage-azure. No "coming soon" entries remain.
- **Plugin build script** (`scripts/build-plugin-tarball.sh`) — builds a self-contained `.tgz` tarball for any plugin, including compiled TypeScript output and bundled production `node_modules`. Outputs the tarball path and SHA-256 checksum for publishing to the catalogue.

---

## [1.5.0] - 2026-03-23

### Added
- **Remote plugin catalogue** — plugins are now discovered from a remote catalogue hosted at [github.com/trunten82/luqen-plugins](https://github.com/trunten82/luqen-plugins) instead of a built-in registry file. The dashboard fetches `catalogue.json` from GitHub releases, caches it locally for 1 hour (configurable via `catalogueCacheTtl`), and falls back to a local copy when GitHub is unreachable.
- **Tarball-based plugin installation** — plugins are installed by downloading tarballs from GitHub releases instead of using npm. Install by name: `luqen-dashboard plugin install auth-entra`.
- **Plugin catalogue configuration** — new `catalogueUrl` and `catalogueCacheTtl` config options (and corresponding `DASHBOARD_CATALOGUE_URL` / `DASHBOARD_CATALOGUE_CACHE_TTL` environment variables) for customizing the plugin catalogue source and cache behaviour.
- **8 plugins in catalogue** — 6 available (auth-entra, notify-slack, notify-teams, notify-email, storage-s3, storage-azure) and 2 coming soon (auth-okta, auth-google).

### Changed
- **StorageAdapter architecture** — replaced the monolithic `ScanDb`, `UserDb`, and `OrgDb` classes with a modular `StorageAdapter` interface backed by 14 pluggable repository interfaces. The built-in `SqliteStorageAdapter` is the default and requires no configuration changes. All dashboard routes and services now consume repository interfaces instead of direct database classes. This refactoring prepares the dashboard for PostgreSQL and MongoDB storage plugins in a future release.
- `resolveStorageAdapter()` factory selects the appropriate storage backend based on configuration
- New `StorageConfig` type: `{ type: 'sqlite', sqlite?: { dbPath: string } }`
- Dead code removal — unused modules, stale database classes, and orphaned helpers removed across all packages

### Security
- **Per-installation encryption salt** — each dashboard instance generates a unique random salt on first start, stored in `dashboard_settings`. Plugin config secrets are now encrypted with this installation-specific salt rather than a shared key, preventing cross-installation secret reuse.
- **SSRF protection** — scan URL validation now blocks private/internal IP ranges (RFC 1918, link-local, loopback) to prevent server-side request forgery attacks.
- **Global rate limiting** — rate limiting extended to all state-changing endpoints (scan creation, schedule management, role updates, API setup) in addition to existing login rate limits.
- **Secure session cookies** — session cookies use `httpOnly`, `SameSite=Strict`, and AES-256-GCM encryption via `@fastify/secure-session`.

### Testing
- **85%+ statement coverage** — test suite expanded from ~1,025 tests to 2,661 tests across 156 test files
- New test coverage: auth service, email, i18n, PDF export, GraphQL resolvers, scanner, admin routes (jurisdictions, regulations, proposals, sources, webhooks, clients, monitor, roles, teams, schedules, assignments, repos, audit, data API, system, org admin), API routes (setup, api-keys), auth routes, tool routes
- Dashboard test file count: 15 → 85 files
- Monitor tests expanded: agent, compliance client, MCP server
- Entra plugin: added index tests alongside existing provider tests

### Documentation
- All documentation updated to reflect StorageAdapter architecture, security improvements, test coverage, and dead code removal

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
- **Server-side PDF generation** — PDF export at `GET /api/v1/export/scans/:id/report.pdf`. Integrates with email report attachments. (Originally Puppeteer-based; rewritten with PDFKit in v1.9.0.)
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
| [2.1.0] | 2026-03-27 | WCAG 2.1 AA compliance (all 21 pages pass pa11y), authenticated scanning (headers + actions), per-org compliance tokens, plugin auto-refresh |
| [1.9.0] | 2026-03-23 | PDF export rewritten with PDFKit (no Chromium), security hardening (@fastify/helmet, CSRF verification, XSS fix, session salt), Mercurius v16.8.0 (CSRF fix), trend KPI cards, Power BI connector, 1764 tests passing, plugins removed from main repo |
| [1.8.0] | 2026-03-23 | Direct pa11y scanner (no webservice needed), Docker deployment, installer rewrite (3 modes) |
| [1.6.0] | 2026-03-23 | auth-okta + auth-google plugins, all 8 plugins available, plugin build script |
| [1.5.0] | 2026-03-23 | Remote plugin catalogue, tarball install, StorageAdapter (14 repositories), security hardening, 2661 tests (85%+ coverage), dead code removal |
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
