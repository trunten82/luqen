# Compliance Matrix Smart Cards — Design Spec

**Date:** 2026-04-01
**Status:** Approved

## Problem

When multiple regulations under a jurisdiction all require identical WCAG criteria (e.g., Italy with 4 regulations all at WCAG 2.1 AA), the compliance card shows 40 identical criteria with regulation filter buttons that do nothing useful. Users see clutter instead of insight.

## Solution

Smart cards that adapt based on whether regulations differ:

### Identical regulations (common case)

Collapsed summary with expandable detail:
- "40 criteria violated" with regulation tags
- "All regulations require WCAG 2.1 Level AA" note
- Expandable criteria list (collapsed by default)
- No regulation filter buttons (pointless when identical)

### Different regulations (US, mixed-version scenarios)

Expanded view with active filtering:
- Regulation filter buttons (All / Section 508 / ADA Title II)
- Per-criterion rows with regulation mini-tags
- Diff summary: "5 criteria required by ADA but not Section 508"

## Detection logic

In report-service.ts, after deduplication: if every deduplicated violation has `regulations.length === totalRegulationCount`, set `allRegulationsIdentical: true`.

## Files changed

- `packages/dashboard/src/services/report-service.ts` — add `allRegulationsIdentical` flag
- `packages/dashboard/src/views/report-detail.hbs` — conditional rendering based on flag
