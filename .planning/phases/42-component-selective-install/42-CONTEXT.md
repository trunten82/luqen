# Phase 42 — Installer Wizard Redesign — Context

## Why this phase

The v3.1.0 / Phase 40 installer audit + Plan 40-07 fresh-container dry-run
on a stock Ubuntu 22.04 LXC surfaced that the three installers
(`install.sh`, `install.command`, `install.ps1`) are wired for the
**v2-era codebase**, not the actual v3.1.0 monorepo. Phase 40 closed
the env-var, migration, and systemd-unit gaps but kept the existing
wizard structure. Phase 42 is the wizard redesign.

## Codebase reality (audit, 2026-04-25)

| Package | Type | Standalone? | Installer awareness today |
|---|---|---|---|
| `@luqen/core` (v2.11.0) | CLI lib | Yes | ✓ "Developer tools" path on `install.sh` |
| `@luqen/compliance` (v2.11.0) | Standalone Fastify (port 4000) | Yes | ✓ Full + optional CLI add-on |
| `@luqen/branding` (v2.7.0) | Standalone Fastify (port 4100) | Yes | ✓ Full + optional CLI add-on; **never named in `install.ps1`** |
| `@luqen/llm` (v2.11.0) | Standalone Fastify (port 4200) | Yes | ✗ silently bundled into "Full platform"; never a discrete pick |
| `@luqen/dashboard` (v2.11.0) | Standalone Fastify + UI + embedded MCP plugin (port 5000) | Yes (degrades gracefully without compliance/branding/llm) | ✓ |
| `@luqen/monitor` (v2.4.1) | Background agent | Yes (writes regs into compliance DB) | ✗ **never registered by any installer** |

**MCP** is embedded as a Fastify plugin inside the dashboard service
(per CLAUDE.md decision: "MCP embedded as Fastify plugin per service,
never standalone port"). Picking the v2-era "Developer tools" wizard
path advertises CLI + MCP server but the MCP server lives in the
dashboard, so the offering is muddy.

## What v2-era wizard misses

1. LLM service is silently bundled into "Full platform" — never a
   discrete pick, never named.
2. Branding service is exposed as a yes/no add-on under "Developer
   tools", but `install.ps1` doesn't know about it at all.
3. Monitor agent (`@luqen/monitor`) — never offered, never registered
   on any platform.
4. "Developer tools (CLI + MCP server)" implies a standalone MCP
   binary that doesn't exist; MCP is part of the dashboard daemon.
5. `install.ps1` only has a 2-way menu (bare-metal vs Docker), no
   component selection at all.
6. No "compliance API only" or "llm gateway only" deployment, even
   though the architecture supports them.

## Proposed wizard redesign

**Step 1 — deployment profile** (replaces existing 3-way / 2-way menus):

| Profile | Installs | Registers |
|---|---|---|
| 1. **Scanner CLI** | `@luqen/core` only | nothing — pure CLI lib |
| 2. **API services (headless)** | one or more of compliance/branding/llm | matching systemd / launchd / NSSM unit per chosen service |
| 3. **Self-hosted dashboard** (default) | dashboard + chosen subset of {compliance,branding,llm} | one unit per installed component |
| 4. **Docker Compose** | profile 3 in containers + pa11y + mongo + redis | docker-compose stack |

**Step 2 — add-ons** (only meaningful for profiles 3 / 4):

- ☐ Monitor agent (`@luqen/monitor`) — auto-tracks regulation changes
- ☐ Notification plugins (Slack / Teams / Email — already wired up)
- LLM provider config (OpenAI key / Ollama URL) — only if `llm` is selected

**Step 3 — graceful-degradation note** when dashboard is selected
without one of compliance/branding/llm:

> Compliance service was not selected. The dashboard will run, but
> "Run scan" will fall back to local-only mode and the regulation
> matrix will not be auto-updated. You can install compliance later
> by re-running the installer.

## Non-interactive flags (additive — defaults preserved)

```
--profile cli|api|dashboard|docker   Default: dashboard
--api-services compliance,branding,llm
                                      Comma-separated; only honoured
                                      when --profile api. Default: all.
--with-monitor                        Register monitor agent. Default: off.
--without-compliance / --without-branding / --without-llm
                                      Skip a backing service when
                                      --profile dashboard. Default: install all.
```

`--non-interactive` continues to install the dashboard profile with
all 4 backing services (current contract). Operator only reaches for
the new flags when they want a non-default subset.

## Service-level invariants

- **Compliance + Monitor:** Monitor writes into compliance.db.
  Selecting `--with-monitor` without compliance is an error in the
  parser; the wizard offers monitor only after compliance is chosen.
- **Dashboard + LLM:** Dashboard's "Agent companion" surface needs a
  reachable LLM endpoint. If LLM is disabled the wizard warns but
  doesn't block (graceful-degradation: agent panel hidden behind a
  feature flag).
- **Dashboard + Compliance:** Without compliance, "Compliance scan"
  routes 404. Dashboard runs but with a top banner pointing to docs
  on how to install compliance later.
- **Branding:** Optional everywhere. Without it, brand-related
  classification falls back to "unknown".

## Plugin axis (orthogonal to services)

Plugins are managed by the dashboard's `PluginManager` and installed
post-service-startup via `POST /api/v1/plugins/install` (with API key).
They are **not** installed as system units. The installer today
already drives plugin installs for these categories:

| Category | Plugins (catalogue) | Installer flag | Profile dependency |
|---|---|---|---|
| **Auth/SSO** | `@luqen/plugin-auth-entra`, `@luqen/plugin-auth-okta`, `@luqen/plugin-auth-google` | `--auth entra\|okta\|google` + `--auth-*` creds | requires dashboard |
| **Notifications** | `@luqen/plugin-notify-slack`, `@luqen/plugin-notify-teams`, `@luqen/plugin-notify-email` | `--with-notify-slack`, `--with-notify-teams`, `--with-notify-email` | requires dashboard |
| **Storage** | `@luqen/plugin-storage-postgres`, `@luqen/plugin-storage-mongodb` | `--db postgres\|mongodb` + `--db-url` | requires dashboard |
| **Git host** | `@luqen/plugin-git-host-github`, `…-gitlab`, `…-azure-devops` | (none — manual install today) | requires dashboard |
| **Custom catalogue** | 11 plugins per `project_plugin_catalogue.md` | (manual via dashboard UI) | requires dashboard |

**Architectural invariants (per `feedback_plugin_methodology.md`):**

- All integrations must go through `PluginManager` lifecycle —
  never hardcoded adapters.
- Plugin manifests are tarballs from a remote GitHub catalogue with
  checksums; installer uses the dashboard's REST endpoint, not direct
  npm installs.
- `pluginsDir` in `dashboard.config.json` points to `${INSTALL_DIR}/plugins`.

**Implications for Phase 42:**

1. **Profiles 1 + 2 (CLI / API-only) cannot install plugins** — there's
   no dashboard `/api/v1/plugins/install` endpoint to call. The wizard
   suppresses the plugin section in those profiles.
2. **Profile 3 + 4 (dashboard / docker)** keep the existing plugin
   prompts: auth, notifications, storage. Plus a new opt-in for
   "Git host plugins" (currently never offered by the wizard despite
   the plugins existing in `packages/`).
3. **Plugin-only invocation** — operators sometimes want to add a
   plugin to an existing install without re-running the full
   wizard. Out of scope for Phase 42 (the dashboard UI already
   handles this); installer doesn't need a `--add-plugin` flag.
4. **Dependency check** — wizard rejects `--auth entra` /
   `--with-notify-slack` etc. when `--profile cli|api` because there's
   no dashboard to host them.
5. **Storage plugin is a special case** — it's selected via `--db`
   not `--with-X`. The wizard already routes `postgres`/`mongodb`
   through `install_plugin` post-install. Phase 42 leaves this flow
   unchanged.

## Plan breakdown (estimated)

1. **42-01** — `install.sh` redesign: introduce `INSTALL_COMPONENTS`
   array, 4-profile wizard, new non-interactive flags
   (`--profile`, `--api-services`, `--with-monitor`, `--without-X`),
   per-component build/clone/systemd-register dispatch. Plugin
   prompts gated by profile. Keep all existing flags.
2. **42-02** — `install.command` mirror: launchd block iterates
   `INSTALL_COMPONENTS`. `install.ps1` rewrite: replace 2-way menu
   with 4-profile menu, NSSM/Task Scheduler registration loop over
   components, plugin prompts gated by profile.
3. **42-03** — `@luqen/monitor` registration in all three: systemd
   `luqen-monitor.service`, launchd `io.luqen.monitor.plist`, NSSM
   `LuqenMonitor`. Add `Git host plugins` opt-in across all 3
   wizards (currently missing). Update `installer-changelog.md`,
   `installer-env-vars.md`, `installation.md`, plugin docs.

## Out of scope

- Component-selective uninstall is **already** mostly correct in
  Phase 40's uninstall flow — it iterates the 4 known unit names
  and stops/removes whichever exist. Phase 42 only needs to add
  the monitor unit name to that loop.
- Migrating the dashboard to gracefully degrade when *_PUBLIC_URL is
  unset (rather than just unreachable) — that's runtime work, not
  installer. Track separately if/when an operator hits it.

## Decisions locked at scope time

- D-01: Non-interactive default stays "install all 4 services + no
  monitor" — preserves the v3.1.0 invariant that
  `bash install.sh --non-interactive --admin-user X --admin-pass Y`
  produces a working full platform.
- D-02: Profile selection is a hard branch in the wizard (1 of 4),
  not a checkbox — keeps the menu legible.
- D-03: Monitor agent is opt-in only — it polls external sources and
  is noisy; should never auto-install.
- D-04: API-only profile registers each chosen service as a system
  unit (not a "compliance-only embedded in core" mode) — this matches
  how the codebase already works (each service has its own CLI bin).

## References

- Audit performed: 2026-04-25, after Phase 40 / Plan 40-07 dry-run.
- Source of truth for codebase reality:
  `packages/*/package.json`, `install.sh:422-471` wizard, MCP
  decision in CLAUDE.md.
- Related: Phase 40 SUMMARY.md, Plan 40-07 DRYRUN.md.
