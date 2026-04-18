---
id: 260418-mqc
slug: fix-white-on-white-text-in-locked-prompt
status: ready
date: 2026-04-18
description: Fix white-on-white text in locked prompt segments on /admin/llm?tab=prompts
---

# Quick Task 260418-mqc — Fix white-on-white locked prompt content

## Context

Reported during Phase 30 walkthrough on 2026-04-18. The locked prompt-segment content on `/admin/llm?tab=prompts` is rendered inside a `<pre>` with an inline `background:var(--color-bg-muted,#f5f5f5)` but **no explicit text `color`**. In themes where text colour is inherited as white (e.g. certain dark-mode / brand overrides), the result is white-on-white and the locked content is unreadable.

## Fix

Add an explicit text colour to the inline style so rendering is theme-independent.

**File:** `packages/dashboard/src/views/admin/partials/prompt-segments.hbs:28`

**Before:**
```hbs
<pre class="prompt-segment-content" style="background:var(--color-bg-muted,#f5f5f5);padding:0.75rem;border-radius:4px;overflow-x:auto;white-space:pre-wrap;font-size:0.8rem;margin:0">{{content}}</pre>
```

**After:**
```hbs
<pre class="prompt-segment-content" style="background:var(--color-bg-muted,#f5f5f5);color:var(--color-text,#222);padding:0.75rem;border-radius:4px;overflow-x:auto;white-space:pre-wrap;font-size:0.8rem;margin:0">{{content}}</pre>
```

## Tasks

### Task 1 — Apply the CSS fix

- **Files:** `packages/dashboard/src/views/admin/partials/prompt-segments.hbs`
- **Action:** Insert `color:var(--color-text,#222);` into the inline `style` attribute on line 28, directly after the `background:var(--color-bg-muted,#f5f5f5);` segment.
- **Verify:**
  - `grep -n 'color:var(--color-text,#222)' packages/dashboard/src/views/admin/partials/prompt-segments.hbs` returns a match on line 28.
  - The line still contains `background:var(--color-bg-muted,#f5f5f5)` (we're adding, not replacing).
- **Done:** commit with message `fix(dashboard): set explicit text colour on locked prompt segments (260418-mqc)`.

### Task 2 — Rebuild the dashboard package

- **Files:** `packages/dashboard/dist/**` (generated)
- **Action:** `cd packages/dashboard && npm run build`
- **Verify:**
  - `npm run build` exits 0.
  - `grep -c 'color:var(--color-text,#222)' packages/dashboard/dist/views/admin/partials/prompt-segments.hbs` returns `1`.
- **Done:** no commit — dist output is git-ignored or auto-committed by CI per project convention.

## Acceptance

- [ ] Source view contains `color:var(--color-text,#222)` on the locked-segment `<pre>`.
- [ ] Dashboard package builds cleanly.
- [ ] Manual UAT (user's responsibility): visit `/admin/llm?tab=prompts` after deploy, confirm locked segments are readable in both light and dark themes.

## Out of scope

- Rewriting the inline styles into `style.css` class rules (larger refactor — deferred).
- Auditing other templates for similar bg-without-color inline style patterns (tracked separately if found).
