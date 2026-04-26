# Phase 37: Streaming UX Polish - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 37 (interactive)

<domain>
## Phase Boundary

Users gain full per-message control over an in-flight or completed agent response without leaving the drawer. Builds on Phase 35's persisted message rows (`agent_messages` with conversation_id + soft-delete primitives) and Phase 36's SSE infrastructure.

Requirements: **AUX-01..AUX-05** — interrupt, retry, edit-and-resend, copy, share.

In-scope:
- Stop button cancels in-flight SSE; partial response persists with a "stopped" marker
- Retry the last assistant turn (same conversation state, prior reply marked superseded)
- Edit-and-resend the most-recent user message (branches the conversation, prior turns marked superseded)
- One-click copy of any assistant message's markdown source to clipboard
- Share permalink to a read-only conversation snapshot, scoped to the org

Out of scope (deferred):
- Editing arbitrary prior user messages (only the most-recent is editable in this phase)
- Side-by-side branch tree UI (linear thread metaphor preserved)
- Public/unauthenticated share links
- Tool-block inclusion in copy output
</domain>

<decisions>
## Implementation Decisions

### Stop (AUX-01)
- **Persist partial text + 'stopped by user' marker.** Save whatever streamed so far; mark the assistant message row with `status='stopped'` (or equivalent) so the UI can render a small "stopped" chip below the bubble.
- Audit log emits an outcome row with `outcomeDetail='stopped_by_user'` (or similar — reuse the Phase 36 audit infra; do NOT invent new schema).
- The existing in-flight SSE stop path (`activeStream.close()` + `agent-stop` button) already exists from Phase 32; this phase formalizes the persistence side and surfaces the marker in UI.

### Retry (AUX-02)
- **Same conversation state, mark old assistant superseded.** Soft-delete the prior assistant reply via the Phase 35 `softDelete` (or extend with a dedicated `markSuperseded` if the soft-delete + audit semantics differ).
- Replay against the same user message + same context window. The new reply replaces the old one in the visible thread.
- Visible thread reads as a single linear conversation; superseded rows remain in the DB and remain auditable at `/admin/audit`.
- Retry button only appears on the **most-recent assistant turn** (same scope rule as Edit).

### Edit-and-resend (AUX-03)
- **Hide superseded turns; only the active branch shows in the drawer.** When the user edits the most-recent user message and resubmits:
  1. Mark the original user message and the assistant reply that followed it as superseded.
  2. Persist the edited user message as a NEW row in the same conversation (not an UPDATE — preserves audit history).
  3. Stream the new assistant reply against the new user message + prior conversation state.
- **Edit scope:** only the most-recent user message is editable. Earlier user messages have no edit affordance — keeps the supersede scope bounded to one turn.
- **UI:** pencil icon on the most-recent user bubble. Click → inline editor replaces the bubble (textarea pre-filled with current content + Save / Cancel). Save → POST to `/agent/conversations/:id/messages/:id/edit-resend` (or similar; planner names the route).

### Copy (AUX-04)
- **Markdown source only.** The clipboard receives the raw markdown that was streamed for the assistant message. Tool_use bubbles, chip strip text, and audit metadata are excluded.
- Use `navigator.clipboard.writeText(markdownSource)` with a fallback to a hidden `<textarea>` + `document.execCommand('copy')` for non-secure-context browsers (rare on modern installs but the fallback is one-liner).
- Toast (or aria-live announcement) confirms copy: "Copied to clipboard" — i18n key.

### Share (AUX-05)
- **Authenticated users in the same org.** Permalink format `/agent/share/:shareId` resolves a snapshot of the conversation (read-only render) only when the requesting session has a user belonging to the conversation's `org_id`. Outside-org → 403.
- Share creates a row pointing at a `conversation_id` + `message_id` (top-of-snapshot) + `org_id`; no message duplication.
- The shared link renders a read-only version of the drawer thread (no composer, no actions). `/admin/audit` retains its existing access path; share is a user-level affordance.

### Per-message action affordance (cross-cutting)
- **Hover-revealed icon row on desktop, always-visible on mobile.** Each assistant message renders a small action row (retry, copy, share) — fades in on hover/focus on desktop, always shown on touch devices via `@media (hover: none)`.
- Each user message renders a pencil icon for edit, but only on the most-recent user turn.
- Icons are SVG, sized via existing chat button tokens, no new colors. CSP-strict (delegated `data-action` listeners in agent.js — same pattern as 36-04 chip strip).
- Mobile: action row sits below the message bubble. Desktop: action row floats inside the bubble's bottom-right corner.

### Claude's Discretion
- Exact action icon glyphs (planner picks from existing icon library or adds minimal SVGs)
- DB column naming for superseded marker (`status` enum extension vs separate `superseded_at` timestamp — planner chooses based on existing schema shape)
- Toast component reuse (existing alert partial vs new toast pattern)
- Whether `share` and `audit` permalinks share the same view template or separate
- Test layout: per-feature integration tests vs full e2e covering the action toolbar
- i18n key naming under `agent.actions.*`
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 35 — persistence + soft-delete primitives
- `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` — `softDeleteConversation`, `searchForUser` patterns. Use `is_deleted` filter pattern when adding `superseded` semantics.
- `packages/dashboard/src/db/interfaces/conversation-repository.ts` — interface to extend.
- `packages/dashboard/src/db/sqlite/migrations.ts` — migration 057 is the latest baseline. New migrations append after.

### Phase 36 — SSE + audit infra
- `packages/dashboard/src/agent/sse-frames.ts` — frame schema. Reuse for any new control frames (e.g., `stopped`, `superseded` if needed).
- `packages/dashboard/src/agent/agent-service.ts` — `MAX_TOOL_ITERATIONS`, in-flight stop path, audit emission.
- `packages/dashboard/src/db/interfaces/agent-audit-repository.ts` — `rationale`, `outcomeDetail` fields. Reuse for `stopped_by_user` outcomes.

### Phase 32 — agent drawer UI
- `packages/dashboard/src/views/partials/agent-drawer.hbs` — drawer structure. Action row sits inside `.agent-msg__body` (or sibling).
- `packages/dashboard/src/static/agent.js` — `activeStream`, `clearToolChips()`, htmx flow on `agent-form` submit. The stop button (`#agent-stop`) already exists — extend its handler with the persistence path.
- `packages/dashboard/src/static/style.css` — BEM `.agent-msg__*` block.

### CSP + frontend rules
- `CLAUDE.md` (project root) — CSP-strict, no inline scripts, BEM, `{{t}}` keys.
- Auto-discovered partials: drop new partials into `views/partials/` and they register automatically (Phase 36 cross-cutting fix).

### Routes pattern
- `packages/dashboard/src/routes/agent.ts` — existing `/agent/conversations/*` handlers (Phase 35-03). Add new endpoints (`stop`, `retry`, `edit-resend`, `share/:id`) following the same auth + CSRF + audit pattern.
</canonical_refs>

<specifics>
## Specific Ideas

- Existing `#agent-stop` button already cancels the SSE on the client side (Phase 32). This phase adds the server-side persistence on cancellation.
- `navigator.clipboard.writeText` is available in all secure contexts (HTTPS); fallback only needed for legacy edge cases.
- Share UX reference: Notion's "Share" button on a doc → unguessable URL with viewer auth check. Same pattern, scoped to org membership.
- Cursor and Claude Desktop both put per-message actions in a hover-revealed bottom toolbar — that's the visual reference.
- Edit-and-resend in ChatGPT collapses old branches under a small "<" button. This phase chooses the simpler "hide superseded" approach to match the linear-thread feel of the Luqen drawer.
</specifics>

<deferred>
## Deferred Ideas

- Edit any prior user message (cascading supersede) — opens a Pandora's box for branch management; revisit if real users need it.
- Side-by-side branch tree UI — heavy lift, breaks the linear chat metaphor.
- Public unauthenticated share links — security review territory; revisit when there's a clear external-share use case.
- Copy formats including tool block summaries — debugging-oriented, low value for end users.
- Retry with modified system prompt or different model — model-switching is a separate concern (probably a future phase or admin-side toggle).
- Branching as a first-class conversation feature (multi-branch threads) — out of scope for AUX.
</deferred>

---

*Phase: 37-streaming-ux-polish*
*Context gathered: 2026-04-25 via /gsd-discuss-phase*
