# Phase 42 — Windows UAT Checklist (`install.ps1`)

**Status:** PARTIAL acceptance per locked user answer #4 (verification budget = Phase 40 precedent). **Operator-run on a real Windows host.** Phase 42 closes without this completed; this document is the evidence pointer for INST-05 (install.ps1 parity) and INST-03 / INST-06 (cross-OS) PARTIAL verdicts.

**Why PARTIAL:** No Windows host is available to claude-code. Static review of `install.ps1` is green:
- `pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content install.ps1 -Raw)) | Out-Null"` — last green run captured in Plan 40-07 S15 (after fix `4ad69ef` for the `${hint}:` parser bug)
- Phase 42's install.ps1 rewrite (commits `35aa38a`, `368eb2f`) re-confirmed during 42-02 plan execution
- `Get-Content install.ps1 -Raw` is a 1k+ line file with the 4-profile menu (lines 427-440), the `-WithMonitor requires compliance` guard (line 321-323), and the `dashboard.config.json` parity fix (lines 1017-1029)

**Phase 40 precedent:** `40-07-DRYRUN.md` S17 marked "❌ NOT TESTABLE — No Windows host". Phase 42 inherits the same constraint and the same PARTIAL acceptance.

---

## Pre-flight (operator)

- Windows 10 21H2+ or Windows 11 / Windows Server 2019+
- PowerShell 5.1 or PowerShell 7.x — installer auto-detects (`pwsh` preferred)
- NSSM 2.24+ on PATH (`nssm --version`)
- Node.js 20.x LTS (`node --version`)
- `git` and an internet connection
- Local administrator rights (NSSM service registration requires it)

---

## Test plan

### TC-1 — Static parse on the Windows host

Before running anything, sanity-check the script parses on the target:

```powershell
pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content .\install.ps1 -Raw)) | Out-Null; Write-Host 'OK'"
```

**Expected:** prints `OK`, exits 0.

**Outcome:** _pending operator run_

---

### TC-2 — Clone repo + checkout master

```powershell
git clone https://github.com/tphsoftware/luqen-platform.git
cd luqen-platform
git checkout master
git rev-parse --short HEAD
```

**Expected:** clone succeeds; HEAD on master with Phase 42 commits.

**Outcome:** _pending operator run_

---

### TC-3 — Interactive 4-profile wizard

Run without `-NonInteractive`:

```powershell
pwsh .\install.ps1
```

**Expected — wizard prompts:**
- 4-profile menu, mirroring install.sh:
  1. Scanner CLI
  2. API services (headless)
  3. Self-hosted dashboard (default)
  4. Docker Compose
- After profile 3 selection: monitor agent opt-in prompt
- All 5 components named explicitly: **compliance, branding, llm, dashboard, monitor** — closes the pre-existing v2-era bug where `install.ps1` never named branding or LLM at all (per 42-CONTEXT)

Cancel out (Ctrl+C) after confirming the menu.

**Outcome:** _pending operator run_

---

### TC-4 — Non-interactive dashboard + monitor

```powershell
pwsh .\install.ps1 -Profile dashboard -WithMonitor `
                  -NonInteractive -AdminUser admin -AdminPass changeme123
```

**Expected:**
- exit code 0
- Install dir at `C:\Program Files\Luqen` (or `$env:USERPROFILE\.luqen` for non-admin)
- 5 NSSM services registered:

```powershell
Get-Service Luqen* | Format-Table Name, Status, StartType
```

Should list: `LuqenCompliance`, `LuqenBranding`, `LuqenLlm`, `LuqenDashboard`, `LuqenMonitor` — all `Running`, `Automatic`.

**Outcome:** _pending operator run_

---

### TC-5 — Monitor bound to port 4300 (locked answer #1)

```powershell
Test-NetConnection -ComputerName localhost -Port 4300
Test-NetConnection -ComputerName localhost -Port 4200   # llm — separate process
```

**Expected:**
- `:4300` `TcpTestSucceeded : True`
- `:4200` also `True` (llm), but verify the listening process on 4200 is **not** the monitor.

```powershell
Get-NetTCPConnection -LocalPort 4300 | Select-Object OwningProcess
Get-Process -Id (Get-NetTCPConnection -LocalPort 4300).OwningProcess | Select-Object Name, Path
```

The path should reference `packages\monitor` (or the equivalent NSSM-wrapped node process).

**Outcome:** _pending operator run_

---

### TC-6 — `dashboard.config.json` parity (closes pre-existing bug)

```powershell
Get-Content "$env:ProgramFiles\Luqen\dashboard.config.json" | ConvertFrom-Json |
  Select-Object brandingUrl, brandingClientId, brandingClientSecret, llmUrl, llmClientId, llmClientSecret
```

**Expected:** all 6 fields populated (non-empty strings). This is the parity bug install.ps1 line 1017-1029 fixed during Phase 42 — pre-Phase-42 builds wrote only the compliance fields.

**Outcome:** _pending operator run_

---

### TC-7 — Health endpoints reachable

```powershell
foreach ($p in 4000,4100,4200,5000,4300) {
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:$p/api/v1/health" -TimeoutSec 5
    Write-Host "$p OK $($r.status)"
  } catch {
    # /health (not /api/v1/health) for dashboard + monitor
    try {
      $r = Invoke-RestMethod -Uri "http://localhost:$p/health" -TimeoutSec 5
      Write-Host "$p OK $($r.status) (root /health)"
    } catch { Write-Host "$p FAIL $($_.Exception.Message)" }
  }
}
```

**Expected:** all 5 ports report `OK ok`.

**Outcome:** _pending operator run_

---

### TC-8 — `-WithMonitor` without compliance rejected (T-42-06)

```powershell
pwsh .\install.ps1 -Profile cli -WithMonitor
$LASTEXITCODE
```

**Expected:** non-zero exit; stderr/stdout contains `requires compliance` (per `install.ps1:321-323`).

**Outcome:** _pending operator run_

---

### TC-9 — Subset profile (`-Profile api -ApiServices compliance,llm`)

```powershell
pwsh .\install.ps1 -Uninstall
pwsh .\install.ps1 -Profile api -ApiServices "compliance,llm" `
                  -NonInteractive -AdminUser admin -AdminPass changeme123
Get-Service Luqen* | Format-Table Name, Status
```

**Expected:** exactly 2 services — `LuqenCompliance`, `LuqenLlm`. No branding, dashboard, or monitor.

**Outcome:** _pending operator run_

---

### TC-10 — `-ApiServices` token allow-list (T-42-08 mitigation)

```powershell
pwsh .\install.ps1 -Profile api -ApiServices "compliance;rm -rf /" -NonInteractive
$LASTEXITCODE
```

**Expected:** non-zero exit, error message naming the rejected token. Does NOT execute the injected payload (the `-ApiServices` parameter is per-token allow-listed against `compliance|branding|llm` per install.ps1:281-283).

**Outcome:** _pending operator run_

---

### TC-11 — Uninstall removes LuqenMonitor

After TC-4 succeeded:

```powershell
pwsh .\install.ps1 -Uninstall
Get-Service Luqen* -ErrorAction SilentlyContinue
```

**Expected:** all 5 services gone; cmdlet returns nothing or "Cannot find any service…" errors per name.

**Outcome:** _pending operator run_

---

## Threat-model redactions (T-42-16)

When pasting any output containing OAuth bearer secrets, redact:

```powershell
(Get-Content "$env:ProgramFiles\Luqen\.install-monitor-client") -replace '(client_secret=).*', '$1***REDACTED***'
```

---

## Operator sign-off

```
Operator: _________________
Windows version: ___________
PowerShell version: ________
NSSM version: _____________
Date (ISO): _______________
TC-1 .. TC-11 results: ____  (PASS/FAIL/SKIP per row)
Defects (if any): list commits or issue links
Verdict: PARTIAL-COMPLETE | PARTIAL-WITH-DEFECTS | FAIL
```

---

## References

- `install.ps1` source: `/root/luqen/install.ps1`
- 4-profile menu: `install.ps1:427-440`
- `-WithMonitor requires compliance` guard: `install.ps1:321-323`
- `-ApiServices` token allow-list (T-42-08): `install.ps1:281-283`
- `dashboard.config.json` parity fix: `install.ps1:1017-1029`
- Phase 40 precedent (no Windows host): `.planning/phases/40-documentation-sweep/40-07-DRYRUN.md` S17
- Phase 42 plan: `42-02-PLAN.md` Task 2
- Phase 42 plan summary: `42-02-SUMMARY.md`
