---
phase: 04-ship-ready
plan: "01"
subsystem: llm-installer
tags: [installer, cli, bash, oauth, jwt, idempotency]
dependency_graph:
  requires: []
  provides: [packages/llm/installer/install-llm.sh, packages/llm/installer/install-llm.test.sh]
  affects: [packages/llm/src/cli.ts, packages/llm/dist/cli.js]
tech_stack:
  added: []
  patterns: [bash-installer, mock-node-testing, idempotency-cache]
key_files:
  created:
    - packages/llm/installer/install-llm.sh
    - packages/llm/installer/install-llm.test.sh
  modified:
    - packages/llm/src/cli.ts
    - packages/llm/dist/cli.js
    - .gitignore
decisions:
  - "LUQEN_LLM_INSTALL_DIR env var added to installer for test isolation without full sourcing"
  - "Mock node binary via PATH override chosen over sourcing installer to avoid top-level code re-execution in tests"
  - "show_help_error/_print_help split so unknown flags exit 1 while --help exits 0"
  - "Re-exec guard uses (exec </dev/tty) 2>/dev/null test to detect usable tty before attempting re-exec"
metrics:
  duration: "10 minutes"
  completed: "2026-04-04T19:06:17Z"
  tasks: 2
  files_created: 2
  files_modified: 3
---

# Phase 04 Plan 01: LLM Module Installer Summary

Standalone interactive installer for `@luqen/llm` with bash test harness. Operators can run `install-llm.sh` to configure JWT keys, an OAuth client, an LLM provider, a model, and assign all four capabilities in one guided flow.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Create install-llm.sh installer | d0275a0 | packages/llm/installer/install-llm.sh, packages/llm/src/cli.ts, .gitignore |
| 2 | Create install-llm.test.sh bash test harness | 4fd42ab | packages/llm/installer/install-llm.test.sh (updated install-llm.sh) |

## What Was Built

### install-llm.sh

Interactive installer following the exact pattern of the main `install.sh`:

- Color helpers (BOLD/GREEN/YELLOW/RED/CYAN/DIM/RESET via tput), info/success/warn/error/header/step functions
- `ask`/`ask_secret`/`ask_yn`/`ask_choice` interactive helpers
- Re-exec guard for `curl | bash` usage (with /dev/tty usability check)
- `--non-interactive`, `--port`, `--provider-type`, `--provider-url`, `--provider-name`, `--model`, `--client-name`, `--client-scopes`, `--help` flags
- `LUQEN_LLM_INSTALL_DIR` env var override for test isolation
- 5-step installation: prerequisites check, JWT key generation, OAuth client creation, provider+model registration, summary output
- Idempotency guards via `.install-llm-client`, `.install-llm-provider`, `.install-llm-model` cache files (chmod 600)
- Assigns all 4 capabilities: `extract-requirements`, `generate-fix`, `analyse-report`, `discover-branding`
- Summary block shows OAuth credentials and `dashboard.config.json` snippet

### install-llm.test.sh

8-test bash harness (0 external dependencies):

| Test | What it tests |
|------|---------------|
| T01 | --help exits 0 |
| T02 | bash -n syntax valid |
| T03 | --non-interactive skips wizard |
| T04 | --port sets LLM_PORT |
| T05 | --provider-type sets PROVIDER_TYPE |
| T06 | Idempotency: existing keys skipped |
| T07 | Idempotency: existing client cache skipped |
| T08 | Unknown flag exits non-zero |

Tests use PATH-based mock node binary and `LUQEN_LLM_INSTALL_DIR` env override for full isolation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing CLI commands (providers, models, capabilities)**

- **Found during:** Task 1
- **Issue:** The plan's interface spec references `node dist/cli.js providers create`, `models register`, and `capabilities assign` CLI commands, but the existing `cli.ts` only had `serve`, `clients`, `users`, and `keys` commands. The installer cannot function without these.
- **Fix:** Added `providers create/list`, `models register/list`, and `capabilities assign/list` commands to `packages/llm/src/cli.ts`, rebuilt the package.
- **Files modified:** `packages/llm/src/cli.ts`, `packages/llm/dist/cli.js`
- **Commit:** d0275a0

**2. [Rule 2 - Missing functionality] Installer cache files not gitignored**

- **Found during:** Task 1
- **Issue:** The `.install-llm-client`, `.install-llm-provider`, `.install-llm-model` cache files contain OAuth secrets and would be committed if not explicitly ignored.
- **Fix:** Added patterns to `.gitignore` covering all installer cache files for all packages.
- **Files modified:** `.gitignore`
- **Commit:** d0275a0

**3. [Rule 1 - Bug] /dev/tty not usable in containerized environments**

- **Found during:** Task 1 verification
- **Issue:** The re-exec guard and output functions used `>/dev/tty` and `[ -r /dev/tty ]` but in containers `/dev/tty` exists (passes -r/-w tests) yet cannot actually be opened. This caused failures for `--help`, `--non-interactive`, and `--unknown-flag`.
- **Fix:** Used `(exec </dev/tty) 2>/dev/null` and `(exec >/dev/tty) 2>/dev/null` as usability tests. Added `_OUT` variable to fall back to stderr when tty is not usable. Added `_NEEDS_TTY` check to skip re-exec for `--non-interactive` and `--help`.
- **Files modified:** `packages/llm/installer/install-llm.sh`
- **Commit:** d0275a0

**4. [Rule 2 - Missing functionality] Test isolation requires INSTALL_DIR override**

- **Found during:** Task 2 — tests T04-T07 silently operated on real packages/llm
- **Issue:** Tests need to control INSTALL_DIR to be repeatable in clean environments. Sourcing the installer (to override INSTALL_DIR at runtime) causes top-level argument parsing to re-run with wrapper args. PATH-based mock node alone wasn't sufficient.
- **Fix:** Added `LUQEN_LLM_INSTALL_DIR` env var to `install-llm.sh` (`INSTALL_DIR="${LUQEN_LLM_INSTALL_DIR:-$(cd ...)}"`) and used it in all tests.
- **Files modified:** `packages/llm/installer/install-llm.sh`, `packages/llm/installer/install-llm.test.sh`
- **Commit:** 4fd42ab

## Known Stubs

None — installer drives real CLI commands (or mocks in tests). No hardcoded credentials, no placeholder output.

## Self-Check: PASSED

- FOUND: packages/llm/installer/install-llm.sh (executable)
- FOUND: packages/llm/installer/install-llm.test.sh (executable)
- FOUND: commit d0275a0 (Task 1)
- FOUND: commit 4fd42ab (Task 2)
- Test harness: 8 passed, 0 failed
