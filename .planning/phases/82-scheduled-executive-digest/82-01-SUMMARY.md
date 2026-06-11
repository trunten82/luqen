---
phase: 82-scheduled-executive-digest
plan: "01"
subsystem: dashboard/db
tags: [migration, repository, digest, sqlite, types]
dependency_graph:
  requires: []
  provides:
    - digest_schedules SQLite table (migration 088)
    - DigestRepository interface
    - SqliteDigestRepository implementation
    - storage.digest wiring on SqliteStorageAdapter
    - DigestSchedule + CreateDigestScheduleInput types
  affects:
    - packages/dashboard/src/db/adapter.ts
    - packages/dashboard/src/db/sqlite/index.ts
tech_stack:
  added: []
  patterns:
    - Repository pattern (mirroring schedule-repository / email-repository)
    - Dynamic SET clauses for partial updates
    - JSON.parse/stringify for channels array storage
    - Parameterised better-sqlite3 bindings (no string concatenation)
key_files:
  created:
    - packages/dashboard/src/db/interfaces/digest-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/digest-repository.ts
    - packages/dashboard/tests/db/digest-repository.test.ts
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
    - packages/dashboard/src/db/types.ts
    - packages/dashboard/src/db/adapter.ts
    - packages/dashboard/src/db/sqlite/index.ts
    - packages/dashboard/src/db/sqlite/repositories/index.ts
decisions:
  - "digest slot on StorageAdapter is readonly digest?: DigestRepository (optional, not required) to avoid breaking third-party Postgres/Mongo adapter plugins — same rationale as reportIdentities, acrWording, entitlements"
  - "Permission seed goes inside migration 088 sql block (not a separate block) for atomicity and simplicity"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-11"
  tasks_completed: 2
  files_changed: 8
---

# Phase 82 Plan 01: Digest Schedule Data Layer Summary

**One-liner:** SQLite migration 088 + DigestRepository interface, SqliteDigestRepository (JSON channels, dynamic SET, getDue WHERE clause), and storage.digest wiring — DIGEST-01 data layer complete.

## What Was Built

### Task 1: Migration 088 + Types

- **Migration 088** (`create-digest-schedules`) appended to `migrations.ts` after `087`:
  - `CREATE TABLE IF NOT EXISTS digest_schedules` with all 12 columns: `id, org_id, name, site_url (nullable), frequency, recipients, channels (JSON), enabled, next_send_at, last_sent_at, created_by, created_at`
  - `CREATE INDEX IF NOT EXISTS idx_digest_schedules_next ON digest_schedules(next_send_at, enabled)` — optimises the `getDue` query
  - `INSERT OR IGNORE INTO role_permissions VALUES ('admin', 'digest.manage')` — global admin seed
  - `INSERT OR IGNORE INTO role_permissions SELECT id, 'digest.manage' FROM roles WHERE org_id != 'system' AND name IN ('Owner', 'Admin')` — existing org roles seed
  - Migration is fully idempotent (CREATE IF NOT EXISTS + INSERT OR IGNORE)

- **Types** appended to `db/types.ts`:
  - `DigestSchedule` interface: `channels: readonly string[]` (parsed), `siteUrl: string | null`
  - `CreateDigestScheduleInput` interface: `channels: string` (JSON for storage), `siteUrl: string | null`

### Task 2: Repository + Adapter Wiring + Tests

- **`db/interfaces/digest-repository.ts`**: `DigestRepository` interface with six methods
- **`db/sqlite/repositories/digest-repository.ts`**: `SqliteDigestRepository implements DigestRepository`
  - `DigestRow` private interface (snake_case columns, `channels: string`)
  - `digestRowToRecord()`: maps snake_case → camelCase, `JSON.parse(row.channels)`
  - `getDueDigestSchedules()`: `WHERE next_send_at <= @now AND enabled = 1`
  - `updateDigestSchedule()`: dynamic SET clauses, `enabled` mapped 1/0, no-op on empty data
  - All parameterised bindings (`@param`) — no string concatenation (T-82-02)
- **Adapter and wiring**:
  - `adapter.ts`: `readonly digest?: DigestRepository` + import
  - `sqlite/index.ts`: `readonly digest: SqliteDigestRepository`, `this.digest = new SqliteDigestRepository(this.db)`
  - `repositories/index.ts`: export added
- **Test** `tests/db/digest-repository.test.ts`: 15 tests — create/get round-trip + JSON.parse channels; getDue: past-due enabled returns, future excluded, disabled excluded, mixed scenario; update: toggle enabled, advance nextSendAt/lastSentAt, update name/recipients/frequency/channels, no-op; delete removes row — all green

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1    | 58415240 | feat(82-01): add digest_schedules migration 088 + DigestSchedule types |
| 2    | 996dbae2 | feat(82-01): DigestRepository interface + SqliteDigestRepository + adapter wiring |

## Verification

- `npx tsc --noEmit`: CLEAN (no TypeScript errors)
- `npx vitest run tests/db/digest-repository.test.ts`: 15/15 passed
- `grep "id: '088'"` migrations.ts: found at line 2230
- `grep "digest.manage"` migrations.ts: two INSERT OR IGNORE seeds confirmed
- `grep "idx_digest_schedules_next"` migrations.ts: CREATE INDEX confirmed
- `grep "export interface DigestSchedule"` db/types.ts: line 199
- `grep "export interface CreateDigestScheduleInput"` db/types.ts: line 214

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

| Threat ID | Mitigation Applied |
|-----------|--------------------|
| T-82-01 | listDigestSchedules filters by orgId; org_id stored on every row |
| T-82-02 | All statements use parameterised better-sqlite3 bindings (@param), zero string concatenation |
| T-82-03 | digest.manage seeded in migration 088; route enforcement deferred to Plan 04 |
| T-82-04 | channels written only as JSON.stringify(string[]) via createDigestSchedule; digestRowToRecord is the single JSON.parse read point |
| T-82-SC | No new dependencies added — reuses better-sqlite3 already in the project |

## Known Stubs

None — this is a pure data layer plan. No UI surfaces or stub values.

## Self-Check: PASSED

- `packages/dashboard/src/db/interfaces/digest-repository.ts` — FOUND
- `packages/dashboard/src/db/sqlite/repositories/digest-repository.ts` — FOUND
- `packages/dashboard/tests/db/digest-repository.test.ts` — FOUND
- Commit 58415240 — FOUND
- Commit 996dbae2 — FOUND
