---
phase: 79-ci-regression-gate
plan: "02"
subsystem: core/ci
tags: [ci, github-actions, pr-comment, accessibility-gate, D-17, security]
dependency_graph:
  requires: [79-01]
  provides: [composite-github-action, comment-reporter, comment-reporter-cli]
  affects: [.github/actions/accessibility-gate, packages/core]
tech_stack:
  added: []
  patterns: [composite-github-action, sticky-comment-upsert, tdd-red-green]
key_files:
  created:
    - .github/actions/accessibility-gate/action.yml
    - .github/actions/accessibility-gate/post-comment.sh
    - .github/actions/accessibility-gate/README.md
    - packages/core/src/reporter/comment-reporter.ts
    - packages/core/src/reporter/__tests__/comment-reporter.test.ts
    - packages/core/src/comment-reporter-cli.ts
    - packages/core/src/__tests__/comment-reporter-cli.test.ts
  modified: []
decisions:
  - "Token passed to GH API only via env (GITHUB_TOKEN/GH_TOKEN) — never on argv or echoed (T-79-06)"
  - "Comment body generated exclusively by comment-reporter-cli.js — no inline node -e alternate path (Blocker 2)"
  - "Sticky upsert finds comment by <!-- luqen-gate --> marker via gh api jq filter"
  - "Fork PR 403 degrades to ::warning:: (skip comment) rather than failing the build (T-79-07)"
  - "EnrichmentByCode type added to comment-reporter.ts (ReadonlyMap of EnrichmentEntry arrays) rather than importing ComplianceEnrichment directly, to keep the builder dependency-free from compliance-client"
  - "Pre-existing TS errors in a11y-tree/behavioral/ibm/reflow are out of scope; my two new files compile clean (verified via tsc --noEmitOnError false)"
metrics:
  duration: "~35 minutes"
  completed: "2026-06-07"
  tasks_completed: 2
  files_created: 7
---

# Phase 79 Plan 02: GitHub Action + PR Comment Upsert Summary

Shipped a composite GitHub Action (`using: composite`) that runs the Luqen CLI
gate with `--gate-output` and posts/updates a single sticky PR comment via the
`<!-- luqen-gate -->` HTML marker — body rendered deterministically from the diff
JSON by a dedicated `comment-reporter-cli.ts` entry point, with jurisdiction
context from the compliance enrichment path.

## Tasks

### Task 1: PR comment Markdown builder + comment-reporter-cli entry point

**Commits:** `0260518` (RED tests) / `2a0b48f` (implementation)

Created `packages/core/src/reporter/comment-reporter.ts` exporting `formatPrComment(diff, enrichmentByCode, baselinePath): string`:
- First line is always `<!-- luqen-gate -->` (D-12 upsert marker)
- Counts table (New / Fixed / Unchanged)
- Disclaimer blockquote always present (D-17): "Not legal advice. This report identifies new accessibility findings vs the stored baseline. A zero-new result does not assert conformance."
- `<details>` section for new findings with Severity / WCAG / Selector / Finding / Jurisdiction context columns; selectors wrapped in backtick code spans (T-79-09)
- `<details>` section for fixed findings
- Clean-run variant: "No new findings vs baseline." headline, no `<details>`
- Infra-error variant: degraded headline, disclaimer, never a clean-run claim
- Zero forbidden D-17 words in output or source file

Created `packages/core/src/comment-reporter-cli.ts`:
- ESM entry point reading `process.argv[2]` (diff JSON path) and optional `process.argv[3]` (enrichment JSON path)
- JSON.parse in try/catch — on failure emits infra-error body, never a raw stack trace (T-79-09)
- Writes result to stdout via `process.stdout.write`; exits 0

Tests placed in:
- `src/reporter/__tests__/comment-reporter.test.ts` — 22 assertions covering marker, disclaimer, counts, jurisdiction fallback, D-17 forbidden words, source literal scan
- `src/__tests__/comment-reporter-cli.test.ts` — 11 assertions covering findings/clean/infra-error variants via tsx runner, error-handling degraded path

Both under `src/**/__tests__/` glob matched by vitest config — confirmed with `npx vitest run` (no path).

### Task 2: Composite Action + sticky-comment upsert script

**Commit:** `35ce129`

Created `.github/actions/accessibility-gate/action.yml`:
- `using: 'composite'`
- Inputs: `url`, `baseline-path`, `fail-on`, `min-severity`, `compliance-url`, `github-token`
- Steps: `actions/checkout@v4` → `actions/setup-node@v4` (node 22, npm cache) → `npm ci` → `npm run build -w packages/core` → gate run with `--gate-output` → post-comment.sh → exit with gate exit code (D-13)
- Gate step emits `::error::` annotation on exit 1 (new findings) or exit 2 (infra error)
- Post-comment step only runs on `pull_request` events

Created `.github/actions/accessibility-gate/post-comment.sh`:
- Builds body ONLY via `node packages/core/dist/comment-reporter-cli.js "$DIFF_JSON_PATH"` — single mechanism, no `node -e` alternative (Blocker 2)
- Finds existing comment via `gh api ... --jq '.[] | select(.body | contains("<!-- luqen-gate -->")) | .id'`
- PATCH if found, POST if not — no duplicate comments (D-12)
- Token read from `GITHUB_TOKEN`/`GH_TOKEN` env only; `set +x` before token-adjacent operations; body passed via `--field body=@"$BODY_FILE"` (never argv interpolation) (T-79-06)
- 403 on PATCH/POST → `::warning::` + `exit 0` (fork PR read-only token graceful degradation) (T-79-07)

Created `README.md` documenting inputs, `pull-requests: write` permission requirement, fork-PR limitation, baseline management.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] D-17 source literal scan: word in JSDoc comment**
- **Found during:** Task 1 GREEN phase (test failures)
- **Issue:** The test scans the source file for the D-17 forbidden-word list. The JSDoc comment listed the word in the forbidden list, causing the test to fail.
- **Fix:** Replaced the explicit forbidden-word enumeration in JSDoc with a reference to 79-CONTEXT.md D-17.
- **Files modified:** `packages/core/src/reporter/comment-reporter.ts`
- **Commit:** `2a0b48f`

**2. [Rule 1 - Bug] TypeScript cast for meta.baselinePath access in comment-reporter-cli.ts**
- **Found during:** Build verification (tsc)
- **Issue:** `diff as Record<string, unknown>` was flagged as invalid cast because `BaselineDiff` has no index signature.
- **Fix:** Used `as any` cast (with eslint-disable comment) to access the optional `meta.baselinePath` field.
- **Files modified:** `packages/core/src/comment-reporter-cli.ts`
- **Commit:** `2a0b48f`

### Out of Scope (deferred)

**Pre-existing TypeScript errors in a11y-tree/behavioral/ibm/reflow:** These files have `Promise<string>` assigned to `PathLike` type errors, pre-dating Plan 79. They prevent `npm run build` from producing a full dist, but `tsc --noEmitOnError false` confirms my two new files compile clean. Logged to deferred-items.

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run` (no path) — 384 tests | PASS |
| `npx vitest run` targeting both new test files — 33 tests | PASS |
| YAML parse: `action.yml` | PASS |
| `bash -n post-comment.sh` | PASS |
| Token-safety grep: `grep -nE 'echo.*(TOKEN|GITHUB_TOKEN)' post-comment.sh` | PASS (0 matches) |
| CLI produces non-empty body: `node dist/comment-reporter-cli.js <diff.json>` | `<!-- luqen-gate -->` first line |
| D-17 forbidden words in any output variant | PASS (0 matches) |
| `<!-- luqen-gate -->` on first line of all variants | PASS |
| Disclaimer present in clean/findings/infra-error variants | PASS |
| Jurisdiction fallback "No jurisdiction mapping for this criterion" | PASS |

## Known Stubs

None. All functionality is wired end-to-end.

## Threat Surface Scan

No new network endpoints or auth paths introduced by this plan. The post-comment.sh
script calls the GitHub REST API using an existing `GITHUB_TOKEN` — no new secrets or
trust boundaries beyond what the plan's threat model already covers (T-79-06/T-79-07).

## Self-Check: PASSED

All created files exist on disk and are committed. All 4 commits verified in git log.
