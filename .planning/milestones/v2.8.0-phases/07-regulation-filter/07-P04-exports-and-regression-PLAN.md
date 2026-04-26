---
phase: 07-regulation-filter
plan: 04
type: execute
wave: 4
depends_on:
  - 07-02
  - 07-03
files_modified:
  - packages/dashboard/src/routes/api/export.ts
  - packages/dashboard/src/pdf/generator.ts
  - packages/dashboard/src/i18n/locales/en.json
  - packages/dashboard/tests/routes/api/export.test.ts
  - packages/dashboard/tests/pdf/generator.test.ts
  - packages/compliance/tests/api/compliance-regression.test.ts
autonomous: true
requirements:
  - REG-04
  - REG-06
must_haves:
  truths:
    - "CSV export summary header includes a new 'Regulations' column populated from scan.regulations"
    - "CSV export 'Jurisdictions' column is exactly unchanged (name, separator, position) — D-28 freeze"
    - "PDF export header block includes a 'Regulations: ...' line listing selected regulation short names"
    - "A scoped scan's CSV/PDF contains only findings inside the combined jurisdiction + regulation union (naturally filtered upstream)"
    - "A full regression test proves a jurisdictions[]-only compliance request returns a response whose matrix, summary, and annotatedIssues are byte-identical to a stored golden snapshot"
  artifacts:
    - path: "packages/dashboard/src/routes/api/export.ts"
      provides: "CSV export with Regulations header"
      contains: "Regulations"
    - path: "packages/dashboard/src/pdf/generator.ts"
      provides: "PDF export with Regulations line"
      contains: "Regulations:"
    - path: "packages/compliance/tests/api/compliance-regression.test.ts"
      provides: "REG-04 snapshot regression test"
  key_links:
    - from: "export.ts CSV summary row"
      to: "scan.regulations"
      via: "join('; ')"
      pattern: "scan\\.regulations\\.join"
    - from: "pdf/generator.ts header"
      to: "scan.regulations"
      via: "doc.text(`Regulations: ...`)"
      pattern: "Regulations:"
---

<objective>
Update CSV and PDF exports to surface the regulations selection in the summary header/block, freezing the existing `Jurisdictions` column for downstream compat. Add the definitive REG-04 regression test: a stored snapshot of the compliance response for a jurisdictions-only request that MUST remain byte-identical after every future change.

Purpose: Closes REG-06 (exports include the selection) and locks down REG-04 (backwards compat) with a test that will fail loudly if any future change drifts.

Output: Export updates in 2 files, i18n keys, regression snapshot test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/07-regulation-filter/07-CONTEXT.md
@.planning/phases/07-regulation-filter/07-01-SUMMARY.md
@.planning/phases/07-regulation-filter/07-02-SUMMARY.md

@packages/dashboard/src/routes/api/export.ts
@packages/dashboard/src/pdf/generator.ts
@packages/dashboard/src/i18n/locales/en.json

<interfaces>
From P02, `scan.regulations: string[]` is available on the persisted scan record.

Existing CSV export structure — grep for `scan.jurisdictions` in export.ts (per CONTEXT lines 53, 76, 128, 183, 224, 381) to find the summary header emission point. It currently emits something like `['Jurisdictions', scan.jurisdictions.join('; ')]` as a summary row.

Existing PDF generator — grep for `scan.jurisdictions` in pdf/generator.ts (per CONTEXT lines 26, 53, 129, 325-326) to find the header block.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: CSV + PDF export regulations header/line (REG-06)</name>
  <files>
    packages/dashboard/src/routes/api/export.ts
    packages/dashboard/src/pdf/generator.ts
    packages/dashboard/src/i18n/locales/en.json
    packages/dashboard/tests/routes/api/export.test.ts
    packages/dashboard/tests/pdf/generator.test.ts
  </files>
  <read_first>
    - packages/dashboard/src/routes/api/export.ts — grep `scan.jurisdictions` to locate all 6 references (CSV summary building is typically near the top of the CSV branch)
    - packages/dashboard/src/pdf/generator.ts — grep `scan.jurisdictions` for all 4 references; the header block is where `doc.text` emits metadata
    - packages/dashboard/src/i18n/locales/en.json — `exportCsv.*` and `exportPdf.*` namespaces (or create if absent)
    - packages/dashboard/tests/routes/api/export.test.ts, tests/pdf/generator.test.ts — mirror existing patterns
    - .planning/phases/07-regulation-filter/07-CONTEXT.md decisions D-25, D-26, D-27, D-28, D-30, D-32
  </read_first>
  <behavior>
    - Test A (CSV): export a scan with `jurisdictions:['EU']`, `regulations:['ADA','EN301549']` → CSV output contains a line `Regulations,ADA; EN301549` (or equivalent using the existing CSV formatter) immediately after the `Jurisdictions` line
    - Test B (CSV freeze, D-28): a scan with `jurisdictions:['EU']`, `regulations:[]` → CSV contains `Jurisdictions,EU` (exactly as before), and also contains `Regulations,` (empty value) — Regulations line ALWAYS emitted so format is stable
    - Test C (CSV backwards compat): load a golden CSV fixture captured pre-phase for a jurisdictions-only scan. Exported CSV byte-diff must equal the golden fixture + exactly one added `Regulations,` line in the expected position (test asserts the diff is exactly that one line)
    - Test D (PDF): export a scan with regulations → PDF text extract (via pdf-parse or the existing PDF test helper) contains a line matching `/^Regulations: ADA, EN301549/m` (separator aligned with how Jurisdictions line is formatted)
    - Test E (PDF empty regulations): PDF text extract still contains the line `Regulations: ` (empty value, stable format), OR omits it depending on D-26 — follow whichever matches existing `Jurisdictions: ...` emission behavior when empty
  </behavior>
  <action>
    1. In `packages/dashboard/src/routes/api/export.ts`:
       - Find the CSV summary header emission (grep `Jurisdictions`). Add a `Regulations` row directly after the `Jurisdictions` row, using the same formatting helper:
         ```typescript
         rows.push(['Jurisdictions', (scan.jurisdictions ?? []).join('; ')]);
         rows.push(['Regulations', (scan.regulations ?? []).join('; ')]);
         ```
       - The `Jurisdictions` row itself MUST be byte-identical to its current form (D-28, D-32 freeze). Do not rename, reorder, or change the separator.
       - Row-level filtering: NO change needed (D-27) — the compliance check upstream already filters findings to the selected scope, so the per-issue rows naturally reflect the union.

    2. In `packages/dashboard/src/pdf/generator.ts`:
       - Find the header block that emits `Jurisdictions: ...` (grep `Jurisdictions`). Add a `Regulations: ...` line directly after:
         ```typescript
         doc.text(`Jurisdictions: ${(scan.jurisdictions ?? []).join(', ')}`);
         doc.text(`Regulations: ${(scan.regulations ?? []).join(', ')}`);
         ```
         Use the same separator and styling as the Jurisdictions line. If the existing Jurisdictions line uses an i18n helper, use the same i18n helper for the Regulations line (`exportPdf.regulationsLine`).
       - Do NOT modify the per-issue rendering (D-26 line 325-326 already emits regulation names per issue).

    3. Add to `packages/dashboard/src/i18n/locales/en.json`:
       ```json
       "exportCsv": {
         "regulationsHeader": "Regulations",
         ...existing keys
       },
       "exportPdf": {
         "regulationsLine": "Regulations",
         ...existing keys
       }
       ```
       If the existing code uses literal English strings for `Jurisdictions` (no i18n), match that convention for consistency — but strongly prefer i18n. Add the keys to en.json regardless so future localization has a hook.

    4. Update `packages/dashboard/tests/routes/api/export.test.ts` with tests A, B, C. For Test C, capture a golden CSV fixture by running the existing export once against a fixed scan fixture before making the change, stash it under `tests/fixtures/export-jurisdictions-only.csv`, then assert the new export output equals the golden + exactly one injected `Regulations,` line.

    5. Update `packages/dashboard/tests/pdf/generator.test.ts` with tests D and E. Use the existing PDF-to-text helper (check the current test file for the pattern — likely `pdf-parse` or a similar library) and assert the regulations line presence/format.
  </action>
  <verify>
    <automated>cd /root/luqen/packages/dashboard && npx tsc --noEmit && npx vitest run tests/routes/api/export.test.ts tests/pdf/generator.test.ts</automated>
  </verify>
  <done>
    - `grep -n "Regulations" packages/dashboard/src/routes/api/export.ts` returns at least one match in the summary-emission area
    - `grep -n "Regulations:" packages/dashboard/src/pdf/generator.ts` returns at least one match
    - `grep -n '"Jurisdictions"' packages/dashboard/src/routes/api/export.ts` returns the SAME number of matches as before this task (Jurisdictions column frozen)
    - i18n keys added under `exportCsv` and `exportPdf`
    - Tests A–E all pass
    - Golden CSV fixture committed under `tests/fixtures/`
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: REG-04 regression snapshot test (backwards compat guarantee)</name>
  <files>
    packages/compliance/tests/api/compliance-regression.test.ts
    packages/compliance/tests/api/__snapshots__/compliance-jurisdictions-only.snap.json
  </files>
  <read_first>
    - packages/compliance/tests/api/compliance.test.ts — existing test harness, fixture issues, db mock/setup
    - packages/compliance/src/engine/checker.ts — confirmed stable algorithm
    - .planning/phases/07-regulation-filter/07-01-SUMMARY.md — what was changed in P01
    - .planning/phases/07-regulation-filter/07-CONTEXT.md decisions D-31, D-32, D-33, D-40
  </read_first>
  <behavior>
    - Test 1: Call `POST /api/v1/compliance/check` with a fixed request body `{ jurisdictions:['EU','DE'], issues:[<3 canonical fixture issues with known WCAG codes>], includeOptional:false }` against a DB seeded with a fixed regulations+requirements fixture. Capture the response. Assert that:
      - `response.matrix` strictly equals the stored snapshot's matrix (deep equality)
      - `response.summary` strictly equals the stored snapshot's summary
      - `response.annotatedIssues` strictly equals the stored snapshot's annotatedIssues
      - `response.regulationMatrix` equals `{}` (present, empty — D-33)
    - Test 2: Same request but explicitly adds `regulations: []`. Assert same equality — empty regulations array must produce the same result as omitted.
    - Test 3: Same request with `regulations: undefined`. Assert same equality.
  </behavior>
  <action>
    1. Create `packages/compliance/tests/api/compliance-regression.test.ts`:
       ```typescript
       import { describe, it, expect, beforeAll } from 'vitest';
       import { buildTestApp } from '../helpers/test-app.js'; // reuse existing harness
       import snapshot from './__snapshots__/compliance-jurisdictions-only.snap.json' with { type: 'json' };

       describe('REG-04 regression — jurisdictions-only backwards compatibility', () => {
         let app;
         beforeAll(async () => { app = await buildTestApp({ /* seed the canonical fixture */ }); });

         const FIXED_REQUEST = {
           jurisdictions: ['EU', 'DE'],
           issues: [
             { code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img src="x">' },
             { code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18', type: 'error', message: 'Low contrast', selector: 'p', context: '<p>text</p>' },
             { code: 'WCAG2AA.Principle2.Guideline2_4.2_4_4.H77', type: 'warning', message: 'Link text', selector: 'a', context: '<a>click</a>' },
           ],
           includeOptional: false,
         };

         it('response.matrix equals golden snapshot', async () => {
           const res = await app.inject({ method: 'POST', url: '/api/v1/compliance/check', payload: FIXED_REQUEST, headers: { authorization: 'Bearer <test-token>' } });
           const body = res.json();
           expect(body.matrix).toEqual(snapshot.matrix);
           expect(body.summary).toEqual(snapshot.summary);
           expect(body.annotatedIssues).toEqual(snapshot.annotatedIssues);
           expect(body.regulationMatrix).toEqual({});
         });

         it('regulations: [] produces identical result', async () => {
           const res = await app.inject({ method: 'POST', url: '/api/v1/compliance/check', payload: { ...FIXED_REQUEST, regulations: [] }, headers: { authorization: 'Bearer <test-token>' } });
           const body = res.json();
           expect(body.matrix).toEqual(snapshot.matrix);
           expect(body.summary).toEqual(snapshot.summary);
           expect(body.annotatedIssues).toEqual(snapshot.annotatedIssues);
         });

         it('regulations: undefined produces identical result', async () => {
           const res = await app.inject({ method: 'POST', url: '/api/v1/compliance/check', payload: { ...FIXED_REQUEST, regulations: undefined }, headers: { authorization: 'Bearer <test-token>' } });
           const body = res.json();
           expect(body.matrix).toEqual(snapshot.matrix);
         });
       });
       ```
       Adapt to the exact test harness pattern in `packages/compliance/tests/api/compliance.test.ts` (auth, fixture seeding, app builder).

    2. Generate the snapshot file `packages/compliance/tests/api/__snapshots__/compliance-jurisdictions-only.snap.json`:
       - On first run, capture the live response and write it to the snapshot file (NOT via vitest's `toMatchSnapshot` — use an explicit JSON file so git-diffs are human-readable).
       - The snapshot content is whatever the checker engine produces against the canonical fixture. The test's job is to lock it down, not to pre-compute it by hand.
       - Commit the snapshot file. Any future drift causes the test to fail and forces explicit review.

    3. Document in the test file header:
       ```
       /**
        * REG-04 regression test — this test MUST stay green forever.
        * If it fails, the compliance API's backwards compatibility contract has been broken.
        * Regenerate the snapshot ONLY with explicit user approval.
        */
       ```
  </action>
  <verify>
    <automated>cd /root/luqen/packages/compliance && npx vitest run tests/api/compliance-regression.test.ts</automated>
  </verify>
  <done>
    - File `packages/compliance/tests/api/compliance-regression.test.ts` exists
    - File `packages/compliance/tests/api/__snapshots__/compliance-jurisdictions-only.snap.json` exists and contains non-empty `matrix`, `summary`, `annotatedIssues` keys
    - All 3 tests pass
    - `grep -n "REG-04" packages/compliance/tests/api/compliance-regression.test.ts` returns at least one match
    - `grep -n 'regulationMatrix.*{}' packages/compliance/tests/api/compliance-regression.test.ts` returns at least one assertion
  </done>
</task>

</tasks>

<verification>
- Full test suite: `cd packages/dashboard && npx vitest run` → 0 failures
- Full compliance test suite: `cd packages/compliance && npx vitest run` → 0 failures
- Golden CSV fixture byte-compare passes
- REG-04 snapshot test passes
- `grep -n 'Regulations' packages/dashboard/src/routes/api/export.ts` returns at least one match in summary rows
- `grep -n 'Regulations:' packages/dashboard/src/pdf/generator.ts` returns at least one match
</verification>

<success_criteria>
- CSV + PDF exports surface the regulations selection (REG-06)
- Jurisdictions column frozen exactly as before (REG-04, D-28, D-32)
- Regression snapshot locks the backwards-compat guarantee into CI (REG-04, D-40)
- All tests pass across both packages
</success_criteria>

<output>
After completion, create `.planning/phases/07-regulation-filter/07-04-SUMMARY.md` capturing:
- Exact CSV summary row insertion point (before/after)
- PDF generator line emission point (before/after)
- Location of the REG-04 snapshot file and the canonical fixture request it's pinned to
- Phase 07 final test totals (how many new tests, across which files)
</output>
