# Agent Conversation History

> Search, resume, and manage your past chat sessions with the Luqen agent companion.

The agent companion (Phase 32+) keeps a rolling 20-turn window in memory while you
chat. Behind that window, every turn is also persisted so you can find, reopen, or
remove any past conversation from a searchable history panel inside the agent drawer.

## For end users

### What it is

- The agent drawer shows the **active** conversation as a stacked list of message
  bubbles. The agent itself only reasons over a rolling 20-turn window — older
  turns drop out of the in-memory context to keep token cost predictable.
- **History** is the persisted record of every conversation you have ever had in the
  current org, kept independently of the rolling window. Each conversation has a
  short AI-generated title (3–5 words), a timestamp, and a message count.

### Open the history panel

- Click the **History** button in the agent drawer header. The drawer keeps the same
  width — a stacked panel slides in over the active messages, mirroring the
  iMessage / WhatsApp pattern.
- A **Back** button on the panel returns you to the active conversation. Pressing
  `Esc` cascades the same way: menu → search clear → close history → focus returns
  to the History trigger.

### Browse past conversations

- Conversations are ordered newest-first. Each row shows: title, last-activity
  timestamp, and message count.
- Scrolling near the bottom triggers the next page automatically (20 conversations
  per page) via an IntersectionObserver sentinel — no Load-More button.
- Soft-deleted conversations never appear here.

### Search past conversations

- A search box sits at the top of the panel. Type any keyword — search is
  **case-insensitive**, runs after a 250 ms debounce, and matches against
  **conversation title and message content**.
- Each result shows the title plus a snippet (~60–120 characters around the first
  match) with the matched substring wrapped in `<mark>`.
- A screen-reader live region announces the result count. If nothing matches, the
  panel shows a localised "No conversations match" state.
- Clearing the search input restores your cached page-1 list without re-fetching.

### Resume a past conversation

- Click any row (or hit `Enter` on a focused row) to resume. The full message
  history loads and any new messages you send append to the **same**
  `conversation_id` — no fork, no copy.
- Roving-tabindex keyboard navigation: `Tab` enters the list, `Arrow` keys move
  between rows, `Enter` resumes.

### Rename a conversation

- Each row has a three-dot menu (Claude-chat style). Open it via mouse, `Shift+F10`,
  or the `ContextMenu` key — focus moves into the menu.
- Click **Rename**. The row swaps to an inline input pre-filled with the current
  title and the text pre-selected. `Enter` saves; `Esc` cancels.
- The new title is written to the conversation immediately. AI auto-titling does
  **not** run again on later turns — your manual rename sticks.

### Soft-delete a conversation

- Open the same three-dot menu and choose **Delete**. The row is replaced in place
  with an inline confirm row: `Delete conversation? [Cancel] [Delete]`. Focus
  defaults to **Cancel** (safer default).
- Confirming hides the conversation from the list, search, and any deep-link open.
  There is no Trash view and no undo toast in this version — soft-deleted rows are
  recoverable only via admin tooling (audit log + DB).

### Retention behaviour and what gets persisted

- Every user message and assistant message is persisted to `agent_messages` under
  `agent_conversations` (migration 047, Phase 31). Both tables are scoped per
  `(user_id, org_id)`.
- The rolling 20-turn window is purely an in-memory budget for the live agent — it
  does **not** affect what is searchable or resumable from history.
- Soft-deleted conversations remain in the DB with `is_deleted = 1` and
  `deleted_at` set; they are filtered out of every user-facing surface.

## For admins

### Where conversations are stored

- SQLite tables `agent_conversations` and `agent_messages` (migration 047).
- Soft-delete columns `is_deleted INTEGER NOT NULL DEFAULT 0` + `deleted_at TEXT`
  added in migration 056. A partial index supports list/search filtering on the
  active rows only.
- Indexes: `idx_agent_conversations_user_org_active_last` orders the user list by
  `last_message_at DESC`; message search uses `LIKE … ESCAPE '\\'` with `%`, `_`,
  and `\` escaped in user input.

### RBAC permissions

- The history panel surfaces conversations belonging to **the current user, in the
  current org only** (`user_id = @userId AND org_id = @orgId AND is_deleted = 0`).
  No additional permission gates the user-facing panel — your own conversations are
  always visible to you.
- Cross-org or cross-user access is exposed only through the admin audit log and
  direct DB access. See the
  [RBAC matrix](../reference/rbac-matrix.md)
  for the full list of `agent.*` and `admin.*` permissions and which routes they
  gate.

### Bulk purge

- There is no dedicated UI for bulk purge in v3.1.0. Operators can run a SQL update
  against the SQLite store to set `is_deleted = 1` + `deleted_at = CURRENT_TIMESTAMP`
  for any subset of `agent_conversations` rows; an accompanying audit row should be
  written to `agent_audit_log` for traceability.
- Hard deletion is intentionally not exposed — it would erase the audit trail of
  what was discussed.

### Audit-log integration

- Both **Rename** and **Delete** emit a row to `agent_audit_log` (migration 048).
  - Rename: `tool_name = 'conversation_renamed'`, `args_json = {oldTitle, newTitle}`.
  - Soft-delete: `tool_name = 'conversation_soft_deleted'`.
- Rows are visible in the `/admin/audit` viewer (Phase 33) with the existing tool /
  outcome / org filters. There is no separate "history audit" view.

### Storage growth considerations

- Each conversation row is small (title + a few timestamps). Growth is dominated by
  `agent_messages.content` — plain text, one row per turn. Soft-deleted rows count
  toward storage until you purge them at the SQL layer.
- Title generation issues one extra short LLM call after the first assistant
  response per conversation; failures fall back to the first user message truncated
  to 50 characters. The fallback is the final stored title — no retry loop, no
  background re-titling.

## See also

- [Agent Companion guide](./agent-companion.md)
- [Multi-step tool use](./multi-step-tools.md)
- [Streaming UX & share links](./streaming-share-links.md)
- [Multi-org context switching](./multi-org-switching.md)
- [RBAC matrix](../reference/rbac-matrix.md)
