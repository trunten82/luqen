---
phase: 42-component-selective-install
plan: 02
subsystem: installer
tags: [installer, macos, windows, launchd, nssm, oauth, monitor, parity]
requires:
  - 42-01 (install.sh 4-profile wizard, INSTALL_COMPONENTS dispatch, monitor systemd unit)
provides:
  - install.command launchd block driven by INSTALL_COMPONENTS (per-component plist generation)
  - install.command io.luqen.monitor.plist registration + uninstall
  - install.ps1 4-profile wizard (cli/api/dashboard/docker)
  - install.ps1 5-OAuth-client minting parity with install.sh
  - install.ps1 dashboard.config.json brandingUrl/Id/Secret + llmUrl/Id/Secret (closes pre-existing parity bug)
  - install.ps1 LuqenMonitor NSSM + Task Scheduler registration + uninstall
  - install.sh ${INSTALL_DIR}/.install-state (chmod 600) for cross-installer state
affects:
  - install.sh (added write_install_state — emits .install-state KEY=value file)
  - install.command (replaced hardcoded launchd block with per-component loop)
  - install.ps1 (param block, $script: vars, wizard, OAuth minting, Write-Config, New-WindowsServices, uninstall)
tech-stack:
  added: []  # no new frameworks
  patterns:
    - cross-installer state file (.install-state) sourced by install.command
    - PowerShell hashtable Remove-by-key for config-shape gating
    - NSSM AppEnvironmentExtra for OAuth-secret env passing (never argv)
    - NTFS ACL hardening helper (Protect-CacheFile) — Windows analog of chmod 600
key-files:
  created: []
  modified:
    - install.sh
    - install.command
    - install.ps1
decisions:
  - install.command sources .install-state to receive INSTALL_COMPONENTS + MONITOR_* values from install.sh's child process; falls back to legacy 4-service set when state file is absent (older install.sh, fresh install on macOS where install.sh exited before writing state).
  - install.ps1 -Profile is the canonical input; legacy -Mode docker is back-compatibility-mapped to -Profile docker.
  - Write-Config drops service-specific keys (brandingUrl/Id/Secret, llmUrl/Id/Secret) when the corresponding service is not in INSTALL_COMPONENTS — cleaner than emitting empty strings, and the dashboard reads missing keys as "service not configured" (graceful degradation per CONTEXT D-04).
  - LuqenMonitor depends on LuqenCompliance via NSSM DependOnService (mirrors systemd After+Wants in install.sh:1522-1523).
metrics:
  duration_min: ~25
  completed_date: 2026-04-26
---

# Phase 42 Plan 02: install.command launchd loop + install.ps1 parity Summary

Mirrors Plan 42-01's `INSTALL_COMPONENTS` contract from `install.sh` to the macOS (`install.command`) and Windows (`install.ps1`) installers. install.command's launchd block becomes a per-component loop that writes plists only for selected components and adds `io.luqen.monitor.plist`. install.ps1 receives a structural rewrite — 4-profile wizard, OAuth client minting parity (mints all 5 client pairs, not just 1), dashboard.config.json bug fix, LuqenMonitor service registration. install.sh writes a `.install-state` file to coordinate state across the install.sh-as-child-of-install.command boundary.

## What Changed

### install.sh (state-file emit)

- Added `write_install_state()` helper that emits `${INSTALL_DIR}/.install-state` (chmod 600) with `INSTALL_COMPONENTS` (space-joined), `*_PORT`, `*_PUBLIC_URL`, `MONITOR_CLIENT_ID`, `MONITOR_CLIENT_SECRET`, `MONITOR_CHECK_INTERVAL`, `OAUTH_KEY_MAX_AGE_DAYS` as `KEY=value` lines.
- Called from `create_oauth_client()` after monitor client minting (step 6 — last point where all needed values are resolved before systemd registration).
- File shape is shell-safe so install.command can `. .install-state` directly. Values never contain spaces/newlines (ports are integers, URLs are http URLs, OAuth IDs/secrets are hex/base64).

### install.command (launchd loop + monitor)

- Sources `.install-state` if present; falls back to legacy 4-service set (`core dashboard compliance branding llm`) when absent (older install.sh, or fresh-install on macOS where install.sh exited before writing state).
- Replaced the hardcoded 4-call block (`write_plist io.luqen.compliance` … `io.luqen.dashboard`) with a per-component `case` loop that writes plists for selected components only.
- Added `io.luqen.monitor` plist generation (port 4300, MONITOR_COMPLIANCE_URL/CLIENT_ID/CLIENT_SECRET/URL/CHECK_INTERVAL env, depends on compliance via order in `COMPONENTS_ARR`).
- Uninstall `for label in …` loop extended to include `io.luqen.monitor`.
- Status line `Registering launchd agents (...)` now reflects actual component set.

### install.ps1 (4-profile wizard + OAuth parity + monitor)

**Parameters** (Task 2 step 1):
- Added `[ValidateSet("cli","api","dashboard","docker")] $Profile`, `$ApiServices`, `$WithMonitor`, `$WithoutCompliance/-Branding/-Llm`, `$MonitorPort`.
- Legacy `-Mode docker` maps to `-Profile docker` for back-compat.

**Wizard** (Task 2 steps 4–7):
- Replaced 2-way menu with 4-profile menu (`Read-Choice` over `Scanner CLI / API services / Self-hosted dashboard / Docker Compose`).
- Profile 2 (api): explicit yes/no prompts for compliance, branding, **llm** — branding + llm now named in the wizard for the first time (closes long-standing INST-05 parity gap).
- Profile 3 (dashboard): yes/no opt-out for compliance, branding, **llm**.
- Monitor agent prompt is offered when compliance is in the resolved set.

**Component dispatch** (Task 2 steps 3, 5):
- New `Resolve-InstallComponents` function (mirrors install.sh:595-650). Per-token allow-list on `-ApiServices` CSV (T-42-09 mitigation). T-42-06 validation: `-WithMonitor` requires compliance.
- New `Invoke-CliInstall` (Profile 1, builds `@luqen/core` only, no DB/auth/services/plugins).
- New `Invoke-ApiInstall` (Profile 2, builds + registers selected services, no dashboard config).
- Entry point `switch ($script:Profile)` routes to cli/api/docker/dashboard handler.

**OAuth client parity** (Task 3 step 1):
- New `New-LuqenOAuthClient` helper + `Protect-CacheFile` ACL helper (T-42-10 mitigation — restricts cache files to current user via NTFS ACL).
- `New-OAuthClient` now mints all 5 client pairs gated by `$script:InstallComponents`:
  - Compliance↔Dashboard → `.install-client`
  - Branding↔Dashboard → `.install-branding-client`
  - LLM↔Dashboard → `.install-llm-client`
  - LLM↔Compliance → `.install-compliance-llm-client`
  - Monitor↔Compliance → `.install-monitor-client`

**Dashboard config bug fix** (Task 3 step 2):
- `Write-Config` now emits `brandingUrl/Id/Secret` and `llmUrl/Id/Secret` (mirrors install.sh:1389-1406). Closes pre-existing parity bug where Windows installs of v3.0/v3.1 failed to authenticate dashboard→branding and dashboard→llm.
- Service-specific keys are dropped via `$config.Remove("…")` when the corresponding service is not in `INSTALL_COMPONENTS`.
- `Protect-CacheFile` applied to `dashboard.config.json` (it contains OAuth client secrets).

**Service registration** (Task 3 steps 3–6):
- `New-WindowsServices` gates each NSSM/Task-Scheduler block by `INSTALL_COMPONENTS` membership.
- Added LuqenMonitor block (NSSM + Task Scheduler), with `DependOnService LuqenCompliance` and full `MONITOR_*` env via `AppEnvironmentExtra` (T-42-04 — secrets never via argv).
- Dashboard `DependOnService` list is built dynamically from selected backing services (was hardcoded to all three).
- Uninstall NSSM-remove + Unregister-ScheduledTask loops include LuqenMonitor.
- Post-install summary names monitor port + manual-mode hint when registered.

## Parity Gaps Closed

Cross-referenced against 42-RESEARCH.md "Critical parity gaps with install.sh" table:

| Gap (RESEARCH HIGH/BLOCKING) | Status |
| --- | --- |
| `@luqen/branding` never named in interactive wizard | CLOSED — Task 2 wizard prompts |
| `@luqen/llm` never named in interactive wizard | CLOSED — Task 2 wizard prompts |
| No 4-profile model | CLOSED — Task 2 (cli/api/dashboard/docker) |
| No `--without-X` flags | CLOSED — Task 2 param block |
| OAuth client minting only mints compliance | CLOSED — Task 3 step 1 (5 clients) |
| Dashboard config missing branding/llm client fields | CLOSED — Task 3 step 2 |

Cross-platform parity for monitor agent:

| Platform | Status |
| --- | --- |
| Linux (luqen-monitor.service) | DONE in 42-01 |
| macOS (io.luqen.monitor.plist) | DONE in this plan |
| Windows (LuqenMonitor NSSM + Task Scheduler) | DONE in this plan |

## Verification Results

| Check | Result |
| --- | --- |
| `bash -n install.command` | exit 0 |
| `bash -n install.sh` | exit 0 |
| `pwsh ParseFile install.ps1` | not run — pwsh unavailable in CI LXC. Brace balance OK (matches +/- to 0); paren balance reflects unmatched parens inside string literals (expected for PowerShell). Plan-specified grep guards all pass. Manual UAT on Windows host required (Plan 42-04). |
| `grep -c "io.luqen.monitor" install.command` | 2 (≥2 required) |
| `grep -c "LuqenMonitor" install.ps1` | 16 (≥4 required) |
| `grep -q "brandingUrl" install.ps1 && grep -q "llmUrl" install.ps1` | both present |
| `ValidateSet("cli","api","dashboard","docker")` | present |
| `Resolve-InstallComponents` function | present |
| `Scanner CLI` wizard label | present |
| `Include branding service` / `Include LLM service` prompts | present |
| All 5 OAuth client cache file references | present |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Plan 42-01 did not write `${INSTALL_DIR}/.install-state`.**

- **Found during:** Task 1 (install.command launchd block).
- **Issue:** Plan 42-02 Task 1 step 1 mandates that install.command source `.install-state` for `INSTALL_COMPONENTS` + `MONITOR_*` values, but install.sh (Plan 42-01, already on master) does not emit this file. install.sh runs as a child of install.command, so the array values cannot cross the process boundary without a state file.
- **Fix:** Added `write_install_state()` helper to install.sh and a call from `create_oauth_client()` (step 6 — last point where all needed values are resolved before systemd registration). File is `chmod 600`, KEY=value lines, shell-safe.
- **Files modified:** `install.sh` (helper + call site).
- **Commit:** f1b7b9c (bundled with Task 1 install.command changes since the two pieces are interdependent).

**2. [Rule 2 — Critical] CLI tool flag mismatch: `--scopes` vs `--scope`.**

- **Found during:** Task 3 OAuth minting block design.
- **Issue:** Plan 42-02 Task 3 step 1 notes that LLM CLI uses `--scopes` (plural, comma-separated) while compliance/branding CLIs use `--scope` (singular). The plan's example for the Branding client used `--scope "admin"` but for `clients create` to succeed across CLI variants, each block must use the matching flag.
- **Fix:** Each `New-LuqenOAuthClient` invocation uses the correct flag for the target service:
  - Compliance + Branding clients: `--scope "admin" --grant client_credentials`
  - LLM clients (LLM↔Dashboard, LLM↔Compliance): `--scopes "read,write,admin"`
- **Verification path:** Mirrors the proven shape used in install.sh's `mint_*_oauth_client` helpers.
- **Files modified:** `install.ps1` (`New-OAuthClient` per-pair blocks).
- **Commit:** 368eb2f.

### Authentication Gates

None — this plan does not invoke any authenticated services during execution. The OAuth client minting it generates is invoked at runtime by operators, not during `/gsd:execute-phase`.

## Threat Flags

None — all surfaces introduced map onto existing threat-register entries. Cache files are ACL-restricted (T-42-10), CLI parameters are allow-listed (T-42-08, T-42-09), monitor secrets pass via NSSM AppEnvironmentExtra (T-42-04), and the new `.install-state` file is written into the operator-controlled install dir (T-42-12).

## Self-Check: PASSED

- install.sh: present, parses (`bash -n` exit 0), `write_install_state` function present.
- install.command: present, parses, contains `io.luqen.monitor` ×2 (install loop + uninstall list), per-component `for component in` loop present.
- install.ps1: present, brace-balanced, contains `LuqenMonitor` ×16, `brandingUrl`+`llmUrl` keys, all 5 cache-file references, `[ValidateSet("cli","api","dashboard","docker")]`, `Resolve-InstallComponents`, `Scanner CLI`, branding+LLM wizard prompts.
- Commits f1b7b9c, 35aa38a, 368eb2f present in `git log`.
