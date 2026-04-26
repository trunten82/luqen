---
phase: 36-multi-step-tool-use
plan: 01
subsystem: dashboard/agent-audit
tags: [audit, persistence, sqlite, atool-04, rationale]
requires:
  - storage.agentAudit (Phase 31)
  - migration framework (schema_migrations runner)
provides:
  - rationale TEXT column on agent_audit_log
  - AgentAuditEntry.rationale (string | null) on read
  - AppendAuditInput.rationale (string | null | undefined) on write
  - AgentAuditFilters.outcomeDetail (string | undefined) — opt-in filter
affects:
  - All call sites of storage.agentAudit.append (additive optional field, no breakage)
  - /admin/audit (future cap-hit chip filter, ATOOL-04 cap-hit UX)
tech-stack:
  added: []
  patterns:
    - Migration after id='056' (additive nullable ALTER, runner-guarded)
    - Filter builder extension via shared buildFilterQuery (mirrors existing audit-repo)
    - rationale ?? null defensive coalesce (handles undefined / null / pre-057 rows)
key-files:
  created: []
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
    - packages/dashboard/src/db/interfaces/agent-audit-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/agent-audit-repository.ts
    - packages/dashboard/tests/repositories/agent-audit-repository.test.ts
decisions:
  - Filter pushdown via WHERE outcome_detail = ? (no new index — LIMIT 200 cap bounds scan)
  - rationale stored as nullable TEXT, no length cap this phase (T-36-03 accepted)
  - undefined + null both coalesce to NULL on write (single source of truth)
metrics:
  duration: ~12 min
  completed: 2026-04-24
requirements: [ATOOL-04]
---

# Phase 36 Plan 01: Audit Log Rationale Schema + Filter Extension Summary

Extended the immutable agent audit log to durably store the model's tool-selection rationale and added an `outcomeDetail` filter so the upcoming `/admin/audit` cap-hit chip can scope to `iteration_cap` rows.

## Schema Diff

```sql
-- Migration 057 (id='057', name='agent-audit-log-rationale')
ALTER TABLE agent_audit_log ADD COLUMN rationale TEXT;
```

Nullable, no default. Pre-existing rows read back as `rationale: null`.

## Interface Diff

```ts
// AgentAuditEntry — mandatory on read
+ readonly rationale: string | null;

// AppendAuditInput — optional on write (undefined and null both → NULL)
+ readonly rationale?: string | null;

// AgentAuditFilters — opt-in filter
+ readonly outcomeDetail?: string;
```

The immutability docblock and Group F runtime contract assertions are unchanged: no `update*` / `delete*` methods added.

## Repository Behaviour

- `append({ rationale: 'because X' })` → row stored with rationale column populated.
- `append({})` (no rationale) and `append({ rationale: null })` → both store NULL.
- `getEntry` and `listForOrg` return `rationale: string | null` (defensive `?? null` in `rowToEntry`).
- `listForOrg(orgId, { outcomeDetail: 'iteration_cap' })` and `countForOrg` honour the filter.
- Existing `idx_agent_audit_log_org_created` continues to be sufficient — filter pushdown only fires after the org index narrows.

## Test Count Delta

| Group | Before | After |
|-------|--------|-------|
| A — append + getEntry | 7 | 7 |
| B — org isolation | 3 | 3 |
| C — filters | 7 | 7 |
| D — countForOrg basic | 2 | 2 |
| E — pagination + ordering | 3 | 3 |
| F — immutability | 3 | 3 |
| **G — rationale + outcomeDetail (new)** | 0 | **5** |
| **Total** | **25** | **30** |

Vitest reports 31 tests in this file (one Group A test contains a pre-existing nested case). All pass; no existing tests modified.

## Verification

- `npx tsc --noEmit` clean across `packages/dashboard`.
- `npx vitest run tests/repositories/agent-audit-repository.test.ts` → 31/31 passing.
- Migration 057 follows the same convention as 050/056 (additive nullable `ALTER TABLE`, schema_migrations runner guarantees one-shot apply).

## Threat Model Coverage

- **T-36-01 (Tampering on rationale):** Mitigated — INSERT uses bound parameter `@rationale`, no string concat. Immutability contract still forbids update methods.
- **T-36-02 (Info disclosure of PII rationale):** Mitigated by existing `/admin/audit` route guard (`admin.system OR admin.org`); org-scope guards on `listForOrg/getEntry/countForOrg` unchanged.
- **T-36-03 (Unbounded rationale length):** Accepted as planned. Rationale source is one assistant turn — bounded by provider context window.

## Deviations from Plan

None — plan executed exactly as written.

The only minor judgement call: I added a fifth Group G test (`G2b: rationale: null explicitly stores null`) alongside the four required tests, because `?? null` semantics differ for `undefined` vs explicit `null` and pinning both narrows the regression surface. Counted as a tightening of the contract, not a deviation.

## Commits

| Commit | Type | Message |
|--------|------|---------|
| `4e64a90` | feat | migration 057 + rationale/outcomeDetail interface fields |
| `63bb18c` | test | Group G failing tests (TDD RED) |
| `bd449db` | feat | persist rationale + outcome_detail filter (TDD GREEN) |

## Self-Check: PASSED

- FOUND: packages/dashboard/src/db/sqlite/migrations.ts (migration 057 entry present)
- FOUND: packages/dashboard/src/db/interfaces/agent-audit-repository.ts (rationale + outcomeDetail fields present)
- FOUND: packages/dashboard/src/db/sqlite/repositories/agent-audit-repository.ts (INSERT writes rationale; buildFilterQuery handles outcomeDetail)
- FOUND: packages/dashboard/tests/repositories/agent-audit-repository.test.ts (Group G — 5 tests added)
- FOUND: commit 4e64a90 (Task 1)
- FOUND: commit 63bb18c (Task 2 RED)
- FOUND: commit bd449db (Task 2 GREEN)
- Vitest: 31/31 passing
- tsc --noEmit: clean
