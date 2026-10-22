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
| `bash install.sh --non-interactive --admin-user X --admin-pass Y --trusted-proxies 'loopback,198.51.100.20'` | Default install; the dashboard trusts a load balancer at that address and the proxy on the same host. See [Production: the trusted-proxy list](#production-the-trusted-proxy-list). |

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

## Production: the trusted-proxy list

Read this when the dashboard sits behind a reverse proxy, a load balancer or a CDN. It says whether you need to give
the installer a trusted-proxy list, how to give it on a fresh install, and how to set it on an install that already
exists.

Conventions for every command below:

- Run as root on the dashboard host, unless a step says otherwise.
- Each fenced block is one shell invocation. Blocks share nothing, so each one finds the install directory itself:
  `${INSTALL_DIR}` is the dashboard unit's `WorkingDirectory`, read with `systemctl show -p WorkingDirectory --value luqen-dashboard`
  (it prints a path only).
- Example addresses are documentation ranges (192.0.2.0/24, 198.51.100.0/24, 2001:db8::/32). Replace them with your
  proxies' own addresses.
- Never print the dashboard unit's environment (no `systemctl cat`, no `systemctl show -p Environment`, no `cat` of
  a unit file): it holds secrets. The checks below print paths, counts and hashes only.

### When to set it

The dashboard reads the real client address from `X-Forwarded-For`, and only when the connection comes from a proxy it
trusts. By default it trusts three named ranges, as the `proxy-addr` library that Fastify uses defines them:

| Name | Covers |
|------|--------|
| `loopback` | 127.0.0.1/8, ::1/128 |
| `linklocal` | 169.254.0.0/16, fe80::/10 |
| `uniquelocal` | 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7 |

- Your proxy connects from an address inside those ranges (for example nginx on the same host, or a load balancer on
  a private network): you need nothing. Give no list.
- Your reverse proxy, load balancer or CDN connects from an address outside those ranges: set the list. Without it, every
  request appears to come from the proxy. The sign-in limit then counts all users together, the per-address request limits
  do too, and the audit trail records the proxy's address instead of the user's.
- Nothing sits in front of the dashboard and clients connect to it directly: set the list to `none`, so that no
  `X-Forwarded-For` header is believed.

### The default

With no list the installer writes nothing, and the dashboard's built-in default (`loopback`, `linklocal`, `uniquelocal`)
applies. A list you give REPLACES that default. Keep `loopback` in your list when a proxy on the same host also forwards
requests.

### Fresh install

Give the list in one of three ways. The flag wins over the environment, and the prompt keeps whatever the flag or the
environment gave when you answer it with nothing.

| Way | Form |
|-----|------|
| Flag | `--trusted-proxies LIST` |
| Installer environment | `DASHBOARD_TRUSTED_PROXIES=LIST` |
| Wizard prompt | `Trusted proxies (reverse proxy / load balancer)`, asked in the interactive install; an empty answer keeps the default |

```bash
bash install.sh --non-interactive --admin-user X --admin-pass Y \
  --trusted-proxies 'loopback,198.51.100.20'
```

The same list through the environment:

```bash
DASHBOARD_TRUSTED_PROXIES='loopback,198.51.100.20' \
  bash install.sh --non-interactive --admin-user X --admin-pass Y
```

A profile that installs no dashboard (`cli`, `api`) refuses the flag, because the list is a dashboard setting.

### What the installer does with it

- The dashboard's own rules check the list after the build and before anything is written. A refused list stops the
  install with the dashboard's message, and no secret, configuration file or service unit has been written.
- It writes one `Environment=DASHBOARD_TRUSTED_PROXIES=` line into `luqen-dashboard.service`, in canonical form: no
  spaces, named ranges in lower case, and every `%` doubled (systemd reads `%` as a specifier and otherwise drops the
  whole line without an error).
- The closing summary prints the list read back from that file, as the dashboard resolves it.
- Docker: the installer writes the `DASHBOARD_TRUSTED_PROXIES=` line into `.env`, and `docker-compose.yml` passes it to
  the dashboard container only. A Docker install has no host-side build to check against, so the container start is
  the check: a refused list keeps the container down and the installer prints the compose logs. The characters
  `#`, `$`, `'`, `"`, a backtick and `\` are refused up front, because compose would rewrite them in `.env`.
- macOS: the value goes into the dashboard's launchd plist.
- Windows: `install.ps1` does not take the list.

### Check a list without installing

```bash
bash install.sh --trusted-proxies 'loopback,198.51.100.20' --check-trusted-proxies --install-dir "${INSTALL_DIR}"
```

It checks the list with the dashboard built in `--install-dir`, prints what an install would write, and installs
nothing. For an accepted list it prints three lines:

```text
accepted: loopback,198.51.100.20
systemd line: Environment=DASHBOARD_TRUSTED_PROXIES=loopback,198.51.100.20
effective: loopback,198.51.100.20
```

For a blank list it prints `blank: nothing would be written` and the `effective:` line, which is the default.

| Exit status | Meaning |
|-------------|---------|
| 0 | accepted, or blank |
| 2 | refused: the dashboard's message is on stderr and nothing would be written |
| 3 | the check could not run (the dashboard is not built in `--install-dir`, or `node` is missing) |

This needs an `install.sh` from this release or later. An older install can run a newly downloaded copy of `install.sh`
pointed at its own `--install-dir`, because the check uses that install's built dashboard.

### Existing install

Do NOT re-run `install.sh` to add the list to an install that is running. A re-run generates a new session secret and
writes it into `dashboard.config.json`, and it rewrites the service units. That signs every user out and, unless
`DASHBOARD_ENCRYPTION_KEY` is pinned, changes the at-rest encryption key as well (the key defaults to the session
secret); see [Rotating the session secret and the at-rest encryption key](../guides/security-administration.md#rotating-the-session-secret-and-the-at-rest-encryption-key).

Set the list with a systemd drop-in instead. A drop-in's assignment applies after the main unit's (systemd's documented
order). These blocks need the checkout in `${INSTALL_DIR}` to be at this release or later, because they use its
`install.sh` and `scripts/`.

1. Check the list and write the drop-in. The block writes nothing when the list is refused, blank, or the installer is too
   old, and it keeps a copy of a drop-in it replaces.

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  LIST='loopback,198.51.100.20'   # replace with your proxies
  D=/etc/systemd/system/luqen-dashboard.service.d
  grep -q -- '--check-trusted-proxies' "${INSTALL_DIR}/install.sh" \
    || { echo "install.sh in ${INSTALL_DIR} predates --check-trusted-proxies: update the checkout first"; exit 1; }
  OUT="$(bash "${INSTALL_DIR}/install.sh" --trusted-proxies "${LIST}" --check-trusted-proxies --install-dir "${INSTALL_DIR}")"
  LINE="$(printf '%s\n' "${OUT}" | sed -n 's/^systemd line: //p')"
  [ -n "${LINE}" ] || { echo "the check printed no systemd line (blank list): nothing to write"; exit 1; }
  mkdir -p "${D}"
  rm -f "${D}/.trusted-proxies.conf.previous"
  [ ! -f "${D}/trusted-proxies.conf" ] || cp -p "${D}/trusted-proxies.conf" "${D}/.trusted-proxies.conf.previous"
  T="$(mktemp "${D}/.trusted-proxies.XXXXXX")"
  printf '[Service]\n%s\n' "${LINE}" > "${T}"
  chmod 644 "${T}"
  sync "${T}"
  mv "${T}" "${D}/trusted-proxies.conf"
  sync "${D}"
  echo "wrote ${D}/trusted-proxies.conf"
)
```

   A refused list stops the block at the check, prints the dashboard's message and exits 2. Correct `LIST` and run it again.

2. Reload systemd and confirm it sees the drop-in. The second command prints paths only:

```bash
systemctl daemon-reload && systemctl show -p DropInPaths --value luqen-dashboard
```

   Expect `/etc/systemd/system/luqen-dashboard.service.d/trusted-proxies.conf` in the output.

3. Wait for running scans, then restart straight away. A restart fails every queued or running scan, so
   `scripts/deploy-drain.mjs` waits for them first (the deploy workflow does the same). It reads the dashboard database
   from `dashboard.config.json` in the working directory, exits 0 when no scan is active, and exits 3 after
   `DRAIN_TIMEOUT_SEC` seconds with scans still active. On exit 3, or any other failure, the block stops before the
   restart. Run it again later.

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  cd "${INSTALL_DIR}"
  DRAIN_TIMEOUT_SEC=1800 DRAIN_POLL_SEC=15 node scripts/deploy-drain.mjs
  systemctl restart luqen-dashboard
)
```

4. Verify. The dashboard answers on its health endpoint (port 5000 is the default; use yours if you changed it), the unit is
   active, and the comparison script reports whether the running value is the one the installer would write. It prints
   names, paths, counts and sha256 only, never a value.

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  timeout 90 bash -c 'until curl -fsS -o /dev/null http://127.0.0.1:5000/health 2>/dev/null; do sleep 2; done'
  systemctl is-active luqen-dashboard
  bash "${INSTALL_DIR}/scripts/compare-trusted-proxies.sh"
)
```

   Expect `active`, then among the lines: `validator=accepted`, `running_equals_installer_value=yes`,
   `location_differs=yes` (the setting lives in the drop-in, where the installer would have written it into the main
   unit), `need_daemon_reload=no`, and a last line `result=compared`.
   Once it is verified, `rm -f /etc/systemd/system/luqen-dashboard.service.d/.trusted-proxies.conf.previous` removes the
   saved copy of an earlier drop-in.

5. If the dashboard does not come up, the dashboard refused the list at start. Read the reason (this prints journal
   lines, which hold the refusal and not the environment):

```bash
journalctl -u luqen-dashboard -n 20 --no-pager | grep 'Failed to start server'
```

   Then roll back. The block restores the drop-in it replaced, or removes the one it wrote:

```bash
(
  set -euo pipefail
  D=/etc/systemd/system/luqen-dashboard.service.d
  if [ -f "${D}/.trusted-proxies.conf.previous" ]; then
    mv "${D}/.trusted-proxies.conf.previous" "${D}/trusted-proxies.conf"
  else
    rm -f "${D}/trusted-proxies.conf"
  fi
  systemctl daemon-reload
  systemctl restart luqen-dashboard
)
```

Docker install: the list lives in `.env` next to `docker-compose.yml`. Run this in that directory. It replaces the
`DASHBOARD_TRUSTED_PROXIES=` line (or adds it) through a temp file, then recreates the dashboard container only. The
container start is the check; read the logs afterwards.

```bash
(
  set -euo pipefail
  LIST='loopback,198.51.100.20'   # replace with your proxies
  T="$(mktemp .env.XXXXXX)"
  { grep -v '^DASHBOARD_TRUSTED_PROXIES=' .env || true; printf 'DASHBOARD_TRUSTED_PROXIES=%s\n' "${LIST}"; } > "${T}"
  chmod --reference=.env "${T}"
  sync "${T}"
  mv "${T}" .env
  sync .
  docker compose up -d dashboard
  docker compose logs --tail 20 dashboard
)
```

### What the dashboard refuses

The dashboard refuses, at start, a list that trusts every address or whose public ranges together are too wide, a hop
count, and a malformed entry. The rules and the counting are stated once, in the Client address row of
[Session security](../guides/security-administration.md#session-security).

### The accepted residual

A host inside a trusted range can choose the forwarded address the dashboard records, which feeds the sign-in limit,
the other per-address limits and the audit trail. So list your proxies' own addresses, not whole networks that other
clients share.

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
| `/agent` | Agent companion side panel (text + speech) | signed-in users; its tools follow the user's role |
| `/agent/share/<id>` | Read-only share-link permalinks | (public, token-gated) |
| `/api/v1/mcp` | Streamable HTTP MCP endpoint | `mcp.use` |

---

## RBAC permissions introduced since v2.12.0

| Permission | Description |
|------------|-------------|
| `mcp.use` | Required to connect external MCP clients: for consent and on every MCP request, in the token's organization. The in-dashboard assistant does not require it. Migration 054 back-fills this permission onto every role that existed before the upgrade so existing users keep working. |

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
