[Docs](../README.md) > [Getting Started](./) > Installation

# Installation Guide

> **What's new in v3.1.0**
>
> v3.1.0 (Phase 40 — documentation sweep) ships no new product features
> but closes documentation and installer-script gaps accumulated since
> v2.12.0. Fresh installs from `install.sh` / `install.command` /
> `install.ps1` reach migration head **061** in one pass.
>
> If you're upgrading **from v2.12.0**, the most important deltas are:
>
> 1. New env vars — set `DASHBOARD_PUBLIC_URL` (and the matching
>    `*_PUBLIC_URL` siblings) for any non-localhost deployment.
> 2. New admin pages — `/admin/audit` (audit log viewer) and
>    `/admin/oauth-keys` (signing-key inventory).
> 3. New RBAC permission — `mcp.use` (auto-back-filled by migration 054).
>
> Full per-version detail in
> [docs/deployment/installer-changelog.md](../deployment/installer-changelog.md).
> Authoritative env-var reference in
> [docs/deployment/installer-env-vars.md](../deployment/installer-env-vars.md).

This guide covers running the interactive installer wizard end-to-end on
Linux, macOS, and Windows. For headless / CI installs see
[one-line-install.md](./one-line-install.md).

---

## Deployment profiles (Phase 42)

The Phase 42 wizard rewrite replaces the previous 3-way menu with **four
explicit deployment profiles**. Pick one with `--profile <name>` (or via
the interactive wizard prompt). Each profile maps to a different shape
of host install.

### Profile 1: Scanner CLI (`--profile cli`)

Installs `@luqen/core` only. **No system services are registered.** Use
this profile when you only need ad-hoc command-line scans or stdio MCP
integration with VS Code / Claude Code / Claude Desktop.

```bash
bash install.sh --profile cli
luqen scan https://example.com
node packages/core/dist/mcp.js   # stdio MCP server (no port, no daemon)
```

The stdio MCP transport at `packages/core/dist/mcp.js` is the
canonical Profile 1 IDE integration — no dashboard plugin or HTTP
endpoint is required.

### Profile 2: API services, headless (`--profile api`)

Installs any subset of the three backing API services
(compliance / branding / llm) without a dashboard. Each selected service
is registered as its own systemd unit / launchd agent / NSSM service.
Use this profile when you have a dedicated API host (for example a
compliance-only API behind your own front-end).

```bash
bash install.sh --profile api --api-services compliance
bash install.sh --profile api --api-services compliance,branding,llm
```

### Profile 3: Self-hosted dashboard (`--profile dashboard`, default)

Installs the dashboard plus your chosen subset of {compliance, branding,
llm}. This is the default profile — running `install.sh` with no flags
gives you all four services and the dashboard. Use the `--without-*`
flags to drop any backing service:

```bash
bash install.sh --non-interactive --admin-user admin --admin-pass '...'
bash install.sh --profile dashboard --without-llm --non-interactive ...
```

### Profile 4: Docker Compose (`--profile docker`)

Spins up the full stack via `docker-compose.yml`. The compose file ships
**5 services**:

- `compliance` (port 4000)
- `branding` (port 4100)
- `llm` (port 4200)
- `dashboard` (port 5000)
- `monitor` (port 4300, opt-in via `--profile monitor`)

```bash
docker compose up -d                       # 4 services, no monitor
docker compose --profile monitor up -d     # 5 services including monitor
```

> Locked scope: Profile 4 ships **5 Luqen services + the optional
> monitor only** — no `pa11y`, no `mongo`, no `redis`. The pa11y npm
> library is bundled into compliance via `@luqen/core`; Mongo and Redis
> remain plugin-driven and orthogonal to the installer surface.

### Monitor agent

The `@luqen/monitor` agent is a separate, opt-in service that watches
external regulation / standards / branding sources and posts update
proposals back to the compliance service. Opt in with `--with-monitor`
on Profiles 2 / 3 (or `docker compose --profile monitor up` for
Profile 4). Default port **4300** (configurable via `--monitor-port`),
chosen to avoid collision with the LLM service on 4200.

The monitor runs in `MONITOR_CHECK_INTERVAL=manual` mode by default —
it does **not** poll on a schedule. Operators trigger scans via the
dashboard's MCP integration or directly via the
`luqen-monitor scan` CLI. Selecting `--with-monitor` without
compliance is a parser error — the agent has no useful behaviour
without an upstream compliance API to post proposals to.

### Common invocations

| Invocation | Result |
|------------|--------|
| `bash install.sh --non-interactive --admin-user X --admin-pass Y` | Default: Profile 3, dashboard + 4 services, no monitor. |
| `bash install.sh --profile cli` | Scanner CLI only. No services registered. |
| `bash install.sh --profile api --api-services compliance` | Headless compliance API. |
| `bash install.sh --profile dashboard --with-monitor --non-interactive --admin-user X --admin-pass Y` | Default install + monitor agent. |
| `bash install.sh --profile docker` | Docker Compose stack (5 services, monitor opt-in). |

For the complete list of installer flags and the env vars each profile
emits, see [installer-env-vars.md](../deployment/installer-env-vars.md)
and [installer-changelog.md](../deployment/installer-changelog.md).

---

## Quick start

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
```

Creates four systemd units (`luqen-compliance`, `luqen-branding`,
`luqen-llm`, `luqen-dashboard`) under `/etc/systemd/system/`, runs
migrations to head 061, and prints a "What's new since v2.12.0" summary
on completion.

### macOS

Either:

```bash
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.command | bash
```

…or download `install.command` and double-click in Finder.

The macOS installer delegates to `install.sh` and then writes four
launchd plists under `~/Library/LaunchAgents/io.luqen.{compliance,
branding,llm,dashboard}.plist`.

### Windows (PowerShell, admin)

```powershell
irm https://raw.githubusercontent.com/trunten82/luqen/master/install.ps1 | iex
```

Registers four services — `LuqenCompliance`, `LuqenBranding`,
`LuqenLlm`, `LuqenDashboard` — via NSSM if present, otherwise via Task
Scheduler.

---

## Production: setting `*_PUBLIC_URL`

For any deployment behind a real hostname or behind a reverse proxy,
override the public URLs at install time. Examples:

### Linux / macOS

```bash
DASHBOARD_PUBLIC_URL="https://luqen.example.com" \
COMPLIANCE_PUBLIC_URL="https://luqen.example.com/compliance" \
BRANDING_PUBLIC_URL="https://luqen.example.com/branding" \
LLM_PUBLIC_URL="https://luqen.example.com/llm" \
  bash install.sh \
    --dashboard-public-url https://luqen.example.com \
    --compliance-public-url https://luqen.example.com/compliance \
    --branding-public-url https://luqen.example.com/branding \
    --llm-public-url https://luqen.example.com/llm
```

### Windows

```powershell
$env:DASHBOARD_PUBLIC_URL  = "https://luqen.example.com"
$env:COMPLIANCE_PUBLIC_URL = "https://luqen.example.com/compliance"
$env:BRANDING_PUBLIC_URL   = "https://luqen.example.com/branding"
$env:LLM_PUBLIC_URL        = "https://luqen.example.com/llm"
.\install.ps1
```

The dashboard advertises itself as the OAuth 2.1 issuer using
`DASHBOARD_PUBLIC_URL`. External MCP clients (Claude Desktop, IDEs)
discover the JWKS endpoint at `${DASHBOARD_PUBLIC_URL}/oauth/.well-known/jwks.json`.
Setting the value wrong or leaving it as `localhost` in production will
break OAuth client credential flows.

---

## What the installer creates

| Path | Purpose |
|------|---------|
| `${INSTALL_DIR}/dashboard.config.json` | Dashboard service configuration (URLs, OAuth client credentials, DB path). |
| `${INSTALL_DIR}/dashboard.db` | SQLite database. Migrations auto-apply to head 061 on first start. |
| `${INSTALL_DIR}/.install-*-client` | Cached OAuth client credentials (compliance, branding, llm). Re-used on re-runs. |
| `${INSTALL_DIR}/packages/{compliance,branding,llm}/keys/` | RS256 key pairs for inter-service auth. |
| `/etc/systemd/system/luqen-*.service` (Linux) | systemd units. |
| `~/Library/LaunchAgents/io.luqen.*.plist` (macOS) | launchd agents. |
| Windows services / Scheduled Tasks | Service registration via NSSM or Task Scheduler. |

---

## Admin pages introduced since v2.12.0

| URL | Purpose | Permission |
|-----|---------|------------|
| `/admin/audit` | Agent audit log viewer with filter bar + CSV export | `audit.view` |
| `/admin/oauth-keys` | OAuth signing-key inventory with manual rotate | `admin.system` |
| `/agent` | Agent companion side panel (text + speech) | `mcp.use` |
| `/agent/share/<id>` | Read-only share-link permalinks | (public, token-gated) |
| `/api/mcp` | Streamable HTTP MCP endpoint | `mcp.use` |

---

## RBAC permissions introduced since v2.12.0

| Permission | Description |
|------------|-------------|
| `mcp.use` | Required to call MCP tools (the dashboard agent panel and all external MCP clients). Migration 054 back-fills this permission onto every role that existed before the upgrade so existing users keep working. |

---

## Verifying a fresh install

After the installer reports "What's new since v2.12.0", verify:

```bash
# Services up
curl -sf http://localhost:4000/api/v1/health   # compliance
curl -sf http://localhost:4100/api/v1/health   # branding
curl -sf http://localhost:4200/api/v1/health   # llm
curl -sf http://localhost:5000/health          # dashboard

# Migration head reached
sqlite3 ~/luqen/dashboard.db "SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1;"
# expected: 061

# Admin login + new pages
# 1. Visit /admin/audit (need audit.view)
# 2. Visit /admin/oauth-keys (need admin.system)

# MCP discovery reachable
curl -sf "${DASHBOARD_PUBLIC_URL:-http://localhost:5000}/oauth/.well-known/oauth-authorization-server" | head
```

End-to-end fresh-container dry-run is owned by Phase 40 Plan 40-07.

---

## Uninstalling

All three installers expose a parallel uninstall flow: stop the four
daemons, remove the platform's service registration (systemd / launchd /
NSSM / Task Scheduler), and either preserve or purge data files.

### Linux

```bash
# Default: stop services, remove systemd units, back up DB + config
# to ~/.luqen-uninstall-<timestamp>/ then delete the install dir.
sudo bash install.sh --uninstall

# Drop everything including DB, config, ~/.luqen.
sudo bash install.sh --uninstall --purge
```

### macOS

```bash
# install.command unloads ~/Library/LaunchAgents/io.luqen.*.plist
# and forwards the rest to install.sh's uninstall path.
bash install.command --uninstall
bash install.command --uninstall --purge
```

### Windows (PowerShell, admin)

```powershell
# Removes NSSM services if present, otherwise unregisters the
# Task Scheduler tasks. Backs up DB + config to %USERPROFILE%\.luqen-uninstall-<ts>\.
.\install.ps1 -Uninstall
.\install.ps1 -Uninstall -Purge
```

`--keep-data` / `-KeepData` is the explicit form of the default
(no-purge) behaviour. Pass `--purge` / `-Purge` only when you want
the database, config, and `~/.luqen` cache wiped.

After uninstall, you can re-run the installer cleanly to start fresh,
or restore from the backup directory printed by the uninstall flow.

---

## Related documentation

- [Installer env vars](../deployment/installer-env-vars.md) —
  authoritative list of every variable the installer reads or sets.
- [Installer changelog](../deployment/installer-changelog.md) —
  per-version installer delta from v2.12.0 to v3.1.0.
- [One-line install](./one-line-install.md) — wizard-less / CI installs.
- [Quick scan](./quick-scan.md) — running your first scan after install.
