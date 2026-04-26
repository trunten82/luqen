---
phase: 39-verification-backfill-deferred-items-triage
plan: 02
subsystem: planning/triage
tags: [triage, deferred-items, ver-03, v3.0.0, v3.1.0]

requires:
  - "Plan 39-01 VERIFICATION.md backfill (Gaps sections from 31.2 + 32 routed deferred-items entries here)"
  - "39-CONTEXT.md `<decisions>` D-Triage severity policy"
  - "Source deferred-items.md files in 31.2, 32, 37 + inline 'Deferred Issues' sections in 32, 35, 38 SUMMARYs"
provides:
  - "Single consolidated TRIAGE.md decision log for every v3.0.0 + v3.1.0 deferred item"
  - "Per-item classification (Promote 39.1 / Defer v3.2.0 / Won't-fix) with rationale citing the severity rule"
  - "Task-seed list ready for `/gsd-insert-phase 39.1`"
affects:
  - "Decision on whether Phase 39.1 is required (yes — 6 items promoted)"
  - "v3.2.0 backlog (2 items deferred)"

tech-stack:
  added: []
  patterns:
    - "Severity-based triage with explicit duplicate / closed-by-cycle / by-plan-design carve-outs"
    - "Source-pointer-per-row so reviewers can audit every classification"

key-files:
  created:
    - .planning/phases/39-verification-backfill-deferred-items-triage/TRIAGE.md
  modified: []

decisions:
  - "Used a single consolidated TRIAGE.md (per Claude's-discretion option in 39-CONTEXT D-Triage) rather than per-phase triage files — easier to spot duplicates across phases (4 of the 18 inventory rows are cross-phase duplicates)"
  - "Pre-known items from 39-02-PLAN <autonomous_mode> (agent.js LOC split, agent-multi-step E3 harness, Phase 38 4 pre-existing failures) all classified per the severity rule; agent.js LOC and E3 harness landed in Promote-to-39.1 as expected; the Phase 38 four-failure rollup decomposed into 1 promote + 3 duplicates"
  - "Old 35-05 agent.js LOC tech-debt entry (DI-35-01) classified Won't-fix as duplicate of DI-37-02 — same concern but DI-37-02 has the current LOC value (2210) and concrete split-plan"
  - "agent.js LOC verified by `wc -l packages/dashboard/src/static/agent.js` = 2210 at 2026-04-25 (up from 2009 at 37-05 close); Plan 38 added 201 more LOC (org-switch handler + autoSwitchOrgIfNeeded + init snapshot)"

requirements:
  - VER-03

metrics:
  completed_date: 2026-04-25
  total_items_inventoried: 18
  promoted_to_39_1: 6
  deferred_to_v3_2_0: 2
  wont_fix: 10
---

# Phase 39 Plan 02 Summary — Deferred-Items Triage

Consolidated triage of every `deferred-items.md` entry and every inline
"Deferred Issues" / "Known Stubs" / "Known Tech Debt" / "Pre-existing
test failures" section across v3.0.0 phases 31.2 + 32 and v3.1.0 phases
35, 36, 37, 38. Output is a single `TRIAGE.md` decision log with
per-item classification (Promote to 39.1 / Defer to v3.2.0 / Won't-fix)
and rationale citing the D-Triage severity rule from 39-CONTEXT.md.

## Total items inventoried: 18

### Counts per classification

| Classification | Count | % |
|----------------|-------|---|
| Promote to 39.1 | 6 | 33% |
| Defer to v3.2.0 | 2 | 11% |
| Won't-fix       | 10 | 56% |
| **Total**       | **18** | **100%** |

The Won't-fix bucket is large because the cycle ran long enough that
many in-flight deferred items were closed by later plans (35-04/05/06
hydration, 37-03/04 wiring, 38-04 server.ts wiring) or were
cross-phase duplicates of the same canonical pre-existing failure
(auth-flow returnTo cited in 31.2 + 32; agent.js LOC cited in 35-05
+ 37; migration-059 cited in 38-01 + 38-02 + 38-03; agent-multi-step
E3 cited in 37 + 38-03).

## Source coverage

| Source | Inventory rows |
|--------|----------------|
| `milestones/v3.0.0-phases/31.2-mcp-access-control-refinement/deferred-items.md` | 2 |
| `milestones/v3.0.0-phases/31.2-mcp-access-control-refinement/31.2-04-SUMMARY.md` (SMOKE-CHECKLIST delta) | 1 |
| `milestones/v3.0.0-phases/32-agent-service-chat-ui/deferred-items.md` | 4 (8-failure rollup decomposed by suite) |
| `milestones/v3.0.0-phases/32-agent-service-chat-ui/32-{03,05,06,08}-SUMMARY.md` "Deferred Issues" sections | 3 |
| `phases/35-agent-conversation-history/35-05-SUMMARY.md` "Known Tech Debt" | 1 |
| `phases/36-multi-step-tool-use/` (all 6 SUMMARYs) | 0 — explicitly checked, no deferred entries |
| `phases/37-streaming-ux-polish/deferred-items.md` | 2 |
| `phases/37-streaming-ux-polish/37-02-SUMMARY.md` "Known Stubs" | 1 |
| `phases/38-multi-org-context-switching/38-{01,02,03}-SUMMARY.md` "Deferred Issues" + "Known Stubs" | 4 |

Phase 36's six SUMMARYs were grepped for `Deferred|Follow-up|Known.*[Ll]imitation|TODO|Tech [Dd]ebt|Pre-existing|Stub|Issue` — only one hit (`36-01-SUMMARY` line 51 referencing pre-existing rows in DB context, not a deferred item) and no "## Deferred" sections. Phase 36 contributed zero deferred items.

## Phase 39.1 recommended: YES

6 items classified "Promote to 39.1" → run `/gsd-insert-phase 39.1` to
create the resolution phase.

## Items promoted to 39.1 (full scope)

| ID | Title | One-line scope |
|----|-------|----------------|
| DI-31.2-01 | `auth-flow-e2e.test.ts` returnTo assertions | Update 2 redirect assertions to match `/login?returnTo=…` (Phase 31.1 commit `4337c8d`). |
| DI-32-01..03 | mcp tool-list scope-filter test expectations | Update test fixture scopes across `data-tools.test.ts` (2), `admin-tools.test.ts` (3), `http.test.ts` (1) — 6 failures, same root cause: tests use `scopes:['read']` but post-Phase-30 scope-filter requires write-tier. |
| DI-37-01 | `agent-multi-step.e2e.test.ts` E3 fetch loader | One-line harness fix — add `'fetch'` to IIFE loader signature at `agent-multi-step.e2e.test.ts:165`, match `agent-history.e2e.test.ts:262`. |
| DI-37-02 | Split `agent.js` (2210 LOC) into 4 modules | Lift-and-shift split: `agent-history.js` + `agent-tools.js` + `agent-actions.js` + `agent-org.js`; restore `agent-panel.test.ts` Test 3 to passing budget across all 5 files. |
| DI-38-01 | `migration-058-059.test.ts` migration 059 column-list | Add `expires_at` to the column-list assertion (Phase 37 migration 060 added the column). |
| DI-38-02 (b) | `agent-actions-handlers.test.ts > 12. shareAssistant` | Update test mock to handle Phase 37 `ClipboardItem(Promise)` async-clipboard pattern. |

Suggested 39.1 plan structure:

- **39.1-01** (small) — Bundle DI-31.2-01 + DI-32-01..03 + DI-37-01 + DI-38-01 + DI-38-02(b) into a single test-staleness sweep plan. All are one- or few-line fixes; verify by running each suite, then full regression green.
- **39.1-02** (structural) — Dedicated plan for DI-37-02 (agent.js split). TDD module-by-module extraction with the LOC ceiling test as the gate. This is the only structural change in 39.1.

## Items deferred to v3.2.0

| ID | Title | Why deferred |
|----|-------|--------------|
| DI-31.2-03 | SMOKE-CHECKLIST.md Step 9 wording | Documentation polish; non-load-bearing per 31.2-04 SUMMARY. |
| DI-32-05  | Playwright + axe-core a11y gate    | Test-infra project (new toolchain + CI runner + baselines); already listed in 39-CONTEXT `<deferred>` as a v3.2.0+ tooling project. |

## Won't-fix items (10) — summary by reason

- **Documented duplicates (4):** DI-32-04 (= DI-31.2-01), DI-32-07 (= DI-32-01..04 rollup), DI-38-02 sub-items a/c/d (= DI-38-01 + DI-37-01 + DI-37-02), DI-38-04 (= DI-38-01 + by-design stubs).
- **Closed-in-flight by a later plan (6):** DI-31.2-02 (resolved by 31.2-02 authorize.ts rewrite), DI-32-06 (resolved by 35-04/05/06 + 37 fragment-renderer rewrite), DI-37-03 (resolved by 37-03 + 37-04), DI-38-03 (resolved by 38-04), DI-35-01 (superseded by DI-37-02 with current LOC), and DI-38-04 sub-item b (resolved by 38-04 client wiring).

## Deviations from Plan

None. Plan tasks executed exactly as written. The plan's pre-known-items
expectation (agent.js LOC split + agent-multi-step E3 harness loader
both classified Promote to 39.1; Phase 38 four-failure rollup
per-item-triaged) was honoured — DI-37-02 and DI-37-01 are in Promote;
the 38 rollup decomposed into 1 promote (DI-38-01) + 3 duplicates.

## Threat Surface Scan

None — this plan produces a triage decision log only; no code, no
network endpoints, no auth paths, no schema changes, no trust boundary
modifications.

## Known Stubs

None — TRIAGE.md is fully classified, every inventory row carries a
classification + rationale, the frontmatter counts match the section
contents (6+2+10=18), and the Follow-up Action section explicitly
recommends `/gsd-insert-phase 39.1`.

## Self-Check: PASSED

- File `.planning/phases/39-verification-backfill-deferred-items-triage/TRIAGE.md` — FOUND (233 lines)
- Section `## Inventory` — FOUND
- Section `## Classifications` — FOUND
- Section `## Promoted to 39.1` — FOUND
- Section `## Deferred to v3.2.0` — FOUND
- Section `## Won't-Fix` — FOUND
- Section `## Follow-up Action` — FOUND
- Frontmatter `promote_to_39_1: 6` — FOUND
- DI ids matching `DI-(31\.2|32|35|36|37|38)-` — FOUND (every source phase represented or explicitly noted as zero-contributing for 36)
- Placeholder `(Filled by Task 2)` text — NOT FOUND (clean)
- Sum of classified items = inventory total: 6 + 2 + 10 = 18 ✓
- Pre-known items received expected classification: DI-37-02 (agent.js LOC) → Promote to 39.1 ✓; DI-37-01 (E3 harness) → Promote to 39.1 ✓; Phase 38 4 pre-existing → 1 promote + 3 dups (per-item triaged as plan specified) ✓

No git commits — `.planning/` is gitignored per executor prompt
`<notes>`; TRIAGE.md and 39-02-SUMMARY.md are local-only record-keeping
artefacts. STATE.md and ROADMAP.md NOT modified per executor prompt's
explicit instruction.

---

*Phase 39 Plan 02 completed 2026-04-25 — VER-03 closed. 6 items promoted; phase 39.1 required.*
