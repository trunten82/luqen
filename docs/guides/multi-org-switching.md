# Multi-Org Context Switching

> Drive the agent against any of your orgs from a single browser session, with
> each turn cleanly attributed to the active org.

This guide covers the multi-org agent surface introduced in Phase 38 (requirements
AORG-01..AORG-04). It builds on the persistent history from Phase 35, the per-turn
tool dispatcher from Phase 36, and the drawer header from Phase 37.

## For end users

### When this is for you

- Every Luqen user belongs to one or more **organizations** (orgs). For most users
  there is exactly one — your dashboard is implicitly scoped to that org and the
  agent has nothing to switch.
- Users with the **`admin.system`** permission (global admins) can be members of
  many orgs at once and need to drive the agent against any of them. The drawer
  exposes an explicit **org switcher** to global admins so the active context is
  always visible and never accidental.

### Where the org switcher lives

- The agent drawer header has three slots: agent display name, **org switcher**,
  and the close button.
- The switcher is a **native `<select>` dropdown** populated from
  `storage.organizations.listOrgs()` (alphabetical by name). It only renders when
  your permission set includes `admin.system` — non-global users never see it.
- A small "Switched to {org}" chip appears under the header for ~2 seconds after a
  switch, then fades. There is no full-page reload and no confirm dialog — the
  org change applies inline.

### What changes when you switch orgs

Switching the active org changes the agent's working scope from that point on:

| Surface | Behaviour after switch |
| --- | --- |
| Dashboard scope | Subsequent agent turns query the new org's data (scans, branding, reports). |
| Agent context-hints | Recent scans + active guidelines are re-pulled from the new org for each turn. |
| MCP tool scope | Tool calls bind to the new org via the JWT preHandler — tool results never cross orgs. |
| Active conversation | **Closed in the drawer.** The next message starts a fresh conversation under the new org. |
| Conversation history panel | Continues to list **all** your conversations, with an org-name chip on each row so you can tell them apart. |

The "force-new-conversation on switch" rule (AORG-02) is deliberate: every
conversation row carries a single `org_id`, every audit row carries the org of the
turn's active context, and there are no cross-org turns inside one conversation
to disambiguate later.

### How agent conversations relate to org context

The active org is **always sourced from the user's session and JWT**, never from
agent tool arguments. Per `CLAUDE.md`:

> MCP tool schemas must never include `orgId` — sourced from `ToolContext`
> populated by the JWT preHandler.

In practice this means:

- The agent cannot "spoof" or override an org by writing a tool call. The
  resolver decides which org the dispatcher binds to **before** the model's tool
  call is dispatched.
- Resuming an old conversation from the history panel will **auto-switch the
  active org** to match that conversation's `org_id`. The header updates inline,
  no confirm. This avoids "this conversation is foreign" banners — the system
  prefers a silent context match over a modal interruption.

### Common gotchas

- **Mid-conversation switching is prevented by design.** Switching orgs always
  closes the active conversation. If you want to keep both, use the history panel
  to flip between them — Luqen will switch orgs for you each time.
- **Persistence across sessions.** Your last-selected org is stored on
  `dashboard_users.active_org_id` and survives logout, so re-opening the
  dashboard puts you back in the org you left.
- **Default org.** If you've never explicitly chosen one (column is `NULL`), the
  resolver falls back to the **first org alphabetically by name** — stable,
  predictable, no backfill required.
- **Non-global users see nothing changed.** The switcher hides itself, the
  resolver returns your normal `currentOrgId`, and the lockdown is enforced
  server-side too: posting to `/agent/active-org` without `admin.system` returns
  `403`.

## For admins

### How memberships are managed

- Memberships and org-scoped roles are administered on the existing user-admin
  pages — see the [RBAC matrix](../reference/rbac-matrix.md) for the relevant
  `admin.*` permissions and the routes they gate.
- Phase 37 extended `dashboard_list_users` to expose `user.orgs[].orgRole`, so the
  org switcher dropdown can read membership directly out of the existing user
  query without a new repository method.
- Org-scoped roles + per-org plugin configs are inherited from the v2.0 RBAC
  model — a user can be `admin.system` globally while holding different per-org
  roles inside each membership.

### JWT claim shape carrying org context

- Every authenticated request to `/agent/*` and to any service `/mcp` endpoint
  carries an OAuth2 RS256 JWT. The agent's per-turn org binding reads the
  authenticated user out of the session, **not** out of the JWT body — but the
  MCP tool dispatcher's JWT preHandler is what populates `ToolContext.orgId` for
  every downstream tool call.
- The active-org column lives on the user row, not the JWT; the JWT does not need
  to be re-issued when a global admin switches orgs. The next request reads the
  new value via `resolveAgentOrgId(user, permissions)` in
  `packages/dashboard/src/routes/agent.ts`.

### Why MCP tool schemas never include `orgId`

This is a project-wide invariant (`CLAUDE.md` Known Gotcha):

- **Schemas must not declare `orgId`.** If they did, the model could write a tool
  call against any org id and the dispatcher would have to either ignore it or
  trust it — both lead to cross-org leakage.
- **`orgId` is populated by the JWT preHandler** into `ToolContext`, which the
  dispatcher injects into every tool invocation server-side, after RBAC checks.
- **Implication for custom-client integrators:** if you build an external MCP
  client (Claude Desktop, IDE plugin, custom script), do **not** add `orgId` to
  any tool argument shape and do not attempt to override it. It will be ignored
  at best and rejected at worst. Org context is implicit in your authenticated
  session.

### Audit log entries on org switch

- Every successful switch writes one `agent_audit_log` row with
  `tool_name = 'org_switched'` and `args_json = {fromOrgId, toOrgId}`.
- Denied switches (non-global user POSTing to `/agent/active-org`) write an
  audit row with `outcome = 'denied'`,
  `outcome_detail = 'not_admin_system'` — these show up in `/admin/audit`
  alongside the legitimate switches so you can spot probing.
- The Phase 36 audit table already carries an org column, so cross-org audit
  triage works out of the box.

### Per-org plugin configs

- Plugin configurations are scoped per-org under the existing v2.0 plugin
  architecture (`project_rbac_design`). Switching the active org also switches
  the plugin manifest the dashboard exposes — admins won't see plugins enabled
  in a different org.
- This is the same `org_id`-keyed config the compliance and branding services
  consume, so org switching never desyncs the agent's tool scope from what the
  underlying services actually allow.

### Schema reference

- **Migration 061** adds `active_org_id TEXT NULL` to `dashboard_users`. NULL is
  the "use alphabetical default" sentinel; rows are not backfilled.
- `UserRepository.setActiveOrgId(userId, orgId | null)` is the single write
  primitive — the route handler is the only caller.
- No new index — the column has small cardinality and is read once per turn.

## See also

- [Agent Companion guide](./agent-companion.md)
- [Agent conversation history](./agent-history.md)
- [Multi-step tool use](./multi-step-tools.md)
- [Streaming UX & share links](./streaming-share-links.md)
- [MCP integration guide](./mcp-integration.md)
- [RBAC matrix](../reference/rbac-matrix.md)
