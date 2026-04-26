---
phase: 07-regulation-filter
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/compliance/src/types.ts
  - packages/compliance/src/api/routes/compliance.ts
  - packages/compliance/src/engine/checker.ts
  - packages/compliance/src/engine/checker.test.ts
  - packages/compliance/tests/api/compliance.test.ts
autonomous: true
requirements:
  - REG-02
  - REG-03
  - REG-04
must_haves:
  truths:
    - "POST /api/v1/compliance/check accepts an optional regulations[] body field"
    - "Request with jurisdictions=[] and regulations=[X] is accepted (no 400)"
    - "Response always includes regulationMatrix (empty object when no regulations requested)"
    - "Cache key differs between {jurisdictions:[X]} and {jurisdictions:[X],regulations:[Y]}"
    - "jurisdictions[]-only requests return byte-identical matrix/summary/annotatedIssues compared to previous behaviour"
    - "Requirements under explicitly-requested regulations' home jurisdictions are reachable even when not in jurisdictions[]"
  artifacts:
    - path: "packages/compliance/src/types.ts"
      provides: "ComplianceCheckRequest.regulations, ComplianceCheckResponse.regulationMatrix, RegulationMatrixEntry type"
      contains: "regulations?: readonly string[]"
    - path: "packages/compliance/src/api/routes/compliance.ts"
      provides: "Relaxed validation, cache key with regulations"
      contains: "regulations"
    - path: "packages/compliance/src/engine/checker.ts"
      provides: "Extended checker with regulationMatrix building"
      contains: "regulationMatrix"
    - path: "packages/compliance/src/engine/checker.test.ts"
      provides: "Unit tests for mixed/regs-only/backwards-compat/cache-key"
  key_links:
    - from: "api/routes/compliance.ts cacheKey()"
      to: "body.regulations"
      via: "sorted array in stable JSON"
      pattern: "regulations.*sort"
    - from: "engine/checker.ts checkCompliance()"
      to: "regulationMatrix"
      via: "per-regulation aggregation step"
      pattern: "regulationMatrix"
---

<objective>
Extend the compliance service API and checker engine so POST /api/v1/compliance/check accepts an optional `regulations[]` field and returns a new `regulationMatrix` keyed by regulationId alongside the existing jurisdiction `matrix`. Fix the cache key to include regulations. Relax validation to require jurisdictions OR regulations. Guarantee byte-for-byte backwards compatibility for jurisdictions-only callers (REG-04).

Purpose: This is the foundation of Phase 07. Every downstream concern (dashboard wiring, scan form, exports, reports) depends on this contract being correct.

Output: Typed request/response contract, relaxed validator, cache-key fix, extended checker engine, unit + integration tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/07-regulation-filter/07-CONTEXT.md

@packages/compliance/src/types.ts
@packages/compliance/src/api/routes/compliance.ts
@packages/compliance/src/engine/checker.ts

<interfaces>
Existing (DO NOT BREAK — freeze):

```typescript
// packages/compliance/src/types.ts
export interface ComplianceCheckRequest {
  readonly jurisdictions: readonly string[];
  readonly issues: readonly { code; type; message; selector; context; url? }[];
  readonly includeOptional?: boolean;
  readonly sectors?: readonly string[];
}

export interface JurisdictionResult {
  readonly jurisdictionId: string;
  readonly jurisdictionName: string;
  readonly status: 'pass' | 'fail';
  readonly mandatoryViolations: number;
  readonly recommendedViolations: number;
  readonly optionalViolations: number;
  readonly regulations: readonly RegulationResult[];  // <-- NESTED, existing
}

// NOTE: RegulationResult ALREADY EXISTS at line 160 as a nested type with shape:
//   { regulationId, regulationName, shortName, status: 'pass' | 'fail',
//     enforcementDate, scope, violations: [...] }
// Its `status` union is 'pass' | 'fail' (not including 'partial').
// To avoid a name collision and a breaking change, introduce a NEW type
// `RegulationMatrixEntry` for the top-level regulationMatrix (see action below).

export interface ComplianceCheckResponse {
  readonly matrix: Record<string, JurisdictionResult>;
  readonly annotatedIssues: readonly AnnotatedIssue[];
  readonly summary: { totalJurisdictions; passing; failing; totalMandatoryViolations; totalOptionalViolations };
}
```

Existing cache key function at `packages/compliance/src/api/routes/compliance.ts` lines 14-27 — currently omits `regulations`.

Existing checker algorithm at `packages/compliance/src/engine/checker.ts`:
- Step 3 (line 80-82): resolves jurisdictions → ancestors
- Step 4 (line 84-88): calls `db.findRequirementsByCriteria(allJurisdictionIds, uniqueCriteria, orgId)`
- Step 7 (line 127-149): builds jurisdiction matrix
- `buildJurisdictionResult` at line 193 filters requirements by `hierIds.has(r.jurisdictionId)` and groups per regulation.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend types, validation, and cache key (REG-02, REG-04)</name>
  <files>
    packages/compliance/src/types.ts
    packages/compliance/src/api/routes/compliance.ts
    packages/compliance/tests/api/compliance.test.ts
  </files>
  <read_first>
    - packages/compliance/src/types.ts lines 134-200 (current ComplianceCheckRequest, JurisdictionResult, nested RegulationResult, ComplianceCheckResponse)
    - packages/compliance/src/api/routes/compliance.ts entire file (cacheKey function lines 14-27, handler lines 29-77)
    - packages/compliance/tests/api/compliance.test.ts — mirror existing test structure (vitest) for the new scenarios
    - .planning/phases/07-regulation-filter/07-CONTEXT.md decisions D-01, D-05a, D-06, D-07, D-12, D-31, D-33
  </read_first>
  <behavior>
    - Test A (REG-02): POST /api/v1/compliance/check with body { jurisdictions:['EU'], regulations:['EN301549'], issues:[] } → 200, body.regulationMatrix is an object (may be empty {} if no issues)
    - Test B (D-05a): POST with body { jurisdictions:[], regulations:['EN301549'], issues:[] } → 200 (NOT 400)
    - Test C (D-05a): POST with body { jurisdictions:[], regulations:[], issues:[] } → 400, error message === 'jurisdictions or regulations array is required'
    - Test D (D-33): POST with body { jurisdictions:['EU'], issues:[] } (no regulations field) → 200, response.regulationMatrix === {} (field present, empty object — NOT undefined, NOT omitted)
    - Test E (REG-04): snapshot test — POST with body { jurisdictions:['EU'], issues:[<one real issue>] } → response.matrix, response.summary, response.annotatedIssues match stored snapshot byte-for-byte (regulationMatrix === {} is the only addition)
    - Test F (D-06 cache key): two requests with bodies { jurisdictions:['EU'], issues:[...] } vs { jurisdictions:['EU'], regulations:['EN301549'], issues:[...] } — first populates cache, second MUST return X-Cache:MISS (different keys). Assert directly on the cacheKey() function if exported, or via header.
  </behavior>
  <action>
    1. In `packages/compliance/src/types.ts`:
       - Extend `ComplianceCheckRequest` (line 136) to add `readonly regulations?: readonly string[];` as the last optional field before the existing optional fields. Final shape:
         ```typescript
         export interface ComplianceCheckRequest {
           readonly jurisdictions: readonly string[];
           readonly regulations?: readonly string[];
           readonly issues: readonly { ... }[];
           readonly includeOptional?: boolean;
           readonly sectors?: readonly string[];
         }
         ```
       - IMPORTANT: keep `jurisdictions` as `readonly string[]` (NOT optional) — the relaxation is enforced at the route validator, not the type. Zero type-level breakage for existing callers.
       - Add a NEW type `RegulationMatrixEntry` immediately after `JurisdictionResult` (around line 173). Do NOT rename or modify the existing nested `RegulationResult` (line 160) — it stays for backwards compat inside `JurisdictionResult.regulations`.
         ```typescript
         export interface RegulationMatrixEntry {
           readonly regulationId: string;
           readonly regulationName: string;
           readonly shortName: string;
           readonly jurisdictionId: string;    // regulation's home jurisdiction
           readonly status: 'pass' | 'fail' | 'partial';
           readonly mandatoryViolations: number;
           readonly recommendedViolations: number;
           readonly optionalViolations: number;
           readonly violatedRequirements: readonly {
             readonly wcagCriterion: string;
             readonly obligation: 'mandatory' | 'recommended' | 'optional';
             readonly issueCount: number;
           }[];
         }
         ```
       - Extend `ComplianceCheckResponse` (line 189) to add `readonly regulationMatrix: Record<string, RegulationMatrixEntry>;` as a required (non-optional) field directly after `matrix`. This is safe: new field, existing clients ignore unknown fields.

    2. In `packages/compliance/src/api/routes/compliance.ts`:
       - Update `cacheKey()` (lines 14-27) stable JSON to include regulations:
         ```typescript
         const stable = JSON.stringify({
           orgId: orgId ?? null,
           jurisdictions: [...body.jurisdictions].sort(),
           regulations: [...(body.regulations ?? [])].sort(),
           issues: [...body.issues].map(i => ({ code: i.code, type: i.type, selector: i.selector })).sort((a,b) => a.code.localeCompare(b.code)),
           includeOptional: body.includeOptional ?? false,
           sectors: (body.sectors ?? []).slice().sort(),
         });
         ```
       - Replace validation block (lines 42-45):
         ```typescript
         const hasJurisdictions = Array.isArray(body.jurisdictions) && body.jurisdictions.length > 0;
         const hasRegulations = Array.isArray(body.regulations) && body.regulations.length > 0;
         if (!hasJurisdictions && !hasRegulations) {
           await reply.status(400).send({ error: 'jurisdictions or regulations array is required', statusCode: 400 });
           return;
         }
         ```
       - Normalize `body.jurisdictions` to `[]` if absent before passing to the checker (so jurisdictions can be empty when regulations-only): `const normalizedBody = { ...body, jurisdictions: body.jurisdictions ?? [], regulations: body.regulations ?? [] };` and pass `normalizedBody` to `checkCompliance` and `cacheKey`.
       - Export `cacheKey` for unit-testability (add `export` to the function declaration). D-06 requires a dedicated unit test — exporting is the cleanest path.

    3. Add/extend `packages/compliance/tests/api/compliance.test.ts`:
       - Add a `describe('regulations filter')` block with tests A-F from <behavior>.
       - For Test E, capture the current response shape with jurisdictions-only + a representative fixture issue as a JSON snapshot under `packages/compliance/tests/api/__snapshots__/compliance-backwards-compat.snap.json` using vitest's `toMatchSnapshot`. The snapshot MUST already exist from a first run before regulationMatrix is added, OR (if running fresh) compare every top-level field EXCEPT `regulationMatrix` to the legacy shape.
       - For Test F, import `cacheKey` directly and assert `cacheKey({jurisdictions:['EU'],issues:[],regulations:[]}, 'org1') !== cacheKey({jurisdictions:['EU'],issues:[],regulations:['R1']}, 'org1')`.
  </action>
  <verify>
    <automated>cd /root/luqen/packages/compliance && npx tsc --noEmit && npx vitest run tests/api/compliance.test.ts</automated>
  </verify>
  <done>
    - `grep -n 'regulations?: readonly string' packages/compliance/src/types.ts` returns one match
    - `grep -n 'RegulationMatrixEntry' packages/compliance/src/types.ts` returns at least 2 matches (declaration + use in ComplianceCheckResponse)
    - `grep -n 'regulationMatrix' packages/compliance/src/types.ts` returns at least one match
    - `grep -n 'jurisdictions or regulations array is required' packages/compliance/src/api/routes/compliance.ts` returns exactly one match
    - `grep -n 'regulations:.*sort' packages/compliance/src/api/routes/compliance.ts` returns a match inside cacheKey
    - `grep -n '^export function cacheKey\|^export const cacheKey' packages/compliance/src/api/routes/compliance.ts` returns a match
    - `cd packages/compliance && npx vitest run tests/api/compliance.test.ts` exits 0 with all 6 new tests passing
    - `cd packages/compliance && npx tsc --noEmit` exits 0
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend checker engine to build regulationMatrix (REG-03, REG-04)</name>
  <files>
    packages/compliance/src/engine/checker.ts
    packages/compliance/src/engine/checker.test.ts
  </files>
  <read_first>
    - packages/compliance/src/engine/checker.ts entire file (checkCompliance at line 58, buildJurisdictionResult at line 193)
    - packages/compliance/src/engine/checker.test.ts — mirror existing test cases to understand fixture setup (mock DbAdapter, sample requirements)
    - packages/compliance/src/db/adapter.ts — confirm `getRegulation(id)` returns `{ id, jurisdictionId, name, shortName, ... } | null` and that `findRequirementsByCriteria(jurisdictionIds, criteria, orgId)` accepts a string[] of jurisdiction ids
    - .planning/phases/07-regulation-filter/07-CONTEXT.md decisions D-08, D-09, D-10, D-11, D-12, D-31
  </read_first>
  <behavior>
    - Test 1 (D-31 backwards compat): `checkCompliance({ jurisdictions:['EU'], regulations: undefined, issues:[<fixture>] }, db)` → result.regulationMatrix === {}, result.matrix + result.summary + result.annotatedIssues unchanged from the pre-phase baseline
    - Test 2 (REG-03 mixed): `checkCompliance({ jurisdictions:['DE'], regulations:['ADA'], issues:[<fixture with violations matching both>] }, db)` → result.matrix has key 'DE', result.regulationMatrix has key 'ADA', both populated; requirements appear exactly once in the internal requirements set (no double-count in summary totals)
    - Test 3 (regulations-only): `checkCompliance({ jurisdictions:[], regulations:['EN301549'], issues:[...] }, db)` → result.matrix === {}, result.regulationMatrix has key 'EN301549' with correct status/counts
    - Test 4 (D-08 home-jurisdiction widening): regulation 'ADA' lives in jurisdiction 'US-FED'; request with jurisdictions:[], regulations:['ADA'] → the checker queries requirements with jurisdictionIds including 'US-FED' (not just the resolved-ancestor-set of the empty jurisdictions input)
    - Test 5 (unknown regulation id): request with regulations:['DOES_NOT_EXIST'] → does NOT throw; that regulation is simply absent from the regulationMatrix; warning logged via the existing logger pattern
    - Test 6 (D-12 status union): a regulation with only optional violations and `includeOptional:true` → status === 'partial'; a regulation with mandatory violations → 'fail'; a regulation with no violations → 'pass'
  </behavior>
  <action>
    1. In `packages/compliance/src/engine/checker.ts` modify `checkCompliance`:
       - Destructure `regulations` from request with default `[]`: `const { jurisdictions, regulations = [], issues, includeOptional = false, sectors: sectorFilter = [] } = request;`
       - Between Step 3 (resolve jurisdictions) and Step 4 (query requirements), add:
         ```typescript
         // Step 3b: Look up home jurisdictions for explicit regulations (D-08)
         const explicitRegulationMeta = new Map<string, { regulation: Regulation; homeJurisdictionId: string }>();
         for (const regId of regulations) {
           const reg = await db.getRegulation(regId);
           if (reg == null) {
             request.log?.warn?.({ regulationId: regId }, 'Unknown regulation id in compliance check — skipping');
             continue;
           }
           explicitRegulationMeta.set(regId, { regulation: reg, homeJurisdictionId: reg.jurisdictionId });
           if (!resolvedJurisdictionIds.has(reg.jurisdictionId)) {
             resolvedJurisdictionIds.add(reg.jurisdictionId);
           }
         }
         ```
         NOTE: `request.log` is not on ComplianceCheckRequest — pass a logger param or use `console.warn` if no logger. Follow existing engine conventions — if the file has no logger, use `console.warn` gated behind a guard (match existing unknown-jurisdiction handling if any).
       - Recompute `allJurisdictionIds = [...resolvedJurisdictionIds]` AFTER the insertion above so the requirements query sees the widened set.
       - Keep Step 4 (requirements query) unchanged — it uses the already-widened `allJurisdictionIds`.
       - Keep Step 7 (jurisdiction matrix) unchanged — it iterates over the ORIGINALLY-requested `jurisdictions`, which is empty for regulations-only requests, producing `matrix: {}`. This matches D-31 (jurisdictions-only responses unchanged) and the regulations-only spec.
       - After Step 7, add Step 7b: build the regulation matrix:
         ```typescript
         // Step 7b: Build regulation matrix for each originally-requested regulation (D-07, D-12)
         const regulationMatrix: Record<string, RegulationMatrixEntry> = {};
         for (const regId of regulations) {
           const meta = explicitRegulationMeta.get(regId);
           if (meta == null) continue; // unknown — skipped with warning above
           const { regulation, homeJurisdictionId } = meta;
           // Filter requirements to this regulation only
           const regReqs = requirements.filter(r => r.regulationId === regId);
           let mandatory = 0, recommended = 0, optional = 0;
           const violationsMap = new Map<string, { wcagCriterion: string; obligation: 'mandatory'|'recommended'|'optional'; issueCount: number }>();
           for (const req of regReqs) {
             for (const parsed of parsedIssues) {
               if (parsed.criterion == null) continue;
               if (req.wcagCriterion !== parsed.criterion && req.wcagCriterion !== '*') continue;
               const criterion = req.wcagCriterion === '*' ? parsed.criterion : req.wcagCriterion;
               const obligation = req.obligation as 'mandatory'|'recommended'|'optional';
               if (!includeOptional && obligation === 'optional') continue;
               const key = `${criterion}:${obligation}`;
               const existing = violationsMap.get(key);
               if (existing) existing.issueCount += 1;
               else violationsMap.set(key, { wcagCriterion: criterion, obligation, issueCount: 1 });
               if (obligation === 'mandatory') mandatory += 1;
               else if (obligation === 'recommended') recommended += 1;
               else optional += 1;
             }
           }
           const status: 'pass'|'fail'|'partial' =
             mandatory > 0 ? 'fail'
             : (recommended > 0 || optional > 0) ? 'partial'
             : 'pass';
           regulationMatrix[regId] = {
             regulationId: regId,
             regulationName: regulation.name,
             shortName: regulation.shortName,
             jurisdictionId: homeJurisdictionId,
             status,
             mandatoryViolations: mandatory,
             recommendedViolations: recommended,
             optionalViolations: optional,
             violatedRequirements: Array.from(violationsMap.values()),
           };
         }
         ```
       - Return object gains `regulationMatrix` field. The existing `summary` calculation (line 152-156) iterates `matrix` values only — leave it unchanged so jurisdictions-only callers see identical summary numbers (D-31).
       - Import `RegulationMatrixEntry` and `Regulation` from `../types.js` at the top.

    2. Add tests to `packages/compliance/src/engine/checker.test.ts` (or create if absent — match the existing vitest + mock-db pattern used elsewhere in the package):
       - Implement tests 1-6 from <behavior>. Reuse existing fixture helpers. For the unknown-regulation test, mock `db.getRegulation('DOES_NOT_EXIST')` to return `null` and assert the result has no `DOES_NOT_EXIST` key in `regulationMatrix`.
       - For the D-31 snapshot: store a baseline response (captured before this task, OR computed by a helper that strips `regulationMatrix` and compares) under `__snapshots__/`.
  </action>
  <verify>
    <automated>cd /root/luqen/packages/compliance && npx tsc --noEmit && npx vitest run src/engine/checker.test.ts</automated>
  </verify>
  <done>
    - `grep -n 'regulationMatrix' packages/compliance/src/engine/checker.ts` returns at least 3 matches
    - `grep -n "status: 'pass' | 'fail' | 'partial'\|'partial'" packages/compliance/src/engine/checker.ts` returns at least one match
    - `grep -n 'getRegulation(regId)' packages/compliance/src/engine/checker.ts` returns at least one match
    - `cd packages/compliance && npx vitest run src/engine/checker.test.ts` exits 0, all 6 new tests passing
    - `cd packages/compliance && npx tsc --noEmit` exits 0
    - Existing jurisdictions-only tests in the file STILL pass unchanged (D-31 guarantee)
  </done>
</task>

</tasks>

<verification>
- Types compile across the compliance package: `cd packages/compliance && npx tsc --noEmit` → 0
- Unit tests pass: `cd packages/compliance && npx vitest run` → 0 failures
- Cache key unit test asserts `cacheKey` differs for jurisdictions-only vs jurisdictions+regulations
- Backwards compat snapshot test asserts byte-identical matrix/summary/annotatedIssues for jurisdictions-only input
- Response shape always includes `regulationMatrix` key (`{}` when empty), never omitted
</verification>

<success_criteria>
- POST /api/v1/compliance/check accepts optional `regulations[]` (REG-02)
- Checker engine unions jurisdictions + regulation home jurisdictions and builds both matrices (REG-03)
- jurisdictions-only responses are byte-for-byte unchanged (REG-04)
- All 6 checker tests + 6 API tests pass
- `grep -n 'regulationMatrix' packages/compliance/src/engine/checker.ts` returns at least 3 matches
</success_criteria>

<output>
After completion, create `.planning/phases/07-regulation-filter/07-01-SUMMARY.md` capturing:
- Exact shape of `RegulationMatrixEntry` (the new type name used instead of extending nested `RegulationResult`)
- Location of exported `cacheKey` function (downstream tests in dashboard may want to import)
- Confirmed list of existing tests that continue to pass unchanged
</output>
