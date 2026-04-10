---
phase: 13-llm-prompt-management
plan: "03"
subsystem: dashboard
tags:
  - prompt-management
  - diff-view
  - modal
  - llm
  - htmx
  - i18n
dependency_graph:
  requires:
    - 13-01  # LOCKED fence markers in default templates
    - 13-02  # split-region editor, getDefaultPrompt, LLMClient methods
  provides:
    - unified line diff modal (Compare with default) for all 4 prompt cards
    - reset-to-default confirmation modal (showing what will be lost)
    - shared prompt-diff-body.hbs partial used by both modals
    - GET /admin/llm/prompts/:capability/diff route (llm.view permission)
    - GET /admin/llm/prompts/:capability/reset-confirm route (llm.manage permission)
  affects:
    - /admin/llm?tab=prompts — prompt cards now have Compare + Reset buttons
    - packages/dashboard/src/routes/admin/llm.ts — two new GET routes added
tech_stack:
  added:
    - diff@^5.2.2 (dashboard dependency — server-side line diff)
    - "@types/diff" (devDependency for TypeScript)
    - packages/dashboard/src/services/prompt-diff.ts (new)
    - packages/dashboard/src/views/admin/partials/prompt-diff-body.hbs (new)
    - packages/dashboard/src/views/admin/partials/prompt-diff-modal.hbs (new)
    - packages/dashboard/src/views/admin/partials/prompt-reset-modal.hbs (new)
    - packages/dashboard/tests/services/prompt-diff.test.ts (new)
    - packages/dashboard/tests/routes/admin/llm-prompts-modals.test.ts (new)
  patterns:
    - Server-side diff computation via diffLines() — no client-side JS diff library
    - Handlebars auto-escaping for diff content (T-13-14 XSS mitigation)
    - close-modal-btn class for modal dismissal (app.js event delegation, no inline JS)
    - CSRF automatic via meta-tag HTMX interceptor in main layout
    - Whitelist validation of capability names in both new routes (T-13-21)
key_files:
  created:
    - packages/dashboard/src/services/prompt-diff.ts
    - packages/dashboard/src/views/admin/partials/prompt-diff-body.hbs
    - packages/dashboard/src/views/admin/partials/prompt-diff-modal.hbs
    - packages/dashboard/src/views/admin/partials/prompt-reset-modal.hbs
    - packages/dashboard/tests/services/prompt-diff.test.ts
    - packages/dashboard/tests/routes/admin/llm-prompts-modals.test.ts
  modified:
    - packages/dashboard/package.json (diff@5 + @types/diff)
    - package-lock.json
    - packages/dashboard/src/routes/admin/llm.ts (import + 2 new routes)
    - packages/dashboard/src/server.ts (prompt-diff-body partial registration)
    - packages/dashboard/src/views/admin/llm.hbs (Compare + Reset buttons in form-actions)
    - packages/dashboard/src/i18n/locales/en.json (9 new i18n keys)
decisions:
  - "prompt-diff-body.hbs uses Handlebars {{text}} (auto-escaped) not {{{text}}} — XSS mitigation T-13-14 implemented correctly."
  - "Modal close uses close-modal-btn CSS class delegated by app.js — no HTMX dismiss route needed; existing mechanism covers dynamically loaded content."
  - "VALID_CAPABILITIES whitelist const defined once inside llmAdminRoutes and shared by both new GET routes (DRY, single source of truth for T-13-21)."
  - "Tests fix: initial tests assumed diffLines() gives clean add-only/remove-only for fixtures without trailing newlines — fixed by using fixtures with trailing \\n which match real prompt templates."
  - "Permission test: requirePermission uses OR semantics; test must use minimal permission set ['llm.view'] (not ALL minus llm.manage) to reliably produce 403 for /reset-confirm."
metrics:
  duration: "~14 minutes"
  completed: "2026-04-10T10:27:22Z"
  tasks: 3
  files_changed: 12
---

# Phase 13 Plan 03: Diff View and Reset Confirmation Modals Summary

**One-liner:** Server-side unified line diff modal (Compare with default) + reset-to-default confirmation modal sharing a single Handlebars diff-body partial, backed by `diff@5`, with HTMX modal wiring and full permission guards.

## What Was Built

### Task 1: Install diff@5 and implement prompt-diff service with tests (178d796)

**`packages/dashboard/package.json`** — added `diff@^5.2.2` dependency and `@types/diff` devDependency.

**`packages/dashboard/src/services/prompt-diff.ts`** — new service:
- `computePromptDiff(oldText, newText)` using `diffLines()` from the `diff` npm package
- Returns `readonly DiffLine[]` — each entry has `type: 'add' | 'remove' | 'context'` and `text` (raw, unescaped)
- Trailing empty strings from newline-terminated values are stripped
- Under 30 lines, immutable output, no side effects

**`packages/dashboard/tests/services/prompt-diff.test.ts`** — 10 unit tests covering: identical inputs → all context; append line → add present; delete line → remove present; empty old → all adds; empty new → all removes; raw text (no HTML entities); no embedded newlines per entry.

### Task 2: Modal partials + prompts tab buttons + backend routes (aee2ee7)

**`packages/dashboard/src/views/admin/partials/prompt-diff-body.hbs`** — shared diff body partial:
- Renders a `<pre class="prompt-diff">` with per-line `<span>` elements carrying `prompt-diff__line--add/remove/context` classes and `+`/`-`/`  ` prefix characters
- Empty diff → renders `{{t "admin.llm.prompts.noDifferences"}}` paragraph
- Uses `{{text}}` (double-brace) for Handlebars auto-escaping — XSS mitigation T-13-14

**`packages/dashboard/src/views/admin/partials/prompt-diff-modal.hbs`** — Compare with default modal:
- `modal-overlay` + `modal` structure matching all other dashboard modals
- Includes `{{> prompt-diff-body diffLines=diffLines}}`
- Close button uses `close-modal-btn` class — handled by app.js delegation

**`packages/dashboard/src/views/admin/partials/prompt-reset-modal.hbs`** — Reset confirmation modal:
- Same structure, different title and destructive button
- Body: `{{#if isOverride}}` shows warning alert + diff body; else shows "nothing to reset" message
- Footer: Cancel (`close-modal-btn`) + `hx-delete="/admin/llm/prompts/{{capability}}"` button (only shown when `isOverride`)
- `hx-target="#llm-messages"` so success toast renders in-page (existing DELETE returns HX-Redirect)

**`packages/dashboard/src/views/admin/llm.hbs`** — prompts tab updated:
- `form-actions` div now has 3 buttons: Save Override (always), Compare with default (always), Reset to Default (only when `isCustom`)
- Compare button: `hx-get="/admin/llm/prompts/{{capability}}/diff" hx-target="#modal-container"`
- Reset button: `hx-get="/admin/llm/prompts/{{capability}}/reset-confirm" hx-target="#modal-container"`
- No inline JS; no `hx-confirm` dialog

**`packages/dashboard/src/routes/admin/llm.ts`** — two new GET routes:
- `GET /admin/llm/prompts/:capability/diff` — requires `admin.system` or `llm.view`; fetches current + default, computes diff, renders `prompt-diff-modal.hbs`
- `GET /admin/llm/prompts/:capability/reset-confirm` — requires `admin.system` or `llm.manage`; same logic, renders `prompt-reset-modal.hbs`
- Both routes whitelist-validate capability against 4 valid names (T-13-21)
- Both return 400 toast for invalid capability, 503 for no LLM client, 500 for unexpected errors

**`packages/dashboard/src/server.ts`** — registered `'prompt-diff-body'` partial in the Handlebars view engine config.

**`packages/dashboard/src/i18n/locales/en.json`** — 9 new keys under `admin.llm.prompts`:
- `compareWithDefault`, `diffModalTitle`, `resetModalTitle`, `resetModalWarning`, `noDifferences`, `nothingToReset`, `close`, `confirmReset`, `cancel`

### Task 3: Integration tests (b78cfcd)

**`packages/dashboard/tests/routes/admin/llm-prompts-modals.test.ts`** — 11 new tests:
- GET /diff with override: diffLines contain 'add' for 'changed', 'remove' for 'tail', 'context' for 'intro'
- GET /diff with identical templates: all lines are 'context'
- GET /reset-confirm with override: isOverride=true, diffLines present
- GET /reset-confirm without override: isOverride=false
- 400 for invalid capability (both routes)
- 503 when LLM client null (both routes)
- Permission boundary: /diff accessible with ['llm.view'] only; /reset-confirm returns 403 with only ['llm.view']
- DELETE regression smoke: still returns HX-Redirect to /admin/llm?tab=prompts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test fixture trailing-newline assumption for diffLines()**
- **Found during:** Task 1 (TDD RED→GREEN)
- **Issue:** Initial tests used `'alpha\nbeta'` (no trailing newline) — `diffLines()` treats the last non-newline-terminated segment differently, producing combined add+remove instead of a clean single add/remove. Caused 2 test failures.
- **Fix:** Changed fixtures to always include trailing `\n` (matching real prompt template format). Adjusted test wording to match expected diff behavior.
- **Files modified:** `packages/dashboard/tests/services/prompt-diff.test.ts`
- **Commit:** 178d796

**2. [Rule 1 - Bug] Permission test used wrong permission filter for 403 assertion**
- **Found during:** Task 3 (integration test failure)
- **Issue:** Test built `viewOnlyPerms = ALL_PERMISSION_IDS.filter(p => p !== 'llm.manage')` but `requirePermission('admin.system', 'llm.manage')` checks ANY match — user still had `admin.system`, so 200 was returned instead of 403.
- **Fix:** Changed permission set to minimal `['llm.view']` so neither `admin.system` nor `llm.manage` is present.
- **Files modified:** `packages/dashboard/tests/routes/admin/llm-prompts-modals.test.ts`
- **Commit:** b78cfcd

**3. [Rule 2 - Missing] @types/diff devDependency**
- **Found during:** Task 1 TypeScript check
- **Issue:** `diff@5` ships its own types only in newer versions; the installed version caused `error TS7016: Could not find a declaration file for module 'diff'`.
- **Fix:** Added `@types/diff` as devDependency alongside `diff`.
- **Files modified:** `packages/dashboard/package.json`, `package-lock.json`
- **Commit:** 178d796

## Known Stubs

None — all routes are fully wired. Both modal routes render real diff data from the LLM client. The reset modal's destructive button calls the existing DELETE endpoint which already works end-to-end.

## Threat Flags

No new threat surface beyond what was enumerated in the plan's threat model (T-13-14 through T-13-21, all mitigated as documented).

Key mitigations verified:
- T-13-14 (XSS): `{{text}}` double-brace in prompt-diff-body.hbs confirmed — no `{{{triple-brace}}}` used
- T-13-15 (inline JS): No `onclick` in any partial — close uses `close-modal-btn` class
- T-13-16 (CSRF): hx-delete in reset modal covered by meta-tag HTMX interceptor in main layout
- T-13-17/18 (permission): llm.view on /diff, llm.manage on /reset-confirm — permission test confirms enforcement
- T-13-21 (tampering): VALID_CAPABILITIES whitelist check on both routes

## Self-Check: PASSED

- All 6 new key files present on disk
- All 3 task commits exist: 178d796, aee2ee7, b78cfcd
- 21 new tests pass (10 unit + 11 integration)
- 45 total LLM-related tests pass (no regressions in waves 1-2)
- `npx tsc --noEmit` clean
- Pre-existing branding integration test failures (6 files, 15 tests) are out-of-scope and existed at the base commit
