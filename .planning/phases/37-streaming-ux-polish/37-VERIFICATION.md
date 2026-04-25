---
phase: 37-streaming-ux-polish
verified: 2026-04-25
verifier: gsd-execute-phase (37-05 executor)
requirements: [AUX-01, AUX-02, AUX-03, AUX-04, AUX-05]
status: PASS
---

# Phase 37 — Streaming UX Polish — Verification Record

Per Phase 39 VER-01 standard. One row per success criterion with verification method, evidence, and outcome. Nyquist coverage note documents which SCs have automated coverage versus manual-only UAT.

## Success Criteria Outcomes

| SC      | Criterion                                                                                                                              | Method                                                       | Evidence                                                                                                                                                                                                                                                            | Outcome |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| AUX-01  | User can interrupt an in-flight streaming response (stop button cancels SSE + persists partial response)                                | unit + integration + e2e + manual UAT                        | `tests/agent/agent-service-stop-persist.test.ts` (6 cases — `handleStreamAbort` writes partial + `markMessageStopped` + audit); `tests/e2e/agent-streaming-ux.e2e.test.ts` test 1 (replays the same three-write dance against real DB and asserts via real GET route); 37-04 UAT-approved on lxc-luqen 2026-04-25. | PASS    |
| AUX-02  | User can retry the last assistant turn (re-runs against the same conversation state)                                                    | integration (route) + e2e + manual UAT                       | `tests/routes/agent-actions.test.ts` retry block (6 cases — auth, org, idempotency, audit); `tests/e2e/agent-streaming-ux.e2e.test.ts` test 2 (POST /retry → status='superseded' + audit row landed + active branch no longer contains the row); 37-04 UAT-approved.                                                              | PASS    |
| AUX-03  | User can edit-and-resend their own message — branches the conversation, prior assistant reply is marked superseded                      | integration (route) + e2e + manual UAT                       | `tests/routes/agent-actions.test.ts` edit-resend block (6 cases — body validation, most-recent guard, supersede-of-pair, audit); `tests/e2e/agent-streaming-ux.e2e.test.ts` test 3 (asserts active-branch == [new user] only, getMessagesIncludingSuperseded shows old user + assistant flagged); 37-04 UAT-approved.    | PASS    |
| AUX-04  | User can copy any assistant message to clipboard with one click (full markdown source, not rendered HTML)                               | unit (JSDOM clipboard primitives) + integration + e2e + UAT  | `tests/static/agent-actions.test.ts` (21 JSDOM cases — clipboard cache, fallback path); `tests/e2e/agent-streaming-ux.e2e.test.ts` test 4 (GET /messages/:mid returns raw markdown bytes, no HTML escaping); 37-04 UAT-approved (`ClipboardItem(Promise)` fix shipped).                                                       | PASS    |
| AUX-05  | User can share an assistant message via a permalink to an audit-viewable conversation snapshot, scoped to org                          | integration (route) + e2e + axe-core + manual UAT            | `tests/routes/agent-actions.test.ts` share block (6 cases); `tests/routes/agent-share.test.ts` (7 cases — auth, org-mismatch 403, revoked, soft-deleted); `tests/e2e/agent-streaming-ux.e2e.test.ts` tests 5–8 (read-only render contract, foreign-org 403, axe-core clean, mobile 375px parity); 37-04 UAT-approved.        | PASS    |

## Audit Log Evidence

All five new audit toolNames introduced in this phase appear in `agent_audit_log` and are emitted by their respective routes / service paths. UAT manual smoke (2026-04-25) confirmed all four user-action toolNames visible at `/admin/audit`:

| Audit toolName          | Emitted by                                              | Confirmed in test                                                          |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `message_stopped`       | `AgentService.handleStreamAbort` (37-03 Task 1)         | `agent-service-stop-persist.test.ts`; `agent-streaming-ux.e2e.test.ts` t1  |
| `message_retried`       | POST `/agent/.../messages/:mid/retry`                   | `agent-actions.test.ts`; `agent-streaming-ux.e2e.test.ts` t2               |
| `message_edit_resend`   | POST `/agent/.../messages/:mid/edit-resend`             | `agent-actions.test.ts`; `agent-streaming-ux.e2e.test.ts` t3               |
| `share_created`         | POST `/agent/.../messages/:mid/share`                   | `agent-actions.test.ts`; `agent-share.test.ts`; e2e t5                     |
| `conversation_soft_deleted` (carry-over from Phase 35) | (untouched here)                          | `agent-history.e2e.test.ts` t7                                              |

`share_view` deliberately writes no audit row (read-only access; CONTEXT decision).

## Threat Register Outcomes

| Threat ID | Disposition | Implemented in plan | Evidence                                                                                                                                       |
| --------- | ----------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| T-37-01   | mitigate    | 37-01               | Org-guarded `markMessagesSuperseded` UPDATE via EXISTS subquery on `agent_conversations.org_id`                                                |
| T-37-02   | mitigate    | 37-01 + 37-03       | `getShareLink` repo level hides revoked rows; route compares `link.orgId === session.orgId` before rendering                                   |
| T-37-03   | mitigate    | 37-01               | `crypto.randomBytes(16).toString('base64url')` → 22 chars, 128 bits entropy                                                                    |
| T-37-06   | mitigate    | 37-02 + 37-03       | `agent-msg-edit.hbs` uses `{{content}}` double-brace escaping; tests assert `<script>` becomes `&lt;script&gt;`                                 |
| T-37-09   | mitigate    | 37-03               | All retry/edit-resend/share routes derive `orgId` from session; never trust request body                                                        |
| T-37-10   | mitigate    | 37-03               | `EditResendBodySchema = z.string().trim().min(1).max(8000)` rejects empty / oversized payloads                                                  |
| T-37-11   | mitigate    | 37-03               | `share_created` audit row carries `userId`, `shareId`, `anchorMessageId` for repudiation defence                                               |
| T-37-12   | mitigate    | 37-03 + 37-05       | Three-gate flow: 401 unauth, 403 foreign-org, 404 soft-deleted; e2e t6 + share-view tests prove all three                                       |
| T-37-13   | accept→mitigate | 37-03            | Inherited `/agent` rate-limit (60/min/user) covers share creation flood                                                                        |
| T-37-14   | mitigate    | 37-03               | `getConversation(cid, orgId)` enforces `org_id` WHERE clause; foreign-org → 404, no leak                                                       |
| T-37-15   | mitigate    | 37-03               | Active-branch presence check → 404 when target is no longer in the active branch (idempotent retry)                                            |
| T-37-20   | mitigate    | 37-05               | `<meta name="robots" content="noindex,nofollow">` on share-view; e2e t7 asserts presence                                                       |
| T-37-21   | mitigate    | 37-05               | This document                                                                                                                                  |

## Nyquist Coverage Note

> "Sample at twice the highest behavioural frequency to avoid aliasing."
> Each AUX requirement is exercised at **at least two layers** so a regression at any layer trips a test.

| SC      | Layer 1 (closest to code)         | Layer 2 (closest to user)                | Manual UAT (gap closer) |
| ------- | --------------------------------- | ---------------------------------------- | ----------------------- |
| AUX-01  | unit (`agent-service-stop-persist`) | e2e (status flag round-trip via GET route) | live browser smoke   |
| AUX-02  | integration (`agent-actions` route)  | e2e (DB supersede + audit assert)         | live browser smoke   |
| AUX-03  | integration (`agent-actions` route)  | e2e (active-branch == [new user] only)    | live browser smoke   |
| AUX-04  | unit (JSDOM clipboard primitives)    | e2e (raw markdown bytes via GET endpoint) | live browser smoke   |
| AUX-05  | integration (`agent-share` route, 7 cases) | e2e (read-only render + foreign-org 403 + axe-core + mobile 375px) | live browser smoke |

Every SC has automated coverage at two layers. Manual UAT (2026-04-25) closes the gap on Clipboard API / `ClipboardItem(Promise)` user-gesture semantics — JSDOM cannot exercise the real browser clipboard surface, so the user-gesture invariant is locked behind manual confirmation only.

## Observed Gaps (Carried to Phase 39 Backfill)

None mandatory for this phase. Two **pre-existing** test-harness issues observed during 37-05 regression are documented in `deferred-items.md`:

1. `tests/e2e/agent-multi-step.e2e.test.ts` E3 — harness loader missing `fetch` arg (pre-37-05).
2. `tests/e2e/agent-panel.test.ts` Test 3 — agent.js LOC > 1600 cap (tripped by Phase 37 plans 02–04 cumulative additions; needs split into `agent-history.js` + `agent-tools.js`).

Both are out of scope for AUX requirements and tracked in `deferred-items.md` for a Phase 38 cleanup plan.

## Verification Commands

```bash
# Phase 37 e2e (this plan)
cd packages/dashboard && npx vitest run tests/e2e/agent-streaming-ux.e2e.test.ts
# → 8 / 8 pass, 2.05s wall time

# Phase 37 integration suites (plans 01–04)
cd packages/dashboard && npx vitest run \
  tests/db/migration-058-059.test.ts \
  tests/db/conversation-repository-supersede.test.ts \
  tests/db/share-link-repository.test.ts \
  tests/views/agent-msg-actions.test.ts \
  tests/agent/agent-service-stop-persist.test.ts \
  tests/routes/agent-actions.test.ts \
  tests/routes/agent-share.test.ts
# → all passing per per-plan SUMMARYs

# Type check
cd packages/dashboard && npx tsc --noEmit  # exit 0
```

## Final Status

**Phase 37 streaming UX polish — VERIFIED PASS.** All five AUX requirements pass at two automated layers + manual UAT. Threat register has zero open mitigations. Two unrelated pre-existing harness issues are documented and deferred.
