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

The `mcp.use` permission is required to connect an MCP client, both for
consent and on every MCP request. `/oauth/authorize` issues a code only to a
user who holds `mcp.use` in the organization the consent screen names (or is
a global administrator). Every request to `/api/v1/mcp` requires `mcp.use`
again, from the user's current permissions in the token's organization: a
request whose user does not hold it there is refused with `403`
`insufficient_scope` (`error_description` `no_mcp_use`). Org admins grant
`mcp.use` from the role editor at `/admin/roles`.

**Consent acts in your organization.** The consent screen names the
organization the dashboard shows for you (the one you switched to, or your
first organization right after sign-in; no organization when you belong to
none), and the token is issued for that organization. When you hold
`mcp.use` in another of your organizations, the screen offers to switch to
it; it lists only organizations you belong to. Consent needs a dashboard
user account: a session without one, such as a sign-in with an API key, is
answered `403` `access_denied` (`error_description`
`dashboard_user_required`).

**The approval is checked against the organization the screen named.** The
screen carries a signed binding of your account and the organization it
names. If the organization you act in has changed when you press Allow (for
example you switched in another tab), the approval is refused with `400`
`invalid_request` (`error_description` `organization_changed`) and nothing is
recorded; open the consent screen again. An approval is remembered for the
organization it was given in and covers only that organization: authorizing
the same client in another organization shows the consent screen again, and
an approval recorded without an organization covers none.

**The stored user answers every request.** Each request to `/api/v1/mcp` is
answered for the stored, active user the token was issued to: the tools and
permissions follow that user's current stored roles in the token's
organization (a role claim inside a token is not read). A token whose user
has been deactivated or removed is refused with `401` `invalid_token`
(`error_description` `inactive_user` or `unknown_user`) on its next use. The
user must also still belong to the token's organization (a member of the
organization or of one of its teams; global administrators are served in
every organization): otherwise the token is refused with `401`
`invalid_token` (`error_description` `not_member`). A user holding no
permission in the token's organization is refused with `403`
`insufficient_scope` (`error_description` `no_permission`). The
dashboard's built-in assistant follows the same stored user: it offers and
runs only the tools the stored user may use in the conversation's
organization, and each tool runs with that user's permissions. The assistant
does not require `mcp.use`.

MCP clients and the assistant act for a dashboard user account. To
authorize a client or use the assistant, sign in with a dashboard user
account (managed at `/admin/dashboard-users`); a sign-in answered by the
compliance service acts for no dashboard user account and can do neither.

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
than on 401. The token endpoint issues tokens only for a user `/api/v1/mcp`
would serve: a refresh or an authorization-code exchange for a user who has
been deactivated or removed, who no longer belongs to the token's
organization, or who no longer holds a permission there (`mcp.use`, or any
permission at all) is answered `400` `invalid_grant`, the same answer as any
other refused grant. A refused refresh changes nothing: the same refresh
token works again once the user's access is restored, within the refresh
chain's 30-day limit. A deleted user's refresh tokens are removed with the
user, so that client must be authorized again. A refresh token is answered
only for the client it was issued to: presented by any other client it is
refused with `400` `invalid_grant` and nothing changes, so the issuing
client's refresh chain keeps working. An authorization code is single-use: a
code whose exchange is refused cannot be exchanged again.

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

**Scan-start limit:** the `dashboard_scan_site` and `dashboard_scan_page` tools draw from the same scan-start limit as the scan form, GraphQL `createScan` and report retry: 30 starts per 10 minutes per user. When the limit is reached the tool returns an error result carrying the shared message (`Scan start limit reached: at most 30 scans per 10 minutes. Try again later.`); retry after the window moves on.

**Per-org client registration (admin):** for service-to-service
integrations that don't go through the user-consent path, register a
client at `/admin/clients` (Inbound OAuth Clients). This is the
client-credentials surface used by sibling services (compliance →
dashboard, etc.). MCP-via-DCR clients also surface here for visibility,
revocation, and audit.

**Audit log coverage:** MCP requests are not written to an audit log one
by one. Some tools record their own entries: queueing a bulk fix writes one
to the audit log (`/admin/audit-log`). The agent audit (`/admin/audit`)
records the dashboard assistant's tool calls, refresh-token reuse (the
token chain is revoked) and refused cross-organization client revocations.
Revoking a client at `/admin/clients` triggers an immediate
`error="invalid_token", error_description="client_revoked"` on the next
MCP call (no waiting for the token TTL).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Bearer token required` | Missing or empty `Authorization` header | Ensure the bridge / IDE actually attached a token; re-run the OAuth flow |
| `401 invalid_token` | Token expired, signature mismatch, or wrong issuer | Refresh; verify `DASHBOARD_PUBLIC_URL` matches the host the client used |
| `401 invalid_token` with `inactive_user` or `unknown_user` | The user the token was issued to has been deactivated or removed | Reactivate the user at `/admin/dashboard-users`, or sign in as an active user and authorize the client again |
| `401 invalid_token` with `not_member` | The user the token was issued to no longer belongs to the token's organization | Add the user back to the organization (or to one of its teams), or authorize the client again from an organization the user belongs to |
| `401 client_revoked` | OAuth client was revoked at `/admin/clients` | Register a fresh client (DCR re-runs automatically on bridge restart) |
| `403 Insufficient scope` | Token issued with `read` but tool requires `write` | Re-consent with `scope=read+write` at `/oauth/authorize` |
| `403 insufficient_scope` with `no_permission` | The user holds no permission in the token's organization | Grant the user a role in that organization (at `/admin/teams` or `/admin/roles`), or authorize against an organization where they hold one |
| `403 insufficient_scope` with `no_mcp_use` | The user does not hold `mcp.use` in the token's organization | Grant `mcp.use` on the user's role in that organization at `/admin/roles` |
| `400 invalid_grant` on refresh | The user was deactivated, left the token's organization, or no longer holds `mcp.use` (or any permission) there; or the user was deleted; or the refresh token was presented by a client it was not issued to | For a deactivated user or one who left the organization or lost a permission: restore the access, then refresh again with the same refresh token. For a deleted user (its refresh tokens are removed with it): authorize the client again. A client presents only the refresh token it received |
| `400 invalid_request` with `organization_changed` at `/oauth/authorize/consent` | The organization the dashboard acts in changed between opening the consent screen and pressing Allow | Open the consent screen again at `/oauth/authorize` and approve there |
| `403 access_denied` with `dashboard_user_required` at `/oauth/authorize` | The session has no dashboard user account (for example an API-key sign-in) | Sign in with a dashboard user account (managed at `/admin/dashboard-users`) |
| Empty tools list | The role's permissions in the token's organization match none of the tools | Verify the role's permissions at `/admin/roles` against the [RBAC matrix](../reference/rbac-matrix.md) |
| `Transport not supported` / SSE-only error | Client speaks pure SSE (deprecated transport) | Upgrade client; use Streamable HTTP — Luqen will not negotiate SSE-only |
| Consent screen says "MCP access required" | Your role does not hold `mcp.use` in the organization the screen names | Switch to an organization the screen offers, or ask an org admin to grant `mcp.use` |
| First-run browser does not open | `mcp-remote` could not bind localhost callback port | Check firewall; try `npx mcp-remote ... --port 7842` |

## See also

- [Agent companion guide](./agent-companion.md) — Luqen's in-dashboard chat agent (uses MCP internally)
- [Multi-step tools guide](./multi-step-tools.md) — how parallel tool dispatch + retry budget look from a client's perspective
- [Multi-org switching](./multi-org-switching.md) — context switching and how the active org affects the MCP catalogue
- [RBAC matrix](../reference/rbac-matrix.md) — permission ↔ tool ↔ route map
- [MCP tools reference](../reference/mcp-tools.md) — service-by-service tool catalogue
