---
phase: 16-persistence-layer
plan: 03
subsystem: dashboard/db
tags: [repository, sqlite, org-repository, branding-mode, per-org-routing, phase-17-contract, literal-union]
requires:
  - 16-01 (migration 043 — organizations.branding_mode column with DEFAULT 'embedded')
provides:
  - OrgRepository.getBrandingMode(orgId) — typed literal-union read
  - OrgRepository.setBrandingMode(orgId, mode) — typed literal-union in-place write
  - Organization.brandingMode optional field on the shared domain type
  - narrowBrandingMode defensive helper — fail-fast on schema drift
  - Locked read/write contract for Phase 17 BrandingOrchestrator + Phase 19 admin UI
affects:
  - packages/dashboard/src/db/interfaces/org-repository.ts
  - packages/dashboard/src/db/sqlite/repositories/org-repository.ts
  - packages/dashboard/src/db/types.ts
  - packages/dashboard/tests/db/orgs-branding-mode.test.ts
tech-stack:
  added: []
  patterns:
    - Literal-union method signatures (`'embedded' | 'remote'`) inlined at every boundary — no named BrandingMode alias
    - Defensive narrowing helper on TEXT column reads (mirrors KNOWN_UNSCORABLE_REASONS in Plan 16-02)
    - Fail-fast rowToOrg throws on corrupt branding_mode — list reads surface data-integrity violations loudly
    - Per-request reads with zero caching (PROJECT.md decision honored)
key-files:
  created:
    - packages/dashboard/tests/db/orgs-branding-mode.test.ts
  modified:
    - packages/dashboard/src/db/interfaces/org-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/org-repository.ts
    - packages/dashboard/src/db/types.ts
decisions:
  - Literal union `'embedded' | 'remote'` is inlined at every boundary (interface method signatures, SqliteOrgRepository methods, Organization domain type, narrowBrandingMode helper). A named `BrandingMode` type alias was rejected — it would create a second place to update if the set ever grew, and the narrow literal union is already the single source of truth matching migration 043 + the Phase 15 Mode vocabulary.
  - rowToOrg fail-fast on corrupt `branding_mode` is LOCKED. A single corrupt value causes `getOrg`, `getOrgBySlug`, `listOrgs`, and `getUserOrgs` to throw from their entire result — intentional. Soft-fail (skip the field, return Organization without `brandingMode`) was rejected because it would mask a critical data-integrity event across page loads. Test 9 pins this behavior from the list read path.
  - No caching is introduced at any layer. `BrandingOrchestrator` (Phase 17) will call `getBrandingMode` on every scan; the orgs table is small and a single-row PK lookup is negligible next to a scan. PROJECT.md directive honored.
  - `setBrandingMode` is an in-place UPDATE — NOT a violation of Plan 16-02's append-only contract. Append-only applies to `brand_scores` (trend data). `organizations.branding_mode` is live per-org state that MUST be updatable. Test 5 (revert from remote back to embedded) proves the in-place mutation semantics.
  - `narrowBrandingMode` is the ONLY runtime defense against schema drift on this column. Unlike `brand_scores.mode` (which has a SQLite-level CHECK constraint from migration 043), `organizations.branding_mode` does NOT — the TypeScript literal union + this helper are the primary contracts. Defense in depth is still exercised on both the single-row read path (Test 8) and the list read path (Test 9).
metrics:
  duration: ~6m
  tasks_completed: 3
  completed_date: 2026-04-10
---

# Phase 16 Plan 03: OrgRepository Branding Mode Summary

Typed `getBrandingMode` / `setBrandingMode` methods land on `OrgRepository` + `SqliteOrgRepository` as the narrow literal-union `'embedded' | 'remote'` read/write pair over the `organizations.branding_mode` column from migration 043 — no caching, no `string` broadening, no named alias, and a `narrowBrandingMode` defensive helper that fails fast on schema drift from every read path (including `listOrgs`, which intentionally dies loudly on a single corrupt row rather than silently degrading).

## What Landed

### Interface Extension (packages/dashboard/src/db/interfaces/org-repository.ts)

Two new method signatures added immediately after `updateOrgBrandingClient` (keeping branding-related methods grouped):

```typescript
/**
 * Read the per-org branding routing mode.
 *
 * 'embedded' — scans and retags run through the in-process BrandingMatcher
 *              against the dashboard-local SQLite branding tables.
 * 'remote'   — scans and retags route through the @luqen/branding REST
 *              service via ServiceClientRegistry.getBrandingTokenManager().
 *
 * CRITICAL: Implementations MUST NOT cache this value. PROJECT.md decision:
 * per-request reads only.
 */
getBrandingMode(orgId: string): Promise<'embedded' | 'remote'>;

/**
 * Persist a new branding routing mode for the given org. Updates the row
 * in place — this is not an append-only history table.
 */
setBrandingMode(orgId: string, mode: 'embedded' | 'remote'): Promise<void>;
```

- Literal union inlined at both method signatures — no `string`, no imported named type, no `BrandingMode` alias.
- Method order otherwise untouched; Phase 17 planning can rely on the stable layout.

### Organization Domain Type Extension (packages/dashboard/src/db/types.ts)

Added a single optional field as the last field of the `Organization` interface, after the existing `llmClientSecret` field:

```typescript
readonly brandingMode?: 'embedded' | 'remote';
```

- Optional (`?:`) so non-SQLite storage adapters (Postgres/Mongo plugins) that haven't run migration 043 can leave it `undefined`, and existing call sites that construct `Organization` literals without it still compile.
- `readonly` modifier matches the existing convention on every field of this interface.
- Literal union inlined, not aliased.

### SqliteOrgRepository Implementation (packages/dashboard/src/db/sqlite/repositories/org-repository.ts)

Three surgical edits to the existing 259-line file:

**1. OrgRow extension** — added `branding_mode: string;` as the last field of the private row interface. Non-null (no `| null`) because migration 043 declares the column `NOT NULL DEFAULT 'embedded'`.

**2. narrowBrandingMode helper + rowToOrg extension** — added a new module-level helper immediately before `rowToOrg`:

```typescript
function narrowBrandingMode(value: string): 'embedded' | 'remote' {
  if (value === 'embedded' || value === 'remote') {
    return value;
  }
  throw new Error(`organizations.branding_mode has unexpected value: ${value}`);
}
```

`rowToOrg` now populates `brandingMode: narrowBrandingMode(row.branding_mode)` unconditionally (not via a conditional spread) because migration 043 guarantees the column is always non-null. The 11-line JSDoc block above the helper pins the LOCKED fail-fast decision for future readers.

**3. Two new class methods** — appended after `updateOrgLLMClient`:

```typescript
async getBrandingMode(orgId: string): Promise<'embedded' | 'remote'> {
  const row = this.db
    .prepare('SELECT branding_mode FROM organizations WHERE id = ?')
    .get(orgId) as { branding_mode: string } | undefined;
  if (row === undefined) {
    throw new Error(`organization not found: ${orgId}`);
  }
  return narrowBrandingMode(row.branding_mode);
}

async setBrandingMode(orgId: string, mode: 'embedded' | 'remote'): Promise<void> {
  const result = this.db
    .prepare('UPDATE organizations SET branding_mode = ? WHERE id = ?')
    .run(mode, orgId);
  if (result.changes === 0) {
    throw new Error(`organization not found: ${orgId}`);
  }
}
```

#### Exact SELECT SQL

```sql
SELECT branding_mode FROM organizations WHERE id = ?
```

Single-row primary-key lookup. Bounded cost. No unbounded scans.

#### Exact UPDATE SQL

```sql
UPDATE organizations SET branding_mode = ? WHERE id = ?
```

In-place mutation. `result.changes === 0` is the canonical better-sqlite3 "nothing was updated" detection (maps to `sqlite3_changes()`).

### Test Suite (packages/dashboard/tests/db/orgs-branding-mode.test.ts)

10 vitest cases using the same temp-file `SqliteStorageAdapter` + `storage.migrate()` pattern as `tests/db/orgs.test.ts` — end-to-end exercise of the Task 1 / Task 2 wiring on every test.

| # | Test | Behavior pinned |
|---|------|-----------------|
| 1 | returns embedded for a freshly created org (migration 043 DEFAULT) | `getBrandingMode` reflects the column DEFAULT without any explicit write |
| 2 | surfaces brandingMode on the Organization returned by getOrg | `rowToOrg` extension propagates the field to the domain type |
| 3 | round-trips setBrandingMode(remote) + getBrandingMode | Non-default literal value round-trips correctly |
| 4 | reflects the new mode on the Organization returned by getOrg after setBrandingMode | Generic read path (`getOrg`) picks up the update — not just the dedicated method |
| 5 | supports reverting from remote back to embedded (in-place mutation, not append-only) | UPDATE is a real in-place mutation; distinct from `brand_scores` append-only contract |
| 6 | throws when setBrandingMode is called with an unknown org id | `result.changes === 0` defensive check surfaces unknown orgs on write |
| 7 | throws when getBrandingMode is called with an unknown org id | Undefined-row defensive check surfaces unknown orgs on read |
| 8 | throws on read when branding_mode holds an unexpected value (defense in depth) | `narrowBrandingMode` rejects schema drift from the single-row read path |
| 9 | listOrgs fails fast when any row has a corrupt branding_mode | LOCKED: the list read path dies loudly on a single corrupt row — does NOT soft-fail |
| 10 | listOrgs returns orgs with their brandingMode populated | List reads survive the `OrgRow` extension; embedded + remote both surface |

Tests 8 and 9 use `storage.getRawDatabase()` to corrupt rows out-of-band, bypassing the typed `setBrandingMode` path. Without these tests a future schema drift (a plugin that writes an unexpected string, a direct SQL REPL edit, a third literal value added to a future migration without updating `narrowBrandingMode`) would silently be surfaced as a TypeScript-unsound value on the `Organization` domain type. Together they pin the "narrowBrandingMode throws from every read path" contract.

Test 5 is the only test that proves the UPDATE is in-place rather than append-only — without it a regression that accidentally inserted new rows instead of updating existing ones could still pass Tests 3 and 4.

## Verification

| Check | Result |
|-------|--------|
| `cd packages/dashboard && npm run lint` (tsc --noEmit) | PASS — 0 errors |
| `npx vitest run tests/db/orgs-branding-mode.test.ts` | PASS — 10/10 tests, 146ms |
| `npx vitest run tests/db/orgs.test.ts` (regression) | PASS — 18/18 tests |
| `npx vitest run tests/db/migration-043-brand-scores.test.ts tests/db/migrations.test.ts tests/db/orgs.test.ts tests/db/orgs-branding-mode.test.ts tests/db/brand-score-repository.test.ts` | PASS — 52/52 tests, 787ms |
| `grep -c "getBrandingMode(orgId: string): Promise<'embedded' \| 'remote'>" packages/dashboard/src/db/interfaces/org-repository.ts` | 1 |
| `grep -c "setBrandingMode(orgId: string, mode: 'embedded' \| 'remote'): Promise<void>" packages/dashboard/src/db/interfaces/org-repository.ts` | 1 |
| `grep -c "readonly brandingMode\?: 'embedded' \| 'remote'" packages/dashboard/src/db/types.ts` | 1 |
| `grep -c "branding_mode: string" packages/dashboard/src/db/sqlite/repositories/org-repository.ts` | 2 |
| `grep -c "narrowBrandingMode" packages/dashboard/src/db/sqlite/repositories/org-repository.ts` | 3 |
| `grep -c "brandingMode: narrowBrandingMode(row.branding_mode)" packages/dashboard/src/db/sqlite/repositories/org-repository.ts` | 1 |
| `grep -c "async getBrandingMode(orgId: string): Promise<'embedded' \| 'remote'>" packages/dashboard/src/db/sqlite/repositories/org-repository.ts` | 1 |
| `grep -c "async setBrandingMode(orgId: string, mode: 'embedded' \| 'remote'): Promise<void>" packages/dashboard/src/db/sqlite/repositories/org-repository.ts` | 1 |
| `grep -c "SELECT branding_mode FROM organizations" packages/dashboard/src/db/sqlite/repositories/org-repository.ts` | 1 |
| `grep -c "UPDATE organizations SET branding_mode" packages/dashboard/src/db/sqlite/repositories/org-repository.ts` | 1 |
| `grep -c "result.changes === 0" packages/dashboard/src/db/sqlite/repositories/org-repository.ts` | 1 |
| `grep -cE "BrandingMode\b\|BrandingRoute" packages/dashboard/src/db/interfaces/org-repository.ts` (excluding method names) | 0 alias types |
| `grep -ic "cache" packages/dashboard/src/db/sqlite/repositories/org-repository.ts` | 0 |
| `grep -ic "cache" packages/dashboard/src/db/interfaces/org-repository.ts` | 1 (JSDoc: "MUST NOT cache" — anti-cache directive, not an actual cache) |

## Deviations from Plan

**None.** All 3 tasks executed verbatim against the plan. No auto-fixes, no architectural changes, no auth gates, no blockers.

**Ordering note:** Task 1 (interface extension) was committed before Task 2 (SqliteOrgRepository implementation). Because Task 1 extends an interface that `SqliteOrgRepository` already implements, the exact commit hash of Task 1 (`8fc82fd`) has a transient typecheck failure in isolation — `SqliteOrgRepository` is missing the two new methods until commit `46e5310` (Task 2) lands. This is intentional and NOT a deviation: the plan defines the commits as atomic per-task units, and the pair always travels together. `git bisect` across these two commits would need to be aware of the transient state. Tree is green from commit `46e5310` forward.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `8fc82fd` | `feat(16-03): extend OrgRepository interface with branding mode methods` |
| 2 | `46e5310` | `feat(16-03): implement getBrandingMode/setBrandingMode on SqliteOrgRepository` |
| 3 | `6ed9587` | `test(16-03): add OrgRepository branding mode round-trip + fail-fast suite` |

## Downstream Contract (consumed by Phase 17 / Phase 19)

Phase 17 `BrandingOrchestrator` will call on every scan:

```typescript
const mode = await storage.organizations.getBrandingMode(orgId);
if (mode === 'embedded') {
  // Local BrandingMatcher against dashboard SQLite branding tables
} else {
  // Remote @luqen/branding REST via ServiceClientRegistry
}
```

Phase 19 admin UI handler will call:

```typescript
// Gate: require('organizations.manage') permission at the HTTP boundary
await storage.organizations.setBrandingMode(orgId, validated.mode);
// Phase 19 is responsible for audit_log emission; this repository does not log.
```

**Invariants downstream agents can rely on:**
- `getBrandingMode` returns the literal union — never `string`, never `null`, never `undefined`.
- `getBrandingMode` throws on unknown org id (matches the admin-handler precondition: "flip the mode of an org you already loaded").
- `setBrandingMode` throws on unknown org id via `result.changes === 0`.
- No cache exists anywhere — the next `getBrandingMode` call after a `setBrandingMode` always observes the new value with zero invalidation logic.
- A corrupt `branding_mode` value will throw from EVERY read path (`getOrg`, `getOrgBySlug`, `listOrgs`, `getUserOrgs`, `getBrandingMode`). Data-integrity violations surface loudly across all callers.
- The field is optional on the `Organization` domain type (`brandingMode?`) so non-SQLite adapters can leave it undefined. SQLite always populates it.

## Known Stubs

None. The repository methods wire directly to the `organizations.branding_mode` column; no placeholder state anywhere.

## Threat Flags

None. No new network endpoints, auth paths, file access, or schema changes beyond what Plan 16-01 already declared in migration 043. The Phase 19 admin handler (separate future plan) will carry its own threat model for the HTTP boundary.

## Self-Check: PASSED

- [x] `packages/dashboard/src/db/interfaces/org-repository.ts` — modified (2 methods + JSDoc)
- [x] `packages/dashboard/src/db/sqlite/repositories/org-repository.ts` — modified (OrgRow extension + narrowBrandingMode helper + rowToOrg extension + 2 new class methods)
- [x] `packages/dashboard/src/db/types.ts` — modified (1 optional field on Organization)
- [x] `packages/dashboard/tests/db/orgs-branding-mode.test.ts` — FOUND (137 lines, 10 tests)
- [x] Commit `8fc82fd` — FOUND in `git log`
- [x] Commit `46e5310` — FOUND in `git log`
- [x] Commit `6ed9587` — FOUND in `git log`
- [x] `npm run lint` exits 0
- [x] `vitest run tests/db/orgs-branding-mode.test.ts` — 10/10 pass
- [x] `vitest run tests/db/orgs.test.ts` — 18/18 pass (regression clean)
- [x] `vitest run tests/db/migration-043-brand-scores.test.ts tests/db/migrations.test.ts tests/db/orgs.test.ts tests/db/orgs-branding-mode.test.ts tests/db/brand-score-repository.test.ts` — 52/52 pass
- [x] `grep -ic "cache" …/sqlite/repositories/org-repository.ts` returns 0 (PROJECT.md no-cache honored)
- [x] `grep -c "result.changes === 0" …/sqlite/repositories/org-repository.ts` returns 1 (defensive check)
- [x] All 10 plan success criteria satisfied
