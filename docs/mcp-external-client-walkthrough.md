# MCP External-Client Walkthrough

> Hands-on, step-by-step guide for manually verifying the Luqen dashboard MCP endpoint against a real external client (Claude Desktop, MCP Inspector, or an IDE extension). This is the companion test procedure to `docs/mcp-client-setup.md` and the Phase 30 SC#4 acceptance checklist at `.planning/phases/30-dashboard-mcp-external-clients/30-VERIFICATION.md`.
>
> **When to run this:** after every deploy that touches `packages/dashboard/src/mcp/` or `packages/core/src/mcp/*`, or whenever a bug is suspected in the external-client integration (string/number coercion, scope filtering, prompt rendering, etc.).

## At a glance

```
┌────────────┐   JSON-RPC   ┌──────────────────┐   HTTP   ┌──────────────────┐
│ Claude     │  via stdio   │ mcp-remote       │  Bearer  │ Luqen dashboard  │
│ Desktop    │ ───────────▶ │ (local bridge)   │ ───────▶ │ /api/v1/mcp      │
└────────────┘              └──────────────────┘          └──────────────────┘
```

- **Bridge:** `mcp-remote` (stdio ↔ HTTP) — needed because Claude Desktop for Windows/macOS speaks stdio, not Streamable HTTP.
- **Transport:** Streamable HTTP — a single `POST /api/v1/mcp` per JSON-RPC message; SSE response when the server streams.
- **Auth:** RS256 JWT Bearer (issued by `compliance` service). Scope claims gate the tool catalogue.

## Prerequisites

| Requirement | How to confirm |
|---|---|
| Dashboard `HEAD` includes MCP fix `6e522af` (`z.coerce.number()` on numeric tool args) | `ssh lxc-luqen 'cd /root/luqen && git log --oneline -5'` |
| Dashboard service active + rebuilt | `ssh lxc-luqen 'systemctl is-active luqen-dashboard && curl -s http://localhost:5000/health'` |
| Compliance service active (token issuer) | `ssh lxc-luqen 'systemctl is-active luqen-compliance'` |
| OAuth2 clients registered (`read`, `write` — separate clients, see Step 1) | `/admin/clients` on the dashboard |
| Claude Desktop installed (or MCP Inspector via `npx`) | — |
| `claude_desktop_config.json` merged with `luqen-dashboard` entry | See Step 2 |

## Step 1 — Register the OAuth2 clients

You need **two** clients for a complete walkthrough:

1. **`luqen-mcp-read`** — scope `read`. Used for Checks 1–4 and 5a (filtered-catalogue path).
2. **`luqen-mcp-write`** — scope `write`. Used for Check 5b (destructive-tool path, confirmation UI).

Register both at `/admin/clients` → **New client**. Record each `client_id` / `client_secret` in a password manager; the secret is displayed only once.

> ⚠️ **Never paste real `client_secret` or Bearer values into chat.** Use placeholders in any docs or logs.

## Step 2 — Acquire a Bearer token

```bash
# Read-scope token
curl -s -X POST http://<compliance-host>:3001/api/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=client_credentials&client_id=<READ_CLIENT_ID>&client_secret=<READ_CLIENT_SECRET>&scope=read' \
  | jq -r '.access_token'
```

Tokens are valid for ~1 hour. Re-run this command and update `claude_desktop_config.json` whenever the token expires (Claude Desktop will fail silently — see Troubleshooting).

## Step 3 — Configure Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Merge the following entry under `mcpServers` (keep any existing entries — do not replace the file):

```json
{
  "mcpServers": {
    "luqen-dashboard": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "mcp-remote",
        "http://<dashboard-host>:5000/api/v1/mcp",
        "--allow-http",
        "--header",
        "Authorization: Bearer <YOUR_BEARER_TOKEN>"
      ]
    }
  }
}
```

Notes:
- `cmd /c` is Windows-specific. On macOS/Linux drop `"command": "cmd"` and the `/c` arg — run `npx` directly.
- `--allow-http` is required for plain-HTTP dashboards. Remove it when you're behind HTTPS.
- Restart Claude Desktop after every config edit.

## The 7 checks

Each check is a self-contained test. Run them sequentially — if one fails, stop and troubleshoot before moving on.

Tick each box in `.planning/phases/30-dashboard-mcp-external-clients/30-VERIFICATION.md` as you go. That file is the permanent acceptance record for Phase 30 SC#4.

---

### Check 1 — tools/list surfaces all 19 tools

**Goal:** The dashboard advertises the full tool catalogue to external clients.

**Steps:**
1. In Claude Desktop, click the 🔌 (plug) indicator in the chat input.
2. Expand **luqen-dashboard**.

**Expected:** ≥ 19 tools listed. Minimum required names (spot-check these):

```
dashboard_scan_site         dashboard_list_users
dashboard_list_reports      dashboard_list_orgs
dashboard_get_report        dashboard_list_service_connections
dashboard_query_issues      dashboard_get_service_connection
dashboard_list_brand_scores dashboard_create_user
dashboard_get_brand_score   dashboard_update_user
                            dashboard_update_org
                            dashboard_create_service_connection
                            dashboard_update_service_connection
                            dashboard_test_service_connection
                            dashboard_create_org
```

**Red flags:**
- Tool count < 19 → scope filter is too aggressive, or `registerDataTools` / `registerAdminTools` registration order broke. Check `packages/dashboard/src/mcp/index.ts`.
- Plug indicator never turns green → Bearer expired or wrong; see Troubleshooting.

---

### Check 2 — resources/templates/list exposes `scan://` and `brand://` URI families

**Goal:** External clients can address reports and brand scores by URI.

**Steps:**
1. In Claude Desktop, use the chat prompt: *"What MCP resources are available from luqen-dashboard?"*
2. Claude will call `resources/templates/list`.

**Expected:** Two ResourceTemplates visible:
- `scan://report/{scanId}` — description mentions "scan report"
- `brand://score/{siteUrl}` — description mentions "brand score"

**Red flags:**
- Only one template → the second registration in `packages/dashboard/src/mcp/resources.ts` silently failed. Check server logs.
- Empty list → resources feature not registered at all. See commit `c9cc108`.

---

### Check 3 — prompts/list returns exactly `/scan`, `/report`, `/fix`

**Goal:** Predefined prompts are registered and discoverable.

**Steps:**
1. In Claude Desktop, type `/` in the chat input.
2. Look for the slash-command dropdown. Luqen prompts appear as `luqen-dashboard:scan`, `luqen-dashboard:report`, `luqen-dashboard:fix` (or Claude's equivalent namespacing).

**Expected:** Exactly 3 Luqen prompts (not 2, not 4+).

**Red flags:**
- Extra prompts → stale prompt registration leaked. Check `packages/dashboard/src/mcp/prompts.ts`.
- Missing prompts → Phase 30-05 commits not deployed; grep for `registerPrompts`.

---

### Check 4 — Invoke `dashboard_list_reports` and validate the coercion fix (CRITICAL)

**Goal:** Confirm the `limit` parameter fix (commit `6e522af`) works end-to-end. This is the specific regression-prevention test for the MCP limit-coercion bug.

**Steps:**

**4a. No-filter call — baseline:**

In Claude Desktop, send:
> "List the 10 most recent scan reports for my org."

**Expected:**
- Claude's tool-use trace shows a call to `dashboard_list_reports` with `{ "limit": 10 }` (or `"10"` — either must work).
- Response envelope contains `{ data: [...], meta: { count: <= 10 } }`.
- **No** `type validation error: expected number, received string` anywhere in the trace.

**4b. String-limit explicit test:**

In Claude Desktop, send:
> "Call dashboard_list_reports with limit set to the string "5". Show me the raw response."

**Expected:** Tool call succeeds. Server has coerced `"5"` → `5`. Response envelope valid.

**4c. Out-of-bounds test (guardrail):**

> "Call dashboard_list_reports with limit 9999."

**Expected:** Tool call fails with Zod's `max 200` message (NOT with a type error). Coercion preserved the upper bound.

**Red flags:**
- Any call fails with `expected number, received string` → fix `6e522af` is not deployed. Verify `ssh lxc-luqen 'cd /root/luqen && git log --oneline | grep "coerce numeric"'` returns a match, then rebuild + restart.
- Response > 1MB and Claude truncates → page size guard is working but downstream payload is still too big; see follow-up note below.

> **Note:** a completed scan report can exceed 1MB on its own. The `limit` param caps the number of scan *records* returned by `listScans`, not their serialised size. If a single record is > 1MB the bug is elsewhere (usually an inline `json_report` blob in `scan_records`).

---

### Check 5a — Read-scope: filtered catalogue + prompt renders + destructive tool denied

**Goal:** Scope filtering hides write-tier tools from read-scope callers; prompts still render.

**Steps:**
1. Ensure `claude_desktop_config.json` uses the **read-scope** Bearer (`luqen-mcp-read` client).
2. Restart Claude Desktop.
3. Open the tools list. Confirm `dashboard_scan_site` is **filtered out** (the only destructive tool in the data-tools set).
4. Invoke `dashboard_list_reports` (read-only) — must succeed.
5. In the slash-command dropdown, pick `/scan` with argument `siteUrl=https://example.com`.
6. If Claude attempts to call `dashboard_scan_site` despite it being filtered, confirm the server returns **403**, not 200.

**Expected:**
- `dashboard_scan_site` absent from the tools list.
- `/scan` prompt still renders the chat-message template (system preamble + user task). Rendering a prompt does NOT require write scope.
- Any forced direct call to `dashboard_scan_site` returns 403.

---

### Check 5b — Write-scope: destructive tool visible + confirmation UI fires

**Goal:** Write-scope callers see destructive tools, and the client shows a confirmation dialog before invocation.

**Steps:**
1. Swap Bearer to the **write-scope** token (`luqen-mcp-write` client).
2. Restart Claude Desktop.
3. Confirm `dashboard_scan_site` now appears in the tools list.
4. Ask Claude: *"Start a scan of https://example.com."*
5. When Claude proposes the tool call, Claude Desktop should display a **confirmation prompt** (because the tool carries `destructiveHint: true`).
6. Approve. The tool returns `{ scanId, status: "queued", url }`.

**Expected:**
- Destructive-confirmation UI visible before the call runs.
- Response envelope contains `scanId` (UUID) and `status: "queued"`.
- Scan appears in the dashboard's Scans list within ~5 seconds (status may be `queued` → `running` → `completed`).

---

### Check 6 — Tampered Bearer is rejected

**Goal:** RS256 signature verification blocks forged tokens.

**Steps:**
1. Copy the current Bearer, change any single character in the signature segment (last dot-separated part).
2. Update `claude_desktop_config.json` with the tampered token.
3. Restart Claude Desktop.
4. Click the plug indicator.

**Expected:** Connection fails. The dashboard returns 401 (visible in `ssh lxc-luqen 'journalctl -u luqen-dashboard --since "2 minutes ago" | grep mcp'`).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Plug indicator stays grey | Bearer expired (default 1h) | Re-run Step 2; paste new token into config; restart Claude Desktop |
| 401 on every call | Clock skew between client and server > 5 min | Sync system clock; reissue token |
| 401 after clock sync | Token issued for wrong scope or wrong org | Re-register client with correct scope; reissue token |
| 403 on a tool you expect to work | Scope filter hiding it; or per-tool RBAC | Check effective permissions at `/admin/users/<you>`; bump client scope if needed |
| `expected number, received string` | Fix `6e522af` not deployed | See Check 4 red flags |
| Response truncated at 1MB | Claude Desktop / mcp-remote payload cap | Page with `limit` param; use a narrower tool (e.g. `dashboard_get_report`) |
| `/scan` prompt missing from dropdown | Prompts registration silently failed | Restart dashboard; check `packages/dashboard/src/mcp/prompts.ts` import order |
| Slow first response (~10s) | `npx -y mcp-remote` downloading the bridge on first run | Subsequent runs are fast — one-time download |
| Tool count = 6 instead of 19 | Admin tools not registered (30-03 not deployed) | Verify `registerAdminTools` is called in `packages/dashboard/src/mcp/index.ts` |

## Sign-off

When all 7 checks pass, tick every box in `.planning/phases/30-dashboard-mcp-external-clients/30-VERIFICATION.md` and record:

- Date of walkthrough
- Tester (GitHub handle or name)
- Git SHA of the build tested (`ssh lxc-luqen 'cd /root/luqen && git rev-parse HEAD'`)
- Claude Desktop version
- Any deviations or environment-specific notes

That verification file — not this walkthrough doc — is the permanent phase acceptance record.

## Related docs

- `docs/mcp-client-setup.md` — pure setup reference (no walkthrough).
- `docs/reference/mcp-tools.md` — stdio-based MCP setups for core / compliance / branding / llm.
- `.planning/phases/30-dashboard-mcp-external-clients/30-VERIFICATION.md` — the sign-off checklist this walkthrough drives.
- `packages/dashboard/tests/mcp/inspector-smoke.test.ts` — the automated counterpart (CI-gated; uses MCP Inspector CLI).
