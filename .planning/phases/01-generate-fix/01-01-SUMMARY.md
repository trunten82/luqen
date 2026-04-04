---
phase: 01-generate-fix
plan: "01"
subsystem: llm
tags: [capability, generate-fix, wcag, accessibility, tdd]
dependency_graph:
  requires: []
  provides:
    - POST /api/v1/generate-fix endpoint
    - executeGenerateFix capability executor
    - buildGenerateFixPrompt prompt builder
    - parseGenerateFixResponse JSON parser
  affects:
    - packages/llm/src/api/routes/capabilities-exec.ts
tech_stack:
  added: []
  patterns:
    - Capability executor pattern (mirror of extract-requirements)
    - Prompt builder with context truncation
    - Graceful JSON parse fallback
key_files:
  created:
    - packages/llm/src/capabilities/generate-fix.ts
    - packages/llm/src/prompts/generate-fix.ts
    - packages/llm/tests/capabilities/generate-fix.test.ts
  modified:
    - packages/llm/src/api/routes/capabilities-exec.ts
decisions: []
metrics:
  duration: "2 minutes"
  completed: "2026-04-04T14:35:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
---

# Phase 01 Plan 01: Generate-Fix Capability Summary

**One-liner:** generate-fix capability executor with retry/fallback chain, WCAG prompt builder, and POST /api/v1/generate-fix Fastify route.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Implement generate-fix capability executor and default prompt | 63d4ead | generate-fix.ts, prompts/generate-fix.ts, generate-fix.test.ts |
| 2 | Register POST /api/v1/generate-fix route in capabilities-exec.ts | fd3f129 | capabilities-exec.ts |

## What Was Built

### packages/llm/src/capabilities/generate-fix.ts

Exports `executeGenerateFix`, `GenerateFixInput`, `GenerateFixResult`, `parseGenerateFixResponse`, and `RetryOptions`. Mirrors the extract-requirements capability executor exactly:

- Fetches models via `db.getModelsForCapability('generate-fix', orgId)`
- Throws `CapabilityNotConfiguredError` when no models assigned
- Iterates models in priority order with per-model retry loop (exponential backoff)
- Applies per-org prompt override template when present (Handlebars-style `{{field}}` placeholders)
- Falls back to `buildGenerateFixPrompt` for the default prompt
- Throws `CapabilityExhaustedError` after all models exhausted
- `parseGenerateFixResponse` returns `{ fixedHtml: '', explanation: '', effort: 'medium' }` for any malformed JSON

### packages/llm/src/prompts/generate-fix.ts

Exports `buildGenerateFixPrompt`. Truncates `htmlContext` at 5000 chars and `cssContext` at 2000 chars. Injects `wcagCriterion`, `issueMessage`, `htmlContext`, and optional `cssContext` into a structured WCAG accessibility expert prompt. Instructs the model to respond with JSON only: `{ fixedHtml, explanation, effort }`.

### packages/llm/src/api/routes/capabilities-exec.ts

Added `POST /api/v1/generate-fix` route to `registerCapabilityExecRoutes`:
- Requires `wcagCriterion`, `issueMessage`, `htmlContext` (HTTP 400 if missing)
- Accepts optional `cssContext` and `orgId`
- Resolves `orgId` from body or JWT (same pattern as extract-requirements)
- Error mapping: `CapabilityNotConfiguredError` → 503, `CapabilityExhaustedError` → 504, other → 502
- Response: `{ fixedHtml, explanation, effort, model, provider, attempts }`

## Test Results

7 new tests added in `packages/llm/tests/capabilities/generate-fix.test.ts`:
1. `throws CapabilityNotConfiguredError when no model assigned to generate-fix`
2. `returns { data: { fixedHtml, explanation, effort }, model, provider, attempts } when LLM returns valid JSON`
3. `retries on error and falls through to next model (CapabilityExhaustedError after all exhausted)`
4. `uses prompt override template when org override exists`
5. `returns { fixedHtml: "", explanation: "", effort: "medium" } for malformed JSON`
6. `returns parsed values for valid JSON`
7. `includes wcagCriterion, issueMessage, and htmlContext in the returned string`

Full LLM test suite: **85 passed** (was 78 before this plan — 7 new tests added).

## Verification

```
npx tsc --noEmit -p packages/llm/tsconfig.json  → 0 errors
npx vitest run packages/llm/tests/               → 85 passed
grep "app.post('/api/v1/generate-fix'"           → match found
grep "executeGenerateFix"                        → match found (import + usage)
grep "wcagCriterion is required"                 → match found
grep "app.post('/api/v1/extract-requirements'"   → existing route unchanged
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — the capability executor, prompt builder, and route are fully wired. Data flows from request body through capability engine to LLM provider and back.

## Self-Check: PASSED

- [x] packages/llm/src/capabilities/generate-fix.ts — FOUND
- [x] packages/llm/src/prompts/generate-fix.ts — FOUND
- [x] packages/llm/tests/capabilities/generate-fix.test.ts — FOUND
- [x] packages/llm/src/api/routes/capabilities-exec.ts — modified, FOUND
- [x] Commit 63d4ead — FOUND (Task 1)
- [x] Commit fd3f129 — FOUND (Task 2)
