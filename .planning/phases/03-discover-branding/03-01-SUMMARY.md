---
phase: 03-discover-branding
plan: "01"
subsystem: llm
tags: [capability, branding, fetch, tdd]
dependency_graph:
  requires: []
  provides: [discover-branding-capability, discover-branding-route]
  affects: [llm-api]
tech_stack:
  added: []
  patterns: [capability-executor, url-fetch, brand-extraction, retry-fallback]
key_files:
  created:
    - packages/llm/src/capabilities/discover-branding.ts
    - packages/llm/src/prompts/discover-branding.ts
    - packages/llm/tests/capabilities/discover-branding.test.ts
  modified:
    - packages/llm/src/api/routes/capabilities-exec.ts
decisions:
  - AbortSignal.timeout(15000) used for URL fetch — graceful degradation on network failure returns empty htmlContent/cssContent, capability proceeds with empty strings rather than throwing
  - temperature 0.2 chosen for discover-branding (same as generate-fix) — structured JSON extraction benefits from low temperature
  - CSS extraction strips script tags and limits body to 3000 chars to keep prompt within LLM context windows
metrics:
  duration: "~2 min"
  completed_date: "2026-04-04"
  tasks_completed: 2
  files_created: 3
  files_modified: 1
---

# Phase 03 Plan 01: Discover Branding Capability Summary

## One-Liner

HTML/CSS-fetching brand discovery capability with retry/fallback chain, structured JSON output, and POST /api/v1/discover-branding endpoint.

## What Was Built

Added the `discover-branding` capability to the LLM microservice. The executor fetches the target URL (with a 15s timeout), extracts inline CSS from `<style>` tags, includes external stylesheet links as comments for LLM context, strips scripts and reduces the HTML skeleton to head + first 3000 chars of body, then sends extracted brand signals to the LLM via the existing retry/fallback engine.

The prompt builder truncates HTML at 8000 chars and CSS at 3000 chars to prevent context overflow. The response parser returns safe empty defaults for malformed LLM output. URL fetch failures return empty htmlContent/cssContent — the capability proceeds and the LLM returns empty brand data rather than throwing an error.

The new route validates url (presence + http/https scheme), resolves orgId from body or JWT, maps errors to 503/504/502, and returns `{ colors, fonts, logoUrl, brandName, model, provider, attempts }`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Discover-branding capability executor and prompt (TDD) | a4a6aad | discover-branding.ts, prompts/discover-branding.ts, tests |
| 2 | Register POST /api/v1/discover-branding route | 593d1e1 | capabilities-exec.ts |

## Test Results

- 8 new tests (all passing): CapabilityNotConfiguredError, valid fetch+LLM, retry+exhausted, prompt override, fetch failure graceful degradation, parseDiscoverBrandingResponse malformed/valid, buildDiscoverBrandingPrompt content
- Full LLM suite: 101/101 tests passing
- TypeScript: zero errors

## Deviations from Plan

None — plan executed exactly as written. The test count is 8 (not 7) because `parseDiscoverBrandingResponse` has two test cases (malformed and valid) which the plan grouped as one but the test file split for clarity.

## Known Stubs

None. All fields return real LLM-extracted data or safe empty defaults.

## Self-Check: PASSED

- packages/llm/src/capabilities/discover-branding.ts — FOUND
- packages/llm/src/prompts/discover-branding.ts — FOUND
- packages/llm/tests/capabilities/discover-branding.test.ts — FOUND
- POST /api/v1/discover-branding in capabilities-exec.ts — FOUND
- Commits a4a6aad and 593d1e1 — FOUND
