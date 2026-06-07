---
phase: 80-mcp-fix-tools-for-coding-agents
plan: "01"
subsystem: llm
tags: [capability, generate-fix, wcag, diff, gutenberg, platform, tdd]
dependency_graph:
  requires: []
  provides:
    - GenerateFixResult.wcagCriterion (echoed)
    - GenerateFixResult.diff (before/after)
    - GenerateFixInput.platform (html | wordpress-gutenberg)
    - buildGutenbergFixPrompt (WP-Gutenberg-aware prompt)
    - POST /api/v1/generate-fix returns wcagCriterion + diff + accepts platform
  affects:
    - packages/llm/src/capabilities/generate-fix.ts
    - packages/llm/src/prompts/generate-fix.ts
    - packages/llm/src/api/routes/capabilities-exec.ts
tech_stack:
  added: []
  patterns:
    - Additive type widening (optional fields on existing interfaces — D-05)
    - Platform-selected prompt builder (factory switch in capability layer)
    - Labelled before/after diff without external dependency (buildDiff helper)
key_files:
  created: []
  modified:
    - packages/llm/src/capabilities/generate-fix.ts
    - packages/llm/src/prompts/generate-fix.ts
    - packages/llm/src/api/routes/capabilities-exec.ts
    - packages/llm/tests/capabilities/generate-fix.test.ts
decisions:
  - "Hand-built labelled before/after diff (no npm dependency) per D-04/CONTEXT.md Discretion note"
  - "additionalProperties: true preserved on GenerateFixBody (D-05 — existing callers must not break)"
  - "Platform enum validated manually in handler because body is cast to Record<string,unknown> (T-80-01)"
  - "Gutenberg prompt case-insensitive 'gutenberg' check in test (prompt uses capitalised 'Gutenberg')"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-07"
  tasks: 3
  files_changed: 4
---

# Phase 80 Plan 01: Extend generate-fix — wcagCriterion echo, diff, WP-Gutenberg variant Summary

**One-liner:** Widened generate-fix capability to echo wcagCriterion, emit a labelled before/after diff, and route `platform='wordpress-gutenberg'` through a block-aware prompt, all surfaced on the HTTP route additively (D-05 compliant).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests — wcagCriterion echo + diff | 512166be | generate-fix.test.ts |
| 1 (GREEN) | Widen types, implement echo + diff | 7cacacd5 | generate-fix.ts |
| 2 (RED) | Failing tests — Gutenberg prompt routing | fe1ba6ff | generate-fix.test.ts |
| 2 (GREEN) | buildGutenbergFixPrompt + platform routing | cb216fa1 | prompts/generate-fix.ts, capabilities/generate-fix.ts, tests |
| 3 | Surface fields on HTTP route | c579af9a | capabilities-exec.ts |

## What Was Built

### GenerateFixInput / GenerateFixResult widening (D-05 additive)

`GenerateFixInput` gained an optional `platform?: 'html' | 'wordpress-gutenberg'` field. `GenerateFixResult` gained optional `wcagCriterion?: string` (echoed from input) and `diff?: string` (labelled before/after). All new fields are optional — zero existing call sites require changes.

### buildDiff helper

Deterministic labelled before/after diff: `--- before\n{htmlContext}\n+++ after\n{fixedHtml}`. Returns empty string on degraded parse (fixedHtml empty), ensuring the fallback path stays well-formed (D-04).

### buildGutenbergFixPrompt (packages/llm/src/prompts/generate-fix.ts)

Mirrors `buildGenerateFixPrompt` exactly (LOCKED:variable-injection, LOCKED:output-format, identical JSON output contract `{ fixedHtml, explanation, effort }`, same MAX_HTML_LENGTH/MAX_CSS_LENGTH truncation). Instructions section requires valid WP block comment delimiters and block.json-aware attributes per D-07.

### Platform routing in executeGenerateFix

When no promptOverride: `platform === 'wordpress-gutenberg'` → `buildGutenbergFixPrompt`; otherwise → `buildGenerateFixPrompt`. promptOverride always wins (precedence preserved). Signature unchanged (4 params).

### POST /api/v1/generate-fix route updates

- Body schema: optional `platform` enum (`'html' | 'wordpress-gutenberg'`)
- Handler: manual platform validation — unknown values rejected 400 (T-80-01)
- Handler: passes platform into executeGenerateFix
- Response schema: adds optional `wcagCriterion` and `diff`
- Handler reply: includes `capResult.data.wcagCriterion` and `capResult.data.diff`
- No fs/write side effects (D-09 never-apply)

## Verification

```
npx tsc -p packages/llm/tsconfig.json --noEmit  → clean
npx vitest run packages/llm/tests/              → 448/448 passed (49 test files)
grep -nE "writeFile|fs\.|applyFix|\.write\(" packages/llm/src/capabilities/generate-fix.ts → empty
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Misplaced tests outside describe block**
- **Found during:** Task 1 RED phase
- **Issue:** First edit placed new `it()` tests outside the `describe('executeGenerateFix')` block (after its closing `});`), causing a parse error
- **Fix:** Restructured tests to be inside the correct describe block
- **Files modified:** packages/llm/tests/capabilities/generate-fix.test.ts
- **Commit:** 512166be

**2. [Rule 1 - Bug] Corrupted prompts file**
- **Found during:** Task 2 — attempted to add type alias via partial edit
- **Issue:** Edit left a function overload signature merged with inline object type, corrupting generate-fix.ts prompts file
- **Fix:** Rewrote the file cleanly via Write tool
- **Files modified:** packages/llm/src/prompts/generate-fix.ts
- **Commit:** cb216fa1

**3. [Deviation - Test adjustment] Gutenberg case-sensitivity**
- **Found during:** Task 2 GREEN verification
- **Issue:** Test used `.toContain('gutenberg')` (lowercase) but prompt text uses capitalised 'Gutenberg'; test failed despite correct implementation
- **Fix:** Changed positive Gutenberg test to `.toLowerCase().toContain('gutenberg')` matching the negative test's approach
- **Files modified:** packages/llm/tests/capabilities/generate-fix.test.ts
- **Commit:** cb216fa1

**4. [Deviation - Security] additionalProperties reverted to true**
- **Found during:** Task 3 implementation
- **Issue:** Changed GenerateFixBody to `additionalProperties: false` would break existing callers sending extra body fields; D-05 prohibits such breaking changes
- **Fix:** Reverted to `additionalProperties: true`; platform validated manually in handler per T-80-01
- **Files modified:** packages/llm/src/api/routes/capabilities-exec.ts
- **Commit:** c579af9a

## Known Stubs

None — all new fields are wired through real data paths. `diff` is computed from actual `htmlContext` and `fixedHtml` values. No placeholders.

## Threat Flags

No new threat surface beyond what the plan's threat model covers. T-80-01 mitigated (platform enum validated at handler). T-80-04 maintained (MAX_HTML_LENGTH/MAX_CSS_LENGTH preserved in both prompt builders).

## Self-Check: PASSED

- packages/llm/src/capabilities/generate-fix.ts: exists
- packages/llm/src/prompts/generate-fix.ts: exists (buildGutenbergFixPrompt exported)
- packages/llm/src/api/routes/capabilities-exec.ts: exists
- packages/llm/tests/capabilities/generate-fix.test.ts: exists (15 tests)
- Commits 512166be, 7cacacd5, fe1ba6ff, cb216fa1, c579af9a: all present
- tsc --noEmit: clean
- vitest: 448/448 passed
