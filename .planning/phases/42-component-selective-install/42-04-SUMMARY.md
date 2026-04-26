---
phase: 42-component-selective-install
plan: 04
subsystem: installer
tags: [verification, lxc, uat, installer]
requirements: [INST-01, INST-02, INST-03, INST-04, INST-05, INST-06]
requires:
  - "42-01 (install.sh 4-profile wizard) — merged"
  - "42-02 (install.command + install.ps1 parity) — merged"
  - "42-03 (docker-compose + installer docs) — merged"
provides:
  - "42-LXC-DRYRUN.md runbook + static validation transcript"
  - "42-UAT-MACOS.md operator checklist (9 TCs)"
  - "42-UAT-WINDOWS.md operator checklist (11 TCs)"
  - "42-VERIFICATION.md per-requirement verdict (INST-01..06)"
affects:
  - .planning/phases/42-component-selective-install/42-LXC-DRYRUN.md
  - .planning/phases/42-component-selective-install/42-UAT-MACOS.md
  - .planning/phases/42-component-selective-install/42-UAT-WINDOWS.md
  - .planning/phases/42-component-selective-install/42-VERIFICATION.md
tech_stack:
  added: []
  patterns:
    - "Static-PASS + LXC-runbook + UAT-checklist verification posture (Phase 40-07 precedent)"
key_files:
  created:
    - .planning/phases/42-component-selective-install/42-LXC-DRYRUN.md
    - .planning/phases/42-component-selective-install/42-UAT-MACOS.md
    - .planning/phases/42-component-selective-install/42-UAT-WINDOWS.md
    - .planning/phases/42-component-selective-install/42-VERIFICATION.md
  modified: []
decisions:
  - "Phase 42 closure does not block on operator running LXC live test or macOS/Windows UAT (Phase 40-07 precedent + locked user answer #4)"
  - "install.ps1 ParseFile + docker compose config deferred to operator (no pwsh/docker on lxc-claude dev box); last green pwsh run was Plan 40-07 S15 commit 4ad69ef"
  - "Verdict: PASS-with-environmental-caveat — matches Phase 40-07's final verdict shape"
metrics:
  duration: "~25 min"
  completed: 2026-04-26
---

# Phase 42 Plan 04: Verification — LXC Runtime Gate + macOS/Windows UAT Checklists Summary

Produced the four Phase 42 verification artifacts: a Linux runtime runbook (LXC), two manual UAT checklists for macOS + Windows, and a per-requirement verification report. Phase 42 closes with `verdict: PASS-with-environmental-caveat`, mirroring Phase 40-07's posture.

## Tasks completed

### Task 1: Static validation + LXC dry-run runbook for install.sh

**Commit:** `359cbf4`

- Captured live `bash -n` PASS for `install.sh` and `install.command` on lxc-claude.
- `pwsh ParseFile` and `docker compose config` deferred to operator on the LXC (neither tool is on the dev box; last green pwsh was Plan 40-07 S15 fix `4ad69ef`).
- Wrote a flag-plumbing audit cross-referencing every Phase 42 must-have truth to source line(s) in install.sh / install.command / install.ps1 (e.g. `--with-monitor requires compliance` → `install.sh:628-631`, monitor unit env → `install.sh:1562-1565`, port 4300 lock → `install.sh:143`, plist label → `install.command:335-338`, allow-list → `install.ps1:281-283`).
- Scripted the 4 mandatory runtime scenarios per the plan (S-INST-04, S-INST-02, S-INST-03 negative + positive, plus an idempotent re-run regression guard from Plan 40-07 S3) with exact ssh commands the operator runs against a throwaway Proxmox LXC.
- Threat-model redaction guidance per T-42-16 (`client_secret` redact pattern, applied to both `.install-monitor-client` and journalctl output).

### Task 2: macOS + Windows UAT checklists (`checkpoint:human-verify`, deferred-with-evidence-pointer)

**Commit:** `251aeeb`

- `42-UAT-MACOS.md`: 9 test cases (TC-1..TC-9) covering wizard discoverability, profile 3 + monitor opt-in, all 5 launchd plist labels including `io.luqen.monitor`, port 4300 binding (NOT 4200), health endpoint reachability, subset profile (`--profile api --api-services compliance,llm`), monitor-without-compliance rejection, and uninstall sweep.
- `42-UAT-WINDOWS.md`: 11 test cases (TC-1..TC-11) covering pwsh ParseFile, 4-profile menu naming branding + LLM explicitly (closes pre-existing v2-era parity bug), `dashboard.config.json` parity check (brandingUrl/Id/Secret + llmUrl/Id/Secret), `-WithMonitor requires compliance` guard, `-ApiServices` token allow-list (T-42-08 mitigation), subset profile, and uninstall.
- Both checklists explicitly accept PARTIAL per locked user answer #4 — no macOS/Windows host is accessible to claude-code (Phase 40-07 S16/S17 precedent).
- Per the user's prompt instructions, treated this `checkpoint:human-verify` as **deferred-with-evidence-pointer**: produced the artifacts, did NOT block on the operator running them now.

### Task 3: Compile 42-VERIFICATION.md

**Commit:** `0137f8b`

- Per-requirement table for INST-01..06 — every row carries a verdict (PASS / PARTIAL / PASS-with-environmental-caveat) with file:line or scripted-scenario evidence.
- 11 observable-truth rows mapped against the must_haves frontmatter from 42-04-PLAN.md.
- Defects-found table consolidates Phase 42's 8 commits (42-01 `1cd95cc`, 42-02 `f1b7b9c` + `35aa38a` + `368eb2f`, 42-03 `19361db` + `4663f7c`, 42-04 `359cbf4` + `251aeeb`).
- Open-items section flags the 4 deferred runtime checks (LXC live, macOS UAT, Windows UAT, `docker compose config`).
- Final verdict line: `verdict: PASS-with-environmental-caveat`.

## Verification results

- All `<verify><automated>` checks from 42-04-PLAN.md pass:
  - `test -f 42-LXC-DRYRUN.md && grep -q "INST-04 ... INST-02 ... INST-03 ... PASS|FAIL" 42-LXC-DRYRUN.md` — PASS
  - `test -f 42-UAT-MACOS.md && test -f 42-UAT-WINDOWS.md` — PASS
  - `test -f 42-VERIFICATION.md && grep -qE "INST-0[1-6]" && grep -qE "verdict:"` — PASS

## Deviations from Plan

### Rule 3 — Blocking dev-box tooling: pwsh + docker absent on lxc-claude

**Found during:** Task 1 static validation step.
**Issue:** Plan 42-04 Task 1 step 1 calls `pwsh ParseFile install.ps1` and `docker compose config`. Neither tool is installed on the dev box where this agent runs.
**Fix:** Documented as DEFERRED with evidence pointers — `pwsh ParseFile` last passed at Plan 40-07 S15 (commit `4ad69ef`); `docker compose config` deferred to operator (Plan 42-03 already validated YAML structure via `js-yaml` per 42-03-SUMMARY.md). Both are listed as static-PASS with operator re-run paths in `42-LXC-DRYRUN.md` §1 and `42-UAT-WINDOWS.md` TC-1.
**Files modified:** `42-LXC-DRYRUN.md` (§1 + §2 audit captures the missing-tool reality and points to where the operator picks up).
**Commit:** `359cbf4`

### Checkpoint task treated as deferred-with-evidence-pointer (per user prompt)

The plan defines Task 2 as `type="checkpoint:human-verify"`. The user's spawn prompt instructed: "if the plan's checkpoint task requires the user to actually run UAT before phase closes, treat it as **deferred-with-evidence-pointer** matching Phase 40's PARTIAL pattern." Followed that instruction — produced both UAT documents fully populated with test plans + sign-off blocks, did not block waiting for operator outcomes. This matches Phase 40-07's S16/S17 PARTIAL acceptance.

## Auto-fix attempts

None used. No errors surfaced during static validation.

## Self-Check: PASSED

- `42-LXC-DRYRUN.md` — FOUND, contains INST-04, INST-02, INST-03 references, 4-scenario runbook, threat-model redaction guidance.
- `42-UAT-MACOS.md` — FOUND, contains "io.luqen.monitor" reference (per must_haves contains-check).
- `42-UAT-WINDOWS.md` — FOUND, contains "LuqenMonitor" reference (per must_haves contains-check).
- `42-VERIFICATION.md` — FOUND, contains INST-01..06 table rows, `verdict: PASS-with-environmental-caveat` in frontmatter and final-verdict section.
- Commit `359cbf4` — FOUND in `git log`.
- Commit `251aeeb` — FOUND in `git log`.
- Commit `0137f8b` — FOUND in `git log`.

## Final verdict

`verdict: PASS-with-environmental-caveat` — Phase 42 closes with the runtime gate as a runnable runbook (LXC) + complete UAT checklists for macOS + Windows + per-requirement verification report. All 6 INST-* requirements have an explicit verdict backed by concrete file:line evidence or scripted-runbook scenarios.
