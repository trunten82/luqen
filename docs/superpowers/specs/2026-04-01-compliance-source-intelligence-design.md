# Compliance Source Intelligence Pipeline — Design Spec

**Date:** 2026-04-01
**Status:** Approved

## Problem

Compliance requirement data is maintained manually via a JSON seed file. The compliance service has monitoring infrastructure (source scanner, proposals, approval flow) but the scanner only detects content hash changes — it cannot parse regulatory content into structured WCAG requirements.

## Goals

1. Parse W3C WAI policy data into structured regulation/requirement records
2. Use LLM to extract WCAG requirements from government regulatory pages
3. Sync WCAG criteria reference data from upstream W3C/tenon sources
4. All changes go through the existing proposals pipeline for admin review
5. Document all external sources with attribution

## Architecture

Three parsers feed into the existing proposals pipeline:

```
W3C YAML Parser ──→ Structured requirements ──→ Diff against DB ──→ Proposal
Government URL  ──→ LLM extraction           ──→ Diff against DB ──→ Proposal
WCAG Upstream   ──→ Parse JSON               ──→ Diff against DB ──→ Proposal
```

All proposals require admin review. No auto-apply.

## External Sources

| Source | URL | License | Purpose |
|--------|-----|---------|---------|
| W3C WAI Policies Prototype | `github.com/w3c/wai-policies-prototype` | W3C Software License | Regulation metadata (47 countries) |
| W3C WCAG Quick Reference | `github.com/w3c/wai-wcag-quickref` | W3C Software License | WCAG 2.0/2.1 criteria data |
| tenon-io/wcag-as-json | `github.com/tenon-io/wcag-as-json` | MIT | WCAG 2.2 criteria data |

All licenses are permissive and compatible with MIT distribution. Data is fetched at runtime, not bundled. Attribution documented in `docs/compliance/external-sources.md`.

## Components

### 1. LLM Provider Interface

New interface in `packages/compliance/src/types.ts`:

```typescript
interface IComplianceLLMProvider {
  extractRequirements(pageContent: string, context: {
    regulationId: string;
    regulationName: string;
    currentWcagVersion?: string;
    currentWcagLevel?: string;
  }): Promise<ExtractedRequirements>;
}

interface ExtractedRequirements {
  wcagVersion: string;
  wcagLevel: string;
  criteria: Array<{
    criterion: string;
    obligation: 'mandatory' | 'recommended' | 'optional' | 'excluded';
    notes?: string;
  }>;
  confidence: number; // 0-1, included in proposal for admin context
}
```

Optional — injected by dashboard when an LLM plugin is configured. If not available, government URL changes create generic "content changed, manual review needed" proposals (current behavior).

### 2. W3C YAML Parser

**File:** `packages/compliance/src/parsers/w3c-parser.ts`

- Fetches country YAML files from `raw.githubusercontent.com/w3c/wai-policies-prototype/master/_policies/`
- Parses YAML frontmatter: regulation name, WCAG version, level, scope, enforcement date, URL
- Maps W3C policy entries to Luqen regulation/requirement format
- No LLM needed — rule-based parsing of well-structured YAML

**Fetch strategy:** GitHub raw content (unauthenticated). ~47 files, well under 60 req/hr rate limit.

### 3. WCAG Criteria Upstream Sync

**File:** `packages/compliance/src/parsers/wcag-upstream-parser.ts`

- Fetches `w3c/wai-wcag-quickref/_data/wcag21.json` for WCAG 2.0/2.1 criteria
- Fetches `tenon-io/wcag-as-json/wcag.json` for WCAG 2.2 criteria
- Normalizes both into the `wcag_criteria` table format
- Detects new criteria (e.g., WCAG 2.3/3.0 additions)

### 4. Requirement Differ

**File:** `packages/compliance/src/parsers/requirement-differ.ts`

- Takes: extracted requirements (from any parser) + current DB requirements for a regulation
- Produces: list of `ProposedChange` entries (create/update/delete requirement)
- Each change becomes a proposal in the existing pipeline
- Pure function, no side effects — easy to test

### 5. Enhanced Source Scanner

**Modify:** `packages/compliance/src/api/routes/sources.ts`

Add `sourceCategory` field to `MonitoredSource`:
- `'w3c-policy'` — routed to W3C YAML parser
- `'government'` — routed to LLM provider (or generic change detection)
- `'wcag-upstream'` — routed to WCAG criteria parser
- `'generic'` — current behavior (hash-based change detection only)

After detecting content change, the scanner routes to the appropriate parser instead of always creating a generic proposal.

### 6. Monitored Sources Update

**Seed data changes:**
- Add ~47 W3C policy YAML URLs as `w3c-policy` sources
- Add 2 WCAG upstream sources: Quick Ref JSON + tenon-io
- Keep existing government URLs as `government` sources
- Set `sourceCategory` on all sources

## Data Flow

1. Scheduled scan runs (configurable interval, default hourly)
2. For each due source: fetch content, compute SHA-256 hash
3. If hash unchanged: update `lastCheckedAt`, skip
4. If hash changed:
   - **w3c-policy**: W3C parser extracts regulation data → differ compares to DB → proposals created
   - **government**: LLM provider extracts requirements (if available) → differ compares to DB → proposals created. If no LLM: generic "content changed" proposal with diff summary
   - **wcag-upstream**: Criteria parser extracts entries → differ compares to DB → proposals created
   - **generic**: Current behavior (paragraph diff, generic proposal)
5. Admin reviews proposals in existing Proposals admin page
6. On approve: `applyChange` updates the DB records (already implemented)

## Schema Changes

### `monitored_sources` table — new column

```sql
ALTER TABLE monitored_sources ADD COLUMN source_category TEXT NOT NULL DEFAULT 'generic';
```

Values: `'w3c-policy'`, `'government'`, `'wcag-upstream'`, `'generic'`

### `MonitoredSource` type — add field

```typescript
readonly sourceCategory: 'w3c-policy' | 'government' | 'wcag-upstream' | 'generic';
```

### `CreateSourceInput` — add field

```typescript
readonly sourceCategory?: 'w3c-policy' | 'government' | 'wcag-upstream' | 'generic';
```

## LLM Integration

The compliance service defines the interface. The dashboard injects a concrete implementation when starting/configuring the compliance service.

**Without LLM configured:** Government source changes produce generic proposals with paragraph-level diffs. Admin manually interprets and creates requirement changes.

**With LLM configured:** Government source changes produce structured proposals with specific WCAG criteria, obligations, and confidence scores. Admin reviews and approves/rejects.

The LLM prompt includes:
- The page content (cleaned HTML → text)
- The regulation context (name, current version/level)
- Instruction to extract WCAG version, level, and per-criterion obligations
- Output format: JSON matching `ExtractedRequirements`

## Testing

- W3C parser: parse sample YAML files, verify extracted regulation data
- WCAG upstream parser: parse sample JSON, verify criteria extraction
- Requirement differ: unit tests with various change scenarios (additions, removals, obligation changes)
- LLM provider: mock interface, verify proposal generation
- Integration: seed DB → simulate source change → verify proposal created with correct changes

## Files

| File | Purpose |
|------|---------|
| `packages/compliance/src/types.ts` | Add IComplianceLLMProvider, ExtractedRequirements, sourceCategory |
| `packages/compliance/src/parsers/w3c-parser.ts` | NEW: W3C YAML policy parser |
| `packages/compliance/src/parsers/wcag-upstream-parser.ts` | NEW: WCAG criteria upstream sync |
| `packages/compliance/src/parsers/requirement-differ.ts` | NEW: Diff extracted vs DB requirements |
| `packages/compliance/src/api/routes/sources.ts` | Modify: route to parsers by sourceCategory |
| `packages/compliance/src/db/sqlite-adapter.ts` | Add sourceCategory column migration |
| `packages/compliance/src/seed/baseline.json` | Add W3C + upstream sources to seed data |
| `docs/compliance/external-sources.md` | NEW: External source attribution and licenses |
