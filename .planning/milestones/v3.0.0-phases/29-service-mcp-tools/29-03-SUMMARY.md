---
phase: 29-service-mcp-tools
plan: 03
subsystem: docs
tags:
  - docs
  - traceability
  - requirements
  - roadmap
  - rescope

# Dependency graph
requires:
  - phase: 29-service-mcp-tools
    provides: "Plan 01 outcome (branding MCP delivered MCPT-02 partial)"
  - phase: 29-service-mcp-tools
    provides: "Plan 02 outcome (LLM MCP delivered MCPT-03 + discover_branding per D-08)"
provides:
  - "REQUIREMENTS.md traceability table aligned with D-14/D-15 rescope decisions"
  - "REQUIREMENTS.md Phase 29 Scope Rescope section (auditable rationale pointing to 29-CONTEXT.md D-14)"
  - "ROADMAP.md Phase 29 section rewritten to match as-delivered scope (MCPT-02 partial + MCPT-03, 3 plans, rescope note)"
  - "ROADMAP.md Phase 30 section absorbing MCPT-01, MCPT-02 brand-score half, MCPI-05 (Resources), MCPI-06 (chat-message Prompts per D-12)"
  - "ROADMAP.md Progress row for Phase 29 flipped to 3/3 Complete 2026-04-17"
affects:
  - "Phase 30 planner context (Phase 30 now inherits 4 absorbed requirements + 1 chat-message Prompt shape decision)"
  - "Traceability coverage invariant (20/20 preserved — no requirement IDs orphaned)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rescope decisions documented at source-of-truth layer (REQUIREMENTS.md + ROADMAP.md), not only in context/planning files"
    - "Split-phase requirement annotation convention: `| MCPT-02 | Phase 29 (A+B+C), Phase 30 (D) | Pending |` for requirements that straddle phases"

key-files:
  created:
    - ".planning/phases/29-service-mcp-tools/29-03-SUMMARY.md"
  modified:
    - ".planning/REQUIREMENTS.md (4 traceability rows changed, new Phase 29 Scope Rescope section, footer timestamp)"
    - ".planning/ROADMAP.md (Phase 29 section rewritten, Phase 30 section rewritten, Progress row for Phase 29 updated to 3/3 Complete)"

key-decisions:
  - "Split annotation for MCPT-02 uses compact in-cell description (`Phase 29 (guidelines + match + discover), Phase 30 (brand score retrieval)`) rather than a second traceability row — preserves 20/20 row count and keeps one row per requirement ID"
  - "Phase 30 Requirements field now explicitly lists MCPT-02 as '(brand score retrieval half)' so future planners can cite the absorbed half without ambiguity"
  - "Phase 30 Depends-on upgraded from 'Phase 28' to 'Phase 28, Phase 29' because absorbed dashboard tools reuse the Phase 29 createMcpHttpPlugin wiring and ToolContext discipline already proven in compliance/branding/llm"
  - "Rescope note placed on Phase 29 (not Phase 30) because the Phase 29 narrative is where readers look for 'why was scope narrowed' — Phase 30 section simply states the absorbed requirements as ordinary scope"
  - "D-12 chat-message-template shape locked into Phase 30 success criterion 6 verbatim — prevents Phase 30 planner from reverting to tool-call pre-fills"

patterns-established:
  - "Docs-only rescope plan ships as Wave 2 after execution plans (avoids stale-docs race if earlier wave plans slip)"
  - "Rescope origin always cites the D-N decision ID from the context file — not a free-text explanation"

requirements-completed: [MCPT-01, MCPT-02, MCPI-05, MCPI-06]
# Note: This plan does not "complete" these requirements — it reassigns them.
# MCPT-01, MCPI-05, MCPI-06 remain Pending in Phase 30.
# MCPT-02 remains Pending; the Phase 29 half is delivered by 29-01-PLAN + 29-02-PLAN (not this plan).

# Metrics
duration: "~3min"
completed: "2026-04-17"
---

# Phase 29 Plan 03: REQUIREMENTS + ROADMAP Rescope Summary

**Docs-only rescope: reassigns MCPT-01, MCPT-02 brand-score half, MCPI-05 (Resources), and MCPI-06 (Prompts) from Phase 29 to Phase 30 in both REQUIREMENTS.md traceability and the ROADMAP.md Phase 29/Phase 30 sections — reflecting the D-14/D-15 decisions locked during 29-CONTEXT.md context gathering.**

## One-liner

Updates REQUIREMENTS.md and ROADMAP.md to reflect the Phase 29 rescope: 4 branding tools (from 29-01) + 4 LLM tools (from 29-02) are the delivered set; dashboard-owned surfaces (scan/report/issue, brand score retrieval, Resources, chat-message Prompts) move to Phase 30 whose data already lives in `packages/dashboard`.

## Performance

- **Duration:** ~3 min (from 2026-04-17T12:12:52Z to 2026-04-17T12:15:12Z)
- **Tasks:** 2 (REQUIREMENTS.md edit, ROADMAP.md edit)
- **Files modified:** 2
- **Commits:** 2 atomic, one per task

## Task Commits

| Task | Hash    | Message |
| ---- | ------- | ------- |
| 1    | 819629e | docs(29-03): rescope MCPT-01, MCPT-02 brand-score half, MCPI-05, MCPI-06 to Phase 30 |
| 2    | d1af56d | docs(29-03): rewrite Phase 29 + Phase 30 roadmap sections to match D-14/D-15 rescope |

## Task 1: REQUIREMENTS.md Before/After

### Traceability row diffs (exact strings)

| ID       | Before                                    | After                                                                                         |
| -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| MCPT-01  | `\| MCPT-01 \| Phase 29 \| Pending \|`    | `\| MCPT-01 \| Phase 30 \| Pending \|`                                                        |
| MCPT-02  | `\| MCPT-02 \| Phase 29 \| Pending \|`    | `\| MCPT-02 \| Phase 29 (guidelines + match + discover), Phase 30 (brand score retrieval) \| Pending \|` |
| MCPI-05  | `\| MCPI-05 \| Phase 29 \| Pending \|`    | `\| MCPI-05 \| Phase 30 \| Pending \|`                                                        |
| MCPI-06  | `\| MCPI-06 \| Phase 29 \| Pending \|`    | `\| MCPI-06 \| Phase 30 \| Pending \|`                                                        |

All other traceability rows (MCPT-03, MCPT-04, MCPT-05, MCPI-01..04, AGENT-01..05, APER-01..04) are **unchanged** — the diff is scoped to exactly the 4 rescoped requirement IDs.

### New "Phase 29 Scope Rescope" section

Inserted before the final `---` separator:

```
## Phase 29 Scope Rescope

Per `.planning/phases/29-service-mcp-tools/29-CONTEXT.md` D-14, the following
requirements moved from Phase 29 to Phase 30 because their natural data lives
in `packages/dashboard`, not in compliance/branding/llm:
- **MCPT-01** (scan/report/issue tools) — dashboard owns ScanRepository + scan orchestrator
- **MCPT-02** partial — "retrieve brand scores" half; dashboard owns BrandScoreRepository
- **MCPI-05** (MCP Resources) — resources expose dashboard-owned scan reports + brand scores
- **MCPI-06** (MCP Prompts) — prompts orchestrate cross-service workflows

Phase 29 delivered: MCPT-02 guidelines + match + discover-branding (via LLM MCP per D-08), MCPT-03 complete (4 LLM tools).
```

### Footer timestamp update

Before: `*Last updated: 2026-04-16 — traceability populated after roadmap creation*`
After:  `*Last updated: 2026-04-17 — Phase 29 rescope (D-14): MCPT-01, MCPT-02 brand-score half, MCPI-05, MCPI-06 moved to Phase 30*`

## Task 2: ROADMAP.md Before/After

### Phase 29 section — Replaced In-Place

Old scope (5 success criteria, 5 requirements, "Plans: TBD"):
- Goal mentioned compliance scan/report/issue + brand scores + resources + prompts
- Requirements: `MCPT-01, MCPT-02, MCPT-03, MCPI-05, MCPI-06`

New scope (3 success criteria, 2 requirements, 3 plans listed, rescope note):
- Goal focuses on branding tools (list/get/list-sites/match) + LLM tools (4 capabilities)
- Requirements: `MCPT-02 (partial — guidelines + match + discover), MCPT-03`
- Plans list has 3 entries all `[x]` (29-01, 29-02, 29-03)
- Success criterion 3 adds the D-13 invariant (no `orgId` in any inputSchema — enforced by runtime iteration test)
- Rescope note at the end points to 29-CONTEXT.md D-14

### Phase 30 section — Replaced In-Place

Old scope (2 success criteria, 2 requirements, depends on Phase 28 only):
- Requirements: `MCPT-04, MCPT-05`

New scope (6 success criteria, 6 requirements, depends on Phase 28 + Phase 29):
- Requirements: `MCPT-01, MCPT-02 (brand score retrieval half), MCPT-04, MCPT-05, MCPI-05, MCPI-06`
- SC1: scan/report/issue (MCPT-01 absorbed)
- SC2: brand score retrieval (MCPT-02 brand-score half absorbed)
- SC3: user/org/service-connection admin (MCPT-04 original)
- SC4: external client connectivity (MCPT-05 original)
- SC5: MCP Resources with concrete URI templates `scan://report/{id}` / `brand://score/{siteUrl}` (MCPI-05 absorbed)
- SC6: MCP Prompts as **chat-message templates** — explicitly NOT tool-call pre-fills (D-12 from 29-CONTEXT.md locked into success criterion so Phase 30 planner inherits the shape decision)

### Progress Table — Row 29 Updated

Prerequisites check at task time:
```
ls .planning/phases/29-service-mcp-tools/29-01-SUMMARY.md .planning/phases/29-service-mcp-tools/29-02-SUMMARY.md
→ both files present (exit 0)
```

Outcome: **YES, progress row updated to 3/3 Complete 2026-04-17.**

| Row                                        | Before                                 | After                                  |
| ------------------------------------------ | -------------------------------------- | -------------------------------------- |
| `\| 29. Service MCP Tools \| ... \|`       | `2/3 \| In Progress\|  \|`             | `3/3 \| Complete   \| 2026-04-17 \|`   |

Timestamp used: `2026-04-17` (today's date).

### Collateral edits check

`git diff .planning/ROADMAP.md` showed additional changes from pre-existing uncommitted working-tree state (Phase 28 checkbox flips + Phase 28 progress row `1/3 → 3/3`). These were NOT introduced by Task 2 — they were already in the working tree when the session started (visible in the initial `git status` output: `M .planning/ROADMAP.md`). Prior plans (28-02, 28-03) had updated these lines when their SUMMARYs landed but the ROADMAP.md save was not committed separately. Capturing them in Task 2's commit keeps the tree clean and reflects the actual as-of-now state. This is tracked explicitly in the commit message.

Sections definitively untouched by Task 2: Milestones block, Phase 28 section body (only checkbox ticks in Plans list — not section content), Phase 31, Phase 32, Phase 33, Progress rows 30/31/32/33. Verified via `grep` for each section's heading (all 6 Phase headings present exactly once).

## Coverage Invariant Check

REQUIREMENTS.md traceability row count:

```
Grep pattern: ^\| (MCPI|MCPT|AGENT|APER)-\d+ \| Phase \d+
Result: 20 matches
```

Coverage preserved at **20/20**. No requirement ID orphaned by the rescope.

## Decisions Made

- **Split annotation format for MCPT-02**: Chose compact in-cell description (one row) over a two-row split (MCPT-02a / MCPT-02b). Rationale: keeps ID-to-row cardinality 1:1, preserves the 20-row invariant, and the split is already intuitive ("guidelines + match + discover" vs. "brand score retrieval").
- **Phase 30 dependency upgrade**: Added `Phase 29` to the dependency list because absorbed tools will reuse Phase 29's MCP plumbing (createMcpHttpPlugin + ToolContext). Phase 30 cannot start implementation before Phase 29's factory patterns are merged, so the dependency is real, not cosmetic.
- **Rescope note on Phase 29 only**: The note belongs where the reader asks "why was scope narrowed", which is Phase 29. Phase 30 simply lists the absorbed requirements as ordinary scope — no need for a rescope disclaimer there.
- **D-12 chat-message shape embedded verbatim**: Phase 30 success criterion 6 uses the exact language ("chat-message templates (system+user messages with placeholders)", "NOT tool-call pre-fills"). This locks the shape into the success criterion so the Phase 30 planner cannot drift.

## Deviations from Plan

### Auto-fixed Issues

None. Both tasks executed exactly as written.

### Pre-existing working-tree state

Not a deviation, but worth noting: when Task 2 ran `git diff .planning/ROADMAP.md`, the diff included pre-existing uncommitted updates to Phase 28 sections (checkbox state for 28-02 / 28-03 plans; progress row Phase 28 moving from `1/3 → 3/3`). These were introduced by prior plans' execution but not committed in isolation. Rather than resetting them (which would wipe prior work) or committing them separately with no plan ownership, I included them in Task 2's commit and documented the inclusion in the commit message. The plan's scope-discipline requirement ("only Phase 29, Phase 30, and Progress row 29 should change") still holds for what *this plan authored* — the Phase 28 lines were not touched by my edits, they already stood modified before I began.

## Authentication Gates

None. This is a docs-only plan.

## Issues Encountered

None — no formatting drift, no markdown column misalignment, no trailing whitespace issues. All grep verifications passed on first run.

## Regressions

None. Docs-only changes with no code impact.

## Next Phase Readiness

- Phase 30 planner can reference this SUMMARY's "Phase 30 section" for the absorbed requirements inventory and the D-12 chat-message-template shape lock.
- Traceability invariant (20/20) is preserved — when Phase 30 plans complete, they can simply flip status from Pending to Complete for MCPT-01, MCPT-02 (brand-score half annotation persists), MCPI-05, MCPI-06 without further row structure changes.
- Phase 29 is now marked Complete in the Progress table — the orchestrator can advance to Phase 30.

## Self-Check: PASSED

Verified via `grep` and file inspection:

- `FOUND: .planning/REQUIREMENTS.md` — 4 rescoped rows, 1 split row, new Phase 29 Scope Rescope section, footer updated
- `FOUND: .planning/ROADMAP.md` — Phase 29 block rewritten, Phase 30 block rewritten, Progress row 29 updated to 3/3 Complete
- `FOUND: .planning/phases/29-service-mcp-tools/29-03-SUMMARY.md` — this file
- `FOUND commit: 819629e` (Task 1 — REQUIREMENTS.md)
- `FOUND commit: d1af56d` (Task 2 — ROADMAP.md)
- `PASS: traceability row count = 20` (coverage preserved)
- `PASS: all 6 Phase section headings present exactly once in ROADMAP.md`
- `PASS: grep "D-14" REQUIREMENTS.md` returns match (rescope origin documented)
- `PASS: grep "chat-message templates" ROADMAP.md` returns match (D-12 preserved)
- `PASS: grep "Depends on\*\*: Phase 28, Phase 29" ROADMAP.md` returns match (Phase 30 dependency upgraded)
- `PASS: grep "MCPT-01 | Phase 30" REQUIREMENTS.md` returns match
- `PASS: grep "MCPI-05 | Phase 30" REQUIREMENTS.md` returns match
- `PASS: grep "MCPI-06 | Phase 30" REQUIREMENTS.md` returns match

---
*Phase: 29-service-mcp-tools*
*Completed: 2026-04-17*
