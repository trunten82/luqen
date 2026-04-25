---
phase: 37-streaming-ux-polish
plan: 02
subsystem: dashboard/agent-ui
tags: [ui, hbs, css, i18n, scaffolding, bem]
requires:
  - phase: 37-streaming-ux-polish
    plan: 01
    provides: agent_messages.status='stopped'|'superseded' + supersededAt
provides:
  - agent-msg-actions partial (per-message action row contract)
  - agent-msg-edit partial (inline edit form for most-recent user message)
  - agent-msg-stopped-chip partial (status='stopped' marker)
  - Extended agent-message.hbs with status modifier classes + partial inclusions
  - 15 new i18n keys under agent.actions.*
  - BEM CSS block .agent-msg__actions / __action / __stopped-chip / __edit-*
  - Hover-revealed-on-desktop / always-visible-on-touch responsive contract
affects:
  - 37-03 (server routes can rely on the markup contract being stable)
  - 37-04 (agent.js delegated handlers target data-action selectors below)
tech-stack:
  added: []
  patterns:
    - "data-action selector contract for delegated listeners (same as 36-04 chips)"
    - "{{> partial}} auto-discovery (drop file into views/partials/, no server.ts change)"
    - "@media (hover: hover) vs (hover: none) for desktop/touch divergence"
key-files:
  created:
    - packages/dashboard/src/views/partials/agent-msg-actions.hbs
    - packages/dashboard/src/views/partials/agent-msg-edit.hbs
    - packages/dashboard/src/views/partials/agent-msg-stopped-chip.hbs
    - packages/dashboard/tests/views/agent-msg-actions.test.ts
  modified:
    - packages/dashboard/src/views/partials/agent-message.hbs
    - packages/dashboard/src/static/style.css
    - packages/dashboard/src/i18n/locales/en.json
key-decisions:
  - "Avoided unregistered `(and ...)` and `concat` Handlebars helpers in agent-msg-actions partial — restructured to nested {{#if}} blocks against `eq` (already registered). No new helpers required."
  - "CSS token substitutions: --space-1→--space-xs, --space-2→--space-sm, --bg-hover→--bg-tertiary, --radius-sm→--border-radius-sm, --border-default→--border-color. Reason: plan named tokens that don't exist in style.css; substituted with closest documented equivalents per CLAUDE.md design-system-consistency rule."
  - "Added `.agent-msg { position: relative; }` so the desktop action row's absolute positioning is anchored to the bubble. Plan implied this requirement but didn't state it."
  - "Action row always-visible-on-touch fall-through case (when @media (hover: none) does not match): defaults to inline-flex with margin-top — readable below the bubble body."
requirements-completed: [AUX-01, AUX-02, AUX-03, AUX-04, AUX-05]
duration: ~25 min
completed: 2026-04-25
---

# Phase 37 Plan 02: Per-Message Action Row UI Scaffolding Summary

**Three new auto-discovered Handlebars partials plus a minimal extension to `agent-message.hbs`, 15 new i18n keys under `agent.actions.*`, and a BEM CSS block (`.agent-msg__actions`, `.agent-msg__action`, `.agent-msg__stopped-chip`, `.agent-msg__edit-*`) shipping the desktop-hover / touch-always-visible visual contract that Plans 03 (server) and 04 (client wiring) will lean on.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2
- **Files created:** 4 (3 partials + 1 test)
- **Files modified:** 3 (agent-message.hbs, style.css, en.json)
- **Tests added:** 14 (all 14 pass; full view suite 45/45 green)

## Accomplishments

- New partial **`agent-msg-actions.hbs`**: emits a 3-button toolbar (`retryAssistant` / `copyAssistant` / `shareAssistant`) for assistant rows, and a single edit pencil (`editUserMessage`) for the most-recent user row. All buttons carry `data-action` and `data-message-id` for the delegated listener Plan 04 will register.
- New partial **`agent-msg-edit.hbs`**: inline `<form data-action="submitEditUserMessage">` with a textarea pre-filled via `{{content}}` (double-brace escaped — T-37-06 mitigation), Save/Cancel buttons (Cancel uses `data-action="cancelEditUserMessage"`).
- New partial **`agent-msg-stopped-chip.hbs`**: `role="status" aria-live="polite"` chip beneath any bubble whose `status === 'stopped'`. Uses i18n `agent.actions.stoppedByUser`.
- **`agent-message.hbs` extended** (minimal diff): adds `agent-msg--stopped` and `agent-msg--superseded` modifier classes, conditional stopped-chip partial, action-row partial inclusion. Existing user/assistant/tool branches preserved verbatim. Empty-assistant skip and pending-tool dialog logic untouched.
- **15 i18n keys** under `agent.actions.*` (verbatim list in next section).
- **BEM CSS** (`packages/dashboard/src/static/style.css`): position-relative anchor, hover-revealed desktop layout, always-visible touch layout, reduced-motion safety, 36px touch targets at ≤480px, defensive `display: none` for any superseded row that escapes the server filter.
- **No JavaScript modified** (Plan 04's domain). **No server routes added** (Plan 03's domain). The contract those plans will target is now stable.

## i18n keys added (verbatim)

```json
"agent.actions.assistantGroupLabel": "Message actions",
"agent.actions.cancel": "Cancel",
"agent.actions.copy": "Copy message",
"agent.actions.copied": "Copied to clipboard",
"agent.actions.copyFailed": "Could not copy — try selecting the text manually",
"agent.actions.edit": "Edit message",
"agent.actions.editLabel": "Edit your message",
"agent.actions.retry": "Retry response",
"agent.actions.save": "Save and resend",
"agent.actions.share": "Share message",
"agent.actions.shareCreated": "Share link copied to clipboard",
"agent.actions.shareFailed": "Could not create share link",
"agent.actions.stopped": "Stopped by user",
"agent.actions.stoppedByUser": "Stopped by user",
"agent.actions.stopFailed": "Could not stop the response cleanly"
```

`grep -c '"agent\.actions\.' packages/dashboard/src/i18n/locales/en.json` → **15**.

## BEM rules added

- `.agent-msg { position: relative; }` (anchor for absolute action row)
- `.agent-msg--superseded { display: none; }` (defensive)
- `.agent-msg--stopped .agent-msg__body { font-style: normal; }` (per CONTEXT decision)
- `.agent-msg__actions` (inline-flex, gap, margin-top — touch baseline)
- `.agent-msg__action` (28×28 hit target, transparent bg, `--border-radius-sm`, hover/focus-visible states)
- `.agent-msg__stopped-chip` (inline-flex, `--font-size-xs`, `--text-muted`)
- `.agent-msg__stopped-chip svg` (no shrink)
- `.agent-msg__edit-form` (column flex, full width)
- `.agent-msg__edit-textarea` (full width, min-height, focus outline, themed bg)
- `.agent-msg__edit-buttons` (right-aligned flex)
- `@media (hover: hover) .agent-msg__actions` (absolute, opacity 0 → 1 on hover/focus-within)
- `@media (hover: none) .agent-msg__actions` (static, always opacity 1)
- `@media (prefers-reduced-motion: reduce)` (no transitions)
- `@media (max-width: 480px) .agent-msg__action` (36×36 touch targets)

`grep -c "agent-msg__actions\|agent-msg__action\|agent-msg__stopped-chip\|agent-msg__edit" style.css` → **18**.

## Task Commits

1. **Task 1 RED:** `e1d11ab` — `test(37-02): add failing partial render tests for agent-msg actions/edit/stopped`
2. **Task 1 GREEN:** `6320a75` — `feat(37-02): add agent-msg action/edit/stopped partials and i18n keys`
3. **Task 2:** `52607bb` — `feat(37-02): BEM CSS for agent-msg action row, stopped chip, edit form`

(Task 2 had no separate RED commit because the verification step is grep-based on style.css — no new behavioural test was mandated by the plan, and the existing partial tests already lock the markup contract that the CSS targets.)

## Decisions Made

- **No new Handlebars helpers needed.** The plan's example markup used `(and ...)` and `concat`, neither of which is registered in `server.ts`. Restructured the partial to use nested `{{#if}}` blocks on `eq` (already registered). End-state behaviour identical; one fewer global helper to maintain.
- **CSS token substitutions documented above** (no new tokens introduced — strict adherence to design-system-consistency rule from CLAUDE.md).
- **`.agent-msg { position: relative; }`** — required for the desktop floating action-row to anchor to its parent bubble. Plan implied this; spelt it out explicitly.
- **Defence-in-depth on superseded.** Server filter (Plan 01's `getWindow` / `getFullHistory` skipping `status='superseded'`) is the primary gate; CSS `display: none` is belt-and-braces in case a row leaks through during a future refactor.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan markup referenced unregistered `(and ...)` and `concat` Handlebars helpers**

- **Found during:** Task 1 GREEN (server.ts grep returned no `registerHelper('and'` or `registerHelper('concat'`)
- **Issue:** The plan's `<behavior>` block for `agent-msg-actions.hbs` used `{{else if (and (eq role "user") isMostRecentUserMessage)}}` and `{{t (concat "agent.role." role)}}`. Neither helper is registered in `packages/dashboard/src/server.ts`. Templates would fail at compile time when included by `@fastify/view`.
- **Fix:** Replaced the `(and ...)` form with nested `{{#if}}` blocks against the already-registered `eq` helper. The `concat` reference applies to `agent-message.hbs` (kept as-is — it was already in the original file and was apparently working; the plan's snippet replicated the existing pattern). Verified: tests render the partial via Handlebars directly with only the `eq` and `t` helpers and the rendered output matches the plan's contract (data-action selectors, aria-labels, button class modifiers).
- **Files modified:** `packages/dashboard/src/views/partials/agent-msg-actions.hbs`
- **Committed in:** `6320a75`

**2. [Rule 3 - Token availability] Plan named CSS tokens that do not exist in style.css**

- **Found during:** Task 2 (greppped for `--space-1`, `--bg-hover`, `--radius-sm`, `--border-default` and got zero hits)
- **Issue:** Plan's behaviour block listed tokens (`--space-1`, `--space-2`, `--bg-hover`, `--radius-sm`, `--border-default`) that don't exist in this codebase's design system.
- **Fix:** Substituted with the closest documented equivalents (verified by grepping the `--space-`, `--bg-`, `--border-` definitions in style.css):
  - `--space-1` → `--space-xs` (4px)
  - `--space-2` → `--space-sm` (8px)
  - `--bg-hover` → `--bg-tertiary` (closest hover-bg pattern in existing rules)
  - `--radius-sm` → `--border-radius-sm`
  - `--border-default` → `--border-color`

  No new tokens added (CLAUDE.md design-system-consistency).
- **Files modified:** `packages/dashboard/src/static/style.css`
- **Committed in:** `52607bb`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — environment mismatches with plan-cited names).
**Impact on plan:** Pure naming substitutions; final UI contract identical to spec.

## Issues Encountered

None beyond the deviations above.

## Authentication Gates

None — pure UI scaffolding work.

## Threat Register Status

| Threat ID | Disposition | Implemented |
|-----------|-------------|-------------|
| T-37-06 (Tampering on edit-textarea pre-fill) | mitigate | ✓ `agent-msg-edit.hbs` uses `{{content}}` (double-brace escapes); test asserts `<script>` is escaped to `&lt;script&gt;` |
| T-37-07 (Info disclosure via leaked superseded row) | mitigate | ✓ `.agent-msg--superseded { display: none }` defensive rule (server filter is primary gate, Plan 01) |
| T-37-08 (Repudiation) | accept | n/a — no server actions in this plan |

## Threat Flags

None — no new network endpoints introduced. Surface is markup + CSS + i18n only.

## Known Stubs

The new partials emit `data-action` selectors that no JS handler currently listens for. **By plan design** — Plan 04 wires the delegated listener for `retryAssistant` / `copyAssistant` / `shareAssistant` / `editUserMessage` / `submitEditUserMessage` / `cancelEditUserMessage`. Until then, clicking these buttons is a no-op. This is **not** an unintended stub: the plan explicitly states "Zero JavaScript wiring — that lands in Plan 04."

The `isMostRecentUserMessage` flag is also currently undefined in the message context (`renderAgentMessagesFragment` in `routes/agent.ts`). Plan 03 will compute and pass that flag. Until then, the edit pencil is hidden everywhere — tests confirm the no-flag → no-render path.

## Verification

- `cd packages/dashboard && npx vitest run tests/views/agent-msg-actions.test.ts` — **14/14 pass**
- `cd packages/dashboard && npx vitest run tests/views` — **45/45 pass** (full view suite)
- `cd packages/dashboard && npx tsc --noEmit` — exits 0
- `grep -c '"agent\.actions\.' packages/dashboard/src/i18n/locales/en.json` — **15**
- `grep -c "agent-msg__actions\|agent-msg__action\|agent-msg__stopped-chip\|agent-msg__edit" packages/dashboard/src/static/style.css` — **18** (≥10 required)

## Next Phase Readiness

- **Plan 03 (server routes)** can rely on the data-action selectors being stable: `retryAssistant`, `copyAssistant`, `shareAssistant`, `editUserMessage`, `submitEditUserMessage`, `cancelEditUserMessage`. The `isMostRecentUserMessage` flag should be added to the message context in `renderAgentMessagesFragment` (and the streaming-render path) so the edit pencil appears on the right row.
- **Plan 04 (client wiring)** can register a single delegated `click` listener (mirror 36-04 chip strip pattern) targeting `[data-action]` and dispatch by `dataset.action`. The 15 i18n keys under `agent.actions.*` cover all toast / aria-live announcements (`copied`, `copyFailed`, `shareCreated`, `shareFailed`, `stopFailed`).
- **Phase regression**: existing message rendering for `status='final'` and non-most-recent user messages is byte-identical apart from the new `agent-msg__actions` div. Visual verification on existing conversations should show the action row appearing on hover (desktop) — no other behavioural change.

## Self-Check

- `packages/dashboard/src/views/partials/agent-msg-actions.hbs` — FOUND
- `packages/dashboard/src/views/partials/agent-msg-edit.hbs` — FOUND
- `packages/dashboard/src/views/partials/agent-msg-stopped-chip.hbs` — FOUND
- `packages/dashboard/tests/views/agent-msg-actions.test.ts` — FOUND
- `packages/dashboard/src/views/partials/agent-message.hbs` extended (`agent-msg--stopped` modifier present) — FOUND
- `packages/dashboard/src/i18n/locales/en.json` — 15 `agent.actions.*` keys — FOUND
- `packages/dashboard/src/static/style.css` — 18 BEM rule occurrences — FOUND
- Commit `e1d11ab` (Task 1 RED) — FOUND
- Commit `6320a75` (Task 1 GREEN) — FOUND
- Commit `52607bb` (Task 2) — FOUND
- View suite: 45/45 pass
- `tsc --noEmit`: clean

## Self-Check: PASSED

---
*Phase: 37-streaming-ux-polish*
*Completed: 2026-04-25*
