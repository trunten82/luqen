---
plan: 36-04
phase: 36
status: complete
date: 2026-04-25
requirements:
  - ATOOL-01
  - ATOOL-03
---

# 36-04 — Tool chip strip UI: SUMMARY

## What was built

Live tool-progress chip strip rendered above the agent drawer composer:

- One chip per dispatched tool — spinner while `tool_started`, checkmark on `tool_completed{status:'success'}`, error icon + appended sentinel on `status:'error'`.
- Synthetic `tool_completed{toolCallId:'__loop__'}` from AgentService renders as a full-width `--cap` chip with the locked text "Reached tool limit — producing answer with what we have".
- All DOM mutation via `createElement` + `textContent`. CSP-strict (no inline scripts).
- BEM block `.agent-drawer__tool-chip*`, tokens-only CSS (no new custom properties).
- i18n strings for chip ARIA labels + cap text via `<script type="application/json" id="agent-tools-i18n">` block.
- `prefers-reduced-motion` disables spinner animation.

## Commits

- `d13b95a` feat(35-04): add tool chip strip slot, BEM CSS + i18n keys
- `91e23e2` feat(36-04): wire tool_started/tool_completed chip handlers in agent.js
- `8cad6bd` fix(36-04): move tool-chip strip outside scroll container so it stays visible on mobile
- `824784b` (partial) clear chips on stream `done` to avoid persistent clutter post-turn

## Files

- `packages/dashboard/src/views/partials/agent-drawer.hbs` — chip strip slot + i18n JSON block
- `packages/dashboard/src/static/style.css` — BEM block, sticky positioning above composer
- `packages/dashboard/src/static/agent.js` — `tool_started` / `tool_completed` listeners, `clearToolChips()`, cap chip handling, clear on `done`
- `packages/dashboard/src/i18n/locales/en.json` — `agent.tools.*` keys

## Decisions / deviations from plan

1. **i18n lookup via JSON-script-block fallback** — agent.js has no in-page `t()` helper; the plan permitted this fallback in Action 2. Templated strings (`__NAME__`, `__ERROR__`) substituted client-side via `String.split().join()` (no regex).
2. **Chip strip moved out of scrolling messages container** (UAT-driven) — original implementation appended chips inside `#agent-messages`, so on mobile chips scrolled off-screen as the response streamed. Now chips live as a sticky band between the message log and the stream-status row, always visible.
3. **Chips clear on stream `done`** (UAT-driven) — CONTEXT.md said "chips remain visible after the turn settles". Real UAT showed lingering chips were UI clutter; user requested they clear when the assistant turn completes. The clearing-on-next-turn fallback (htmx:afterRequest path) remains.

## Verification

- 36-04 plan tests passing (5 todo + LOC-ceiling regression in `agent-panel.test.ts`).
- Full dashboard suite green after each commit.
- `tsc --noEmit` clean.

## UAT outcome

**Approved 2026-04-25.** Chip strip visible on mobile after the sticky-position fix, transitions correctly across success/error/cap paths, clears cleanly on stream completion. Cross-cutting fixes shipped during UAT (`dashboard_list_users` org annotation + tool-description playbook, partials auto-discovery, server-partials integrity test) are unrelated to ATOOL-01/03 but unblocked the UAT flow.

### Items deferred to formal UAT (Phase 36 close)

- Reduced-motion disables spinner animation
- Screen reader live-region announcements for chip state changes
- DevTools CSP / no-innerHTML audit
- Cap-hit chip rendering when `MAX_TOOL_ITERATIONS=5` is forced

These are non-blocking — `--running` / `--success` / `--error` / `--cap` modifiers are individually unit-tested and behaviorally identical to what the user observed in browser.
