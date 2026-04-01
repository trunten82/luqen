# Granular WCAG-to-Regulation Compliance Mapping

**Date:** 2026-04-01
**Status:** Approved

## Problem

All 62 regulations use a single wildcard requirement (`wcagCriterion: "*"`) mapping to their WCAG level. This makes every regulation look identical — no per-criterion granularity, no obligation differences, no cross-version support, no inheritance between related regulations.

## Goals

1. Per-criterion requirement mappings for each regulation
2. Inheritance: child regulations (DE-BITV) inherit from parents (EU-WAD) with overrides
3. Exclusions: regulations can explicitly exclude criteria
4. Cross-version: a regulation can reference criteria from multiple WCAG versions
5. Force-update mechanism to refresh live compliance data
6. Dashboard shows per-criterion obligation in compliance matrix

## Schema Changes

### New table: `wcag_criteria`

```sql
CREATE TABLE wcag_criteria (
  id TEXT PRIMARY KEY,            -- e.g. "2.1-A-1.1.1"
  wcag_version TEXT NOT NULL,     -- "2.0", "2.1", "2.2"
  level TEXT NOT NULL,            -- "A", "AA", "AAA"
  criterion TEXT NOT NULL,        -- "1.1.1"
  title TEXT NOT NULL,            -- "Non-text Content"
  description TEXT,               -- short explanation
  url TEXT,                       -- W3C Understanding doc link
  org_id TEXT NOT NULL DEFAULT 'system'
);
```

Populated from seed file. Used for wildcard expansion at seed time. Dashboard can query criterion titles from the compliance API instead of its hardcoded `wcag-enrichment.ts` map.

### `regulations` table — new column

```sql
ALTER TABLE regulations ADD COLUMN parent_regulation_id TEXT REFERENCES regulations(id);
```

Informational only — not used by the matcher. Enables dashboard to show "DE-BITV (based on EU-WAD)".

### `requirements` table — new obligation value

Add `excluded` to valid obligation values: `mandatory | recommended | optional | excluded`.

Excluded means this criterion is explicitly not required by this regulation, even if the parent includes it. Excluded rows are removed during seed expansion — they never appear in the final DB.

### No other schema changes

The existing `requirements` table columns (`regulationId`, `wcagVersion`, `wcagLevel`, `wcagCriterion`, `obligation`, `notes`) already support everything needed.

## Seed Data Structure

### File layout

```
packages/compliance/src/seed/
  baseline.json          -- jurisdictions + regulations + requirements (overrides only)
  wcag-criteria.json     -- all WCAG 2.0/2.1/2.2 criteria (61 + 78 + 87 entries)
```

### `wcag-criteria.json` format

```json
[
  {
    "version": "2.0",
    "level": "A",
    "criterion": "1.1.1",
    "title": "Non-text Content",
    "url": "https://www.w3.org/WAI/WCAG21/Understanding/non-text-content"
  }
]
```

Criteria that exist across versions are listed per version. `1.1.1` appears under 2.0, 2.1, and 2.2.

### `baseline.json` changes

Regulations gain optional `parentRegulationId`. Requirements are overrides only for child regulations:

```json
{
  "id": "DE-BITV",
  "jurisdictionId": "DE",
  "parentRegulationId": "EU-WAD",
  "requirements": [
    { "wcagVersion": "2.1", "wcagLevel": "AAA", "wcagCriterion": "1.2.6", "obligation": "mandatory" },
    { "wcagVersion": "2.1", "wcagLevel": "AAA", "wcagCriterion": "1.2.8", "obligation": "mandatory" },
    { "wcagVersion": "2.1", "wcagLevel": "AAA", "wcagCriterion": "1.4.6", "obligation": "recommended" }
  ]
}
```

Standalone regulations keep wildcards in seed file (expanded at seed time):

```json
{
  "id": "US-508",
  "parentRegulationId": null,
  "requirements": [
    { "wcagVersion": "2.0", "wcagLevel": "AA", "wcagCriterion": "*", "obligation": "mandatory" }
  ]
}
```

### Seed script logic

1. Load `wcag-criteria.json` → upsert `wcag_criteria` table
2. Load `baseline.json` → upsert jurisdictions and regulations
3. Topologically sort regulations by `parentRegulationId` (parents before children)
4. For each regulation's requirements:
   - If `parentRegulationId` is set, copy the parent's already-expanded requirements as base
   - Expand any wildcards using `wcag_criteria` table (`*` at AA → all A+AA criteria for that version)
   - Apply overrides: child's specific criteria replace parent's for the same `(criterion, version)` key
   - Remove any with `obligation: "excluded"`
   - Write all rows to `requirements` table

After seeding, **no wildcard rows exist in the DB**. Every regulation has explicit per-criterion rows. The matcher does simple exact lookups.

## Matcher Changes

Minimal. Since wildcards are expanded at seed time, the matcher just queries requirements by exact criterion. No precedence logic, no runtime inheritance chain.

The existing `findMatchingRegulations()` in `engine/checker.ts` already works — it finds requirements matching a criterion. The only change: remove the wildcard matching code path since wildcards no longer exist in the DB.

## Force-Update Mechanism

### How it works

1. Delete all `org_id = 'system'` rows from: `wcag_criteria`, `requirements`, `regulations`, `jurisdictions`
2. Re-seed from JSON files in dependency order
3. Return summary: `{ criteria: N, jurisdictions: N, regulations: N, requirements: N }`

### Triggers

| Trigger | When | How |
|---------|------|-----|
| Startup | Every boot | `seedBaseline({ force: true })` in server startup |
| Scheduled | Configurable interval (default: weekly) | Timer in compliance service |
| API | On demand | `POST /api/v1/admin/reseed` (admin scope) |
| Dashboard | Manual | Button on System Health page calls the API |

### Configuration

```
COMPLIANCE_RESEED_INTERVAL=7d    # "24h", "7d", "off" to disable
```

### Future-proofing

When org-specific custom regulations are needed, force-update only deletes/replaces `org_id = 'system'` rows. Org-created records are untouched. The schema already supports this via the `org_id` column.

## Dashboard Changes

### Compliance matrix in reports

Show obligation per criterion in the compliance tab:

```
EU-WAD — 2 mandatory violations
  ❌ 1.1.1 Non-text Content [mandatory] — 3 errors
  ❌ 1.4.3 Contrast Minimum [mandatory] — 12 errors
  ✅ 1.3.1 Info and Relationships [mandatory] — pass
```

Changes:
- `report-service.ts`: Include obligation from matched requirement in annotated issues
- `report-detail.hbs`: Show obligation badge next to each criterion in compliance tab
- Remove hardcoded `wcag-enrichment.ts` criterion title map — titles come from compliance API

### Regulation display

When a regulation has `parentRegulationId`, show it:
- "DE-BITV (based on EU-WAD)" in the compliance matrix header

### System Health page

Add "Re-seed compliance data" button that calls `POST /api/v1/admin/reseed`.

## Example: Resolved Requirements

### EU-WAD (standalone, WCAG 2.1 AA)
Seed: `{ criterion: "*", level: "AA", obligation: "mandatory" }`
Expanded: **50 rows** (all WCAG 2.1 A + AA criteria, each mandatory)

### DE-BITV (inherits EU-WAD, adds AAA criteria)
Seed: 3 override rows (1.2.6, 1.2.8 mandatory + 1.4.6 recommended)
Expanded: **53 rows** (50 inherited + 3 German additions)

### IT-STANCA (inherits EU-WAD, excludes one, adds cross-version)
Seed: 3 override rows (1.2.3 excluded, 3.3.7 recommended, 1.4.3 with notes)
Expanded: **51 rows** (50 inherited - 1 excluded + 1 cross-version + 1 override with notes)

### US-508 (standalone, WCAG 2.0 AA)
Seed: `{ criterion: "*", level: "AA", obligation: "mandatory" }`
Expanded: **38 rows** (all WCAG 2.0 A + AA criteria)

## Testing

### Unit tests
- Wildcard expansion: `*` at AA for WCAG 2.1 → exactly 50 rows
- Inheritance: child gets parent's requirements + own overrides
- Exclusion: `excluded` removes criterion from expanded set
- Cross-version: WCAG 2.1 base + 2.2 addition → correct merged set
- Topological sort: parents seeded before children
- Force-update: idempotent (delete + re-seed = same result)

### Matcher tests
- Exact criterion lookup returns correct obligation
- Excluded criteria produce no match
- Cross-version criteria match correctly

### Integration test
- Seed → scan → compliance check → report with per-criterion obligations
- DE-BITV shows more requirements than EU-WAD for same violations
- US-508 matches only WCAG 2.0 criteria

### Live verification
- `GET /api/v1/requirements?regulationId=EU-WAD` → 50 rows
- `GET /api/v1/requirements?regulationId=DE-BITV` → 53 rows
- `GET /api/v1/requirements?regulationId=US-508` → 38 rows
