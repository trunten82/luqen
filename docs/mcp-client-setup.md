# MCP Client Setup (HTTP + OAuth2 Bearer)

> This document covers connecting external MCP clients — Claude Desktop, MCP Inspector, and IDE extensions — to the Luqen dashboard MCP endpoint using OAuth2 client-credentials flow. Requirement: MCPT-05 (Phase 30).

## Overview

The Luqen dashboard exposes a Model Context Protocol (MCP) server at `/api/v1/mcp` over HTTP with Bearer authentication. This allows any MCP-compatible client — Claude Desktop, MCP Inspector, VS Code / Cursor extensions, or custom LLM agents — to invoke dashboard tools (scans, reports, brand scores, user/org/service-connection admin), read URI-addressable resources (`scan://report/{id}`, `brand://score/{siteUrl}`), and render predefined prompts (`/scan`, `/report`, `/fix`).

Related docs:
- `docs/reference/mcp-tools.md` — reference for stdio-based MCP setups on the core/compliance/branding/llm services.
- `.planning/REQUIREMENTS.md` — the MCPT-05 acceptance criterion this document enables.

## Prerequisites

- An OAuth2 client registered in the dashboard (see Step 1).
- The dashboard service running and reachable at a known `host:port` (e.g. `your-dashboard-host:3000`).
- The compliance service running and reachable at a known `host:port` (token issuer — e.g. `your-compliance-host:3001`).
- Node.js 18+ (for MCP Inspector via `npx`).
- Optionally: Claude Desktop, VS Code Claude extension, Cursor, or another MCP-capable client.

## Step 1 — Register an OAuth2 client

1. Log in to the dashboard as an admin.
2. Navigate to `/admin/clients` (inbound OAuth2 clients).
3. Click **New client**. Record the generated `client_id` and `client_secret` (shown once).
4. **Choosing a scope** — the scope decides which tools this client's tokens can invoke:
   - **`read`** — list tools/resources/prompts; invoke read-only tools (`dashboard_list_reports`, `dashboard_get_report`, `dashboard_query_issues`, `dashboard_list_brand_scores`, `dashboard_get_brand_score`, `dashboard_list_users`, `dashboard_list_orgs`, `dashboard_list_service_connections`, `dashboard_get_service_connection`). **Cannot** invoke `dashboard_scan_site` or any state-changing admin tool. **Default for exploration.**
   - **`write`** — everything in `read` PLUS invoke destructive tools like `dashboard_scan_site` and state-changing admin tools (`dashboard_create_user`, `dashboard_update_user`, `dashboard_update_org`, `dashboard_create_service_connection`, `dashboard_update_service_connection`, `dashboard_test_service_connection`). **Required to exercise destructive tools.**
   - **`admin`** — everything in `write` PLUS system-level operations (`dashboard_create_org`, service-connection write paths). **Restricted; request explicitly.**
5. **Org**: assign the client to the org whose data you want the MCP client to access. Per-tool RBAC filters the catalogue based on the caller's role.

> ⚠️ **SECURITY WARNING**: Never paste a real `client_secret` or `Bearer` token into chat with an LLM. Use placeholders (`<YOUR_CLIENT_SECRET>`, `<YOUR_BEARER_TOKEN>`) in any shared docs, logs, or support requests — a leaked secret must be revoked at `/admin/clients` immediately.

Keep the `client_secret` in a secure secret store; never commit it.

## Step 2 — Acquire a Bearer token

OAuth2 tokens are issued by Luqen's **compliance service** (not the dashboard). Exchange your client credentials for a short-lived Bearer token (default 1 hour):

```bash
curl -s -X POST http://your-compliance-host:3001/api/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=client_credentials&client_id=<YOUR_CLIENT_ID>&client_secret=<YOUR_CLIENT_SECRET>&scope=read' \
  | jq -r '.access_token'
```

Save the token as an environment variable:

```bash
export LUQEN_BEARER_TOKEN="<paste the token here>"
```

The token is a JWT (RS256) with an `expires_in` field (typically 3600 seconds). Re-acquire as needed.

## Step 3 — MCP Inspector (recommended first)

MCP Inspector is a browser-based client that lists every tool/resource/prompt and lets you invoke them interactively. Best way to verify connectivity before wiring Claude Desktop.

```bash
npx -y @modelcontextprotocol/inspector \
  --transport http \
  --url http://your-dashboard-host:3000/api/v1/mcp \
  --header "Authorization: Bearer ${LUQEN_BEARER_TOKEN}"
```

Open the URL the Inspector prints (usually `http://localhost:6274`). You should see:
- **Tools** tab: 19 tools (`dashboard_scan_site`, `dashboard_list_reports`, `dashboard_list_users`, `dashboard_list_service_connections`, and the rest).
- **Resources** tab: `scan://report/{id}` and `brand://score/{siteUrl}` URI families.
- **Prompts** tab: `/scan`, `/report`, `/fix`.

Click **Tools → dashboard_list_reports → Invoke**; expect a JSON envelope with a `data` array.

## Step 4 — Claude Desktop

Locate your `claude_desktop_config.json`:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Merge the `luqen-dashboard` entry into the existing `mcpServers` object (do NOT overwrite other servers):

```json
{
  "mcpServers": {
    "luqen-dashboard": {
      "url": "http://your-dashboard-host:3000/api/v1/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer <YOUR_BEARER_TOKEN>"
      }
    }
  }
}
```

Restart Claude Desktop. In a chat, the 🔌 icon should list Luqen tools. Try:

> List the most recent scan reports.

Claude will invoke `dashboard_list_reports` and render the result.

Try the slash-command `/scan`:

> /scan https://example.com WCAG2AA

Claude renders the prompt template, which instructs Claude to call `dashboard_scan_site`.

## Step 5 — IDE extensions (VS Code, Cursor)

VS Code Claude extension and Cursor both read a similar `mcpServers` config block. Use the same `{url, transport, headers}` shape as above. Consult the specific extension's documentation for config file location.

## Security best practices

- NEVER commit Bearer tokens or client secrets to source control.
- Prefer env-var injection where the client supports it (`${LUQEN_BEARER_TOKEN}`).
- Tokens expire in 1 hour by default (check the `expires_in` field in the `/api/v1/oauth/token` response); automate re-acquisition.
- Scope: always `read` (or `mcp.invoke`) for MCP callers. Avoid `admin` scope unless you explicitly need system-wide admin tools.
- If a Bearer leaks, revoke the OAuth2 client at `/admin/clients` immediately; issue a new `client_secret` and rotate.
- Dashboard-level RBAC (org + role + per-tool permissions) filters the catalogue — the token's org_id binds calls to that org's data.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Bearer token required` | Missing `Authorization` header | Add `Authorization: Bearer <token>` |
| `401 Invalid or expired token` | Token expired or wrong signing key | Re-run Step 2 to acquire a fresh token |
| `403 Insufficient scope` | Token scope lacks `read` | Re-register the OAuth2 client with `read` scope |
| Empty tools list | Caller org/role has no matching permissions | Check `/admin/clients` that the client's role has `reports.view`, `branding.view`, and/or the relevant admin permissions |
| Claude Desktop "can't connect" | URL mismatch, dashboard down, or TLS issue | Verify the URL + port; try MCP Inspector first to isolate |
| Tool call returns `isError: true` with `Forbidden` | Caller permission doesn't cover this tool | Widen the role's permissions at `/admin/clients` or use a different client |

## See also

- `docs/reference/mcp-tools.md` — stdio-based setup for core/compliance/branding/llm services.
- `.planning/phases/30-dashboard-mcp-external-clients/30-VERIFICATION.md` — the Phase 30 manual verification checklist.
