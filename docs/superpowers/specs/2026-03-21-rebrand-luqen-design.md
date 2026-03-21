# Rebrand: pally-agent → Luqen

**Date:** 2026-03-21
**Status:** Approved
**Scope:** Full rebrand — all layers

## Context

The product has grown from a pa11y wrapper into a full enterprise accessibility platform (scanning, compliance, dashboards, teams, assignments, plugins, API). The "pally" name creates confusion with the upstream pa11y dependency and undersells what the product is.

**Luqen** — a coined name, unique to this product. Pronounced "LOO-ken". Conveys the product's mission: giving teams visibility into digital accessibility and guiding them toward inclusion.

## Naming Convention

- **Brand/UI:** "Luqen" (capitalized)
- **Code/CLI/packages:** `luqen` (lowercase)
- **Logo:** Existing check-in-circle SVG carries over unchanged

## Scope of Changes

### 1. Package Names & npm Scope

| Current | New |
|---------|-----|
| `pally-agent` (root) | `luqen` |
| `@pally-agent/core` | `@luqen/core` |
| `@pally-agent/compliance` | `@luqen/compliance` |
| `@pally-agent/dashboard` | `@luqen/dashboard` |
| `@pally-agent/monitor` | `@luqen/monitor` |
| `@pally-agent/plugin-auth-entra` | `@luqen/plugin-auth-entra` |
| `@pally-agent/plugin-notify-email` | `@luqen/plugin-notify-email` |
| `@pally-agent/plugin-notify-slack` | `@luqen/plugin-notify-slack` |
| `@pally-agent/plugin-notify-teams` | `@luqen/plugin-notify-teams` |
| `@pally-agent/plugin-storage-s3` | `@luqen/plugin-storage-s3` |
| `@pally-agent/plugin-storage-azure` | `@luqen/plugin-storage-azure` |

Also update `plugin-registry.json` (`packages/dashboard/plugin-registry.json`) — all 8 plugin entries reference `@pally-agent/*`.

### 2. CLI Binaries

| Current | New |
|---------|-----|
| `pally-agent` | `luqen` |
| `pally-compliance` | `luqen-compliance` |
| `pally-dashboard` | `luqen-dashboard` |
| `pally-monitor` | `luqen-monitor` |

### 3. MCP Tool Names

| Current | New |
|---------|-----|
| `pally_scan` | `luqen_scan` |
| `pally_get_issues` | `luqen_get_issues` |
| `pally_propose_fixes` | `luqen_propose_fixes` |
| `pally_apply_fix` | `luqen_apply_fix` |
| `pally_raw` | `luqen_raw` |
| `pally_raw_batch` | `luqen_raw_batch` |
| MCP server: `pally-compliance` | `luqen-compliance` |
| MCP server: `pally-monitor` | `luqen-monitor` |

### 4. Environment Variables

| Current | New |
|---------|-----|
| `PALLY_WEBSERVICE_URL` | `LUQEN_WEBSERVICE_URL` |
| `PALLY_WEBSERVICE_AUTH` | `LUQEN_WEBSERVICE_AUTH` |
| `PALLY_COMPLIANCE_URL` | `LUQEN_COMPLIANCE_URL` |
| `PALLY_AGENT_CONFIG` | `LUQEN_CONFIG` |
| `PALLY_RUNNER` | `LUQEN_RUNNER` |
| `PALLY_MAX_PAGES` | `LUQEN_MAX_PAGES` |

No backward-compatible aliases — this is a clean break at v1.0.0.

### 5. Redis Keys

| Current | New |
|---------|-----|
| `pally:scan:queue` | `luqen:scan:queue` |
| `pally:sse:{scanId}` | `luqen:sse:{scanId}` |

### 6. Config Salts

| Current | New |
|---------|-----|
| `pally-plugin-config-salt` | `luqen-plugin-config-salt` |
| `pally-dash-salt!` | `luqen-dash-salt!` |

> Note: Changing salts invalidates existing encrypted plugin configs and sessions. Acceptable since this is a pre-release product with no external users.

### 7. Webhook Header

- `X-Pally-Signature` → `X-Luqen-Signature`

### 8. Export Filenames

- `pally-scans-*.csv` → `luqen-scans-*.csv`
- `pally-issues-*.csv` → `luqen-issues-*.csv`
- `pally-trends-*.csv` → `luqen-trends-*.csv`
- `pally-report-*` → `luqen-report-*`

### 9. Config Files

- `.pally-agent.json` → `.luqen.json` (core config filename, referenced as `CONFIG_FILENAME` in `packages/core/src/config.ts`)
- `.pally-monitor.json` → `.luqen-monitor.json`
- User agent: `pally-monitor/x.x.x` → `luqen-monitor/x.x.x`
- `.gitignore`: `pally-reports/` → `luqen-reports/`

### 10. TypeScript Types & Interfaces

| Current | New |
|---------|-----|
| `PallyConfig` | `LuqenConfig` |
| `PallyEvent` | `LuqenEvent` |
| `PallyMcpServer` | `LuqenMcpServer` |

These are exported types used across packages and plugins.

### 11. Docker & Deployment

**Docker Compose:**

| Current | New |
|---------|-----|
| `pally-redis` | `luqen-redis` |
| `pally-compliance` | `luqen-compliance` |
| `pally-dashboard` | `luqen-dashboard` |

Volume names (`compliance-data`, `dashboard-data`, etc.) stay unchanged.

**Kubernetes (`k8s/` directory):**
- Namespace: `pally` → `luqen`
- All labels: `app.kubernetes.io/part-of: pally-ecosystem` → `luqen-ecosystem`
- All resource names: `pally-*` → `luqen-*` (deployments, services, HPAs, secrets, configmaps, PVCs, service accounts)
- Ingress resources updated
- Overlays (dev/prod): kustomization files, TLS secret names (`pally-tls-prod` → `luqen-tls-prod`)
- RBAC definitions

**CI/CD Pipelines (`pipelines/` directory):**
- AWS ECS: cluster, service, container names (`pally-compliance` → `luqen-compliance`)
- AWS Lambda: stack names (`pally-compliance-$ENV` → `luqen-compliance-$ENV`), S3 bucket (`pally-agent-sam-artifacts` → `luqen-sam-artifacts`)
- Azure DevOps: variable groups (`pally-agent-secrets` → `luqen-secrets`, `pally-agent-aca-*` → `luqen-aca-*`, `pally-agent-aks-*` → `luqen-aks-*`)
- Docker image repositories: `pally-agent/$service` → `luqen/$service`

### 12. UI & Emails

**Dashboard templates:**
- HTML title: "Pally Dashboard" → "Luqen"
- Meta description: → "Luqen — Digital Accessibility Platform"
- Login heading: → "Luqen"
- Sidebar logo text: "Pally" → "Luqen"
- Sidebar aria-label: → "Luqen home"
- CSS comment: → `/* Luqen — style.css */`
- Console startup: → `'Luqen listening on http://...'`
- First-start banner: → `'  LUQEN — First Start'`
- Bookmarklet page: "Scan with Pally" → "Scan with Luqen" (and all other references)

**Core report template (`packages/core/src/reporter/report.hbs`):**
- `<title>Pally Accessibility Report</title>` → `Luqen Accessibility Report`
- `<h1>Pally Report</h1>` → `Luqen Report`
- `<footer>Generated by pally-agent</footer>` → `Generated by Luqen`

**Emails:**
- Email from name: → "Luqen"
- Email footer: → "Sent by Luqen — Email Notifications Plugin"

**JavaScript variables:**
- `window.__pallyAssignees` → `window.__luqenAssignees` (report-detail.hbs, assignments.hbs)

### 13. A2A Agent Cards & API Metadata

- `packages/compliance/src/a2a/agent-card.ts`: `name: 'pally-compliance'` → `'luqen-compliance'`
- `packages/monitor/src/a2a/agent-card.ts`: `name: 'pally-monitor'` → `'luqen-monitor'`
- Swagger/OpenAPI title: `'Pally Compliance Service'` → `'Luqen Compliance Service'`

### 14. Storage Plugin Defaults

- `packages/plugins/storage-s3/src/index.ts`: default prefix `'pally-agent/'` → `'luqen/'`
- `packages/plugins/storage-azure/src/index.ts`: default prefix `'pally-agent/'` → `'luqen/'`

### 15. Scripts & Installer

- `install.sh`: repo URL, install directory (`~/pally-agent` → `~/luqen`), banner text, Docker references (~30 occurrences)
- `scripts/publish.sh`: `@pally-agent/$pkg` → `@luqen/$pkg`

### 16. Repository & Documentation

- GitHub repo: `trunten82/pally-agent` → `trunten82/luqen`
- All `package.json` repository URLs updated
- README title: "# Luqen"
- `docs/getting-started/what-is-pally.md` → `what-is-luqen.md`
- All doc content referencing "Pally" / "pally-agent" updated to "Luqen" / "luqen"
- `CHANGELOG.md`: Historical entries left as-is (they document what happened at that version). Add a v1.0.0 entry noting the rebrand.
- Claude skill directory: `.claude/skills/pally-agent/` → `.claude/skills/luqen/`

### 17. Test File Artifacts

Temp directory prefixes in test files: `pally-html-test-`, `pally-json-test-`, `pally-fix-test-`, etc. → `luqen-html-test-`, `luqen-json-test-`, `luqen-fix-test-`, etc.

### 18. What Stays Unchanged

- References to **pa11y** as the upstream scanning dependency (e.g. webservice URL points at a pa11y instance — that's a dependency, not our brand)
- Database schema, table names, column names (none contain "pally")
- The check-in-circle SVG logo icon
- All business logic, features, and functionality
- Historical `CHANGELOG.md` entries (pre-v1.0.0)

## Implementation Strategy

Full rebrand in a single pass:
1. Rename all package.json files (names, bins, repository URLs, workspace references)
2. Update `plugin-registry.json`
3. Rename all source code identifiers (env vars, MCP tools, Redis keys, salts, headers, filenames, TS types, A2A cards, Swagger title, storage prefixes, JS variables, test prefixes)
4. Update all UI templates (dashboard views, core report template, bookmarklet, emails)
5. Update Docker Compose, Kubernetes manifests (`k8s/`), and CI/CD pipelines (`pipelines/`)
6. Update scripts (`install.sh`, `scripts/publish.sh`)
7. Update all documentation content and rename doc files containing "pally"
8. Update `.gitignore`, config filenames
9. Rename Claude skill directory
10. Run `npm install` to regenerate `package-lock.json`
11. Build all packages and verify
12. Update memory files and CLAUDE.md references
13. Commit, tag as v1.0.0
14. Rename GitHub repository (do last — after push)

## Version Strategy

The rebrand constitutes a breaking change (new package names, CLI commands, MCP tools, env vars). Release as **v1.0.0** — a clean major version for the new brand.
