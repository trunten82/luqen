---
phase: 07-regulation-filter
plan: 02
type: execute
wave: 2
depends_on:
  - 07-01
files_modified:
  - packages/dashboard/src/db/sqlite/migrations.ts
  - packages/dashboard/src/compliance-client.ts
  - packages/dashboard/src/scanner/orchestrator.ts
  - packages/dashboard/src/routes/scans.ts
  - packages/dashboard/src/routes/reports.ts
  - packages/dashboard/tests/scanner/orchestrator.test.ts
  - packages/dashboard/tests/routes/reports.test.ts
autonomous: true
requirements:
  - REG-01
  - REG-03
  - REG-05
must_haves:
  truths:
    - "scan_records table has a regulations TEXT NOT NULL DEFAULT '[]' column after migration 039"
    - "Scan POST handler reads regulations[] from the submitted form body alongside jurisdictions[]"
    - "checkCompliance() client call forwards regulations to the compliance API"
    - "Scan record persists the selected regulations as a JSON array"
    - "Reports route surfaces regulationMatrix to the template via reportData"
  artifacts:
    - path: "packages/dashboard/src/db/sqlite/migrations.ts"
      provides: "Migration 039 adding scan_records.regulations column"
      contains: "ALTER TABLE scan_records ADD COLUMN regulations"
    - path: "packages/dashboard/src/compliance-client.ts"
      provides: "checkCompliance() signature with regulations parameter"
      contains: "regulations: readonly string[]"
    - path: "packages/dashboard/src/scanner/orchestrator.ts"
      provides: "ScanConfig.regulations + persistence + forwarding"
      contains: "regulations"
  key_links:
    - from: "POST /scans handler"
      to: "ScanConfig.regulations"
      via: "body.regulations array parsing"
      pattern: "body.regulations|req.body.*regulations"
    - from: "orchestrator.ts"
      to: "checkCompliance() compliance-client"
      via: "positional argument"
      pattern: "checkCompliance\\([^)]*regulations"
    - from: "routes/reports.ts"
      to: "reportData.regulationMatrix"
      via: "pass-through from scan.complianceResult"
      pattern: "regulationMatrix"
---

<objective>
Wire the regulations selection end-to-end through the dashboard: persist it on the scan record (new migration), read it from the scan form POST body, forward it through the orchestrator and compliance-client to the compliance API, and surface the returned `regulationMatrix` to the report detail template data.

Purpose: Without this wiring, the compliance API enhancement from P01 is unreachable from the dashboard. This plan makes the feature usable end-to-end for every downstream consumer (scan form UI, report detail UI, exports).

Output: Migration 039, extended compliance-client signature, extended ScanConfig + orchestrator, scan POST handler reads regulations, report route exposes regulationMatrix.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/07-regulation-filter/07-CONTEXT.md
@.planning/phases/07-regulation-filter/07-01-SUMMARY.md

@packages/dashboard/src/db/sqlite/migrations.ts
@packages/dashboard/src/compliance-client.ts
@packages/dashboard/src/scanner/orchestrator.ts
@packages/dashboard/src/routes/scans.ts
@packages/dashboard/src/routes/reports.ts

<interfaces>
From P01 (compliance package):
```typescript
// ComplianceCheckRequest now has optional regulations
interface ComplianceCheckRequest {
  readonly jurisdictions: readonly string[];
  readonly regulations?: readonly string[];
  readonly issues: readonly {...}[];
  readonly includeOptional?: boolean;
  readonly sectors?: readonly string[];
}

// Response gains required regulationMatrix
interface ComplianceCheckResponse {
  readonly matrix: Record<string, JurisdictionResult>;
  readonly regulationMatrix: Record<string, RegulationMatrixEntry>;
  readonly annotatedIssues: readonly AnnotatedIssue[];
  readonly summary: {...};
}
```

Dashboard compliance-client.ts current signature (line 193):
```typescript
export async function checkCompliance(
  baseUrl: string,
  token: string,
  jurisdictions: readonly string[],
  issues: readonly ComplianceIssueInput[],
  orgId?: string,
): Promise<ComplianceCheckResult>
```

Dashboard scanner/orchestrator.ts ScanConfig (line 28):
```typescript
export interface ScanConfig {
  readonly siteUrl: string;
  readonly jurisdictions: string[];
  // ... other fields
}
```

Last dashboard migration id in migrations.ts is '038'. Next is '039'.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Migration 039 + compliance-client signature (REG-01, REG-03)</name>
  <files>
    packages/dashboard/src/db/sqlite/migrations.ts
    packages/dashboard/src/compliance-client.ts
    packages/dashboard/tests/compliance-client.test.ts
  </files>
  <read_first>
    - packages/dashboard/src/db/sqlite/migrations.ts lines 1113-1200 (migration 038 structure to mirror for 039)
    - packages/dashboard/src/compliance-client.ts lines 185-205 (current checkCompliance signature)
    - packages/dashboard/tests/compliance-client.test.ts if exists — mirror the existing fetch-mocking pattern
    - .planning/phases/07-regulation-filter/07-CONTEXT.md decisions D-02, D-03, D-04, D-14
  </read_first>
  <behavior>
    - Test A (migration): running `DASHBOARD_MIGRATIONS` against a fresh SQLite DB creates `scan_records.regulations` column with type TEXT, NOT NULL, default '[]'. Existing rows (if any) get '[]'. Verify via `PRAGMA table_info(scan_records)`.
    - Test B (client signature): calling `checkCompliance(baseUrl, token, ['EU'], ['EN301549'], issues, 'org1')` sends a POST with body `{ jurisdictions:['EU'], regulations:['EN301549'], issues }` (mock fetch, assert request body)
    - Test C (empty regulations): calling with `regulations:[]` sends body `{ jurisdictions:['EU'], regulations:[], issues }` (field always present — matches compliance API tolerance)
  </behavior>
  <action>
    1. In `packages/dashboard/src/db/sqlite/migrations.ts` append a new entry to `DASHBOARD_MIGRATIONS` after migration 038:
       ```typescript
       {
         id: '039',
         name: 'add_scan_records_regulations_column',
         sql: `
           ALTER TABLE scan_records ADD COLUMN regulations TEXT NOT NULL DEFAULT '[]';
         `,
       },
       ```
       Do NOT touch the existing `jurisdictions` column (D-03). Do NOT backfill (D-04 — null/missing column reads as empty array at deserialization time).

    2. In `packages/dashboard/src/compliance-client.ts` extend `checkCompliance` signature (line 193) — per D-14 insert `regulations` as a new positional param between `jurisdictions` and `issues`:
       ```typescript
       export async function checkCompliance(
         baseUrl: string,
         token: string,
         jurisdictions: readonly string[],
         regulations: readonly string[],
         issues: readonly ComplianceIssueInput[],
         orgId?: string,
       ): Promise<ComplianceCheckResult> {
         return apiFetch<ComplianceCheckResult>(`${baseUrl}/api/v1/compliance/check`, {
           method: 'POST',
           headers: { Authorization: `Bearer ${token}` },
           body: JSON.stringify({ jurisdictions, regulations, issues }),
         }, orgId);
       }
       ```
       Always include `regulations` in the body (as `[]` if none) — matches the compliance API's tolerance and keeps the wire shape predictable.

    3. Update any `ComplianceCheckResult` type the dashboard uses locally (in the same file or imported from a types module) to add `regulationMatrix: Record<string, RegulationMatrixEntry>` mirroring the compliance package contract. If the dashboard imports types from `@luqen/compliance` directly, no change needed — verify via grep.

    4. Add/extend `packages/dashboard/tests/compliance-client.test.ts` with tests A (migration via a quick `better-sqlite3` in-memory test running DASHBOARD_MIGRATIONS and querying PRAGMA), B, C. Tests B and C mock `fetch` and assert the request body JSON.
  </action>
  <verify>
    <automated>cd /root/luqen/packages/dashboard && npx tsc --noEmit && npx vitest run tests/compliance-client.test.ts</automated>
  </verify>
  <done>
    - `grep -n "id: '039'" packages/dashboard/src/db/sqlite/migrations.ts` returns exactly one match
    - `grep -n 'ADD COLUMN regulations' packages/dashboard/src/db/sqlite/migrations.ts` returns at least one match
    - `grep -n 'regulations: readonly string\[\]' packages/dashboard/src/compliance-client.ts` returns at least one match
    - `grep -n 'JSON.stringify({ jurisdictions, regulations, issues })' packages/dashboard/src/compliance-client.ts` returns exactly one match
    - `cd packages/dashboard && npx tsc --noEmit` exits 0 (no broken callers — they will be fixed in Task 2)
    - NOTE: tsc may show errors at callers of checkCompliance until Task 2 updates them. If so, Task 1 verify is "exits 0 OR only errors are in files scheduled for Task 2". Prefer doing Task 1 + Task 2 as a single atomic commit to keep the build green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Orchestrator + scan POST + reports route wiring (REG-01, REG-05)</name>
  <files>
    packages/dashboard/src/scanner/orchestrator.ts
    packages/dashboard/src/routes/scans.ts
    packages/dashboard/src/routes/reports.ts
    packages/dashboard/tests/scanner/orchestrator.test.ts
    packages/dashboard/tests/routes/scans.test.ts
    packages/dashboard/tests/routes/reports.test.ts
  </files>
  <read_first>
    - packages/dashboard/src/scanner/orchestrator.ts lines 25-55 (ScanConfig interface), line 500-520 (checkCompliance call site), and the area where the scan record is persisted (search for `INSERT INTO scan_records`)
    - packages/dashboard/src/routes/scans.ts — find the POST /scans handler that builds ScanConfig from form body (grep for `jurisdictions` inside the file to locate)
    - packages/dashboard/src/routes/reports.ts line 255-275 — where `reportData` is assembled with `complianceMatrix`
    - packages/dashboard/tests/scanner/orchestrator.test.ts, tests/routes/scans.test.ts, tests/routes/reports.test.ts — mirror existing patterns
    - .planning/phases/07-regulation-filter/07-CONTEXT.md decisions D-13, D-14, D-15, D-32
  </read_first>
  <behavior>
    - Test 1 (ScanConfig type): TypeScript accepts `ScanConfig` with `regulations: ['ADA']`; missing `regulations` at call site fails compilation (prove by a failing compile fixture, or make field `readonly regulations: string[]` non-optional with callers defaulting to `[]`)
    - Test 2 (orchestrator persistence): creating a scan with `regulations:['ADA','EN301549']` persists JSON `'["ADA","EN301549"]'` to `scan_records.regulations` column
    - Test 3 (orchestrator forwarding): orchestrator calls `checkCompliance(baseUrl, token, ['EU'], ['ADA'], issues, orgId)` — mock the client, assert positional arguments
    - Test 4 (scan POST handler): POST /scans with form body including `regulations=ADA&regulations=EN301549&jurisdictions=EU` produces a ScanConfig with `jurisdictions:['EU'], regulations:['ADA','EN301549']`
    - Test 5 (scan POST handler, regulations only): POST with only `regulations=ADA` succeeds — ScanConfig has `jurisdictions:[]` (or the sensible default documented by D-15) and `regulations:['ADA']`
    - Test 6 (reports route): a stored scan whose complianceResult has a non-empty `regulationMatrix` passes `regulationMatrix` through to `reportData` so the template can render it; empty `regulationMatrix` passes through as `{}` (not undefined)
    - Test 7 (reports route backwards compat): a legacy scan with no `regulations` column value (pre-migration hypothetical, or row with `'[]'`) renders fine — `reportData.scan.regulations === []`
  </behavior>
  <action>
    1. In `packages/dashboard/src/scanner/orchestrator.ts`:
       - Extend `ScanConfig` interface (line 28):
         ```typescript
         export interface ScanConfig {
           readonly siteUrl: string;
           readonly standard: string;
           readonly concurrency: number;
           readonly jurisdictions: string[];
           readonly regulations: string[];   // NEW — required, default [] at callers
           readonly scanMode?: 'single' | 'site';
           // ... rest unchanged
         }
         ```
       - At the scan record INSERT (grep for `INSERT INTO scan_records`), add `regulations` to the column list and bind the parameter as `JSON.stringify(config.regulations ?? [])`.
       - At the scan record SELECT / deserialization (grep for `FROM scan_records` and the row mapper), parse the new column: `regulations: row.regulations ? JSON.parse(row.regulations) as string[] : []` (D-04 null-safe).
       - At the `checkCompliance` call site (around line 504), update the positional args to include `regulations` per the new P02 Task 1 signature:
         ```typescript
         const complianceResult = await checkCompliance(
           complianceUrl,
           complianceToken,
           config.jurisdictions,
           config.regulations,
           complianceIssues,
           config.orgId,
         );
         ```

    2. In `packages/dashboard/src/routes/scans.ts`:
       - Locate the POST /scans handler that builds ScanConfig from the form body (grep for `body.jurisdictions` or similar). Accept both `jurisdictions` and `regulations` from the submitted form body. Handlebars + the scan form submits checkbox arrays as either `regulations=a&regulations=b` (multi-value) or JSON — handle whichever shape the existing `jurisdictions` field handles (use the existing normalization helper).
       - Validation: at least one of jurisdictions/regulations non-empty (matches D-05a and D-15). If both empty, return the existing form-error response with an i18n key `scans.errorJurisdictionOrRegulationRequired` (add to en.json in this task).
       - Pass `regulations` into `ScanConfig`:
         ```typescript
         const config: ScanConfig = {
           ...existing,
           jurisdictions: normalizeArray(body.jurisdictions),
           regulations: normalizeArray(body.regulations),
         };
         ```
       - Add the i18n key to `packages/dashboard/src/i18n/locales/en.json` under `scans`: `"errorJurisdictionOrRegulationRequired": "Select at least one jurisdiction or regulation"`.

    3. In `packages/dashboard/src/routes/reports.ts` around line 255-275 (where `reportData` is assembled):
       - When reading the scan row, ensure `scan.regulations` is materialized as `string[]` (via the orchestrator's row mapper if already centralized, otherwise parse here).
       - When passing the compliance result to the template, include `regulationMatrix`:
         ```typescript
         reportData.complianceMatrix = Object.values(complianceResult.matrix);
         reportData.regulationMatrix = Object.values(complianceResult.regulationMatrix ?? {});
         reportData.scan = { ...scan, regulations: scan.regulations ?? [] };
         ```
         Use `Object.values` so the template can `{{#each reportData.regulationMatrix}}` uniformly. Preserve the existing `complianceMatrix` shape exactly (D-32 freeze).
       - If `reportData.regulationMatrix` is empty, still set it to `[]` (not undefined) — the template uses length checks.

    4. Add tests (tests 1-7 from <behavior>) to the three test files. Mirror the existing vitest + fastify inject patterns. For the orchestrator persistence test, use the in-memory SQLite harness already used in `orchestrator.test.ts`.
  </action>
  <verify>
    <automated>cd /root/luqen/packages/dashboard && npx tsc --noEmit && npx vitest run tests/scanner/orchestrator.test.ts tests/routes/scans.test.ts tests/routes/reports.test.ts tests/compliance-client.test.ts</automated>
  </verify>
  <done>
    - `grep -n 'readonly regulations: string\[\]' packages/dashboard/src/scanner/orchestrator.ts` returns at least one match
    - `grep -n 'regulations' packages/dashboard/src/scanner/orchestrator.ts` returns at least 5 matches (ScanConfig, INSERT, SELECT mapper, checkCompliance call, persistence serialization)
    - `grep -n 'regulations' packages/dashboard/src/routes/scans.ts` returns at least 2 matches (body read + ScanConfig pass-through)
    - `grep -n 'regulationMatrix' packages/dashboard/src/routes/reports.ts` returns at least one match
    - `grep -n 'errorJurisdictionOrRegulationRequired' packages/dashboard/src/i18n/locales/en.json` returns exactly one match
    - `grep -rn "checkCompliance(" packages/dashboard/src` — every call site has the regulations argument (or is a declaration); no legacy 4-arg calls remain
    - `cd packages/dashboard && npx tsc --noEmit` exits 0
    - `cd packages/dashboard && npx vitest run` exits 0
  </done>
</task>

</tasks>

<verification>
- TypeScript clean: `cd packages/dashboard && npx tsc --noEmit` → 0
- Vitest clean: `cd packages/dashboard && npx vitest run` → 0
- Migration id '039' exists in DASHBOARD_MIGRATIONS
- Every caller of `checkCompliance()` client function passes `regulations` positional argument
- `reportData.regulationMatrix` is always an array (possibly empty) when reaching the template
</verification>

<success_criteria>
- Scan POST → orchestrator → compliance API → scan record full wiring works with regulations[] (REG-01, REG-03)
- Report route exposes regulationMatrix to the template (enables REG-05 in P03)
- All new tests pass, existing tests unchanged
</success_criteria>

<output>
After completion, create `.planning/phases/07-regulation-filter/07-02-SUMMARY.md` capturing:
- Exact call site update for `checkCompliance()` (line number + snippet)
- Scan record row shape including new `regulations` column
- How `reportData.regulationMatrix` is structured for the template (array vs object)
</output>
