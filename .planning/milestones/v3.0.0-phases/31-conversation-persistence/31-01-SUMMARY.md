---
phase: 31-conversation-persistence
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, migrations, agent, conversation, rolling-window, transactions]

# Dependency graph
requires:
  - phase: 30-dashboard-mcp-external-clients
    provides: >
      Existing SqliteStorageAdapter surface + repository pattern
      (role-repository, audit-repository) established during Phase 30.1
      test harness (temp-file sqlite + storage.migrate() + FK PRAGMA ON).
provides:
  - Migrations 047 (agent_conversations + agent_messages) and 048 (agent_audit_log)
  - ConversationRepository interface + types (Conversation, Message, MessageRole, MessageStatus)
  - SqliteConversationRepository implementation with transactional rolling-window maintenance
  - storage.conversations wired into StorageAdapter
  - 18-test contract suite covering SC-1 / SC-2 / SC-4 (write, rolling window, restart durability, status transitions)
affects:
  - 31-02 (AgentAuditRepository reuses migration 048 DDL and adapter wire-up pattern)
  - 32 (AgentService reads storage.conversations for every chat turn)
  - 33 (audit-viewer reads agent_audit_log + getFullHistory)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Write-time rolling-window maintenance — flip older rows inside the same transaction as the insert, keyed off LIMIT 1 OFFSET 19 on user-message timestamps"
    - "status-exempted flipping — status IN ('pending_confirmation','streaming') excluded from the UPDATE so the UX stays readable after restart"
    - "UUID-based ids via randomUUID() + ISO-8601 timestamps from app code (consistent with audit-repository, not role-repository's role-${Date.now()} scheme)"
    - "COALESCE-preserving partial updates (updateMessageStatus can refresh status without clobbering an existing tool_result_json)"

key-files:
  created:
    - packages/dashboard/src/db/interfaces/conversation-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts
    - packages/dashboard/tests/repositories/conversation-repository.test.ts
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
    - packages/dashboard/src/db/adapter.ts
    - packages/dashboard/src/db/interfaces/index.ts
    - packages/dashboard/src/db/sqlite/index.ts
    - packages/dashboard/src/db/sqlite/repositories/index.ts
    - packages/dashboard/src/db/index.ts

key-decisions:
  - "Rolling-window boundary uses LIMIT 1 OFFSET 19 (20th-most-recent user message), NOT OFFSET 20 as the plan body suggested — OFFSET 20 would yield a 21-turn window. Fix documented in repo source comments."
  - "Boundary query uses strict-less (<) on created_at so the newly inserted user message (same @now) is never flipped by its own rolling-window UPDATE."
  - "Default pagination cap of 200 on listForUser and getFullHistory mirrors audit-repository's cap."
  - "updateMessageStatus takes no userId/orgId guard — Phase 32 service layer enforces caller ownership (documented in jsdoc)."

patterns-established:
  - "Rolling-window write-time maintenance: the policy lives inlined in appendMessage as three prepared statements (insert + bump conversation + flip older). No helper extraction until a second repo needs the same pattern."
  - "Restart-durability test shape: temp-file sqlite → disconnect → re-instantiate SqliteStorageAdapter with same path → re-migrate (idempotent) → re-query. Copy this for any future SC-4-style tests."

requirements-completed:
  - APER-01

# Metrics
duration: ~45min
completed: 2026-04-18
---

# Phase 31 Plan 01: Conversation Persistence Schema + Repository Summary

**SQLite migrations 047 + 048 and the full ConversationRepository surface are live, with write-time rolling-window maintenance (OFFSET 19 boundary, status-exempted flipping for pending_confirmation + streaming) and proven restart durability for pending_confirmation via temp-file sqlite disconnect + reopen.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-04-18T17:15:00Z (approx)
- **Completed:** 2026-04-18T17:26:30Z
- **Tasks:** 2/2
- **Files modified:** 9 (3 created + 6 modified)

## Accomplishments

- Migration 047 creates `agent_conversations` + `agent_messages` with FK cascade, status enum, `in_window` default 1, and two indexes sized for the two read patterns (list-by-user and window-by-conversation).
- Migration 048 creates `agent_audit_log` with `ON DELETE SET NULL` on `conversation_id` (immutable audit; Plan 02's `AgentAuditRepository` will consume this table).
- `SqliteConversationRepository` implements every method on the locked CONTEXT.md surface. Rolling-window maintenance lives inside the same `this.db.transaction(...)()` block as the INSERT, so there is no window-of-inconsistency when multiple turns interleave.
- Cross-org isolation is enforced at the SQL layer (`getConversation` filters `org_id = ?`, `listForUser` filters on both `user_id` AND `org_id`), mitigating T-31-01 and T-31-02.
- `pending_confirmation` and `streaming` rows are explicitly exempted from the out-of-window flip, so the destructive-tool approval UX and in-flight streaming messages remain visible even after many subsequent turns push them past the 20-turn boundary — SC-2 / SC-4 interaction proven via two dedicated tests.
- Restart durability (SC-4) is proven with a temp-file sqlite test: insert `pending_confirmation` → `storage.disconnect()` → new `SqliteStorageAdapter(dbPath)` → `storage.migrate()` → re-query confirms status and `in_window` survive.
- StorageAdapter wire-up complete: `storage.conversations` reachable from any consumer; re-exported from all four barrels (`interfaces/index.ts`, `repositories/index.ts`, `db/index.ts`, and typed into `SqliteStorageAdapter`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrations 047 + 048** — `d83b796` (feat)
2. **Task 2 (RED): failing ConversationRepository contract tests** — `441419f` (test)
3. **Task 2 (GREEN): SqliteConversationRepository + wire-up** — `1378a99` (feat)

_Note: Task 2 used TDD — the RED commit lands the 18 failing tests; the GREEN commit lands the implementation + barrel edits._

## Files Created/Modified

**Created:**
- `packages/dashboard/src/db/interfaces/conversation-repository.ts` — types (`Conversation`, `Message`, `MessageRole`, `MessageStatus`) + `ConversationRepository` interface with locked method surface and cross-org / rolling-window policy documented in jsdoc.
- `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` — `SqliteConversationRepository` class (228 lines). Prepared statements + transactional `appendMessage` with write-time rolling-window maintenance. Private `rowToConversation` / `rowToMessage` mappers translate snake_case SQL rows to camelCase public types.
- `packages/dashboard/tests/repositories/conversation-repository.test.ts` — 18 vitest tests across 5 groups (A: create+read+cross-org, B: appendMessage basics, C: rolling window 20-turn + pending + streaming exemption, D: restart durability, E: updateMessageStatus + COALESCE preservation).

**Modified:**
- `packages/dashboard/src/db/sqlite/migrations.ts` — appended migrations 047 + 048 to `DASHBOARD_MIGRATIONS` array (no existing entries touched).
- `packages/dashboard/src/db/adapter.ts` — added `ConversationRepository` import and `readonly conversations: ConversationRepository` field on `StorageAdapter` interface, directly below `brandScores`.
- `packages/dashboard/src/db/sqlite/index.ts` — added `SqliteConversationRepository` to the import list, field declaration, and constructor initializer alongside the other repos.
- `packages/dashboard/src/db/sqlite/repositories/index.ts` — added `SqliteConversationRepository` re-export.
- `packages/dashboard/src/db/interfaces/index.ts` — added `ConversationRepository` re-export.
- `packages/dashboard/src/db/index.ts` — added `ConversationRepository` to the existing named-type re-export block (top-level `@luqen/dashboard` db API).

## Verification Evidence (must_haves)

| SC | Must-have | Evidence |
|----|-----------|----------|
| SC-1 | Conversation survives a service restart | Group A + Group D tests: `createConversation` → `getConversation(id, orgA)` round-trips; the Group D test disconnects the adapter, reopens on the same temp-file path, and re-fetches the conversation + its `pending_confirmation` message with status intact. |
| SC-2 | 21st user turn flips oldest turn out of the window | Group C test "21st user turn flips the oldest turn to in_window = 0" — 20 full turns (40 rows) then 21st user message, asserts the first turn's two ids are NOT in `getWindow`, window size = 39 (41 rows − 2 oldest). |
| SC-2 | Newest 20 turns stay in window | Same Group C test: `windowAfter.length === 39` is exactly 20 turns × 2 rows − the new u21 row. The full 20-turn boundary is re-verified by the "25 user-only turns → window returns only last 20" test. |
| SC-2 / SC-4 | pending_confirmation + streaming stay in_window regardless of age | Two dedicated Group C tests insert a `pending_confirmation` (or `streaming`) row first, then push 25 user turns past it, and assert the old row is still returned by `getWindow` with `inWindow === true` and its status unchanged. |
| SC-4 | pending_confirmation persists across restart | Group D "a pending_confirmation row is recoverable after disconnect + reopen" test: `await storage.disconnect()` then `storage = new SqliteStorageAdapter(dbPath); await storage.migrate();` then re-queries full history, confirms status === 'pending_confirmation' and inWindow === true. |
| — | getWindow returns only in_window=1 ordered ASC; getFullHistory returns all rows | Group B test verifies both orderings; Group C tests cross-check that getFullHistory.length > getWindow.length after window flipping. |
| — | storage.conversations wired into StorageAdapter | Grep confirms `readonly conversations: ConversationRepository` in adapter.ts, `this.conversations = new SqliteConversationRepository(this.db)` in sqlite/index.ts, all four barrels re-export the type/class. |

### Test Output (vitest run — focused)

```
Test Files  1 passed (1)
     Tests  18 passed (18)
  Duration  2.42s
```

### Regression Sweep (full dashboard suite)

```
Test Files  176 passed | 3 skipped (179)
     Tests  2741 passed | 40 skipped (2781)
  Duration  168.34s
```

Zero regressions — pre-existing `skipped` counts are unchanged from prior to Phase 31.

### Acceptance-grep Evidence

```
packages/dashboard/src/db/sqlite/migrations.ts: id: '047'  ✓
packages/dashboard/src/db/sqlite/migrations.ts: id: '048'  ✓
packages/dashboard/src/db/sqlite/migrations.ts: agent-conversations-and-messages  ✓
packages/dashboard/src/db/sqlite/migrations.ts: agent-audit-log  ✓
packages/dashboard/src/db/sqlite/migrations.ts: CREATE TABLE IF NOT EXISTS agent_conversations  ✓
packages/dashboard/src/db/sqlite/migrations.ts: CREATE TABLE IF NOT EXISTS agent_messages  ✓
packages/dashboard/src/db/sqlite/migrations.ts: CREATE TABLE IF NOT EXISTS agent_audit_log  ✓
packages/dashboard/src/db/sqlite/migrations.ts: in_window INTEGER NOT NULL  ✓
packages/dashboard/src/db/sqlite/migrations.ts: CHECK (status IN ('sent','pending_confirmation'...  ✓
packages/dashboard/src/db/sqlite/migrations.ts: ON DELETE SET NULL  ✓
packages/dashboard/src/db/sqlite/migrations.ts: idx_agent_conversations_user_org_last  ✓
packages/dashboard/src/db/sqlite/migrations.ts: idx_agent_messages_conv_window_created  ✓
packages/dashboard/src/db/interfaces/conversation-repository.ts: export interface ConversationRepository  ✓
packages/dashboard/src/db/interfaces/conversation-repository.ts: type MessageStatus  ✓
packages/dashboard/src/db/interfaces/conversation-repository.ts: 'pending_confirmation'  ✓
packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts: export class SqliteConversationRepository  ✓
packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts: randomUUID  ✓
packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts: this.db.transaction  ✓
packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts: LIMIT 1 OFFSET 19  ✓ (corrected from OFFSET 20; see Deviations)
packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts: status NOT IN ('pending_confirmation', 'streaming')  ✓
packages/dashboard/src/db/adapter.ts: readonly conversations: ConversationRepository  ✓
packages/dashboard/src/db/sqlite/index.ts: new SqliteConversationRepository  ✓
packages/dashboard/src/db/interfaces/index.ts: ConversationRepository  ✓
packages/dashboard/src/db/sqlite/repositories/index.ts: SqliteConversationRepository  ✓
packages/dashboard/src/db/index.ts: ConversationRepository  ✓
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Rolling-window boundary off-by-one (OFFSET 20 → OFFSET 19)**

- **Found during:** Task 2 GREEN — initial implementation used `LIMIT 1 OFFSET 20` as the plan body specified; two Group C tests failed because the window retained 21 rows instead of 20.
- **Root cause:** `OFFSET 20` points to the 21st-most-recent user message. With 21 user messages in history (20 complete turns + a 21st user turn), `OFFSET 20` returns the oldest user message (u0), and the strict-less boundary (`created_at < u0.created_at`) flips NOTHING because nothing is older than u0. Plan result: 41-row window (all rows) instead of the expected 39-row window (41 − oldest 2-row turn). For 25 user-only turns, `OFFSET 20` = u4, flipping u0..u3 only, giving 21-row window instead of the expected 20.
- **Fix:** Changed to `LIMIT 1 OFFSET 19` (the 20th-most-recent user message). With 21 user messages in DESC order, `OFFSET 19` = u1; strict-less flips u0 and its assistant reply a0 → first turn falls out, 39 rows remain, test passes. For 25 messages, `OFFSET 19` = u5, flipping u0..u4 (5 rows), leaving 20 in window.
- **Files modified:** `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` (single statement change + expanded jsdoc explaining the OFFSET math).
- **Commit:** `1378a99` (the fix is baked into the GREEN commit itself — the test suite was run iteratively during implementation and the offset was corrected before commit).
- **Why this is a Rule 1 (bug) not a plan deviation:** The plan's success criteria and the CONTEXT.md policy ("last 20 turns") are the locked truth. The plan body's SQL suggestion used the wrong zero-index convention — OFFSET 20 yields 21-turn windows, contradicting the success criterion. The fix aligns the code with the spec, not against it.

**2. [Rule 2 — Missing critical functionality] Default pagination cap on getFullHistory / listForUser**

- **Found during:** Task 2 GREEN design review (threat T-31-04 from plan threat model).
- **Issue:** The interface types `ListConversationsOptions` allow unbounded `limit`, which could DOS a caller reading a 10k-message conversation.
- **Fix:** Added `const DEFAULT_PAGE_LIMIT = 200;` and `Math.min(options?.limit ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT)` on both list methods. This mirrors `audit-repository.ts`'s `Math.min(q.limit ?? 50, 200)` pattern referenced in CONTEXT.md.
- **Files modified:** `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts`.
- **Commit:** `1378a99` (landed with initial implementation; plan mentioned the default but did not lock the number).
- **Threat flag: threat_flag: dos-query — file: packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts — description:** DOS surface area mitigated with 200-row cap.

### Architectural Changes Considered

None — no Rule 4 checkpoints triggered. All contract details were either locked in CONTEXT.md or implied by the patterns in `role-repository.ts` / `audit-repository.ts`.

## Known Stubs

None. Every method is fully implemented with tests exercising the real SQL path.

## TDD Gate Compliance

Plan type is `execute` (not `tdd`), but the task-level `tdd="true"` cycle was followed for Task 2:

- RED: `441419f test(31): add failing conversation-repository contract tests`
- GREEN: `1378a99 feat(31): implement SqliteConversationRepository + StorageAdapter wire-up`

No REFACTOR commit was needed — the GREEN implementation already lands in the final shape (prepared statements + private mappers + documented rolling-window algorithm). The OFFSET-19 correction was an iterative GREEN fix within the single TDD cycle, not a post-GREEN refactor.

## Self-Check: PASSED

### File existence
- `packages/dashboard/src/db/interfaces/conversation-repository.ts` — FOUND
- `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` — FOUND
- `packages/dashboard/tests/repositories/conversation-repository.test.ts` — FOUND

### Commit existence
- `d83b796` — FOUND (Task 1 migrations)
- `441419f` — FOUND (Task 2 RED)
- `1378a99` — FOUND (Task 2 GREEN + wire-up)

### Integration checks
- `npx tsc --noEmit -p packages/dashboard/tsconfig.json` → exit 0 (PASSED)
- `npx vitest run tests/repositories/conversation-repository.test.ts --no-coverage` → 18/18 green (PASSED)
- `npx vitest run tests --no-coverage` (full dashboard suite) → 2741/2741 green + 40 pre-existing skips, zero regressions (PASSED)

## Handoff to Plan 02

Plan 02 (`AgentAuditRepository`) can begin immediately:
- Migration 048 (agent_audit_log DDL) is already live — Plan 02 only needs to add the repo + interface + tests.
- The wire-up pattern demonstrated here (barrel updates in interfaces/index.ts, repositories/index.ts, sqlite/index.ts, db/index.ts, adapter.ts) is the exact template for `storage.agentAudit`.
- Plan 02 MUST NOT touch the pre-existing `packages/dashboard/src/db/sqlite/repositories/audit-repository.ts` (generic HTTP/request audit); the new repo goes at `agent-audit-repository.ts` with a distinct field name `storage.agentAudit`.
