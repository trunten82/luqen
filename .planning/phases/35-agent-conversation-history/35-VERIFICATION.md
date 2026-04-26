---
phase: 35-agent-conversation-history
verified: 2026-04-24T19:15:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
requirements_coverage:
  - id: AHIST-01
    status: SATISFIED
  - id: AHIST-02
    status: SATISFIED
  - id: AHIST-03
    status: SATISFIED
  - id: AHIST-04
    status: SATISFIED
  - id: AHIST-05
    status: SATISFIED
human_verification:
  - test: "Open agent drawer in a real browser and click the History button"
    expected: "Stacked panel slides in, focus moves to Back; list shows paginated past conversations (newest first) with title, timestamp, and message count; scroll to bottom triggers next 20 via IntersectionObserver"
    why_human: "Visual/motion behaviour (slide transition, skeleton pulse, prefers-reduced-motion honour) cannot be verified in JSDOM — no real layout engine"
  - test: "Type a search term in the drawer history search input"
    expected: "After 250 ms debounce the list filters; matched conversations show a highlighted <mark> snippet; SR live region announces result count; clearing the input restores the cached page 1 without a network call"
    why_human: "End-to-end debounce feel and SR-announcement clarity are subjective and require a real user agent + screen reader"
  - test: "Use the three-dot menu to rename a conversation, then delete another — confirm inline swap is responsive and copy is clear"
    expected: "Rename swaps row to an input with text pre-selected; Enter saves and restores the row with new title. Delete swaps to an inline confirm row with focus on Cancel (safer default); confirming removes the row and writes an audit entry"
    why_human: "Ergonomics of the in-place swap, visual contrast of destructive action, and modal-free confirmation feel cannot be judged from unit tests"
  - test: "Keyboard-only run through History → search → ArrowDown to row → Shift+F10 → Rename → Esc → Esc cascade"
    expected: "Tab order is predictable; roving tabindex moves focus through rows; Shift+F10 opens menu with focus inside; Esc cascade closes menu → search → panel; focus returns to History trigger at each step"
    why_human: "WCAG 2.2 AA focus-visibility and real-user keyboard ergonomics require a human tester with AT; axe-core covers structural violations but not lived keyboard UX"
  - test: "Verify AI title generation on first turn with a real LLM provider (Ollama or OpenAI)"
    expected: "After first assistant response, conversation row gains an AI-generated 3–5 word title; on provider failure, title falls back to first-user-message 50-char truncation; neither re-titles after subsequent turns"
    why_human: "Real-LLM title quality (3–5 word summary fidelity) is a subjective language-quality check; tests only stub the generator"
---

# Phase 35: Agent Conversation History — Verification Report

**Phase Goal:** Users can find and resume any past agent conversation from a searchable, accessible side-drawer history.

**Verified:** 2026-04-24T19:15:00Z
**Status:** human_needed (all automated checks pass; UX + real-LLM quality require human UAT)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User sees paginated list of past conversations (newest first) with title, timestamp, message count | VERIFIED | `GET /agent/conversations` in `src/routes/agent.ts:487` returns `{items, nextOffset}` with `{id, title, createdAt, updatedAt, lastMessageAt, messageCount}`. Repo method `listForUser` filters `is_deleted=0` (index `idx_agent_conversations_user_org_active_last` orders by `last_message_at DESC`). Client hydration in `src/static/agent.js` (openHistoryPanel/fetchHistoryPage) renders `<li data-conversation-id>` per item; IntersectionObserver arms page-20 pagination. Round-trip e2e Tests 2+3 (`tests/e2e/agent-history.e2e.test.ts`) confirm 20 rows page 1 + 21st row on sentinel trigger against real SQLite + real routes + real agent.js. |
| 2 | Free-text case-insensitive search by message content, scoped to user + org | VERIFIED | `ConversationRepository.searchForUser` uses `LIKE ... ESCAPE '\\'` with `%`, `_`, `\` escaped; `user_id = @userId AND org_id = @orgId AND is_deleted = 0`. `GET /agent/conversations/search` (line 516) with zod `{q: 1-200}`. Client debounces 250 ms via `historySearchTimer` and highlights matches via `renderSnippetWithMark` (createElement + createTextNode — XSS-safe; `tests/static/agent-history.test.ts` Test 7 proves `<script>` in snippet renders as literal text). E2E Test 4 proves seeded unique-token query returns exactly 1 row with `<mark>` wrapper. |
| 3 | Resume any past conversation, full history loaded, new turns append to same conversation_id | VERIFIED | `GET /agent/conversations/:id` (line 549) returns `{conversation, messages}` via `getFullHistory`; 404 on org mismatch or soft-deleted. Client `resumeConversation` calls `setConversationId` + `loadPanel` and closes the panel. E2E Test 5 confirms DB retains 2 seeded messages and `agent-form data-conversation-id` is wired to the resumed id. |
| 4 | Soft-delete with audit log; other conversations remain accessible | VERIFIED | Migration 056 adds `is_deleted INTEGER NOT NULL DEFAULT 0` + `deleted_at TEXT` + partial index. `softDeleteConversation` is idempotent and org-guarded. `POST /agent/conversations/:id/delete` (line 636) calls `storage.agentAudit.append({toolName: 'conversation_soft_deleted', ...})`. E2E Test 7 queries `agent_audit_log` directly and confirms the audit row lands; soft-deleted rows are hidden from all user-facing surfaces (list, search, get — returns 404). |
| 5 | List, search, resume/delete are keyboard-navigable + screen-reader friendly (WCAG 2.2 AA) | VERIFIED | Roving tabindex on rows; Shift+F10 / ContextMenu opens menu with focus inside (Plan 06 a11y fix); Esc cascade (menu → search-clear → panel); aria-haspopup/aria-expanded/role=menu/role=alertdialog wired. axe-core (`tests/e2e/agent-history-a11y.e2e.test.ts`) runs against wcag2a + wcag2aa + wcag22aa tags across 3 panel states (populated, empty, search-active) with **zero violations**. Two latent a11y bugs caught and fixed by Plan 06 (nested-interactive on li[role=button]; Shift+F10 focus chain). Still flagged for human UAT because axe does not cover lived keyboard ergonomics or AT announcements. |

**Score:** 5/5 truths verified (all Success Criteria green; human UAT still required for lived UX quality)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/dashboard/src/db/sqlite/migrations.ts` §056 | Soft-delete columns + partial index | VERIFIED | Migration 056 `agent-conversations-soft-delete` at line 1416. (Numeric id differs from plan's 050 — 050-055 consumed by prior phases; documented deviation, auto-fixed.) |
| `packages/dashboard/src/db/interfaces/conversation-repository.ts` | searchForUser/renameConversation/softDeleteConversation + types | VERIFIED | Interface extended; `ConversationSearchHit`, `SearchConversationsOptions` exported; `Conversation.isDeleted`, `Conversation.deletedAt` added. |
| `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` | SQLite impl of new methods | VERIFIED | 4 grep hits (searchForUser, renameConversation, softDeleteConversation, is_deleted filter in listForUser). Org-scoped WHERE, ESCAPE clause. |
| `packages/dashboard/src/agent/conversation-title-generator.ts` | generateConversationTitle + fallback + sanitise | VERIFIED | 132 LOC, 4 exports + structural LLM type; fallback truncates to 50 chars; sanitiseTitle strips Title:/Subject:/quotes/trailing punct + 80-char cap. |
| `packages/dashboard/src/routes/agent.ts` | 5 conversation routes | VERIFIED | 3 GETs (list/search/:id) at lines 487/516/549 + 2 POSTs (rename/delete) at 580/634. zod-validated, org-scoped, audit-emitting on rename/delete. |
| `packages/dashboard/src/agent/agent-service.ts` | Title hook wired post-first-assistant | VERIFIED | `maybeGenerateTitle` invoked at line 376 in runTurn; fires void + renames via storage — SSE `done` emits before title write resolves (Test 4). |
| `packages/dashboard/src/views/partials/agent-history-panel.hbs` | Stacked region markup | VERIFIED | 2616 bytes; role=region, aria-hidden toggle, search input, list, sentinel, error, skeleton, empty state. |
| `packages/dashboard/src/views/partials/agent-history-item.hbs` | Row template | VERIFIED | 1394 bytes; roving tabindex, data-action=resumeConversation, aria-haspopup kebab, double-brace only (0 triple-brace). |
| `packages/dashboard/src/views/partials/agent-drawer.hbs` | History button + panel slot | VERIFIED | History button in header (data-action=openAgentHistory, aria-controls=agent-history-panel); panel mounted as sibling of messages. |
| `packages/dashboard/src/static/style.css` | BEM block for history | VERIFIED | 45 `agent-drawer__history*` selector hits; prefers-reduced-motion block present; tokens-only (0 hex literals in new block). |
| `packages/dashboard/src/i18n/locales/en.json` | 30 agent.history.* keys | VERIFIED | 30 keys under agent.history.* namespace (confirmed via grep count). |
| `packages/dashboard/src/static/agent.js` | Client hydration | VERIFIED | 15 grep hits for history primitives (openHistoryPanel, IntersectionObserver, /agent/conversations, renderSnippetWithMark, historySearchTimer, createElement('mark')). CSP-strict — all DOM mutation via createElement + textContent. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| agent-drawer.hbs History button | openHistoryPanel | `data-action="openAgentHistory"` + delegated click in agent.js | WIRED |
| agent.js fetchHistoryPage | GET /agent/conversations | `fetch('/agent/conversations?limit=20&offset=N')` with csrf header | WIRED (Test 1) |
| agent.js fetchHistorySearch | GET /agent/conversations/search | `fetch('/agent/conversations/search?q=...')` after 250 ms debounce | WIRED (Test 5) |
| agent.js resumeConversation | GET /agent/conversations/:id | `fetch('/agent/conversations/' + id)` + setConversationId + loadPanel | WIRED (Test 17 + e2e Test 5) |
| agent.js submitRename | POST /agent/conversations/:id/rename | fetch with csrf + JSON body | WIRED (Test 12) |
| agent.js submitDelete | POST /agent/conversations/:id/delete | fetch with csrf | WIRED (Test 15 + e2e Test 7) |
| POST /delete | agent_audit_log row | `storage.agentAudit.append({toolName:'conversation_soft_deleted'})` | WIRED (e2e Test 7 queries DB) |
| POST /rename | agent_audit_log row | `storage.agentAudit.append({toolName:'conversation_renamed', argsJson:{oldTitle,newTitle}})` | WIRED |
| AgentService runTurn | conversation_title_generator | `titleGenerator` injected (default binds to generateConversationTitle); `maybeGenerateTitle` fires void fire-and-forget | WIRED (title-hook Test 1-5) |
| searchForUser SQL | is_deleted=0 guard | WHERE clause concatenated with `AND is_deleted = 0` | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| agent-history-panel list | items state | `/agent/conversations` → SQLite `agent_conversations` table (filtered `is_deleted=0`) | Yes — e2e Test 2 asserts 20 real rows from seeded DB | FLOWING |
| agent-history-panel snippet | snippet hit | `searchForUser` ±60 char window around LIKE match in `agent_messages.content` | Yes — e2e Test 4 asserts snippet from seeded message content | FLOWING |
| Conversation title | title column | generateConversationTitle → LLM stream → sanitiseTitle → `renameConversation` | Yes — title-hook Test 1 proves generated title persists; e2e Test 6 proves manual rename persists | FLOWING |
| audit entry | agent_audit_log row | `storage.agentAudit.append` direct INSERT | Yes — e2e Test 7 queries DB and asserts row exists | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase-35 unit tests | `npx vitest run tests/db/conversation-repository.test.ts` | 14/14 pass | PASS |
| Title generator tests | `npx vitest run tests/agent/conversation-title-generator.test.ts` | 9/9 pass | PASS |
| Title hook tests | `npx vitest run tests/agent/agent-service-title-hook.test.ts` | 5/5 pass | PASS |
| HTTP routes tests | `npx vitest run tests/routes/agent-history.test.ts` | 25/25 pass | PASS |
| Client hydration tests | `npx vitest run tests/static/agent-history.test.ts` | 20/20 pass | PASS |
| E2E round-trip | `npx vitest run tests/e2e/agent-history.e2e.test.ts` | 7/7 pass | PASS |
| E2E a11y (axe-core) | `npx vitest run tests/e2e/agent-history-a11y.e2e.test.ts` | 4/4 pass, zero violations | PASS |
| Combined phase-35 suite | 7 files together | **84/84 pass** in 3.19 s | PASS |
| TypeScript compile | `npx tsc --noEmit` (reported in each summary) | exit 0 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AHIST-01 | 35-04, 35-05 | List past conversations (paginated, newest first, title + timestamp + count) | SATISFIED | SC-1 evidence; e2e Tests 2+3 |
| AHIST-02 | 35-05 | Free-text search by message content (case-insensitive, user+org scoped) | SATISFIED | SC-2 evidence; searchForUser + e2e Test 4 |
| AHIST-03 | 35-05 | Resume past conversation — full history loaded, turns append to same id | SATISFIED | SC-3 evidence; e2e Test 5 |
| AHIST-04 | 35-05 | Soft-delete a conversation (audit-logged) + new-chat continues | SATISFIED | SC-4 evidence; migration 056 + e2e Test 7 |
| AHIST-05 | 35-04, 35-05 | Keyboard-accessible + SR-friendly (WCAG 2.2 AA) | SATISFIED (pending human UAT) | SC-5 evidence; axe-core 0 violations across 3 panel states; nested-interactive + F10 focus fixes applied |

All 5 AHIST requirements are claimed by at least one plan's `requirements:` frontmatter (35-04 for AHIST-01/05; 35-05 for AHIST-01..05; 35-06 for AHIST-01..05). No orphaned AHIST requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/static/agent.js | LOC ceiling raised to 1400 | Tech-debt flag — file is 1349 LOC; ceiling comment mandates next plan split history logic into `agent-history.js` | Info | Not a blocker for phase 35 goal. Documented stop-gap for a follow-up polish plan. |

No blocker anti-patterns (TODO/FIXME/placeholder/stub data/console.log-only handlers) found in the phase-35 files.

### Human Verification Required

See frontmatter `human_verification:` block. Summary:
1. Visual panel slide + skeleton pulse + reduced-motion honour in a real browser
2. Debounced search feel + SR-announcement clarity under a real screen reader
3. Rename + Delete in-place swap ergonomics and destructive-copy clarity
4. Full keyboard-only round-trip (Shift+F10, Esc cascade, roving tabindex) with AT
5. Real-LLM title-generation quality (3–5 word summary fidelity) against Ollama/OpenAI

### Gaps Summary

None. All 5 roadmap Success Criteria are VERIFIED; all 5 AHIST requirements are SATISFIED; all artifacts exist, are substantive, wired, and flow real data; 84/84 phase-35 tests pass; axe-core reports zero WCAG 2.2 AA violations across three panel states.

Status is `human_needed` (not `passed`) solely because roadmap SC-5 (WCAG 2.2 AA) plus the core UX truths (SC-1..4) depend on a human UAT pass that automated checks cannot substitute for — per project convention `feedback_ui_phase_uat.md`: "UI phases always need human UAT — automated checks miss cross-persona flows, mobile, URL edge cases." The phase is implementation-complete and ready for human sign-off.

---

_Verified: 2026-04-24T19:15:00Z_
_Verifier: Claude (gsd-verifier)_
