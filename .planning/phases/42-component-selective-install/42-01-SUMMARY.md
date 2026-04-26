---
phase: 42-component-selective-install
plan: 01
subsystem: installer
tags: [installer, wizard, systemd, monitor, oauth]
requires:
  - packages/monitor v2.4.1 (already shipped)
  - packages/compliance CLI clients-create
provides:
  - install.sh 4-profile wizard
  - install.sh INSTALL_COMPONENTS dispatch
  - install.sh luqen-monitor.service generator
  - install.sh monitor OAuth client minting
affects:
  - install.sh (sole file modified)
tech-stack:
  added: []
  patterns: [INSTALL_COMPONENTS bash array dispatch, per-component gating]
key-files:
  created: []
  modified:
    - install.sh
decisions:
  - Profile 1 labelled "Scanner CLI" with stdio MCP entry point packages/core/dist/mcp.js (per locked answer #3)
  - Monitor default port 4300 (avoids LLM 4200 collision)
  - Monitor unit uses WantedBy=multi-user.target (Q4 — once installed, run across reboots; opt-in is at install time)
  - Node 20+ floor honoured (monitor engines.node >=22 treated as advisory per A1)
  - Task 1 + Task 2 committed together because Task 1's dispatch loop references Task 2's write_systemd_unit_monitor / mint_monitor_oauth_client; splitting would leave intermediate commit broken
metrics:
  duration: ~25 min
  completed: 2026-04-26
requirements: [INST-01, INST-02, INST-03, INST-04]
---

# Phase 42 Plan 01: Installer 4-Profile Wizard + Monitor Registration — Summary

`install.sh` rewired from the v2-era 3-way wizard (Developer tools / Full platform / Docker) to a 4-profile model (Scanner CLI / API services / Self-hosted dashboard / Docker Compose) driven by an `INSTALL_COMPONENTS` bash array. The monitor agent (`@luqen/monitor`) is now a first-class opt-in component, registered as `luqen-monitor.service` with a freshly-minted compliance OAuth client.

## Files Modified

| File | Change |
|------|--------|
| `install.sh` | +613 / -271 lines. New top-level vars (`PROFILE`, `INSTALL_COMPONENTS`, `MONITOR_PORT`, `WITH_MONITOR`, `WITHOUT_*`). New `derive_install_components()`. New extracted unit-writer helpers (`write_systemd_unit_{compliance,branding,llm,dashboard,monitor}`) + dispatch loop in `create_systemd_services`. New OAuth-client helpers (`mint_compliance_oauth_client`, `mint_branding_oauth_client`, `mint_llm_dashboard_oauth_client`, `mint_llm_compliance_oauth_client`, `mint_monitor_oauth_client`) replacing the inline blocks in `create_oauth_client`. New `_wait_for_health` helper. Argument parser extended with 7 new flags + range/allow-list validation. `run_wizard` rewritten to a 4-profile menu with monitor opt-in prompt and per-component opt-out prompts in the dashboard branch. New `run_wizard_api_services` for Profile 2. Cli-only path simplified (no compliance/branding add-ons; redirects to `--profile dashboard` for those). Post-install summary iterates `INSTALL_COMPONENTS` and prints a monitor block when registered. |

## New Functions

- `derive_install_components()` — Translates `PROFILE` + `WITHOUT_*`/`WITH_MONITOR` into `INSTALL_COMPONENTS` array. Validates monitor requires compliance (T-42-06). Emits graceful-degradation banners.
- `run_wizard_api_services()` — Interactive subset prompt for Profile 2 (compliance/branding/llm).
- `write_systemd_unit_compliance/branding/llm/dashboard/monitor()` — Each writes a single systemd unit file. Bodies for the existing 4 are byte-identical to pre-refactor; `monitor` is new (per RESEARCH Pattern 2: After+Wants compliance, port 4300, env-block secrets).
- `mint_compliance/branding/llm_dashboard/llm_compliance/monitor_oauth_client()` — Each handles one OAuth client cache file with the existing reuse-or-mint pattern.
- `mint_monitor_oauth_client()` — New: mints `luqen-monitor` client on the compliance service (admin scope), caches at `${INSTALL_DIR}/.install-monitor-client` with `chmod 600`.
- `_wait_for_health(label, url, hint)` — Extracted health-poll helper, removes 5x copy-paste in `start_services_and_post_install`.

## Verification Results

### Static checks
- `bash -n install.sh` → **exit 0**
- `grep -c "INSTALL_COMPONENTS" install.sh` → **49** (≥8 required)
- `grep -c "luqen-monitor" install.sh` → **16** (≥4 required)
- `grep -q '"Scanner CLI' install.sh` → **match** (locked answer #3)
- `grep -q '"Developer tools (CLI + MCP server)"' install.sh` → **no match** (deprecated label removed)
- All Task 1 plan verify strings present: `PROFILE=`, `INSTALL_COMPONENTS=()`, `derive_install_components`, `luqen-monitor`
- All Task 2 plan verify strings present: `mint_monitor_oauth_client`, `write_systemd_unit_monitor`, `Description=Luqen Monitor Agent`, `MONITOR_PORT`, `luqen-monitor.service`, `WantedBy=multi-user.target`, `.install-monitor-client`

### Behavioral checks (parser-level — no runtime needed)

| Scenario | Expected | Actual |
|----------|----------|--------|
| `--profile bogus` | exit non-zero, error | `x  --profile must be one of: cli, api, dashboard, docker` |
| `--profile api --api-services bogus` | exit non-zero, error | `x  --api-services tokens must be one of: compliance, branding, llm (got: bogus)` |
| `--monitor-port abc` | exit non-zero, error | `x  --monitor-port must be an integer between 1024 and 65535 (got: abc)` |
| `--monitor-port 80` | exit non-zero, error (out of range) | `x  --monitor-port must be an integer between 1024 and 65535 (got: 80)` |
| `--profile cli --with-monitor` | exit non-zero, error | `x  --with-monitor requires compliance (selected profile does not include it)` (T-42-06) |
| Default derive (`PROFILE=""`, all defaults) | `INSTALL_COMPONENTS=core dashboard compliance branding llm` | confirmed identical (D-01 invariant) |

Runtime LXC verification (boot 4 services + monitor inactive on default; `--profile api --api-services compliance,llm` registers exactly 2 units; `--profile dashboard --with-monitor` boots monitor on 4300) is deferred to **Plan 42-04** per RESEARCH §"Runtime LXC verification" — this plan delivers static + parser-level confidence per the plan's `<verification>` block.

## Threat Model Coverage

All 7 STRIDE entries addressed:

| Threat | Status |
|--------|--------|
| T-42-01 (`--profile` argv tampering) | mitigated — `case` allow-list in parser |
| T-42-02 (`--api-services` CSV tampering) | mitigated — per-token allow-list in parser |
| T-42-03 (`--monitor-port` argv tampering) | mitigated — integer + range check in parser |
| T-42-04 (MONITOR_CLIENT_SECRET in `ps -ef`) | mitigated — `Environment=` line, never in `ExecStart` argv |
| T-42-05 (`.install-monitor-client` file mode) | mitigated — `chmod 600` immediately after write |
| T-42-06 (monitor without compliance) | mitigated — `derive_install_components` validation, exits non-zero |
| T-42-07 (port 4200 collision) | mitigated — `MONITOR_PORT="${MONITOR_PORT:-4300}"` default everywhere |

## Deviations from Plan

**Two structural variances from the plan as written, both intentional:**

### 1. [Rule 3 — Blocking issue] Helper extraction `_wait_for_health`
The plan called for inlining the 5 service health probes per the existing pattern. Adding a fifth (monitor) to the existing copy-paste structure crossed the readability threshold (~120 lines of near-identical waits). Extracted into `_wait_for_health(label, url, hint)`. Behaviour identical.

### 2. [Rule 3 — Blocking issue] `mint_compliance/branding/llm_dashboard/llm_compliance_oauth_client` extracted as siblings of `mint_monitor_oauth_client`
The plan called for adding `mint_monitor_oauth_client` and gating it via the caller. The existing 4 OAuth blocks were already inlined in `create_oauth_client` and gating each one inline against `INSTALL_COMPONENTS` would have produced unreadable nested conditionals. Extracted each into a `mint_*_oauth_client` function, then gated the 5 calls cleanly in `create_oauth_client`. Each function body is byte-identical to the pre-refactor inline block. Same shape Phase 42 wanted for monitor; just applied uniformly to keep the gating logic flat.

### 3. [Rule 2 — Critical functionality] Tasks 1 + 2 committed together
The plan structured these as two separate tasks. In execution they were intertwined: Task 1's dispatch loop references functions only defined in Task 2 (`write_systemd_unit_monitor`, `mint_monitor_oauth_client`). Splitting into two commits would have produced an intermediate broken commit (Task 1 commit referencing undefined functions). One combined commit `1cd95cc` covers both tasks; commit message details the split.

## Authentication Gates

None. This plan modifies only `install.sh`; no service-side authentication occurs during execution.

## Known Stubs

None.

## Threat Flags

None — Phase 42 introduces no new security primitives. All auth flows reuse existing OAuth2 client credentials (per RESEARCH §Security domain). Only new env vars (`MONITOR_CLIENT_*`) inherit existing secrets-handling discipline.

## Next Steps

- **Plan 42-02:** mirror to `install.command` (launchd) and `install.ps1` (NSSM/Task Scheduler) — same `INSTALL_COMPONENTS` model, same monitor registration shape.
- **Plan 42-04 (verification):** runtime LXC gate — fresh container, validate INST-01..04 against the 5 scenarios in plan `<verification>` block.

## Self-Check: PASSED

- `install.sh` exists (modified): FOUND
- Commit `1cd95cc` exists: FOUND
- All plan `<verify>` automated greps pass (see Verification Results above)
- All plan `<done>` criteria satisfied for both Task 1 and Task 2
