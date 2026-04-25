# MCP Integration Guide

> Connect Claude Desktop, your IDE, or a custom client to Luqen's MCP server.

This guide supersedes the legacy `docs/mcp-client-setup.md` and
`docs/mcp-external-client-walkthrough.md` — both now redirect here.

## What is MCP in Luqen?

[Model Context Protocol](https://modelcontextprotocol.io) (MCP) lets an LLM
client (Claude Desktop, an IDE, or a custom agent) call structured tools and
read URI-addressable resources hosted by another service.

Luqen exposes MCP on every service (compliance, branding, llm, dashboard)
under the path `/api/v1/mcp`. The dashboard catalogue is the largest and the
one most external clients will use first.

A few facts that drive everything else in this guide:

- **Transport: Streamable HTTP only.** A single `POST /api/v1/mcp` per
  JSON-RPC message; the response is SSE-framed when the server streams.
  Pure SSE-only transports are deprecated and rejected.
- **Embedded as a Fastify plugin** under each service — there is no
  separate "mcp" daemon. The plugin shares the host service's auth, RBAC,
  and audit log.
- **Auth is OAuth 2.1 Bearer.** The dashboard MCP endpoint is *Bearer-only*
  — cookie sessions are explicitly rejected even when present.

## For end users

### Claude Desktop setup

Locate `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Merge the `luqen-dashboard` entry under `mcpServers` (do **not** overwrite
existing entries):

```json
{
  "mcpServers": {
    "luqen-dashboard": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<luqen-host>/api/v1/mcp"
      ]
    }
  }
}
```

On Windows, prepend `"command": "cmd"` and `"/c", "npx"` because Claude
Desktop runs through `cmd.exe`. On HTTP-only dev hosts add `--allow-http`
to `args`.

`mcp-remote` is a stdio↔HTTP bridge. Claude Desktop currently speaks stdio;
the bridge converts that to Luqen's Streamable HTTP transport.

#### First-run OAuth flow

The first time Claude Desktop reaches Luqen it has no token. `mcp-remote`
performs an OAuth 2.1 + PKCE + DCR exchange transparently:

1. The bridge calls `POST /oauth/register` (Dynamic Client Registration —
   see admin section below) and receives a `client_id`.
2. Your default browser opens at
   `https://<luqen-host>/oauth/authorize?...` with a PKCE
   `code_challenge`. Sign in if needed and approve the consent screen.
3. The browser redirects back to a localhost listener; the bridge exchanges
   the authorization code at `/oauth/token` (sending the PKCE
   `code_verifier`) for an access token + refresh token.
4. Tokens are cached on disk under `~/.mcp-auth/` and reused on subsequent
   launches.

In Claude's chat, the plug indicator (🔌) should now list Luqen tools.
Try: *"List the most recent scan reports."*

If your tools list is empty, see [Troubleshooting](#troubleshooting).

### IDE setup

Most MCP-capable IDE extensions reuse the same `mcpServers` config shape
as Claude Desktop. Drop the same entry into the relevant config file:

- **VS Code MCP extension** — settings JSON, key `mcp.servers`:

  ```json
  "mcp.servers": {
    "luqen-dashboard": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<luqen-host>/api/v1/mcp"]
    }
  }
  ```

- **JetBrains (IntelliJ / WebStorm) MCP plugin** — `Settings → Tools → MCP →
  Servers`. Add a new HTTP server with URL
  `https://<luqen-host>/api/v1/mcp`. The plugin handles OAuth itself; you
  do not need `mcp-remote` because JetBrains speaks Streamable HTTP
  directly.

- **Cursor / Windsurf** — both honour the Claude Desktop config shape
  above. Cursor reads `~/.cursor/mcp.json`; Windsurf reads
  `~/.codeium/windsurf/mcp_config.json`. Use the same `command` / `args`
  block.

For any client that speaks Streamable HTTP natively (no stdio), point it
straight at `https://<luqen-host>/api/v1/mcp` and let it run the OAuth
dance against `/oauth/authorize`, `/oauth/token`, `/oauth/register`.

### Custom client setup

A custom MCP client must implement, at minimum:

- **OAuth 2.1 Authorization Code with PKCE.** No `client_credentials` for
  user-bound contexts (the dashboard rejects it). Discover endpoints from
  `https://<luqen-host>/.well-known/oauth-authorization-server`.
- **Dynamic Client Registration** at `POST /oauth/register` — submit
  `client_metadata` with at least `redirect_uris` (your localhost callback)
  and `token_endpoint_auth_method: "none"` for public clients.
- **Streamable HTTP transport.** Single `POST` per JSON-RPC envelope to
  `/api/v1/mcp`; on streaming responses parse SSE frames
  (`event: message\ndata: <json>\n\n`).
- **Bearer token** in `Authorization: Bearer <token>` on every MCP
  request. Refresh proactively before `expires_in` elapses.

The wire shape and tool schemas are mirrored in the JSON snapshot at
[`docs/reference/openapi/mcp.json`](../reference/openapi/mcp.json) (when
generated) — and the live `/docs` endpoint per service surfaces the same
spec.

## For admins

### OAuth 2.1 + PKCE + DCR walkthrough

Luqen ships an OAuth 2.1 Authorization Server on the dashboard with the
following endpoints (all under the dashboard host, root-relative — *not*
under `/api/v1/`):

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-authorization-server` | Issuer metadata for client discovery |
| `GET /.well-known/oauth-protected-resource` | Resource-server metadata advertised in `WWW-Authenticate` on 401 |
| `POST /oauth/register` | Dynamic Client Registration (open, rate-limited) |
| `GET /oauth/authorize` | Authorization Code + PKCE entry point (renders consent UI) |
| `POST /oauth/token` | Token endpoint — Authorization Code grant only |

**PKCE is mandatory.** Clients generate a high-entropy `code_verifier`
(43–128 chars), derive `code_challenge = BASE64URL(SHA256(code_verifier))`,
and pass `code_challenge` + `code_challenge_method=S256` to
`/oauth/authorize`. The verifier is presented at `/oauth/token`. There is
no fallback to `plain` and no path that accepts a missing challenge.

**Scope tiers:**

| Scope | What it grants |
|---|---|
| `read` | List tools/resources/prompts; invoke read-only tools (`dashboard_list_reports`, `dashboard_get_report`, `dashboard_query_issues`, `dashboard_list_brand_scores`, etc.) |
| `write` | Everything in `read` plus state-changing tools (`dashboard_scan_site`, `dashboard_create_user`, `dashboard_update_org`, …) |

The advertised set is `["read", "write"]` (see
`/.well-known/oauth-authorization-server` →`scopes_supported`). Per-tool
RBAC further filters the catalogue: a token's effective tools are the
**intersection** of its OAuth scope and the user's RBAC permissions in
the active org. See the [RBAC matrix](../reference/rbac-matrix.md) for the
full mapping.

The `mcp.use` permission gates *consent itself* — `/oauth/authorize`
refuses to issue a code unless the consenting user has `mcp.use` in the
active org (or `admin.system`). Org admins grant `mcp.use` from the role
editor at `/admin/roles`.

**Dynamic Client Registration via `POST /oauth/register`:** open endpoint,
rate-limited per IP. The client posts `client_metadata`:

```json
{
  "client_name": "Claude Desktop",
  "redirect_uris": ["http://localhost:7842/callback"],
  "token_endpoint_auth_method": "none",
  "scope": "read"
}
```

The response includes `client_id` and (for confidential clients)
`client_secret`. No admin approval is required for registration — the
*authorization* step at `/oauth/authorize` is where consent and `mcp.use`
are enforced.

**Token lifetime + refresh:** access tokens are short-lived (typically
1 hour — verify with `expires_in` in the `/oauth/token` response). Refresh
tokens rotate on every refresh. Clients should refresh proactively rather
than on 401.

### Server-side configuration

MCP relevant environment variables (full inventory in
[`installer-env-vars.md`](../reference/installer-env-vars.md) once
generated):

- `DASHBOARD_PUBLIC_URL` — the issuer URL emitted in well-known metadata
  and used as the resource indicator. Must match the host clients connect
  to.
- `OAUTH_JWT_PRIVATE_KEY` / `OAUTH_JWT_PUBLIC_KEY` — RS256 keypair shared
  across the cluster; rotation requires coordinated key rollover.
- `OAUTH_DCR_RATE_LIMIT_PER_MIN` — per-IP rate limit on
  `POST /oauth/register` (default sensible; tighten on public-internet
  deployments).

**Per-org client registration (admin):** for service-to-service
integrations that don't go through the user-consent path, register a
client at `/admin/clients` (Inbound OAuth Clients). This is the
client-credentials surface used by sibling services (compliance →
dashboard, etc.). MCP-via-DCR clients also surface here for visibility,
revocation, and audit.

**Audit log coverage:** every MCP request is logged. The dashboard surface
is `/admin/audit` — filter by `actor.type = oauth_client` for MCP traffic.
Revoking a client at `/admin/clients` triggers an immediate
`error="invalid_token", error_description="client_revoked"` on the next
MCP call (no waiting for the token TTL).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Bearer token required` | Missing or empty `Authorization` header | Ensure the bridge / IDE actually attached a token; re-run the OAuth flow |
| `401 invalid_token` | Token expired, signature mismatch, or wrong issuer | Refresh; verify `DASHBOARD_PUBLIC_URL` matches the host the client used |
| `401 client_revoked` | OAuth client was revoked at `/admin/clients` | Register a fresh client (DCR re-runs automatically on bridge restart) |
| `403 Insufficient scope` | Token issued with `read` but tool requires `write` | Re-consent with `scope=read+write` at `/oauth/authorize` |
| Empty tools list | Caller has no `mcp.use` permission in the active org, or RBAC filters every tool | Grant `mcp.use` at `/admin/roles`; verify role permissions |
| `Transport not supported` / SSE-only error | Client speaks pure SSE (deprecated transport) | Upgrade client; use Streamable HTTP — Luqen will not negotiate SSE-only |
| Consent screen says "MCP access not enabled for your org" | Active org lacks `mcp.use` for your role | Org admin must grant `mcp.use` |
| First-run browser does not open | `mcp-remote` could not bind localhost callback port | Check firewall; try `npx mcp-remote ... --port 7842` |

## See also

- [Agent companion guide](./agent-companion.md) — Luqen's in-dashboard chat agent (uses MCP internally)
- [Multi-step tools guide](./multi-step-tools.md) — how parallel tool dispatch + retry budget look from a client's perspective
- [Multi-org switching](./multi-org-switching.md) — context switching and how the active org affects the MCP catalogue
- [RBAC matrix](../reference/rbac-matrix.md) — permission ↔ tool ↔ route map
- [MCP tools reference](../reference/mcp-tools.md) — service-by-service tool catalogue
