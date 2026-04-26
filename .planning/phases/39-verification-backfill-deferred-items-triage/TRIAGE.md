---
phase: 39-verification-backfill-deferred-items-triage
plan: 02
created: 2026-04-25T00:00:00Z
total_items: 18
classifications:
  promote_to_39_1: 6
  defer_to_v3_2_0: 2
  wont_fix: 10
---

# TRIAGE.md — Deferred-Items Decision Log

Consolidated triage of every `deferred-items.md` entry and every inline
"Deferred Issues" / "Known Stubs" / "Known Tech Debt" / "Issues
Encountered" / "Follow-up" / "Pre-existing test failures" section across
v3.0.0 (31.2, 32) and v3.1.0 (35, 36, 37, 38) phase summaries.

Severity policy applied verbatim from `39-CONTEXT.md` `<decisions>`
D-Triage block:

- **Promote to 39.1** = BLOCKING / security / materially impedes user
  workflows / tech-debt or UX nicety that fits current cycle
- **Defer to v3.2.0** = low-impact, speculative, or would expand the
  milestone
- **Won't-fix** = duplicate, no-longer-relevant, or contradicted by a
  v3.1.0 decision

Source coverage check (every location in plan `<source_locations>`
walked):

| Source | Inventory rows |
|--------|----------------|
| `milestones/v3.0.0-phases/31.2-mcp-access-control-refinement/deferred-items.md` | 2 |
| `milestones/v3.0.0-phases/31.2-mcp-access-control-refinement/31.2-*-SUMMARY.md` | 1 |
| `milestones/v3.0.0-phases/32-agent-service-chat-ui/deferred-items.md` | 1 (8-failure rollup) |
| `milestones/v3.0.0-phases/32-agent-service-chat-ui/32-*-SUMMARY.md` | 4 (some duplicates) |
| `phases/35-agent-conversation-history/35-*-SUMMARY.md` | 1 |
| `phases/36-multi-step-tool-use/36-*-SUMMARY.md` | 0 — no deferred items found |
| `phases/37-streaming-ux-polish/deferred-items.md` | 2 |
| `phases/37-streaming-ux-polish/37-*-SUMMARY.md` | 1 (by-design stub note, no follow-up needed) |
| `phases/38-multi-org-context-switching/38-*-SUMMARY.md` | 6 (most are duplicate references to the same 4 pre-existing failures) |

## Inventory

| ID | Source | Summary | Severity hint |
|----|--------|---------|---------------|
| DI-31.2-01 | `milestones/v3.0.0-phases/31.2-mcp-access-control-refinement/deferred-items.md` L14-24 | `tests/e2e/auth-flow-e2e.test.ts` 2 failures — assertions expect bare `/login`, middleware now emits `/login?returnTo=…` (Phase 31.1 commit 4337c8d). | Pre-existing test-staleness; not introduced by 31.2. |
| DI-31.2-02 | `milestones/v3.0.0-phases/31.2-mcp-access-control-refinement/deferred-items.md` L26-31 | `tests/routes/oauth/authorize.test.ts` — flagged on entry but RESOLVED in-flight by Plan 31.2-02's authorize.ts rewrite. | Already-closed during cycle; documented duplicate-in-time. |
| DI-31.2-03 | `milestones/v3.0.0-phases/31.2-mcp-access-control-refinement/31.2-04-SUMMARY.md` §"SMOKE-CHECKLIST.md delta" L107 | SMOKE-CHECKLIST.md Step 9 copy update deferred — wording for "admin revoke kills session" should reflect immediate revocation (not "~1h"). | Documentation polish; non-load-bearing. |
| DI-32-01 | `milestones/v3.0.0-phases/32-agent-service-chat-ui/deferred-items.md` L4-7 | `tests/mcp/data-tools.test.ts` 2 failures — scope-filter requires write tier; tests use `scopes:['read']`. Tests stale vs current rules. | Pre-existing test-staleness; needs scope-expectation update. |
| DI-32-02 | `milestones/v3.0.0-phases/32-agent-service-chat-ui/deferred-items.md` L5 | `tests/mcp/admin-tools.test.ts` 3 failures — same scope-filter root cause as DI-32-01. | Pre-existing test-staleness; same root cause. |
| DI-32-03 | `milestones/v3.0.0-phases/32-agent-service-chat-ui/deferred-items.md` L7 | `tests/mcp/http.test.ts` 1 failure — same scope-filter root cause as DI-32-01. | Pre-existing test-staleness; same root cause. |
| DI-32-04 | `milestones/v3.0.0-phases/32-agent-service-chat-ui/deferred-items.md` L11 | `tests/e2e/auth-flow-e2e.test.ts` 2 failures — same as DI-31.2-01 (returnTo redirect); duplicate sourcing. | Duplicate of DI-31.2-01. |
| DI-32-05 | `milestones/v3.0.0-phases/32-agent-service-chat-ui/32-06-SUMMARY.md` §"Deferred Issues" L136 | Playwright + axe-core accessibility gate not yet wired — 3 `test.todo` markers in `agent-panel.test.ts`. | UX/test-infra gate; speculative scope. |
| DI-32-06 | `milestones/v3.0.0-phases/32-agent-service-chat-ui/32-06-SUMMARY.md` §"Deferred Issues" L137 | `POST /agent/message` response markup is a flat `escapeHtml`'d span instead of full `agent-message` partial render. | Cohesion debt; would touch Plan 04 acceptance tests. |
| DI-32-07 | `milestones/v3.0.0-phases/32-agent-service-chat-ui/32-06-SUMMARY.md` §"Deferred Issues" L138 + `32-08-SUMMARY.md` §"Deferred Issues" L153-160 | The 8-failure rollup re-cited in plan SUMMARYs (mcp scope-filter + auth-flow returnTo). | Duplicate of DI-32-01..04. |
| DI-35-01 | `phases/35-agent-conversation-history/35-05-SUMMARY.md` §"Known Tech Debt" L395-403 | `agent.js` reached 1349 LOC (ceiling raised to 1400) — next file-touching agent-drawer plan must split history-panel logic into `agent-history.js` and lower the ceiling toward ≤750. | Tech-debt; explicit signal to next plan. SUPERSEDED by current state — agent.js is now 2210 LOC at 2026-04-25, breaking `agent-panel.test.ts` Test 3. |
| DI-37-01 | `phases/37-streaming-ux-polish/deferred-items.md` L8-12 | `tests/e2e/agent-multi-step.e2e.test.ts` E3 — `fetch is not defined`. Harness IIFE loader signature missing `fetch` arg (one-line fix patterning agent-history.e2e.test.ts:262). | Pre-existing; broken test; one-line fix. |
| DI-37-02 | `phases/37-streaming-ux-polish/deferred-items.md` L14-19 | `tests/e2e/agent-panel.test.ts` Test 3 — `agent.js` LOC budget (≤1600) exceeded; current 2009 LOC at 37-05. Inline note mandates split into `agent-history.js` + `agent-tools.js` + `agent.js`. | Tech-debt; in-test cap red; impedes CI. |
| DI-37-03 | `phases/37-streaming-ux-polish/37-02-SUMMARY.md` §"Known Stubs" L177 | `data-action` no-op buttons + `isMostRecentUserMessage` undefined in 37-02. | By-plan-design; resolved by Plan 37-03 + 37-04. |
| DI-38-01 | `phases/38-multi-org-context-switching/38-01-SUMMARY.md` §"Deferred Issues" L143-154 | `tests/db/migration-058-059.test.ts` migration 059 — column-list assertion stale; migration 060 (Phase 37) added `expires_at` to `agent_share_links` but the 058-059 column-list assertion was never updated. | Pre-existing test-staleness; one-line fix. |
| DI-38-02 | `phases/38-multi-org-context-switching/38-03-SUMMARY.md` §"Deferred Issues" L227-242 | 4 pre-existing failures rolled up at 38-03: (a) `migration-058-059.test.ts` 059 [= DI-38-01]; (b) `tests/static/agent-actions-handlers.test.ts > 12. shareAssistant`; (c) `tests/e2e/agent-multi-step.e2e.test.ts > E3` [= DI-37-01]; (d) `tests/e2e/agent-panel.test.ts > Test 3` [= DI-37-02]. | Mixed: includes one new pre-existing failure (b) + 3 dups. |
| DI-38-03 | `phases/38-multi-org-context-switching/38-03-SUMMARY.md` §"Deferred Issues" L244-251 + §"Known Stubs" L278-285 | server.ts view-data preHandler not yet wired to `buildDrawerOrgContext` — drawer renders `showOrgSwitcher` undefined; mechanical wiring deferred to Plan 38-04. | By-plan-design; resolved by Plan 38-04. |
| DI-38-04 | `phases/38-multi-org-context-switching/38-02-SUMMARY.md` §"Deferred Issues" L187-193 + §"Known Stubs" L215-222 | (a) Migration-058-059 dup of DI-38-01; (b) `data-action="agentOrgSwitch"` hook + `<output data-role="orgToast">` are intentionally unwired in 38-02, by-plan-design (resolved by 38-04). | Duplicate / by-plan-design (resolved). |

## Classifications

| ID | Classification | Rationale |
|----|----------------|-----------|
| DI-31.2-01 | Promote to 39.1 | Pre-existing test-staleness blocking CI green; one-line fix; fits current cycle scope per D-Triage Promote bullet 4 (tech-debt that fits the cycle). Same suite is referenced in Phase 38 deferred lists — this is the canonical entry. |
| DI-31.2-02 | Won't-fix | Already resolved in-flight by Plan 31.2-02's authorize.ts rewrite (commit 68a4b4d) — documented as no-longer-relevant per D-Triage Won't-fix bullet 2. |
| DI-31.2-03 | Defer to v3.2.0 | SMOKE-CHECKLIST.md copy polish — low-impact documentation tweak; explicitly self-marked "not load-bearing"; expanding 39.1 to include doc cleanup speculative per D-Triage Defer rule. |
| DI-32-01 | Promote to 39.1 | Pre-existing test-staleness blocking CI green. The fix (update test scope expectations to match real read/write tier rules) fits current cycle scope per D-Triage Promote bullet 4. |
| DI-32-02 | Promote to 39.1 | Same root cause as DI-32-01 (admin-tools subset of the same scope-filter expectation drift); fix lands together. Promote bullet 4. |
| DI-32-03 | Promote to 39.1 | Same root cause as DI-32-01 (mcp/http subset); fix lands together. Promote bullet 4. |
| DI-32-04 | Won't-fix | Documented duplicate of DI-31.2-01 (same 2 auth-flow tests, identical root cause); canonical entry is DI-31.2-01 per D-Triage Won't-fix bullet 1. |
| DI-32-05 | Defer to v3.2.0 | Playwright + axe-core integration is a test-infra project, not a v3.1.0 deliverable — speculative and would expand the milestone per D-Triage Defer rule. Already deferred in 39-CONTEXT.md `<deferred>`. |
| DI-32-06 | Won't-fix | Closed-by-cycle: Phase 32-04 acceptance tests intentionally lock the flat-span shape; the Phase 35-04/05/06 history hydration + Phase 37 action-rows render full bubbles via `renderAgentMessagesFragment`, which is the canonical render path post-32. The 32-06 cohesion concern is no-longer-relevant after Phase 35+37 shipped. D-Triage Won't-fix bullet 2. |
| DI-32-07 | Won't-fix | Documented duplicate of DI-32-01..04 (the 8-failure rollup re-cited in Plan summaries). D-Triage Won't-fix bullet 1. |
| DI-35-01 | Won't-fix | Superseded by DI-37-02 (same `agent.js` LOC concern, but with a current-state value of 2210 LOC and a more concrete split-plan: `agent-history.js` + `agent-tools.js` + `agent-actions.js` + `agent-org.js`). Canonical entry is DI-37-02. D-Triage Won't-fix bullet 1. |
| DI-37-01 | Promote to 39.1 | Pre-known going in (39-02-PLAN `<autonomous_mode>` and 39-CONTEXT `<canonical_refs>`). Test is broken in current cycle (`fetch is not defined` blocks E3); one-line harness fix. D-Triage Promote bullet 4 (tech-debt that fits current cycle). |
| DI-37-02 | Promote to 39.1 | Pre-known going in (39-02-PLAN `<autonomous_mode>` and 39-CONTEXT `<canonical_refs>`). `agent.js` is 2210 LOC at 2026-04-25, exceeds the 1600 LOC cap, and `agent-panel.test.ts` Test 3 is red. Materially impedes any further work on the agent drawer subsystem. D-Triage Promote bullets 3 + 4. |
| DI-37-03 | Won't-fix | By-plan-design stub — explicitly resolved by Plans 37-03 (`isMostRecentUserMessage` flag in fragment renderer) and 37-04 (delegated `data-action` listeners). D-Triage Won't-fix bullet 2 (no-longer-relevant after a later phase shipped). |
| DI-38-01 | Promote to 39.1 | Pre-existing test-staleness blocking CI green (migration 059 column-list assertion stale post-migration 060). One-line fix. D-Triage Promote bullet 4. |
| DI-38-02 | Promote to 39.1 | Sub-item (b) — `tests/static/agent-actions-handlers.test.ts > 12. shareAssistant` — is a NEW pre-existing failure not covered by other entries; lift it into 39.1 alongside the other test-staleness fixes. Sub-items (a)/(c)/(d) are duplicates of DI-38-01/DI-37-01/DI-37-02. D-Triage Promote bullet 4 for the new sub-item. |
| DI-38-03 | Won't-fix | By-plan-design — server.ts view-data wiring resolved by Plan 38-04 (delegated `agentOrgSwitch` change handler + `autoSwitchOrgIfNeeded` + init snapshot, per 38-04-SUMMARY.md L17, L51). D-Triage Won't-fix bullet 2. |
| DI-38-04 | Won't-fix | Duplicate of DI-38-01 (sub-item a) and by-plan-design stubs resolved by Plan 38-04 (sub-item b). D-Triage Won't-fix bullets 1 + 2. |

Sum check: 6 promote + 2 defer + 10 won't-fix = 18 = total inventory rows. ✓

## Promoted to 39.1

These items will become tasks in Phase 39.1 (created via
`/gsd-insert-phase 39.1` after this plan completes). All are pre-existing
failures or tech-debt that fit the current cycle's scope.

### DI-31.2-01: Update auth-flow-e2e.test.ts to expect returnTo query string

- **Source:** `milestones/v3.0.0-phases/31.2-mcp-access-control-refinement/deferred-items.md` L14-24
- **Summary:** `tests/e2e/auth-flow-e2e.test.ts` has 2 failures: `GET /home without auth redirects to /login` and `session is invalid after logout`. Both expect bare `/login` redirect target but auth middleware now emits `/login?returnTo=%2Fhome` after Phase 31.1 commit `4337c8d` ("thread returnTo through login partials + already-auth shortcut").
- **Rationale:** Promote bullet 4 — pre-existing test-staleness blocking CI green; fits cycle scope.
- **Suggested 39.1 task scope:** Update both assertions in `auth-flow-e2e.test.ts` to match `'/login?returnTo=%2Fhome'` (or to a regex that allows query-string suffix); verify suite green.

### DI-32-01..03: Fix mcp tool-list scope-filter test expectations

- **Source:** `milestones/v3.0.0-phases/32-agent-service-chat-ui/deferred-items.md` L4-7
- **Summary:** 6 failures across `tests/mcp/data-tools.test.ts` (2), `tests/mcp/admin-tools.test.ts` (3), `tests/mcp/http.test.ts` (1). Tests use `scopes:['read']` but post-Phase-30 scope-filter requires write-tier for `.create` permissions and admin tools. Tests are stale; implementation correct. Fold all three suites into one task — same root cause.
- **Rationale:** Promote bullet 4 — pre-existing test-staleness; same fix touches all three suites.
- **Suggested 39.1 task scope:** Update test fixture scopes to include the write-tier scope for tools that require it (e.g. `scopes:['read','write']` or `['mcp.use','admin.users']` matching production semantics); document the read/write tier mapping in a comment so future tests don't re-hit the same drift.

### DI-37-01: Fix agent-multi-step.e2e.test.ts E3 harness fetch loader

- **Source:** `phases/37-streaming-ux-polish/deferred-items.md` L8-12
- **Summary:** `tests/e2e/agent-multi-step.e2e.test.ts:165` IIFE loader signature is `('window','document','localStorage', AGENT_JS)` — missing `'fetch'` parameter. Throws `ReferenceError: fetch is not defined` after chip-strip stream completes. Pattern to match: `agent-history.e2e.test.ts:262`.
- **Rationale:** Promote bullet 4 — pre-known going in (39-02-PLAN `<autonomous_mode>`); broken test in current cycle; one-line fix.
- **Suggested 39.1 task scope:** Add `'fetch'` parameter to the loader signature and pass `(win as any).fetch` as the fourth call argument. Verify E3 green and no regressions in adjacent E1/E2/E4 cases.

### DI-37-02: Split agent.js (2210 LOC) into per-feature modules

- **Source:** `phases/37-streaming-ux-polish/deferred-items.md` L14-19; current state verified by `wc -l packages/dashboard/src/static/agent.js` = 2210 at 2026-04-25
- **Summary:** `agent.js` exceeds the 1600-LOC cap enforced by `tests/e2e/agent-panel.test.ts` Test 3. Plan documents the split into `agent-history.js` + `agent-tools.js` + `agent.js`. Per 39-02-PLAN `<autonomous_mode>`, the target split is now `agent-history.js` + `agent-tools.js` + `agent-actions.js` + `agent-org.js` (reflecting Phase 37 + 38 additions).
- **Rationale:** Promote bullets 3 + 4 — pre-known going in (39-CONTEXT `<canonical_refs>`); cap test red blocks CI; tech-debt fits current cycle. Materially impedes further agent-drawer work because every plan now has to bump or work around the cap.
- **Suggested 39.1 task scope:** Lift-and-shift split into 4 modules per the 39-02-PLAN target: history-panel logic → `agent-history.js` (existing handoff points: every fn prefixed `history*` per 35-05 SUMMARY); tool/chip-strip logic → `agent-tools.js`; action-row + edit/copy/share/retry → `agent-actions.js`; org-switcher + auto-switch → `agent-org.js`. Lower the LOC ceiling per module (target ≤750 each per 35-05 signal). Restore `agent-panel.test.ts` Test 3 to a passing budget across all 5 files.

### DI-38-01: Update migration-058-059.test.ts for migration 060 expires_at column

- **Source:** `phases/38-multi-org-context-switching/38-01-SUMMARY.md` §"Deferred Issues" L143-154
- **Summary:** `tests/db/migration-058-059.test.ts > migration 059 — agent-share-links > creates agent_share_links table with the expected columns` fails because Phase 37 migration 060 added `expires_at` to `agent_share_links` but the column-list assertion in the 058-059 test was never updated.
- **Rationale:** Promote bullet 4 — pre-existing test-staleness; one-line fix; CI red.
- **Suggested 39.1 task scope:** Update the column-list assertion to include `expires_at`; verify migration-058-059 green and no regressions in `migration-060.test.ts`.

### DI-38-02 (sub-item b only): Fix agent-actions-handlers.test.ts shareAssistant case

- **Source:** `phases/38-multi-org-context-switching/38-03-SUMMARY.md` §"Deferred Issues" L227-242 sub-item (b)
- **Summary:** `tests/static/agent-actions-handlers.test.ts > 12. shareAssistant` fails on master pre-Phase-38-03 (verified at commit `98e266f`). Likely caused by the Phase 37 ClipboardItem(Promise) refactor (commit `78d0930`) — the test mock probably doesn't simulate the async-clipboard pattern correctly.
- **Rationale:** Promote bullet 4 — pre-existing test failure; CI red; sits adjacent to the other test-staleness fixes.
- **Suggested 39.1 task scope:** Reproduce the failure (`npx vitest run tests/static/agent-actions-handlers.test.ts -t "shareAssistant"`); update mock to provide `ClipboardItem` constructor + Promise-accepting `clipboard.write`; verify green.

## Deferred to v3.2.0

These items are low-impact or speculative and would expand the v3.1.0
milestone if pulled into 39.1.

### DI-31.2-03: SMOKE-CHECKLIST.md Step 9 wording update

- **Source:** `milestones/v3.0.0-phases/31.2-mcp-access-control-refinement/31.2-04-SUMMARY.md` §"SMOKE-CHECKLIST.md delta" L107
- **Summary:** Step 9 previously said "within ~1h access-token TTL"; new behaviour is "immediately on next tool call" via D-20 middleware revoke check. Copy update to SMOKE-CHECKLIST.md not yet applied.
- **Rationale:** Defer — explicitly self-marked "not load-bearing"; pure documentation polish; expanding 39.1 to include archive-doc cleanup is speculative.
- **Note for v3.2.0:** Roll into next MCP/RBAC docs sweep.

### DI-32-05: Playwright + axe-core accessibility gate

- **Source:** `milestones/v3.0.0-phases/32-agent-service-chat-ui/32-06-SUMMARY.md` §"Deferred Issues" L136
- **Summary:** 3 `test.todo` markers in `agent-panel.test.ts` cover Playwright + axe-core a11y assertions for the chat drawer. Currently the drawer is verified via vitest + Fastify smoke spec only (no real browser axe scan).
- **Rationale:** Defer — already explicitly listed under 39-CONTEXT.md `<deferred>` ("Auto-generation of Nyquist reports from test annotations — tooling project, not v3.1.0"). Adding Playwright+axe is a test-infra project: new toolchain, CI runner, baseline screenshots. Speculative scope expansion per D-Triage Defer rule.
- **Note for v3.2.0:** Treat as a dedicated test-infra phase; pair with project-wide a11y baseline run.

## Won't-Fix

These items are documented duplicates, no-longer-relevant after a later
phase shipped, or contradicted by a v3.1.0 decision.

### DI-31.2-02 — `tests/routes/oauth/authorize.test.ts`

Already RESOLVED by Plan 31.2-02's `authorize.ts` rewrite (commit
`68a4b4d`) per the deferred-items.md note itself. No-longer-relevant.

### DI-32-04 — `auth-flow-e2e.test.ts` 2 failures (re-cited in 32 deferred-items)

Documented duplicate of DI-31.2-01 (same 2 tests, same root cause).
Canonical entry: DI-31.2-01.

### DI-32-06 — flat agent-message span on `POST /agent/message`

Closed-by-cycle. Phase 35-04/05/06 history hydration and Phase 37
action-rows now render full bubbles via `renderAgentMessagesFragment`,
which is the canonical render path. The 32-06 cohesion concern was
predicated on Plan 04's flat-span shape being the only render — that is
no longer the case.

### DI-32-07 — 8-failure rollup re-cited in 32-08 SUMMARY

Documented duplicate of DI-32-01..04. Canonical entries are DI-32-01,
DI-32-02, DI-32-03, DI-31.2-01.

### DI-35-01 — agent.js LOC tech debt at 1349 LOC, ceiling 1400

Superseded by DI-37-02 — same concern, current state is 2210 LOC with a
more concrete split-plan and an actively-failing cap test. Fold all
follow-up into the 39.1 work for DI-37-02.

### DI-37-03 — by-design stubs in 37-02 (data-action no-ops, isMostRecentUserMessage undefined)

By-plan-design — explicitly resolved by Plans 37-03 (`isMostRecentUserMessage`
flag in fragment renderer) and 37-04 (delegated `data-action` listeners
for retryAssistant / copyAssistant / shareAssistant / editUserMessage /
submitEditUserMessage / cancelEditUserMessage). No-longer-relevant.

### DI-38-02 sub-items (a), (c), (d)

Documented duplicates of DI-38-01, DI-37-01, DI-37-02 respectively.
Canonical entries handle the fix.

### DI-38-03 — server.ts view-data wiring deferred at 38-03

By-plan-design — resolved by Plan 38-04 (delegated `agentOrgSwitch`
change handler + `autoSwitchOrgIfNeeded` + init snapshot, per
38-04-SUMMARY.md L17, L51). No-longer-relevant.

### DI-38-04 — duplicate / by-design stubs in 38-02

Sub-item (a) is duplicate of DI-38-01. Sub-item (b) (`data-action="agentOrgSwitch"`
+ `<output data-role="orgToast">` unwired stubs) is by-plan-design and
resolved by Plan 38-04.

## Follow-up Action

**6 items promoted to 39.1.** Run `/gsd-insert-phase 39.1` to create the
"Deferred-item resolution" decimal phase. Seed tasks from the "Promoted
to 39.1" section above:

1. **39.1-01** — Update `auth-flow-e2e.test.ts` returnTo assertions (DI-31.2-01)
2. **39.1-02** — Fix mcp tool-list scope-filter test expectations (DI-32-01..03)
3. **39.1-03** — Fix `agent-multi-step.e2e.test.ts` E3 fetch loader (DI-37-01)
4. **39.1-04** — Split `agent.js` (2210 LOC) into 4 modules (DI-37-02) — largest task; consider this its own plan
5. **39.1-05** — Update `migration-058-059.test.ts` for `expires_at` column (DI-38-01)
6. **39.1-06** — Fix `agent-actions-handlers.test.ts` shareAssistant case (DI-38-02 sub-item b)

Suggested ordering: 39.1-01..03 + 39.1-05..06 are all small one-task fixes
and can land in a single plan (or paired plans). 39.1-04 (agent.js split)
is structural and warrants its own dedicated plan with TDD module-by-module
extraction.
