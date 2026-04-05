---
phase: 05-ui-review-polish
plan: "01"
subsystem: dashboard-ui
tags: [i18n, css, mobile, design-system]
dependency_graph:
  requires: []
  provides: [llm-admin-i18n, llm-admin-mobile-css, design-system-tokens]
  affects: [packages/dashboard/src/views/admin/llm.hbs, packages/dashboard/src/static/style.css, packages/dashboard/src/i18n/locales/en.json]
tech_stack:
  added: []
  patterns: [Handlebars i18n via {{t}}, Emerald design system tokens, CSS @media mobile-first]
key_files:
  created: []
  modified:
    - packages/dashboard/src/views/admin/llm.hbs
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/static/style.css
decisions:
  - "All UI copy in llm.hbs replaced with {{t}} keys — no hardcoded English remains"
  - "brd-discover fallback wrappers (--spacing-6/3) removed — use Emerald tokens directly"
metrics:
  duration: 2m
  completed: "2026-04-05T05:29:08Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 05 Plan 01: LLM Admin UI Polish Summary

**One-liner:** LLM admin page i18n'd with 17 translation keys and mobile CSS rules added; Phase 1-3 CSS tokens standardised to Emerald design system.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | LLM admin page — i18n keys and mobile layout audit | 72c98c6 | llm.hbs, en.json, style.css |
| 2 | Design system token audit — fix raw values in Phase 1-3 CSS sections | 7a874b4 | style.css |

## What Was Done

### Task 1 — i18n keys and mobile layout

Added `admin.llm` section to `en.json` with 17 translation keys covering:
- Tab labels: `tabProviders`, `tabModels`, `tabCapabilities`, `tabPrompts`
- Form actions: `addProvider`, `registerModel`, `addToChain`, `saveOverride`, `resetToDefault`
- Empty states: `noProviders`, `noModelsForProvider`, `noCapabilities`, `noPromptsAvailable`, `capabilityNoModels`, `modelsNoProviders`, `promptNoTemplate`
- Section copy: `capabilityFallbackIntro`, `capabilityFallbackLabel`, `capabilityFallbackFooter`

All 21 occurrences of `{{t "admin.llm.*"}}` in `llm.hbs` replace previously hardcoded English strings.

Added new `@media (max-width: 640px)` block to `style.css`:
- `.fallback-chain li` — stacks vertically (column direction) on mobile
- `.tab-content .cards` — single column grid on mobile
- `.brd-discover__form` — column direction on mobile
- `.brd-discover__input-group` — full width on mobile
- `.alert code` — `word-break: break-all` for long URLs in warning banners

### Task 2 — Design system token audit

Replaced raw CSS values in Phase 1-3 additions with Emerald tokens:
- `.rpt-fix-hint`: `margin-top: 0.5rem` → `var(--space-sm)`
- `.rpt-fix-hint__code`: `margin: 0.25rem 0.7rem 0.7rem` → `var(--space-xs) var(--space-sm) var(--space-sm)`; `font-size: 0.75rem` → `var(--font-size-xs)`
- `.rpt-fix-effort`: `margin-left: 0.25rem` → `var(--space-xs)`
- `.brd-discover`: `var(--spacing-6, var(--space-lg))` → `var(--space-lg)` (remove non-Emerald double-fallback)
- `.brd-discover__form`: `var(--spacing-3, var(--space-sm))` → `var(--space-sm)` (same fix)

Zero occurrences of `--spacing-N` remain in `style.css`.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this is a UI polish pass; no data stubs introduced.

## Verification Results

- `en.json` is valid JSON with `admin.llm` section containing 17 keys
- `llm.hbs` has 21 `{{t "admin.llm.*"}}` usages; zero bare English UI copy remains
- `style.css` has mobile `@media (max-width: 640px)` block with all required rules
- `style.css` has zero `var(--spacing-` occurrences
- Dashboard builds without errors (`npm run build --workspace=packages/dashboard`)

## Self-Check: PASSED
