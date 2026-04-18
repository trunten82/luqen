# Phase 30 — External MCP Client Verification (MCPT-05 / SC#4)

**Purpose:** Proof that a developer can connect Claude Desktop to the Luqen dashboard MCP endpoint using standard OAuth2 credentials and successfully call tools, read resources, and invoke prompts.

**Automated prerequisite:** `packages/dashboard/tests/mcp/inspector-smoke.test.ts` passes in CI (Task 1 of plan 30-06).

**Setup reference:** `docs/mcp-client-setup.md` (Task 2 of plan 30-06).

---

## Pre-flight

- [ ] Dashboard service is running on a reachable host:port
- [ ] OAuth2 client registered via `/admin/clients` with `read` scope
- [ ] Bearer token acquired via `curl … /api/v1/oauth/token`
- [ ] `claude_desktop_config.json` merged with the `luqen-dashboard` entry (see `docs/mcp-client-setup.md` Step 4)
- [ ] Claude Desktop restarted

## Checks

### 1. Tools list surfaces all 19 tools
- [ ] Claude Desktop's 🔌 indicator shows `luqen-dashboard` connected
- [ ] Clicking the indicator shows at least: `dashboard_scan_site`, `dashboard_list_reports`, `dashboard_get_report`, `dashboard_query_issues`, `dashboard_list_brand_scores`, `dashboard_get_brand_score`, `dashboard_list_users`, `dashboard_list_orgs`, `dashboard_list_service_connections`
- [ ] Total tool count ≥ 19
- [ ] Transcript or screenshot saved (screenshots optional for public repo per feedback_repo_rules.md)

### 2. Resources list exposes scan:// and brand:// URI families
- [ ] `scan://report/...` URIs visible
- [ ] `brand://score/...` URIs visible
- [ ] Transcript/screenshot saved

### 3. Prompts list shows exactly /scan, /report, /fix
- [ ] Slash-command dropdown shows `/scan`, `/report`, `/fix` (or Claude's equivalent UX)
- [ ] No additional Luqen prompts listed
- [ ] Transcript/screenshot saved

### 4. Invoke a tool from Claude Desktop chat
- [ ] Send prompt: *"List the most recent scan reports."*
- [ ] Claude calls `dashboard_list_reports` (visible in its tool-use trace)
- [ ] Response contains a `data` array (may be empty — that is fine)
- [ ] Transcript saved

### 5a. Read-scope happy path — filtered tool list + prompt render + denial for destructive tool
- [ ] Register a NEW OAuth2 client at `/admin/clients` with **scope=read** (use the dedicated read-only client for this check; do NOT reuse the admin client from Check 1–4)
- [ ] Update `claude_desktop_config.json` to use the read-scope client's Bearer
- [ ] Restart Claude Desktop
- [ ] Confirm `dashboard_scan_site` is FILTERED OUT of the tools list (scope filter from plan 30-01 hides write-tier tools for read-scope callers) — this is the expected security-gate behaviour
- [ ] Invoke `dashboard_list_reports` — confirm it returns data
- [ ] Invoke the `/scan` slash-command with `siteUrl=https://example.com` — confirm the prompt renders the correct chat-message template (system preamble + user task text) even when the caller cannot execute the scan
- [ ] If Claude attempts to invoke `dashboard_scan_site` directly, confirm the server returns a 403 (filter-denied) — NOT a silent success
- [ ] Transcript saved

### 5b. Write-scope happy path — destructive tool visible + invokable with confirmation UI
- [ ] Register a NEW OAuth2 client at `/admin/clients` with **scope=write**
- [ ] Update `claude_desktop_config.json` to use the write-scope client's Bearer
- [ ] Restart Claude Desktop
- [ ] Confirm `dashboard_scan_site` now APPEARS in the tools list
- [ ] Invoke `dashboard_scan_site` with `siteUrl=https://example.com`
- [ ] Confirm Claude Desktop's destructive-confirmation UI fires (per D-03 `destructiveHint: true`) — user must approve before the call proceeds
- [ ] After approval, confirm the response envelope contains `{scanId, status: 'queued', url}` (D-02 async return)
- [ ] Transcript saved

Both 5a AND 5b must be ✓ before SC#4 sign-off.

### 6. Negative — tampered Bearer
- [ ] Edit `claude_desktop_config.json` to use an invalid Bearer (e.g. append "x")
- [ ] Restart Claude Desktop
- [ ] 🔌 indicator shows error / tools unavailable
- [ ] Restore the valid Bearer + restart

## Sign-off

- **Developer:** _______________ (name + date)
- **All checks ✓:** yes / no
- **Notes / issues:** _______________

**Phase 30 SC#4 acceptance requires all checks ✓.**
