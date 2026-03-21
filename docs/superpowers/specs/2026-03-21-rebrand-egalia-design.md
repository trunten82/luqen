# Rebrand: pally-agent → Egalia

**Date:** 2026-03-21
**Status:** Approved
**Scope:** Full rebrand — all layers

## Context

The product has grown from a pa11y wrapper into a full enterprise accessibility platform (scanning, compliance, dashboards, teams, assignments, plugins, API). The "pally" name creates confusion with the upstream pa11y dependency and undersells what the product is.

**Egalia** — from French *égalité* (equality). Also references *Egalia's Daughters* (1977), a landmark Norwegian novel about equality. Conveys the product's mission: guiding teams toward digital accessibility and inclusion.

## Naming Convention

- **Brand/UI:** "Egalia" (capitalized)
- **Code/CLI/packages:** `egalia` (lowercase)
- **Logo:** Existing check-in-circle SVG carries over unchanged

## Scope of Changes

### 1. Package Names & npm Scope

| Current | New |
|---------|-----|
| `pally-agent` (root) | `egalia` |
| `@pally-agent/core` | `@egalia/core` |
| `@pally-agent/compliance` | `@egalia/compliance` |
| `@pally-agent/dashboard` | `@egalia/dashboard` |
| `@pally-agent/monitor` | `@egalia/monitor` |
| `@pally-agent/plugin-auth-entra` | `@egalia/plugin-auth-entra` |
| `@pally-agent/plugin-notify-email` | `@egalia/plugin-notify-email` |
| `@pally-agent/plugin-notify-slack` | `@egalia/plugin-notify-slack` |
| `@pally-agent/plugin-notify-teams` | `@egalia/plugin-notify-teams` |
| `@pally-agent/plugin-storage-s3` | `@egalia/plugin-storage-s3` |
| `@pally-agent/plugin-storage-azure` | `@egalia/plugin-storage-azure` |

Also update `plugin-registry.json` (`packages/dashboard/plugin-registry.json`) — all 8 plugin entries reference `@pally-agent/*`.

### 2. CLI Binaries

| Current | New |
|---------|-----|
| `pally-agent` | `egalia` |
| `pally-compliance` | `egalia-compliance` |
| `pally-dashboard` | `egalia-dashboard` |
| `pally-monitor` | `egalia-monitor` |

### 3. MCP Tool Names

| Current | New |
|---------|-----|
| `pally_scan` | `egalia_scan` |
| `pally_get_issues` | `egalia_get_issues` |
| `pally_propose_fixes` | `egalia_propose_fixes` |
| `pally_apply_fix` | `egalia_apply_fix` |
| `pally_raw` | `egalia_raw` |
| `pally_raw_batch` | `egalia_raw_batch` |
| MCP server: `pally-compliance` | `egalia-compliance` |
| MCP server: `pally-monitor` | `egalia-monitor` |

### 4. Environment Variables

| Current | New |
|---------|-----|
| `PALLY_WEBSERVICE_URL` | `EGALIA_WEBSERVICE_URL` |
| `PALLY_WEBSERVICE_AUTH` | `EGALIA_WEBSERVICE_AUTH` |
| `PALLY_COMPLIANCE_URL` | `EGALIA_COMPLIANCE_URL` |
| `PALLY_AGENT_CONFIG` | `EGALIA_CONFIG` |
| `PALLY_RUNNER` | `EGALIA_RUNNER` |
| `PALLY_MAX_PAGES` | `EGALIA_MAX_PAGES` |

No backward-compatible aliases — this is a clean break at v1.0.0.

### 5. Redis Keys

| Current | New |
|---------|-----|
| `pally:scan:queue` | `egalia:scan:queue` |
| `pally:sse:{scanId}` | `egalia:sse:{scanId}` |

### 6. Config Salts

| Current | New |
|---------|-----|
| `pally-plugin-config-salt` | `egalia-plugin-config-salt` |
| `pally-dash-salt!` | `egalia-dash-salt!` |

> Note: Changing salts invalidates existing encrypted plugin configs and sessions. Acceptable since this is a pre-release product with no external users.

### 7. Webhook Header

- `X-Pally-Signature` → `X-Egalia-Signature`

### 8. Export Filenames

- `pally-scans-*.csv` → `egalia-scans-*.csv`
- `pally-issues-*.csv` → `egalia-issues-*.csv`
- `pally-trends-*.csv` → `egalia-trends-*.csv`
- `pally-report-*` → `egalia-report-*`

### 9. Config Files

- `.pally-agent.json` → `.egalia.json` (core config filename, referenced as `CONFIG_FILENAME` in `packages/core/src/config.ts`)
- `.pally-monitor.json` → `.egalia-monitor.json`
- User agent: `pally-monitor/x.x.x` → `egalia-monitor/x.x.x`
- `.gitignore`: `pally-reports/` → `egalia-reports/`

### 10. TypeScript Types & Interfaces

| Current | New |
|---------|-----|
| `PallyConfig` | `EgaliaConfig` |
| `PallyEvent` | `EgaliaEvent` |
| `PallyMcpServer` | `EgaliaMcpServer` |

These are exported types used across packages and plugins.

### 11. Docker & Deployment

**Docker Compose:**

| Current | New |
|---------|-----|
| `pally-redis` | `egalia-redis` |
| `pally-compliance` | `egalia-compliance` |
| `pally-dashboard` | `egalia-dashboard` |

Volume names (`compliance-data`, `dashboard-data`, etc.) stay unchanged.

**Kubernetes (`k8s/` directory):**
- Namespace: `pally` → `egalia`
- All labels: `app.kubernetes.io/part-of: pally-ecosystem` → `egalia-ecosystem`
- All resource names: `pally-*` → `egalia-*` (deployments, services, HPAs, secrets, configmaps, PVCs, service accounts)
- Ingress resources updated
- Overlays (dev/prod): kustomization files, TLS secret names (`pally-tls-prod` → `egalia-tls-prod`)
- RBAC definitions

**CI/CD Pipelines (`pipelines/` directory):**
- AWS ECS: cluster, service, container names (`pally-compliance` → `egalia-compliance`)
- AWS Lambda: stack names (`pally-compliance-$ENV` → `egalia-compliance-$ENV`), S3 bucket (`pally-agent-sam-artifacts` → `egalia-sam-artifacts`)
- Azure DevOps: variable groups (`pally-agent-secrets` → `egalia-secrets`, `pally-agent-aca-*` → `egalia-aca-*`, `pally-agent-aks-*` → `egalia-aks-*`)
- Docker image repositories: `pally-agent/$service` → `egalia/$service`

### 12. UI & Emails

**Dashboard templates:**
- HTML title: "Pally Dashboard" → "Egalia"
- Meta description: → "Egalia — Digital Accessibility Platform"
- Login heading: → "Egalia"
- Sidebar logo text: "Pally" → "Egalia"
- Sidebar aria-label: → "Egalia home"
- CSS comment: → `/* Egalia — style.css */`
- Console startup: → `'Egalia listening on http://...'`
- First-start banner: → `'  EGALIA — First Start'`
- Bookmarklet page: "Scan with Pally" → "Scan with Egalia" (and all other references)

**Core report template (`packages/core/src/reporter/report.hbs`):**
- `<title>Pally Accessibility Report</title>` → `Egalia Accessibility Report`
- `<h1>Pally Report</h1>` → `Egalia Report`
- `<footer>Generated by pally-agent</footer>` → `Generated by Egalia`

**Emails:**
- Email from name: → "Egalia"
- Email footer: → "Sent by Egalia — Email Notifications Plugin"

**JavaScript variables:**
- `window.__pallyAssignees` → `window.__egaliaAssignees` (report-detail.hbs, assignments.hbs)

### 13. A2A Agent Cards & API Metadata

- `packages/compliance/src/a2a/agent-card.ts`: `name: 'pally-compliance'` → `'egalia-compliance'`
- `packages/monitor/src/a2a/agent-card.ts`: `name: 'pally-monitor'` → `'egalia-monitor'`
- Swagger/OpenAPI title: `'Pally Compliance Service'` → `'Egalia Compliance Service'`

### 14. Storage Plugin Defaults

- `packages/plugins/storage-s3/src/index.ts`: default prefix `'pally-agent/'` → `'egalia/'`
- `packages/plugins/storage-azure/src/index.ts`: default prefix `'pally-agent/'` → `'egalia/'`

### 15. Scripts & Installer

- `install.sh`: repo URL, install directory (`~/pally-agent` → `~/egalia`), banner text, Docker references (~30 occurrences)
- `scripts/publish.sh`: `@pally-agent/$pkg` → `@egalia/$pkg`

### 16. Repository & Documentation

- GitHub repo: `trunten82/pally-agent` → `trunten82/egalia`
- All `package.json` repository URLs updated
- README title: "# Egalia"
- `docs/getting-started/what-is-pally.md` → `what-is-egalia.md`
- All doc content referencing "Pally" / "pally-agent" updated to "Egalia" / "egalia"
- `CHANGELOG.md`: Historical entries left as-is (they document what happened at that version). Add a v1.0.0 entry noting the rebrand.
- Claude skill directory: `.claude/skills/pally-agent/` → `.claude/skills/egalia/`

### 17. Test File Artifacts

Temp directory prefixes in test files: `pally-html-test-`, `pally-json-test-`, `pally-fix-test-`, etc. → `egalia-html-test-`, `egalia-json-test-`, `egalia-fix-test-`, etc.

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
