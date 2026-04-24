# Phase 35: Agent Conversation History - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can find and resume any past agent conversation from a searchable, accessible
side-drawer history. Persistence schema (migration 047 — `agent_conversations`,
`agent_messages`) and the `ConversationRepository` interface already exist from
Phase 31. This phase delivers the missing UX: list, search, resume, rename, delete,
and the service/route surface that backs them.

Not in scope: new persistence columns beyond `is_deleted`/`deleted_at` (soft-delete),
multi-org switching in the drawer (Phase 38), multi-step tool use changes (Phase 36),
streaming polish (Phase 37).

</domain>

<decisions>
## Implementation Decisions

### Surface

- **D-01:** History lives as an **in-drawer stacked panel**. Opening history slides
  a list view over the active messages view inside the existing `#agent-drawer`
  aside. A back button on the list returns to the active conversation. The drawer
  dimensions do not change.
  - Rationale: keeps focus contained, mirrors mobile-chat UX (iMessage/WhatsApp),
    avoids a "wide drawer on desktop / narrow on mobile" sidebar split.

### Conversation Titles

- **D-02:** Title is **AI-generated** after the first assistant response completes.
  One extra LLM call summarises the user message + assistant reply in 3–5 words
  and writes to `agent_conversations.title`.
- **D-03:** On generation failure (model down, rate limit, timeout), fall back to
  **the first user message truncated to ~50 chars**. The fallback is the final
  stored title — no retry loop.
- Rename entry point: a **three-dot menu on each list row** (Claude-chat style),
  opening a small modal/inline rename control. Same menu hosts Delete.
- Generation timing: after the *first* assistant response only. Later turns do
  not re-title automatically.

### Search

- **D-04:** Live debounced search, 250 ms debounce. Scoped to **title + message
  content**, case-insensitive, filtered to `user_id = current_user AND
  org_id = current_org AND is_deleted = 0`. Each result row shows the title and
  a **matched snippet** with the query term highlighted. Empty state when zero
  hits: localised "No conversations match" string.

### Delete

- **D-05a:** Delete fires from the **three-dot menu** (same menu as Rename). On
  click, the list row is replaced in place with an **inline confirm row**
  (`Delete conversation? [Delete] [Cancel]`). No modal, no undo toast.
- **D-05b:** Soft-deleted conversations are **hidden from every user-facing
  surface** — list, search, deep-link open. They remain in `agent_conversations`
  with `is_deleted = 1` + `deleted_at` and are surfaced only in admin audit logs.
  No Trash view.

### Pagination

- **D-06:** **Infinite scroll** with an IntersectionObserver sentinel at the
  bottom of the list. Initial page size **20**; subsequent fetches also 20.
  `ConversationRepository.listForUser` already supports `{ limit, offset }` so
  no repo change is needed for pagination itself.

### Claude's Discretion

The following are left to the planner/executor to decide within the constraints above:

- CSS class names for the stacked panel (reuse existing `agent-drawer__*`
  BEM stem).
- Whether rename uses a dialog element or an inline input swap.
- Exact snippet extraction algorithm (substring window around first match;
  length 60–120 chars suggested).
- Which LLM provider handles title generation (reuse the user's configured
  agent provider so the call stays inside existing budget/quota).
- Debounce implementation (setTimeout vs AbortController-based).
- Keyboard flow in the stacked panel (recommended: Esc closes history →
  returns to messages; arrow keys move focus within list; Enter resumes).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema + Repository (Phase 31 foundation)
- `packages/dashboard/src/db/sqlite/migrations.ts` §migration 047 — `agent_conversations`
  and `agent_messages` table definitions, indexes
  (`idx_agent_conversations_user_org_last`, `idx_agent_messages_conv_created`)
- `packages/dashboard/src/db/interfaces/conversation-repository.ts` — `ConversationRepository`
  contract (`createConversation`, `getConversation`, `listForUser`, `appendMessage`,
  `updateMessageStatus`, `getWindow`, `getFullHistory`, `markOutOfWindowBefore`)
- `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` — concrete
  SQLite implementation with org-scoped guards (T-31-01 / T-31-02)

### Agent Runtime + Routes
- `packages/dashboard/src/agent/agent-service.ts` — AgentService (token budget,
  tokenizer wiring, compaction trigger)
- `packages/dashboard/src/routes/agent.ts` — existing `/agent/message` POST and
  message-streaming surfaces
- `packages/dashboard/src/views/partials/agent-drawer.hbs` — drawer markup and
  current DOM structure (history panel slots in here)
- `packages/dashboard/src/static/agent.js` — drawer hydration, localStorage
  (`luqen.agent.panel`) open/closed state

### Audit + Security
- `packages/dashboard/src/db/interfaces/agent-audit-repository.ts` — audit log
  row shape (soft-delete writes go through here)
- `packages/dashboard/src/db/sqlite/migrations.ts` §migration 048 — `agent_audit_log`

### Project Conventions (non-negotiable)
- Prior feedback memory: HTMX partials must match full-page structure; use plain
  JS fetch for cross-section swaps, not `hx-select` inheritance
- Prior feedback memory: never nest `<form>` inside `<table>` cells — use `hx-post`
  on buttons + CSRF meta-tag interceptor
- Prior feedback memory: all visible text via `{{t}}` i18n keys, never hardcoded
- Prior feedback memory: design-system tokens only (`style.css`); do not invent
  new CSS classes
- `packages/dashboard/src/i18n/locales/en.json` — source of truth for user-facing
  strings

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConversationRepository.listForUser(userId, orgId, { limit, offset })` — already
  paginated; drives D-06 infinite scroll directly.
- `ConversationRepository.getFullHistory(conversationId, options)` — already
  exists for the resume flow.
- `agent_conversations.title` column exists (nullable) — D-02 writes here.
- Drawer shell at `packages/dashboard/src/views/partials/agent-drawer.hbs` already
  renders once inside the shared authenticated layout (survives HTMX nav).
- Three-dot menu pattern likely already exists in admin tables — scout during
  planning to reuse rather than invent.
- Index `idx_agent_conversations_user_org_last` already supports the list query;
  no new index required for the list surface.

### Established Patterns
- CSRF via `<meta>` tag + HTMX interceptor (not nested `<form>`s).
- BEM naming for drawer classes (`agent-drawer__*`).
- HTMX 2.0 caveat: `hx-select` inheritance breaks cross-section swaps — prefer
  plain `fetch()` + targeted DOM updates when the stacked panel needs to swap
  regions outside its target.
- Soft-delete pattern: add `is_deleted INTEGER DEFAULT 0` + `deleted_at TEXT` to
  `agent_conversations` (new migration), not a separate tombstone table. Aligns
  with prior phases' convention.

### Integration Points
- Agent route file `packages/dashboard/src/routes/agent.ts` — add `GET /agent/conversations`,
  `GET /agent/conversations/search`, `GET /agent/conversations/:id`,
  `POST /agent/conversations/:id/rename`, `POST /agent/conversations/:id/delete`,
  or consolidate under a nested router.
- `AgentService` owns title generation — call the same provider used for chat
  so token accounting stays consistent (Phase 34 tokenizer applies).
- `agent.js` hydrates the stacked panel state alongside existing drawer state.

</code_context>

<specifics>
## Specific Ideas

- Claude-chat UX for row actions: hover/focus reveals a three-dot button;
  click opens a tiny menu with "Rename" and "Delete".
- List item visual: title on the first line, timestamp + message count on a
  second line; matched snippet (during search) replaces the second line with
  the highlighted excerpt.
- Search input sits at the top of the stacked panel with a clear-button and
  debounced hit.

</specifics>

<deferred>
## Deferred Ideas

- **Trash / restore view** — user-facing recovery of soft-deleted conversations.
  Explicitly rejected for this phase (D-05b). Candidate for a later polish phase
  if demand emerges.
- **Bulk operations** (multi-select delete, bulk rename) — not in phase scope.
- **Pinning / favourites** — not in phase scope. Candidate backlog idea.
- **Export conversation** (JSON / markdown download) — not in phase scope.
- **Cross-org conversation access for global admins** — belongs to Phase 38
  (Multi-Org Context Switching).
- **Re-title after long conversations drift topic** — only first-assistant-response
  generation runs automatically (D-02). Manual rename covers the drift case.

</deferred>

---

*Phase: 35-agent-conversation-history*
*Context gathered: 2026-04-24*
