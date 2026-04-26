# Phase 18 Plan Check

**Checker:** gsd-plan-checker (goal-backward verification)
**Phase:** 18 — Scanner Wire-Up (v2.11.0, highest-risk phase)
**Plans verified:** 6 (18-01 through 18-06)
**Date:** 2026-04-10

---

## Verdict

**PLAN CHECK NEEDS REVISION** — 2 blockers, 4 warnings, 3 info notes.

The plans are very thorough and demonstrate deep goal-backward thinking: baseline-before-rewire ordering, invariant-pinning tests, append-only contracts, NULL-safe LEFT JOIN, and a binding gate file. Most of the verification focus points pass with explicit evidence. Two blockers must be fixed before execution:

1. **BLOCKER-1:** Plan 18-04 Task 2 (retag caller update) is undersized — the planner did not enumerate the 13 existing call sites discovered via grep of `packages/dashboard/src/`. The plan says "grep and update" but does not list the files. The two callers scoped into the plan description (graphql + branding-guidelines) miss multiple others.
2. **BLOCKER-2:** Plan 18-04 Test 1 asserts BSTORE-03 append-only via `mockInsert.toHaveBeenCalledTimes(2)` — this is mock-call-counting, not the `COUNT(*) === 2` raw-SQL assertion the verification focus (item 9) requires. A mocked repository cannot distinguish "insert appended" from "insert replaced", because the mock is not the real SQLite.

Plus: Wave 1 plans 18-01 and 18-02 both declare `depends_on: []`, which is correct for parallelism, but plan 18-02 silently implies an ordering ("plumbing before rewire") that the checker interprets as "safe in any Wave 1 ordering". Marked as info.

---

## Per-Criterion Table (22 verification focus points)

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | Goal-backward — plans deliver ROADMAP's 5 success criteria | PASS | SC1 → 18-03 (one match call), SC2 → 18-04 (append-only), SC3 → 18-03 + 18-04 (persist incl. degraded), SC4 → 18-05 (LEFT JOIN + null-safe test), SC5 → 18-01 + 18-06 (baseline + gate) |
| 2 | Requirements BSTORE-02/03/04/06 each in ≥1 plan's `requirements:` | PASS | BSTORE-02 in 18-01/02/03/06; BSTORE-03 in 18-04; BSTORE-04 in 18-05; BSTORE-06 in 18-03 + 18-05 |
| 3 | Baseline-before-rewire ordering | PASS | 18-01 in Wave 1, `depends_on: []`, no source code modified; inline block lives until 18-03 lands in Wave 2 |
| 4 | 18-02 plumbing-only refactor; inline block unchanged | PASS | Explicit acceptance criterion `grep -c "BrandingMatcher" ... >= 1` and `grep -c "matchAndScore" ... == 0`; test 3 "constructs WITHOUT brandingOrchestrator" proves backwards compat |
| 5 | Pitfall #10 — spy + `toHaveBeenCalledTimes(1)` on matchAndScore | PASS | Test 1 in branding-rewire.test.ts: `expect(brandingOrchestrator.matchAndScore).toHaveBeenCalledTimes(1)` with live-run scan |
| 6 | Degraded-still-persists, asserts insert called with unscorable | PASS | Test 4 (CRITICAL): `expect(writtenResult.kind).toBe('unscorable')` + `expect(writtenContext.mode).toBe('remote')` after stubbing orchestrator to return `kind: 'degraded'` |
| 7 | No-guideline does NOT persist | PASS | Test 5: `expect(brandScoreRepository.insert).not.toHaveBeenCalled()` when stubbed result is `kind: 'no-guideline'` |
| 8 | Persistence failure non-blocking | PASS | Plan 18-03 Test 6 (scanner): stubs insert to throw, asserts `terminal.type === 'complete'` and updateScan was called. Plan 18-04 Test 5 (retag): similar pattern with mid-loop insert failure. |
| 9 | BSTORE-03 append-only via `COUNT(*) === 2` raw SQL | **FAIL (BLOCKER-2)** | Plan 18-04 Test 1 uses `mockInsert.toHaveBeenCalledTimes(2)` — mock-call counting. Verification focus item 9 explicitly requires "assertion should be `COUNT(*) === 2` via raw SQL, not just `insert` called twice". A mock cannot prove the repository does not secretly UPDATE. |
| 10 | BSTORE-04 strict null assertion (not undefined/0/{overall:0}) | PASS | Plan 18-05 Test 1 uses `expect(entry.brandScore).toBe(null)` and `expect(entry.brandScore).not.toBe(undefined)` and `expect(entry.brandScore).not.toEqual({ overall: 0 })`. Pitfall #8 satisfied. |
| 11 | LEFT JOIN in trend query (not INNER JOIN) | PASS | 18-05 action block contains literal `LEFT JOIN brand_scores bs ON bs.scan_id = s.id`; acceptance criterion `grep -c "INNER JOIN brand_scores" ... returns 0` |
| 12 | Latest-per-scan subquery via MAX(rowid) + test for 2 rows | PASS | 18-05 Test 4 inserts two rows (overall 50 then 80), asserts `bs.overall === 80`; acceptance criterion `grep -c "MAX(rowid)" ... returns 1` |
| 13 | No-backfill BSTORE-06 enforcement | PASS | 18-03 Test 7 asserts `scanIds === ['scan-07-current']`; no migration/script added anywhere. 18-05 explicitly preserves pre-v2.11.0 via LEFT JOIN, does not attempt to back-insert. |
| 14 | Constructor injection (`this.brandingOrchestrator`, never `server.brandingOrchestrator`) | PASS | 18-02 adds `private readonly brandingOrchestrator` on the class; 18-03 action uses `this.brandingOrchestrator.matchAndScore`. Threat model explicitly bans Fastify decorator access from inside runScan. |
| 15 | Latency baseline runs against PRE-rewire code | PASS | 18-01 `depends_on: []`, Wave 1, explicitly states `git diff master -- ... empty`. Action step documents "this entire plan is wave 1, the rewire starts in 18-02 plumbing, real behavior change in 18-03". 18-06 re-executes the same script against post-rewire HEAD. |
| 16 | 18-06 binding gate writes PASS/FAIL to 18-06-GATE.md, surfaces failure | PASS | Literal `## Latency Gate Verdict: PASS` or `FAIL` required by acceptance criterion. gate_math block has explicit formulas. Task 2 action explicitly forbids suppression: "DO NOT suppress the gate. DO NOT edit 18-01-BASELINE.md or 18-06-POST.md... Raise the failure to the orchestrator for replan routing." |
| 17 | Baseline script security — execFileSync not execSync | PASS | Plan 18-01 Task 1 uses `execFileSync('git', ['rev-parse', 'HEAD'])` with argv form; explicit acceptance criterion `grep -c "execSync\(" ... returns 0` |
| 18 | Wave dependencies correctness | MIXED (WARN-1) | 18-01 `[]` OK; 18-02 `[]` OK (plumbing refactor doesn't need baseline); 18-03 `[18-02]` OK; 18-04 `[18-02]` OK; 18-05 `[18-03]` — but 18-05 Test 3 calls `storage.brandScores.insert` via the repo path, does not need the rewired scanner; and 18-05 does not depend on 18-04 even though the retag append-only contract it implicitly relies on (Test 4 assumes 2 rows can exist for one scan — which can only happen if retag ran, not just initial scan). Missing dep `18-04` is minor because migration 043 allows multiple rows regardless — test 4 inserts directly via the repo. 18-06 correctly depends on `[18-01, 18-03, 18-04, 18-05]`. |
| 19 | Parallel safety — no file overlap within waves | MIXED (WARN-2) | Wave 1: 18-01 touches `scripts/scanner-latency-bench.ts` + `18-01-BASELINE.md`; 18-02 touches `src/scanner/orchestrator.ts` + `src/server.ts` + `tests/scanner/orchestrator.test.ts` — NO overlap. Wave 2: 18-03 touches `src/scanner/orchestrator.ts` + `tests/scanner/branding-rewire.test.ts`; 18-04 touches `src/services/branding-retag.ts` + `tests/services/branding-retag-rewire.test.ts` + all callers (graphql/resolvers.ts, routes/admin/branding-guidelines.ts, routes/api/branding.ts). BLOCKER-1 compounds this: 18-04's `files_modified` list does NOT declare the caller files (graphql/resolvers.ts etc.), which means the plan's files_modified is inaccurate and the checker can't validate file overlap with 18-03. 18-03 does not touch graphql or routes, so no conflict in practice, but the frontmatter is incomplete. Wave 3: 18-05 touches db files + mapper + tests; 18-06 touches only `.planning/phases/18-scanner-wire-up/18-06-POST.md` + `18-06-GATE.md` — no overlap. |
| 20 | Anti-shallow task rules (read_first, acceptance_criteria, action) | PASS | Sampled 18-01 Task 1 + 18-03 Task 1 + 18-05 Task 3: all have read_first blocks listing 4-6 files, acceptance_criteria using grep/test verifiers, action blocks containing concrete code. The verbatim pre-rewire block is pasted in full in 18-03 `<interfaces>`. |
| 21 | Threat models present | PASS | All 6 plans have `<threat_model>` with Trust Boundaries + STRIDE Threat Register. ASVS L1 aligned. |
| 22 | Build tooling uses npm/npx, not pnpm | PASS | Every action/verify block uses `cd packages/dashboard && npm run lint` and `npx vitest run`. Zero `pnpm` references found. |

---

## Additional Checks

### Context Compliance

No CONTEXT.md provided for Phase 18; skipping the locked-decision coverage check.

### Nyquist Compliance

No VALIDATION.md provided for Phase 18. Per checker rules Dimension 8 is either SKIPPED or BLOCKING. Given the phase contains explicit TDD tasks with `<verify><automated>` commands in every implementation task (lint + vitest run) and a Wave 3 post-validation gate, the spirit of Nyquist is satisfied even without the artifact. Flagged as INFO-1 below.

### CLAUDE.md Compliance

`/root/luqen/CLAUDE.md` present. Relevant directives: (a) GSD workflow enforcement (plans exist — PASS); (b) no direct repo edits outside GSD (these are planned diffs, executed via GSD — PASS); (c) TypeScript conventions — plans use `import type`, immutable patterns (ScanRecord readonly spread), error handling with explicit catch blocks (PASS). No contradictions found.

Note: project rules file at `/root/power-platform-claude/rules/typescript/coding-style.md` says "No `console.log` statements in production code". Plans 18-03 and 18-04 use `console.error`, not `console.log`, which is consistent with the existing pattern in `scanner/orchestrator.ts` (error-level logging). Acceptable.

### Research Resolution

Phase 18 RESEARCH.md is not present as a separate file; the research context flows through `.planning/research/SUMMARY.md` and PITFALLS.md which are referenced in every plan's `@` context block. Pitfalls #8 and #10 are explicitly called out in the plans that address them. No open questions left unanswered.

### Scope Reduction Detection

No "v1/v2", "placeholder", "simplified", "static for now" language found in any plan. Every user-observable requirement is delivered fully. One minor compromise is documented EXPLICITLY in 18-03 `<scope_clarification>`: the UnscorableReason enum does not distinguish "service-degraded" from "no-branded-issues", so the degraded branch reuses `'no-branded-issues'` as the closest existing literal. This is documented as a gap with a future-phase escape hatch ("Phase 15 may extend UnscorableReason to add 'service-degraded'"), not a silent scope reduction. Flagged as INFO-2.

---

## Blockers (must fix before execution)

### BLOCKER-1 — Plan 18-04 Task 2 undersized

**Severity:** blocker
**Dimension:** task_completeness + requirement_coverage (indirect)

The retag rewire extends `retagScansForSite` from 3 args to 5 args and `retagAllSitesForGuideline` from 3 args to 5 args. A codebase grep shows **13 existing call sites across 3 files**:

```
packages/dashboard/src/graphql/resolvers.ts       — 2 callers (lines 748, 760)
packages/dashboard/src/routes/admin/branding-guidelines.ts — 10 callers
packages/dashboard/src/routes/api/branding.ts     — 1 caller (line 423)
```

Plan 18-04 Task 2:
- Frontmatter `files_modified` lists only `src/services/branding-retag.ts` and `tests/...` — does NOT enumerate the three caller files.
- Action block says "grep for all callers ... Expected call sites (infer from codebase map — there may be 1-3 of them)" — the planner guessed "1-3" but actual count is 13.
- No per-caller action or acceptance criterion; the executor is left to infer the exact Fastify access pattern for each call site.
- Impact: the plan may underestimate the work, skip a caller, and leave master uncompilable after the Wave 2 rewire. Wave 2 parallel execution with 18-03 becomes risky because 18-04 touches more files than declared (fan-out unknown).

**Fix hint:** Update 18-04 frontmatter `files_modified` to explicitly list the three caller files (`src/graphql/resolvers.ts`, `src/routes/admin/branding-guidelines.ts`, `src/routes/api/branding.ts`). Update Task 2 action block with the enumerated caller list (13 total, specific line numbers) and one concrete example per file showing the expected 5-arg call pattern. Add acceptance criterion: `grep -rn "retagScansForSite\|retagAllSitesForGuideline" packages/dashboard/src/ --include="*.ts" | wc -l` returns exactly the expected total (definition lines + 13 call lines). This also resolves WARN-2 (file overlap declaration).

### BLOCKER-2 — Plan 18-04 Test 1 does not use raw SQL COUNT(*)

**Severity:** blocker
**Dimension:** verification_derivation + scope_reduction

Plan 18-04 Test 1 is the critical BSTORE-03 append-only invariant test. The verification focus explicitly requires:

> "Plan 18-04 MUST have a test that retags the same scan_id twice and asserts `brand_scores` has 2 rows for that scan_id (not 1 updated row). The assertion should be `COUNT(*) === 2` via raw SQL, not just `insert` called twice."

Plan 18-04 Test 1 asserts:
```typescript
expect(brandScoreRepository.insert).toHaveBeenCalledTimes(2);
```

This is a mocked repository. The mock's `insert: vi.fn()` counts calls but does not prove the real SQLite table grew by one row — a buggy repository that secretly issues `REPLACE INTO brand_scores` would still satisfy `toHaveBeenCalledTimes(2)` because the mock counts call attempts, not resulting row counts.

The right test (mirroring Phase 16-02 Test 8) needs a REAL `SqliteStorageAdapter`:
```typescript
const storage = new SqliteStorageAdapter(tmpDbPath);
await storage.migrate();
// ... retag twice ...
const rowCount = storage.db.prepare(
  'SELECT COUNT(*) as c FROM brand_scores WHERE scan_id = ?'
).get('scan-01').c;
expect(rowCount).toBe(2);
```

Alternatively, since Plan 18-05 Test 4 already proves "two rows exist for one scan_id and the LEFT JOIN picks the latest" via a real SqliteStorageAdapter, the retag-specific append-only invariant at the retag-function layer IS legitimately pinnable with a mock IF Phase 16-02 Test 8 has already proven the repository does not UPDATE. But the current plan does not cross-reference that — it relies on the mock alone. The verification focus is explicit that this plan must NOT rely on call counts.

**Fix hint:** Add a second test to Plan 18-04 (or convert Test 1) that uses a real `SqliteStorageAdapter` like the pattern in Plan 18-05 Test 4. Insert the scan_record, retag once, retag again, then run `storage.db.prepare('SELECT COUNT(*) FROM brand_scores WHERE scan_id = @id').get({ id: 'scan-01' })` and assert the count is 2. The mock-based Test 1 can stay as a smoke test but cannot be the BSTORE-03 proof.

---

## Warnings (should fix)

### WARN-1 — Plan 18-05 dependency gap (should add 18-04)

**Severity:** warning
**Dimension:** dependency_correctness

Plan 18-05 declares `depends_on: [18-03]`. The LEFT JOIN + latest-per-scan subquery needs real retag-produced rows to exercise the `MAX(rowid)` tie-breaker. 18-05 Test 4 manually inserts two rows via `storage.brandScores.insert`, which works because migration 043 allows multiple rows regardless of the retag path. So technically the test does not depend on 18-04 being landed — but conceptually, the retag semantics 18-05 tests for (two rows, latest wins) are owned by 18-04. If 18-04's plan is reshaped, 18-05's test semantics drift silently.

**Fix hint:** Add `18-04` to Plan 18-05's `depends_on`. This has no practical impact on Wave 3 parallelism (18-05 and 18-06 both already wait for Wave 2 to finish), but makes the conceptual ownership explicit. Alternatively, document in 18-05's scope_clarification that the MAX(rowid) test simulates retag at the repository layer, not at the retag-function layer.

### WARN-2 — Plan 18-04 `files_modified` incomplete

**Severity:** warning
**Dimension:** task_completeness

Plan 18-04 `files_modified` omits the retag caller files (graphql/resolvers.ts, routes/admin/branding-guidelines.ts, routes/api/branding.ts). Resolved by fixing BLOCKER-1.

### WARN-3 — Plan 18-02 `noUnusedLocals` escape hatch

**Severity:** warning
**Dimension:** task_completeness

Plan 18-02 Task 1 action block says:

> "Two new unused `private readonly` fields are fine — `noUnusedLocals` does not fire on class fields in the dashboard's tsconfig (verified by existing unused-private patterns in the codebase; if lint fails on unused, add `// @ts-expect-error plan 18-02 plumbing — consumed by plan 18-03` comments)"

`@ts-expect-error` on a private readonly declaration that IS used at the constructor-assignment site is the wrong escape hatch — `@ts-expect-error` suppresses a specific error on a specific line. For an unused field, the correct escape is `// eslint-disable-next-line ...` or `void this.brandingOrchestrator;` at the end of the constructor (or simply no escape because TypeScript's `noUnusedLocals` does not flag private class fields by default). The suggested escape is a code-smell that Plan 18-03 will need to immediately clean up. Better: verify once (by reading the dashboard's tsconfig.json) that `noUnusedLocals` is off or does not apply to class fields, then land without any escape hatch.

**Fix hint:** Replace the `@ts-expect-error` fallback guidance with: "Read `packages/dashboard/tsconfig.json` `compilerOptions.noUnusedParameters`; if true, add a single `void this.brandingOrchestrator; void this.brandScoreRepository;` line at the end of the constructor as a 'reserve for plan 18-03' marker that is naturally deleted when the fields get their first real use."

### WARN-4 — Plan 18-03 `brandGuideline!` non-null assertion is fragile

**Severity:** warning
**Dimension:** task_completeness

Plan 18-03 action block says:

> "Handle the `brandGuideline!` non-null assertions. Inside the `result.kind === 'matched'` branch, we need the original `brandGuideline` (dashboard record) to populate `reportData.branding`. The orchestrator short-circuits to `no-guideline` when we pass `null`, so if we reach `matched`, `brandGuideline` was non-null and `orchestratorGuideline` was non-null. The `!` assertions are sound..."

The reasoning is sound in the happy path but the TypeScript compiler cannot see through this invariant. The suggested fallback `(brandGuideline as NonNullable<typeof brandGuideline>).id` is a coercion, not a proof. A cleaner pattern: hoist the guard into a local variable before the `matchAndScore` call:

```typescript
if (!orchestratorGuideline) {
  // No-guideline branch — no insert, no enrichment.
  return;
}
const liveGuideline = brandGuideline!;  // or: narrowed by prior if
// ... use liveGuideline.id everywhere
```

**Fix hint:** In Plan 18-03 action block, replace the `brandGuideline!.id` pattern with a local `const liveGuideline = brandGuideline;` captured AFTER the `orchestratorGuideline !== null` check, so TypeScript narrows it without assertions. Low-risk cleanup; purely stylistic.

---

## Info Notes

### INFO-1 — Phase 18 has no VALIDATION.md but has inline TDD tests

Dimension 8 Nyquist compliance: no `18-VALIDATION.md` artifact, but every implementation task has a vitest-backed `<verify><automated>` block, Wave 3 has a post-rewire latency gate with literal PASS/FAIL, and Plan 18-03 + 18-04 + 18-05 all include new invariant-pinning test files. The spirit of Nyquist compliance is satisfied. Flagged for awareness — if the project standard requires a VALIDATION.md per phase, it should be added separately.

### INFO-2 — Phase 18 reuses `'no-branded-issues'` as a degraded-branch UnscorableReason

Plans 18-03 and 18-04 use `{ kind: 'unscorable', reason: 'no-branded-issues' }` for the degraded branch because the Phase 15 UnscorableReason enum has no `'service-degraded'` literal. This is documented explicitly in 18-03 `<scope_clarification>` with a note that "Phase 20 UI will render any unscorable row with an empty-state panel regardless of reason". A future phase may want to extend UnscorableReason to add `'service-degraded'` — logged here as a known compromise, NOT a silent scope reduction.

### INFO-3 — 18-02 Wave 1 ordering vs 18-01

18-02 in Wave 1 modifies `scanner/orchestrator.ts` (adds constructor fields) but leaves the inline block in place. 18-01 measures the same file in observation-only mode. If 18-01 and 18-02 execute truly in parallel, the bench might measure a scanner that has 2 new unused fields — but the inline block is still the hot path, and the 2 unused fields have zero runtime cost. So the baseline remains valid. Alternatively (cleaner): 18-01 runs the bench against `git stash` / HEAD before 18-02 lands, via the orchestrator waiting for 18-01's bench completion before starting 18-02. Neither plan declares this ordering explicitly, but it doesn't affect the gate math. Flagged for awareness.

---

## Recommended Fix List (in order)

1. **BLOCKER-2:** Add a real-SqliteStorageAdapter COUNT(*) test for BSTORE-03 append-only in Plan 18-04 (mirror Plan 18-05 Test 4 pattern).
2. **BLOCKER-1:** Enumerate 18-04's 13 retag call sites in `files_modified` + action block + acceptance criteria.
3. **WARN-1:** Add `18-04` to Plan 18-05's `depends_on`.
4. **WARN-2:** (resolved by BLOCKER-1 fix)
5. **WARN-3:** Replace 18-02's `@ts-expect-error` fallback with a cleaner `void this.x;` pattern after reading tsconfig.
6. **WARN-4:** Replace 18-03's `brandGuideline!` pattern with `const liveGuideline = brandGuideline;` after narrowing.
7. **INFO-1/2/3:** no action required; logged for awareness.

After these fixes, re-run the checker. Blockers must flip to PASS before Plan 18 enters execution.

---

## Plan Summary Table

| Plan | Wave | Tasks | Files Modified | Requirements | Risk |
|------|------|-------|----------------|--------------|------|
| 18-01 | 1 | 2 | 2 (script + baseline md) | BSTORE-02 | low (observation-only) |
| 18-02 | 1 | 3 | 3 (orchestrator + server + test) | BSTORE-02 | low (plumbing only) |
| 18-03 | 2 | 2 | 2 (orchestrator + new test) | BSTORE-02, BSTORE-06 | **high** (hot path rewire) |
| 18-04 | 2 | 3 | 2 declared + ≥3 undeclared | BSTORE-03 | **medium-high** (fan-out) |
| 18-05 | 3 | 3 | 6 (types + repo + mapper + tests) | BSTORE-04, BSTORE-06 | medium (NULL-safe SQL) |
| 18-06 | 3 | 2 | 2 (post md + gate md) | BSTORE-02 | **high** (binding gate) |

**Wave dependency graph:**

```
Wave 1:  18-01 (baseline, []), 18-02 (plumbing, [])
Wave 2:  18-03 (rewire, [18-02]), 18-04 (retag, [18-02])
Wave 3:  18-05 (trend, [18-03]), 18-06 (gate, [18-01, 18-03, 18-04, 18-05])
```

No cycles, no forward references, dependency order honors the baseline-before-rewire contract.
