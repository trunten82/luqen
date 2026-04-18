# Phase 31: Conversation Persistence — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Source:** Pre-gathered from ROADMAP.md Phase 31 section + STATE.md Architecture Notes + REQUIREMENTS.md APER-01/APER-03. No new discussion needed — all high-level decisions already locked during v3.0.0 milestone research. Open decisions below are implementation-level and delegated to Claude's discretion.

<domain>
## Phase Boundary

**What this phase delivers** (schema foundation, no UI yet — Phase 32 builds the chat UI on top):
- Two new SQLite migrations in `packages/dashboard/src/db/sqlite/migrations.ts` (ids `047` and `048`):
  - `047 — agent-conversations-and-messages` — creates `agent_conversations` + `agent_messages` tables with rolling-window + `pending_confirmation` support.
  - `048 — agent-audit-log` — creates `agent_audit_log` table with every-tool-invocation auditing shape.
- Two new repositories in `packages/dashboard/src/db/sqlite/repositories/`:
  - `ConversationRepository` — CRUD + rolling-window reads over `agent_conversations` + `agent_messages`.
  - `AuditRepository` — append-only write + filter/paginated reads over `agent_audit_log`.
- Corresponding interface types in `packages/dashboard/src/db/interfaces/` and wire-up into the existing `StorageAdapter` shape.
- Unit test coverage for both repositories (vitest, same harness pattern as the 30.1 `role-repository.test.ts` we just landed).

**What this phase does NOT deliver** (keep out of scope — tracked for Phase 32/33):
- `AgentService` or any runtime that writes to these tables. Phase 32 consumes the repos.
- Chat UI / message rendering / SSE streaming. Phase 32.
- `pending_confirmation` UX (the *enforcement* layer — destructive-tool approval flow). Phase 32 wires this up; Phase 31 only provides the DB column and status enum so Phase 32 can read/write it.
- Admin audit log *viewer* (read-side dashboard page). Phase 33 (APER-04).
- No new config, no new npm packages, no new services. The existing `better-sqlite3` driver used by the dashboard's SQLite layer handles this phase.

**Phase requirement IDs:** APER-01 (conversation history persists), APER-03 (every tool invocation audited).

</domain>

<decisions>
## Implementation Decisions

### Migration numbering (corrected)

STATE.md "Architecture Notes" referenced migrations 046 + 047 for these tables, but migration 046 is already taken by `rescore-progress` (landed earlier in v2.12.0). **Correct assignments for this phase:**
- `047 — agent-conversations-and-messages`
- `048 — agent-audit-log`

### Table shape — `agent_conversations`

Purpose: one row per conversation thread (one user × one org = one thread, OR multiple threads per user × org if future product calls for it). Drives SC-1.

Columns (locked):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | TEXT PRIMARY KEY | no | UUID |
| `user_id` | TEXT | no | FK → `dashboard_users.id` (ON DELETE CASCADE — if a user is deleted their threads go too; audit log retains the `agent_audit_log` rows independently) |
| `org_id` | TEXT | no | denormalised from user's current org for fast org-scoped listing |
| `title` | TEXT | yes | optional summary (populated by Phase 32 or 33; nullable in 31) |
| `created_at` | TEXT | no | ISO-8601 string (project convention) |
| `updated_at` | TEXT | no | bumped on every message insert |
| `last_message_at` | TEXT | yes | last `agent_messages.created_at` for this conv — denormalised for list sort (nullable on empty conv) |

Indexes:
- `(user_id, org_id, last_message_at DESC)` — covers the "my threads, most recent first" list query used by Phase 32's chat panel.

### Table shape — `agent_messages`

Purpose: individual messages within a conversation, with rolling-window semantics. Drives SC-1, SC-2, and the `pending_confirmation` state that must survive refresh.

Columns (locked):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | TEXT PRIMARY KEY | no | UUID |
| `conversation_id` | TEXT | no | FK → `agent_conversations.id` ON DELETE CASCADE |
| `role` | TEXT | no | CHECK IN (`'user'`, `'assistant'`, `'tool'`) |
| `content` | TEXT | yes | the user/assistant visible text. Nullable because a `tool` role entry may only carry `tool_call_json` + `tool_result_json` and no human-facing content. |
| `tool_call_json` | TEXT | yes | serialised tool-use block (name, args) — nullable on non-tool messages |
| `tool_result_json` | TEXT | yes | serialised tool result — nullable until the tool finishes |
| `status` | TEXT | no | CHECK IN (`'sent'`, `'pending_confirmation'`, `'approved'`, `'denied'`, `'failed'`, `'streaming'`). Default `'sent'`. The `pending_confirmation` state is consumed by Phase 32's destructive-tool approval flow and MUST survive a page refresh (MVP-blocker SC-4). |
| `created_at` | TEXT | no | ISO-8601 |
| `in_window` | INTEGER | no | 0 or 1 — "is this message currently inside the rolling window of 20 turns?" Updated as new messages arrive (see rolling-window rule below). |

Indexes:
- `(conversation_id, created_at)` — primary fetch-by-conversation ordered read.
- `(conversation_id, in_window, created_at)` — "give me the rolling window for this conv" query.

### Rolling-window policy (locked — SC-2)

A *turn* = one `role='user'` message **plus** every subsequent assistant/tool message until the NEXT user message. The window = the most recent **20 turns** plus any outstanding `pending_confirmation` / `streaming` message (which always stay in-window regardless of age).

Window maintenance happens at **write time** — every time a new `role='user'` message is appended:
1. Count turns from newest backward in `agent_messages`. When count reaches 20, mark every older row `in_window = 0` in the same transaction.
2. The new `role='user'` message and everything after it get `in_window = 1`.

Rationale for write-time (vs read-time) maintenance:
- Read path (Phase 32 `AgentService`) becomes a single indexed scan: `SELECT * FROM agent_messages WHERE conversation_id = ? AND in_window = 1 ORDER BY created_at` — no turn-counting in query layer.
- Write path runs once per user turn, amortized negligible cost.

### Table shape — `agent_audit_log`

Purpose: append-only immutable record of every tool invocation. Drives SC-3 and the Phase 33 viewer (APER-04).

Columns (locked):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | TEXT PRIMARY KEY | no | UUID |
| `user_id` | TEXT | no | the caller (may be a `dashboard_users.id` for cookie-session users OR an OAuth client_id for service callers — both accepted, no FK constraint because clientIds aren't in dashboard_users) |
| `org_id` | TEXT | no | caller's orgId (`'system'` if no orgId on the JWT) |
| `conversation_id` | TEXT | yes | FK → `agent_conversations.id` when the tool call came from the chat UI; nullable for direct MCP calls from external clients (Phase 30 walkthrough style). ON DELETE SET NULL — deleting a conversation does NOT cascade audit log deletion (regulatory/compliance requirement — audit is immutable). |
| `tool_name` | TEXT | no | e.g. `dashboard_scan_site` |
| `args_json` | TEXT | no | serialised arguments |
| `outcome` | TEXT | no | CHECK IN (`'success'`, `'error'`, `'denied'`, `'timeout'`) |
| `outcome_detail` | TEXT | yes | error message / HTTP code / reason |
| `latency_ms` | INTEGER | no | measured in the MCP dispatch layer; stored as integer ms |
| `created_at` | TEXT | no | ISO-8601 |

Indexes:
- `(org_id, created_at DESC)` — "show me my org's recent audit events" for Phase 33 viewer.
- `(user_id, created_at DESC)` — "what has this user been doing" for admin filter.
- `(tool_name, created_at DESC)` — "all calls of X tool" for incident investigation.

**Immutability**: no UPDATE or DELETE methods on `AuditRepository` — append-only. Physically enforced by the repository API surface, not SQL triggers (SQLite triggers add complexity we don't need — the API gate is sufficient for this project).

### Repositories — surface contract

**`ConversationRepository`** (`packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts`):
- `createConversation({userId, orgId, title?}): Promise<Conversation>`
- `getConversation(id): Promise<Conversation | null>` — org-scoped: caller's orgId must match or return null.
- `listForUser(userId, orgId, {limit?, offset?}): Promise<Conversation[]>` — ordered `last_message_at DESC`.
- `appendMessage({conversationId, role, content?, toolCallJson?, toolResultJson?, status?}): Promise<Message>` — inside a transaction, also maintains the rolling window per the policy above.
- `updateMessageStatus(messageId, status, outcome?): Promise<void>` — used by Phase 32 when a `pending_confirmation` is approved/denied/completes/fails.
- `getWindow(conversationId): Promise<Message[]>` — rolling-window read: `in_window = 1` only, ordered `created_at ASC`.
- `getFullHistory(conversationId, {limit?, offset?}): Promise<Message[]>` — ALL messages, for Phase 33 audit/debug views.

**`AuditRepository`** (`packages/dashboard/src/db/sqlite/repositories/audit-repository.ts`):
- `append({userId, orgId, conversationId?, toolName, argsJson, outcome, outcomeDetail?, latencyMs}): Promise<AuditEntry>` — only mutation method.
- `listForOrg(orgId, filters: {userId?, toolName?, outcome?, from?, to?}, pagination: {limit?, offset?}): Promise<AuditEntry[]>`
- `countForOrg(orgId, filters): Promise<number>` — for paginated counts.
- `getEntry(id): Promise<AuditEntry | null>` — org-scoped.

### Interface + StorageAdapter wiring

New types in `packages/dashboard/src/db/interfaces/`:
- `conversation-repository.ts` — `Conversation`, `Message`, `MessageStatus` enum, `ConversationRepository` interface.
- `audit-repository.ts` — `AuditEntry`, `ToolOutcome` enum, `AuditRepository` interface.

New fields on `StorageAdapter` (grep `StorageAdapter` in `packages/dashboard/src/db/index.ts`): `conversations: ConversationRepository`, `audits: AuditRepository`. Wired in the sqlite factory in `packages/dashboard/src/db/sqlite/adapter.ts` (or wherever the other repos are constructed — follow the pattern from `scan-repository.ts`, `role-repository.ts`).

### Tests

All vitest, same harness pattern as the 30.1 `tests/repositories/role-repository.test.ts`:
- `packages/dashboard/tests/repositories/conversation-repository.test.ts` — minimum coverage:
  - createConversation → getConversation round-trip, cross-org isolation guard (other org returns null).
  - appendMessage with role=user marks rolling window correctly after > 20 turns; older turns flip `in_window = 0`.
  - `pending_confirmation` + `streaming` messages stay in_window regardless of age.
  - listForUser ordering by `last_message_at DESC`.
- `packages/dashboard/tests/repositories/audit-repository.test.ts` — minimum coverage:
  - append → getEntry round-trip.
  - listForOrg org-scope isolation (rows from other orgs invisible).
  - Filter combinations (`userId`, `toolName`, `outcome`, date range) all produce expected subsets.
  - No UPDATE / DELETE method exposed on the repository — compile-time + runtime check (`expect(repo).not.toHaveProperty('update')`, etc.).

### Claude's Discretion

- Exact migration SQL formatting (matches existing migrations' style).
- Whether to factor rolling-window logic into a standalone helper or inline it in `appendMessage`.
- Test file naming (align with existing repo tests).
- Whether to use `CURRENT_TIMESTAMP` SQL default or pass `created_at` from app code (project convention is app code — check existing repos).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing migration + repository patterns to mirror
- `packages/dashboard/src/db/sqlite/migrations.ts:1201-1220` — migration 046 (`rescore-progress`) — reference shape for the new migrations (one entry per migration; `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`).
- `packages/dashboard/src/db/sqlite/repositories/scan-repository.ts` — reference for filter-builder + listX/countX pattern (see `buildFilterClause` at top).
- `packages/dashboard/src/db/sqlite/repositories/role-repository.ts` — reference for org-scoped read pattern (and the empty-set contract we just locked in 30.1).
- `packages/dashboard/src/db/interfaces/role-repository.ts` — reference for interface file shape.
- `packages/dashboard/src/db/index.ts` + `packages/dashboard/src/db/sqlite/adapter.ts` — the `StorageAdapter` construction site.

### Existing test harness to copy
- `packages/dashboard/tests/repositories/role-repository.test.ts` — in-memory SQLite + `applyMigrations()` harness, just landed in Phase 30.1. Copy this shape for the two new test files.

### Project-level rules
- `CLAUDE.md` — project GSD workflow + TDD enforcement.
- `.planning/STATE.md` "Architecture Notes" — locks the broad design (SQLite in dashboard.db, 20-turn window, `pending_confirmation` status). This phase translates those into code.

### Downstream consumers (DO NOT build in this phase)
- Phase 32 will build `AgentService` on top of `ConversationRepository` and will be the primary producer of audit entries via the MCP dispatch layer's `onAfterInvoke` hook. This phase's repo contracts MUST satisfy Phase 32's needs — review Phase 32 ROADMAP lines 83-93 before finalizing the repo surface.
- Phase 33 will build `/admin/agent-audit` dashboard page reading from `AuditRepository.listForOrg`.

</canonical_refs>

<specifics>
## Specific ideas

- Migration ids are sequential — use `047` and `048` exactly (STATE.md's mention of 046 is stale).
- Test harness: use `:memory:` SQLite database per test as in `role-repository.test.ts`. Apply all migrations before each test case.
- The `pending_confirmation` status lives on `agent_messages`, not on `agent_conversations`. A conversation can have at most one message in `pending_confirmation` at a time (Phase 32 will enforce this; Phase 31 just provides the column).
- Keep `AuditRepository` API surface minimal — append + reads. No delete/update methods even as a code-is-cheap affordance; the immutability is the contract.

</specifics>

<deferred>
## Deferred ideas

- **Audit log retention policy** (time-based pruning, archive to S3, etc.) — out of scope for v3.0.0. Start with unlimited retention; operational cost is linear in tool-call volume and acceptable at project scale.
- **Full-text search on audit log** — Phase 33 viewer will rely on `tool_name` + `user_id` + date filters; FTS5 can be added later if filter performance degrades.
- **Title auto-generation** — `agent_conversations.title` stays nullable; Phase 32/33 may add heuristics or an LLM call to populate it. Not a Phase 31 concern.
- **Migration 046 was already taken** — STATE.md Architecture Notes (line "Migration 046: agent_conversations…") is stale and should be updated. Not blocking this phase; will be corrected in the phase SUMMARY.md.

</deferred>

---

*Phase: 31-conversation-persistence*
*Context gathered: 2026-04-18 — synthesized from locked decisions in STATE.md, REQUIREMENTS.md, ROADMAP.md, and code-level inspection of existing migration + repository patterns.*
