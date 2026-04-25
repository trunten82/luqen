# Multi-Step Tool Use

> The agent can plan across multiple tool calls per question — running them in
> parallel where possible, recovering from failures, and showing every step it
> takes.

This guide covers the multi-step tool surface introduced in Phase 36 (requirements
ATOOL-01..ATOOL-04). It builds on the in-process tool dispatcher (Phase 32) and the
persistence model from Phase 35.

## For end users

### What multi-step tool use means

When you ask the agent something complex, it does **not** have to answer with a
single tool call. It can:

- Plan a sequence of calls — for example: list scans → fetch the latest report →
  generate a fix proposal — and chain them across multiple iterations of its
  internal loop.
- Run **independent** calls **in parallel** within the same iteration, so a
  question that needs three lookups doesn't pay three round-trips of latency.

The hard cap is `MAX_TOOL_ITERATIONS = 5` iterations per user turn. A single
iteration can dispatch many tools at once via parallel dispatch, so the practical
budget is 20+ tool calls per question.

### Parallel dispatch

- When the agent emits multiple `tool_use` blocks in one assistant message, **all
  of them dispatch simultaneously** (`Promise.all`, unbounded).
- Results return to the agent in **original `tool_use` order**, not in the order
  they finished — so the model always sees inputs in a stable shape.
- **Destructive-tool gate:** if any tool in a parallel batch is marked
  `destructiveHint: true`, the **entire batch is paused** until you confirm. No
  tool in the batch dispatches until you click through the confirmation. This
  prevents partial-result states (e.g. "the read succeeded but the delete is
  blocked") and keeps the audit trail clean.

### The chip strip — your transparency UI

Above each streaming assistant turn, a **chip strip** renders one chip per
dispatched tool. Every chip shows:

- The tool name (`compliance.list_scans`, `branding.get_score`, etc.).
- A live status icon: spinner → checkmark (success) or error icon (failure).
- Total duration once the call settles.

Chip states:

| State | What it means |
| --- | --- |
| **running** | Spinner — the tool call is in flight. |
| **done** | Checkmark — the tool returned successfully. |
| **error** | Error glyph — the tool failed (timeout, validation, runtime error). |
| **retried** | Same chip is reused for a retry; the duration ticker restarts and the state returns to **running**. |

The strip stays visible after the turn settles, so you can scrub back through what
the agent actually did.

### Retry budget

If a tool fails, the agent gets **3 retries per turn**, **shared across all
tools** (not per-tool). Within those 3 retries:

1. The agent sees the error message + a short retry-guidance string as the tool
   result, and decides whether to retry the same tool, swap to a different tool,
   or give up and answer with what it has.
2. Once the budget is exhausted, subsequent failures still surface to the agent
   but **without** retry guidance — i.e. the agent is told "this is final, do not
   retry".

You don't need to do anything to opt in. Retries happen inline; the chip strip is
how you see them.

### Reaching the iteration cap

If the agent burns all 5 iterations without producing a final answer, a small
**"Reached tool limit — producing answer with what we have"** chip appears above
the final assistant message. The agent then writes its best answer with the
information already gathered. An audit row records `outcomeDetail = 'iteration_cap'`
so admins can see when this happens.

## For admins

### Configuration knobs

- **`MAX_TOOL_ITERATIONS`** — defined in
  `packages/dashboard/src/agent/agent-service.ts` (constant, line 59). Hardcoded
  to **5** in v3.1.0; not exposed as an env var or admin setting in this phase.
- **Shared retry budget** — fixed at **3 retries per turn**, pooled across all
  tools. Tracked in-memory inside the agent loop; not persisted across turns.
- **Per-tool timeout** — enforced by `tool-dispatch.ts` via `TIMEOUT_SENTINEL`;
  unchanged from Phase 32 / 36 and applies to every parallel branch independently.

If real-world traffic starts hitting the 5-iteration cap or the 3-retry budget
repeatedly (visible via `/admin/audit` outcome filtering), raising those constants
is a code change today — see the deferred-ideas section of the Phase 36 context for
the path to making either admin-configurable.

### Per-tool RBAC enforcement

- **Every tool call is RBAC-checked on every step.** Parallel dispatch does not
  bypass RBAC: each branch of the `Promise.all` runs through the same
  permission gate the dispatcher uses for single-tool turns.
- Tools the user does not have permission to invoke are not even surfaced to the
  agent — the manifest is filtered before the model sees it. See the
  [RBAC matrix](../reference/rbac-matrix.md) for the complete tool-vs-permission
  table.
- The destructive-hint gate is enforced server-side; the client confirmation dialog
  is a UX sugar layer, not the authority.

### Token and cost implications

- A single user turn can produce 5 iterations × N parallel tools, each consuming
  tokens for tool definitions, tool results, and the agent's intermediate
  reasoning. Multi-step turns are noticeably more expensive than single-tool
  turns.
- The Phase 34 tokenizer applies — token accounting is precise per turn, including
  tool-result blocks. The 85%-of-model-max compaction trigger still kicks in if a
  long multi-step turn pushes context past the threshold.

### Audit log entries per step

Every dispatched tool, retry, and forced-final-answer event writes one row to
`agent_audit_log` (migration 048+). Per-tool rows include:

- `tool_name`, `args_json`, `outcome` (`success` / `error`), `outcome_detail`
  (e.g. `timeout`, `validation_failed`, `iteration_cap`, `stopped_by_user`).
- A new **`rationale TEXT`** column captures the agent's tool-selection rationale,
  sourced from the assistant message that emitted the `tool_use`:
  - **Anthropic:** `thinking` blocks plus any `text` block preceding the
    `tool_use` in the same assistant message.
  - **OpenAI:** the `content` text on the assistant message that also carries
    `tool_calls`.
  - **Ollama:** the pre-tool `content` text. Empty strings normalise to `null`.
- Iteration-cap exhaustion writes a synthetic row with
  `tool_name = '__loop__'`, `outcome = 'error'`,
  `outcome_detail = 'iteration_cap'`.

### `/admin/audit` UX for multi-step

The audit table is the system of record:

- Each row shows the tool name, outcome, and a **truncated rationale (~80 chars)**
  on the first line. Click the row to expand the **full rationale + outcome
  detail** in place — no separate rationale column, so the table stays scannable.
- The existing tool filter is extended with an **outcome filter** (success / error
  / iteration_cap) so you can quickly find failed batches or capped turns.

### SSE frame surface

The streaming transport emits two frames the chip strip listens for:

- `tool_started` — fires when a tool dispatch begins; payload includes a
  per-call id, tool name, and dispatch order.
- `tool_completed` — fires on success **or** failure; payload includes the same
  id plus outcome, outcome detail, and duration.

These frames sit alongside the existing `done`, `stopped`, and content-delta frames
emitted by the agent loop. The chip strip is a thin client-side renderer over
`tool_started` / `tool_completed` events.

## See also

- [Agent Companion guide](./agent-companion.md)
- [Agent conversation history](./agent-history.md)
- [Streaming UX & share links](./streaming-share-links.md)
- [Multi-org context switching](./multi-org-switching.md)
- [MCP integration guide](./mcp-integration.md)
- [RBAC matrix](../reference/rbac-matrix.md)
