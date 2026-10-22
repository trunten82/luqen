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
exists (systemd or Docker).

Conventions for every command below:

- Run as root on the dashboard host, unless a step says otherwise.
- Each fenced block is one shell invocation. Blocks share nothing. A systemd block that needs the install directory
  reads it itself, as the dashboard unit's `WorkingDirectory` (`systemctl show -p WorkingDirectory --value
  luqen-dashboard` prints a path only), and stops with exit status 3 when the host has no `luqen-dashboard` unit. A
  Docker block works on the current directory: `cd` to the directory that holds `docker-compose.yml` first, and the
  block stops with exit status 3 when that file is not there.
- Always quote the list: `--trusted-proxies '...'`, `LIST='...'`. Unquoted, the shell replaces `*` with the names of
  the files in the current directory (see [What the dashboard refuses](#what-the-dashboard-refuses)).
- Example addresses are documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32). Replace
  them with your proxies' own addresses.
- Never print the dashboard unit's environment (no `systemctl cat`, no `systemctl show -p Environment`, no `cat` of
  a unit file or of `.env`): it holds secrets. The checks below print paths, counts, verdict words and hashes only (and
  the Docker gateway lookup, a network address).

### When to set it

The dashboard reads the real client address from `X-Forwarded-For`, and only through proxies it trusts. It walks from
the connection towards the client: first the address the connection comes from, then the `X-Forwarded-For` entries from
the right. It passes an address only while that address is trusted, and the first address that is not trusted is the
client. By default it trusts three named ranges, as `@fastify/proxy-addr` (the library Fastify uses) defines them:

| Name | Covers |
|------|--------|
| `loopback` | 127.0.0.1/8, ::1/128 |
| `linklocal` | 169.254.0.0/16, fe80::/10 |
| `uniquelocal` | 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7 |

`uniquelocal` holds the private IPv4 ranges. So by default the dashboard believes `X-Forwarded-For` from any host on a
private or link-local network that can reach its port, not only from your proxies. That is accepted for the default
(see [The accepted residual](#the-accepted-residual)); the first row below says how to close it.

| Your setup | What to give |
|------------|--------------|
| The only proxy is on the dashboard host (for example nginx connecting to 127.0.0.1) | Nothing: the default covers it. For the tightest list, give `loopback` alone. A host on your network that reaches the dashboard port directly can then no longer choose the address it is recorded under. On Docker a proxy on the host is not `loopback`: see [Existing install (Docker)](#existing-install-docker). |
| A proxy or load balancer on a private network, inside the ranges above | Nothing: the default covers it. For a tighter list, give that proxy's own address, and add `loopback` when a proxy on the dashboard host also forwards. |
| A reverse proxy, load balancer or CDN that connects from an address outside those ranges | A list naming every proxy in the chain (next section), including `loopback` when a proxy on the dashboard host forwards too. A list replaces the default, so add `linklocal` or `uniquelocal` only when a proxy connects from those ranges: each one you add trusts every host in it. Without a list, every request appears to come from the proxy: the sign-in limit counts all users together, the per-address request limits do too, and the audit trail records the proxy's address instead of the user's. |
| Nothing: clients connect to the dashboard directly | `none`, so that no `X-Forwarded-For` header is believed. |

### A chain of proxies

Every proxy between the client and the dashboard must be in the list, because the walk stops at the first address that
is not trusted. Example: a load balancer at 198.51.100.20 forwards to nginx on the dashboard host, and nginx connects to
the dashboard on 127.0.0.1. The list is `loopback,198.51.100.20`. What `@fastify/proxy-addr` returns for a client at
203.0.113.7 in that chain:

| List | The client is recorded as |
|------|---------------------------|
| `loopback,198.51.100.20` | 203.0.113.7, the client |
| `loopback` | 198.51.100.20, the load balancer, for every user |
| `198.51.100.20` | 127.0.0.1, nginx, for every user |

Two more rules for the chain:

- Every proxy must append to `X-Forwarded-For`, never replace it. In nginx:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

  `$proxy_add_x_forwarded_for` is the header nginx received with the address nginx sees appended to it.
  `proxy_set_header X-Forwarded-For $remote_addr;` throws away what the load balancer sent, and every user is then
  recorded as the load balancer, whatever the list.
- The list names the address the dashboard sees each connection come from. When nginx reaches the dashboard through an
  address other than loopback (nginx on another host, or a `proxy_pass` to the host's own network address), list the
  address nginx connects from: `loopback` does not cover it.

### The default, and which setting wins

The dashboard takes the list from `DASHBOARD_TRUSTED_PROXIES` when that variable is set and holds more than whitespace; the
`trustedProxies` key in `dashboard.config.json` is then ignored. When the variable is unset, empty or only whitespace, the
key applies. With neither, the default (`loopback`, `linklocal`, `uniquelocal`) applies. A list REPLACES the default; it
does not add to it.

The installer writes only the variable, never the key, and with no list it writes nothing. `--check-trusted-proxies` and
`scripts/compare-trusted-proxies.sh` read only the variable: on a host whose list is in the key, the comparison reports
`running=absent` although the key is in force.

### Fresh install

Run the installer as root on the host that will run the dashboard, from any directory. It clones the repository into
`--install-dir` (default `$HOME/luqen`), builds there, and on Linux writes the service units into `/etc/systemd/system/`. If
`--install-dir` already holds an install, this is not a fresh install: see [Existing install (systemd)](#existing-install-systemd).

```bash
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh -o install.sh
```

Give the list in one of three ways. The flag wins over the environment.

| Way | Form |
|-----|------|
| Flag | `--trusted-proxies 'LIST'` |
| Installer environment | `DASHBOARD_TRUSTED_PROXIES='LIST'` |
| Wizard prompt | `Trusted proxies (reverse proxy / load balancer)`, asked by the interactive install for the `dashboard` and `docker` profiles. The value in brackets is the list from the flag or the environment, or `dashboard default` when neither gave one; an empty answer keeps that value. |

The prompt cannot clear a list that the flag or the environment gave: an empty answer keeps it, and `none` is a list
(trust no proxy), not "no list". To install with no list after giving one, answer `n` at `Proceed with installation?`
and run the installer again without the flag and without the variable, for example
`env -u DASHBOARD_TRUSTED_PROXIES bash install.sh ...`.

```bash
bash install.sh --non-interactive --trusted-proxies 'loopback,198.51.100.20'
```

The same list through the environment:

```bash
DASHBOARD_TRUSTED_PROXIES='loopback,198.51.100.20' bash install.sh --non-interactive
```

These examples create no admin user. `install.sh` takes the admin password only as `--admin-pass PASS`: it does not read
it from the environment, and on the command line it lands in your shell history and, while the installer runs, in the
process list that every local user can read. Either run the installer without `--non-interactive`, where the wizard asks
`Create an admin user now?` and reads the password without echoing it, or leave `--admin-user` and `--admin-pass` out,
sign in with the API key the closing summary prints (`API Key: (save this -- also works for login)`), and create the
admin user on the dashboard's Users page (`/admin/users`).

A profile that installs no dashboard (`cli`, `api`) refuses the list and exits 1, because the list is a dashboard
setting.

The closing summary reads the list back from the unit the installer wrote, as the dashboard resolves it. With a list:

```text
  Trusted proxies (read back from /etc/systemd/system/luqen-dashboard.service): loopback,198.51.100.20 (set by this install)
```

With no list:

```text
  Trusted proxies (read back from /etc/systemd/system/luqen-dashboard.service): loopback,linklocal,uniquelocal (dashboard default, nothing written)
```

A Docker install prints `Trusted proxies: <list> (written to .env; the dashboard container started with it)` or
`Trusted proxies: nothing written; the dashboard default applies`.

Verify a systemd install afterwards. The block waits for the dashboard's health endpoint (port 5000 is the default; use
yours if you changed it), then runs the comparison, which prints names, paths, counts and sha256 only:

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  [ -n "${INSTALL_DIR}" ] || { echo "no luqen-dashboard unit on this host"; exit 3; }
  timeout 90 bash -c 'until curl -fsS -o /dev/null http://127.0.0.1:5000/health 2>/dev/null; do sleep 2; done'
  bash "${INSTALL_DIR}/scripts/compare-trusted-proxies.sh"
)
```

With a list, expect among the lines `running=present`, `validator=accepted`, `running_equals_installer_value=yes`,
`configured_in=/etc/systemd/system/luqen-dashboard.service`, `location_differs=no`, `set_in_more_than_one_place=no`,
`need_daemon_reload=no`, and a last line `result=compared`. With no list, expect `running=absent`,
`installer_would_write=nothing`, `configured_in=none` and `result=compared`. An exit status of 124 means the dashboard
did not answer within 90 seconds.

The comparison confirms the FORM and the LOCATION of the list: the dashboard accepts the running value, it is in the
installer's canonical form, and it is set in the unit the installer wrote. It does not confirm that it is the list you
meant, because it never sees what you typed. The check of intent is the Audit Log: sign in from a browser behind your
proxies and open `/admin/audit-log?action=login.success`; the newest entry must show your own address, not a proxy's.

### What the installer does with it

- Bare metal: the dashboard's own rules check the list after the checkout and build, before any secret, configuration
  file or service unit is written. A refused list stops the install there with exit 1 and the dashboard's message: no
  secret, configuration file or service unit has been written, but the checkout has been cloned or pulled and the
  dashboard rebuilt.
- It writes one `Environment=DASHBOARD_TRUSTED_PROXIES=` line into `luqen-dashboard.service`, in canonical form: no
  spaces, named ranges in lower case, and every `%` doubled (systemd reads `%` as a specifier and otherwise drops the
  whole line without an error).
- The closing summary prints the list read back from that file, as the dashboard resolves it. That is what the file
  sets, not necessarily what the dashboard uses: the summary adds a warning, naming the path (never a value), for each
  drop-in in `luqen-dashboard.service.d/` that sets `DASHBOARD_TRUSTED_PROXIES`, each `EnvironmentFile=` of the unit
  that sets it, and a `trustedProxies` key in `dashboard.config.json` (used whenever the variable is unset or blank).
- Docker: the installer writes the `DASHBOARD_TRUSTED_PROXIES=` line into `.env`, and `docker-compose.yml` passes it to
  the dashboard container only. A Docker install has no host-side build to check against, so the container start is
  the check, and it comes after `.env` is written and the containers are started: a refused list keeps the dashboard
  container down, and the installer prints the compose logs and exits 1 once the health endpoint has not answered for
  about 60 seconds. The characters `#`, `$`, `'`, `"`, a backtick and `\` are refused up front (exit 1, nothing
  written), because compose would rewrite them in `.env`. To recover from a refused list, run the same installer
  command again with the list corrected: the dashboard refused it in its configuration check, which runs before the
  dashboard opens its database, so nothing was stored under the session secret that the second run generates, and the
  second run creates the admin user that the first run never reached.
- macOS: the value goes into the dashboard's launchd plist.
- Windows: `install.ps1` does not take the list.

### Check a list without installing

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  [ -n "${INSTALL_DIR}" ] || { echo "no luqen-dashboard unit on this host: no built dashboard to check against"; exit 3; }
  bash "${INSTALL_DIR}/install.sh" --trusted-proxies 'loopback,198.51.100.20' --check-trusted-proxies --install-dir "${INSTALL_DIR}"
)
```

It checks the list with the dashboard built in the install directory, prints what an install would write, and installs
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
| 3 | the check could not run (no install on this host, the dashboard is not built in `--install-dir`, or `node` is missing) |

The check needs a built dashboard, so it cannot run on a host before the install: it exits 3 there. A fresh install
does not need it, because the install runs the same check after its build and before it writes anything, and stops
with exit 1 on a refused list. An install whose `install.sh` predates `--check-trusted-proxies` updates its checkout
first: see step 1 of [Existing install (systemd)](#existing-install-systemd).

### Existing install (systemd)

Do NOT re-run `install.sh` to add the list to an install that is running. A re-run generates a new session secret and
writes it into `dashboard.config.json`, and it rewrites the service units. That signs every user out and, unless
`DASHBOARD_ENCRYPTION_KEY` is pinned, changes the at-rest encryption key as well (the key defaults to the session
secret); see [Rotating the session secret and the at-rest encryption key](../guides/security-administration.md#rotating-the-session-secret-and-the-at-rest-encryption-key).

Set the list with a systemd drop-in instead. A drop-in's assignment applies after the main unit's (systemd's documented
order). Run the steps in order.

The saved state. Each block that changes something saves what it is about to change, the first time it runs, in
`/etc/systemd/system/luqen-dashboard.service.d/`: the drop-in as it was (`.trusted-proxies.conf.previous`) or a note that
there was none (`.trusted-proxies.conf.absent`), and the checkout's commit before a pull and, on a second line, the
commit the pull produced (`.trusted-proxies.checkout-head`). A later run keeps what is already saved, so the saved state
is from before the OLDEST change that step 8 has not yet closed, and step 7 returns there. systemd reads only files
ending in `.conf` from that directory, so none of these is read as configuration.

**Step 1. Check that the install can take the list.** The recipe uses `install.sh`, `scripts/compare-trusted-proxies.sh`
and `scripts/deploy-drain.mjs` from the checkout in the install directory, and the dashboard built there. The block also
reports saved state left over from an earlier change, whether one of the unit's environment files sets the list, and
whether `dashboard.config.json` holds the `trustedProxies` key (whether the key is there, never its value). It prints
paths and verdict words only.

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  [ -n "${INSTALL_DIR}" ] || { echo "no luqen-dashboard unit on this host"; exit 3; }
  D=/etc/systemd/system/luqen-dashboard.service.d
  if [ -f "${INSTALL_DIR}/packages/dashboard/dist/auth/trusted-proxies.js" ]; then
    echo "build: reads DASHBOARD_TRUSTED_PROXIES"
  else
    echo "build: too old"
  fi
  if grep -q -- '--check-trusted-proxies' "${INSTALL_DIR}/install.sh" 2>/dev/null \
     && [ -f "${INSTALL_DIR}/scripts/compare-trusted-proxies.sh" ] \
     && [ -f "${INSTALL_DIR}/scripts/deploy-drain.mjs" ]; then
    echo "checkout: has the tools this recipe uses"
  else
    echo "checkout: too old"
  fi
  SAVED=""
  for f in .trusted-proxies.conf.previous .trusted-proxies.conf.absent .trusted-proxies.checkout-head; do
    if [ -e "${D}/${f}" ]; then SAVED="${SAVED:+${SAVED} }${f}"; fi
  done
  echo "saved state: ${SAVED:-none}"
  SETS=""
  while read -r f; do
    f="${f#-}"
    if [ -n "${f}" ] && [ -f "${f}" ] && grep -q '^[[:space:]]*DASHBOARD_TRUSTED_PROXIES=' "${f}"; then
      SETS="${SETS:+${SETS} }${f}"
    fi
  done < <(systemctl show -p EnvironmentFiles --value luqen-dashboard | sed -E 's/ \(ignore_errors=[a-z]+\)[[:space:]]*/\n/g')
  echo "environment file sets the list: ${SETS:-no}"
  KEY="$(node -e '
    try { const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
          console.log(Object.hasOwn(c, "trustedProxies") ? "yes" : "no"); }
    catch { console.log("unreadable"); }' "${INSTALL_DIR}/dashboard.config.json")"
  echo "dashboard.config.json sets trustedProxies: ${KEY}"
)
```

- `saved state:` names one or more files: an earlier change was never closed with step 8. If the dashboard runs as you
  want it now, run step 8 first. If you want the state from before that earlier change back, run steps 7 and 4 first.
  If you go on without either, step 7 later returns to the state before the EARLIER change, not before this one.
- `environment file sets the list:` names a file: an `EnvironmentFile=` of the unit sets `DASHBOARD_TRUSTED_PROXIES`.
  systemd lets a variable read from an environment file override every `Environment=` line, a drop-in's included, so a
  drop-in cannot change the list, and step 2 refuses. Change the list in that file instead, as
  [When an environment file sets the list](#when-an-environment-file-sets-the-list) says.
- `dashboard.config.json sets trustedProxies: yes`: the key's list applies whenever the variable is unset (see
  [The default, and which setting wins](#the-default-and-which-setting-wins)). The drop-in overrides it; once the
  drop-in is gone again (step 7 to no drop-in, or the removal below), the key's list applies, not the default, and the
  comparison reports `running=absent` either way. `unreadable`: the file is missing or not valid JSON.
- `build: too old`: the running dashboard does not read the list at all. Upgrade the install first, the way you
  normally deploy it (update the checkout, `npm install`, rebuild, restart). That is outside this recipe; come back to
  step 1 afterwards.
- `build: reads DASHBOARD_TRUSTED_PROXIES` and `checkout: too old`: update the checkout only, with the command the
  installer itself uses to fetch the source. The block saves the commit the checkout is on first (the first time only),
  and after the pull the commit the pull produced (every time), so that step 7 can put the checkout back, and refuses to
  once the checkout has moved on from there:

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  [ -n "${INSTALL_DIR}" ] || { echo "no luqen-dashboard unit on this host"; exit 3; }
  H=/etc/systemd/system/luqen-dashboard.service.d/.trusted-proxies.checkout-head
  mkdir -p "${H%/*}"
  if [ ! -e "${H}" ]; then
    git -C "${INSTALL_DIR}" rev-parse HEAD > "${H}.saving"
    sync "${H}.saving"
    mv "${H}.saving" "${H}"
  fi
  git -C "${INSTALL_DIR}" pull --ff-only
  { head -n 1 "${H}"; git -C "${INSTALL_DIR}" rev-parse HEAD; } > "${H}.saving"
  sync "${H}.saving"
  mv "${H}.saving" "${H}"
)
```

  No rebuild is needed: the build output (`packages/*/dist/`) is not tracked by git, so the pull changes the source and
  the scripts, not the built dashboard whose rules step 2 checks with and which step 4 restarts. If the pull refuses
  (local changes, or no fast-forward), resolve that first. Then run step 1 again.
- Both lines say the install is ready, `saved state: none` and `environment file sets the list: no`: go on to step 2.

**Step 2. Check the list and write the drop-in.** The block writes nothing when the list is refused or blank, or when an
environment file of the unit sets the list. Before its first write it saves the drop-in as it was (or notes that there
was none), and later runs keep that saved state.

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  [ -n "${INSTALL_DIR}" ] || { echo "no luqen-dashboard unit on this host"; exit 3; }
  LIST='loopback,198.51.100.20'   # replace with your proxies
  D=/etc/systemd/system/luqen-dashboard.service.d
  grep -q -- '--check-trusted-proxies' "${INSTALL_DIR}/install.sh" \
    || { echo "install.sh in ${INSTALL_DIR} predates --check-trusted-proxies: do step 1 first"; exit 1; }
  while read -r f; do
    f="${f#-}"
    if [ -n "${f}" ] && [ -f "${f}" ] && grep -q '^[[:space:]]*DASHBOARD_TRUSTED_PROXIES=' "${f}"; then
      echo "${f} sets DASHBOARD_TRUSTED_PROXIES and would override the drop-in: change the list in that file instead (When an environment file sets the list)"; exit 1
    fi
  done < <(systemctl show -p EnvironmentFiles --value luqen-dashboard | sed -E 's/ \(ignore_errors=[a-z]+\)[[:space:]]*/\n/g')
  OUT="$(bash "${INSTALL_DIR}/install.sh" --trusted-proxies "${LIST}" --check-trusted-proxies --install-dir "${INSTALL_DIR}")"
  LINE="$(printf '%s\n' "${OUT}" | sed -n 's/^systemd line: //p')"
  [ -n "${LINE}" ] || { echo "the check printed no systemd line (blank list): nothing to write"; exit 1; }
  mkdir -p "${D}"
  if [ ! -e "${D}/.trusted-proxies.conf.previous" ] && [ ! -e "${D}/.trusted-proxies.conf.absent" ]; then
    if [ -f "${D}/trusted-proxies.conf" ]; then
      cp -p "${D}/trusted-proxies.conf" "${D}/.trusted-proxies.conf.saving"
      sync "${D}/.trusted-proxies.conf.saving"
      mv "${D}/.trusted-proxies.conf.saving" "${D}/.trusted-proxies.conf.previous"
    else
      : > "${D}/.trusted-proxies.conf.absent"
    fi
  fi
  T="$(mktemp "${D}/.trusted-proxies.XXXXXX")"
  printf '[Service]\n%s\n' "${LINE}" > "${T}"
  chmod 644 "${T}"
  sync "${T}"
  mv "${T}" "${D}/trusted-proxies.conf"
  sync "${D}"
  echo "wrote ${D}/trusted-proxies.conf"
)
```

A refused list stops the block at the check, prints the dashboard's message and exits 2. Correct `LIST` and run it
again.

**Step 3. Reload systemd and confirm it sees the drop-in.** The second command prints paths only:

```bash
systemctl daemon-reload && systemctl show -p DropInPaths --value luqen-dashboard
```

Expect `/etc/systemd/system/luqen-dashboard.service.d/trusted-proxies.conf` in the output.

**Step 4. Wait for running scans, then restart straight away.** A restart fails every queued or running scan, so
`scripts/deploy-drain.mjs` waits for them first (the deploy workflow does the same). It exits 0 when no scan is active,
and exits 3 after `DRAIN_TIMEOUT_SEC` seconds with scans still active. On exit 3, or any other failure, the block stops
before the restart. Run it again later.

The drain must read the database the dashboard uses: `DASHBOARD_DB_PATH` when the unit sets it (in an `Environment=`
line or an environment file), else `dbPath` in the config file named by `--config`, resolved against that file's
directory. The block requires the running dashboard's arguments to hold
`--config <install directory>/dashboard.config.json` as two arguments, as `install.sh` writes them (a `--config=<path>`
form, another path or a wrapper script stops it with exit 1). It reads `DASHBOARD_DB_PATH` from the process
environment, which holds what the unit set from either place, and hands it to the drain as `LUQEN_DASHBOARD_DB` without
printing it; without it the drain reads `dbPath` from that same config file. When the dashboard is not running, no scan
can be running (scans run inside the dashboard process), and the block restarts without waiting.

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  [ -n "${INSTALL_DIR}" ] || { echo "no luqen-dashboard unit on this host"; exit 3; }
  cd "${INSTALL_DIR}"
  PID="$(systemctl show -p MainPID --value luqen-dashboard)"
  if [ "${PID:-0}" = 0 ]; then
    echo "the dashboard is not running: no scan to wait for"
  else
    if ! CMDLINE="$(tr '\0' '\n' 2>/dev/null < "/proc/${PID}/cmdline")" \
       || ! DB="$(tr '\0' '\n' 2>/dev/null < "/proc/${PID}/environ" | sed -n 's/^DASHBOARD_DB_PATH=//p')"; then
      echo "the dashboard process ${PID} exited while this block read it (restarting in a loop? see step 6): no restart done, run this block again"; exit 1
    fi
    grep -qxF -- "${INSTALL_DIR}/dashboard.config.json" <<< "${CMDLINE}" \
      || { echo "the dashboard was not started with the two arguments --config ${INSTALL_DIR}/dashboard.config.json (a --config=<path> form, another path or a wrapper script is not recognised): this recipe cannot tell which database it uses"; exit 1; }
    DB="${DB%%$'\n'*}"
    if [ -n "${DB}" ]; then
      LUQEN_DASHBOARD_DB="${DB}" DRAIN_TIMEOUT_SEC=1800 DRAIN_POLL_SEC=15 node scripts/deploy-drain.mjs
    else
      env -u LUQEN_DASHBOARD_DB DRAIN_TIMEOUT_SEC=1800 DRAIN_POLL_SEC=15 node scripts/deploy-drain.mjs
    fi
  fi
  systemctl restart luqen-dashboard
)
```

**Step 5. Verify.** The dashboard answers on its health endpoint (port 5000 is the default; use yours if you changed
it), and the comparison script reports whether the running value is the one the installer would write. It prints names,
paths, counts and sha256 only, never a value.

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  [ -n "${INSTALL_DIR}" ] || { echo "no luqen-dashboard unit on this host"; exit 3; }
  timeout 90 bash -c 'until curl -fsS -o /dev/null http://127.0.0.1:5000/health 2>/dev/null; do sleep 2; done'
  systemctl is-active luqen-dashboard
  bash "${INSTALL_DIR}/scripts/compare-trusted-proxies.sh"
)
```

Expect `active`, then among the lines: `validator=accepted`, `running_equals_installer_value=yes`,
`configured_in=/etc/systemd/system/luqen-dashboard.service.d/trusted-proxies.conf`, `location_differs=yes` (the setting
lives in the drop-in, where the installer would have written it into the main unit), `need_daemon_reload=no`, and a
last line `result=compared`. Exit status 124 means the health endpoint did not answer within 90 seconds: go to step 6.

These lines confirm the FORM and the LOCATION of the running list: the dashboard accepts it, it is in the form the
installer writes, and it comes from the drop-in. They do not confirm that it is the list you meant: the comparison
never sees `LIST`. The check of intent is the Audit Log: sign in from a browser behind your proxies and open
`/admin/audit-log?action=login.success`; the newest entry must show your own address, not a proxy's.

Two other outcomes that are expected:

- The main unit sets a list as well (an install made with `--trusted-proxies`). The drop-in's line applies, and the
  comparison names both files: `configured_in=/etc/systemd/system/luqen-dashboard.service,/etc/systemd/system/luqen-dashboard.service.d/trusted-proxies.conf`,
  `location_differs=no`, `set_in_more_than_one_place=yes`, a line
  `file=/etc/systemd/system/luqen-dashboard.service file_line_equals_installer_line=no` (the main unit's earlier list)
  and a line `file=/etc/systemd/system/luqen-dashboard.service.d/trusted-proxies.conf file_line_equals_installer_line=yes`.
- An environment file of the unit sets the list (step 2 refuses that; it happens when the file gained the line
  afterwards). The file's value applies, not the drop-in's. The comparison prints `envfile=<path> trusted_proxies_lines=1`,
  `set_in_more_than_one_place=yes` and, when the two lists differ,
  `file=/etc/systemd/system/luqen-dashboard.service.d/trusted-proxies.conf file_line_equals_installer_line=no`. Roll the
  drop-in back (step 7), then change the list in that file as
  [When an environment file sets the list](#when-an-environment-file-sets-the-list) says.

Once it is verified, the change is done. Step 8 is optional.

**Step 6. If the dashboard does not come up, find out why.** The unit restarts the dashboard every 5 seconds
(`Restart=always`), so `systemctl is-active` can print `active` for a moment between two failed starts; read the restart
count instead. The block prints four unit properties and the dashboard's refusal lines from the journal, never the
environment:

```bash
(
  systemctl show -p ActiveState -p SubState -p NRestarts -p ExecMainStatus luqen-dashboard
  L="$(journalctl -u luqen-dashboard --since '15 min ago' --no-pager -o cat | grep -E 'Failed to start server|trustedProxies' | tail -n 5)"
  if [ -n "${L}" ]; then printf '%s\n' "${L}"; else echo "no refusal line in the last 15 minutes of the journal"; fi
)
```

- A line `Failed to start server: Invalid trustedProxies ...`: the dashboard refused the list. Roll back (steps 7 and
  4), correct `LIST` and start again at step 2.
- No refusal line, and `NRestarts` grows between two runs a minute apart: the dashboard fails to start for another
  reason. Roll back (steps 7 and 4), then read the start-up errors over a wider window:
  `journalctl -u luqen-dashboard --since '1 hour ago' --no-pager -o cat | grep -E 'Failed|Error' | tail -n 20`.
- No refusal line, `ActiveState=active`, `SubState=running` and `NRestarts` unchanged: the dashboard is running and
  was slow to answer. Run step 5 again.

**Step 7. Roll back.** The block puts the saved state back (the state before the oldest change that step 8 has not
closed) and reloads systemd; step 4 then waits for running scans and restarts. A saved commit is restored with
`git reset --keep` only while the checkout is still on the commit the pull produced: when it has moved on (an upgrade,
say), or when `reset --keep` refuses to overwrite a local change, the block exits 1 having changed nothing. The drop-in
is restored as it was, or removed when there was none. The build is not touched (a pull does not change it, step 1).

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  [ -n "${INSTALL_DIR}" ] || { echo "no luqen-dashboard unit on this host"; exit 3; }
  D=/etc/systemd/system/luqen-dashboard.service.d
  H="${D}/.trusted-proxies.checkout-head"
  if [ ! -e "${D}/.trusted-proxies.conf.previous" ] && [ ! -e "${D}/.trusted-proxies.conf.absent" ] && [ ! -e "${H}" ]; then
    echo "no saved state in ${D}: nothing to roll back to"; exit 1
  fi
  if [ -f "${H}" ]; then
    NOW="$(git -C "${INSTALL_DIR}" rev-parse HEAD)"
    if [ "${NOW}" = "$(sed -n 2p "${H}")" ]; then
      git -C "${INSTALL_DIR}" reset --keep "$(sed -n 1p "${H}")" \
        || { echo "checkout: git reset --keep refused (a local change): nothing rolled back; the saved commits stay in ${H}"; exit 1; }
    elif [ "${NOW}" != "$(sed -n 1p "${H}")" ]; then
      echo "checkout: HEAD is not the commit the pull produced (it has moved on since): nothing changed; the saved commits stay in ${H}"; exit 1
    fi
    rm -f "${H}"
    echo "checkout: back on the commit saved before the pull"
  fi
  if [ -f "${D}/.trusted-proxies.conf.previous" ]; then
    mv "${D}/.trusted-proxies.conf.previous" "${D}/trusted-proxies.conf"
    rm -f "${D}/.trusted-proxies.conf.absent"
  elif [ -e "${D}/.trusted-proxies.conf.absent" ]; then
    rm -f "${D}/trusted-proxies.conf" "${D}/.trusted-proxies.conf.absent"
  fi
  sync "${D}"
  systemctl daemon-reload
  echo "rolled back the files: now run step 4"
)
```

Then run step 4, and verify the rollback:

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  [ -n "${INSTALL_DIR}" ] || { echo "no luqen-dashboard unit on this host"; exit 3; }
  D=/etc/systemd/system/luqen-dashboard.service.d
  timeout 90 bash -c 'until curl -fsS -o /dev/null http://127.0.0.1:5000/health 2>/dev/null; do sleep 2; done'
  systemctl is-active luqen-dashboard
  if [ -e "${D}/trusted-proxies.conf" ]; then echo "drop_in=present"; else echo "drop_in=absent"; fi
  if [ -e "${D}/.trusted-proxies.conf.previous" ] || [ -e "${D}/.trusted-proxies.conf.absent" ] \
     || [ -e "${D}/.trusted-proxies.checkout-head" ]; then echo "saved_state=left"; else echo "saved_state=none"; fi
  bash "${INSTALL_DIR}/scripts/compare-trusted-proxies.sh"
)
```

Expect `active` and `saved_state=none`, then the state from before the change. When there was no drop-in before:
`drop_in=absent`, and either `running=absent`, `installer_would_write=nothing` and `configured_in=none` (the default
applies, or the `trustedProxies` key's list when step 1 reported the key), or, when the main unit sets a list,
`configured_in=/etc/systemd/system/luqen-dashboard.service`. When there was a drop-in before: `drop_in=present` and a
`configured_in=` line that names `/etc/systemd/system/luqen-dashboard.service.d/trusted-proxies.conf`. The last line is
`result=compared`. Exit status 124 means the dashboard did not answer within 90 seconds: go to step 6.

**Step 8 (optional). Drop the saved state once you are sure.** Keeping it costs nothing while the dashboard runs: systemd
does not read it, and the saved drop-in holds the list only, no secret. What it costs is the next change: while saved
state is there, the next change keeps it instead of saving its own, so step 7 then returns to the state before THIS
change, not before the next one (step 1 reports it). Run this once you will not want to come back here:

```bash
(
  D=/etc/systemd/system/luqen-dashboard.service.d
  rm -f "${D}/.trusted-proxies.conf.previous" "${D}/.trusted-proxies.conf.absent" "${D}/.trusted-proxies.checkout-head"
)
```

**Change or remove the list later.** With the saved state dropped, step 7 has nothing to return to. To change the list,
run steps 1 to 5 again with the new `LIST`. To remove the list, run the block below: it saves the drop-in first (as
step 2 does, only when no saved state is left), removes it and reloads systemd; step 4 then restarts the dashboard.
Step 7 afterwards returns to the saved state: this drop-in when the block saved it, or the older state when step 1 still
reported saved state. What applies after the removal is the main unit's list when it has one (an install made with
`--trusted-proxies`), else the `trustedProxies` key's list when step 1 reported
`dashboard.config.json sets trustedProxies: yes`, else the default.

```bash
(
  set -euo pipefail
  D=/etc/systemd/system/luqen-dashboard.service.d
  [ -f "${D}/trusted-proxies.conf" ] || { echo "no ${D}/trusted-proxies.conf: nothing to remove"; exit 1; }
  if [ ! -e "${D}/.trusted-proxies.conf.previous" ] && [ ! -e "${D}/.trusted-proxies.conf.absent" ]; then
    cp -p "${D}/trusted-proxies.conf" "${D}/.trusted-proxies.conf.saving"
    sync "${D}/.trusted-proxies.conf.saving"
    mv "${D}/.trusted-proxies.conf.saving" "${D}/.trusted-proxies.conf.previous"
  fi
  rm -f "${D}/trusted-proxies.conf"
  sync "${D}"
  systemctl daemon-reload
  echo "removed ${D}/trusted-proxies.conf: now run step 4"
)
```

Then run steps 4 and 5. With no list in the main unit, expect `running=absent`, `installer_would_write=nothing`,
`configured_in=none` and `result=compared`, also when the `trustedProxies` key applies (the comparison reads only the
variable). Step 8 closes this change too.

#### When an environment file sets the list

When step 1 names an environment file, change that one line instead of writing a drop-in. The block checks the list
as step 2 does, copies the file the first time (`<file>.trusted-proxies.bak`, `cp -p`), and rewrites the line in place
with `sed -i` (mode and owner kept). It stops when no file or more than one sets the list, or one sets it twice.

```bash
(
  set -euo pipefail
  INSTALL_DIR="$(systemctl show -p WorkingDirectory --value luqen-dashboard)"
  [ -n "${INSTALL_DIR}" ] || { echo "no luqen-dashboard unit on this host"; exit 3; }
  LIST='loopback,198.51.100.20'   # replace with your proxies
  grep -q -- '--check-trusted-proxies' "${INSTALL_DIR}/install.sh" \
    || { echo "install.sh in ${INSTALL_DIR} predates --check-trusted-proxies: do step 1 first"; exit 1; }
  F=""
  while read -r f; do
    f="${f#-}"
    if [ -n "${f}" ] && [ -f "${f}" ] && grep -q '^[[:space:]]*DASHBOARD_TRUSTED_PROXIES=' "${f}"; then
      [ -z "${F}" ] || { echo "more than one environment file of the unit sets the list: change them by hand"; exit 1; }
      F="${f}"
    fi
  done < <(systemctl show -p EnvironmentFiles --value luqen-dashboard | sed -E 's/ \(ignore_errors=[a-z]+\)[[:space:]]*/\n/g')
  [ -n "${F}" ] || { echo "no environment file of the unit sets the list: use steps 2 to 5"; exit 1; }
  [ "$(grep -c '^[[:space:]]*DASHBOARD_TRUSTED_PROXIES=' "${F}")" = 1 ] \
    || { echo "${F} sets the list on more than one line: change it by hand"; exit 1; }
  OUT="$(bash "${INSTALL_DIR}/install.sh" --trusted-proxies "${LIST}" --check-trusted-proxies --install-dir "${INSTALL_DIR}")"
  VALUE="$(printf '%s\n' "${OUT}" | sed -n 's/^accepted: //p')"
  [ -n "${VALUE}" ] || { echo "blank list: nothing to write"; exit 1; }
  [ -e "${F}.trusted-proxies.bak" ] || cp -p "${F}" "${F}.trusted-proxies.bak"
  sed -i "s|^[[:space:]]*DASHBOARD_TRUSTED_PROXIES=.*|DASHBOARD_TRUSTED_PROXIES=${VALUE}|" "${F}"
  sync "${F}"
  echo "changed the DASHBOARD_TRUSTED_PROXIES line of ${F}"
)
```

Then run steps 4 and 5: systemd reads an environment file at every start, so a restart is enough and no
`daemon-reload` is needed. Expect `envfile=<file> trusted_proxies_lines=1`, `running_equals_installer_value=yes`,
`configured_in=<file>`, `location_differs=yes` and `result=compared`. To undo, run the block again with the earlier list
(`grep '^[[:space:]]*DASHBOARD_TRUSTED_PROXIES=' <file>.trusted-proxies.bak` prints that one line), then steps 4 and 5.
Do not copy the backup back over a file that has changed since: it holds every line, and every secret, as it was.
Delete it once step 5 verifies.

### Existing install (Docker)

The list lives in `.env`, next to `docker-compose.yml` in the install directory (the installer's closing summary prints
`cd <install directory>` under `Docker management`). `cd` there first: every block below works on the current
directory and stops with exit status 3 when `docker-compose.yml` is not in it. The blocks use Compose v2
(`docker compose`).

Nothing in this Docker recipe has been run on a Docker host by the authors of this guide: its shell logic was run
against a stub `docker` command, and its node code against a built dashboard on the host. If the pre-check in step 3
cannot run in your image, the block writes nothing and says why.

A proxy on the Docker host (nginx with `proxy_pass http://127.0.0.1:5000`) is not `loopback` to the dashboard: Docker
forwards the published port into the container, and the connection arrives from the compose network's gateway. List
that address, not `loopback` (the default covers it while the network is in a private range). In the install directory,
`docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' "$(docker compose ps -q dashboard)"`
prints it.

The saved state works as in the systemd recipe, in the install directory: the `DASHBOARD_TRUSTED_PROXIES=` line of
`.env` as it was (`.env.trusted-proxies.previous`, that one line, no secret) or a note that `.env` held none
(`.env.trusted-proxies.absent`), and the checkout's commit before a pull and, on a second line, the commit the pull
produced (`.env.trusted-proxies.checkout-head`). The first state is kept, so step 6 returns to the state before the
OLDEST change that step 7 has not yet closed. Step 6 rewrites only that line of the current `.env`: every other line
keeps its value then, so a secret rotated after the change survives the rollback. git ignores these files (`.env.*` in
`.gitignore`), so a pull or a reset leaves them alone.

**Step 1. Check before you start.** The block prints two verdict lines and changes nothing:

```bash
(
  set -euo pipefail
  [ -f docker-compose.yml ] || { echo "no docker-compose.yml here: cd to the install directory"; exit 3; }
  if grep -v '^[[:space:]]*#' docker-compose.yml | grep -q 'DASHBOARD_TRUSTED_PROXIES='; then
    echo "compose: passes DASHBOARD_TRUSTED_PROXIES"
  else
    echo "compose: too old"
  fi
  SAVED=""
  for f in .env.trusted-proxies.previous .env.trusted-proxies.absent .env.trusted-proxies.checkout-head; do
    if [ -e "${f}" ]; then SAVED="${SAVED:+${SAVED} }${f}"; fi
  done
  echo "saved state: ${SAVED:-none}"
)
```

- `saved state:` names one or more files: an earlier change was never closed with step 7. If the dashboard runs as you
  want it now, run step 7 first. If you want the state from before that earlier change back, run steps 6 and 4 first.
  If you go on without either, step 6 later returns to the state before the EARLIER change.
- `compose: too old`: `docker-compose.yml` does not pass the variable to the dashboard. Do step 2.
- `compose: passes DASHBOARD_TRUSTED_PROXIES` and `saved state: none`: go on to step 3.

**Step 2. Only when step 1 says `compose: too old`: update the checkout.** The block saves the commit the checkout is on
(the first time only), pulls with the command the installer uses, saves the commit the pull produced (every time), and
lists what changed in `docker-compose.yml`:

```bash
(
  set -euo pipefail
  [ -f docker-compose.yml ] || { echo "no docker-compose.yml here: cd to the install directory"; exit 3; }
  H=.env.trusted-proxies.checkout-head
  if [ ! -e "${H}" ]; then
    git rev-parse HEAD > "${H}.saving"
    sync "${H}.saving"
    mv "${H}.saving" "${H}"
  fi
  git pull --ff-only
  { head -n 1 "${H}"; git rev-parse HEAD; } > "${H}.saving"
  sync "${H}.saving"
  mv "${H}.saving" "${H}"
  git diff --stat "$(head -n 1 "${H}")" -- docker-compose.yml
)
```

Read the change in full with `git diff "$(head -n 1 .env.trusted-proxies.checkout-head)" -- docker-compose.yml` (the
file holds `${...}` references, not secret values), because step 4 recreates the dashboard container from the new file.
The pull does not rebuild the image. If the pull refuses (local changes, or no fast-forward), resolve that first. Then
run step 1 again.

**Step 3. Check the list and write `.env`.** The block checks the list with the dashboard's own rules inside the
dashboard image. `docker compose run --rm --no-deps --entrypoint node` starts no other service and runs node on the
check only, never the server (the server is the `command:` in `docker-compose.yml`, which the run replaces), and
`timeout 120` stops a check that hangs. Before its first write the block saves the `DASHBOARD_TRUSTED_PROXIES=` line of
`.env` (or notes there was none). It rewrites only that line, keeps the mode and owner of `.env`, and works without one.

```bash
(
  set -euo pipefail
  LIST='198.51.100.20'   # replace with your proxies; a proxy on this host: the network's gateway, not loopback
  [ -f docker-compose.yml ] || { echo "no docker-compose.yml here: cd to the install directory"; exit 3; }
  grep -v '^[[:space:]]*#' docker-compose.yml | grep -q 'DASHBOARD_TRUSTED_PROXIES=' \
    || { echo "docker-compose.yml does not pass DASHBOARD_TRUSTED_PROXIES: do step 2 first"; exit 1; }
  rc=0
  OUT="$(timeout 120 docker compose run --rm --no-deps -T --entrypoint node -e DASHBOARD_TRUSTED_PROXIES="${LIST}" dashboard \
    --input-type=module -e '
      const dist = "/app/packages/dashboard/dist";
      let loadConfig, resolveTrustedProxies;
      try {
        ({ loadConfig } = await import(`${dist}/config.js`));
        ({ resolveTrustedProxies } = await import(`${dist}/auth/trusted-proxies.js`));
      } catch (err) { console.error(`the check is not in this image: ${err.message}`); process.exit(3); }
      try {
        const cfg = loadConfig("/dev/null/no-config.json");
        if (cfg.trustedProxies === undefined) { console.log("blank"); process.exit(0); }
        const r = resolveTrustedProxies(cfg.trustedProxies);
        console.log(`accepted: ${r === false ? "none" : r.join(",")}`);
      } catch (err) { console.error(err.message); process.exit(2); }
    ')" || rc=$?
  case "${rc}" in
    0) VALUE="$(printf '%s\n' "${OUT}" | sed -n 's/^accepted: //p')"
       [ -n "${VALUE}" ] || { echo "blank list: nothing to write"; exit 1; } ;;
    2) echo "the dashboard refuses this list (its message is above): nothing written"; exit 2 ;;
    3) echo "the image's dashboard predates the setting and would ignore the list: nothing written; upgrade the image first"; exit 1 ;;
    *) echo "the check could not run in the dashboard image (exit ${rc}; 124: no answer within 120 seconds): nothing written"; exit 1 ;;
  esac
  if [ ! -e .env.trusted-proxies.previous ] && [ ! -e .env.trusted-proxies.absent ]; then
    if [ -f .env ] && grep -q '^DASHBOARD_TRUSTED_PROXIES=' .env; then
      grep '^DASHBOARD_TRUSTED_PROXIES=' .env | tail -n 1 > .env.trusted-proxies.saving
      sync .env.trusted-proxies.saving
      mv .env.trusted-proxies.saving .env.trusted-proxies.previous
    else
      : > .env.trusted-proxies.absent
    fi
  fi
  T="$(mktemp .env.XXXXXX)"
  trap 'rm -f "${T}"' EXIT
  if [ -f .env ]; then chmod --reference=.env "${T}"; chown --reference=.env "${T}"; else chmod 600 "${T}"; fi
  { if [ -f .env ]; then grep -v '^DASHBOARD_TRUSTED_PROXIES=' .env || true; fi
    printf 'DASHBOARD_TRUSTED_PROXIES=%s\n' "${VALUE}"; } > "${T}"
  sync "${T}"
  mv "${T}" .env
  sync .
  echo "wrote DASHBOARD_TRUSTED_PROXIES into .env"
)
```

What the pre-check's node code returns, measured against a built dashboard:

| Exit status | Printed | When |
|-------------|---------|------|
| 0 | `accepted: <list>`, in canonical form (`accepted: none` for `none`) | the dashboard accepts the list |
| 0 | `blank` | the list is empty or only whitespace (the block then writes nothing and exits 1) |
| 2 | the dashboard's message, on stderr | the dashboard refuses the list, or its configuration loader fails (nothing is written either way) |
| 3 | `the check is not in this image: ...`, on stderr | the image's dashboard predates the setting (an import fails) |

Any other status (1 when `docker compose run` itself fails, 124 when `timeout` stopped it) means the check could not
run, and the block writes nothing. When the image's dashboard predates the setting, a list would have no effect until
the image is rebuilt (an upgrade, outside this recipe), so the block writes nothing then either. A run container that
`timeout` left behind runs only the check, never the server; this lists it:
`docker ps -a --filter label=com.docker.compose.oneoff=True`.

**Step 4. Wait for running scans, then recreate the dashboard container.** Recreating it fails every queued or running
scan. The drain script is not in the image, so the block copies it into the running container and runs it there
against the database `docker-compose.yml` gives the dashboard (`DASHBOARD_DB_PATH=/app/data/dashboard.db`; the block
stops when the file names another path). The copy disappears with the container. On exit 3 (scans still active after
`DRAIN_TIMEOUT_SEC`) or any other failure the block stops before the recreate. `up -d` reads `.env` and your shell's
environment again for every `${...}` in `docker-compose.yml`, and a variable exported in your shell wins over the same
name in `.env`. So run it from the same environment the stack was started from, with no `DASHBOARD_TRUSTED_PROXIES`
exported (step 5 reports `running_equals_env_file=no` if one was).

```bash
(
  set -euo pipefail
  [ -f docker-compose.yml ] || { echo "no docker-compose.yml here: cd to the install directory"; exit 3; }
  grep -v '^[[:space:]]*#' docker-compose.yml | grep -q 'DASHBOARD_DB_PATH=/app/data/dashboard.db' \
    || { echo "docker-compose.yml gives the dashboard another database path: adapt LUQEN_DASHBOARD_DB below"; exit 1; }
  if [ -n "$(docker compose ps -q --status running dashboard)" ]; then
    docker compose cp scripts/deploy-drain.mjs dashboard:/app/packages/dashboard/deploy-drain.mjs
    docker compose exec -T -e LUQEN_DASHBOARD_DB=/app/data/dashboard.db -e DRAIN_TIMEOUT_SEC=1800 -e DRAIN_POLL_SEC=15 \
      dashboard node /app/packages/dashboard/deploy-drain.mjs
  fi
  docker compose up -d dashboard
)
```

**Step 5. Verify.** The block waits for the dashboard's published port (from `DASHBOARD_PORT` in `.env`, default 5000),
then prints two verdict words: whether the image's dashboard reads the setting, and whether the container's value equals
the line in `.env`. It prints no value.

```bash
(
  set -euo pipefail
  [ -f docker-compose.yml ] || { echo "no docker-compose.yml here: cd to the install directory"; exit 3; }
  PORT=""
  if [ -f .env ]; then PORT="$(sed -n 's/^DASHBOARD_PORT=//p' .env | tail -n 1)"; fi
  export PORT="${PORT:-5000}"
  timeout 120 bash -c 'until curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/health" 2>/dev/null; do sleep 2; done'
  if docker compose exec -T dashboard test -f /app/packages/dashboard/dist/auth/trusted-proxies.js; then
    echo "image_reads_list=yes"
  else
    echo "image_reads_list=no"
  fi
  RUNNING="$(docker compose exec -T dashboard printenv DASHBOARD_TRUSTED_PROXIES || true)"
  WRITTEN=""
  if [ -f .env ]; then WRITTEN="$(sed -n 's/^DASHBOARD_TRUSTED_PROXIES=//p' .env | tail -n 1)"; fi
  if [ "${RUNNING}" = "${WRITTEN}" ]; then echo "running_equals_env_file=yes"; else echo "running_equals_env_file=no"; fi
)
```

Expect `image_reads_list=yes` and `running_equals_env_file=yes`. Like the systemd comparison, these confirm form and
location (the container runs with the line in `.env`), not that it is the list you meant: check intent with the Audit
Log as in [Fresh install](#fresh-install). Exit status 124 means the dashboard did not answer within 120 seconds: read
its refusal lines with `docker compose logs --tail 50 dashboard | grep -E 'Failed to start server|trustedProxies'`, then
roll back (steps 6 and 4).

`image_reads_list=no`: the image's dashboard predates the setting, so the line in `.env` has no effect and the
dashboard runs with its default. Do not leave a setting in place that does nothing: roll back (steps 6 and 4), upgrade
the image (rebuild it from an updated checkout, outside this recipe), and start again at step 1.

**Step 6. Roll back.** The block puts the saved state back; step 4 then waits for running scans and recreates the
container. A saved commit is restored with `git reset --keep` only while the checkout is still on the commit the pull
in step 2 produced: when it has moved on (an upgrade, say), when `reset --keep` refuses to overwrite a local change, or
when there is no `.env` to put a saved line back into, the block exits 1 having changed nothing. It then sets the
`DASHBOARD_TRUSTED_PROXIES=` line of the current `.env` to the saved one, or drops it when `.env` held none.

```bash
(
  set -euo pipefail
  [ -f docker-compose.yml ] || { echo "no docker-compose.yml here: cd to the install directory"; exit 3; }
  P=.env.trusted-proxies.previous; A=.env.trusted-proxies.absent; H=.env.trusted-proxies.checkout-head
  if [ ! -e "${P}" ] && [ ! -e "${A}" ] && [ ! -e "${H}" ]; then
    echo "no saved state here: nothing to roll back to"; exit 1
  fi
  if [ -e "${P}" ]; then
    { [ "$(grep -c '' "${P}")" = 1 ] && grep -q '^DASHBOARD_TRUSTED_PROXIES=' "${P}"; } \
      || { echo "${P} is not one DASHBOARD_TRUSTED_PROXIES= line (not saved by this recipe): nothing changed"; exit 1; }
    [ -f .env ] || { echo "no .env here to put the saved line back into: nothing changed"; exit 1; }
  fi
  if [ -f "${H}" ]; then
    NOW="$(git rev-parse HEAD)"
    if [ "${NOW}" = "$(sed -n 2p "${H}")" ]; then
      git reset --keep "$(sed -n 1p "${H}")" \
        || { echo "git reset --keep refused (a local change): nothing rolled back; the saved commits stay in ${H}"; exit 1; }
    elif [ "${NOW}" != "$(sed -n 1p "${H}")" ]; then
      echo "checkout: HEAD is not the commit the pull produced (it has moved on since): nothing changed; the saved commits stay in ${H}"; exit 1
    fi
    rm -f "${H}"
    echo "checkout: back on the commit saved before the pull"
  fi
  if [ -f .env ] && { [ -e "${P}" ] || [ -e "${A}" ]; }; then
    T="$(mktemp .env.XXXXXX)"
    trap 'rm -f "${T}"' EXIT
    chmod --reference=.env "${T}"; chown --reference=.env "${T}"
    { grep -v '^DASHBOARD_TRUSTED_PROXIES=' .env || true; if [ -e "${P}" ]; then cat "${P}"; fi; } > "${T}"
    sync "${T}"
    mv "${T}" .env
  fi
  rm -f "${P}" "${A}"
  sync .
  echo "rolled back the files: now run step 4"
)
```

Then run step 4, and verify the rollback:

```bash
(
  set -euo pipefail
  [ -f docker-compose.yml ] || { echo "no docker-compose.yml here: cd to the install directory"; exit 3; }
  PORT=""
  if [ -f .env ]; then PORT="$(sed -n 's/^DASHBOARD_PORT=//p' .env | tail -n 1)"; fi
  export PORT="${PORT:-5000}"
  timeout 120 bash -c 'until curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/health" 2>/dev/null; do sleep 2; done'
  if [ -e .env.trusted-proxies.previous ] || [ -e .env.trusted-proxies.absent ] \
     || [ -e .env.trusted-proxies.checkout-head ]; then echo "saved_state=left"; else echo "saved_state=none"; fi
  if grep -q '^DASHBOARD_TRUSTED_PROXIES=' .env 2>/dev/null; then echo "env_file_sets_list=yes"; else echo "env_file_sets_list=no"; fi
  RUNNING="$(docker compose exec -T dashboard printenv DASHBOARD_TRUSTED_PROXIES || true)"
  WRITTEN=""
  if [ -f .env ]; then WRITTEN="$(sed -n 's/^DASHBOARD_TRUSTED_PROXIES=//p' .env | tail -n 1)"; fi
  if [ "${RUNNING}" = "${WRITTEN}" ]; then echo "running_equals_env_file=yes"; else echo "running_equals_env_file=no"; fi
)
```

Expect `saved_state=none` and `running_equals_env_file=yes`, with `env_file_sets_list=no` when `.env` held no list
before the change and `env_file_sets_list=yes` when it held one. Exit status 124 means the dashboard did not answer
within 120 seconds: read its logs as in step 5.

**Step 7 (optional). Drop the saved state once you are sure.** It holds the old list line and commits only, no secret.
While it is there, the next change keeps it instead of saving its own, so step 6 then returns to the state before THIS
change (step 1 reports it).

```bash
(
  [ -f docker-compose.yml ] || { echo "no docker-compose.yml here: cd to the install directory"; exit 3; }
  rm -f .env.trusted-proxies.previous .env.trusted-proxies.absent .env.trusted-proxies.checkout-head
)
```

**Change or remove the list later.** With the saved state dropped, step 6 has nothing to return to. To change the list,
run steps 1 to 5 again with the new `LIST`. To go back to the default, run the block below: it saves the list line
first (as step 3 does, only when no saved state is left) and removes the `DASHBOARD_TRUSTED_PROXIES=` line from `.env`
(mode and owner kept); step 4 then recreates the dashboard container. Step 6 afterwards returns to the saved state: this
line when the block saved it, or the older state when step 1 still reported saved state. The image holds no
`dashboard.config.json` and `docker-compose.yml` mounts none, so no `trustedProxies` key applies; if you mount a config
file that sets one, its list applies instead of the default.

```bash
(
  set -euo pipefail
  [ -f docker-compose.yml ] || { echo "no docker-compose.yml here: cd to the install directory"; exit 3; }
  grep -q '^DASHBOARD_TRUSTED_PROXIES=' .env 2>/dev/null || { echo "no DASHBOARD_TRUSTED_PROXIES line in .env: nothing to remove"; exit 1; }
  if [ ! -e .env.trusted-proxies.previous ] && [ ! -e .env.trusted-proxies.absent ]; then
    grep '^DASHBOARD_TRUSTED_PROXIES=' .env | tail -n 1 > .env.trusted-proxies.saving
    sync .env.trusted-proxies.saving
    mv .env.trusted-proxies.saving .env.trusted-proxies.previous
  fi
  T="$(mktemp .env.XXXXXX)"
  trap 'rm -f "${T}"' EXIT
  chmod --reference=.env "${T}"; chown --reference=.env "${T}"
  { grep -v '^DASHBOARD_TRUSTED_PROXIES=' .env || true; } > "${T}"
  sync "${T}"
  mv "${T}" .env
  sync .
  echo "removed DASHBOARD_TRUSTED_PROXIES from .env: now run step 4"
)
```

Then run steps 4 and 5. Expect `running_equals_env_file=yes`: `docker-compose.yml` passes an empty value when `.env`
has no line, and the dashboard reads an empty value as unset, so its default applies. Step 7 closes this change too.

### What the dashboard refuses

The dashboard refuses, at start, a list that trusts every address or whose public ranges together are too wide, a hop
count, and a malformed entry. The rules and the counting are stated once, in the Client address row of
[Session security](../guides/security-administration.md#session-security).

`*` is one of the lists that trusts every address. Give it quoted (`--trusted-proxies '*'`) and the dashboard's rules
refuse it by name: `--check-trusted-proxies` exits 2 with `Invalid trustedProxies entry "*": it would trust every
forwarded address. ...` on stderr, and a full systemd install stops with exit 1 before it writes anything. Unquoted,
the shell replaces `*` with the file names in the current directory before the installer sees it: with one file, the
installer checks that file name and refuses it as not an address; with two or more, it reports `Unknown option` for the
second name, prints its help and exits 0 without installing anything. So an exit status of 0 does not prove that
anything was installed: `install.sh` exits 0 on every unknown option (a known installer defect, not fixed in this
release). Automation that runs the installer must check the result afterwards: `systemctl show -p LoadState --value
luqen-dashboard` prints `loaded` once the unit exists and `not-found` before (Docker: `docker compose ps -q dashboard`,
in the install directory, prints a container id). A Docker install writes a quoted `*` into `.env`
and the dashboard container refuses it at start (see [What the installer does with it](#what-the-installer-does-with-it)).

### The accepted residual

A host inside a trusted range can choose the forwarded address the dashboard records, which feeds the sign-in limit,
the other per-address limits and the audit trail. With the default list that is any host on a loopback, link-local or
private network that can reach the dashboard's port directly, not only your proxies. This is accepted for the default,
which works without configuration for a proxy on the same host or on a private network. To close it, list your
proxies' own addresses rather than whole networks that other clients share (`loopback` alone when the only proxy is on
the dashboard host), or let only your proxy reach the dashboard's port.

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
