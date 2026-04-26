---
phase: 37-streaming-ux-polish
plan: 01
subsystem: dashboard/agent-persistence
tags: [db, migrations, supersede, share-links, sqlite, repository, agent]
requires:
  - phase: 35-agent-conversation-history
    provides: ConversationRepository, agent_conversations soft-delete
  - phase: 31-agent-conversation-history
    provides: agent_messages table + status discriminator
provides:
  - migration 058 (agent_messages supersede + table rebuild)
  - migration 059 (agent_share_links table + indexes)
  - ConversationRepository.markMessageStopped
  - ConversationRepository.markMessagesSuperseded
  - ConversationRepository.getMessagesIncludingSuperseded
  - Message.supersededAt field
  - widened MessageStatus union: + 'final' | 'stopped' | 'superseded'
  - ShareLinkRepository (interface + SQLite impl)
  - StorageAdapter.shareLinks
affects:
  - 37-02..06 (route + UI plans consume these primitives)
  - any caller of getWindow/getFullHistory now sees superseded rows hidden by default
tech-stack:
  added: []
  patterns:
    - SQLite CHECK widening via copy-rename rebuild (prior art: migration 021)
    - Org-guarded UPDATE via EXISTS subquery on agent_conversations
    - base64url 16-byte tokens (crypto.randomBytes → 22-char URL-safe id)
    - Repo intentionally not org-guarded on getShareLink (T-37-02 disposition)
key-files:
  created:
    - packages/dashboard/src/db/interfaces/share-link-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/share-link-repository.ts
    - packages/dashboard/tests/db/migration-058-059.test.ts
    - packages/dashboard/tests/db/conversation-repository-supersede.test.ts
    - packages/dashboard/tests/db/share-link-repository.test.ts
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
    - packages/dashboard/src/db/interfaces/conversation-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts
    - packages/dashboard/src/db/adapter.ts
    - packages/dashboard/src/db/sqlite/index.ts
    - packages/dashboard/src/db/sqlite/repositories/index.ts
key-decisions:
  - "Migration 058 rebuilds agent_messages (copy-rename) to widen status CHECK constraint — required because the original CHECK from migration 047 rejects 'final', 'stopped', 'superseded' at write time."
  - "ShareLink.id uses crypto.randomBytes(16).toString('base64url') → 22 chars, 128 bits entropy."
  - "Default reads (getWindow, getFullHistory) exclude superseded rows; getMessagesIncludingSuperseded is the audit escape hatch."
  - "getShareLink does not enforce org check — that gate lives in the route handler (T-37-02)."
patterns-established:
  - "CHECK widening: when an existing CHECK blocks new statuses, rebuild via copy-rename rather than relying on application-layer enforcement only."
  - "Org-guarded message UPDATEs use EXISTS subquery against agent_conversations.org_id."
requirements-completed: [AUX-01, AUX-02, AUX-03, AUX-05]
duration: ~10 min
completed: 2026-04-25
---

# Phase 37 Plan 01: Streaming UX Polish — Persistence Foundation Summary

**Migrations 058 + 059 plus three repositories' worth of supersede/share primitives — agent_messages.status widened to include 'final/stopped/superseded' (table rebuilt to honour CHECK), three new ConversationRepository methods, and a brand-new ShareLinkRepository wired into StorageAdapter.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-25T09:40Z
- **Completed:** 2026-04-25T09:48Z
- **Tasks:** 3
- **Files modified:** 6
- **Files created:** 5
- **Tests added:** 34 (11 migration + 14 supersede + 9 share-link)

## Accomplishments

- Migration 058: rebuilds `agent_messages` to widen `status` CHECK to
  `('sent','pending_confirmation','approved','denied','failed','streaming','final','stopped','superseded')`,
  adds nullable `superseded_at TEXT`, and creates partial active-status index.
- Migration 059: creates `agent_share_links` table with FK CASCADE on
  conversation delete + supporting `org_id` and `conversation_id` indexes.
- `ConversationRepository`: three new org-guarded methods
  (`markMessageStopped`, `markMessagesSuperseded`, `getMessagesIncludingSuperseded`)
  plus widened `MessageStatus` union and `Message.supersededAt`.
- `getWindow` / `getFullHistory` updated to exclude `status='superseded'`
  by default — the linear-thread UI metaphor preserved without losing
  audit history.
- `ShareLinkRepository`: complete CRUD with 22-char base64url tokens;
  exposed via `StorageAdapter.shareLinks`.

## Task Commits

1. **Task 1: Migrations 058 + 059** — `ab66aae` (feat)
2. **Task 2 RED: failing supersede tests** — `3b805e0` (test)
3. **Task 2 GREEN: stopped/superseded methods + CHECK widening** — `aa43d8d` (feat)
4. **Task 3 RED: failing share-link tests** — `a897f5f` (test)
5. **Task 3 GREEN: ShareLinkRepository + storage wiring** — `64e83ce` (feat)

## Files Created/Modified

- `packages/dashboard/src/db/sqlite/migrations.ts` — added migrations 058 (table rebuild + supersede) and 059 (share_links)
- `packages/dashboard/src/db/interfaces/conversation-repository.ts` — widened `MessageStatus`, added `supersededAt`, three new methods
- `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` — implementations; `getWindow`/`getFullHistory` now filter superseded
- `packages/dashboard/src/db/interfaces/share-link-repository.ts` (new) — `ShareLinkRepository`, `ShareLink`, `CreateShareLinkInput`
- `packages/dashboard/src/db/sqlite/repositories/share-link-repository.ts` (new) — SQLite impl + token generator
- `packages/dashboard/src/db/sqlite/repositories/index.ts` — re-exports `SqliteShareLinkRepository`
- `packages/dashboard/src/db/adapter.ts` — `StorageAdapter.shareLinks: ShareLinkRepository`
- `packages/dashboard/src/db/sqlite/index.ts` — `SqliteStorageAdapter` constructs and exposes `shareLinks`
- `packages/dashboard/tests/db/migration-058-059.test.ts` (new) — 11 migration assertions
- `packages/dashboard/tests/db/conversation-repository-supersede.test.ts` (new) — 14 supersede/stopped/audit-read assertions
- `packages/dashboard/tests/db/share-link-repository.test.ts` (new) — 9 share-link assertions

## Decisions Made

- **CHECK widening via table rebuild** — see deviations.
- **Token format = base64url(randomBytes(16))** — exact match for plan spec; 22 chars, 128 bits entropy, no padding.
- **`anchor_message_id` nullable** — share at top of conversation needs no anchor.
- **`getShareLink` not org-guarded** — repo just hides revoked rows; the route handler (Plan 04) compares the requesting session's org to `link.orgId` before rendering. This matches the threat-register disposition (T-37-02 mitigate-via-route).
- **Stopped rows stay visible** — `getWindow` filters `status != 'superseded'` only; `'stopped'` rows render as the partial assistant turn with a "stopped" chip (Plan 02 UI concern).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing CHECK constraint on `agent_messages.status` rejected the new statuses**

- **Found during:** Task 2 GREEN (running supersede tests)
- **Issue:** The plan's behavior block stated "SQLite cannot ALTER an existing CHECK; therefore migration 058 instead [...] adds a `superseded_at TEXT` nullable column." But the original CHECK from migration 047 (`status IN ('sent','pending_confirmation','approved','denied','failed','streaming')`) is enforced at INSERT/UPDATE time — every test that called `markMessagesSuperseded` or `appendMessage({status:'final'})` failed with `SqliteError: CHECK constraint failed`. The plan's "enforce at app layer" guidance is unworkable while the DB constraint is alive.
- **Fix:** Rebuilt `agent_messages` via the standard SQLite copy-rename pattern (prior art: migration 021): create `agent_messages_new` with the widened CHECK, copy data with `superseded_at=NULL`, drop original, rename. All indexes from migration 047 (`idx_agent_messages_conv_created`, `idx_agent_messages_conv_window_created`) are recreated; the FK to `agent_conversations` (`ON DELETE CASCADE`) is preserved verbatim; the new partial active-status index is added.
- **Files modified:** `packages/dashboard/src/db/sqlite/migrations.ts` (migration 058 body)
- **Verification:** All 14 supersede tests pass; existing 14 conversation-repository tests + 161 agent suite tests stay green; `tsc --noEmit` clean.
- **Committed in:** `aa43d8d`

**2. [Rule 3 - Blocking] Plan referenced `getMessages` method that does not exist on `ConversationRepository`**

- **Found during:** Task 2 planning
- **Issue:** Plan task 2 behaviour block said "getMessages MUST default to excluding `status='superseded'`". The interface has `getWindow` and `getFullHistory` instead — there is no `getMessages` method.
- **Fix:** Applied the supersede filter to **both** `getWindow` and `getFullHistory` (every default read path); added `getMessagesIncludingSuperseded(conversationId, orgId)` for audit reads as plan-spec'd. Tests cover both default-read methods.
- **Files modified:** `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts`
- **Verification:** Tests `getWindow excludes superseded rows` and `getFullHistory excludes superseded rows by default` both pass.
- **Committed in:** `aa43d8d`

**3. [Rule 3 - Blocking] Plan referenced `packages/dashboard/src/db/sqlite/storage.ts` which does not exist**

- **Found during:** Task 3 planning
- **Issue:** Plan named `storage.ts` as the assembly file. The actual file is `packages/dashboard/src/db/sqlite/index.ts` (exporting `SqliteStorageAdapter`). The `StorageAdapter` interface lives in `packages/dashboard/src/db/adapter.ts`.
- **Fix:** Wired `shareLinks` through the real files: `adapter.ts` (interface), `sqlite/index.ts` (concrete adapter), `sqlite/repositories/index.ts` (re-export). Same end-state as the plan intended; just different file names.
- **Files modified:** `packages/dashboard/src/db/adapter.ts`, `packages/dashboard/src/db/sqlite/index.ts`, `packages/dashboard/src/db/sqlite/repositories/index.ts`
- **Verification:** `storage.shareLinks.createShareLink(...)` works in tests; tsc clean.
- **Committed in:** `64e83ce`

---

**Total deviations:** 3 auto-fixed (3 blocking — all Rule 3)
**Impact on plan:** All three deviations are pure environment-mismatch fixes. The plan's intent is preserved; the only material change is migration 058 ships an extra ~25 lines of table-rebuild SQL that the plan did not anticipate. No scope creep.

## Issues Encountered

None beyond the deviations documented above.

## Authentication Gates

None — pure data-layer work.

## Threat Register Status

| Threat ID | Disposition | Implemented |
|-----------|-------------|-------------|
| T-37-01 (Tampering on supersede) | mitigate | ✓ Org-guarded EXISTS subquery on agent_conversations.org_id; bulk UPDATE only touches matching rows |
| T-37-02 (Info disclosure via getShareLink) | mitigate | ✓ Repo hides revoked rows; org check deferred to route (Plan 04) by design |
| T-37-03 (Spoofing share id) | mitigate | ✓ `crypto.randomBytes(16).toString('base64url')` → 22 chars, 128 bits |
| T-37-04 (Repudiation on revoke) | accept | Audit emission deferred to route layer (Plan 03/04) |
| T-37-05 (DoS via listForConversation) | accept | Per-conversation share count naturally bounded |

## Threat Flags

None — no new network endpoints introduced. Surface is internal repository methods only.

## Known Stubs

None — all methods are fully implemented and exercised by tests.

## Verification

- `cd packages/dashboard && npx vitest run tests/db/migration-058-059.test.ts` — 11/11 pass
- `cd packages/dashboard && npx vitest run tests/db/conversation-repository-supersede.test.ts` — 14/14 pass
- `cd packages/dashboard && npx vitest run tests/db/share-link-repository.test.ts` — 9/9 pass
- `cd packages/dashboard && npx vitest run tests/db tests/repositories tests/agent` — 621/621 pass (full regression)
- `cd packages/dashboard && npx tsc --noEmit` — exits 0

## Next Phase Readiness

- Plans 02–06 of phase 37 can now persist stopped streams, branch on
  edit-resend, and resolve share permalinks against these primitives.
- `storage.shareLinks` is ready for the Plan 04 route handler to consume.
- `MessageStatus` widening is fully honoured by both the DB CHECK and the
  TypeScript union — no app-layer enforcement gap.

## Self-Check

- `packages/dashboard/src/db/sqlite/migrations.ts` migration 058 entry — FOUND (`id: '058'`)
- `packages/dashboard/src/db/sqlite/migrations.ts` migration 059 entry — FOUND (`id: '059'`)
- `packages/dashboard/src/db/interfaces/share-link-repository.ts` — FOUND
- `packages/dashboard/src/db/sqlite/repositories/share-link-repository.ts` — FOUND
- `packages/dashboard/tests/db/migration-058-059.test.ts` — FOUND
- `packages/dashboard/tests/db/conversation-repository-supersede.test.ts` — FOUND
- `packages/dashboard/tests/db/share-link-repository.test.ts` — FOUND
- Commit `ab66aae` (Task 1) — FOUND
- Commit `3b805e0` (Task 2 RED) — FOUND
- Commit `aa43d8d` (Task 2 GREEN) — FOUND
- Commit `a897f5f` (Task 3 RED) — FOUND
- Commit `64e83ce` (Task 3 GREEN) — FOUND
- Vitest db+repositories+agent suite: 621/621 pass
- `tsc --noEmit`: clean

## Self-Check: PASSED

---
*Phase: 37-streaming-ux-polish*
*Completed: 2026-04-25*
