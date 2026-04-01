# Granular WCAG-to-Regulation Compliance Mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace coarse wildcard WCAG-to-regulation mappings with per-criterion requirements, supporting inheritance, exclusions, cross-version references, and force-update.

**Architecture:** Add a `wcag_criteria` reference table to the compliance service. Expand wildcard requirements at seed time so the DB stores explicit per-criterion rows. Add `parentRegulationId` to regulations for inheritance. The matcher does simple exact lookups — no wildcards at runtime. Force-update deletes all system records and re-seeds.

**Tech Stack:** TypeScript, better-sqlite3, Fastify, Handlebars, Vitest

---

## Task 1: Schema changes — types, adapter, SQLite

**Files:**
- Modify: `packages/compliance/src/types.ts`
- Modify: `packages/compliance/src/db/adapter.ts`
- Modify: `packages/compliance/src/db/sqlite-adapter.ts`

- [ ] **Step 1: Add WcagCriterion type and update Regulation/Requirement types**

In `packages/compliance/src/types.ts`:

Add after the `Requirement` interface:
```typescript
export interface WcagCriterion {
  readonly id: string;
  readonly wcagVersion: '2.0' | '2.1' | '2.2';
  readonly level: 'A' | 'AA' | 'AAA';
  readonly criterion: string;
  readonly title: string;
  readonly description?: string;
  readonly url?: string;
  readonly orgId: string;
}
```

Add `parentRegulationId` to `Regulation`:
```typescript
readonly parentRegulationId?: string;
```

Add `parentRegulationId` to `CreateRegulationInput`:
```typescript
readonly parentRegulationId?: string;
```

Update `Requirement.obligation` to include `'excluded'`:
```typescript
readonly obligation: 'mandatory' | 'recommended' | 'optional' | 'excluded';
```

Same for `CreateRequirementInput.obligation`.

Add to `BaselineSeedData`:
```typescript
readonly wcagCriteria?: readonly {
  version: string; level: string; criterion: string;
  title: string; description?: string; url?: string;
}[];
```

- [ ] **Step 2: Add DbAdapter methods**

In `packages/compliance/src/db/adapter.ts`, add to the `DbAdapter` interface:

```typescript
// WCAG Criteria
listWcagCriteria(filters?: { version?: string; level?: string }): Promise<WcagCriterion[]>;
bulkCreateWcagCriteria(data: readonly {
  version: string; level: string; criterion: string;
  title: string; description?: string; url?: string;
}[]): Promise<void>;

// Force-delete system records
deleteAllSystemWcagCriteria(): Promise<void>;
deleteAllSystemRequirements(): Promise<void>;
deleteAllSystemRegulations(): Promise<void>;
deleteAllSystemJurisdictions(): Promise<void>;
deleteAllSystemSources(): Promise<void>;
```

Add `WcagCriterion` to the imports.

- [ ] **Step 3: Implement in sqlite-adapter.ts**

Add `wcag_criteria` table in `initialize()`:
```sql
CREATE TABLE IF NOT EXISTS wcag_criteria (
  id TEXT PRIMARY KEY,
  wcag_version TEXT NOT NULL,
  level TEXT NOT NULL,
  criterion TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  org_id TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX IF NOT EXISTS idx_wcag_criteria_version_level ON wcag_criteria(wcag_version, level);
```

Add `parent_regulation_id` migration in `initialize()`:
```typescript
const regCols = this.db.prepare("PRAGMA table_info(regulations)").all() as Array<{ name: string }>;
if (!regCols.some(c => c.name === 'parent_regulation_id')) {
  this.db.exec('ALTER TABLE regulations ADD COLUMN parent_regulation_id TEXT REFERENCES regulations(id)');
}
```

Implement `listWcagCriteria`, `bulkCreateWcagCriteria` (transaction with prepared insert), and all `deleteAllSystem*` methods (simple `DELETE FROM ... WHERE org_id = 'system'`).

Update `createRegulation` / `toRegulation` to handle `parent_regulation_id`.

Update `findRequirementsByCriteria` — remove `OR req.wcagCriterion = '*'`:
```sql
WHERE reg.jurisdictionId IN (${jPlaceholders})
  AND req.wcagCriterion IN (${cPlaceholders})
```

- [ ] **Step 4: Build**

Run: `npm run build -w packages/compliance`
Expected: Clean compilation

- [ ] **Step 5: Commit**

Message: `feat(compliance): add wcag_criteria table, parentRegulationId, excluded obligation`

---

## Task 2: Create wcag-criteria.json seed file

**Files:**
- Create: `packages/compliance/src/seed/wcag-criteria.json`

- [ ] **Step 1: Generate the WCAG criteria reference data**

JSON array with all WCAG 2.0, 2.1, and 2.2 criteria. Each entry:
```json
{ "version": "2.1", "level": "A", "criterion": "1.1.1", "title": "Non-text Content", "url": "https://www.w3.org/WAI/WCAG21/Understanding/non-text-content" }
```

Expected counts:
- WCAG 2.0: 25 A + 13 AA + 23 AAA = 61
- WCAG 2.1: 30 A + 20 AA + 28 AAA = 78 (includes all 2.0 criteria + 17 new)
- WCAG 2.2: 32 A + 24 AA + 31 AAA = 87 (includes all 2.1 criteria + 9 new)

Criteria present in multiple versions are listed per version. Use W3C specs as authoritative source. The dashboard's `packages/dashboard/src/routes/wcag-enrichment.ts` has 77 WCAG 2.1 A+AA entries as a starting reference.

- [ ] **Step 2: Commit**

Message: `feat(compliance): add wcag-criteria.json with WCAG 2.0/2.1/2.2 criteria`

---

## Task 3: Update baseline.json with inheritance and overrides

**Files:**
- Modify: `packages/compliance/src/seed/baseline.json`

- [ ] **Step 1: Add parentRegulationId to child regulations**

EU member state WAD implementations → `"parentRegulationId": "EU-WAD"`:
AT-WAG, BE-WAD, BG-WAD, HR-WAD, CY-WAD, CZ-WAD, DK-WAD, EE-WAD, FI-WAD, GR-WAD, HU-WAD, IE-WAD, IT-WAD, LV-WAD, LT-WAD, LU-WAD, MT-WAD, NL-WAB, PL-WAD, PT-WAD, RO-WAD, SK-WAD, SI-WAD, ES-WAD, SE-WAD

Country-specific laws that extend EU-WAD:
- DE-BITV → `"parentRegulationId": "EU-WAD"`
- FR-RGAA → `"parentRegulationId": "EU-WAD"`
- IT-STANCA → `"parentRegulationId": "EU-WAD"`
- ES-LSSICE → `"parentRegulationId": "EU-WAD"`

UK regulations:
- UK-PSBAR → `"parentRegulationId": "UK-EA"` (PSBAR builds on Equality Act)

Standalone (no parent): EU-EAA, EU-WAD, US-508, US-ADA, UK-EA, AU-DDA, CA-ACA, JP-JIS, etc.

- [ ] **Step 2: Add per-criterion overrides for key regulations**

DE-BITV adds mandatory AAA sign language requirements:
```json
{ "wcagVersion": "2.1", "wcagLevel": "AAA", "wcagCriterion": "1.2.6", "obligation": "mandatory", "notes": "Sign language for prerecorded content (BITV 2.0)" },
{ "wcagVersion": "2.1", "wcagLevel": "AAA", "wcagCriterion": "1.2.8", "obligation": "mandatory", "notes": "Media alternative for prerecorded content (BITV 2.0)" }
```

FR-RGAA recommends enhanced text formatting:
```json
{ "wcagVersion": "2.1", "wcagLevel": "AAA", "wcagCriterion": "1.4.8", "obligation": "recommended", "notes": "Visual Presentation — RGAA methodology" }
```

Remove duplicate wildcard requirements from child regulations that now inherit.

- [ ] **Step 3: Commit**

Message: `feat(compliance): add regulation inheritance and per-criterion overrides`

---

## Task 4: Rewrite seed loader with expansion and inheritance

**Files:**
- Modify: `packages/compliance/src/seed/loader.ts`
- Create: `packages/compliance/tests/seed/loader.test.ts`

- [ ] **Step 1: Write tests**

```typescript
describe('expandWildcard', () => {
  it('expands * at AA for WCAG 2.1 to all A + AA criteria', () => { ... });
  it('expands * at A for WCAG 2.0 to only A criteria', () => { ... });
});

describe('resolveInheritance', () => {
  it('child inherits all parent requirements', () => { ... });
  it('child override replaces parent obligation for same criterion', () => { ... });
  it('excluded obligation removes criterion from result', () => { ... });
  it('child adds cross-version criterion not in parent', () => { ... });
});

describe('topologicalSortRegulations', () => {
  it('parents come before children', () => { ... });
  it('standalone regulations maintain original order', () => { ... });
});

describe('seedBaseline force mode', () => {
  it('produces same result on double-run (idempotent)', async () => { ... });
  it('no wildcard rows remain in DB after seeding', async () => { ... });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement new seed loader**

Key exported functions:

`expandWildcard(wcagVersion, wcagLevel, allCriteria)` — returns all criteria at given level and below for version.

`resolveInheritance(parentReqs, childOverrides, regulationId)` — merges parent base with child overrides, removes excluded.

`topologicalSortRegulations(regulations)` — Kahn's algorithm, parents before children.

`seedBaseline(db, { force })` — main entry:
1. If force: delete all system records (requirements → regulations → jurisdictions → wcag_criteria → sources)
2. Bulk insert wcag_criteria from JSON
3. Upsert jurisdictions (parents first)
4. Upsert regulations (topological order)
5. For each regulation: expand wildcards using wcag_criteria, resolve inheritance from parent's expanded set, bulk insert requirements
6. Upsert monitored sources
7. Return counts

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Build**

Run: `npm run build -w packages/compliance`

- [ ] **Step 6: Commit**

Message: `feat(compliance): rewrite seed loader with wildcard expansion and inheritance`

---

## Task 5: Update checker — remove wildcard matching

**Files:**
- Modify: `packages/compliance/src/engine/checker.ts`
- Modify or create: `packages/compliance/tests/engine/checker.test.ts`

- [ ] **Step 1: Write tests**

- Contrast issue (1.4.3) matches EU-WAD as mandatory
- AAA issue (1.2.6) matches DE-BITV but NOT EU-WAD
- Unknown criterion returns no regulations
- Cross-version: WCAG 2.2 criterion matches only regulations that have it

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Simplify findMatchingRegulations**

Remove `wildcardLevelMatches` function. Update `findMatchingRegulations` to do exact criterion match only:

```typescript
function findMatchingRegulations(
  parsed: ParsedIssue,
  requirements: readonly RequirementWithRegulation[],
  regulationSectorCache: Map<string, readonly string[]>,
  sectorFilter: readonly string[],
): RequirementWithRegulation[] {
  if (parsed.criterion === null) return [];
  return requirements.filter(req => {
    if (req.wcagCriterion !== parsed.criterion) return false;
    if (sectorFilter.length > 0) {
      const regSectors = regulationSectorCache.get(req.regulationId) ?? [];
      if (!regulationMatchesSectors(regSectors, sectorFilter)) return false;
    }
    return true;
  });
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

Message: `refactor(compliance): remove wildcard matching, exact criterion only`

---

## Task 6: Force-reseed API, startup seed, scheduled reseed

**Files:**
- Modify: `packages/compliance/src/api/routes/seed.ts`
- Modify: `packages/compliance/src/api/server.ts`
- Modify: `packages/compliance/src/cli.ts`
- Modify: `packages/compliance/src/config.ts`

- [ ] **Step 1: Update seed route with force support**

In `seed.ts`, update POST `/api/v1/seed` to accept `{ force: boolean }` body. Add `POST /api/v1/admin/reseed` convenience endpoint (always force).

- [ ] **Step 2: Add startup seed and scheduled reseed**

In `config.ts`, add `reseedInterval` config field (default `'off'`, env `COMPLIANCE_RESEED_INTERVAL`).

In `server.ts`, add `onReady` hook: call `seedBaseline(db, { force: true })`. If `reseedInterval` is set, start an interval timer. Add `parseInterval(s)` helper to convert `"7d"`, `"24h"`, `"30m"` to milliseconds.

- [ ] **Step 3: Update CLI**

Add `--force` flag to `seed` command. Update action to pass `{ force: opts.force }`. Update output to show all counts including `wcagCriteria`.

- [ ] **Step 4: Build and test**

Run: `npm run build -w packages/compliance && npm test -w packages/compliance`

- [ ] **Step 5: Commit**

Message: `feat(compliance): force-reseed API, startup seed, scheduled reseed`

---

## Task 7: WCAG criteria API endpoint

**Files:**
- Create: `packages/compliance/src/api/routes/wcag-criteria.ts`
- Modify: `packages/compliance/src/api/server.ts`

- [ ] **Step 1: Create route**

`GET /api/v1/wcag-criteria` with optional `?version=2.1&level=AA` query filters. Returns `{ data: WcagCriterion[], total: number }`.

- [ ] **Step 2: Register in server.ts**

- [ ] **Step 3: Build**

- [ ] **Step 4: Commit**

Message: `feat(compliance): add GET /api/v1/wcag-criteria endpoint`

---

## Task 8: Dashboard reseed button on system health page

**Files:**
- Modify: `packages/dashboard/src/routes/admin/system.ts`
- Modify: `packages/dashboard/src/views/admin/system.hbs`
- Modify: `packages/dashboard/src/i18n/locales/en.json`

- [ ] **Step 1: Add POST /admin/system/reseed route**

Calls compliance service `POST /api/v1/admin/reseed` with the dashboard's service token. Returns toast with result counts and redirects to system page.

- [ ] **Step 2: Add button to system.hbs**

In the seed status section, add a "Re-seed Compliance Data" button with HTMX POST and confirm dialog.

- [ ] **Step 3: Add i18n key**

`"reseedCompliance": "Re-seed Compliance Data"`

- [ ] **Step 4: Build and test dashboard**

- [ ] **Step 5: Commit**

Message: `feat(dashboard): add reseed compliance data button to system health`

---

## Task 9: Dashboard compliance matrix — per-criterion obligation

**Files:**
- Modify: `packages/dashboard/src/services/report-service.ts`
- Modify: `packages/dashboard/src/views/report-detail.hbs`

- [ ] **Step 1: Include violation details in compliance matrix**

In `report-service.ts` `complianceMatrix` mapping, pass through per-regulation violation details (criterion + obligation + issue count) which are already in the compliance API response.

- [ ] **Step 2: Show per-criterion violations in template**

In the jurisdiction card body in `report-detail.hbs`, after regulation tags, render violation rows:
- Criterion code (monospace)
- Obligation badge (mandatory/recommended/optional)
- Issue count

Add minimal CSS for `.rpt-violation-row` layout.

- [ ] **Step 3: Build and test**

- [ ] **Step 4: Commit**

Message: `feat(dashboard): show per-criterion obligation in compliance matrix`

---

## Task 10: Integration test, full test suite, deploy

**Files:**
- Create: `packages/compliance/tests/integration/seed-and-check.test.ts`

- [ ] **Step 1: Write integration test**

Test end-to-end: seed in-memory DB → verify requirement counts per regulation → run compliance check → verify annotated issues have correct obligations.

Key assertions:
- EU-WAD: 50 requirements (WCAG 2.1 A+AA), no wildcards
- US-508: 38 requirements (WCAG 2.0 A+AA)
- DE-BITV: >50 requirements (inherits EU-WAD + AAA additions)
- Contrast issue (1.4.3) against EU jurisdiction → mandatory obligation
- Force reseed is idempotent

- [ ] **Step 2: Run full test suites**

Run: `npm test -w packages/compliance && npm test -w packages/dashboard`

- [ ] **Step 3: Commit and push**

Message: `test(compliance): integration test for seed expansion and compliance check`

- [ ] **Step 4: Deploy and verify on live**

After deploy, verify:
- Logs show seed completion with requirement counts
- System health page shows updated seed data
- Reseed button works
- Compliance matrix in reports shows per-criterion obligations
