---
phase: 32-agent-service-chat-ui
plan: 07
subsystem: dashboard/agent-ui
tags: [confirmation-dialog, web-speech, sse-recovery, aper-02, agent-03]
requires: [32-04, 32-06]
provides:
  - native-dialog-confirmation-flow
  - db-backed-reload-recovery
  - web-speech-feature-detect
  - approve-deny-idempotency-client
affects: [packages/dashboard/src/static, packages/dashboard/src/views/partials, packages/dashboard/src/i18n]
tech-stack:
  added:
    - native-html-dialog
  patterns:
    - csp-safe-click-delegation
    - textcontent-xss-guard
    - dom-attribute-resolution-marker
    - feature-detect-hide-button
key-files:
  created:
    - packages/dashboard/src/views/partials/agent-confirm-dialog.hbs
    - packages/dashboard/src/static/agent-speech.js
    - packages/dashboard/tests/e2e/agent-confirm.test.ts
  modified:
    - packages/dashboard/src/views/partials/agent-drawer.hbs
    - packages/dashboard/src/static/agent.js
    - packages/dashboard/src/static/style.css
    - packages/dashboard/src/views/layouts/main.hbs
    - packages/dashboard/src/i18n/locales/de.json
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/i18n/locales/es.json
    - packages/dashboard/src/i18n/locales/fr.json
    - packages/dashboard/src/i18n/locales/it.json
    - packages/dashboard/src/i18n/locales/pt.json
    - packages/dashboard/tests/routes/agent.test.ts
    - packages/dashboard/tests/e2e/agent-panel.test.ts
decisions:
  - Native <dialog>.showModal() over a custom modal framework — browser gets focus-trap, backdrop, Esc for free
  - Cancel button holds autofocus so Enter is a safe default (T-32-07-08)
  - Speech wiring split into agent-speech.js — keeps agent.js under the 450-LOC UI-SPEC ceiling while exposing window.__luqenAgentSpeech.toggle as a tiny bridge
  - DOM-recovery reads tool_call_json from the server-rendered <pre> inside the pending tool bubble — no separate recovery endpoint needed; SC#4 survives reload with zero network chatter
  - data-dialog-resolution attribute distinguishes button-close from Esc-close inside the dialog's close-event trap — Esc path fires POST /agent/deny (T-32-07-07)
  - Speech-absent path hides button AND surfaces form-hint (WCAG: no dead-disabled affordances) rather than leaving the button disabled
  - Non-English locale translations stub the English copy with [XX] prefix, matching the project's existing convention for phase-local strings; polish deferred to phase-wide locale pass
metrics:
  duration: ~55m
  completed: 2026-04-19
---

# Phase 32 Plan 07: Destructive-Action Confirmation + Web Speech Wiring Summary

Native `<dialog>` destructive-confirmation flow with DB-backed reload recovery (SC#4), plus Web Speech API feature-detect — closes AI-SPEC critical failure #2 and delivers APER-02 + AGENT-03.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | agent-confirm-dialog.hbs partial + drawer mount + CSS | fa2d190 | agent-confirm-dialog.hbs, agent-drawer.hbs, style.css |
| 2 | agent.js dialog flow + agent-speech.js split | 959de8f | agent.js, agent-speech.js, main.hbs |
| 3 | /agent/confirm idempotency + 403/404 tests + 13 i18n keys × 6 locales | ada43fa | agent.test.ts, 6× locale json |
| 4 | agent-confirm E2E spec (vitest) + Plan 06 LOC regression fix | 973c54c | agent-confirm.test.ts, agent-panel.test.ts |

## Key Implementation Details

### UI-SPEC Surface 2 — Native `<dialog>`

`agent-confirm-dialog.hbs` is a verbatim-DOM implementation of UI-SPEC Surface 2:

- Cancel button carries `autofocus` — Enter on open never triggers the destructive action (T-32-07-08)
- Approve button uses `.btn--danger` plus explicit verb "Approve and run" (no ambiguous OK/Confirm)
- Raw tool arguments live in a `<details>` disclosure — zero JS for show/hide
- Zero inline handlers — `data-action` dispatched through `agent.js` click-delegation (CSP-safe)

### SSE + DOM-recovery duality

`agent.js` listens for two CustomEvents that both funnel into the same `renderPendingConfirmation()`:

- `agent:pending-confirmation` — fired from the EventSource `pending_confirmation` frame handler (Plan 04 backend)
- `agent:pending-confirmation-dom-recovery` — fired from `loadPanel()` when the server-rendered panel partial contains a tool bubble with `data-pending="true"`; the handler reconstructs `{id,name,args}` from the bubble's Handlebars `<pre aria-label="Tool call details">` — no second server round-trip

This satisfies SC#4: a user who reloads mid-confirmation re-opens the dialog from DB state within one DOM parse, with zero SSE chatter.

### Idempotency: two layers

- Client: Approve button gets `disabled` attribute on first click (removed only if the server errors, so a genuine retry is still possible)
- Server (Plan 04): the state machine refuses a replay — `pending_confirmation → sent` transitions exactly once; a second POST returns 409 `not_pending`; the dispatcher only fires on the first transition

Task 3 Test A and Task 4 Test 4 both verify the server layer — the dispatch spy must be called exactly once even across two rapid POSTs.

### Esc is a cancel, not a silent close

`wireDialogCloseTrap()` subscribes to the dialog's native `close` event. Approve and Cancel click-handlers mark `data-dialog-resolution` before calling `dialog.close()`. If the close handler fires with no resolution marker, it treats the close as Esc and POSTs `/agent/deny/:messageId` — the server row never leaks a pending state (T-32-07-07).

### Speech — tap-to-start, feature-detect, no auto-submit

`agent-speech.js` checks `SpeechRecognition || webkitSpeechRecognition` at `DOMContentLoaded`:

- Absent (Firefox): hides the button AND injects a `.form-hint` explaining. Per WCAG, a dead-disabled button is worse than no button.
- Present: removes `hidden`; click toggles recording via `aria-pressed`; `navigator.language || 'en-US'` drives `recognition.lang`; interim results populate `#agent-input` but never auto-submit (UI-SPEC Surface 1 AC #6).

Exposed via `window.__luqenAgentSpeech.toggle(btn)` so `agent.js` click-delegation dispatches without importing anything — both scripts load with `defer` and `agent-speech.js` appears first in `main.hbs`.

### File-split deviation

`agent.js` hit 494 LOC with the Plan 07 additions. UI-SPEC allows splitting into `agent-drawer.js + agent-confirm.js + agent-speech.js` when the 450 ceiling is breached. I split only speech (the most self-contained block); `agent.js` now 416 LOC, `agent-speech.js` 114 LOC. Plan 06's `tests/e2e/agent-panel.test.ts` had a LOC≤250 assertion that Plan 07 explicitly raises to 450 — updated in Task 4 and noted in the commit message as a Rule 1 regression fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan 06 E2E LOC ceiling assertion broke under Plan 07's agent.js expansion**
- Found during: Task 2 self-check
- Issue: `tests/e2e/agent-panel.test.ts` Test 3 asserted `agent.js` ≤ 250 LOC; Plan 07 adds the dialog flow and the plan explicitly bumps the ceiling to 450
- Fix: Updated the expectation to 450 with a comment pointing at the Plan 07 contract. Extracted the speech block into `agent-speech.js` to stay under 450 (416 LOC now).
- Files modified: `tests/e2e/agent-panel.test.ts`
- Commit: 973c54c

**2. [Rule 3 - Blocking] buildCtx for Plan07-F needed a user row before createConversation**
- Found during: Task 3 first vitest run
- Issue: `conversations.createConversation({userId: randomUUID(), orgId})` hit a FOREIGN KEY failure — `agent_conversations.user_id → dashboard_users.id`
- Fix: Insert a `dashboard_users` row for the foreign-org scenario before calling `createConversation`
- Files modified: `tests/routes/agent.test.ts`
- Commit: ada43fa (fixed inside Task 3 commit — same test file)

### Scope Discoveries (logged, not fixed)

None.

## i18n Coverage

13 new `agent.confirm.*` keys added to all 6 locale files. Non-English values follow the project's established `[XX] English fallback` convention — the phase-wide translation pass will replace these with native copy.

| Key | Purpose |
|-----|---------|
| `agent.confirm.title` | Dialog heading |
| `agent.confirm.intro` | Body intro, interpolates `name` |
| `agent.confirm.toolLabel` | Tool name label inside summary |
| `agent.confirm.fallbackIntro` | Used when `confirmationText` is absent |
| `agent.confirm.rawJsonLabel` | `<details>` summary (closed) |
| `agent.confirm.rawJsonLabelOpen` | `<details>` summary (open) |
| `agent.confirm.approve` | Approve button — "Approve and run" |
| `agent.confirm.cancel` | Cancel button |
| `agent.confirm.approvedStatus` | ARIA live-region post-approve |
| `agent.confirm.cancelledStatus` | ARIA live-region post-cancel |
| `agent.confirm.approveFailedTitle` | Retry card heading |
| `agent.confirm.approveFailedBody` | Retry card body |
| `agent.confirm.approveRetry` | Retry button label |

## Verification

| Check | Result |
|-------|--------|
| `grep autofocus agent-confirm-dialog.hbs` | 1 hit (Cancel button only) |
| `grep onclick agent-confirm-dialog.hbs` | 0 hits (CSP-safe) |
| `grep agent:pending-confirmation agent.js` | 4 hits |
| `grep showModal agent.js` | 2 hits |
| `grep SpeechRecognition agent-speech.js` | 2 hits (both prefixes) |
| `grep navigator.language agent-speech.js` | 2 hits |
| `grep btn--danger agent-confirm-dialog.hbs` | 1 hit (Approve only) |
| `grep -l 'agent.confirm.approve' locales/*.json \| wc -l` | 6 |
| `npx vitest run tests/routes/agent.test.ts` | 13/13 green |
| `npx vitest run tests/e2e/agent-panel.test.ts tests/e2e/agent-confirm.test.ts` | 13 green + 3 todo |
| `npx vitest run` (full suite) | 2988 pass / 8 pre-existing fail / 40 skip / 3 todo |
| `npx tsc --noEmit` | clean |
| `agent.js` LOC | 416 (≤450) |

Pre-existing failures are the Plan-30 MCP-tool-list tests unrelated to Plan 07 (4 tests files, 8 tests — same count as Plan 06 baseline).

## Threat Model Outcomes

- T-32-07-01 (double-approve): two-layer guard — client disables on click, server returns 409 + no second dispatch. Task 3 Test A + Task 4 Test 4 assert both layers.
- T-32-07-02 (XSS via dialog body): `renderPendingConfirmation` uses `textContent` for both the summary text and the JSON dump; handlebars escapes the rest. `grep innerHTML agent.js` only matches the loadPanel DOMParser path.
- T-32-07-03 (cross-org approval): Task 3 Test F asserts 404 + dispatch never fires when `findPendingMessage`'s `c.org_id = ?` clause excludes the row.
- T-32-07-07 (Esc leaks pending row): `data-dialog-resolution` marker + close-event trap forces deny when resolution absent. Task 4 Test 5 asserts the source-level wiring.
- T-32-07-08 (Enter-approve safe default): `autofocus` on Cancel, `btn--danger` on Approve. Task 4 Test 6 asserts both.

T-32-07-05 (Web Speech EU residency) and T-32-07-06 (no auto-deny TTL) remain `accept` per D-33 / D-30 — out-of-scope for MVP.

## Self-Check: PASSED

- File `packages/dashboard/src/views/partials/agent-confirm-dialog.hbs` → FOUND
- File `packages/dashboard/src/static/agent-speech.js` → FOUND
- File `packages/dashboard/tests/e2e/agent-confirm.test.ts` → FOUND
- Commit fa2d190 → FOUND
- Commit 959de8f → FOUND
- Commit ada43fa → FOUND
- Commit 973c54c → FOUND
