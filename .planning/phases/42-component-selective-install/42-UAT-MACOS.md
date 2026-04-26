# Phase 42 — macOS UAT Checklist (`install.command`)

**Status:** PARTIAL acceptance per locked user answer #4 (verification budget = Phase 40 precedent). **Operator-run on a real Mac.** Phase 42 closes without this completed; this document is the evidence pointer for INST-01 / INST-03 (cross-OS) / INST-05 / INST-06 PARTIAL verdicts.

**Why PARTIAL:** No macOS host is available to claude-code. Static review of `install.command` is green (`bash -n` PASS, Plan 40-07 S10 already proved the Linux-side curl-pipe works after fix `5b4bd01`). The macOS-only launchd block (`install.command:183-347`) is gated on `[ "$(uname -s)" = "Darwin" ]` (line 198) and was statically reviewed during Plan 42-02. Live double-click on a real Mac is the missing piece.

**Phase 40 precedent:** `40-07-DRYRUN.md` S16 marked "❌ NOT TESTABLE — No macOS host available". Phase 42 inherits the same constraint and the same PARTIAL acceptance.

---

## Pre-flight

- macOS 13+ (Ventura or newer) with Xcode Command Line Tools
- Node 20.x (`node --version` → `v20.*`)
- A working `git` and `curl`
- An `admin` user with sudo (the script calls `sudo -v` once)

---

## Test plan

### TC-1 — Clone repo at the Phase 42 feature branch

```sh
git clone git@github.com:tphsoftware/luqen-platform.git
cd luqen-platform
git checkout master   # Phase 42 has been merged
git rev-parse --short HEAD
```

**Expected:** clone succeeds; HEAD on master at or after commit `359cbf4` (or whatever the most recent Phase 42 master commit is).

**Outcome:** _pending operator run_

---

### TC-2 — Double-click `install.command` (interactive wizard)

In Finder: navigate to the cloned repo, double-click `install.command`. Terminal opens.

**Expected — wizard prompts:**
- 4-profile menu appears with options:
  1. Scanner CLI
  2. API services (headless)
  3. Self-hosted dashboard (default)
  4. Docker Compose
- After selecting profile 3, monitor agent opt-in prompt appears (default n)
- Branding and LLM are explicitly named (closes pre-existing parity gap from `install.ps1`)

**Outcome:** _pending operator run_

---

### TC-3 — Profile 3 (dashboard) + monitor opt-in

Re-run `./install.command` from Terminal (not double-click) for stdin control:

```sh
./install.command
# Wizard prompts:
#   profile? -> 3 (dashboard)
#   install monitor agent? -> y
#   admin user? -> admin
#   admin pass? -> changeme123
```

**Expected:**
- exit 0
- Install dir at `~/Library/Application Support/Luqen` (or `/opt/luqen` if run as root)
- launchd plists exist:
  - `~/Library/LaunchAgents/io.luqen.compliance.plist`
  - `~/Library/LaunchAgents/io.luqen.branding.plist`
  - `~/Library/LaunchAgents/io.luqen.llm.plist`
  - `~/Library/LaunchAgents/io.luqen.dashboard.plist`
  - `~/Library/LaunchAgents/io.luqen.monitor.plist`

```sh
ls -la ~/Library/LaunchAgents/io.luqen.*.plist
```

**Outcome:** _pending operator run_

---

### TC-4 — `launchctl list` confirms agents loaded

```sh
launchctl list | grep io.luqen
```

**Expected:** 5 lines, one per agent (`io.luqen.compliance`, `io.luqen.branding`, `io.luqen.llm`, `io.luqen.dashboard`, `io.luqen.monitor`). Each line's PID column should be a number (not `-`), indicating the agent is running.

**Outcome:** _pending operator run_

---

### TC-5 — Monitor agent bound to port 4300 (locked answer #1: NOT 4200)

```sh
lsof -i :4300
```

**Expected:** at least one line with `node` or `luqen-monitor` LISTEN on `*:4300` (IPv4 or v6). No process should be on `:4200` from the monitor; LLM owns 4200.

```sh
lsof -i :4200 | grep -i monitor   # must be empty
```

**Outcome:** _pending operator run_

---

### TC-6 — Health endpoints reachable

```sh
curl -s http://localhost:4000/api/v1/health   # compliance
curl -s http://localhost:4100/api/v1/health   # branding
curl -s http://localhost:4200/api/v1/health   # llm
curl -s http://localhost:5000/health          # dashboard
curl -s http://localhost:4300/health          # monitor
```

**Expected:** all 5 return `{"status":"ok",...}` JSON.

**Outcome:** _pending operator run_

---

### TC-7 — Subset profile (`--profile api --api-services compliance,llm`)

Uninstall first, then:

```sh
./install.command --uninstall --purge
./install.command --profile api --api-services compliance,llm \
                  --non-interactive --admin-user admin --admin-pass changeme123
ls ~/Library/LaunchAgents/io.luqen.*.plist
launchctl list | grep io.luqen
```

**Expected:**
- exit 0
- Only 2 plist files (compliance, llm) — branding, dashboard, monitor absent
- Only 2 launchctl entries

**Outcome:** _pending operator run_

---

### TC-8 — `--with-monitor` without compliance is rejected (T-42-06)

```sh
./install.command --profile cli --with-monitor 2>&1 | tail -5
```

**Expected:** non-zero exit; stderr contains `requires compliance`.

**Outcome:** _pending operator run_

---

### TC-9 — Uninstall removes monitor plist

After TC-3 succeeded:

```sh
~/.luqen/uninstall   # or ./install.command --uninstall
ls ~/Library/LaunchAgents/io.luqen.monitor.plist 2>&1
launchctl list | grep io.luqen.monitor
```

**Expected:**
- monitor plist gone (`No such file`)
- `launchctl list` returns no matching line

**Outcome:** _pending operator run_

---

## Threat-model redactions (T-42-16)

When pasting any output that contains the bearer token from `~/.luqen/.install-monitor-client`, redact with:

```sh
cat ~/.luqen/.install-monitor-client | sed -E 's/(client_secret=).*/\1***REDACTED***/'
```

---

## Operator sign-off

When this checklist has been run, fill in below:

```
Operator: _________________
macOS version: _____________
Date (ISO): _______________
TC-1 .. TC-9 results: ____   (PASS/FAIL/SKIP per row in §"Outcome")
Defects (if any): see 42-LXC-DRYRUN.md §"Defects" — same shape — and link commits here
Verdict: PARTIAL-COMPLETE | PARTIAL-WITH-DEFECTS | FAIL
```

---

## References

- `install.command` source: `/root/luqen/install.command`
- macOS-only launchd block: `install.command:183-347`
- Darwin gate: `install.command:198`
- Per-component plist generation: `install.command:299-347`
- Monitor plist label: `install.command:335-338` (`io.luqen.monitor`)
- Phase 40 precedent (no macOS host): `.planning/phases/40-documentation-sweep/40-07-DRYRUN.md` S16
- Phase 42 plan: `42-02-PLAN.md` Task 1
- Phase 42 plan summary: `42-02-SUMMARY.md`
