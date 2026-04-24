# Phase 35: Agent Conversation History - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 35-agent-conversation-history
**Areas discussed:** History surface, Conversation titles, Search UX, Delete UX, Pagination

---

## History Surface

| Option | Description | Selected |
|--------|-------------|----------|
| A. In-drawer stacked panel | List slides over messages, back button returns | ✓ |
| B. In-drawer toggle | Header button flips between chat and history | |
| C. Separate route | `/agent/conversations` full page | |
| D. Sidebar column in drawer | Always-visible list on wider screens | |

**User's choice:** A
**Notes:** Keeps focus contained, mirrors mobile-chat UX, avoids wide-drawer complexity.

---

## Conversation Titles — source

| Option | Description | Selected |
|--------|-------------|----------|
| A. Truncated first message | ~50 chars of first user message, rename later | |
| B. AI-generated summary | Extra LLM call after first turn, 3–5 word title | ✓ |
| C. User-editable only | No auto-title; stays "Untitled" with timestamp | |
| D. Timestamp + preview | No stored title; render "date — preview" | |

**User's choice:** B, rename via modal/menu (Claude-chat style)
**Notes:** Matches Claude-chat style; simplifies UX at the cost of one extra LLM call per conversation.

## Conversation Titles — generation timing

| Option | Description | Selected |
|--------|-------------|----------|
| A. After first assistant response | One-user + one-assistant gives enough context | ✓ |
| B. After 3 turns | More signal but longer "Untitled" window | |
| C. On demand only | Manual button in three-dot menu | |

**User's choice:** A
**Fallback on generation failure:** Truncated first message (Y).

---

## Search UX

### Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| A. Live, debounced 250ms | Query as user types | ✓ |
| B. Submit on Enter / button | One round trip per query | |

### Scope

| Option | Description | Selected |
|--------|-------------|----------|
| X. Title + message content | Broadest recall | ✓ |
| Y. Content only | | |
| Z. Title only | Fastest, weakest | |

### Result presentation

| Option | Description | Selected |
|--------|-------------|----------|
| P. Title + matched snippet + highlight | Shows the matching line | ✓ |
| Q. Title only | User opens to find context | |

**User's choice:** A, X, P (written as "A X p").

---

## Delete UX

| Option | Description | Selected |
|--------|-------------|----------|
| A. Three-dot menu → inline confirm row | Same menu as Rename, confirm swaps list row | ✓ |
| B. Three-dot menu → modal | Larger pause, safer feel | |
| C. Swipe/hover delete → inline confirm | Faster, mobile-native, discoverability tradeoff | |
| D. Undo toast | One-click delete, 5s undo window | |

**User's choice:** A

### Soft-delete visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Trash view | User can see and restore soft-deleted conversations | |
| Hidden | Gone from user UI; only admin audit logs retain them | ✓ |

**User's choice:** Hidden

---

## Pagination

| Option | Description | Selected |
|--------|-------------|----------|
| A. Infinite scroll | Load 20 on open, fetch next 20 via sentinel | ✓ |
| B. "Load more" button | Explicit click at bottom | |
| C. Numbered pages | Explicit page buttons | |

**User's choice:** A
**Page size:** 20 (recommendation accepted; user did not override).

---

## Claude's Discretion

- CSS class names for the stacked panel (reuse `agent-drawer__*` BEM stem).
- Rename UI: dialog element vs inline input swap.
- Snippet extraction algorithm (substring window around first match).
- Which LLM provider runs title generation (reuse the user's configured agent provider).
- Debounce implementation (setTimeout vs AbortController).
- Keyboard flow details (Esc closes history, arrow keys move focus, Enter resumes).

## Deferred Ideas

- Trash / restore view (explicitly rejected for this phase).
- Bulk operations (multi-select delete, bulk rename).
- Pinning / favourites.
- Export conversation (JSON / markdown).
- Cross-org admin access (belongs to Phase 38).
- Automatic re-titling after topic drift (manual rename covers this).
