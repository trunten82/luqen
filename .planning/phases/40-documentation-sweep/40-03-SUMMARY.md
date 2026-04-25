---
phase: 40
plan: 40-03
subsystem: documentation, installer
tags: [installer, docs, oauth, mcp, rbac, deployment]
dependency_graph:
  requires: [v3.0.0 ship state, head migration 061]
  provides: [v3.1.0 installer parity, installer-env-vars.md, installer-changelog.md, getting-started/installation.md]
  affects: [install.sh, install.command, install.ps1, docs/deployment/, docs/getting-started/]
tech_stack:
  added: []
  patterns: [systemd unit + launchd plist + NSSM/Task Scheduler for daemon registration; *_PUBLIC_URL env-var convention for OAuth issuer + MCP discovery]
key_files:
  created:
    - docs/deployment/installer-env-vars.md
    - docs/deployment/installer-changelog.md
    - docs/getting-started/installation.md
    - .planning/phases/40-documentation-sweep/40-03-DELTA.md
  modified:
    - install.sh
    - install.command
    - install.ps1
decisions:
  - Installer leaves migration target unset; relies on adapter.migrate() reaching head 061 in one pass at service start (CONTEXT D-03 honored without hardcoding a number)
  - install.command does its own launchd plist registration after delegating to install.sh (install.sh's systemd block is a no-op on macOS, so plists must come from the wrapper)
  - install.ps1 carries env vars via NSSM AppEnvironmentExtra; Task Scheduler path warns env vars are not honored (Task Scheduler limitation, NSSM is the recommended path)
  - MCP remains embedded in the dashboard (no LuqenMcp service) per CLAUDE.md "MCP embedded as Fastify plugin per service, never standalone port"
metrics:
  completed: 2026-04-25
  tasks: 4
  commits: 3
  files_changed: 7
---

# Phase 40 Plan 03: Installer Refresh + Installer Docs Summary

Closed DOC-03 at the script + docs level. All three installer scripts
(`install.sh` / `install.command` / `install.ps1`) now cover the full
v2.12.0 -> v3.1.0 delta (8 new env vars, migration head 061 in one
pass, launchd/NSSM/Scheduled-Task parity for the four daemons).
Installer documentation set added: env-vars table, per-version
changelog, end-to-end install guide referencing both new files.

## What was delivered

### Static delta inventory — `40-03-DELTA.md`

Working artifact under `.planning/phases/40-documentation-sweep/`.
Five sections (Migrations, EnvVars, Services, AdminPages,
RBACPermissions) drive the patches in Tasks 2-3 and the docs in Task 4.
`.planning/` is gitignored — file lives on disk only.

### `install.sh` (Linux)

- Header marker added: `# Last reviewed for v3.1.0 (Phase 40 / DOC-03) — head migration 061`.
- New CLI flags: `--dashboard-public-url`, `--compliance-public-url`,
  `--branding-public-url`, `--llm-public-url`, `--oauth-key-max-age-days`,
  `--ollama-base-url`.
- `resolve_public_url_defaults` helper fills in localhost defaults after
  port parsing.
- Each systemd unit (compliance, branding, llm, dashboard) gains the
  appropriate `*_PUBLIC_URL` env. Dashboard unit gains
  `DASHBOARD_PUBLIC_URL`, `DASHBOARD_JWKS_URI`, `DASHBOARD_JWKS_URL`,
  `OAUTH_KEY_MAX_AGE_DAYS` plus the three downstream `*_PUBLIC_URL`s.
- LLM unit picks up optional `OLLAMA_BASE_URL`.
- Hardcoded `localhost:4200` health-check replaced with `${LLM_PORT}`.
- Docker `.env` template gains all v3.x env vars.
- New `show_v3_whats_new` function prints admin-page + RBAC summary at
  end of every install (bare-metal and docker).

### `install.command` (macOS)

- Header marker added.
- Switched from `exec bash install.sh` to `bash install.sh` followed by
  post-install launchd registration. install.sh's systemd block is a
  no-op without `systemctl`, so without this patch macOS installs left
  daemons unmanaged.
- Helper `write_plist` writes four plists to
  `~/Library/LaunchAgents/io.luqen.{compliance,branding,llm,dashboard}.plist`
  with full env-var coverage (including DASHBOARD_PUBLIC_URL +
  JWKS_URIs + OAUTH_KEY_MAX_AGE_DAYS on the dashboard plist).
- Plists `RunAtLoad=true` + `KeepAlive=true`; logs to `/tmp/io.luqen.*.log`.
- `Show what's new since v2.12.0` summary appended.

### `install.ps1` (Windows)

- Header marker added (PowerShell `#` form per plan acceptance criterion).
- Added `$script:BrandingPort`, `$script:LlmPort`, `$script:DashboardPublicUrl`,
  `$script:CompliancePublicUrl`, `$script:BrandingPublicUrl`,
  `$script:LlmPublicUrl`, `$script:OAuthKeyMaxAgeDays`,
  `$script:OllamaBaseUrl` state — overridable via process env vars.
- `Resolve-PublicUrlDefaults` helper called pre-routing and from
  `New-WindowsServices`.
- `New-WindowsServices` rewritten to register **all four** services
  (`LuqenCompliance`, `LuqenBranding`, `LuqenLlm`, `LuqenDashboard`)
  under both NSSM and Task Scheduler paths. Previously only Compliance
  and Dashboard were registered.
- NSSM `AppEnvironmentExtra` arrays carry the new env vars per service;
  `LuqenDashboard` `DependOnService` includes all three downstream daemons.
- `Show-V3WhatsNew` added and called after both bare-metal and docker
  paths.
- Docker `.env` writer gains the v3.x env vars.

### Documentation

- **`docs/deployment/installer-env-vars.md`** — alphabetical
  `| Env Var | Default | Required? | Purpose | Introduced In |`
  table with every env var the installers read or set. Highlights
  `*_PUBLIC_URL` requirements for production, JWT vs JWKS choice.
- **`docs/deployment/installer-changelog.md`** — per-version log
  v2.12.0 -> v3.0.0 -> v3.1.0 with migrations, env vars, services,
  admin pages, RBAC perms. Notes that v3.1.0 ships no new product
  surface; only installer-script + docs corrections.
- **`docs/getting-started/installation.md`** — end-to-end install
  walkthrough with "What's new in v3.1.0" callout, production
  `*_PUBLIC_URL` examples for all three OSes, new admin-pages and
  RBAC tables, post-install verification checklist linking to the two
  reference files.

## Acceptance criteria — verified

- `bash -n install.sh` → 0
- `bash -n install.command` → 0
- install.ps1 brace balance OK (Linux dev box has no `pwsh`; full
  PowerShell parse will run in Phase 40-07's container dry-run).
- Header marker `v3.1.0.*Phase 40.*DOC-03.*head migration 061` present
  in all three scripts.
- Every new env var grep-confirmed in install.sh, install.command,
  install.ps1 (DASHBOARD_PUBLIC_URL, DASHBOARD_JWT_PUBLIC_KEY,
  DASHBOARD_JWKS_URI, DASHBOARD_JWKS_URL, OAUTH_KEY_MAX_AGE_DAYS,
  BRANDING_PUBLIC_URL, COMPLIANCE_PUBLIC_URL, LLM_PUBLIC_URL,
  OLLAMA_BASE_URL).
- install.sh `grep -cE "systemctl (enable|start)" = 8` (≥4 required).
- No hardcoded migration <061: `grep -E "migrate.*05[0-9]|migrate.*06[02-9]"`
  returns nothing.
- install.command launchd plist count = 4.
- install.ps1 service-registration count = 4 (under each branch).
- `docs/deployment/installer-env-vars.md` exists with table header.
- `docs/deployment/installer-changelog.md` exists.
- `docs/getting-started/installation.md` references v3.1.0 and links
  the two new docs.

## Deviations from Plan

**None auto-fixed (Rules 1-3).** Plan was followed as written. Two
plan-level adaptations driven by environment, not plan defects:

1. **`bash -n` only used as PS1 syntax check.** `pwsh` is not installed
   in this worktree's host. Brace-balance check used as a lexical
   stand-in. The fresh-container dry-run owned by Phase 40-07 will
   exercise the real PowerShell parser on Windows, satisfying the plan's
   final acceptance gate.
2. **`.planning/` is gitignored project-wide.** The DELTA artifact
   exists on disk but is not committed. SUMMARY.md is force-added per
   the parent orchestrator's `<parallel_execution>` instruction
   ("SUMMARY.md MUST be committed before return").

## Authentication gates

None. Fully autonomous run.

## Known stubs / threat flags

None. Documentation and installer-script changes only; no new network
surface or trust-boundary code introduced by this plan.

## Self-Check: PASSED

Files verified on disk:

- FOUND: install.sh (modified)
- FOUND: install.command (modified)
- FOUND: install.ps1 (modified)
- FOUND: docs/deployment/installer-env-vars.md
- FOUND: docs/deployment/installer-changelog.md
- FOUND: docs/getting-started/installation.md
- FOUND: .planning/phases/40-documentation-sweep/40-03-DELTA.md (uncommitted, .planning/ gitignored)

Commits verified in `git log`:

- FOUND: 83238ce — feat(40-03): patch install.sh with v2.12.0->v3.1.0 deltas
- FOUND: 516cba9 — feat(40-03): patch install.command + install.ps1 for v3.1.0 parity
- FOUND: e691bc6 — docs(40-03): add installer env-vars + changelog refs and v3.1.0 install guide
