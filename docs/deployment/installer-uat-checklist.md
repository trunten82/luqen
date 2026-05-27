# Installer UAT checklist

Manual verification steps for the bare-metal + Docker installers across
Linux / macOS / Windows. Carried forward from v3.3.0 Phase 53 (STAB-04 /
STAB-05) — automated CI can syntax-check the scripts but cannot run them
end-to-end on macOS or Windows, so the matrix below is an operator
checklist, not a test suite.

## What's automated

- `bash -n install.sh` — syntax check on every push.
- `python3 tools/lint-compose.py` (in this PR) — static structural lint
  of every `docker-compose*.yml`: catches deprecated `version:` keys,
  missing healthchecks / restart policies, undeclared volume references,
  missing services in `depends_on`.
- CI in `.github/workflows/` runs the dashboard + compliance + llm test
  suites on every push.

## What still needs human UAT

For each row below, run the installer on a clean VM / container, then
exercise the smoke path: open the dashboard, run the self-scan, confirm
the compliance and LLM modules are reachable.

### Linux — bare-metal install.sh

| OS / image | Last verified | Notes |
|---|---|---|
| Debian 12 (bookworm) — clean LXC | 2026-04-01 (Phase 53) | `--non-interactive` + interactive both green |
| Ubuntu 22.04 LTS | 2026-04-01 (Phase 53) | apt-get path |
| Ubuntu 24.04 LTS | _not verified_ | install.sh assumes apt-get; expect no diff vs 22.04 |
| Fedora 40 | _not verified_ | install.sh has no dnf branch — bare-metal path will fail; **document Docker-only** |
| Alpine 3.19 | _not verified_ | musl + no systemd → bare-metal fails; **Docker-only** |

### Linux — Docker compose

| Compose file | Last verified | Notes |
|---|---|---|
| `docker-compose.minimal.yml` (compliance + dashboard) | 2026-05-27 | `docker compose config -q` PASS on Docker Compose 2.26.1 / Debian 13 |
| `docker-compose.standard.yml` (+ mongo + redis + pa11y) | 2026-05-27 | `docker compose config -q` PASS |
| `docker-compose.full.yml` (+ monitor) | 2026-05-27 | `docker compose config -q` PASS + added missing healthcheck on `monitor` service |
| `docker-compose.yml` (root, dev) | 2026-05-27 | `docker compose config -q` PASS after removing deprecated `version: '3.8'` |

### macOS — install.sh in Docker mode

install.sh's bare-metal path is Linux-systemd-only (apt-get, systemctl,
writes /etc/systemd/system/). On macOS the supported path is
`--mode docker`. Pre-reqs: Homebrew, Docker Desktop, curl, bash 3.2+.

Smoke checklist:
- [ ] `curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash -s -- --mode docker`
- [ ] Installer detects Docker via `command -v docker`
- [ ] Compose stack comes up without `version:` warning
- [ ] Self-scan completes on the included docs page
- [ ] Companion chat round-trip with Ollama or OpenAI provider

Known bash 3.2 issues to flag: install.sh uses `[[ ... =~ ... ]]` (line 378)
which works on bash 3.2; no `mapfile`/`readarray`/`${var,,}` patterns spotted.

### Windows — install.ps1

Pre-reqs: PowerShell 7+ (Core), Docker Desktop with WSL2 backend, internet.

Smoke checklist:
- [ ] `iwr -useb https://raw.githubusercontent.com/trunten82/luqen/master/install.ps1 | iex`
- [ ] Installer launches in non-elevated PS Core (no `requires -RunAsAdministrator`)
- [ ] OS-pinned default ports do not collide (5000, 4000, 4100, 4200)
- [ ] Compose stack via Docker Desktop comes up
- [ ] Smtp / Postgres / Mongo `Test-*Connection` helpers behave on Windows
      sockets (port-scan based, not Linux-specific commands)
- [ ] Uninstall via `Invoke-LuqenUninstall` removes the install dir + any
      registered scheduled tasks
- [ ] `Read-Prompt` works under PS Core (not just Windows PowerShell 5.1)

### Carry-forward known gaps

- `dpkg`/`apt-get`/`systemctl` paths in install.sh do not have analogues
  for RPM-based distros — file an enhancement before claiming
  bare-metal support for Fedora/RHEL.
- The compose-lint script (`tools/lint-compose.py`) is invoked manually;
  wire it into the CI workflow alongside the existing `bash -n install.sh`
  step.
- `docker compose config` runtime check still requires native Docker on
  the CI runner. Documented procedure for a one-shot validation on
  lxc-luqen: `apt-get install -y docker.io docker-compose`, run the
  four `docker compose -f … config -q` against `docker-compose.yml`
  + every `deploy/templates/docker-compose.*.yml`, then
  `apt-get remove --purge -y docker.io docker-compose` +
  `apt-get autoremove --purge -y` + `rm -rf /var/lib/docker
  /var/lib/containerd /etc/docker`. Latest run: 2026-05-27 — all four
  PASS.
