---
phase: 08-system-brand-guideline
plan: 04
type: execute
wave: 3
depends_on: [08-01, 08-02, 08-03]
files_modified:
  - packages/dashboard/tests/integration/system-brand-guideline-pipeline.test.ts
  - packages/dashboard/src/services/branding-retag.ts
  - packages/dashboard/src/scanner/orchestrator.ts
autonomous: true
requirements: [SYS-05]
objective: >
  Prove and enforce that the scan matching pipeline uses a SINGLE
  BrandGuideline code path for org-owned guidelines, cloned guidelines,
  and linked system guidelines. End-to-end integration tests cover three
  scenarios: (1) link-mode scan resolves the live system guideline,
  (2) edit-then-rescan propagates updates, (3) clone-then-edit-source
  does NOT propagate to the clone. Also verify branding-retag works
  against linked system guidelines without a parallel path.
must_haves:
  truths:
    - "A site linked to a system guideline scans using the live system guideline content — no copy, no parallel code path"
    - "Editing the source system guideline after linking causes the next scan to use the updated content"
    - "Editing the source system guideline after cloning does NOT touch the clone — clone content is frozen at clone time"
    - "The matching pipeline logs show exactly ONE BrandGuideline resolution call site handling both org-owned and linked-system cases"
    - "branding-retag works on sites linked to system guidelines (retag fetches current content via the same resolver, not a copy)"
    - "Orgs with zero system-guideline involvement have byte-identical scan behaviour to today (regression snapshot)"
  artifacts:
    - path: "packages/dashboard/tests/integration/system-brand-guideline-pipeline.test.ts"
      provides: "End-to-end tests: link scan, edit propagation, clone isolation, retag, regression baseline"
      min_lines: 120
  key_links:
    - from: "packages/dashboard/src/scanner/orchestrator.ts"
      to: "brandingRepository.getGuidelineForSite"
      via: "single resolver call unchanged from today"
      pattern: "getGuidelineForSite"
    - from: "packages/dashboard/src/services/branding-retag.ts"
      to: "brandingRepository.getGuidelineForSite"
      via: "retag resolves current content via the same single resolver"
      pattern: "getGuidelineForSite"
---

<objective>
Close out Phase 08 by proving end-to-end that the single-code-path
requirement (SYS-05) holds under three real scenarios using the stack
P01-P03 built. Make any minimal adjustments to branding-retag.ts and/or
orchestrator.ts needed for the retag + scan flows to handle linked
system guidelines via the existing resolver (no new branching).

This plan is primarily a verification plan. Any source changes here are
expected to be minimal — if either file already routes through
getGuidelineForSite, the only deliverable is the integration test
suite. If a file bypasses the resolver (e.g., retag reads from a stale
local copy), fix it to call the resolver.

Purpose: Satisfies SYS-05 and provides a regression safety net for the
whole phase.
Output: New integration test file, minimal source adjustments if any,
green test run.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-system-brand-guideline/08-CONTEXT.md
@.planning/phases/08-system-brand-guideline/08-UI-SPEC.md
@.planning/phases/08-system-brand-guideline/08-P01-data-foundation-PLAN.md
@.planning/phases/08-system-brand-guideline/08-P02-admin-route-and-page-PLAN.md
@.planning/phases/08-system-brand-guideline/08-P03-org-system-library-tab-PLAN.md
@packages/dashboard/src/scanner/orchestrator.ts
@packages/dashboard/src/services/branding-retag.ts
@packages/dashboard/src/db/sqlite/repositories/branding-repository.ts

<interfaces>
Single resolver from P01:
```typescript
brandingRepository.getGuidelineForSite(siteUrl, orgId): Promise<BrandingGuidelineRecord | null>
// Returns the assigned guideline regardless of org_id (system or org-owned)
// via the existing JOIN site_branding → branding_guidelines.
```

Orchestrator call site (per CONTEXT.md line 547, code_context section):
`packages/dashboard/src/scanner/orchestrator.ts` line ~543-624 — the
single place scans resolve a branding guideline.

Retag call site:
`packages/dashboard/src/services/branding-retag.ts` — historical retag
helper; must fetch current guideline content via getGuidelineForSite so
linked system guidelines retag with the CURRENT content, not a snapshot.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write end-to-end integration tests for SYS-05 scenarios</name>
  <files>packages/dashboard/tests/integration/system-brand-guideline-pipeline.test.ts</files>
  <read_first>
    - packages/dashboard/tests/integration/service-connections-flow.test.ts (reference harness for this project's integration tests)
    - packages/dashboard/src/scanner/orchestrator.ts (lines 540-630 — see how getGuidelineForSite is called, what context flows into brandGuideline enrichment)
    - packages/dashboard/src/services/branding-retag.ts (full file)
    - packages/dashboard/src/db/sqlite/repositories/branding-repository.ts (assignToSite, createGuideline, updateGuideline signatures)
    - .planning/phases/08-system-brand-guideline/08-CONTEXT.md (D-06, D-07, D-17, D-18)
  </read_first>
  <behavior>
    Scenario A — Link mode (SYS-02 path, pipeline side):
    - Test A1: Create a system guideline "Aperol System" with 2 colors. Create org 'org-a'. Assign the system guideline id to a site 'https://example.com' under org-a via repo.assignToSite. Call brandingRepository.getGuidelineForSite('https://example.com', 'org-a'). Assert returned record has orgId === 'system', name === 'Aperol System', colors.length === 2.
    - Test A2: Edit the source system guideline (update name to "Aperol System v2" and add a 3rd color). Call getGuidelineForSite again with the same args. Assert the result reflects v2 (name updated, 3 colors) — live propagation.

    Scenario B — Clone mode (SYS-03 path, pipeline side):
    - Test B1: Create a system guideline "Campari System" with 2 colors. Call brandingRepository.cloneSystemGuideline(sourceId, 'org-a'). Capture cloneId. Assert the clone has orgId === 'org-a' and clonedFromSystemGuidelineId === sourceId.
    - Test B2: Assign the clone to a site under org-a. getGuidelineForSite returns the clone (orgId === 'org-a'), not the source.
    - Test B3: Edit the SOURCE system guideline (change name, add a color). Call getGuidelineForSite again for the cloned-site. Assert the clone is UNCHANGED — name, colors are the same as at clone time.

    Scenario C — Retag compatibility (SYS-05 single path):
    - Test C1: Set up a site under org-a linked to a system guideline. Invoke branding-retag's retagScansForSite (or equivalent exported function) against that site. Assert the retag helper successfully resolves the guideline — does not throw, does not return null, does not skip the site. Exact assertions depend on retag's return shape (read the file). At minimum: no exception.
    - Test C2: Same setup but assigned to an org-owned guideline. Retag still works (regression guard).

    Scenario D — Regression (SYS-06 / D-18):
    - Test D1: Set up an org with only org-owned guidelines (no system involvement at all). Run assign + getGuidelineForSite. Assert the exact same record shape as pre-phase would have returned (all fields present, no new unexpected fields other than clonedFromSystemGuidelineId = null).

    Scenario E — Single code path enforcement (structural):
    - Test E1: grep-style assertion embedded in the test file — import orchestrator.ts source as a string (fs.readFileSync) and assert that `getGuidelineForSite` is called exactly ONE time inside it (one substring occurrence). Document in a comment that this is the SYS-05 guard: if future refactors add a parallel resolver, this test fails.
  </behavior>
  <action>
    Create packages/dashboard/tests/integration/system-brand-guideline-pipeline.test.ts. Use the bootstrap from tests/integration/service-connections-flow.test.ts:
    - In-memory SQLite + run migrations
    - Construct SQLiteBrandingRepository directly
    - For retag, import retagScansForSite (or equivalent) directly

    The test file MUST be runnable without a live HTTP server for the pure-repository scenarios (A, B, D). Scenario C (retag) may need a small mock for downstream scan records — check how branding-retag.ts handles missing scan records and use the minimal fixture.

    Do NOT mock branding-repository. Test against the real SQLite repo with real migrations.

    Scenario E is a simple grep:
    ```typescript
    import { readFileSync } from 'node:fs';
    it('orchestrator calls getGuidelineForSite exactly once (SYS-05 single code path)', () => {
      const src = readFileSync('src/scanner/orchestrator.ts', 'utf8');
      const matches = src.match(/getGuidelineForSite/g) ?? [];
      expect(matches.length).toBe(1);
    });
    ```
    (Adjust the path relative to the test working directory. If the project runs vitest from packages/dashboard, 'src/scanner/orchestrator.ts' is correct.)

    Run:
    ```
    cd packages/dashboard && npx vitest run tests/integration/system-brand-guideline-pipeline.test.ts
    ```
    Expected outcome on first run: Scenarios A, B, D should PASS immediately (they exercise P01 which is already green). Scenario C may FAIL if branding-retag.ts doesn't use the resolver — that's the signal for Task 2. Scenario E's count may be different than 1 depending on current orchestrator state — treat whatever it finds as the baseline to investigate; if it's 1 already, great; if it's >1, investigate and either accept (two legitimate call sites) or consolidate in Task 2.

    Commit as `test(08-P04): integration tests for system brand guideline pipeline (SYS-05)`.
  </action>
  <verify>
    <automated>cd packages/dashboard && npx vitest run tests/integration/system-brand-guideline-pipeline.test.ts 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - File packages/dashboard/tests/integration/system-brand-guideline-pipeline.test.ts exists
    - File contains "cloneSystemGuideline"
    - File contains "getGuidelineForSite"
    - File contains "orgId === 'system'" OR "orgId: 'system'"
    - File contains "clonedFromSystemGuidelineId"
    - File contains a grep-style assertion on orchestrator.ts (substring "orchestrator.ts" present in the test body)
    - File contains at least 8 `it(` or `test(` entries
    - Scenarios A, B, D execute and either pass or fail cleanly (no syntax errors, no harness errors)
  </acceptance_criteria>
  <done>
    Full integration test file committed. Any failing scenarios are understood and handed to Task 2.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Minimal adjustments to branding-retag.ts and/or orchestrator.ts to satisfy SYS-05</name>
  <files>
    packages/dashboard/src/services/branding-retag.ts,
    packages/dashboard/src/scanner/orchestrator.ts
  </files>
  <read_first>
    - packages/dashboard/src/services/branding-retag.ts (full file)
    - packages/dashboard/src/scanner/orchestrator.ts (lines 540-630 + any other getGuidelineForSite references)
    - packages/dashboard/tests/integration/system-brand-guideline-pipeline.test.ts (Task 1 — the failures tell you what to fix)
    - .planning/phases/08-system-brand-guideline/08-CONTEXT.md (D-06, D-07)
  </read_first>
  <action>
    Run Task 1's test file first and record which scenarios fail. Decide based on results:

    CASE 1 — All Task 1 scenarios pass (common outcome because the existing resolver already returns rows regardless of org_id):
    - No source changes required.
    - Skip to regression run.

    CASE 2 — Scenario C (retag) fails because branding-retag.ts reads guideline content from a stale path (e.g., a cached snapshot, or directly from the guidelines table filtered by orgId):
    - Locate the exact line(s) where retag reads the guideline.
    - Replace the read with `storage.brandingRepository.getGuidelineForSite(siteUrl, orgId)`.
    - Do NOT add a system/org branch. The resolver returns whatever was assigned — single code path.
    - If retag previously filtered by orgId excluding 'system', remove that filter; the resolver's JOIN handles scoping via site_branding.

    CASE 3 — Scenario E (orchestrator call count) finds multiple getGuidelineForSite call sites:
    - Audit each call site. If duplicates exist, consolidate them into a single call at the top of the scan setup block (~line 547 per CONTEXT.md). Feed the resolved guideline downstream.
    - If a legitimate second call exists (e.g., pre-scan validation), update the Scenario E assertion to the correct count and leave a comment explaining why.

    CASE 4 — Scenarios A/B/D fail (unlikely — P01 tested these in isolation):
    - This indicates a bug in P01 that slipped through. Stop, escalate, re-test P01.

    Re-run Task 1 tests until all pass:
    ```
    cd packages/dashboard && npx vitest run tests/integration/system-brand-guideline-pipeline.test.ts
    ```

    Then run a full regression:
    ```
    cd packages/dashboard && npx vitest run && npx tsc --noEmit
    ```

    Every existing test must still pass — this phase is strictly additive and preserves the byte-identical behavior for orgs with no system involvement (D-17, D-18).

    Commit only if source files were actually modified:
    - If retag was fixed: `fix(08-P04): branding-retag resolves guidelines via getGuidelineForSite for system-linked sites`
    - If orchestrator was consolidated: `refactor(08-P04): consolidate orchestrator getGuidelineForSite to a single call site (SYS-05)`
    - If no source changes were needed: no commit here; the Task 1 commit already establishes the SYS-05 guarantee via tests.
  </action>
  <verify>
    <automated>cd packages/dashboard && npx vitest run tests/integration/system-brand-guideline-pipeline.test.ts && npx vitest run tests/db/ tests/routes/ && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `cd packages/dashboard && npx vitest run tests/integration/system-brand-guideline-pipeline.test.ts` exits 0 with all Task 1 scenarios (A1, A2, B1-B3, C1, C2, D1, E1) passing
    - `cd packages/dashboard && npx vitest run` full suite exits 0 (phase-wide regression check)
    - `cd packages/dashboard && npx tsc --noEmit` exits 0
    - packages/dashboard/src/services/branding-retag.ts contains "getGuidelineForSite" (either pre-existing or freshly added)
    - packages/dashboard/src/scanner/orchestrator.ts contains "getGuidelineForSite"
    - Grep count of "getGuidelineForSite" in packages/dashboard/src/scanner/orchestrator.ts matches the count asserted in Scenario E
  </acceptance_criteria>
  <done>
    SYS-05 is proven end-to-end. Linked system guidelines, cloned guidelines, and org-owned guidelines all flow through the same resolver. Retag works on linked sites. Regressions absent. Full dashboard test suite green.
  </done>
</task>

</tasks>

<verification>
- Full integration test file passes all 8+ tests
- Full packages/dashboard test suite green (no regressions)
- TypeScript compiles clean
- Structural SYS-05 guard in place (Scenario E): a future refactor introducing a parallel resolver path will fail the test
- Retag helper works on system-linked sites
</verification>

<success_criteria>
SYS-05 delivered and locked in by tests. The BrandGuideline matching
pipeline handles org-owned, cloned, and linked-system guidelines through
a single resolver. End-to-end behaviour across all three modes is
verified. Phase 08 requirements (SYS-01..SYS-06) are all satisfied
across P01-P04 and the full test suite is green.
</success_criteria>

<output>
After completion, create `.planning/phases/08-system-brand-guideline/08-P04-pipeline-integration-e2e-SUMMARY.md`
</output>
