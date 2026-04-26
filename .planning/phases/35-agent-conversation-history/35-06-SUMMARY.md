---
phase: 35
plan: 06
subsystem: agent-history-e2e-a11y
tags: [agent, history, e2e, a11y, axe-core, wcag22aa, keyboard, jsdom]
requires:
  - 35-01 ConversationRepository (search, rename, softDelete, is_deleted filter)
  - 35-02 generateConversationTitle helper
  - 35-03 /agent/conversations* HTTP surface + audit emission
  - 35-04 agent-history-panel.hbs + i18n
  - 35-05 agent.js history hydration IIFE
provides:
  - packages/dashboard/tests/e2e/agent-history.e2e.test.ts (7 round-trip cases)
  - packages/dashboard/tests/e2e/agent-history-a11y.e2e.test.ts (4 a11y cases)
  - axe-core devDependency in packages/dashboard
  - Real-stack proof that AHIST-01..05 are end-to-end live against the
    SqliteStorageAdapter + registerAgentRoutes + agent.js trio
affects:
  - packages/dashboard/src/static/agent.js (two a11y fixes - see Deviations)
tech-stack:
  added: [axe-core (devDependency only)]
  patterns:
    - JSDOM + real agent.js IIFE + Fastify server.inject bridge (no Playwright dep wired in)
    - axe-core scoped to an Element (panel.ownerDocument) so setupGlobals passes
    - Real Conversation + Message + AuditLog persistence via temp-file SQLite
    - Deterministic search fixture - one of N seeded convos carries a unique token
      string in its assistant reply; UNIQUE_TOKEN is the search-round-trip target
key-files:
  created:
    - packages/dashboard/tests/e2e/agent-history.e2e.test.ts
    - packages/dashboard/tests/e2e/agent-history-a11y.e2e.test.ts
  modified:
    - packages/dashboard/src/static/agent.js (a11y fixes)
    - packages/dashboard/package.json (axe-core devDependency)
    - package-lock.json
decisions:
  - Followed the existing tests/e2e/ pattern (vitest + Fastify inject + JSDOM)
    rather than installing Playwright. Plan 06 <autonomous_mode> note
    explicitly permits this fallback when Playwright is not present. Real
    DB + real routes + real agent.js are exercised; only the browser layer
    is JSDOM instead of Chromium. 35-05's own test harness was already
    using this shape.
  - axe-core executed via axe.run(panelEl) Element form rather than
    axe.run(document). The latter requires window/document as Node
    globals, which collides with vitest worker isolation. Element form
    uses ownerDocument resolution and passes setupGlobals cleanly.
  - Focus-ring colour assertion reduced from literal getComputedStyle
    outlineColor comparison to a two-part token check. Reason - jsdom
    does NOT resolve var() inside getComputedStyle on inherited outline
    properties (probed empirically). The token-chain check is
    semantically equivalent in a real browser (accent chains through
    --focus-outline through :focus-visible rule into element outline).
  - Used temp-file SQLite (not :memory:) because SqliteStorageAdapter
    migration runner and raw writes need a persistent file handle across
    the 047/048/056 migration chain.
metrics:
  duration: ~25 minutes
  completed: 2026-04-24
  tasks: 2
  tests_added: 11 (7 round-trip + 4 a11y)
  files_created: 2
  files_modified: 2
  total_dashboard_tests: 3151 (all passing, +11 vs Plan 05's 3140)
requirements: [AHIST-01, AHIST-02, AHIST-03, AHIST-04, AHIST-05]
---

# Phase 35 Plan 06: End-to-end round-trip + WCAG 2.2 AA a11y gate - Summary

One-liner: Eleven vitest-driven e2e tests prove the full list / infinite-scroll /
search / resume / rename / delete round-trip against real SQLite + real routes
+ real agent.js, and axe-core + keyboard-only coverage locks AHIST-05 behind a
WCAG 2.2 AA gate - while the scans themselves caught and fixed two latent
a11y bugs in the shipped Plan 05 hydration.

## What Shipped

### tests/e2e/agent-history.e2e.test.ts (Task 1 - 7 cases)

Harness: temp-file SQLite via SqliteStorageAdapter migrated to 056, seeded
with 21 conversations (20 + 1 to force the second page), one of which carries
the literal `uniqueSeedToken123` in its assistant reply. Fastify registers the
real registerAgentRoutes with a preHandler that stamps a request.user for
the seeded user+org. JSDOM holds the drawer + history-panel fixture; the real
`src/static/agent.js` IIFE executes inside it; win.fetch is swapped for a
bridge that routes same-origin calls through server.inject.

Test cases:

1. Seed integrity - DB-level sanity: 21 rows with is_deleted=0, one
   message content matches `%uniqueSeedToken123%` and its conversation_id
   is the expected fixture id.
2. First page list - click History, fetch /agent/conversations, 20
   li[data-conversation-id] render, every id belongs to the seeded set.
3. Infinite scroll - IntersectionObserver sentinel trigger fires
   /agent/conversations?offset=20, 21st row appends.
4. Search + mark - debounced search for uniqueSeedToken123, exactly
   1 result row with the token conversation id, and a mark element
   wraps the (case-preserved) match.
5. Resume - click the matched row, /agent/conversations/:id fetch,
   panel hides (aria-hidden=true) and agent-form data-conversation-id
   is wired to the resumed id. DB sanity: 2 seeded messages persisted.
6. Rename - three-dot then Rename, type + Enter, DB title equals
   "Renamed in e2e". Reload panel (fresh JSDOM harness), the renamed
   row shows the new title.
7. Delete + audit - three-dot then Delete then confirm, row removed
   from DOM; DB is_deleted=1, deleted_at is a non-null ISO string;
   agent_audit_log contains a conversation_soft_deleted row for the
   victim id (T-35-20 mitigation evidence). Reload panel, soft-deleted
   row does NOT reappear.

### tests/e2e/agent-history-a11y.e2e.test.ts (Task 2 - 4 cases)

Same harness, plus the real src/static/style.css is inlined into head
so :root --accent resolves via getComputedStyle. axe-core is invoked
as `axe.run(panelEl, { runOnly: { type: 'tag', values: ['wcag2a',
'wcag2aa', 'wcag22aa'] } })` - Element form so it works cleanly without
polluting Node globals.

Test cases:

1. Populated panel - 3 seeded convs, zero axe violations across
   wcag2a + wcag2aa + wcag22aa.
2. Empty panel - no convs, zero violations; empty-state h4 and p
   both carry text.
3. Search-active panel - query produces a match, mark rendered;
   #agent-history-live (role=status, aria-live=polite) contains a
   results-count text; zero axe violations.
4. Keyboard round-trip - Tab to History button, Enter (open), focus
   on Back, Tab to search, Tab to first item, ArrowDown (roving
   tabindex: first is -1, second is 0 + focused), Shift+F10 (menu
   opens with role=menu, focus inside menu), Esc (menu closes),
   ContextMenu key (menu reopens), Esc (closes menu), Esc (closes
   panel, focus returns to History trigger). Also asserts
   :root --accent == #15803d and style.css contains the
   focus-visible -> var(--focus-outline) -> 3px solid #15803d chain.

### src/static/agent.js - two a11y fixes applied (Rule 2)

1. nested-interactive (WCAG 4.1.2 serious) - list rows carried
   role="button" on the li while containing a focusable button
   kebab trigger. axe flagged this under nested-interactive - screen
   readers and AT can fail to announce or focus the inner button.
   Fix: drop role="button" on the li, keep the roving tabindex pattern
   (the row remains the click target via delegated event handler), and
   add aria-label="Resume <title>" so the SR announcement quality is
   preserved.
2. Shift+F10 focus chain - Plan 05's keydown handler called
   toggleItemMenu() and then re-focused the kebab trigger, leaving
   active-element OUTSIDE the newly-opened menu. UI-SPEC Keyboard +
   Screen-Reader Contract requires focus to move INTO the menu. Fix:
   toggleItemMenu() now focuses the first menuitem (Rename) on open,
   and the F10 / ContextMenu handler no longer refocuses the trigger.

### package.json

Added `axe-core ^4.11.3` as a devDependency only. Production bundle
unchanged (no runtime import of axe-core anywhere in src/).

## Commits

| Hash     | Message                                                          |
|----------|------------------------------------------------------------------|
| 8082b7b  | test(35-06): add e2e round-trip for agent history panel          |
| f02bde3  | test(35-06): add axe-core a11y + keyboard-only e2e for history panel |

## Verification

- `cd packages/dashboard && npx vitest run tests/e2e/agent-history.e2e.test.ts`
  -> 7 / 7 pass (~2.7 s)
- `cd packages/dashboard && npx vitest run tests/e2e/agent-history-a11y.e2e.test.ts`
  -> 4 / 4 pass (~1.9 s)
- `cd packages/dashboard && npx vitest run tests/static/agent-history.test.ts
  tests/e2e/agent-history.e2e.test.ts tests/e2e/agent-history-a11y.e2e.test.ts`
  -> 31 / 31 pass (3.13 s). Plan 05 jsdom suite still green after the
  agent.js a11y fixes.
- `cd packages/dashboard && npx vitest run` (full dashboard suite)
  -> 3151 pass | 40 skipped | 3 todo, zero regressions (197 s).
  Baseline from Plan 05: 3140 pass, +11 from this plan, matches.
- `cd packages/dashboard && npx tsc --noEmit` - exit 0

Acceptance-criteria greps:

- `grep -c "it\\('test" tests/e2e/agent-history.e2e.test.ts` -> 7 (>=7)
- `grep -c "is_deleted" tests/e2e/agent-history.e2e.test.ts` -> 6 (>=1)
- `grep -c "conversation_soft_deleted\\|agent_audit_log" tests/e2e/agent-history.e2e.test.ts`
  -> 5 (>=1)
- `grep -c "axe-core\\|axe\\." tests/e2e/agent-history-a11y.e2e.test.ts` -> 9
- `grep -c "wcag22aa\\|wcag2aa" tests/e2e/agent-history-a11y.e2e.test.ts` -> 3
- `grep -c "Shift+F10\\|ContextMenu\\|ArrowDown\\|F10" tests/e2e/agent-history-a11y.e2e.test.ts`
  -> 11

## Deviations from Plan

### Auto-fixed Issues

1. [Rule 3 - Blocking] Playwright not wired into packages/dashboard

- Found during: Task 1 bootstrap.
- Issue: Plan 06 acceptance criteria invoke `npx playwright test ...`.
  The dashboard package has no playwright or @playwright/test dep, no
  playwright.config.ts, no browser runtime. All existing dashboard
  "E2E" tests under tests/e2e/*.test.ts are vitest + Fastify inject -
  see the inline deviation note at the top of tests/e2e/agent-panel.test.ts.
- Fix: Plan 06 notes block explicitly permits this fallback ("If
  Playwright not present, use the existing in-process Fastify pattern").
  Both test files use vitest + Fastify server.inject + JSDOM + real
  src/static/agent.js loaded into the jsdom window via the same IIFE
  loader pattern Plan 35-05 established. Same harness shape as Plan
  35-05 tests/static/agent-history.test.ts. Real DB, real routes, real
  agent.js - only the browser layer is swapped out.
- Commits: 8082b7b, f02bde3.

2. [Rule 2 - Missing critical a11y] nested-interactive WCAG 4.1.2
   violation in Plan 05 agent.js

- Found during: Task 2, first axe-core scan of the populated panel.
- Issue: axe reported nested-interactive [serious] on every
  li[role=button] row - the row had a widget role AND a focusable
  button kebab trigger inside. Screen readers and assistive tech
  can fail to announce or focus the nested button under this pattern.
  Listed under WCAG 4.1.2 (wcag2a).
- Fix: renderHistoryItem in src/static/agent.js no longer sets
  role="button" on the li. The row keeps its tabindex (roving
  focus pattern), the delegated click/keydown handlers continue to
  resume on activation, and a new aria-label="Resume <title>" (or
  "Resume conversation" when untitled) preserves the SR announcement
  quality.
- Commit: f02bde3.

3. [Rule 2 - Missing critical a11y] Shift+F10 doesn't move focus
   INTO the menu

- Found during: Task 2 Test 4 keyboard round-trip.
- Issue: UI-SPEC Keyboard + Screen-Reader Contract states that on
  Shift+F10 on a focused item, role=menu popover is visible and
  activeElement is inside it. Plan 05 handler opened the menu but
  then re-focused the kebab trigger (outside the menu). SR users
  would hear the menu announce but not be able to read/activate the
  menuitems without an additional Tab.
- Fix: toggleItemMenu() now calls rename.focus() on open (first
  menuitem = safe default). The keydown F10/ContextMenu branch no
  longer manually refocuses the trigger; it delegates to
  toggleItemMenu's own focus contract. Existing Esc-with-menu-open
  behaviour (refocus trigger) is unchanged - that path still goes
  through closeHistoryMenu(true).
- Commit: f02bde3.

4. [Rule 3 - Harness limitation] getComputedStyle outlineColor does
   not resolve var(--accent) in JSDOM

- Found during: Task 2 Test 4 focus-ring colour assertion.
- Issue: Plan wanted a computed outline colour comparison against the
  resolved var(--accent) token. Empirical probe: JSDOM returns
  `outline: "var(--focus-outline)"` literal string even with the
  stylesheet loaded - CSS custom property resolution INSIDE inherited
  shorthand values is not implemented. Resolving --accent via
  getPropertyValue on documentElement DOES work.
- Fix: Reduced to a two-part token-chain check: (a)
  `getComputedStyle(:root).getPropertyValue('--accent') === '#15803d'`,
  (b) style.css source contains both the
  `:focus-visible { outline: var(--focus-outline) }` rule and the
  `--focus-outline: 3px solid #15803d` declaration. In a real browser,
  these two guarantees compose into the exact invariant the plan named.
  Documented in an inline comment inside Test 4.

### Non-deviations

- Plan asked for >=7 test( blocks in Task 1 -> shipped exactly 7.
- Plan asked for >=1 is_deleted line -> shipped 6.
- Plan asked for >=1 conversation_soft_deleted or agent_audit_log line
  -> shipped 5 (both literal strings appear).
- Plan asked for >=1 AxeBuilder / @axe-core/playwright ref - shipped
  axe-core + axe.run which is the underlying engine;
  @axe-core/playwright wrapper not applicable because no Playwright
  (Deviation 1).
- Plan asked for >=1 wcag22aa / wcag2aa line -> shipped 3.
- Plan asked for >=1 Shift+F10 / ContextMenu / ArrowDown line ->
  shipped 11.
- All 4 a11y cases green; zero axe violations across the three panel
  states.
- Plan 05 20-case jsdom suite still passes unchanged.

## Authentication Gates

None. Harness stamps request.user via a Fastify preHandler; all
assertions operate on already-authenticated flows.

## Threat Register Status

| Threat ID | Category | Disposition | Implemented |
|-----------|----------|-------------|-------------|
| T-35-20   | R (Repudiation) | mitigate | Test 7 queries agent_audit_log directly and asserts a conversation_soft_deleted row exists with matching conversation_id. Future regression that silently skips the audit write would flip this test red. |

## Threat Flags

None. No new network surface, no new auth paths, no new schema. Purely
test code + two client-side a11y corrections.

## Known Stubs

None. Every wiring is production-ready - tests exercise the real DB,
real repo, real routes, and real agent.js IIFE.

## Self-Check

- packages/dashboard/tests/e2e/agent-history.e2e.test.ts - FOUND
  (7 it('test blocks, 499 lines)
- packages/dashboard/tests/e2e/agent-history-a11y.e2e.test.ts - FOUND
  (4 it('test blocks, 517 lines)
- packages/dashboard/src/static/agent.js - FOUND, two a11y fixes
  applied (role=button removed from li; focus moves into menu on open)
- packages/dashboard/package.json - FOUND, axe-core ^4.11.3 in
  devDependencies
- Commits 8082b7b, f02bde3 in git log --oneline - FOUND
- Full dashboard suite: 3151 pass, zero regressions vs Plan 05 baseline
- npx tsc --noEmit - exit 0

## Self-Check: PASSED
