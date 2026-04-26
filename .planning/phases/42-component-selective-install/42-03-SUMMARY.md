---
phase: 42-component-selective-install
plan: 03
subsystem: installer
tags: [docker-compose, installer, docs, monitor, llm]
requirements: [INST-01, INST-03]
requires: []
provides:
  - "docker-compose.yml with 5 services + opt-in monitor profile"
  - "Phase 42 installer changelog entry"
  - "MONITOR_* env-var reference"
  - "4-profile installation guide"
affects:
  - docker-compose.yml
  - docs/deployment/installer-changelog.md
  - docs/deployment/installer-env-vars.md
  - docs/getting-started/installation.md
tech_stack:
  added: []
  patterns:
    - "docker-compose profiles: [<name>] for opt-in services"
key_files:
  created: []
  modified:
    - docker-compose.yml
    - docs/deployment/installer-changelog.md
    - docs/deployment/installer-env-vars.md
    - docs/getting-started/installation.md
decisions:
  - "Monitor port locked at 4300 (not 4200) to avoid LLM collision (locked user answer #1)"
  - "Profile 4 ships 5 Luqen services + monitor only — no pa11y, mongo, redis (locked user answer #2)"
  - "Monitor uses /health endpoint (cli.ts line 101) for healthcheck, not /agent or /.well-known/agent.json"
  - "Monitor opt-in via docker compose --profile monitor up — implements D-03 invariant at compose layer"
metrics:
  duration: "~10 min"
  completed: 2026-04-26
---

# Phase 42 Plan 03: Docker Compose + Installer Docs Refresh Summary

Brought `docker-compose.yml` up to v3.1.0 codebase reality (was missing `llm` and had never registered the monitor agent) and refreshed the three operator-facing installer docs to document the new 4-profile wizard model and `MONITOR_*` env vars.

## Tasks completed

### Task 1: Add llm + monitor services to docker-compose.yml

**Commit:** `19361db`

- Added `llm` service between `branding` and `dashboard`, mirroring the branding shape (build, command, ports, healthcheck, llm-data volume).
- Wired `dashboard.depends_on.llm: condition: service_healthy` and added `DASHBOARD_LLM_URL=http://llm:4200` to the dashboard env block.
- Added `monitor` service after `dashboard` with port 4300, `profiles: [monitor]` for opt-in start, `depends_on.compliance: condition: service_healthy`, and a healthcheck on `/health` (verified against `packages/monitor/src/cli.ts:101`).
- Added `llm-data` and `monitor-data` named volumes.
- Did **not** add pa11y / mongo / redis services per locked scope.

**YAML structure validation** (via js-yaml): 5 services (`compliance, branding, llm, dashboard, monitor`), 8 named volumes, monitor profiles `[monitor]`, monitor port `${MONITOR_PORT:-4300}:4300`, llm port `${LLM_PORT:-4200}:4200`, dashboard `depends_on: [compliance, branding, llm]`. All correct.

### Task 2: Update operator-facing installer docs

**Commit:** `4663f7c`

- **`installer-changelog.md`** — appended a `## v3.1.x — Installer Wizard Redesign (Phase 42)` section above the v3.1.0 entry, covering: 4-profile wizard restructure, new flags table (`--profile`, `--api-services`, `--with-monitor`, `--without-*`, `--monitor-port`), monitor registration on Linux/macOS/Windows/Docker, install.ps1 parity bug fixes, docker-compose restructure, migration note for idempotent re-runs.
- **`installer-env-vars.md`** — added a "Monitor agent (Phase 42, `--with-monitor`)" section with a 6-row table: `MONITOR_COMPLIANCE_URL`, `MONITOR_CLIENT_ID`, `MONITOR_CLIENT_SECRET`, `MONITOR_URL`, `MONITOR_PORT`, `MONITOR_CHECK_INTERVAL`. Each row documents default, when required, source, and purpose.
- **`installation.md`** — inserted a new "Deployment profiles (Phase 42)" section before Quick start with subsections for Profile 1 (Scanner CLI, stdio MCP via `core/dist/mcp.js`), Profile 2 (API services), Profile 3 (Self-hosted dashboard, default), Profile 4 (Docker Compose), a Monitor agent subsection, and a Common invocations table.

## Verification results

- `docker compose config` exit 0 — **deferred to UAT (LXC)**, locked verification path. Docker is not installed in this worktree environment.
- YAML structural validation via `js-yaml` — passed (correct services, volumes, profiles, depends_on).
- All grep guards from plan `<verify><automated>` blocks — passed:
  - `grep -q "  llm:" docker-compose.yml` — passed
  - `grep -q "  monitor:" docker-compose.yml` — passed
  - `grep -q "MONITOR_CLIENT_ID" docker-compose.yml` — passed
  - `grep -q "4300:4300" docker-compose.yml` — passed
  - `grep -q "profiles:" docker-compose.yml` — passed
  - `grep -q "llm-data:" docker-compose.yml` — passed
  - `grep -q "Phase 42" docs/deployment/installer-changelog.md` — passed
  - `grep -q "MONITOR_CLIENT_ID" docs/deployment/installer-env-vars.md` — passed
  - `grep -q "MONITOR_PORT" docs/deployment/installer-env-vars.md` — passed
  - `grep -q "Scanner CLI" docs/getting-started/installation.md` — passed
  - `grep -q "Self-hosted dashboard" docs/getting-started/installation.md` — passed
  - `grep -q "Docker Compose" docs/getting-started/installation.md` — passed
  - `grep -q -- "--with-monitor" docs/getting-started/installation.md` — passed

## Deviations from Plan

### Rule 3 — Blocking: Monitor healthcheck endpoint resolved to `/health`

The plan instructed verifying the A2A endpoint path against `packages/monitor/src/agent.ts` and using either `/agent` or `/.well-known/agent.json`. Reading `packages/monitor/src/cli.ts:91-101` revealed the actual HTTP server exposes both `/.well-known/agent.json` (GET) **and** `/health` (GET) — `/health` is the correct healthcheck target since it's the dedicated liveness endpoint. The healthcheck stanza in the new `monitor` service uses `curl -sf http://localhost:4300/health`. Tracked as a Rule 3 micro-decision (blocker resolution: pick the right endpoint to satisfy the healthcheck contract).

### Incidental files in Task 1 commit

The `git commit -a` style behaviour swept pre-existing modifications to `.planning/STATE.md` (5 lines) and `.planning/ROADMAP.md` (5 lines) into the Task 1 commit. These were unrelated, already-modified files from prior wave activity (visible in `git status` before this plan started). Not a regression — they're updates the upstream state-management workflow had staged. No semantic change to the plan deliverable. Documented here for transparency.

## Auto-fix attempts

None used; no errors encountered.

## Self-Check: PASSED

- `docker-compose.yml` — FOUND, contains `llm:`, `monitor:`, `profiles: [monitor]`, port `4300:4300`, `MONITOR_CLIENT_ID`, `llm-data:` and `monitor-data:` volumes.
- `docs/deployment/installer-changelog.md` — FOUND, contains `Phase 42` section header and `--with-monitor` flag documentation.
- `docs/deployment/installer-env-vars.md` — FOUND, contains `MONITOR_CLIENT_ID`, `MONITOR_PORT`, `MONITOR_CHECK_INTERVAL` rows.
- `docs/getting-started/installation.md` — FOUND, contains all 4 profile names, common invocations table, monitor agent subsection.
- Commit `19361db` — FOUND in `git log`.
- Commit `4663f7c` — FOUND in `git log`.
