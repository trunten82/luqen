---
phase: 35
plan: 04
subsystem: agent-history-static-ui
tags: [agent, history, ui, css, i18n, handlebars, a11y, bem]
requires:
  - 35-03 /agent/conversations* HTTP surface (will be consumed by Plan 05 JS hydration)
  - Existing agent-drawer.hbs shell (Phase 32 Plan 06)
  - Existing style.css design tokens (--space-*, --font-size-*, --leading-*, --accent-light, --status-error*, --focus-outline)
  - Existing agent.* i18n namespace in en.json
provides:
  - agent-history-panel.hbs partial (stacked region, search, list, sentinel, skeleton, error, empty)
  - agent-history-item.hbs partial (list row template with 3-dot menu)
  - History open button in agent-drawer.hbs header
  - .agent-drawer__history* BEM block (~45 selector hits) in style.css
  - 30 i18n keys under agent.history.* (verbatim UI-SPEC copy)
affects:
  - Plan 05 (JS hydration): static DOM + data-action hooks now exist for fetch + IntersectionObserver wiring
tech-stack:
  added: []
  patterns:
    - CSP-strict data-action attributes (no inline handlers)
    - BEM prefix agent-drawer__history* scoped to drawer
    - ARIA roving-focus on list rows (tabindex=-1, role=button)
    - role=region + aria-hidden + hidden dual-state for panel visibility
    - Double-brace {{snippet}} (Plan 05 will createElement('mark'), not string concat)
    - Tokens-only CSS (zero hex literals, zero new custom properties)
    - prefers-reduced-motion honoured (slide transition + skeleton pulse + menu fade)
key-files:
  created:
    - packages/dashboard/src/views/partials/agent-history-panel.hbs
    - packages/dashboard/src/views/partials/agent-history-item.hbs
  modified:
    - packages/dashboard/src/views/partials/agent-drawer.hbs
    - packages/dashboard/src/static/style.css
    - packages/dashboard/src/i18n/locales/en.json
decisions:
  - Mounted panel as sibling of .agent-drawer__messages (not a wrapper) so the
    panel slides over via position:absolute + transform — preserves existing
    messages DOM and survives HTMX-boosted nav without re-render.
  - Snippet rendered via double-brace {{snippet}} (escape-safe). <mark> wrapping
    is deferred to Plan 05's client-side createElement('mark') pattern. Zero
    triple-brace in item partial — confirmed via grep.
  - Skeleton container ships hidden by default; Plan 05 toggles it during
    pagination fetches. Rendering the 5 skeleton rows up front (hidden) avoids
    a paint flash when the loading state first activates.
  - Empty state embedded inline inside <ul> rather than a separate partial —
    keeps the single conditional close to the list for easier reading.
  - CSS for rename/confirm/menu pre-shipped even though DOM nodes are created
    client-side in Plan 05 — lets Plan 05 inject bare structure and inherit
    styling without a coordinated CSS delivery.
metrics:
  duration: ~8 minutes
  completed: 2026-04-24
  tasks: 3
  files_modified: 3
  files_created: 2
requirements: [AHIST-01, AHIST-05]
---

# Phase 35 Plan 04: Static History Panel UI — Summary

One-liner: Static Handlebars partials, BEM-scoped CSS using only existing design tokens, and 30 verbatim UI-SPEC i18n keys — gives Plan 05 a complete DOM + styling canvas with zero behaviour yet wired.

## What Shipped

### i18n keys (`src/i18n/locales/en.json`)

30 new keys under the `agent.history.*` namespace — appended after the existing
`agent.newChat.button` key. Copy matches the UI-SPEC §Copywriting Contract
verbatim, including ICU plural syntax for `resultsCount` and `item.meta`:

```
agent.history.open / openAria / panelTitle / panelLabel / back
agent.history.search.placeholder / search.clearAria
agent.history.resultsCount / item.meta / item.menuLabel
agent.history.menu.rename / menu.delete
agent.history.rename.placeholder / save / cancel / errorEmpty / errorServer
agent.history.delete.confirm / confirmYes / confirmNo / error
agent.history.empty.title / body
agent.history.noResults.title / body
agent.history.error.loadTitle / loadBody / retry / more
agent.history.untitled
```

### `agent-history-item.hbs` (NEW)

List-row template. Data contract: `{ id, title, snippet?, lastMessageAtLabel, messageCount }`.

- `<li>` with `role="button" tabindex="-1"` (roving-focus pattern) + `data-action="resumeConversation"`.
- Title with `{{#if title}}{{title}}{{else}}{{t "agent.history.untitled"}}{{/if}}` fallback (D-03 belt-and-braces).
- Conditional `{{#if snippet}}{{snippet}}{{else}}{{t "agent.history.item.meta" ...}}{{/if}}` — meta swaps to snippet during active search.
- 3-dot menu trigger with `aria-haspopup="menu" aria-expanded="false" aria-label="{{t "agent.history.item.menuLabel" title=title}}"`.
- Inline SVG kebab icon, `aria-hidden="true"`, `currentColor` stroke.
- **Zero triple-brace** — verified via grep `{{{` → 0 matches.

### `agent-history-panel.hbs` (NEW)

Stacked region inside `#agent-drawer`. All copy via `{{t}}`.

- `<section id="agent-history-panel" class="agent-drawer__history" role="region" aria-label="…" aria-hidden="true" hidden>` — dual hidden/aria-hidden gate for Plan 05 to toggle.
- Header: back button (`data-action="closeAgentHistory"`) + `<h3>History</h3>`.
- Search: `<input type="search" role="searchbox" aria-controls="agent-history-list" aria-describedby="agent-history-search-hint">` + clear button (`data-action="clearAgentHistorySearch"`, `hidden` default).
- `<div role="status" aria-live="polite" class="sr-only" id="agent-history-live">` — announces result counts.
- Skeleton: 5 pre-rendered `.agent-drawer__history-skeleton-row` children inside `.agent-drawer__history-skeleton` (`hidden aria-hidden="true"` default).
- `<ul id="agent-history-list" role="list">` with conditional `{{#if items.length}}{{#each items}}{{> agent-history-item this}}{{/each}}{{else}}…empty state…{{/if}}`.
- `<div class="agent-drawer__history-sentinel" data-action="historySentinel" role="presentation">` — IntersectionObserver target for Plan 05 infinite scroll.
- Error container (`hidden role="alert"`) with Retry button (`data-action="retryHistory"`).

### `agent-drawer.hbs` (MODIFIED)

- History button inserted in the header AFTER the existing new-chat button. Exact ARIA per UI-SPEC: `aria-label="{{t "agent.history.openAria"}}" title="{{t "agent.history.open"}}" aria-expanded="false" aria-controls="agent-history-panel" data-action="openAgentHistory"`. Inline SVG of a clock-with-arrow per UI-SPEC.
- `{{> agent-history-panel items=historyItems agentDisplayName=agentDisplayName}}` mounted as a SIBLING of `.agent-drawer__messages` (not a wrapper). This lets the panel slide over via `position: absolute; inset: 0; transform: translateX(100%)` without disturbing the existing messages DOM.

### `style.css` — `.agent-drawer__history*` BEM block (appended after agent-confirm block)

**45 selectors hitting `agent-drawer__history`** in the new block:
- Shell (panel slide-in + hidden gate): `.agent-drawer__history`, `[aria-hidden="false"]`, `--history-open` modifier
- Header: `.agent-drawer__history-head` + `h3`
- Search: `.agent-drawer__history-search`, `input[type="search"]` (hover/focus), `-clear` button
- List + item: `.agent-drawer__history-list`, `-item`, `-item-title`, `-item-meta`, `-item-snippet`, `-item-snippet mark`, `-item-menu` (idle + expanded + focus)
- Menu popover: `.agent-drawer__history-menu`, `[role="menuitem"]` (hover/focus/delete variant)
- Rename inline: `.agent-drawer__history-rename` + `input[aria-invalid="true"]`
- Confirm row: `.agent-drawer__history-confirm`
- Sentinel + empty + skeleton + error: all scoped

**Tokens only** — zero hex literals in the new block (grep `#[0-9a-fA-F]{3,6}` intersected with `agent-drawer__history` → 0). The single `rgba(0,0,0,0.12)` is a box-shadow literal (not a hex) used identically to existing menu shadows in the file.

**Motion:** `transform var(--transition-base)` slide; skeleton pulse 1.2s; menu opacity fade `var(--transition-fast)`. All three are disabled inside a single `@media (prefers-reduced-motion: reduce)` block at the bottom of the new section.

## Commits

| Hash | Message |
|------|---------|
| `7b52638` | feat(35-04): add agent.history.* i18n keys |
| `059c5e6` | feat(35-04): add static history panel partials + drawer integration |
| `1932b72` | feat(35-04): add .agent-drawer__history* BEM block |

## Verification

**Task 1 acceptance criteria — PASS:**
- `grep -c '"agent.history\\.' packages/dashboard/src/i18n/locales/en.json` → **30** (≥30)
- `grep -n "agent.history.panelTitle" …/en.json` → 1 line
- `grep -n "agent.history.error.more" …/en.json` → 1 line
- `node -e "JSON.parse(fs.readFileSync('src/i18n/locales/en.json','utf8'))"` → `ok`

**Task 2 acceptance criteria — PASS:**
- `grep -n "agent-drawer__history-open" …/agent-drawer.hbs` → ≥1 line
- `grep -n "agent-history-panel" …/agent-drawer.hbs` → ≥1 line
- `agent-history-panel.hbs` exists + `id="agent-history-panel"` + `role="region"` + `agent-drawer__history-sentinel` → all 1 line
- `agent-history-item.hbs` exists + `data-action="resumeConversation"` + `aria-haspopup="menu"` → all 1 line
- `grep -cE "\\{\\{\\{" …/agent-history-item.hbs` → **0** (T-35-14 mitigation confirmed)
- Handlebars compile check on all three partials → `ok`
- `npx tsc --noEmit` in `packages/dashboard` → exit 0

**Task 3 acceptance criteria — PASS:**
- `grep -c "agent-drawer__history" …/style.css` → **45** (≥25)
- `grep -n "prefers-reduced-motion" …/style.css` inside new block → line 4267 present
- Hex-in-new-block intersection → **0** (`grep -nE "#[0-9a-fA-F]{3,6}" … | grep -c "agent-drawer__history"`)
- `var(--accent-light)` in new block → 1 (`<mark>` highlight — accent-light exists at line 28 light + 118 dark in style.css; no fallback needed)

## Deviations from Plan

None. Plan executed exactly as written. Micro-adjustments documented as decisions:
1. Panel mounted as sibling (not wrapper) of messages — plan said "SIBLING of the existing `.agent-drawer__messages` container" verbatim; followed as specified.
2. Added `z-index: 1` to `.agent-drawer__history` so the sliding panel sits above the messages log during the transform animation (otherwise the messages region would bleed through during transition-base duration). Tokens-only — no new var introduced.
3. `.agent-drawer__history-empty` also declared `list-style: none` to suppress default `<li>` bullet since the empty state is the only child of `<ul>` (cosmetic polish).

## Authentication Gates

None. Pure static-markup + CSS + i18n plan.

## Threat Register Status

| Threat ID | Category | Disposition | Implemented |
|-----------|----------|-------------|-------------|
| T-35-14 (Tampering / XSS) | T | mitigate | ✓ Both `{{title}}` and `{{snippet}}` rendered via double-brace; grep assertion `{{{` → 0 matches in agent-history-item.hbs |
| T-35-15 (Info disclosure via CSS) | I | accept | ✓ All colours from existing palette; no new tokens introduced that could leak theme asymmetry |

## Threat Flags

None — no new network surface, no auth paths, no schema changes. Purely view-layer markup + CSS.

## Known Stubs

None user-facing. The static markup is intentionally dormant: the History button, back button, search input, 3-dot menu, retry button, and sentinel all carry `data-action="…"` hooks but perform no behaviour. **This is by design — Plan 05 (JS hydration) wires all interactions.** The current DOM renders an empty-state panel that is `hidden` by default and cannot be opened without Plan 05's JavaScript. This is the correct checkpoint for a phased UI rollout and NOT a stub in the "blocks the plan's goal" sense — Plan 04's stated goal is "ship the markup, CSS, and i18n copy" (objective verbatim).

## Self-Check: PASSED

- `packages/dashboard/src/views/partials/agent-history-panel.hbs` — FOUND
- `packages/dashboard/src/views/partials/agent-history-item.hbs` — FOUND
- `packages/dashboard/src/views/partials/agent-drawer.hbs` contains `agent-drawer__history-open` + `agent-history-panel` — FOUND
- `packages/dashboard/src/static/style.css` contains `agent-drawer__history` × 45 + `prefers-reduced-motion` in new block — FOUND
- `packages/dashboard/src/i18n/locales/en.json` parses + 30 `agent.history.*` keys — FOUND
- Commits `7b52638`, `059c5e6`, `1932b72` in `git log --oneline` — FOUND
- Handlebars compile + `npx tsc --noEmit` — exit 0
