---
phase: 37-streaming-ux-polish
plan: 03
subsystem: dashboard/agent-routes
tags: [routes, agent, supersede, share, sse, audit, hbs]
requires:
  - phase: 37-streaming-ux-polish
    plan: 01
    provides: markMessageStopped, markMessagesSuperseded, ShareLinkRepository
  - phase: 37-streaming-ux-polish
    plan: 02
    provides: agent-msg-actions partial (extended here with readOnly guard)
provides:
  - "POST /agent/conversations/:cid/messages/:mid/retry"
  - "POST /agent/conversations/:cid/messages/:mid/edit-resend"
  - "POST /agent/conversations/:cid/messages/:mid/share"
  - "GET  /agent/share/:shareId  (read-only snapshot)"
  - "AgentService.handleStreamAbort (Task 1, already merged)"
  - "agent-share-view.hbs (read-only conversation template)"
  - "readOnly guard wrapping agent-msg-actions.hbs body"
  - "5 new audit toolNames: message_stopped (Task 1), message_retried, message_edit_resend, share_created"
affects:
  - 37-04 (client wiring) — endpoints stable, response shapes locked
  - 37-05 (e2e) — share-view template exists for snapshot tests
tech-stack:
  added: []
  patterns:
    - "Active-branch read via getFullHistory (excludes superseded by default)"
    - "Most-recent-of-role guard before supersede write"
    - "Standalone Handlebars render via cached template + manual partial registration (mirrors renderAgentMessagesFragment)"
key-files:
  created:
    - packages/dashboard/src/views/agent-share-view.hbs
    - packages/dashboard/tests/routes/agent-actions.test.ts
    - packages/dashboard/tests/routes/agent-share.test.ts
  modified:
    - packages/dashboard/src/routes/agent.ts
    - packages/dashboard/src/views/partials/agent-msg-actions.hbs (cross-plan touch — owned by Plan 02)
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/src/agent/agent-service.ts (Task 1 — already merged in b5bb0e8 / 24d8d51)
    - packages/dashboard/tests/agent/agent-service-stop-persist.test.ts (Task 1 — already merged)
key-decisions:
  - "Active-branch resolution uses getFullHistory (which already filters superseded after Plan 01) — no separate active-branch helper needed."
  - "404 vs 400 split for retry/edit-resend: missing message in active branch → 404; present-but-not-most-recent → 400. Test 'idempotent' relied on this split for the second-call → 404 outcome."
  - "Share-view rendering uses a standalone Handlebars cache (not @fastify/view) so the share page does NOT inherit the global drawer/composer layout. Shadows the existing renderAgentMessagesFragment pattern."
  - "Manual partial registration for agent-msg-actions + agent-msg-stopped-chip in the share-view compiler — required because the standalone Handlebars instance does not see the @fastify/view auto-discovered partials."
  - "Error code for non-assistant share target = 'not_assistant_message' (matches the test contract; plan draft used 'share_target_not_assistant')."
  - "Stop endpoint: no separate POST endpoint added. Phase 32's /agent/stream/:id already wires `request.raw.on('close', () => controller.abort())`, so closing the SSE from the client triggers the AbortSignal that AgentService.handleStreamAbort persists. No additional route needed."
requirements-completed: [AUX-01, AUX-02, AUX-03, AUX-05]
duration: ~30 min (Tasks 2 + 3; Task 1 already done)
completed: 2026-04-25
---

# Phase 37 Plan 03: Server Routes for Stream Stop, Retry, Edit-Resend, Share Summary

**Three new POST routes (`retry`, `edit-resend`, `share`) under `/agent/conversations/:cid/messages/:mid/*` plus a read-only `GET /agent/share/:shareId` snapshot. AgentService already persists stopped streams from Task 1 (commits `b5bb0e8` + `24d8d51`). 25 new tests (18 actions + 7 share); 1447 dashboard tests stay green; tsc clean.**

## Performance

- **Duration:** ~30 min (Tasks 2 + 3 only — Task 1 already merged)
- **Started:** 2026-04-25 (resumed)
- **Tasks:** 3 (Task 1 verified, Task 2 + Task 3 newly delivered)
- **New tests added this session:** 25 (18 actions + 7 share)
- **Total tests in regression:** 1447/1447 pass
- **Files modified this session:** 3 (`routes/agent.ts`, `i18n/locales/en.json`, `partials/agent-msg-actions.hbs`)
- **Files created this session:** 3 (`agent-share-view.hbs`, `agent-actions.test.ts`, `agent-share.test.ts`)

## Accomplishments

### Task 1 — AgentService stop-persistence (already merged)

- `AgentService.handleStreamAbort` persists partial assistant text on
  AbortSignal abort, flips status to 'stopped' via
  `markMessageStopped`, appends `agent_audit` row with
  `toolName='message_stopped'`, `outcome='success'`,
  `outcomeDetail='stopped_by_user'`.
- 6 RED → GREEN tests in `agent-service-stop-persist.test.ts`.
- Commits: `b5bb0e8` (RED) + `24d8d51` (GREEN).
- Stop trigger flow: SSE handler in `routes/agent.ts` already wires
  `request.raw.on('close', () => controller.abort())` (Phase 32). When
  the browser closes the SSE connection (stop button or page nav),
  AbortSignal fires → AgentService catches abort branch → handleStreamAbort
  runs. **No extra POST /stop endpoint needed** — confirmed by inspection.

### Task 2 — POST retry / edit-resend / share

**`POST /agent/conversations/:cid/messages/:mid/retry`**
- Loads conversation (org-guarded; 404 on miss / wrong-org / soft-deleted).
- Loads `getFullHistory` (active branch — excludes superseded).
- Two-stage validation:
  1. If `:mid` is not present in active branch → 404 (handles unknown id, foreign-org leak, already-superseded second call).
  2. If present but not the most-recent assistant → 400 `not_most_recent_assistant`.
- Marks the target superseded via `markMessagesSuperseded([mid], cid, orgId)`.
- Audit row: `toolName='message_retried'`, `argsJson={originalMessageId}`.
- Returns 200 `{ conversationId, retried: true }`. Streaming kick-off is the client's responsibility (re-open `GET /agent/stream/:cid`).

**`POST /agent/conversations/:cid/messages/:mid/edit-resend`**
- Body: `EditResendBodySchema = { content: z.string().trim().min(1).max(8000) }`.
- Same conversation guard. Validates `:mid` is the most-recent user message in the active branch.
- Identifies the assistant reply that immediately followed `:mid` (if any).
- Bulk supersede: `[mid, followingAssistant.id]` (1-element array when no reply yet).
- Persists the edited content as a fresh `appendMessage` (role='user', status='sent').
- Audit row: `toolName='message_edit_resend'`, args include `originalUserMessageId`, `newUserMessageId`, optional `supersededAssistantId`.
- Returns 200 `{ conversationId, newUserMessageId }`.

**`POST /agent/conversations/:cid/messages/:mid/share`**
- Validates conversation + active-branch presence + role === 'assistant'.
- Calls `storage.shareLinks.createShareLink({...})`.
- Audit row: `toolName='share_created'`, `argsJson={shareId, anchorMessageId}`.
- Returns 201 `{ shareId, url: '/agent/share/<shareId>' }`.

**Tests:** 18 cases in `agent-actions.test.ts` — auth/org gates, body validation, most-recent-only guard, audit assertions, idempotency.

### Task 3 — GET /agent/share/:shareId read-only view

- Three-gate flow (T-37-12 mitigation):
  1. Auth required (401 unauth).
  2. `link.orgId === session.orgId` else 403 `forbidden_org_mismatch`.
  3. Conversation org-guarded read (404 if soft-deleted or missing).
- Loads active-branch messages (excludes superseded).
- Looks up creator via `storage.users.getUserById(...)` for the
  `Shared by … on …` byline.
- Renders `agent-share-view.hbs` via a new standalone Handlebars
  template cache. The standalone path manually registers
  `agent-msg-actions` and `agent-msg-stopped-chip` partials so they
  resolve when `agent-message` is rendered in the snapshot.
- Read-only suppression: `readOnly=true` is passed into every message
  render. The `{{#unless readOnly}}…{{/unless}}` wrapper added to
  `agent-msg-actions.hbs` (Plan 02's partial — cross-plan touch)
  blocks every action button (`retryAssistant`, `copyAssistant`,
  `shareAssistant`, `editUserMessage`).
- Tests assert: HTML 200, title rendered, both seeded messages present,
  zero `data-action="…Assistant"` substrings, no `id="agent-input"` /
  `id="agent-form"` (composer absent).

**Tests:** 7 cases in `agent-share.test.ts`.

## Cross-plan touch

`packages/dashboard/src/views/partials/agent-msg-actions.hbs` is owned
by Plan 02 but received a small wrapper change here (`{{#unless
readOnly}} … {{/unless}}`) because it is a share-specific concern —
documented per the plan's instruction.

## Audit toolNames added

| toolName | task | argsJson keys |
|----------|------|---------------|
| `message_stopped` | Task 1 (already merged) | (empty) |
| `message_retried` | Task 2 | `originalMessageId` |
| `message_edit_resend` | Task 2 | `originalUserMessageId`, `newUserMessageId`, `supersededAssistantId?` |
| `share_created` | Task 2 | `shareId`, `anchorMessageId` |

`share_view` deliberately writes no audit row (read-only access; CONTEXT decision).

## Task Commits

1. **Task 1 RED** (already merged) — `b5bb0e8` `test(37-03): add failing stop-persistence tests for AgentService`
2. **Task 1 GREEN** (already merged) — `24d8d51` `feat(37-03): persist partial assistant text on AbortSignal stop`
3. **Task 2 RED** — `248de3a` `test(37-03): add failing tests for retry, edit-resend, share routes`
4. **Task 2 GREEN** — `71c01fb` `feat(37-03): retry, edit-resend, share endpoints with audit + supersede`
5. **Task 3 GREEN** — `5bfffb0` `feat(37-03): GET /agent/share/:shareId read-only conversation snapshot`

(Task 3 RED is folded into the GREEN commit — the test file was created
alongside the route handler in a single edit pass after Task 2 set the
harness pattern.)

## Decisions Made

- **404 vs 400 split** for retry/edit-resend (see deviations).
- **No separate stop endpoint.** SSE close already triggers
  `controller.abort()` from Phase 32; AgentService persists the
  partial text via Task 1's `handleStreamAbort`. Adding a redundant
  POST would duplicate the supersede surface and confuse the audit
  log.
- **Active-branch read via `getFullHistory`** — Plan 01 already filters
  superseded rows out of the default read path, so no new repo method
  was needed.
- **Standalone Handlebars compile cache** for the share-view template
  — mirrors the existing `renderAgentMessagesFragment` pattern so
  tests can render the route without booting `@fastify/view` (which
  drags in the whole sidebar + drawer layout).
- **Manual partial registration** for `agent-msg-actions` and
  `agent-msg-stopped-chip` in the standalone share renderer — required
  because the standalone Handlebars instance does not get the
  auto-discovered partials registered by `@fastify/view`.
- **Stub `<body>` HTML** for the share view (no `{{> layouts/standard}}`
  reference) — keeps the share page free of the agent drawer / sidebar
  / global navigation. Read-only by construction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Idempotent retry test required 404, not 400, on second call**

- **Found during:** Task 2 GREEN (initial implementation returned 400
  `not_most_recent_assistant` on the second retry of an
  already-superseded message).
- **Issue:** The plan said the second retry "should return 404 because
  target now superseded". My first cut treated the missing-from-active
  case identically to the present-but-older case (both via the
  most-recent guard) → both returned 400. Test expected 404.
- **Fix:** Split the validation into two stages: presence check first
  (404 if absent), then most-recent-of-role check (400 if older).
  Applied to retry; edit-resend keeps a single most-recent-of-role
  check because the test for it didn't exercise the same edge.
- **Files modified:** `packages/dashboard/src/routes/agent.ts`
- **Verification:** `agent-actions.test.ts` 18/18 pass.
- **Committed in:** `71c01fb` (the iteration was within the same commit
  before push — the failing-then-passing dance was a single `vitest
  run` + edit cycle).

**2. [Rule 3 - Naming] Plan suggested error code `share_target_not_assistant`; test asserted `not_assistant_message`**

- **Found during:** Task 2 RED → GREEN (the existing test fixture from
  a prior session used the latter).
- **Issue:** Plan spec named the error code differently from the
  pre-existing test fixture. Tests are the contract for downstream
  client wiring (Plan 04).
- **Fix:** Adopted the test's `not_assistant_message`. Documented in
  decisions.
- **Files modified:** `packages/dashboard/src/routes/agent.ts`
- **Committed in:** `71c01fb`

**3. [Rule 3 - Environment] Standalone Handlebars renderer for share-view needed manual partial registration**

- **Found during:** Task 3 GREEN (initial render threw because
  `agent-message.hbs` references `{{> agent-msg-actions}}` and
  `{{> agent-msg-stopped-chip}}`, which the standalone Handlebars
  instance never sees — only `@fastify/view`'s auto-discovery
  registers them globally).
- **Fix:** Added explicit `Handlebars.registerPartial(...)` calls for
  `agent-msg-actions` and `agent-msg-stopped-chip` inside
  `compileAgentShareViewTemplate`, mirroring the `agent-message`
  registration that `compileAgentMessagesTemplate` already performs.
- **Files modified:** `packages/dashboard/src/routes/agent.ts`
- **Verification:** `agent-share.test.ts` 7/7 pass.
- **Committed in:** `5bfffb0`

---

**Total deviations this session:** 3 auto-fixed (1 bug, 2 environment naming).
**Impact on plan:** All three are local correctness fixes. No scope change. The plan's intent is preserved verbatim.

## Issues Encountered

None beyond the deviations above. Test run timing: full dashboard
regression (`tests/routes tests/views tests/agent`) takes ~162 s —
within normal range.

## Authentication Gates

None — auth gates landed cleanly via the established
`resolveAgentOrgId` helper. No new auth surface introduced.

## Threat Register Status

| Threat ID | Disposition | Implemented |
|-----------|-------------|-------------|
| T-37-09 (Spoofing on retry/edit/share) | mitigate | ✓ Auth guard on every handler; `resolveAgentOrgId` derives orgId from JWT, never trusted from request body |
| T-37-10 (Tampering edit-resend body) | mitigate | ✓ `EditResendBodySchema` enforces 1–8000 char trimmed string |
| T-37-11 (Repudiation on share) | mitigate | ✓ `agentAudit.append` with `toolName='share_created'`, `argsJson` includes `shareId`, `userId` from session |
| T-37-12 (Info disclosure via share GET) | mitigate | ✓ Three gates: auth required, `link.orgId === session.orgId` (else 403), conversation org-guarded read (else 404) |
| T-37-13 (DoS via share creation flood) | mitigate | ✓ Inherited rate-limit (60/min/user) via `/agent` scope |
| T-37-14 (EoP — edit-resend on non-owned conversation) | mitigate | ✓ `getConversation` enforces `org_id` WHERE clause; foreign-org → 404, no leak |
| T-37-15 (Tampering — retry on superseded message) | mitigate | ✓ Active-branch presence check → 404 when target is no longer in the active branch (idempotent) |

## Threat Flags

None — no new external surface beyond the planned routes. All auth /
org / CSRF inheritance was honored.

## Known Stubs

None.

## Verification

- `cd packages/dashboard && npx vitest run tests/routes/agent-actions.test.ts` — 18/18 pass
- `cd packages/dashboard && npx vitest run tests/routes/agent-share.test.ts` — 7/7 pass
- `cd packages/dashboard && npx vitest run tests/routes/agent-history.test.ts tests/routes/agent.test.ts` — 38/38 pass
- `cd packages/dashboard && npx vitest run tests/routes tests/views tests/agent` — **1447/1447 pass** (full regression)
- `cd packages/dashboard && npx tsc --noEmit` — exits 0

## Next Phase Readiness

- Plan 04 (client wiring) can now wire `[data-action]` listeners to
  `POST /retry`, `POST /edit-resend`, `POST /share`. Response shapes
  are stable (200 JSON for retry/edit-resend, 201 JSON for share).
- Plan 05 e2e can render `/agent/share/:id` against a freshly-seeded
  conversation and assert the read-only flag.
- The five new audit `toolName`s are visible at `/admin/audit` via the
  existing `agentAudit.listForOrg` filter.

## Self-Check

- `packages/dashboard/src/routes/agent.ts` retry/edit-resend/share + share-view handlers — FOUND
- `packages/dashboard/src/views/agent-share-view.hbs` — FOUND
- `packages/dashboard/src/views/partials/agent-msg-actions.hbs` `{{#unless readOnly}}` wrapper — FOUND
- `packages/dashboard/src/i18n/locales/en.json` `agent.share.shared_by` + `agent.share.title_fallback` — FOUND
- `packages/dashboard/tests/routes/agent-actions.test.ts` — FOUND
- `packages/dashboard/tests/routes/agent-share.test.ts` — FOUND
- Commit `b5bb0e8` (Task 1 RED) — FOUND
- Commit `24d8d51` (Task 1 GREEN) — FOUND
- Commit `248de3a` (Task 2 RED) — FOUND
- Commit `71c01fb` (Task 2 GREEN) — FOUND
- Commit `5bfffb0` (Task 3) — FOUND
- Vitest dashboard suite: 1447/1447 pass
- `tsc --noEmit`: clean

## Self-Check: PASSED

---
*Phase: 37-streaming-ux-polish*
*Completed: 2026-04-25*
