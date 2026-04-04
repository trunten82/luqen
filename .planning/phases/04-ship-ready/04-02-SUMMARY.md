---
phase: 04-ship-ready
plan: 02
subsystem: llm
tags: [testing, coverage, api, auth, providers]
dependency_graph:
  requires: []
  provides: [STD-03, STD-04, STD-05]
  affects: [packages/llm]
tech_stack:
  added: []
  patterns: [vitest-integration-tests, vi.mock-for-external-deps, app.inject-fastify-testing]
key_files:
  created:
    - packages/llm/tests/api/capabilities-exec.test.ts
    - packages/llm/tests/auth/middleware.test.ts
    - packages/llm/tests/providers/registry.test.ts
    - packages/llm/tests/api/oauth.test.ts
    - packages/llm/tests/api/oauth-password.test.ts
    - packages/llm/tests/api/clients.test.ts
    - packages/llm/tests/api/providers-extended.test.ts
    - packages/llm/tests/api/models-extended.test.ts
    - packages/llm/tests/api/capabilities-extended.test.ts
    - packages/llm/tests/api/prompts-extended.test.ts
  modified: []
decisions:
  - vi.mock used for capability executor modules in capabilities-exec tests (avoids real LLM setup while testing HTTP routes)
  - vi.mock for registry used in providers-extended to test /test and /models endpoints without real adapters
  - Password grant tested in separate file using 30m tokenExpiry to cover parseExpiryToSeconds minutes branch
  - Extended test files supplement existing tests rather than replacing them (no duplication)
metrics:
  duration: 25m
  completed: "2026-04-04"
  tasks_completed: 2
  files_created: 10
---

# Phase 04 Plan 02: LLM Test Coverage Expansion Summary

**One-liner:** Expanded LLM package test suite from 101 tests at 62% statements/50% branches to 215 tests at 91.98% statements/82.07% branches — all four 80% thresholds pass.

## What Was Built

Added 10 new test files covering the highest-impact coverage gaps identified in the plan:

### Task 1: Core infrastructure tests
- **capabilities-exec.test.ts** — All 4 capability exec endpoints (generate-fix, analyse-report, discover-branding, extract-requirements), each with 400 validation, 503 not-configured, 504 exhausted, 502 upstream error, and 200 success paths using `vi.mock()` for executor modules
- **middleware.test.ts** — Public path bypass, JWT auth (valid/invalid/wrong-scope), API key auth (match/mismatch/full-scopes)
- **registry.test.ts** — `createAdapter` for ollama, openai, unsupported types; `getSupportedTypes`

### Task 2: Route layer coverage
- **oauth.test.ts** — `client_credentials` flow (valid, invalid client_id, wrong secret, missing grant_type, Basic auth, scope filtering)
- **oauth-password.test.ts** — Password grant flow, expiry format minutes, scope validation, invalid credentials
- **clients.test.ts** — GET/POST/DELETE with admin scope enforcement and 401/403 cases
- **providers-extended.test.ts** — GET by ID, PATCH 404, POST validation, `/test` endpoint (healthy/unhealthy/connect-fail), `/models` endpoint (success/404/502)
- **models-extended.test.ts** — POST validation (missing fields, nonexistent provider), GET by ID, DELETE 404
- **capabilities-extended.test.ts** — PATCH priority, PUT validation (missing modelId, nonexistent model, explicit priority), DELETE 404
- **prompts-extended.test.ts** — Default template return, extract-requirements default, GET 400, override with orgId, PUT validation, DELETE 404

## Coverage Results

```
File                  | % Stmts | % Branch | % Funcs | % Lines
----------------------|---------|----------|---------|--------
All files             |   91.98 |    82.07 |   87.79 |   92.87
```

All four 80% thresholds pass. `npm run test:coverage` exits 0.

## Deviations from Plan

### Auto-fixed Issues

None required.

### Additional Test Files

The plan specified 7 files but the coverage analysis required additional files to close branch gaps:
- **oauth-password.test.ts** — Added to cover password grant (oauth.ts lines 54-110) and `parseExpiryToSeconds` minutes branch
- **capabilities-extended.test.ts** — Added to cover PATCH endpoint and additional PUT/DELETE branches in capabilities.ts
- **prompts-extended.test.ts** — Added to cover default template path, DELETE 404, PUT validation branches in prompts.ts

These additions were necessary to push all four metrics above 80%. Total files: 10 (vs 7 planned).

## Known Stubs

None — all test files exercise real code paths.

## Self-Check: PASSED
