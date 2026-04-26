# Plan 42-04 — LXC Dry-Run Runbook + Static Validation Transcript

**Status:** RUNBOOK READY — STATIC VALIDATION PASS. LXC live runtime is the operator-executed gate (mirrors Phase 40 / Plan 40-07 pattern).

**Test environment (target):** Throwaway Proxmox LXC, Ubuntu 22.04 LTS, unprivileged + nesting=1, 8 GB rootfs, 2 GB RAM. Provisioned per `~/.claude/projects/-root-luqen/memory/reference_installer_test_lxc.md` and Plan 40-07 transcript.

**Reference:** Plan 40-07's runtime gate validated `install.sh` end-to-end after 8 defect cycles. Phase 42 reused the same wizard scaffolding (re-exec block, `OUT` helper, idempotent re-run, uninstall) so those defects do **not** need re-verification — the new surface is the 4-profile model + `--api-services` + `--with-monitor` + monitor systemd unit.

---

## 1. Static validation (executed on dev box `lxc-claude`, 2026-04-26)

| Check | Command | Result |
|-------|---------|--------|
| install.sh syntax | `bash -n install.sh` | ✅ exit 0 — `OK install.sh` |
| install.command syntax | `bash -n install.command` | ✅ exit 0 — `OK install.command` |
| install.ps1 syntax | `pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content install.ps1 -Raw)) \| Out-Null"` | ⚠️ DEFERRED — pwsh not installed on lxc-claude. Last green run captured in Plan 40-07 S15 (`commit 4ad69ef`). Phase 42's `install.ps1` rewrite (commit references in 42-02-SUMMARY.md) is to be re-validated by the operator on the LXC after `apt-get install -y powershell` (Plan 40-07 prereq). See §6 below. |
| docker-compose validation | `docker compose config >/dev/null` | ⚠️ DEFERRED — docker not installed on lxc-claude (intentional: dev box runs only the OAuth/dashboard test rig). Performed on LXC by the operator. YAML structural validation via `js-yaml` already ran green during Plan 42-03 (5 services, 8 volumes, profile gating, port mappings — see 42-03-SUMMARY.md "YAML structure validation"). |
| INST-02 grep guards | flag plumbing audit (see §2.1) | ✅ all flags present |

Static parse evidence:

```
$ bash -n install.sh && echo "OK install.sh"
OK install.sh
$ bash -n install.command && echo "OK install.command"
OK install.command
```

(Live transcript captured during Plan 42-04 Task 1 execution, 2026-04-26.)

---

## 2. Flag-plumbing audit (static, against installer source)

### 2.1 install.sh — flag fidelity

| Flag (per 42-CONTEXT) | Source line(s) | Plumbed |
|-----------------------|----------------|---------|
| `--profile cli\|api\|dashboard\|docker` | install.sh:241-247 (help) + dispatch | ✅ |
| `--api-services CSV` | install.sh:248-249 + parser | ✅ |
| `--with-monitor` | install.sh:139, 250-252, 554, 628-631, 1551-1565 | ✅ |
| `--without-compliance/branding/llm` | install.sh:140-142, 253-255 | ✅ |
| `--monitor-port` | install.sh:143, 256, 382 | ✅ |
| `--non-interactive` default → all 4 services + no monitor (D-01) | install.sh:135-137 ("Default … = dashboard") + parser | ✅ |
| `--with-monitor` requires compliance (negative) | install.sh:628-631 — `error "--with-monitor requires compliance ..."` | ✅ |
| Monitor systemd unit at `/etc/systemd/system/luqen-monitor.service` | install.sh:1551 | ✅ |
| Monitor unit env: `MONITOR_COMPLIANCE_URL`, `MONITOR_CLIENT_ID`, `MONITOR_URL`, `MONITOR_PORT` | install.sh:1562-1565 | ✅ |
| Monitor client cache `/opt/luqen/.install-monitor-client` mode 600 | install.sh:1295-1311 (write/read), `chmod 600` paired | ✅ |

### 2.2 install.command — flag fidelity

| Behaviour | Source line(s) | Plumbed |
|-----------|----------------|---------|
| Darwin gate (skip launchd on Linux) | install.command:198 — `(skipping launchd registration — not running on macOS …)` | ✅ |
| Per-component plist generation | install.command:299-347 — `for c in COMPONENTS_ARR` | ✅ |
| Monitor plist `io.luqen.monitor` | install.command:335-338 | ✅ |
| Uninstall: unloads all 5 plist labels including monitor | install.command:155-160 | ✅ |

### 2.3 install.ps1 — flag fidelity

| Behaviour | Source line(s) | Plumbed |
|-----------|----------------|---------|
| 4-profile menu (cli/api/dashboard/docker) | install.ps1:427-440 | ✅ |
| `-WithMonitor` requires compliance (T-42-06) | install.ps1:321-323 — `Write-Err "-WithMonitor requires compliance ..."` | ✅ |
| `-ApiServices` token allow-list (T-42-08 mitigation) | install.ps1:281-283 | ✅ |
| `dashboard.config.json` includes brandingUrl/Id/Secret + llmUrl/Id/Secret (closes pre-existing parity bug) | install.ps1:1017-1029 | ✅ |
| LuqenMonitor NSSM service — see 42-02-SUMMARY.md "Task 2" for unit-name registration | per 42-02-SUMMARY | ✅ |

All 3 installers carry the Phase 42 4-profile contract end-to-end at the source level. Runtime confirmation for Linux is the LXC live test in §3; macOS + Windows are operator UAT (see §6).

---

## 3. LXC live test runbook (operator-executed)

Provision a fresh Proxmox LXC per `reference_installer_test_lxc.md`:

```bash
# On Proxmox host:
pct create 999 \
  /var/lib/vz/template/cache/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname luqen-installtest --cores 2 --memory 2048 --swap 1024 \
  --rootfs local-lvm:8 --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1 --unprivileged 1 --password
pct start 999
pct exec 999 -- bash -c 'apt-get update && apt-get install -y openssh-server curl git ca-certificates'
pct exec 999 -- bash -c 'mkdir -p /root/.ssh && chmod 700 /root/.ssh && \
  echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPBMptDvMVB6dwEG8Yv7rGTytmLhLWh6zPTPu/FAhHSR claude-code@lxc-claude" \
  >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys'
```

Push the repo to the LXC (or `git clone` from inside it). Then execute the 4 mandatory scenarios from claude-code:

### S-INST-04 — Default `--non-interactive` (D-01 invariant)

```bash
ssh root@<lxc> 'cd /root/luqen && bash install.sh --non-interactive --admin-user admin --admin-pass changeme123'
EXIT=$?; echo "exit=$EXIT"
ssh root@<lxc> 'systemctl is-active luqen-compliance luqen-branding luqen-llm luqen-dashboard'
ssh root@<lxc> 'systemctl is-active luqen-monitor 2>&1 || echo "not-installed"'
```

**Pass criteria:**
- exit 0
- 4 services all `active`
- monitor unit not registered (`Failed to get unit file state` or "not-installed")

**Maps to:** INST-04 (non-interactive default invariant), INST-01 (4-profile wizard reachable in non-interactive mode via `--profile dashboard` default), INST-06 (end-to-end runtime).

### S-INST-02 — Subset (`--profile api --api-services compliance,llm`)

```bash
ssh root@<lxc> 'cd /root/luqen && bash install.sh --uninstall --purge'
ssh root@<lxc> 'cd /root/luqen && bash install.sh --profile api --api-services compliance,llm \
                --non-interactive --admin-user admin --admin-pass changeme123'
EXIT=$?; echo "exit=$EXIT"
ssh root@<lxc> 'systemctl list-unit-files "luqen-*" | grep enabled | wc -l'   # expect 2
ssh root@<lxc> 'systemctl is-active luqen-compliance luqen-llm'                 # both active
ssh root@<lxc> 'systemctl is-active luqen-branding luqen-dashboard 2>&1 || echo "not-installed"'
```

**Pass criteria:**
- exit 0
- exactly 2 enabled luqen-* unit files
- compliance + llm both `active`; branding + dashboard not registered

**Maps to:** INST-02 (per-component selection).

### S-INST-03 negative — `--profile cli --with-monitor` parser error

```bash
ssh root@<lxc> 'cd /root/luqen && bash install.sh --profile cli --with-monitor 2>&1 | tail -5'
ssh root@<lxc> 'cd /root/luqen && bash install.sh --profile cli --with-monitor; echo exit=$?'
```

**Pass criteria:**
- exit non-zero
- stderr/stdout contains the exact string `requires compliance` (install.sh:631)

**Maps to:** INST-03 negative (monitor invariant — D-03).

### S-INST-03 positive — `--profile dashboard --with-monitor`

```bash
ssh root@<lxc> 'cd /root/luqen && bash install.sh --uninstall --purge'
ssh root@<lxc> 'cd /root/luqen && bash install.sh --profile dashboard --with-monitor \
                --non-interactive --admin-user admin --admin-pass changeme123'
EXIT=$?; echo "exit=$EXIT"
ssh root@<lxc> 'systemctl is-active luqen-monitor'                                  # active
ssh root@<lxc> 'ss -ltnp | grep 4300'                                               # bound to 4300 (NOT 4200)
ssh root@<lxc> 'cat /etc/systemd/system/luqen-monitor.service | grep -E "MONITOR_(CLIENT_ID|PORT|COMPLIANCE_URL)"'
ssh root@<lxc> 'ls -la /opt/luqen/.install-monitor-client'                          # mode 600
ssh root@<lxc> 'journalctl -u luqen-monitor --no-pager -n 30'                       # no errors
```

**Pass criteria:**
- exit 0
- `luqen-monitor` `active`
- TCP listener on `:4300` (not 4200 — locked answer #1)
- unit env contains all 3 `MONITOR_*` vars
- `.install-monitor-client` mode is `-rw-------` (600 — T-42-16 mitigation)
- `journalctl` shows no errors and a "manual mode" / agent-up log line

**Maps to:** INST-03 positive (monitor registration), INST-06 (runtime).

### S-IDEMPOTENT — Re-run regression (Plan 40-07 S3)

After S-INST-03 positive, immediately re-execute the same install command:

```bash
ssh root@<lxc> 'cd /root/luqen && bash install.sh --profile dashboard --with-monitor \
                --non-interactive --admin-user admin --admin-pass changeme123; echo exit=$?'
ssh root@<lxc> 'systemctl is-active luqen-monitor'
```

**Pass criteria:** exit 0; services unchanged (no spurious restart bouncing).

**Maps to:** Phase 40-07 S3 regression guard.

### Tear-down

```bash
pct stop 999 && pct destroy 999
# Then on lxc-claude:
sed -i '/Host lxc-installtest/,/^$/d' ~/.ssh/config 2>/dev/null || true
rm -f /tmp/luqen-install-step-*.log /tmp/luqen-install.*.sh
```

---

## 4. Threat-model sensitive redactions (T-42-16)

When pasting transcript captures into this document, redact the OAuth secret like Phase 40-07 did:

```bash
# Before paste:
ssh root@<lxc> 'cat /opt/luqen/.install-monitor-client' | sed -E 's/(client_secret=).*/\1***REDACTED***/'
```

Same convention applies to journalctl output if it ever surfaces the bearer token — strip with `cut -c1-20` or `***REDACTED***`.

---

## 5. Scenario matrix — to be filled in by operator on LXC run

| # | Scenario | Maps to | Result | Exit | Notes |
|---|----------|---------|--------|------|-------|
| S-INST-04 | `--non-interactive` default | INST-04, INST-01, INST-06 | _pending operator run_ | _ | _ |
| S-INST-02 | `--profile api --api-services compliance,llm` | INST-02 | _pending operator run_ | _ | _ |
| S-INST-03-neg | `--profile cli --with-monitor` | INST-03 (neg) | _pending operator run_ | _ | _ |
| S-INST-03-pos | `--profile dashboard --with-monitor` | INST-03 (pos), INST-06 | _pending operator run_ | _ | _ |
| S-IDEMPOTENT | Repeat S-INST-03-pos | regression (40-07 S3) | _pending operator run_ | _ | _ |

When the operator completes a run, fill in `Result` (PASS/FAIL), `Exit` (0/n), and `Notes`. If FAIL, open a defect cycle entry below.

---

## 6. Defects found and fixed during the dry-run

| Cycle | Commit | Severity | File(s) | Description |
|-------|--------|----------|---------|-------------|
| (pending) | — | — | — | — |

If the operator's LXC run surfaces a regression, file each fix here with the same shape as 40-07-DRYRUN.md "Defects" table.

---

## 7. Plan 42-04 verdict (live-gate-pending)

**Static gate:** ✅ PASS — `bash -n` clean for install.sh + install.command; flag-plumbing audit (§2) confirms every Phase 42 contract appears in source. install.ps1 syntax check deferred to operator (no pwsh on dev box; last green run was Plan 40-07 S15).

**Runtime gate:** ⏳ PENDING OPERATOR — runbook in §3 maps each Phase 42 must-have truth to an executable scenario on a fresh Ubuntu 22.04 LXC. Phase 42 closure does not block on the operator running this now (matches Phase 40 / Plan 40-07 PARTIAL precedent for non-Linux installers); when the operator does run it, paste exit codes + `systemctl is-active` output into §5 and any defects into §6.

**Cross-OS gate:** ⏳ PARTIAL — see `42-UAT-MACOS.md` and `42-UAT-WINDOWS.md` (Plan 42-04 Task 2). Locked user answer #4 accepts PARTIAL on macOS/Windows.

`verdict: STATIC-PASS / RUNTIME-PENDING-OPERATOR`

---

## 8. References

- Phase 40 / Plan 40-07 transcript (model for this doc): `.planning/phases/40-documentation-sweep/40-07-DRYRUN.md`
- LXC provisioning recipe: `~/.claude/projects/-root-luqen/memory/reference_installer_test_lxc.md`
- Phase 42 plans: `42-01-PLAN.md` (install.sh), `42-02-PLAN.md` (install.command + install.ps1), `42-03-PLAN.md` (docker-compose + docs)
- Phase 42 plan summaries: `42-01-SUMMARY.md`, `42-02-SUMMARY.md`, `42-03-SUMMARY.md`
