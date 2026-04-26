---
plan: 36-05
phase: 36
status: complete
date: 2026-04-25
requirements:
  - ATOOL-04
---

# 36-05 — Admin audit UX: rationale + outcomeDetail filter

## What was built

`/admin/audit` table extended with two phase-36 features:

- **Rationale column** (rightmost). When a row's `rationale` is non-null, render a clickable button with the first ~80 chars truncated; click expands an in-place panel with the full rationale text plus the outcome-detail value (when present). When rationale is null, render an em-dash with `aria-label='no rationale'`.
- **Outcome detail filter**. Text input with datalist (`iteration_cap`, `timeout`, `unknown_tool`, `invalid_args`) added to the filter bar. Filter persists across pagination. CSV export includes a `rationale` column.

CSP-strict (no inline handlers — delegated `data-action="toggleRationale"` listener in `agent-audit.js`). BEM block `.audit-rationale__*`, `prefers-reduced-motion` honoured. `aria-expanded` toggles correctly.

## Commits

- `2b76fbc` test(36-05): add failing tests for rationale + outcomeDetail in /admin/audit
- `5ec203f` feat(36-05): outcomeDetail filter + rationale column on /admin/audit
- `27ef789` feat(36-05): rationale toggle handler + BEM CSS
- `0ca588d` fix(36-05): hide truncated rationale preview when expanded; add caret indicator (UAT-driven)

## Files

- `packages/dashboard/src/routes/admin/agent-audit.ts` — outcomeDetail filter, rationalePreview/full enrichment, CSV column
- `packages/dashboard/src/views/admin/agent-audit.hbs` — filter bar, rationale column markup, expand panel
- `packages/dashboard/src/static/agent-audit.js` — delegated toggle handler (CSP-strict)
- `packages/dashboard/src/static/style.css` — `.audit-rationale__*` BEM block, expanded-state preview hiding, caret indicators
- `packages/dashboard/src/i18n/locales/en.json` — `admin.audit.rationaleHeader`, `rationaleExpand`, `rationaleCollapse`, `noRationale`, `outcomeDetailLabel` keys
- `packages/dashboard/tests/routes/admin-agent-audit.test.ts` — 6 tests covering filter SQL, rationale enrichment, datalist, CSV column

## Decisions / deviations

1. **Caret indicators (▸/▾)** added during UAT — original implementation showed both the truncated preview and full panel simultaneously when expanded (visual duplication). Now the truncated `<span>` is hidden via `[aria-expanded="true"] .audit-rationale__preview { display: none }` and a CSS-pseudo caret prefix indicates state.
2. **Provider-dependent rationale capture** — On Ollama (the user's local provider), `extractRationale(turn)` returns empty string for every dispatched call because Ollama goes straight to tool_calls without emitting pre-tool text. UI verified via injected synthetic rationale row. Real rationale population requires a provider that emits pre-tool text or thinking blocks (Anthropic with thinking_steps, OpenAI when content + tool_calls coexist).

## Verification

- `npx vitest run tests/routes/admin-agent-audit.test.ts` → 6/6 pass
- `npx tsc --noEmit` → clean
- Live browser UAT approved 2026-04-25 — rationale expands cleanly, caret indicates state, outcomeDetail filter renders.

## UAT outcome

**Approved 2026-04-25.** All 9 checkpoint items observed working except those gated by provider rationale availability (covered by injected test row).
