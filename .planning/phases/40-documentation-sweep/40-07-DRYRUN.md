# Plan 40-07 — Fresh-Install Dry-Run Transcript

**Status:** RUNTIME COMPLETED — DOC-03 SC #3 PASS for `install.sh` happy path on Linux. 8 defects found, fixed, pushed.

**Test environment:** Proxmox LXC 999 (`luqen-installtest`), Ubuntu 22.04 LTS, unprivileged + nesting=1, 8 GB rootfs, 2 GB RAM. Reachable from lxc-claude at 192.168.3.75 via SSH key auth.

**Reference:** Plan 40-03 produced the static substitute audit; Plan 40-07 is the runtime gate. This document supersedes the worktree-agent's Iteration 1 static-substitute report.

---

## Iteration 1 — `curl|bash --non-interactive` on stock Ubuntu

**Result:** FAIL — exit 1, log:
```
bash: line 22: /dev/tty: No such device or address
```

**Root cause:** install.sh re-exec block did `exec bash "${TMP}" "$@" < /dev/tty` unconditionally, but `ssh host 'curl … | bash'` has no controlling terminal.

**Fix:** commit `6e08746` — guard the redirect with `--non-interactive` arg detection and `[ -e /dev/tty ]`. Output helpers (`info`/`success`/`warn`/`error`/`header`/`step`) switched from hard-coded `>/dev/tty` to `>"$OUT"` where `OUT` selects `/dev/tty` if writable, else `/dev/stdout`.

---

## Iteration 2 — `ssh host 'cd repo && bash install.sh'` (local file)

**Result:** FAIL — exit 0 with empty install log, services inactive.

**Root cause:** the re-exec block triggered on `[ ! -t 0 ]` (non-tty stdin), which is *also* true for `ssh host 'bash install.sh'` even though it's a real file invocation, not a pipe. `cat > $TMPSCRIPT` read 0 bytes from the closed ssh stdin, produced an empty temp script, and `exec bash $EMPTY` silently ran nothing.

**Fix:** commit `94a6274` — replace `[ ! -t 0 ]` with `BASH_SOURCE[0]` test:
- `curl|bash` → `BASH_SOURCE[0]` empty → re-exec needed
- `bash install.sh` → `BASH_SOURCE[0]` is the path → re-exec skipped
- `ssh host 'bash install.sh'` → same as above → re-exec skipped

---

## Iteration 3 — green install.sh proper

**Result:** PASS for the install itself, with one cosmetic glitch: closing summary block listed only 3 of 4 services (omitted `luqen-branding`), even though all 4 were registered, enabled, active, and healthy.

**Fix:** commit `a63be6c` — include `luqen-branding` in the summary's `systemctl status/restart/stop` lines, `journalctl -fu` list, and printed status block.

**Verification (post-iteration-3 + a63be6c):**
- Exit 0
- `systemctl is-active luqen-{compliance,branding,llm,dashboard}` → all `active`
- Health endpoints:
  - compliance `:4000/api/v1/health` → `{"status":"ok","version":"2.11.0"}`
  - branding `:4100/api/v1/health` → `{"status":"ok","version":"2.7.0"}`
  - llm `:4200/api/v1/health` → `{"status":"ok","version":"2.11.0"}`
  - dashboard `:5000/health` → `{"status":"ok","version":"2.11.0"}`
- 4 systemd unit files registered, all `enabled`
- Migration head reached: 061 (`agent-active-org`)

---

## Scenario matrix — final

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| S1 | `curl\|bash --non-interactive` | ✅ PASS | After fixes 6e08746, 94a6274, a63be6c |
| S2 | `ssh host 'cd repo && bash install.sh --non-interactive'` | ✅ PASS | After fix 94a6274 |
| S3 | Idempotent re-run on already-installed | ✅ PASS | Exit 0, services remain active |
| S4 | `--mode docker` | ⚠️ ENV-BLOCKED | docker compose build of `node:20-slim` fails because the test LXC's nested-Docker DNS cannot reach `deb.debian.org` during `apt-get update`. Not a Luqen bug. Installer error reporting fixed in commit `b192f49` so this kind of failure is now loud rather than silent. |
| S5 | `--db postgres` | ⏭️ NOT RUN | Same code path as plugin install validated by S1; needs reachable postgres |
| S6 | `--auth entra` | ⏭️ NOT RUN | Static check via `--help` confirms flag plumbing; live federation needs real Entra tenant |
| S7 | `--with-notify-slack/teams/email` | ⏭️ NOT RUN | Plugin install path same as S1, validated indirectly |
| S8 | `--help` | ✅ PASS | 41 lines, contains all v3.1.0 flags + Uninstall section |
| S9 | Interrupted/partial state recovery | ⏭️ NOT TESTED | Would require simulating Ctrl+C mid-install |
| S10 | `install.command` via `curl\|bash` on Linux | ✅ PASS | After fix `5b4bd01` (gate launchd block by `uname -s = Darwin`) and `f064012` (uninstall) |
| S11 | install via curl-pipe on latest commit | ✅ PASS | All 4 services active |
| S12 | `bash install.sh --uninstall` (keep-data default) | ✅ PASS | Backup created at `~/.luqen-uninstall-<ts>/` with config + DBs; install dir + units removed; services inactive |
| S13 | install + S12 idempotent re-test | ✅ PASS | Same outcome as S11 |
| S14 | `bash install.sh --uninstall --purge` | ✅ PASS | Install dir, backup dir, `~/.luqen`, all units gone |
| S15 | `pwsh ParseFile install.ps1` | ✅ PASS | After fix `4ad69ef` (`${hint}:` parser fix). PSScriptAnalyzer warnings are all `PSAvoidUsingWriteHost` — intentional for installer console output. |
| S16 | Real macOS double-click of install.command | ❌ NOT TESTABLE | No macOS host available. Static review confirms the launchd block is now Darwin-gated, will skip on Linux but execute on macOS. |
| S17 | Real Windows install via install.ps1 | ❌ NOT TESTABLE | No Windows host. Syntax + static analysis green. |

---

## Defects found and fixed during the dry-run

| Commit | Severity | File(s) | Description |
|--------|----------|---------|-------------|
| `6e08746` | BLOCKING | install.sh | `< /dev/tty` redirect + helpers all writing to /dev/tty in non-tty mode |
| `94a6274` | BLOCKING | install.sh | re-exec triggered on `bash install.sh` over ssh, produced empty temp script |
| `a63be6c` | COSMETIC | install.sh | post-install summary missed `luqen-branding` |
| `5b4bd01` | BLOCKING (cross-OS) | install.command | launchd block ran on Linux (`launchctl: command not found`) |
| `4ad69ef` | BLOCKING (Windows) | install.ps1 | `Read-YesNo` `$hint:` PowerShell parser error |
| `f064012` | FEATURE | install.sh + .command + .ps1 + docs | Added `--uninstall` / `--purge` / `--keep-data` across all 3 installers |
| `bc11f61` | TOOLING | scripts/snapshot-openapi.ts | hung CI workflow runs (no explicit `process.exit`) |
| `b192f49` | UX | install.sh | Docker compose build/up failures now propagate with last-20-lines diagnostic + non-zero exit |

---

## Test environment setup transcript

Proxmox host commands (operator-run):

```bash
pct create 999 \
  /var/lib/vz/template/cache/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname luqen-installtest --cores 2 --memory 2048 --swap 1024 \
  --rootfs local-lvm:8 --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1 --unprivileged 1 --password
pct start 999
pct exec 999 -- bash -c 'apt-get update && apt-get install -y openssh-server'
pct exec 999 -- bash -c 'mkdir -p /root/.ssh && chmod 700 /root/.ssh && \
  echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPBMptDvMVB6dwEG8Yv7rGTytmLhLWh6zPTPu/FAhHSR claude-code@lxc-claude" \
  >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys'
```

Resulting LXC was reachable at 192.168.3.75 (subnet 192.168.3.0/24, same as lxc-claude).

Pre-test prerequisites installed by claude-code:
- `apt-get install -y curl git ca-certificates`
- Docker CE 27.x (for S4 attempt)
- PowerShell 7.6.1 (for S15)

After test completion the LXC can be removed with:
```bash
pct stop 999 && pct destroy 999
```

---

## Plan 40-07 verdict

**`verdict: PASS-with-environmental-caveat`**

`install.sh` validates green end-to-end on a clean Ubuntu 22.04 container for the bare-metal happy path, idempotent re-run, uninstall, and purge. `install.command`'s shared code path validates green; macOS-only launchd block is statically reviewed. `install.ps1` syntax + static analysis green; runtime needs a Windows host.

Docker mode is blocked by a Docker-in-LXC DNS limitation, not the installer. Installer error reporting in that path has been improved to surface the actual build failure rather than continue silently.

**DOC-03 success criteria:**
- SC #1 (script delta closure): ✅ PASS — Plan 40-03 + reconfirmed
- SC #2 (docs delta closure): ✅ PASS — Plan 40-03 + uninstall docs added in `f064012`
- SC #3 (fresh install succeeds end-to-end without manual edits): ✅ PASS for bare-metal Linux on this run; ⚠️ docker mode env-blocked on this specific LXC host

A bare-metal Linux host fully meets SC #3. A future runtime gate for docker mode should run on a real Linux host with native Docker, not nested in an unprivileged LXC.

---

## Follow-up work surfaced by the dry-run

1. **Phase 41** (already queued) — backfill OpenAPI route schemas so the `route-vs-spec` coverage tests (currently `describe.skip`) pass.
2. **Phase 42** (already queued + scoped, see `42-CONTEXT.md`) — installer wizard redesign to match v3.1.0 codebase reality: 4-profile model, monitor agent registration, plugin axis (auth/notify/storage/git-host) gated by profile.
3. Future docker-mode runtime gate on a Linux host with non-nested Docker.
