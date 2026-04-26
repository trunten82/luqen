# Phase 39: Verification Backfill & Deferred-Items Triage - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 39 (interactive)

<domain>
## Phase Boundary

Every v3.0.0 phase has a formal verification record on file. v3.0.0 success criteria coverage is mapped. Every open deferred-items entry across v3.0.0 + v3.1.0 is closed, promoted into a follow-up plan, or knowingly carried to v3.2.0. This is a record-keeping + triage phase, not a feature phase.

Requirements: **VER-01, VER-02, VER-03**.

In-scope:
- Backfill VERIFICATION.md for Phase 30.1, 31.2, 32, 32.1, 33 (v3.0.0)
- Produce Nyquist coverage report for v3.0.0 success criteria
- Triage all deferred-items across v3.0.0 (31.2, 32) AND v3.1.0 (35, 36, 37, 38)
- Promote blocking items into a single decimal phase 39.1 for resolution

Out of scope (deferred):
- Live re-UAT of v3.0.0 surfaces (only sample re-test if needed for clarity)
- Project-wide coverage matrix (v2.x scope is closed)
- Backfilling VERIFICATION.md for phases earlier than 30.1
</domain>

<decisions>
## Implementation Decisions

### Triage policy (severity-based)
- **Promote to v3.1.0 (39.1):** BLOCKING bug, security issue, or any item that materially impedes user workflows.
- **Promote to v3.1.0 (39.1):** tech-debt or UX nicety that fits the current cycle's scope (e.g. agent.js LOC split — it's already at 2009 lines and exceeds the in-test cap).
- **Defer to v3.2.0:** tech-debt or UX nicety that's low-impact, speculative, or would expand the milestone.
- **Won't-fix:** documented duplicate, no-longer-relevant after a later phase, or explicitly contradicted by a v3.1.0 decision.

### Promotion target
- **Single decimal phase 39.1** ("Deferred-item resolution") collects all promoted items as tasks. Simpler tracking than multiple decimals; one VERIFICATION.md at the end. Use `/gsd-insert-phase` after 39 plans are written.

### VERIFICATION.md backfill format (lightweight evidence-pointer)
- Per-SC table per phase: `criterion | status (PASS/PARTIAL/UNVERIFIED) | evidence pointer`
- Evidence pointer: commit SHA, test file path, or "manual UAT 2026-MM-DD" reference into prior SUMMARY/conversation history.
- No live re-testing during backfill.
- **Gaps** section captures any SC that lands as PARTIAL/UNVERIFIED. Blocking gaps trigger an entry in 39.1; non-blocking gaps stay documented.

### Deferred-items source
- Walk **every** phase's `deferred-items.md` AND any `SUMMARY.md` "Deferred Issues" / "Items deferred to formal UAT" section.
- Project-wide scope: 31.2, 32, 35, 36, 37, 38 contributed entries. Don't miss inline-in-SUMMARY items.

### Nyquist coverage report scope
- **Every v3.0.0 SC** with full status table. Phase, SC index, SC text, test status (automated / manual UAT / untested), evidence pointer.
- "Tested" definition: has matching unit/integration/e2e test file OR documented UAT outcome in a SUMMARY/VERIFICATION.
- Project-wide coverage (v2.x) explicitly out of scope.

### Output artifacts
- `.planning/phases/30.1-mcp-oauth-scope-gate/30.1-VERIFICATION.md`
- `.planning/phases/31.2-mcp-access-control-refinement/31.2-VERIFICATION.md`
- `.planning/phases/32-agent-service-chat-ui/32-VERIFICATION.md`
- `.planning/phases/32.1-agent-chat-fixes/32.1-VERIFICATION.md`
- `.planning/phases/33-agent-context-hints/33-VERIFICATION.md`
- `.planning/phases/39-verification-backfill-deferred-items-triage/v3.0.0-NYQUIST.md`
- `.planning/phases/39-verification-backfill-deferred-items-triage/TRIAGE.md` (single triage decision log covering 31.2, 32, 35, 36, 37, 38)
- Decimal phase 39.1 created (if any items get promoted) via `/gsd-insert-phase`

### Claude's Discretion
- Exact column headers + ordering in the Nyquist report
- Whether triage decisions live in one consolidated TRIAGE.md or distinct per-phase files (planner picks)
- Inline gap-promotion vs end-of-phase batch promotion to 39.1
- Test file naming conventions for any 39.1 follow-ups
</decisions>

<canonical_refs>
## Canonical References

### v3.0.0 phases needing VERIFICATION.md backfill
- `.planning/phases/30.1-mcp-oauth-scope-gate/`
- `.planning/phases/31.2-mcp-access-control-refinement/`
- `.planning/phases/32-agent-service-chat-ui/`
- `.planning/phases/32.1-agent-chat-fixes/`
- `.planning/phases/33-agent-context-hints/`

### Deferred-items sources to walk
- `.planning/phases/31.2-mcp-access-control-refinement/deferred-items.md` (if present)
- `.planning/phases/32-agent-service-chat-ui/` SUMMARYs
- `.planning/phases/35-agent-conversation-history/` SUMMARYs
- `.planning/phases/36-multi-step-tool-use/` SUMMARYs
- `.planning/phases/37-streaming-ux-polish/deferred-items.md`
- `.planning/phases/38-multi-org-context-switching/` SUMMARYs

### Format references
- `.planning/phases/35-agent-conversation-history/35-VERIFICATION.md` (per-SC table format used in v3.1.0)
- `.planning/phases/36-multi-step-tool-use/36-VERIFICATION.md`
- `.planning/phases/37-streaming-ux-polish/37-VERIFICATION.md`

### Promoted items (already known going in)
- `agent.js` LOC split (2009 lines; e2e cap test red) → likely 39.1 task
- `agent-multi-step.e2e.test.ts` E3 harness loader bug → likely 39.1 task
- Pre-existing test failures discovered in 38 SUMMARYs (4 noted) → triage required
</canonical_refs>

<specifics>
## Specific Ideas

- Severity classification is the planner's first job: walk every entry, mark severity inline, then group by classification.
- TRIAGE.md should be one file with sections "Promoted to 39.1", "Deferred to v3.2.0", "Won't-fix" — each with rationale.
- 39.1 phase only created if at least one item is promoted. If everything classifies as defer/won't-fix, 39 stands alone.
- Nyquist report rows that are "untested" + classify as blocking flow into 39.1 alongside deferred-item promotions.
</specifics>

<deferred>
## Deferred Ideas

- Live re-UAT of v3.0.0 surfaces — beyond this phase's record-keeping intent.
- Project-wide coverage matrix (v2.x) — closed scope, not worth backfilling.
- Backfilling VERIFICATION.md for phases earlier than 30.1 — diminishing returns.
- Auto-generation of Nyquist reports from test annotations — tooling project, not v3.1.0.
</deferred>

---

*Phase: 39-verification-backfill-deferred-items-triage*
*Context gathered: 2026-04-25 via /gsd-discuss-phase*
