[Docs](../README.md) > [Deployment](./) > Installer Changelog

# Installer Changelog

Per-release log of what each Luqen version added to the installer surface
(env vars, migrations, services, admin pages, RBAC permissions). Each
section answers "what does an operator have to know about installing or
upgrading from the previous version?".

Last reviewed for **v3.1.0** (Phase 40 / DOC-03).

---

## v3.1.x — Installer Wizard Redesign (Phase 42)

> Phase 42 reshapes the installer wizard around four explicit deployment
> profiles, registers the `@luqen/monitor` agent as a first-class service,
> bundles `install.ps1` parity fixes, and refreshes `docker-compose.yml`.
> Default `--non-interactive` invocation behaviour is unchanged (D-01
> invariant): a flag-less install still produces the v3.1.0 self-hosted
> dashboard topology with all four backing services.

**Wizard restructure:** the previous 3-way menu (`install.sh`) and 2-way
menu (`install.ps1`) are replaced with **4 profiles**:

| Profile | Description |
|---------|-------------|
| Scanner CLI (`--profile cli`) | `@luqen/core` only. No system services. Use as `luqen scan ...` or stdio MCP via `node packages/core/dist/mcp.js`. |
| API services (`--profile api`) | Headless install of any subset of compliance / branding / llm. Selectable via `--api-services compliance,branding,llm`. |
| Self-hosted dashboard (`--profile dashboard`, default) | Dashboard + chosen subset of {compliance, branding, llm}. Disable any with `--without-compliance` / `--without-branding` / `--without-llm`. |
| Docker Compose (`--profile docker`) | All 5 services in containers via `docker-compose.yml`. Monitor is opt-in via `docker compose --profile monitor up`. |

**New flags** (apply to `install.sh` and `install.ps1`):

| Flag | Purpose |
|------|---------|
| `--profile cli\|api\|dashboard\|docker` | Select deployment profile. Default `dashboard`. |
| `--api-services <csv>` | Comma-separated list for Profile 2 (e.g. `compliance,branding`). |
| `--with-monitor` | Register the monitor agent as a system service. Requires compliance to be installed; selecting `--with-monitor` without compliance is a parser error. |
| `--without-compliance` / `--without-branding` / `--without-llm` | Skip a backing service in Profile 3. |
| `--monitor-port <int>` | Override the default monitor port (4300). |

**Monitor agent registration** (first time the installer ships this):

- Linux — `luqen-monitor.service` systemd unit, registered alongside the
  four existing units when `--with-monitor` is passed.
- macOS — `io.luqen.monitor.plist` launchd agent.
- Windows — `LuqenMonitor` NSSM service or Task Scheduler task,
  matching the rest of the install.ps1 service registration.
- Default port **4300** (configurable via `--monitor-port`). Avoids
  collision with the LLM service on 4200.
- OAuth client minted via
  `packages/compliance/dist/cli.js clients create --name luqen-monitor`.
  Credentials emitted as `MONITOR_CLIENT_ID` / `MONITOR_CLIENT_SECRET`
  in the systemd / launchd / NSSM environment block (or `.env` file
  for Docker installs).
- Default `MONITOR_CHECK_INTERVAL=manual` — the agent does not poll on a
  schedule; operators trigger scans via the dashboard MCP integration or
  the `luqen-monitor scan` CLI.

**install.ps1 parity bug fixes** (bundled with Phase 42):

- Branding service is now named in the wizard prompts (was missing).
- LLM service is now named in the wizard prompts (was missing).
- All 5 OAuth clients (compliance↔llm, dashboard↔compliance,
  dashboard↔branding, dashboard↔llm, dashboard↔monitor) are minted
  end-to-end. Previously only one client was minted on Windows, leaving
  the dashboard unable to authenticate to branding or LLM.
- `dashboard.config.json` now includes `brandingUrl` / `brandingClientId`
  / `brandingClientSecret` and the matching `llmUrl` / `llmClientId` /
  `llmClientSecret` fields. Previously these were missing on Windows so
  the dashboard could only call compliance.

**docker-compose.yml restructure:**

- Adds an `llm` service on port 4200 with its own `llm-data` volume and
  healthcheck. Dashboard now `depends_on: llm: condition: service_healthy`.
- Adds a `monitor` service on port 4300 with `profiles: [monitor]`, so
  it only starts under `docker compose --profile monitor up`. Monitor
  `depends_on: compliance: condition: service_healthy`.
- Adds `llm-data` and `monitor-data` named volumes.
- Per locked scope decision: Profile 4 ships **5 Luqen services + the
  optional monitor only** — no `pa11y`, no `mongo`, no `redis`. The
  pa11y npm library is bundled into compliance via `@luqen/core`;
  Mongo/Redis remain plugin-driven and are out of scope for the
  installer.

**Migration note for existing installs:** re-running the v3.1.x
installer on a v3.1.0 host is idempotent. The four existing systemd
units / launchd plists / NSSM services remain intact. The monitor unit
is only created when `--with-monitor` is supplied, so no surprises for
operators who don't opt in.

---

## v3.1.0 (2026-04-25 — pending release)

> Phase-40 documentation sweep. No behaviour changes shipped beyond
> what was already merged in v3.0.0; this release closes documentation
> and installer-script gaps that accumulated during v2.12.0 → v3.0.0.

**Migrations:** No new migrations. Head remains at **061**
(`agent-active-org`, introduced in v3.0.0).

**Env vars:** None added at v3.1.0. Installers now declare the full
v3.0.0 set explicitly (see "v3.0.0" below).

**Services:** No new daemons. Installers gain parity:
- `install.command` (macOS) now writes 4 launchd plists post-install
  (compliance, branding, llm, dashboard). Previously it only delegated
  to `install.sh`, which itself skipped systemd registration when
  `systemctl` was absent — leaving services unmanaged on macOS.
- `install.ps1` (Windows) now registers all 4 services
  (`LuqenCompliance`, `LuqenBranding`, `LuqenLlm`, `LuqenDashboard`)
  under both NSSM and Task Scheduler paths. Previously only `Compliance`
  and `Dashboard` were registered.

**MCP** continues to run **embedded in the dashboard** as a Fastify
plugin. There is no `LuqenMcp` daemon; do not add one.

**Uninstall:** All three installers gain a parallel `--uninstall`
(`-Uninstall` on PowerShell) flag. Default behaviour stops the four
daemons, removes the platform's service registration (systemd units /
launchd plists / NSSM services / Task Scheduler tasks), and copies
`dashboard.config.json` + `dashboard.db` + `compliance.db` to a
`~/.luqen-uninstall-<timestamp>/` backup before deleting the install
dir. Pass `--purge` (`-Purge`) to skip the backup and drop everything
including `~/.luqen`. `--keep-data` (`-KeepData`) is the explicit form
of the default. Caught and added during the Phase 40 / Plan 40-07
fresh-container dry-run on a stock Ubuntu 22.04 LXC.

**Installer hardening:** Same dry-run surfaced and fixed several
non-interactive defects in `install.sh`:
1. Re-exec block triggered on `[ ! -t 0 ]` and hard-coded
   `< /dev/tty` redirect, breaking `curl|bash --non-interactive`,
   `ssh host 'bash install.sh ...'`, and CI runners. Now uses
   `BASH_SOURCE[0]` to detect actually-piped vs file invocation,
   and skips the `/dev/tty` redirect when `--non-interactive` is
   present or no tty exists.
2. `info`/`success`/`warn`/`error`/`header`/`step` helpers all wrote
   to `/dev/tty` directly. Replaced with an `OUT` selector that
   picks `/dev/tty` if writable, else stdout.
3. Service summary block at end of install missed `luqen-branding`.
4. `install.command` Terminal.app re-exec fired on `curl|bash` when
   `TERM_PROGRAM` was unset; now skipped under `--non-interactive`.
5. `install.command` macOS-specific launchd block ran on Linux too
   (`launchctl: command not found`); now gated by `uname -s = Darwin`.
6. `install.ps1` `Read-YesNo` had a `$hint:` parser error
   (`$var:` is a scoped variable reference); fixed with `${hint}:`.

**Admin pages:** No new pages. Installer summary now prints the
v3.0.0-introduced surface.

**RBAC:** No new permissions.

---

## v3.0.0 (2026-04-24 — MCP Servers & Agent Companion)

**Migrations:** 047 → 061 (15 new migrations). All auto-applied at
service start. Notable:

- 047 `agent-conversations-and-messages`
- 048 `agent-audit-log`
- 049–053 OAuth 2.1 + PKCE + DCR storage (`oauth-clients-v2`,
  `oauth-authorization-codes`, `oauth-refresh-tokens`,
  `oauth-user-consents`, `oauth-signing-keys`)
- 054 `backfill-mcp-use-permission` — back-fills `mcp.use` onto every
  existing role so installs upgrading from v2.12.0 keep working.
- 055 `agent-display-name`
- 056 `agent-conversations-soft-delete`
- 057 `agent-audit-log-rationale`
- 058 `agent-messages-supersede`
- 059 `agent-share-links`
- 060 `agent-share-links-expiry`
- 061 `agent-active-org`

**Env vars (new):**

| Env Var | Purpose |
|---------|---------|
| `DASHBOARD_PUBLIC_URL` | External URL the dashboard advertises (OAuth issuer / MCP discovery). |
| `DASHBOARD_JWKS_URI` / `DASHBOARD_JWKS_URL` | JWKS endpoint for RS256 token verification. |
| `DASHBOARD_JWT_PUBLIC_KEY` | Inline PEM alternative to JWKS. |
| `OAUTH_KEY_MAX_AGE_DAYS` | Signing-key rotation budget, default 90. |
| `COMPLIANCE_PUBLIC_URL` | External URL of the compliance service. |
| `BRANDING_PUBLIC_URL` | External URL of the branding service. |
| `LLM_PUBLIC_URL` | External URL of the LLM service. |
| `OLLAMA_BASE_URL` | Optional Ollama daemon URL for the LLM service. |

**Services:** No daemon shape change — still 4 long-running services
(compliance, branding, llm, dashboard). MCP runs as a Fastify plugin
inside the dashboard at `/api/mcp`.

**Admin pages:**

- `/admin/audit` — agent audit log viewer with filter bar + CSV export.
  Permission: `audit.view` (already existed in v2.12.0).
- `/admin/oauth-keys` — OAuth signing-key inventory + manual rotate.
  Permission: `admin.system`.

**End-user surface:**

- `/agent` — agent companion side panel.
- `/agent/share/:id` — read-only conversation share-link permalinks.
- `/api/mcp` — Streamable HTTP MCP endpoint (Claude Desktop, IDEs).
- `/oauth/.well-known/{openid-configuration,oauth-authorization-server,jwks.json,oauth-protected-resource}` — discovery.
- `/oauth/{authorize,token,register}` — OAuth 2.1 + PKCE + DCR.

**RBAC:** `mcp.use` (new). Gates MCP tool calls. Migration 054
back-fills it onto every existing role so `/api/mcp` works for users
who already had any role at upgrade time.

---

## v2.12.0 (2026-04-14 — Brand Intelligence Polish)

**Migrations:** 040 → 045 added.

**Env vars:** No installer-script-relevant changes.

**Services:** No daemon changes. The installer scripts at v2.12.0
already registered systemd units for compliance, branding, llm, and
dashboard on Linux.

**Admin pages:** Brand-overview at `/brand-overview` (org-scoped, not
under `/admin/`), drilldown modal, rescore controls.

**RBAC:** No new permissions.

---

## Related documentation

- [Installer env vars](./installer-env-vars.md) — full env-var table.
- [Installation guide](../getting-started/installation.md) — end-to-end
  install walkthrough.
- [Phase 40 plan](../../.planning/phases/40-documentation-sweep/40-03-PLAN.md)
  — source of truth for this changelog.
