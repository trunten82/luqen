---
phase: 10-css-import-org-api-keys
plan: "01"
subsystem: branding
tags: [css-parser, branding, import, tdd]
dependency_graph:
  requires: []
  provides: [parseCSS, CSS upload endpoint, CSS import UI]
  affects: [branding guideline detail page, @luqen/branding]
tech_stack:
  added: []
  patterns: [TDD red-green, additive merge, dynamic import]
key_files:
  created:
    - packages/branding/src/parser/css-parser.ts
    - packages/branding/tests/parser/css-parser.test.ts
    - packages/dashboard/tests/routes/admin/branding-css-upload.test.ts
  modified:
    - packages/branding/src/parser/index.ts
    - packages/branding/src/index.ts
    - packages/dashboard/src/routes/admin/branding-guidelines.ts
    - packages/dashboard/src/views/admin/branding-guideline-detail.hbs
    - packages/dashboard/src/i18n/locales/en.json
decisions:
  - "Built branding package in both worktree and main repo — node_modules symlinks to main repo dist, so both need building"
  - "Additive merge: skip duplicate colors by uppercase hex, skip duplicate fonts by lowercase family name"
  - "Audit logging via storage.audit.log (not storage.auditLog) to match existing route patterns"
metrics:
  duration: 9m
  completed: "2026-04-06"
  tasks: 3
  files_created: 3
  files_modified: 5
---

# Phase 10 Plan 01: CSS Import for Branding Guidelines Summary

**One-liner:** CSS parser in @luqen/branding extracts colors (custom properties + hex) and fonts (font-family + shorthand) from CSS content, wired into a new dashboard upload endpoint with additive merge and HTMX UI.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create CSS parser in @luqen/branding with tests | 83c02d7 | css-parser.ts, parser/index.ts, branding/src/index.ts, css-parser.test.ts |
| 2 | Wire CSS upload endpoint and UI | 0a6835c | branding-guidelines.ts, branding-guideline-detail.hbs, en.json |
| 3 | Integration tests for CSS upload endpoint | 1000fa3 | branding-css-upload.test.ts |

## What Was Built

### CSS Parser (`@luqen/branding`)

`parseCSS(cssContent: string): ParsedCSSResult` extracts:
- Colors from CSS custom properties: `--brand-primary: #1E40AF` → `{ name: "brand-primary", hex: "#1E40AF" }`
- Colors from regular properties: `background-color: #1F2937` → `{ name: "background-color-1", hex: "#1F2937" }`
- 3-digit hex expansion to 6-digit uppercase: `#F00` → `#FF0000`
- Font families from `font-family` declarations: `'Inter', sans-serif` → `{ family: "Inter" }`
- Font families from `font` shorthand: `"Playfair Display"` quoted names
- Deduplication by hex (case-insensitive) and family (case-insensitive)
- Strips CSS comments before parsing
- Ignores 13 generic font families (serif, sans-serif, monospace, etc.)

### Upload Endpoint (`/admin/branding-guidelines/:id/upload-css`)

- `POST` with `cssContent` form field
- `preHandler: requirePermission('branding.manage')`
- Loads guideline, verifies org ownership (or global admin)
- Parses CSS, performs additive merge (no duplicates by hex/family)
- Calls `retagAllSitesForGuideline` after import (non-fatal)
- Returns `HX-Refresh: true` + success toast with counts
- Logs `branding_guideline.css_import` audit entry
- Returns error toast for empty/comment-only CSS

### UI Section (branding-guideline-detail.hbs)

- Card with textarea (8 rows) between image upload and discover-branding sections
- HTMX form posts to `upload-css`, targets `#toast-container`
- Loading spinner via `htmx-indicator`
- 7 i18n keys added under `admin.branding`

### Integration Tests (5 tests, all passing)

1. Valid CSS extraction → success toast with color/font counts
2. Empty CSS → error toast "No colors or fonts found"
3. Missing `branding.manage` → 403
4. Non-existent guideline → 404
5. Additive merge → both existing and new colors present after import

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Build required in both worktree and main repo**
- **Found during:** Task 2 TypeScript check
- **Issue:** `node_modules/@luqen/branding` symlinks to `/root/luqen/packages/branding` (main repo), not the worktree. Building only in the worktree left the TypeScript check resolving to the old dist without `parseCSS`.
- **Fix:** Copied new source files to main repo (`/root/luqen/packages/branding/src/`) and ran `npm run build` there.
- **Files modified:** `/root/luqen/packages/branding/src/parser/css-parser.ts`, `parser/index.ts`, `src/index.ts`
- **Commit:** Part of 83c02d7 (worktree build also ran)

**2. [Rule 1 - Bug] Regex negative lookbehind ate first character of property names**
- **Found during:** Task 1 GREEN (test: "extracts colors from 6-digit hex in regular properties")
- **Issue:** `(?<![- ])` consumed the character before the property name, turning `background-color` into `ackground-color`
- **Fix:** Changed to `(?:^|[{;}\s])` multiline anchor to only match property names at statement boundaries
- **Commit:** 83c02d7

**3. [Rule 2 - Missing] Used `storage.audit.log` instead of nonexistent `storage.auditLog.add`**
- **Found during:** Task 2 code review
- **Issue:** Plan specified `storage.auditLog?.add(...)` but existing routes use `void storage.audit.log(...)`
- **Fix:** Used correct interface from `AuditRepository`
- **Commit:** 0a6835c

## Known Stubs

None — all functionality fully wired. The CSS import section uses real data from the parser.

## Self-Check

- [x] `packages/branding/src/parser/css-parser.ts` exists
- [x] `packages/branding/tests/parser/css-parser.test.ts` exists (12 tests, all pass)
- [x] `packages/dashboard/tests/routes/admin/branding-css-upload.test.ts` exists (5 tests, all pass)
- [x] `packages/dashboard/src/routes/admin/branding-guidelines.ts` contains `upload-css` and `parseCSS`
- [x] TypeScript: no errors in dashboard or branding packages
- [x] Commits: eb9b48c (RED tests), 83c02d7 (GREEN impl), 0a6835c (Task 2), 1000fa3 (Task 3)
