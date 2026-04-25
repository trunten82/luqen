# Phase 40 Plan 07 — Fresh-container install dry-run

**Plan:** 40-07 (Fresh-container install acceptance gate, DOC-03 SC #3)
**Run started:** 2026-04-25
**Worktree:** `agent-aea0d2d4` @ `996c5c4` (post 40-06 merge)
**Operator:** GSD executor (autonomous)

---

## Environment audit (pre-flight)

The dry-run, per Plan 40-07 Task 1 acceptance criterion, requires a clean container
provisioned via either `lxc launch` or `docker run`. Pre-flight on the executor host
returns:

```
$ which docker         -> (not found)
$ which lxc            -> (not found)
$ which podman         -> (not found)
$ cat /proc/1/cgroup   -> 0::/init.scope         # already inside an LXC (lxc-claude)
$ uname -a             -> Linux lxc-claude 6.17.13-2-pve x86_64 GNU/Linux
```

Neither container runtime is installable from inside this unprivileged worktree
(`apt`/`docker.io` requires `sudo` not granted to the executor; nested LXC requires
host access). The plan permits "LXC OR Docker" — neither path is reachable here.

This is a hard environment gap, not a script defect. See `## Escalation` below for
disposition. The remainder of this transcript captures the highest-fidelity static
substitute possible (script syntax + static parity audit + on-disk migration head
verification) so the artifact is auditable per `must_haves.truths[6]`.

---

## Install transcript

A live `bash install.sh 2>&1 | tee /tmp/install-transcript.log` could not be executed
inside a fresh container (see Environment audit above). The substitute below verifies
the same predicates the plan would assert in-container, sourced from the on-disk
scripts and migration registry rather than from a runtime install.

```text
$ bash -n install.sh
(no output)
$ echo $?
0

$ bash -n install.command
(no output)
$ echo $?
0

# install.ps1: pwsh not installed on this host (consistent with Plan 40-03's note);
# brace-balance was checked at Plan 40-03 commit time, not re-run here.
```

**Install exit code: N/A — no live install was executed (see Escalation).**

The Plan 40-03 SUMMARY records that `bash -n` syntax checks already passed at
script-write time and the same checks pass again at plan-07 entry; nothing has
modified the three installer scripts between Plan 40-03 commit `e691bc6` and the
current worktree HEAD `996c5c4`.

---

## Smoke checks

The plan's smoke checks require live services on ports 4000/4100/4200/4500. None
are running on the executor host:

```
$ curl -fsS http://localhost:4000/health  -> connection refused
$ curl -fsS http://localhost:4100/health  -> connection refused
$ curl -fsS http://localhost:4200/health  -> connection refused
$ curl -fsS http://localhost:4500/health  -> connection refused
```

What follows is the static-evidence substitute for each of the five plan-required
check groups. Each check states the closest verifiable predicate available without
a running install and marks results as `[STATIC-PASS]` (the on-disk artefact
satisfies the predicate the plan would have checked at runtime), `[STATIC-FAIL]`
(the artefact does NOT satisfy it and a script defect is identified), or
`[DEFERRED]` (only verifiable inside a real container).

### 1. Health endpoints — DEFERRED

- [DEFERRED] compliance:4100 /health — service not running locally; no fresh
  install performed.
- [DEFERRED] branding:4500 /health — service not running locally.
- [DEFERRED] llm:4200 /health — service not running locally.
- [DEFERRED] dashboard:4000 /health — service not running locally.
- [STATIC-PASS] Each of the four daemons IS registered for `systemctl enable +
  start` in install.sh:

```
$ grep -cE "systemctl (enable|start)" install.sh
8                  # 4 enables + 4 starts → matches Plan 40-03 acceptance count
```

### 2. Migration head — STATIC-PASS

- [STATIC-PASS] On-disk migration registry head equals 061:

```
$ tail -n 20 packages/dashboard/src/db/sqlite/migrations.ts | grep -E "id:"
    id: '061',
```

The plan asks for `SELECT MAX(version) FROM migrations` to return 061 against a
freshly-migrated SQLite DB. The migration registry's terminal entry is
`id: '061' name: 'agent-active-org'`, and install.sh defers to
`adapter.migrate()` (no hardcoded migration target — see Plan 40-03 SUMMARY
decision #1), so a fresh `node packages/dashboard/dist/cli/migrate.js` run
inside a container WILL reach 061 in one pass. Static evidence confirms the
predicate is structurally satisfiable; runtime confirmation deferred.

Note: migrations are stored as zero-padded string ids (`'061'`, not `61`). The
plan's `SELECT MAX(version)` SQL works on string ordering for this schema since
all ids are 3-char zero-padded; this is not a script defect.

### 3. Admin login — DEFERRED

- [DEFERRED] POST to /admin/login — no running dashboard.
- [STATIC-PASS] install.sh seeds the admin user via the dashboard CLI's
  `--seed-admin` path (verified at Plan 40-03 commit `83238ce`); the seeded
  credentials env-var pair (`DASHBOARD_ADMIN_EMAIL`,
  `DASHBOARD_ADMIN_PASSWORD`) is documented in
  `docs/deployment/installer-env-vars.md`.

### 4. New admin pages reachable — DEFERRED for HTTP, STATIC-PASS for catalogue

The DELTA file (`.planning/phases/40-documentation-sweep/40-03-DELTA.md`) is
gitignored and was not preserved across the worktree. The canonical list of
new admin pages was instead extracted from `install.sh::show_v3_whats_new`,
which Plan 40-03 derived from the same DELTA:

- `/admin/audit` — Agent audit log viewer (filter + CSV export) — `audit.view`
- `/admin/oauth-keys` — OAuth signing-key inventory + manual rotate —
  `admin.system`

End-user surfaces (also new since v2.12.0):
- `/agent`, `/agent/share/<id>`, `/api/mcp`, `/oauth/.well-known/*`

Per-URL HTTP probes:
- [DEFERRED] curl -b session http://localhost:4000/admin/audit
- [DEFERRED] curl -b session http://localhost:4000/admin/oauth-keys
- [STATIC-PASS] Both routes are advertised by the installer's post-install
  summary, so the install user-experience announces them; a runtime miss would
  be a dashboard route-registration defect, not an installer-script defect.

### 5. New RBAC permissions present — DEFERRED for query, STATIC-PASS for seed

- [DEFERRED] dashboard permissions API/CLI query of admin role membership.
- [STATIC-PASS] The new RBAC permission since v2.12.0 is `mcp.use`, back-filled
  onto every existing role by migration `054`
  (`backfill-mcp-use-permission` — line 1383 of
  `packages/dashboard/src/db/sqlite/migrations.ts`). Because install.sh runs
  `adapter.migrate()` to head 061, migration 054 is applied at install time,
  so a freshly-installed dashboard already has `mcp.use` granted to every
  existing role's membership without further intervention.

  Other RBAC perms touched in 40-CONTEXT scope (`audit.view`, `admin.system`)
  are pre-v2.12.0 and were already present.

---

## Verdict

**verdict: DEFERRED**

A binary `PASS` cannot be issued in this environment because the plan's
acceptance gate requires a clean container that the executor host cannot
provision (see Environment audit). A `FAIL` would be incorrect because every
predicate the plan would assert at runtime is structurally satisfiable from the
on-disk artefacts; no installer-script defect was identified by the static
substitute. Per Plan 40-07 Task 3, a `FAIL` requires a per-check root-cause
hypothesis pointing to a script bug — none was found.

The honest disposition is **DEFERRED to a Linux host with `docker` or `lxc`
installed and `sudo` available**. See `## Escalation`.

_Acceptance gate **not** satisfied at runtime. Static substitute is satisfied._

---

## Iteration 1 — installer-script audit (no patches required)

Per Plan 40-07 Task 4, when verdict ≠ PASS the executor must identify a root
cause and patch `install.sh` / `install.command` / `install.ps1`. The static
audit performed under `## Smoke checks` did NOT find a script defect; the
verdict deferral is environmental. Therefore no patches are made in this
iteration. Static parity counts at iteration 1:

```
$ grep -cE "(DASHBOARD_PUBLIC_URL|DASHBOARD_JWT_PUBLIC_KEY|DASHBOARD_JWKS_URI|DASHBOARD_JWKS_URL|OAUTH_KEY_MAX_AGE_DAYS|BRANDING_PUBLIC_URL|COMPLIANCE_PUBLIC_URL|LLM_PUBLIC_URL|OLLAMA_BASE_URL)" install.sh
43

$ grep -cE "systemctl (enable|start)" install.sh
8

$ grep -cE "write_plist \"io\.luqen\." install.command
4

$ grep -cE "(LuqenCompliance|LuqenBranding|LuqenLlm|LuqenDashboard)" install.ps1
37

$ grep -E "Last reviewed for v3\.1\.0" install.sh install.command install.ps1 | wc -l
5      # 1 in install.sh, 1 in install.command, 2 in install.ps1 (header + helper),
       # plus 1 occurring inside install.sh's docker .env template
```

All counts match Plan 40-03 SUMMARY's recorded values, so no script regression
has occurred between Plan 40-03 commit `e691bc6` and the current worktree HEAD.

---

## Escalation

**Persistent failure mode:** the Plan 40-07 acceptance gate cannot be executed
inside this worktree because no container runtime is available and the
executor lacks the privileges (sudo / nested-LXC) to install one.

**Root-cause analysis:**

1. The executor runs inside an unprivileged LXC (`lxc-claude`) provisioned for
   GSD agents. That host intentionally does NOT carry `docker`,
   `containerd`, `lxc`, or `podman`.
2. Plan 40-07's acceptance contract assumes the operator has either a
   Docker-enabled CI runner or a Proxmox/LXC host with `sudo` — neither
   matches the GSD agent worktree environment.
3. There is nothing in the installer scripts themselves that prevents a fresh
   install from succeeding; the static parity audit is clean and the migration
   registry head matches the documented baseline (061).

**Recommendation for next steps (in priority order):**

1. **Run the dry-run on `lxc-luqen` or a Docker-capable CI runner.** This is
   the canonical Phase 40-07 acceptance path. Owner: human operator with
   `lxc launch` / `docker run` access. Procedure: clone repo at v3.1.0 head,
   set the env vars listed in `docs/deployment/installer-env-vars.md`, run
   `bash install.sh --non-interactive --mode bare-metal`, then execute the
   five smoke-check groups documented above. Append the runtime transcript
   to this file under `## Iteration 2 — runtime` and flip verdict to PASS.
2. **Defer Phase 40 verification PASS until step 1 is completed.** Phase
   40-CONTEXT D-01 makes the dry-run a hard gate; that locked decision must
   not be silently relaxed.
3. **Optionally**, harden GSD's container-aware executor so future
   `acceptance-gate` plans declare a `requires_runtime: docker|lxc` token in
   frontmatter and the orchestrator refuses to dispatch them to worktrees
   that cannot satisfy the requirement. (Out of scope for this plan.)

**Static-substitute confidence:** HIGH that the runtime gate will PASS when
executed on a properly-provisioned host. Every predicate has a structural
analogue verified on disk; no installer-script defect was discovered; the
migration registry resolves to the expected head; new admin pages and RBAC
perms are advertised by the installer's `show_v3_whats_new` summary, which
was generated from the same DELTA inventory the plan's smoke checks would
enumerate.

**Outstanding action items:** none owned by the executor. All remaining work
(provisioning + runtime execution) requires elevated privileges outside this
worktree.

---

_End of dry-run transcript. Acceptance gate disposition: **DEFERRED** —
runtime execution required on a Docker- or LXC-capable host before Phase 40
verification can be marked PASS per CONTEXT D-01._
