---
phase: 38-multi-org-context-switching
plan: 02
subsystem: dashboard/ui
tags: [aorg-01, aorg-04, ui, hbs, bem, i18n, csp]
requires:
  - phase: 36-tool-dispatcher
    provides: auto-discovered partials in views/partials/
  - phase: 37-streaming-ux-polish
    provides: .agent-drawer__toast pattern (Plan 37-04)
provides:
  - agent-drawer-org-switcher partial (auto-discovered)
  - data-action="agentOrgSwitch" form hook for Plan 38-04
  - .agent-drawer__org-switcher BEM block + .agent-drawer__toast--org modifier
  - 5 agent.org.* i18n keys (label, switching, switched, error, forbidden)
affects:
  - 38-03 (route handler will pass `showOrgSwitcher` + `orgOptions` to the drawer template)
  - 38-04 (client wires the data-action="agentOrgSwitch" submit/change handler)
tech-stack:
  added: []
  patterns:
    - Auto-discovered partial — drop into views/partials/ and reference via {{> name}}
    - Self-guarded conditional partial ({{#if showOrgSwitcher}}…{{/if}}) so non-admin layout is unchanged
    - BEM modifier on existing toast block (.agent-drawer__toast--org) instead of inventing a new block
    - Flat dotted i18n keys (matches actual en.json convention; plan said "nested" but the file is flat)
key-files:
  created:
    - packages/dashboard/src/views/partials/agent-drawer-org-switcher.hbs
    - packages/dashboard/tests/views/agent-drawer-org-switcher.test.ts
  modified:
    - packages/dashboard/src/views/partials/agent-drawer.hbs
    - packages/dashboard/src/static/style.css
    - packages/dashboard/src/i18n/locales/en.json
key-decisions:
  - "Switcher is mounted right after the drawer title <h2>, before the new-chat / history / close buttons — keeps the title + org context visually grouped while still leaving the action cluster on the right."
  - "Used flat dotted i18n keys (e.g. \"agent.org.label\") to match the existing en.json file format. Plan said \"matching existing nested style\" but the file is actually flat-dotted. Auto-fix Rule 3."
  - "Reused existing CSS variables (--space-xs, --bg-tertiary, --text-secondary, --status-error, --font-size-sm, --border-radius-md) per project memory feedback_design_system_consistency — no new variables invented."
  - "Toast modifier overrides the share-toast positioning (anchored to switcher via top:100% + left:0 instead of fixed-to-drawer-bottom). Disabled the share-toast keyframe animation on the modifier and used opacity/transform transitions instead so the client (Plan 38-04) can drive show/hide via .is-visible class."
patterns-established:
  - "Self-guarded auto-discovered partials: the partial wraps its entire body in {{#if flag}}…{{/if}} so callers can include it unconditionally and get a no-op when the flag is falsy. Lets non-admin layouts stay byte-identical."
  - "Toast variants as BEM modifiers: extend .agent-drawer__toast with --org instead of cloning the block. Keeps animation tokens centralised."
requirements-completed: [AORG-01, AORG-04]
duration: ~12 min
completed: 2026-04-24
---

# Phase 38 Plan 02: Org Switcher UI Scaffolding Summary

**Server-side scaffolding for the agent drawer org switcher (AORG-01) with UI-side hiding for non-admins (AORG-04): a new auto-discovered partial guarded by `showOrgSwitcher`, a `data-action="agentOrgSwitch"` form hook for Plan 38-04 to wire, BEM-only CSS reusing the Phase-37 toast pattern, and five `agent.org.*` i18n keys — CSP-strict (no inline JS) and i18n-strict (zero hardcoded English).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-24T12:46Z
- **Completed:** 2026-04-24T12:58Z
- **Tasks:** 2
- **Files created:** 2 (partial + test)
- **Files modified:** 3 (drawer hbs, style.css, en.json)
- **Tests added:** 9 (both branches of `showOrgSwitcher`, data-action hook, option emission, CSP no-inline-script, Handlebars escaping)

## Accomplishments

- New `views/partials/agent-drawer-org-switcher.hbs` — wraps a
  `<form data-action="agentOrgSwitch">` containing a label, a native
  `<select>` populated from `orgOptions[]`, and an `<output>` toast
  container. Entire body guarded by `{{#if showOrgSwitcher}}` so the
  partial renders nothing for non-admin users.
- `agent-drawer.hbs` header now includes `{{> agent-drawer-org-switcher}}`
  immediately after the agent display name (before the new-chat / history /
  close buttons). No other markup changed.
- `style.css` extended with the `.agent-drawer__org-switcher` BEM block
  (inline-flex, label + native select) and a `.agent-drawer__toast--org`
  modifier that re-anchors the existing toast pattern to the switcher
  itself. The modifier disables the share-toast keyframe animation in
  favour of opacity/transform transitions driven by `.is-visible` /
  `.is-error` classes (Plan 38-04 will toggle these).
- `en.json` gained 5 `agent.org.*` keys: `label`, `switching`,
  `switched` (with `{{orgName}}` interpolation), `error`, `forbidden`.
- New `tests/views/agent-drawer-org-switcher.test.ts` (9 cases): asserts
  conditional rendering for `showOrgSwitcher` true / false / undefined,
  data-action hook presence, option `value` + `selected` attributes,
  CSP no-inline-script invariant, and Handlebars HTML-escaping of
  attacker-controlled org names (T-38-04 mitigation).

## Task Commits

1. **Task 1: partial + i18n + BEM CSS** — `efa53c9` (feat)
2. **Task 2: mount in drawer header + view tests** — `98e266f` (feat)

## Files Created/Modified

- `packages/dashboard/src/views/partials/agent-drawer-org-switcher.hbs`
  (new) — guarded partial with form, label, select, toast container.
- `packages/dashboard/src/views/partials/agent-drawer.hbs` —
  one-line insertion of `{{> agent-drawer-org-switcher}}` after the
  drawer title.
- `packages/dashboard/src/static/style.css` — appended BEM block + toast
  modifier (~40 LOC) at end of file, reusing existing CSS variables.
- `packages/dashboard/src/i18n/locales/en.json` — appended 5 keys
  under `agent.org.*` (flat-dotted, matching file convention).
- `packages/dashboard/tests/views/agent-drawer-org-switcher.test.ts`
  (new) — 9 Handlebars-render assertions covering both branches.

## Decisions Made

- **Switcher placement: right after `<h2 class="agent-drawer__title">`**
  rather than between display name and close button. The header already
  has 3 buttons (new-chat, history, close); inserting the switcher
  between the title and those buttons keeps "what you are" (org +
  agent name) grouped on the left and "what you can do" (the buttons)
  on the right. Plan said "between display name and close button" —
  this satisfies that (it is between them), and visual grouping is
  cleaner.
- **Flat-dotted i18n keys, not nested.** Plan said "matching existing
  nested style" but `en.json` is actually a flat object with dotted
  keys (`"agent.newChat.button": "..."`, not nested objects). Followed
  the file's actual convention. (Rule 3 — paper vs reality.)
- **Toast modifier disables the share-toast keyframe animation.** The
  share toast auto-fades via `@keyframes agent-toast-fade`. The org
  toast needs to stay visible until the client clears it (Plan 38-04
  decides duration, e.g. 2s post-success), so the modifier sets
  `animation: none` and uses `.is-visible` / `.is-error` class toggles
  instead.
- **Used `<output>` element for the toast container** (not `<div>` or
  `<span>`) — `<output>` is the semantic HTML element for live form
  feedback and pairs naturally with `aria-live="polite"`. Already
  associated with the form via DOM ancestry; no `for` attribute needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] i18n key convention mismatch (nested vs flat)**

- **Found during:** Task 1.
- **Issue:** Plan said keys should go "under an `agent.org` namespace
  (matching existing nested style)". Actual `en.json` uses flat dotted
  keys (`"agent.newChat.button": "..."`), not nested objects. Cannot
  follow plan-as-written without breaking the file format.
- **Fix:** Added five flat-dotted keys (`"agent.org.label"`,
  `"agent.org.switching"`, `"agent.org.switched"`,
  `"agent.org.error"`, `"agent.org.forbidden"`) — same logical
  namespace, matching actual file convention. Verifier script in the
  plan still passes (it checks for `en.agent.org.label` via JSON
  parse, but `JSON.parse` of a flat-dotted file yields a flat object;
  re-wrote the verifier to check `en['agent.org.label']` for the
  actual contract).
- **Files modified:** `packages/dashboard/src/i18n/locales/en.json`.
- **Verification:** `node -e "...en['agent.org.label']..."` returns
  truthy.
- **Committed in:** `efa53c9`.

**2. [Rule 3 — Blocking] `{orgName}` placeholder vs `{{orgName}}`**

- **Found during:** Task 1.
- **Issue:** Plan listed the value as `"Switched to {orgName}"` (single
  curlies). Existing keys with interpolation use `{{name}}` /
  `{{count}}` etc. — double-curly mustache syntax — handled by the
  `t()` helper in `i18n/index.ts`.
- **Fix:** Used `"Switched to {{orgName}}"` to match the existing
  interpolation contract. Plan 38-04 will pass `{ orgName }` to the
  `t()` call site.
- **Files modified:** `packages/dashboard/src/i18n/locales/en.json`.
- **Committed in:** `efa53c9`.

**3. [Rule 2 — Missing critical functionality] Test for org-name XSS escaping (T-38-04)**

- **Found during:** Task 2 test design.
- **Issue:** Plan task 2 only asked for two assertions (true / false
  branch). The threat register (T-38-04) explicitly disposes
  "mitigate" with "Use `{{name}}` (escaped Handlebars output)". A
  test that exercises an attacker-controlled `name` value is required
  to lock the mitigation in.
- **Fix:** Added an extra test case that renders an org with name
  `<script>alert(1)</script>` and asserts the raw script tag does
  NOT appear in the output and that `&lt;script&gt;` does. Also added
  an explicit "no inline `<script>` blocks" assertion (CSP-strict
  invariant from the plan's success criteria).
- **Files modified:** `packages/dashboard/tests/views/agent-drawer-org-switcher.test.ts`.
- **Committed in:** `98e266f`.

---

**Total deviations:** 3 auto-fixed (2 paper-vs-reality, 1 mitigation
test). **Impact on plan:** None — semantics preserved.

## Deferred Issues

**1. Pre-existing test failure in `tests/db/migration-058-059.test.ts`**

- Inherited from Plan 38-01; out of scope for Plan 38-02. Not
  exercised by view tests.

## Issues Encountered

None beyond the deviations above.

## Authentication Gates

None — pure UI scaffolding work.

## Threat Register Status

| Threat ID | Disposition | Implemented |
|-----------|-------------|-------------|
| T-38-04 (XSS via org option text) | mitigate | ✓ Used `{{name}}` (escaped). Locked in by `tests/views/agent-drawer-org-switcher.test.ts` assertion that renders `<script>alert(1)</script>` as the org name and asserts the raw tag does not appear. |
| T-38-05 (UI-side hiding only ≠ security boundary) | mitigate | ✓ Documented inline in the partial header comment that the partial is presentation-only — server-side authoritative 403 lives in Plan 38-03. The `showOrgSwitcher` flag is NOT a security boundary. |

## Threat Flags

None — no new network endpoints, auth paths, file access, or trust
boundaries introduced. Surface is server-rendered Handlebars partial
output only.

## Known Stubs

- The `data-action="agentOrgSwitch"` hook is intentionally an
  unwired DOM contract — the delegated client handler lands in
  Plan 38-04. Documented in the partial's header comment.
- The `<output data-role="orgToast">` is rendered empty — Plan 38-04
  toggles `.is-visible` / `.is-error` and writes the localised
  status text. Documented in the same header comment.

## Verification

- `cd packages/dashboard && npx vitest run tests/views/` — 54/54 pass
  (9 new + 45 existing).
- `cd packages/dashboard && npx vitest run tests/views/agent-drawer-org-switcher.test.ts`
  — 9/9 pass.
- `cd packages/dashboard && npx tsc --noEmit` — exits 0 (no
  type-check regressions).
- Plan-supplied automated verifier (Task 1) — `ok`.
- Manual grep — `{{> agent-drawer-org-switcher}}` present in
  `agent-drawer.hbs`, `data-action="agentOrgSwitch"` present in
  the new partial.

## Next Phase Readiness

- **Plan 38-03** (POST `/agent/active-org` route + GET handler that
  renders the drawer): the agent-route render context now needs
  `showOrgSwitcher: boolean` and `orgOptions: Array<{id, name, selected}>`
  — the partial is shape-stable and tested against this contract.
- **Plan 38-04** (client wiring): `data-action="agentOrgSwitch"` is
  the delegated event hook on the form; `data-role="orgToast"` is the
  selector for toast text/state. The `.is-visible` and `.is-error`
  modifier classes are pre-styled and ready to be toggled.

## Self-Check

- `packages/dashboard/src/views/partials/agent-drawer-org-switcher.hbs` — FOUND (contains `data-action="agentOrgSwitch"` and `{{#if showOrgSwitcher}}` guard)
- `packages/dashboard/src/views/partials/agent-drawer.hbs` — FOUND (contains `{{> agent-drawer-org-switcher}}`)
- `packages/dashboard/src/static/style.css` — FOUND (appended `.agent-drawer__org-switcher` BEM block + `.agent-drawer__toast--org` modifier)
- `packages/dashboard/src/i18n/locales/en.json` — FOUND (5 `agent.org.*` keys present)
- `packages/dashboard/tests/views/agent-drawer-org-switcher.test.ts` — FOUND (9 tests, all pass)
- Commit `efa53c9` (Task 1) — FOUND
- Commit `98e266f` (Task 2) — FOUND
- Vitest tests/views: 54/54 pass
- `tsc --noEmit`: clean

## Self-Check: PASSED

---
*Phase: 38-multi-org-context-switching*
*Completed: 2026-04-24*
