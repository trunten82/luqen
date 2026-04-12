---
phase: 23-brand-overview-page
plan: 02
status: complete
completed_at: 2026-04-12
---

# Plan 23-02 Summary — HTMX Polish + Tests + UAT

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Route tests (12) + extract computeOrgSummary | `bc94c86` | done |
| 2 | HTMX site selector polish + responsive CSS + history table | `51058c0` | done |
| 3 | UAT — visual verification on live | approved | done |

## Post-UAT Fixes

| Fix | Commit |
|-----|--------|
| Global admin org picker (was redirecting to /home) | `d6de253` |
| Badge score chips for readability (was text color on white) | `d6de253` |
| SITES heading readable (section-title instead of sidebar__section-label) | `e12266c` |

## Verification

- 12 route tests pass (permission gate, happy path, site selection, empty state, summary, HTMX)
- Full regression: 2547+ passed / 0 failed
- UAT on live: global admin sees org picker, org admin sees own org, badge chips readable, SITES heading readable, mobile layout collapses correctly

## Requirements

BOVW-02 (site selector), BOVW-03 (org summary card)
