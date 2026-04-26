---
phase: 08-system-brand-guideline
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/dashboard/src/db/sqlite/migrations.ts
  - packages/dashboard/src/db/sqlite/repositories/branding-repository.ts
  - packages/dashboard/src/db/branding-repository.ts
  - packages/dashboard/tests/db/branding-repository-system.test.ts
autonomous: true
requirements: [SYS-06]
objective: >
  Data foundation for system brand guidelines: migration 040 adds
  cloned_from_system_guideline_id column, repository gains
  listSystemGuidelines / cloneSystemGuideline methods, and the existing
  getGuidelineForSite resolver transparently returns system-scoped
  guidelines (single code path). Zero migration of existing data.
must_haves:
  truths:
    - "Migration 040 adds cloned_from_system_guideline_id TEXT column to branding_guidelines without touching any existing row"
    - "Repository can list all rows with org_id='system' via listSystemGuidelines()"
    - "Repository can clone a system guideline (plus colors, fonts, selectors) into an org as an independent row with cloned_from_system_guideline_id set"
    - "getGuidelineForSite returns a system guideline when site_branding.guideline_id points to an org_id='system' row — no new code path"
    - "Every existing branding_guidelines row and site_branding row works byte-identically to today"
  artifacts:
    - path: "packages/dashboard/src/db/sqlite/migrations.ts"
      provides: "Migration 040 adding cloned_from_system_guideline_id column"
      contains: "cloned_from_system_guideline_id"
    - path: "packages/dashboard/src/db/sqlite/repositories/branding-repository.ts"
      provides: "listSystemGuidelines, cloneSystemGuideline; getGuidelineForSite scope-aware"
      contains: "listSystemGuidelines"
    - path: "packages/dashboard/tests/db/branding-repository-system.test.ts"
      provides: "Tests for list, clone, and resolver-with-system-row flows"
  key_links:
    - from: "packages/dashboard/src/db/sqlite/repositories/branding-repository.ts:getGuidelineForSite"
      to: "site_branding JOIN branding_guidelines"
      via: "existing JOIN already selects g.* regardless of g.org_id"
      pattern: "JOIN site_branding"
---

<objective>
Ship the data foundation for Phase 08. Migration 040 adds a single nullable
column `cloned_from_system_guideline_id` to `branding_guidelines`. The
repository gains two new methods (`listSystemGuidelines`,
`cloneSystemGuideline`) and a scope-aware behaviour confirmation for
`getGuidelineForSite`. System guidelines are simply rows with
`org_id = 'system'` — the existing `'system'` sentinel used across the
codebase. No new table, no migration of existing data (D-17).

Purpose: Unblocks P02 (admin CRUD) and P03 (org System Library link/clone).
P04 verifies the pipeline end-to-end against this foundation.
Output: Working migration, repository methods, failing-then-passing tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-system-brand-guideline/08-CONTEXT.md
@.planning/phases/08-system-brand-guideline/08-UI-SPEC.md
@packages/dashboard/src/db/sqlite/migrations.ts
@packages/dashboard/src/db/sqlite/repositories/branding-repository.ts
@packages/dashboard/src/db/branding-repository.ts

<interfaces>
From packages/dashboard/src/db/sqlite/repositories/branding-repository.ts (existing shape):
```typescript
// BrandingGuidelineRecord is the return type for read methods; it includes
// id, org_id, name, description, version, is_active, created_at, updated_at
// and (via listColors/listFonts/listSelectors) the nested children.
// Existing methods on SQLiteBrandingRepository used here:
async listGuidelines(orgId: string): Promise<readonly BrandingGuidelineRecord[]>
async getGuideline(id: string): Promise<BrandingGuidelineRecord | null>
async createGuideline(input: CreateBrandingGuidelineInput): Promise<BrandingGuidelineRecord>
async getGuidelineForSite(siteUrl: string, orgId: string): Promise<BrandingGuidelineRecord | null>
async listColors(guidelineId: string)
async listFonts(guidelineId: string)
async listSelectors(guidelineId: string)
```

From packages/dashboard/src/db/branding-repository.ts (interface):
The BrandingRepository interface defines the contract both SQLite and any
other adapter must satisfy. New methods MUST be added here first.

Existing migration style (migrations.ts line 1127):
```typescript
{
  id: '039',
  name: 'add_scan_records_regulations_column',
  sql: `ALTER TABLE scan_records ADD COLUMN regulations TEXT NOT NULL DEFAULT '[]';`,
},
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write failing tests for migration 040 + listSystemGuidelines + cloneSystemGuideline + resolver</name>
  <files>packages/dashboard/tests/db/branding-repository-system.test.ts</files>
  <read_first>
    - packages/dashboard/tests/db/service-connections-repository.test.ts (for in-repo test style, migration runner invocation, fixture setup)
    - packages/dashboard/src/db/sqlite/repositories/branding-repository.ts (current shape, esp. createGuideline and getGuidelineForSite)
    - packages/dashboard/src/db/sqlite/migrations.ts (migration runner + migration 039 shape)
    - .planning/phases/08-system-brand-guideline/08-CONTEXT.md (decisions D-01, D-03, D-05, D-06, D-17)
    - .planning/phases/08-system-brand-guideline/08-UI-SPEC.md
  </read_first>
  <behavior>
    - Test 1 (migration): after migrations run, the branding_guidelines table has a `cloned_from_system_guideline_id` column (nullable, TEXT). Verify via PRAGMA table_info.
    - Test 2 (listSystemGuidelines): seed two rows with org_id='system' and one row with org_id='org-a'. listSystemGuidelines() returns exactly the two system rows, ordered by name.
    - Test 3 (listSystemGuidelines empty): with zero system rows, returns [].
    - Test 4 (cloneSystemGuideline): given a system guideline with 2 colors, 1 font, 1 selector, clone into org 'org-a' returns a new record where id !== source.id, org_id === 'org-a', name === '{source.name} (cloned)', cloned_from_system_guideline_id === source.id, colors.length === 2, fonts.length === 1, selectors.length === 1. Child rows are new records (different ids) that hang off the new guideline_id.
    - Test 5 (cloneSystemGuideline custom name): when a `name` override is passed, the clone uses that name verbatim.
    - Test 6 (cloneSystemGuideline rejects non-system source): calling clone on a row with org_id !== 'system' throws a descriptive error.
    - Test 7 (getGuidelineForSite with system row): seed a system guideline, assign it to a site under org 'org-a' via assignToSite, then getGuidelineForSite(siteUrl, 'org-a') returns the system guideline (org_id === 'system'), with its colors/fonts/selectors loaded. This verifies D-06 single code path.
    - Test 8 (getGuidelineForSite with org-owned row unchanged): seed an org-owned guideline, assign it, resolver returns the same row as today — byte-identical behavior (D-18).
    - Test 9 (cloned_from_system_guideline_id round-trip): a cloned row read via getGuideline returns the cloned_from_system_guideline_id field populated.
  </behavior>
  <action>
    Create packages/dashboard/tests/db/branding-repository-system.test.ts following the style of packages/dashboard/tests/db/service-connections-repository.test.ts.

    Boilerplate:
    - Use `better-sqlite3` in-memory DB: `new Database(':memory:')`
    - Run migrations via the same runner used in service-connections-repository.test.ts
    - Construct SQLiteBrandingRepository directly with the db handle
    - Use vitest: `import { describe, it, expect, beforeEach } from 'vitest'`

    Seeding helpers:
    - `createSystemGuideline(repo, name)` — calls repo.createGuideline({ orgId: 'system', name, ... }) and adds 2 colors, 1 font, 1 selector via repo.addColor/addFont/addSelector (check current method names in branding-repository.ts).
    - `createOrgGuideline(repo, orgId, name)` — same but orgId varies.

    Assertions MUST use exact literal values where possible (ids via uuid are opaque; assert !== source.id and typeof === 'string').

    Tests MUST FAIL on first run (column doesn't exist yet, methods don't exist yet). That is the RED step.

    Run:
    ```
    cd packages/dashboard && npx vitest run tests/db/branding-repository-system.test.ts
    ```
    Expected: FAIL with "no such column: cloned_from_system_guideline_id" and "listSystemGuidelines is not a function".
  </action>
  <verify>
    <automated>cd packages/dashboard && npx vitest run tests/db/branding-repository-system.test.ts 2>&1 | grep -E "(FAIL|no such column|is not a function)" || exit 1</automated>
  </verify>
  <acceptance_criteria>
    - File packages/dashboard/tests/db/branding-repository-system.test.ts exists
    - File contains string "listSystemGuidelines"
    - File contains string "cloneSystemGuideline"
    - File contains string "cloned_from_system_guideline_id"
    - File contains string "getGuidelineForSite"
    - File contains at least 9 `it(` or `test(` entries
    - Running the test file FAILS (RED phase) with errors referencing missing column or missing method
  </acceptance_criteria>
  <done>
    A failing test file that pins every behaviour listed under <behavior>. Committed as `test(08-P01): add failing tests for system brand guideline data layer`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Migration 040 + repository methods to make tests pass</name>
  <files>
    packages/dashboard/src/db/sqlite/migrations.ts,
    packages/dashboard/src/db/branding-repository.ts,
    packages/dashboard/src/db/sqlite/repositories/branding-repository.ts
  </files>
  <read_first>
    - packages/dashboard/src/db/sqlite/migrations.ts (full file; migration 039 sits at the bottom)
    - packages/dashboard/src/db/branding-repository.ts (the interface all adapters satisfy)
    - packages/dashboard/src/db/sqlite/repositories/branding-repository.ts (all existing methods: createGuideline, listGuidelines, getGuideline, listColors, listFonts, listSelectors, addColor, addFont, addSelector, assignToSite, getGuidelineForSite)
    - packages/dashboard/tests/db/branding-repository-system.test.ts (the tests written in Task 1 — implementation targets these)
    - .planning/phases/08-system-brand-guideline/08-CONTEXT.md (D-01, D-03, D-06)
  </read_first>
  <action>
    STEP A — Migration 040.

    Append to the migrations array in packages/dashboard/src/db/sqlite/migrations.ts (immediately after the entry with id: '039'):

    ```typescript
    {
      id: '040',
      name: 'add_branding_guidelines_cloned_from_system_guideline_id',
      sql: `
    ALTER TABLE branding_guidelines ADD COLUMN cloned_from_system_guideline_id TEXT;
      `,
    },
    ```

    Do NOT add a NOT NULL constraint. Do NOT set a DEFAULT. Existing rows must keep the column as NULL with zero data migration (D-17).

    STEP B — Extend the BrandingRepository interface.

    In packages/dashboard/src/db/branding-repository.ts add (preserve existing method signatures verbatim):

    ```typescript
    listSystemGuidelines(): Promise<readonly BrandingGuidelineRecord[]>;
    cloneSystemGuideline(
      sourceId: string,
      targetOrgId: string,
      overrides?: { name?: string }
    ): Promise<BrandingGuidelineRecord>;
    ```

    Also add `clonedFromSystemGuidelineId?: string | null` to the BrandingGuidelineRecord type definition (or equivalent row mapper — mirror existing optional fields).

    STEP C — Implement on SQLiteBrandingRepository (packages/dashboard/src/db/sqlite/repositories/branding-repository.ts).

    1. Update the internal GuidelineRow type to include `cloned_from_system_guideline_id: string | null`.
    2. Update guidelineRowToRecord() to copy `clonedFromSystemGuidelineId: row.cloned_from_system_guideline_id ?? null`.
    3. Update createGuideline's INSERT statement to include the new column (default value NULL).
    4. Implement listSystemGuidelines():
       ```typescript
       async listSystemGuidelines(): Promise<readonly BrandingGuidelineRecord[]> {
         const rows = this.db.prepare(
           "SELECT * FROM branding_guidelines WHERE org_id = 'system' ORDER BY name ASC"
         ).all() as GuidelineRow[];
         return Promise.all(rows.map(async (row) => ({
           ...guidelineRowToRecord(row),
           colors: await this.listColors(row.id),
           fonts: await this.listFonts(row.id),
           selectors: await this.listSelectors(row.id),
         })));
       }
       ```
    5. Implement cloneSystemGuideline(sourceId, targetOrgId, overrides):
       - Load source via getGuideline(sourceId); throw Error(`Source guideline ${sourceId} not found`) if null.
       - If source.orgId !== 'system' → throw Error(`Cannot clone non-system guideline ${sourceId}`).
       - Generate new UUID via randomUUID().
       - Determine clone name: `overrides?.name ?? ${source.name} (cloned)`.
       - Insert a new row in branding_guidelines with:
         - id: new uuid
         - org_id: targetOrgId
         - name: clone name
         - description, version, is_active: copied from source
         - cloned_from_system_guideline_id: sourceId
         - created_at, updated_at: new ISO timestamps
       - Insert child rows (colors, fonts, selectors) via existing addColor/addFont/addSelector (or equivalent) — each gets a fresh id but points to the new guideline id.
       - Wrap in a `this.db.transaction(() => { … })` and run it so partial failure rolls back.
       - Return the freshly-built record (id: new uuid, orgId: targetOrgId, clonedFromSystemGuidelineId: sourceId, plus nested children).
    6. getGuidelineForSite — DO NOT change the SELECT. The current JOIN already returns `g.*` regardless of `g.org_id`, so linked system guidelines resolve transparently (D-06). Only update the row mapper if step 2 is done correctly.

    STEP D — Run tests (GREEN).

    ```
    cd packages/dashboard && npx vitest run tests/db/branding-repository-system.test.ts
    ```
    Expected: all 9 tests PASS.

    STEP E — Regression.
    ```
    cd packages/dashboard && npx vitest run tests/db/
    ```
    Expected: pre-existing branding tests still pass.

    Commit as two atomic commits:
    1. `feat(08-P01): migration 040 adds cloned_from_system_guideline_id column`
    2. `feat(08-P01): branding repo listSystemGuidelines + cloneSystemGuideline + scope-aware resolver`
  </action>
  <verify>
    <automated>cd packages/dashboard && npx vitest run tests/db/branding-repository-system.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - packages/dashboard/src/db/sqlite/migrations.ts contains "id: '040'"
    - packages/dashboard/src/db/sqlite/migrations.ts contains "ALTER TABLE branding_guidelines ADD COLUMN cloned_from_system_guideline_id"
    - packages/dashboard/src/db/branding-repository.ts contains "listSystemGuidelines"
    - packages/dashboard/src/db/branding-repository.ts contains "cloneSystemGuideline"
    - packages/dashboard/src/db/sqlite/repositories/branding-repository.ts contains "WHERE org_id = 'system'"
    - packages/dashboard/src/db/sqlite/repositories/branding-repository.ts contains "Cannot clone non-system guideline"
    - packages/dashboard/src/db/sqlite/repositories/branding-repository.ts contains "this.db.transaction"
    - `cd packages/dashboard && npx vitest run tests/db/branding-repository-system.test.ts` exits 0 with all 9 tests passing
    - `cd packages/dashboard && npx vitest run tests/db/` exits 0 (no regressions)
  </acceptance_criteria>
  <done>
    Migration 040 applied on fresh DBs; repository exposes list + clone + scope-aware resolve; every test from Task 1 is green; pre-existing db/ tests still pass.
  </done>
</task>

</tasks>

<verification>
- Migration 040 applies cleanly on a fresh SQLite DB
- All 9 new repository tests pass
- No existing tests regress (packages/dashboard/tests/db/ suite is green)
- `cloned_from_system_guideline_id` column exists and is nullable (PRAGMA table_info confirms)
- getGuidelineForSite returns system-scoped rows transparently — no new code path added (D-06)
</verification>

<success_criteria>
SYS-06 is satisfied: system guidelines are purely additive. Every
pre-existing branding_guidelines row and site_branding row continues to
work byte-identically. The data foundation downstream plans depend on is
in place.
</success_criteria>

<output>
After completion, create `.planning/phases/08-system-brand-guideline/08-P01-data-foundation-SUMMARY.md`
</output>
