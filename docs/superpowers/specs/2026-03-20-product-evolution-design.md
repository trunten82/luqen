# Luqen: Product Evolution — Composable Accessibility Platform

**Date:** 2026-03-20
**Status:** Draft
**Author:** trunten82 + Claude

## Problem Statement

Luqen has grown from a single scanner into a 4-package ecosystem (core, compliance, dashboard, monitor) with 20 MCP tools, a REST API, a web dashboard, Docker/K8s infrastructure, and CI/CD pipelines. The system is technically complete and well-tested (813+ tests), but the user experience suffers from:

1. **Unclear entry points** — New users face 4 packages, 3 services, and dozens of configuration options with no clear guidance on where to start.
2. **Component-organized docs** — Documentation is structured by package, not by what the user wants to accomplish.
3. **Hidden composability** — The packages are already independent but this isn't communicated. Users assume they need everything.
4. **No progressive discovery** — There's no guided path from "scan a URL" to "full compliance platform."

## Design Goals

1. Position luqen as a **modular toolkit** where users pick the components they need.
2. Provide a **one-line installer** for users who want everything.
3. Restructure documentation around **user paths**, not components.
4. Enable **progressive discovery** — each tier is valuable alone and hints at the next.
5. Credit and depend on **pa11y webservice** as an explicit external requirement.

## Non-Goals

- Multi-tenancy (future, when SaaS hosting is validated)
- Billing, plans, or usage limits
- New packages or services
- Bundling pa11y webservice into luqen

## Target Personas

| Persona | Primary Need | Entry Point |
|---------|-------------|-------------|
| **Developer** | Scan sites, fix issues, gate CI/CD | CLI or MCP in IDE |
| **Compliance/Legal** | Check regulatory risk per jurisdiction | Dashboard reports or compliance API |
| **QA/Testing** | Regression tracking across releases | Dashboard or CI/CD pipeline |
| **Non-technical stakeholder** | Understand compliance posture | Dashboard reports |

**Adoption model:** Developer-led (bottom-up) + compliance-mandated (top-down). Two entry points to the same platform.

## Architecture: Tiered Composition

Each package is a standalone product. Packages enhance each other when co-located but never require each other.

```
Tier 0: @luqen/core          Scan, fix, report. Zero deps on other packages.
Tier 1: @luqen/compliance    Legal rule engine. Standalone or enriches core.
Tier 2: @luqen/monitor       Regulation watcher. Standalone or feeds compliance.
Tier 3: @luqen/dashboard     Web UI. Consumes any combination of the above.
```

**Integration model:** All cross-package communication is via HTTP APIs and environment variables. No package imports from another package. This is already true today.

### Per-Package Independence

**Core (Tier 0):**
- `npm install -g @luqen/core`
- `luqen scan https://example.com` works immediately with a pa11y webservice instance.
- WCAG criterion mapping is built-in.
- Compliance enrichment is optional: pass `--compliance-url <url>` on the CLI or set `compliance.url` in `.luqen.json`. New code change: also support `LUQEN_COMPLIANCE_URL` env var for convenience.

**Compliance (Tier 1):**
- `npm install -g @luqen/compliance`
- `luqen-compliance serve` starts a standalone API on port 4000.
- Pre-seeded with 58 jurisdictions and 62 regulations.
- Usable via REST, MCP, or A2A independently.

**Monitor (Tier 2):**
- `npm install -g @luqen/monitor`
- `luqen-monitor scan` runs a one-shot check of monitored sources.
- Reads sources from compliance service when available, or from a local config file when standalone (new capability). The local config file is `.luqen-monitor.json` in the current directory, containing `{ "sources": [{ "name": "...", "url": "...", "type": "html|rss|api" }] }`. Lookup order: CLI `--config` flag, then cwd, then `$HOME`.

**Dashboard (Tier 3):**
- `npm install -g @luqen/dashboard`
- `luqen-dashboard serve` starts the web UI on port 5000.
- Will gracefully degrade (new code change): scans and reports will work without compliance service (no legal mapping). Existing reports will be browsable without any backend.

## Supported Composition Paths

| # | Path | Persona | Components | Prerequisites | Effort to Start |
|---|------|---------|------------|---------------|-----------------|
| 1 | Quick scan | Dev | Core CLI | pa11y webservice | 30 seconds |
| 2 | IDE integration | Dev | Core MCP server | pa11y webservice | 5 minutes |
| 3 | CI/CD gate | Dev/QA | Core CLI in pipeline | pa11y webservice | 10 minutes |
| 4 | Compliance check | Dev/Legal | Core + Compliance | pa11y webservice | 10 minutes |
| 5 | Compliance API | Automation | Compliance standalone | None | 5 minutes |
| 6 | Full dashboard | All | Dashboard + Compliance + Core | pa11y webservice | 15 minutes |
| 7 | Regulatory monitoring | Legal | Monitor + Compliance | None | 10 minutes |
| 8 | Everything | Org-wide | All 4 packages | pa11y webservice | 5 minutes (one-liner) |

**Note:** All paths using Core require a running [pa11y webservice](https://github.com/pa11y/pa11y-webservice) instance. The quick-scan guide covers setup.

## Progressive Discovery UX

Users encounter luqen at the simplest level and are guided toward more capability:

**Step 1: First scan (30 seconds)**
```bash
# After npm publish (future):
npx @luqen/core scan https://my-site.com

# Today (local install):
luqen scan https://my-site.com
```
Requires pa11y webservice running (see quick-scan guide for setup). Outputs report to terminal + JSON. Report footer hints: "Want legal compliance mapping? Add @luqen/compliance."

**Note:** The `npx` zero-install flow depends on npm publishing, which is deferred (repos are private). Until then, users install via git clone or the one-line installer.

**Step 2: Add compliance (5 minutes)**
Install compliance, seed the database, re-run the scan. Report now includes jurisdiction-specific legal risk. Footer hints: "Want a web dashboard? Add @luqen/dashboard."

**Step 3: Add dashboard (5 minutes)**
Install dashboard, point at compliance service, get full web UI with history, reports, admin.

**Step 4: Add monitoring (2 minutes)**
Install monitor, auto-discovers compliance service, watches legal sources for changes.

**Step 5: Or skip all steps**
```bash
curl -fsSL https://luqen.dev/install | sh
```
Gets everything in one shot.

**Key principle:** Each step is self-contained and immediately valuable. No step requires the next.

## Documentation Restructure

Replace the current component-organized docs with path-based guides:

```
docs/
  getting-started/
    one-line-install.md         "I want everything running in 5 minutes"
    quick-scan.md               "I just want to scan a URL" (core only)
    what-is-luqen.md            Overview, architecture, how pieces fit together

  paths/
    developer-cli.md            Paths 1-3: scan, fix, CI/CD (core only)
    ide-integration.md          Path 2: MCP setup for VS Code, Cursor, Windsurf, etc
    compliance-checking.md      Paths 4-5: core + compliance
    full-dashboard.md           Path 6: all services + web UI
    regulatory-monitoring.md    Path 7: monitor + compliance

  reference/
    core-config.md              Core configuration reference
    compliance-config.md        Compliance configuration reference
    dashboard-config.md         Dashboard configuration reference
    monitor-config.md           Monitor configuration reference
    api-reference.md            Complete REST API reference
    mcp-tools.md                All 20 MCP tools in one place
    cli-reference.md            All CLI commands in one place

  deployment/
    docker.md                   Docker Compose setup
    kubernetes.md               K8s manifests and overlays
    cloud.md                    AWS/Azure deployment guidance

  contributing/
    architecture.md             Internal architecture for contributors
    publish.md                  NPM publish workflow
```

**Key change:** A user reads ONE guide for their path, not 5+ docs across installation, configuration, and guides. Each path doc covers: prerequisites, install, configure, first run, verify, next steps.

## Required Changes

### Documentation (80% of effort)

1. Restructure docs/ from component-based to path-based layout (Section above).
2. Write 5 path guides — self-contained install-to-run docs per composition.
3. Write getting-started guides — one-liner, quick-scan, overview.
4. Consolidate reference docs — single MCP tools doc, single CLI doc.
5. Update README as the entry point to path selection.
6. Fix all issues found in code review:
   - Wrong monitor env var names in docs (`COMPLIANCE_URL` should be `MONITOR_COMPLIANCE_URL`).
   - Stale version numbers (badge says v0.5.0, test counts say 681).
   - Missing v0.6.0 feature documentation (self-audit, compare, monitor admin).
   - Wrong K8s overlay directory names in docs.
   - Missing Redis config documentation.
   - Wrong command syntax in SECURITY-REVIEW.md.

### Code Changes (20% of effort)

1. **Monitor standalone mode** — add local config file fallback so monitor works without compliance service.
2. **Core first-run UX** — helpful error when pa11y webservice is unreachable, with setup instructions. Add `LUQEN_COMPLIANCE_URL` env var support to core config for easier compliance integration.
3. **Report "next steps" hints** — add footer to JSON and HTML reports suggesting available tiers.
4. **Dashboard graceful degradation** — improve behavior when compliance service is unavailable.
5. **Dead code cleanup** (from code review):
   - Remove orphaned MongoDB and PostgreSQL adapters and their dependencies.
   - Remove `report-view.hbs` template (confirmed unreferenced — no `reply.view('report-view.hbs')` call exists; replaced by `report-detail.hbs`).
   - Remove broken `/admin/requirements` sidebar link (no backing route exists; requirements are accessed via the regulations admin page).
   - Remove unused config fields (`dbUrl`, `dbAdapter`). Keep `checkInterval` (used by monitor).
   - Fix `.gitignore` pattern for `luqen-reports/`.
   - Make version strings dynamic: read from `package.json` at runtime instead of hardcoding `0.1.0`. This prevents version drift on future releases.
6. **Integration fixes** (from code review):
   - Add missing User and Client REST API routes to compliance service.
   - Fix health endpoint path mismatch: update dashboard's compliance-client to call `/api/v1/health` instead of `/health`.
   - Add missing webhook test endpoint.
   - Fix K8s ingress rewrite-target that breaks compliance API routing.

## Success Criteria

1. A new user can go from zero to first scan in under 60 seconds (via local install; `npx` requires future npm publish).
2. Each of the 8 composition paths has a single, self-contained guide.
3. No path guide references a component the user hasn't installed.
4. The one-line installer gets all services running in under 5 minutes.
5. Every report includes a contextual "next steps" hint.
6. All code review findings (critical + important) are resolved.
7. All tests pass (verify: `npm test --workspaces` — currently 813: core 180, compliance 402, dashboard 170, monitor 61), zero dead code, docs match code.

## Out of Scope

- Multi-tenancy / organization isolation
- Billing, plans, or usage limits
- New packages or services
- Bundling or replacing pa11y webservice
- npm registry publishing (deferred — repos are private)
