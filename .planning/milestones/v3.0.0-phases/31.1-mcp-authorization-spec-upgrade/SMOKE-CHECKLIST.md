# Phase 31.1 — MCP Authorization E2E Smoke Checklist

**Purpose:** Human-loop verification that Claude Desktop (or MCP Inspector) completes the full OAuth 2.1 Authorization Code + PKCE + refresh + revocation lifecycle against a running Luqen dashboard plus the three resource servers (compliance, branding, LLM).

**When to run:** After Waves 1–4 of Phase 31.1 are complete and automated tests are green. This is the final gate before declaring the phase shippable.

**Expected duration:** ~30 minutes on a clean local checkout.

## Prerequisites

- Dashboard host: `http://localhost:3001` (set via `DASHBOARD_PUBLIC_URL`).
- Compliance host: `http://localhost:4100` (`COMPLIANCE_PUBLIC_URL`).
- Branding host: `http://localhost:4200` (`BRANDING_PUBLIC_URL`).
- LLM host: `http://localhost:4300` (`LLM_PUBLIC_URL`).
- A dashboard user you can log in as, with known RBAC (one admin user + one viewer user — confirmed in the `dashboard_users` table).
- Claude Desktop installed on the same machine (macOS 14+ or Linux with the desktop bundle), OR `npx @modelcontextprotocol/inspector` available on PATH.
- A working `pnpm` (for the `pnpm -F @luqen/dashboard dev` style commands below).

---

## Step 1 — Start all four services

```bash
# Terminal 1 — dashboard (also the OAuth Authorization Server)
export DASHBOARD_PUBLIC_URL=http://localhost:3001
export OAUTH_KEY_MAX_AGE_DAYS=90
pnpm -F @luqen/dashboard dev

# Terminal 2 — compliance service (OAuth Resource Server)
export COMPLIANCE_PUBLIC_URL=http://localhost:4100
export DASHBOARD_JWKS_URL=http://localhost:3001/oauth/jwks.json
pnpm -F @luqen/compliance dev

# Terminal 3 — branding service (OAuth Resource Server)
export BRANDING_PUBLIC_URL=http://localhost:4200
export DASHBOARD_JWKS_URL=http://localhost:3001/oauth/jwks.json
pnpm -F @luqen/branding dev

# Terminal 4 — LLM service (OAuth Resource Server)
export LLM_PUBLIC_URL=http://localhost:4300
export DASHBOARD_JWKS_URL=http://localhost:3001/oauth/jwks.json
pnpm -F @luqen/llm dev
```

**Verify discovery endpoints respond:**

```bash
curl -s http://localhost:3001/.well-known/oauth-authorization-server | jq .
# Expect: { "issuer": "http://localhost:3001", "authorization_endpoint": "...", "token_endpoint": "...", ... }

curl -s http://localhost:3001/oauth/jwks.json | jq .
# Expect: { "keys": [ { "kid": "k_...", "kty": "RSA", "alg": "RS256", "use": "sig", ... } ] }

curl -s http://localhost:3001/.well-known/oauth-protected-resource | jq .
curl -s http://localhost:4100/.well-known/oauth-protected-resource | jq .
curl -s http://localhost:4200/.well-known/oauth-protected-resource | jq .
curl -s http://localhost:4300/.well-known/oauth-protected-resource | jq .
# All four: { "resource": "http://localhost:XXXX/api/v1/mcp" (dashboard: /mcp),
#             "authorization_servers": ["http://localhost:3001"], ... }
```

**Pass criteria:**
- [ ] All four servers come up without error.
- [ ] `/.well-known/oauth-authorization-server` returns RFC 8414 metadata.
- [ ] JWKS lists at least one key with `kid`, `kty=RSA`, `alg=RS256`, `use=sig`.
- [ ] All four services publish `/.well-known/oauth-protected-resource` pointing at the dashboard's `authorization_servers`.

---

## Step 2 — Configure Claude Desktop (MCP server)

Open Claude Desktop's settings → MCP Servers (or edit `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS). Add:

```json
{
  "mcpServers": {
    "luqen-dashboard": {
      "url": "http://localhost:3001/mcp",
      "transport": "http"
    }
  }
}
```

Alternative: run MCP Inspector against the dashboard's MCP endpoint:

```bash
npx @modelcontextprotocol/inspector http://localhost:3001/mcp
```

**Pass criteria:**
- [ ] Claude Desktop (or MCP Inspector) shows the `luqen-dashboard` server entry.
- [ ] Client logs indicate it fetched `/.well-known/oauth-protected-resource` and discovered the AS.

---

## Step 3 — Observe the OAuth 2.1 flow from Claude Desktop

Trigger the first-connect handshake — in Claude Desktop, ask it to list tools from `luqen-dashboard`. Expected client behaviour:

1. Fetches `http://localhost:3001/.well-known/oauth-protected-resource` to discover the AS.
2. Fetches `http://localhost:3001/.well-known/oauth-authorization-server` to discover endpoints.
3. POSTs to `/oauth/register` with DCR payload, receives `{ client_id, ... }`.
4. Opens a browser tab to `/oauth/authorize?response_type=code&client_id=<dcr-id>&code_challenge=<pkce-s256>&redirect_uri=<cb>&scope=read+write&resource=http://localhost:3001/mcp`.
5. Luqen renders the consent screen showing: client name, requested scopes (read, write), resource URIs, redirect URI.
6. You log in as the dashboard user (if not already), then click **Allow**.
7. Browser redirects back to Claude Desktop's callback with `?code=…&state=…`.
8. Claude Desktop POSTs `/oauth/token` with `grant_type=authorization_code&code=…&code_verifier=…&redirect_uri=…&client_id=…`.
9. Response: `{ access_token: <JWT>, refresh_token: <opaque>, token_type: "Bearer", expires_in: 3600, scope: "read write" }`.

**Verify the access token:**

Copy the JWT and decode it at https://jwt.io (or `echo "$TOKEN" | cut -d. -f2 | base64 -d | jq .`). Check:

- [ ] `iss` = `http://localhost:3001`
- [ ] `sub` = your user id
- [ ] `aud` = `["http://localhost:3001/mcp"]` (or whatever you requested via `resource=…`)
- [ ] `scopes` = `["read", "write"]` (or as approved)
- [ ] `orgId` = your active session org
- [ ] `exp` = roughly now + 3600s
- [ ] JWT header `kid` matches a `kid` in `/oauth/jwks.json`

**Pass criteria:**
- [ ] Consent screen renders via Luqen's design-system styling.
- [ ] Deny button is present and returns `error=access_denied` to the client when clicked (don't actually click it — verify by inspecting the HTML).
- [ ] After Allow, Claude Desktop reports "connected" status for the server.

---

## Step 4 — MCPAUTH-02: User identity preserved through token

In Claude Desktop, ask it to list available MCP tools from `luqen-dashboard`. Expected:

- A user with admin RBAC (scopes `read write admin.system`) sees the full tool surface including `dashboard_scan_site` (destructive), `dashboard_admin_*`, etc.
- A user with viewer-only RBAC (scope `read`) sees only `.view`-suffix tools (`dashboard_list_reports`, `dashboard_get_report`, etc.) — Phase 30.1 scope-filter invariant.

**How to re-test with a different user:**

Revoke the current DCR client from `/admin/clients` (see Step 9), then re-log in Claude Desktop as the other user. Or use a fresh MCP client instance.

**Pass criteria:**
- [ ] Admin user sees ≥ 1 tool with `destructiveHint: true` (e.g. `dashboard_scan_site`).
- [ ] Viewer user does NOT see any tool that requires `write` or `admin.*` scopes.
- [ ] Tool schemas do NOT contain `orgId` as a parameter (Phase 29 D-13 + D-14 invariant).

---

## Step 5 — Invoke a non-destructive tool

In Claude Desktop, invoke `dashboard_list_reports` (or the closest equivalent read tool — check the tool list). Expect:

- A list of reports returned for the token's `orgId`.
- No reports from other orgs appear (org isolation by token claim, Phase 30.1 RBAC + D-12 org claim).

**Pass criteria:**
- [ ] Tool returns successfully with org-scoped data.
- [ ] No `401`, `403`, or audience-mismatch errors.

---

## Step 6 — Invoke a destructive tool + confirmation UI

In Claude Desktop (as a `write`-scope user), invoke `dashboard_scan_site` with a test URL. Expect:

- Claude Desktop displays its **"Allow tool use?"** confirmation modal (because the tool's `destructiveHint: true` from Phase 30).
- After you click Allow, the scan is initiated and a scan id is returned.

**Pass criteria:**
- [ ] Claude Desktop surfaces the destructive-tool confirmation UI.
- [ ] The tool completes successfully after explicit approval.

---

## Step 7 — Refresh token rotation

Wait until the access token is near expiry (or manually set `exp` = now - 60 via `node -e "..."` in the DB if you want to force it). Trigger another tool call in Claude Desktop. Expect:

- Client notices `401` or `exp < now` and POSTs to `/oauth/token` with `grant_type=refresh_token&refresh_token=…`.
- Response: new `access_token` + **new** `refresh_token`. The OLD refresh token is now marked rotated.
- Tool call retries and succeeds without user re-consent.

**Verify in the DB (optional):**

```bash
sqlite3 dashboard.db "SELECT token_hash, rotated, created_at FROM oauth_refresh_tokens ORDER BY created_at DESC LIMIT 5;"
# Expect: newest row rotated=0, previous row rotated=1.
```

**Pass criteria:**
- [ ] Refresh happens without a browser re-consent roundtrip.
- [ ] DB shows the chain: parent `rotated=1`, child `rotated=0`.

---

## Step 8 — Refresh-reuse detection + audit entry

**Critical security test.** Capture a refresh token BEFORE rotation, then replay it AFTER Claude Desktop has rotated it.

**Procedure:**

1. Use MCP Inspector (not Claude Desktop — Inspector lets you see raw token exchanges) to complete an OAuth handshake.
2. Note the `refresh_token` returned in the first `/oauth/token` response — call this `RAW_A`.
3. Invoke a tool, forcing a refresh. Inspector now has `RAW_B` (which rotated `RAW_A`).
4. Manually replay `RAW_A`:
   ```bash
   curl -v -X POST http://localhost:3001/oauth/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=refresh_token&client_id=<CID>&refresh_token=$RAW_A"
   ```
   Expected: `400 Bad Request` with `{ "error": "invalid_grant" }`.

5. Confirm the audit row was written:
   ```bash
   sqlite3 dashboard.db "SELECT tool_name, outcome, outcome_detail, args_json FROM agent_audit_log WHERE tool_name = 'oauth.refresh_reuse_detected' ORDER BY created_at DESC LIMIT 1;"
   ```
   Expected:
   - `tool_name` = `oauth.refresh_reuse_detected`
   - `outcome` = `error`
   - `outcome_detail` contains `chain_revoked client_id=<CID>`
   - `args_json` contains the client id and revoked chain id

6. Confirm the whole chain was revoked — replay `RAW_B` too:
   ```bash
   curl -v -X POST http://localhost:3001/oauth/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=refresh_token&client_id=<CID>&refresh_token=$RAW_B"
   ```
   Expected: `400 Bad Request` — even the currently-valid child is now dead because the chain is revoked.

**Pass criteria:**
- [ ] Replay of rotated refresh returns `400 invalid_grant`.
- [ ] `agent_audit_log` gains a row with `tool_name='oauth.refresh_reuse_detected'`.
- [ ] Child token `RAW_B` also fails after the chain is revoked (full-chain wipe per D-29).

---

## Step 9 — Admin revoke from /admin/clients

1. Log into the dashboard as admin.
2. Navigate to `/admin/clients` — confirm the DCR'd client from Claude Desktop / Inspector appears with `Kind = DCR`.
3. Click **Revoke** on that row.
4. Back in Claude Desktop, trigger another tool call.

Expected: Claude Desktop's next tool call fails with `401 Unauthorized`. Claude Desktop re-runs the OAuth dance — the old DCR client is gone, so it receives a NEW `client_id` from `/oauth/register` (or prompts to retry).

5. Complete a new OAuth flow. Confirm you now see a NEW consent screen (fresh client = fresh consent, D-19).

**Pass criteria:**
- [ ] DCR'd client row visible at `/admin/clients` with Kind='DCR'.
- [ ] Revoke button works and removes the row.
- [ ] Claude Desktop's in-flight token fails on next use (cached tokens expire via `aud`/signature check — this may take up to 1h if the access token is still cryptographically valid but the refresh token is gone — verify refresh also fails).
- [ ] Re-registration + new consent flow succeeds.

---

## Step 10 — Rotate now + JWKS overlap window

1. Navigate to `/admin/oauth-keys` as admin. Confirm one row with status=Current.
2. Click **Rotate now** and confirm in the browser dialog.
3. Page reloads with toast "Rotated: new kid=k_…, retired=k_…". Table now has two rows:
   - New key: status=Current
   - Old key: status=Retiring (retired_at set)
4. Confirm JWKS publishes both:
   ```bash
   curl -s http://localhost:3001/oauth/jwks.json | jq '.keys | length'
   # Expect: 2
   ```
5. Confirm Claude Desktop's in-flight token (signed with OLD kid) still works — invoke a tool, should succeed (services' JWKS cache still has the old key, or refreshes and gets both).
6. Force a token refresh in Claude Desktop (wait for access-token expiry, or manually invalidate). The new access token's JWT header `kid` should be the NEW kid.

**Confirm the audit row for manual rotation:**
```bash
sqlite3 dashboard.db "SELECT tool_name, outcome, args_json FROM agent_audit_log WHERE tool_name = 'oauth.key_rotated' ORDER BY created_at DESC LIMIT 1;"
# Expect: outcome=success, args_json contains newKid + retiredKid + trigger=manual
```

**Pass criteria:**
- [ ] `/admin/oauth-keys` shows two rows post-rotate (new Current, old Retiring).
- [ ] JWKS response has 2 keys.
- [ ] In-flight token continues to validate (no 401).
- [ ] New token after rotate carries the new `kid`.
- [ ] Audit log row exists for the manual rotation.

---

## Sign-off

| # | Step | Tester verdict |
|---|------|----------------|
| 1 | Services up + discovery endpoints | ☐ pass  ☐ fail  ☐ skipped |
| 2 | Claude Desktop configured | ☐ pass  ☐ fail  ☐ skipped |
| 3 | Full OAuth dance completes (DCR → authorize → token) | ☐ pass  ☐ fail  ☐ skipped |
| 4 | User identity + RBAC preserved (MCPAUTH-02) | ☐ pass  ☐ fail  ☐ skipped |
| 5 | Non-destructive tool works with org isolation | ☐ pass  ☐ fail  ☐ skipped |
| 6 | Destructive tool triggers confirmation UI | ☐ pass  ☐ fail  ☐ skipped |
| 7 | Refresh-token rotation (invisible to user) | ☐ pass  ☐ fail  ☐ skipped |
| 8 | Reuse detection + oauth.refresh_reuse_detected audit | ☐ pass  ☐ fail  ☐ skipped |
| 9 | /admin/clients DCR revoke kills the session | ☐ pass  ☐ fail  ☐ skipped |
| 10 | /admin/oauth-keys Rotate now + JWKS overlap | ☐ pass  ☐ fail  ☐ skipped |

**Tester:** _____________  **Date:** _____________  **Dashboard commit SHA:** _____________

---

## Failure handling

If any step fails, reply with:

- `"smoke failed: <step-N> <one-line description>"` — the plan author will open a gap plan via `/gsd-plan-phase 31.1 --gaps`.
- `"partial: steps 1-7 passed; 8-10 skipped due to <reason>"` — partial sign-off is acceptable for the first pass; skipped steps get documented in 31.1-04-SUMMARY.md for follow-up.

If all 10 steps are green, reply with `"smoke passed"` to close the gate.
