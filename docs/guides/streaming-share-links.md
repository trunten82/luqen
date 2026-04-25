# Streaming UX & Share Links

> Stop, retry, edit-and-resend, copy, and share any agent reply — without leaving
> the drawer.

This guide covers the per-message control surface introduced in Phase 37
(requirements AUX-01..AUX-05). It builds on Phase 35's persisted message rows and
Phase 36's SSE infrastructure.

## For end users

### What streaming UX polish delivers

The agent companion in v3.1.0 streams every reply token-by-token over SSE, with
smooth in-place rendering inside the drawer. Each assistant turn carries its own
**action row** (retry, copy, share) and the most-recent user message carries an
**edit affordance**. On desktop the action row fades in on hover/focus; on touch
devices (`@media (hover: none)`) it is always visible underneath the bubble.

### Stop a reply mid-stream

- The **Stop** button (`#agent-stop`) interrupts the in-flight SSE.
- Whatever text streamed so far is **persisted** to the conversation. The bubble
  is marked `status = 'stopped'` and a small **"stopped"** chip renders below it
  so you can tell the reply was cut short.
- An audit row records `outcome_detail = 'stopped_by_user'`.

### Retry the last assistant turn

- The **Retry** action only appears on the **most-recent assistant turn**.
- Clicking it marks the previous reply as **superseded** (soft-deleted from the
  visible thread, retained in DB for audit) and re-streams a fresh reply against
  the same user message and the same context window.
- The visible drawer thread stays linear — superseded rows are hidden from the
  user, but `/admin/audit` still shows them.

### Edit and resend

- The pencil icon on the **most-recent user bubble** opens an inline editor
  (textarea pre-filled with the current text + Save / Cancel).
- On Save:
  1. The original user message and the assistant reply that followed it are
     marked **superseded**.
  2. The edited text is persisted as a **new row** in the same conversation —
     not an UPDATE, so the audit trail keeps the original wording.
  3. The agent streams a fresh reply against the new user message + prior
     conversation state.
- Earlier user messages do **not** carry an edit affordance — only the
  most-recent turn is editable. This bounds the supersede scope to one turn and
  keeps the linear-thread feel intact.

### Copy a reply to your clipboard

- The **Copy** action copies the **raw markdown source** of the assistant message
  to the clipboard via `navigator.clipboard.writeText`. A `<textarea>` +
  `document.execCommand('copy')` fallback covers non-secure-context browsers.
- Tool-use bubbles, the chip strip, and any audit metadata are **excluded** from
  the copy output — you get exactly what was streamed as the reply text.
- A toast (or `aria-live` announcement) confirms: "Copied to clipboard".

### Share a conversation via permalink

- The **Share** action creates a permalink of the form `/agent/share/:shareId` and
  copies that URL to your clipboard.
- The link is **scoped to your org**: anyone in the same org with a valid login
  can open the URL and see a read-only render of the conversation. Users outside
  the org get a `403`. There are no public, unauthenticated share links.
- The shared view shows the conversation thread with **no composer and no
  actions** — it is a snapshot for review, not a hand-off into a live session.

### Permalink expiry

- Share links carry an `expires_at` timestamp (added in migration 060). Default
  expiry is **30 days** from creation; opening an expired link returns a friendly
  expired-link page.
- The link points at a `(conversation_id, message_id, org_id)` tuple — **no
  message duplication**. If the underlying conversation rows are soft-deleted,
  the share link stops resolving.

### Privacy considerations

- A share link is **only as private as your org membership**: anyone in the org
  with the URL can read the snapshot until it expires. Treat share URLs like
  internal links, not public ones.
- Outside-org access always returns 403 — the URL is unguessable but the
  authorisation check, not the URL secrecy, is what protects the conversation.

## For admins

### Storage tables

- **`agent_share_links`** — added in migration **059**. One row per shared
  permalink: `share_id`, `conversation_id`, `message_id`, `org_id`, `created_by`,
  `created_at`.
- **`expires_at`** column on `agent_share_links` — added in migration **060**.
  NULL means "no expiry" (legacy rows pre-060); new rows always populate it.
- Conversation message persistence (`agent_conversations`, `agent_messages`,
  including the `is_deleted` / `superseded` semantics) is unchanged from Phase 35
  / Phase 36 baselines.

### Default expiry duration & how to change it

- Default is **30 days**. The default lives next to the share-link route handler
  in `packages/dashboard/src/routes/agent.ts` — adjust the constant and ship a
  migration if you want to backfill existing rows.
- The DB column itself is freely settable per row, so a future admin UI could let
  power users pick longer/shorter expiry without a schema change.

### RBAC permission

- Creating a share link requires the user to be a member of the conversation's
  `org_id`. There is no separate `share.create` permission in v3.1.0 — any user
  with access to the conversation can share it within the org.
- Viewing a share link requires an authenticated session whose user belongs to
  the conversation's `org_id`. See the
  [RBAC matrix](../reference/rbac-matrix.md) for the full agent and admin route
  permission table.

### Bulk revocation

- v3.1.0 ships **no dedicated revocation UI**. To revoke a share link
  immediately, set `expires_at = CURRENT_TIMESTAMP` (or a past timestamp) on the
  row in `agent_share_links` — the resolver treats `now() >= expires_at` as
  expired.
- To revoke all share links for an org, run an UPDATE filtered by `org_id`.
- A future polish phase may add a `/admin/agent/share-links` table with
  per-row revocation; track that in the deferred-ideas log.

### Streaming transport notes

- Per `CLAUDE.md`, all MCP and agent endpoints use **Streamable HTTP** (the
  current transport — SSE-only was deprecated June 2025). Connection drops manifest
  as a `stopped` chip on the bubble; the partial text persists exactly as a
  user-initiated stop, so failure-mode UX is consistent.
- Retry, edit-resend, and stop all reuse the existing SSE / Streamable HTTP
  control frames — no new transport wire was added in Phase 37.

### Audit-trail notes

- Stop, retry, edit-resend, and share each emit one `agent_audit_log` row with a
  meaningful `outcome_detail` (`stopped_by_user`, `retried`, `edit_resend`,
  `share_created`). Combined with the rationale column (Phase 36) the audit log
  is sufficient to reconstruct any user's exact path through a conversation.

## See also

- [Agent Companion guide](./agent-companion.md)
- [Agent conversation history](./agent-history.md)
- [Multi-step tool use](./multi-step-tools.md)
- [Multi-org context switching](./multi-org-switching.md)
- [RBAC matrix](../reference/rbac-matrix.md)
