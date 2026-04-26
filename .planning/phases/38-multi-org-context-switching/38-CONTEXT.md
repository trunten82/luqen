# Phase 38: Multi-Org Context Switching - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 38 (interactive)

<domain>
## Phase Boundary

Global admins (`admin.system`) can drive the agent against any org's data from a single session, with safe boundaries for non-global users. Builds on Phase 35's persisted history (per-conversation org attribution), Phase 36's tool dispatcher (rebound per turn from `ctx.orgId`), and Phase 37's drawer header / per-message actions.

Requirements: **AORG-01..AORG-04**.

In-scope:
- Org switcher UI in the drawer header for global admins
- Per-user persistence of the active org across sessions
- Force-new-conversation on switch (clean separation, no cross-org turns)
- Auto-switch active org when opening a past conversation from a different org
- Per-turn org binding in `AgentService.runTurn` for tool dispatch
- 403 + UI suppression for non-global users (AORG-04)

Out of scope (deferred):
- Mid-conversation org switches (force-new-conversation prevents this)
- Org chip per individual turn inside the drawer (overkill given force-new-conversation)
- Searchable / autocomplete switcher (3 orgs in production; native select is enough)
- Org-switch shortcut keys
</domain>

<decisions>
## Implementation Decisions

### Switcher UI (AORG-01, AORG-03)
- **Native `<select>` dropdown beside the drawer title.** Renders only when `permissions.has('admin.system')`. Options sourced from `storage.organizations.listOrgs()`. CSP-strict (no inline JS), label via `{{t}}`.
- Placement: between drawer agent display name and the close button in `agent-drawer.hbs` header.
- The switcher itself is a `<form data-action="agentOrgSwitch">` submitted via a delegated change handler in `agent.js` that POSTs `/agent/active-org` with the selected `orgId`.

### Switch UX feedback
- **Inline replace + small "Switched to {org}" chip** under the header for ~2s, then fades. No full-page reload, no confirm dialog.
- Chip uses the same toast pattern as Phase 37 share toast (`.agent-drawer__toast`), but anchored to the drawer header.

### Active conversation behavior on switch (AORG-02)
- **Force-start a new conversation.** Switching org (a) closes the active conversation in the drawer (it remains in history under the original org), (b) resets `conversationId` in agent.js, and (c) the next user message creates a fresh conversation under the new org via the existing auto-create path (`POST /agent/message`).
- Audit row emitted on switch with `toolName='org_switched'`, `argsJson={fromOrgId, toOrgId}`.

### Cross-org open (history)
- **Auto-switch active org to match the opened conversation.** Clicking a past conversation in the history panel that belongs to a different org silently triggers a switch (POST `/agent/active-org`) before opening. Header updates inline. Avoids "this conversation is foreign" banners.
- Server-side: GET `/agent/conversations/:cid` only resolves if the caller has `admin.system` OR the conversation's `org_id` matches the caller's accessible orgs.

### Persistence (AORG-03)
- **New column `active_org_id TEXT NULL` on `dashboard_users`.** Migration 061. NULL means "use default".
- Survives logout (the spec calls for "persists across sessions").
- Updated by POST `/agent/active-org` in a single UPDATE.

### Default active org (when active_org_id is NULL)
- **First org alphabetically by `name`.** Stable, predictable, deterministic. Resolved at read-time in `resolveAgentOrgId(user, permissions)` so we don't backfill rows.

### Per-turn org rebind (AORG-02)
- **`AgentService.runTurn` reads `dashboard_users.active_org_id` (or computed default) once at turn start** and uses it as `ctx.orgId` for the tool dispatcher and context-hints injection.
- No mid-turn rebind — the force-new-conversation rule means switches always happen between turns.
- `resolveAgentOrgId(user, permissions)` (in `routes/agent.ts`) becomes the central resolver:
  - If `permissions.has('admin.system')`: return `user.activeOrgId ?? defaultOrgAlphabetical()`
  - Else: return `user.currentOrgId` (existing behavior)

### Non-global user lockdown (AORG-04)
- **UI:** `<select>` is rendered only when `admin.system` permission is in the page's permissions set. Server template passes `showOrgSwitcher` flag.
- **Server:** POST `/agent/active-org` returns 403 if the caller does not have `admin.system`. Audit row emitted with `outcome='denied'`, `outcomeDetail='not_admin_system'`.

### History + audit attribution
- **Org-name chip on each conversation card in the history panel.** Shown for global admins only (other users only see their own org's conversations anyway).
- **`/admin/audit` already has an org column** (Phase 36). No changes needed.
- No per-turn chip inside the drawer thread (force-new-conversation makes that unnecessary).

### Claude's Discretion
- Exact i18n key naming under `agent.org.*`
- Whether the chip-strip from Phase 36 is reused for the "Switched to X" feedback or a new BEM block is introduced
- Whether to debounce the POST `/agent/active-org` if user rapidly switches multiple times (planner choice)
- Test layout: integration vs e2e split
- DB index strategy for `active_org_id` (probably none — small cardinality)
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Permission resolution
- `packages/dashboard/src/auth/permissions.ts` (or wherever `getPermissions` lives) — adds `admin.system` to the page permissions set.
- `packages/dashboard/src/routes/agent.ts:122` — `resolveAgentOrgId` — central resolver to extend.

### Drawer + UI scaffolding
- `packages/dashboard/src/views/partials/agent-drawer.hbs` — header section to add the switcher.
- `packages/dashboard/src/static/agent.js` — delegated `data-action` listener pattern (Phase 36-04 reference) and toast renderer (Phase 37-04 reference).
- `packages/dashboard/src/static/style.css` — `.agent-drawer__*` BEM block.
- `packages/dashboard/src/i18n/locales/en.json` — `agent.org.*` keys.

### Persistence + repositories
- `packages/dashboard/src/db/sqlite/repositories/user-repository.ts` — extend `DashboardUser` with `activeOrgId`, add `setActiveOrgId(userId, orgId)`.
- `packages/dashboard/src/db/interfaces/user-repository.ts` — interface to extend.
- `packages/dashboard/src/db/sqlite/migrations.ts` — migration 061: ALTER TABLE dashboard_users ADD COLUMN active_org_id TEXT.

### Org listing
- `packages/dashboard/src/db/sqlite/repositories/org-repository.ts` — `listOrgs()` already exists.

### Routes pattern
- `packages/dashboard/src/routes/agent.ts` — add POST `/agent/active-org` following existing auth + CSRF + audit pattern.

### Auto-discovered partials
- New partials drop into `views/partials/` and register automatically (Phase 36 cross-cutting).

### CSP + frontend rules
- `CLAUDE.md` (project root) — CSP-strict, no inline scripts, BEM, i18n {{t}} keys.
</canonical_refs>

<specifics>
## Specific Ideas

- Today there are 3 orgs in production (Concorsando, Alessandro Lanna, Kidhora). Native `<select>` is fine.
- The current `resolveAgentOrgId` returns `__admin__:userId` for global admins with no `currentOrgId`. This synthetic value will go away — global admins now resolve to a real org.
- `dashboard_list_users` was updated in Phase 37 to expose `user.orgs[].orgRole`. The org switcher dropdown should source from `storage.organizations.listOrgs()` ordered alphabetically by name (matches the default rule).
- Force-new-conversation on switch keeps audit clean: every conversation row has a single `org_id`, every audit row has the org of the turn's active context.
</specifics>

<deferred>
## Deferred Ideas

- Mid-conversation org switches (cross-org turns within one conversation) — currently prevented by force-new-conversation; revisit only if real users complain.
- Searchable / autocomplete switcher — overkill at current scale.
- Per-org agent system prompts (different prompt-template per org) — separate concern; not in AORG.
- Recently-used orgs list in the switcher (MRU first) — minor UX nicety, ship if 3+ orgs becomes 30+.
- Cross-org conversation merge/clone — out of scope.
- Org-switch keyboard shortcut — UX polish, defer.
</deferred>

---

*Phase: 38-multi-org-context-switching*
*Context gathered: 2026-04-25 via /gsd-discuss-phase*
