---
id: 260418-mqc
slug: fix-white-on-white-text-in-locked-prompt
status: complete
date: 2026-04-18
description: Fix white-on-white text in locked prompt segments on /admin/llm?tab=prompts
---

# Quick Task 260418-mqc — Summary

## Outcome

Locked prompt-segment `<pre>` now sets an explicit text colour via `color:var(--color-text,#222)`, restoring legibility in any theme where the inherited text colour would otherwise collide with the background.

## Changes

| File | Change |
|---|---|
| `packages/dashboard/src/views/admin/partials/prompt-segments.hbs` | Line 28 — inserted `color:var(--color-text,#222);` into the inline `style` attribute of the locked-segment `<pre>`. |

## Verification

- `grep -n 'color:var(--color-text,#222)' packages/dashboard/src/views/admin/partials/prompt-segments.hbs` → matches on line 28.
- `npm run build` in `packages/dashboard` → exit 0, no TypeScript errors.
- `grep -c 'color:var(--color-text,#222)' packages/dashboard/dist/views/admin/partials/prompt-segments.hbs` → `1` (dist artefact contains the fix).
- Manual UAT (deferred to deploy): visit `https://luqen.alessandrolanna.it/admin/llm?tab=prompts`, confirm locked prompt segments are readable.

## Root cause

The inline style set `background:var(--color-bg-muted,#f5f5f5)` but no text colour. Text colour therefore inherited from whatever ancestor styled it — in the user's theme that resolved to white, producing white-on-white where the background also resolved to a light shade. Adding an explicit `color:var(--color-text,…)` pins the text colour to the theme's foreground token so the pair is always contrastive.

## Out of scope (deferred)

- Converting the inline style block to a proper `.prompt-segment-content` rule in `style.css` (larger refactor).
- Audit of other templates for similar bg-without-color inline-style patterns.
