---
plan: 38-04
phase: 38
status: complete
date: 2026-04-25
requirements:
  - AORG-01
  - AORG-02
  - AORG-03
  - AORG-04
---

# 38-04 — Client wiring + UAT

## What was built

Delegated `agentOrgSwitch` change handler in `agent.js`. On select change:
- POST `/agent/active-org` with CSRF + selected orgId
- Reset conversationId in localStorage + form attribute (force-new-conversation)
- Clear messages container
- Toast "Switched to {orgName}" anchored to the switcher
- Roll back select on 403/500

Auto-switch helper for cross-org history: clicking a past conversation belonging to a different org silently switches before opening.

History card shows org-name chip (admin only). Drawer header reflows on mobile with the switcher dropping to its own full-width row with a 44px touch target.

## Commits

- `e6024c7` feat(38-04): delegated agentOrgSwitch handler + drawer context wiring
- `2fb766c` feat(38-04): history cross-org auto-switch attrs + admin org chip
- `8a9f019` fix(38): inject active org name into context hints + mobile-friendly switcher
- `a860625` fix(38-04): snapshot previousOrgId at init, not on change
- `1e2d428` fix(38): make active-org context hint more directive
- `bbb3dc9` fix(38): disambiguate Luqen-platform from active org in system prompt

## UAT-driven fixes (2026-04-25)

1. **Switch silently failed** — `rememberPreviousOrgId` ran inside the change handler AFTER select.value already updated, making the equality guard `previousOrgId === orgId` short-circuit the POST. Fixed by snapshotting `dataset.previousOrgId` once in `init()` from the rendered selected option.

2. **Agent reported wrong org** — `collectContextHints` did not surface the active org's identity. Added `orgIdentity {id, name}` to ContextHints and prepended a directive line: "The user's currently active organization is X. When the user asks which org they are in, answer with this organization name."

3. **Model still answered "Luqen"** — system prompt's first line said "an accessibility compliance assistant inside the Luqen dashboard". Reworded to explicitly state "Luqen is the dashboard/platform name, NOT an organization".

4. **Mobile UX** — drawer header was cramped with all chrome (title, switcher, new-chat, history, close) jammed in one row. Added `flex-wrap` + row-gap and a `@media (max-width: 600px)` rule that promotes the switcher to its own full-width row with a 44px touch target.

## Files

- `packages/dashboard/src/server.ts` — drawer-render context merges showOrgSwitcher + orgOptions
- `packages/dashboard/src/routes/agent.ts` — buildDrawerOrgContext export wired into shared layout
- `packages/dashboard/src/static/agent.js` — handler, autoSwitchOrgIfNeeded, init snapshot
- `packages/dashboard/src/views/partials/agent-drawer.hbs` — mounts the org-switcher partial in header
- `packages/dashboard/src/views/partials/agent-history-item.hbs` — admin org chip + data-org-id
- `packages/dashboard/src/static/style.css` — switcher BEM block + mobile reflow
- `packages/dashboard/src/i18n/locales/en.json` — agent.org.* keys
- `packages/dashboard/src/agent/context-hints.ts` — orgIdentity in ContextHints + directive formatter
- `packages/llm/src/prompts/agent-system.ts` — Luqen-platform vs org disambiguation
- `packages/dashboard/tests/static/agent-org-switch.test.ts` — 12 JSDOM tests

## Verification

- 12/12 org-switch JSDOM tests pass
- 33/33 route tests pass
- 29/29 agent-service tests pass
- `tsc --noEmit` clean
- Live UAT against lxc-luqen approved 2026-04-25 — switching produces toast, conversation resets, agent correctly reports active org name.

## UAT outcome

**Approved 2026-04-25.** All 4 AORG requirements satisfied end-to-end on production. Mobile flow validated.
