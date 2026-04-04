---
phase: 03-discover-branding
plan: "02"
subsystem: dashboard
tags: [llm, branding, htmx, i18n, typescript]
dependency_graph:
  requires:
    - 03-01  # LLM service /api/v1/discover-branding endpoint
  provides:
    - LLMClient.discoverBranding method
    - POST /admin/branding-guidelines/:id/discover-branding route
    - Discover Brand UI on guideline detail page
  affects:
    - packages/dashboard/src/llm-client.ts
    - packages/dashboard/src/routes/admin/branding-guidelines.ts
    - packages/dashboard/src/views/admin/branding-guideline-detail.hbs
    - packages/dashboard/src/views/admin/llm.hbs
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/static/style.css
tech_stack:
  added: []
  patterns:
    - apiFetch pattern extended with discoverBranding method
    - llmClient optional parameter added to route function signature
    - llmEnabled guard in Handlebars template
    - HTMX hx-include targeting by id for non-form CSRF inclusion
key_files:
  created: []
  modified:
    - packages/dashboard/src/llm-client.ts
    - packages/dashboard/src/routes/admin/branding-guidelines.ts
    - packages/dashboard/src/server.ts
    - packages/dashboard/src/views/admin/branding-guideline-detail.hbs
    - packages/dashboard/src/views/admin/llm.hbs
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/static/style.css
decisions:
  - "llmClient passed as explicit parameter (not closure) to brandingGuidelineRoutes for consistent pattern with other route modules"
  - "Empty LLM result (no colors/no fonts) returns success toast explaining no signals detected, not an error"
  - "toastHtml only accepts success/error types — 'info' variant not available, used default success for empty result message"
  - "hx-include targets #discover-url and [name='_csrf'] to include standalone input without a wrapping form element"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-04"
  tasks: 2
  files_modified: 7
---

# Phase 03 Plan 02: Dashboard Discover Branding Integration Summary

**One-liner:** Dashboard wired to LLM discover-branding endpoint — LLMClient.discoverBranding, POST route with storage writes, and HTMX UI guarded by llmEnabled.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add LLMClient.discoverBranding + POST route | c5245aa | llm-client.ts, branding-guidelines.ts, server.ts |
| 2 | Discover Brand UI, i18n, CSS, LLM prompt hint | 3daa54b | branding-guideline-detail.hbs, llm.hbs, en.json, style.css |

## What Was Built

**Task 1 — Backend:**
- Added `discoverBranding(input: { url, orgId? })` method to `LLMClient` following the `apiFetch` pattern (mirrors `analyseReport`)
- Updated `brandingGuidelineRoutes` function signature to accept `LLMClient | null` as third parameter (existing `uploadsDir` becomes fourth)
- Added POST `/admin/branding-guidelines/:id/discover-branding` route with:
  - `branding.manage` permission guard
  - 404 if guideline not found
  - 503 if llmClient is null
  - 400 validation: URL must start with `http://` or `https://`
  - LLM call → writes each color via `storage.branding.addColor` and each font via `storage.branding.addFont`
  - Empty result (no colors and no fonts) → descriptive success toast
  - LLM errors → 502 toast
- Added `llmEnabled: llmClient !== null` to the GET detail handler's `reply.view` call
- Updated `server.ts` call site: `brandingGuidelineRoutes(server, storage, llmClient, uploadsDir)`

**Task 2 — Frontend:**
- Added Discover Brand card to `branding-guideline-detail.hbs` guarded by `{{#if llmEnabled}}{{#if perm.brandingManage}}`
  - URL input with `hx-post`, button targeting `#brd-discover-result`, CSRF hidden field, result div with `aria-live="polite"`
- Added `{{else if (eq capability 'discover-branding')}}` branch in the Prompts tab of `admin/llm.hbs` showing `{{url}}`, `{{htmlContent}}`, `{{cssContent}}` variable hints
- Added 7 i18n keys under `admin.branding`: discoverHeading, discoverDescription, discoverButton, discoverUrlPlaceholder, discoverSuccess, discoverEmpty, discoverError
- Added `brd-discover`, `brd-discover__form`, `brd-discover__input-group` CSS using design system spacing tokens with fallbacks

## Deviations from Plan

**1. [Rule 1 - Bug] Fixed toastHtml 'info' type**
- **Found during:** Task 1 TypeScript compile
- **Issue:** `toastHtml` signature only accepts `'success' | 'error' | undefined` — plan specified passing `'info'` for empty-result toast
- **Fix:** Used default (success) type for the "no brand signals detected" message, which renders as a neutral success toast
- **Files modified:** packages/dashboard/src/routes/admin/branding-guidelines.ts
- **Commit:** c5245aa

**2. [Rule 2 - Pattern] HTMX form without wrapping form element**
- **Found during:** Task 2 template implementation
- **Issue:** Plan described `hx-include="[name='_csrf']"` but the CSRF input is inside a flex container alongside the URL input, not inside a form element. The URL input needs to be included by id.
- **Fix:** Used `hx-include="#discover-url,[name='_csrf']"` to include both the standalone URL input and CSRF hidden field
- **Files modified:** packages/dashboard/src/views/admin/branding-guideline-detail.hbs
- **Commit:** 3daa54b

## Known Stubs

None. All data flows are wired: UI form → HTMX POST → route handler → LLMClient.discoverBranding → storage.branding.addColor/addFont.

## Verification

- TypeScript: 0 errors across packages/dashboard and packages/llm
- Tests: 2092 passed, 40 skipped (no regressions)
- All success criteria met (grep verified)

## Self-Check: PASSED

Files exist:
- packages/dashboard/src/llm-client.ts — FOUND
- packages/dashboard/src/routes/admin/branding-guidelines.ts — FOUND
- packages/dashboard/src/views/admin/branding-guideline-detail.hbs — FOUND
- packages/dashboard/src/views/admin/llm.hbs — FOUND
- packages/dashboard/src/i18n/locales/en.json — FOUND
- packages/dashboard/src/static/style.css — FOUND

Commits exist:
- c5245aa — FOUND
- 3daa54b — FOUND
