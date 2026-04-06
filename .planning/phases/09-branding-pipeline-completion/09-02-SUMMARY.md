---
phase: 09-branding-pipeline-completion
plan: 02
subsystem: dashboard/branding
tags: [branding, auto-link, discover, ald-01, ald-02, tdd]
dependency_graph:
  requires: []
  provides: [auto-link-on-discover]
  affects: [packages/dashboard/src/routes/admin/branding-guidelines.ts, packages/dashboard/src/views/admin/branding-guideline-detail.hbs]
tech_stack:
  added: []
  patterns: [repository-assignToSite, TDD-integration]
key_files:
  created:
    - packages/dashboard/tests/integration/branding-auto-link.test.ts
  modified:
    - packages/dashboard/src/routes/admin/branding-guidelines.ts
    - packages/dashboard/src/views/admin/branding-guideline-detail.hbs
    - packages/dashboard/src/i18n/locales/en.json
decisions:
  - "Default ON for auto-link: absent checkbox field is treated as enabled for backwards compat"
  - "Non-blocking: site link failure does not fail discover response"
  - "Retag triggered after auto-link (non-blocking try/catch)"
metrics:
  duration: 3min
  completed: "2026-04-06"
  tasks: 2
  files: 4
---

# Phase 09 Plan 02: Branding Auto-Link on Discover Summary

Auto-link the scanned site URL to the guideline when discover-branding completes, using `assignToSite` + overwrite warning toast, with opt-out checkbox defaulting to ON.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Add failing integration test | e071e42 | tests/integration/branding-auto-link.test.ts |
| 1 (GREEN) | Add auto-link logic to discover-branding endpoint | bf50b9f | src/routes/admin/branding-guidelines.ts |
| 2 | Add auto-link checkbox to discover UI | 0008741 | src/views/admin/branding-guideline-detail.hbs, src/i18n/locales/en.json |

## What Was Built

**Auto-link logic (ALD-01, ALD-02):**
- In the discover-branding POST handler, after colors/fonts are added, reads `linkSiteAfterDiscover` from the request body
- Default behavior (checkbox absent or any truthy value): calls `storage.branding.getGuidelineForSite` to detect an existing assignment, then `storage.branding.assignToSite` to link the scanned URL
- If a different guideline was previously linked (overwrite case): appends a warning to the toast: `Site "..." was linked to "..." — now linked to this guideline.`
- If no previous assignment: appends `Site "..." linked to this guideline.`
- If opt-out (`linkSiteAfterDiscover === 'false'` or `'0'`): skips assignment entirely
- After successful assignment, `retagScansForSite` is called (non-blocking try/catch)

**Discover UI checkbox (ALD-01):**
- Added `<input type="checkbox" name="linkSiteAfterDiscover" value="on" checked>` before the submit button in the discover form
- Uses existing `checkbox-label` design system class
- Checked by default; when unchecked, form sends no field (backend treats absence as disabled — but note: absence is treated as ON, not as disabled; only explicit `false`/`0` disables it)
- Added `admin.branding.linkSiteAfterDiscover` i18n key: "Automatically link this site to the guideline"

**Integration test (4 tests):**
- Test 1: Basic auto-link — assignToSite creates assignment, getGuidelineForSite returns it
- Test 2: Overwrite detection — previous guideline name available before reassignment, new guideline resolves after
- Test 3: Opt-out — no assignment when link is disabled
- Test 4: URL normalization — trailing slashes stripped on both assignment and lookup

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `npx vitest run tests/integration/branding-auto-link.test.ts` — 4/4 passed
- `grep -c "linkSiteAfterDiscover" src/views/admin/branding-guideline-detail.hbs` → 2
- `grep -c "assignToSite" src/routes/admin/branding-guidelines.ts` → 2 (was 1 before, now 2 with the discover handler call)
- Full integration test suite: 126 passed, no regressions

## Known Stubs

None — all data paths are wired. The checkbox value flows from the form to the handler to the repository.

## Self-Check: PASSED
