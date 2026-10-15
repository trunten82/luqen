---
gsd_state_version: "1.0"
milestone: v3.9.0
milestone_name: Dismissal follow-through
current_phase: 91
current_phase_name: Dismissal and permission hardening
status: executing
stopped_at: Completed 91-02-PLAN.md
last_updated: "2026-10-15T16:42:44.664Z"
last_activity: 2026-10-15
last_activity_desc: Phase 91 execution started
state_head: fee670e62b9e5f297e01e54f3b9c5e1bb52b9e5d
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 24
  completed_plans: 8
  percent: 33
---

# Project State

## STATE.md frontmatter was rebuilt by `state.advance-plan`-family tooling — content was lost

MEASURED 2026-09-05, after Eventine reported the defect fleet-wide. This session called
`gsd-tools query state.begin-phase`. It REBUILDS the YAML frontmatter by scraping the prose body,
and it discarded the previous `last_activity` line. Restored here verbatim, because it is the only
record of how 83-01 landed:

> 2026-09-05 — 83-01 merged (63c2ccf9) and pushed; ledger rescued from the worktree (4b69721c);
> cycling to pick up the new ssh assign permission

What was NOT damaged in this repo, checked rather than assumed: no `paused_milestone` record
existed before or after, so none was lost; and the progress block was verified against disk on
2026-09-05 — 4 phases in the v3.7.0 roadmap, 1 marked done, 3 PLAN files, 3 SUMMARY files. It
agrees. **Eventine's finding is that this tool's errors run in the FLATTERING direction (it wrote
"9 plans, 7 complete" against a truth of 5/3), which is the direction nobody re-checks.** Mine
happened to be right; that is an observation about this run, not about the tool.

**How to apply:** re-read STATE.md after ANY `state.*` call and diff the frontmatter against
`git show HEAD:.planning/STATE.md`. Do not trust the exit code — `advance-plan` has been observed
returning `{"advanced": false}` while mutating the file anyway. Do not try to fix gsd-tools; it is
not this repo's code. Correct by hand and name the cause in the commit.

## Known intermittent — NOT a regression, cause diagnosed 2026-09-04

`packages/dashboard/tests/vpat-identity-render.test.ts` — the case
"PDF ACR > embeds the logo + identity without throwing, and produces a PDF"
**will fail intermittently under a loaded full-suite run.**

MEASURED 2026-09-04: one full run gave 1 failed / 4225 passed. The same file in
isolation is 9/9 green, and **that single test takes 22.7 seconds** because it
cold-starts Chromium. An immediate full re-run was 338 files / 4226 passed / 0 failed.

Cause: browser launch racing the test timeout when the suite runs in parallel on a busy
host. It is a standing race, not a one-off — it will fire again, and more often on a
slower or busier machine. This project's own notes already record that browser-launching
tests need 90s+ timeouts and that local green is not CI green.

**If you see this red, do not start from zero and do not assume it is whatever you just
changed.** Re-run the file alone first; if it passes in isolation, this is that race. The
real fix is a longer timeout on the browser-launching cases, and it is NOT done.

## v3.7.0 close-out record (2026-09-28)

The item previously carried here ("Phase 86 has no 86-VERIFICATION.md") is RESOLVED, and what it found
is recorded rather than smoothed over:

- An independent verifier wrote 86-VERIFICATION.md: status `gaps_found` (verdict kept, not overwritten;
  a re-verification section is appended in that file).
- Gap 1 (SC3: `eval verdict` never consumed the measured instability) — FIXED, PR #81, merged f3d1043c,
  CI green, auto-deployed; prod read back at f3d1043, luqen-llm restarted 07:19:30Z, /health 200.
- Gap 2 (analyse-visual false-PASS count 0/1/2 across identical runs) — disclosed in the guide, bar NOT
  moved; owner decision asked: register 01M3K97VY409DDC376SWQ2YK09.
- Production pins MEASURED read-only 2026-09-28: both primaries gemini-2.5-flash, matching the baseline.
  NEW: a `system`-org generate-fix prompt override exists; equality to the baselined default is
  UNMEASURED (classifier blocked the read, not routed around) — register 01M3K983JBYGWTHNWAW9JRGJ8M.

**Trap found during the close, worth keeping:** `gsd-sdk query audit-open acknowledge ...` does NOT have
the acknowledge verb — it silently re-runs the plain audit and exits 0, so 29 "successful" acks
suppressed nothing. Use `node ~/.claude/gsd-core/bin/gsd-tools.cjs query audit-open acknowledge` and
check `.acknowledged == true` in its JSON, then RE-SCAN. The two scanners also disagree: gsd-sdk hides
archived-milestone items (no `archived_milestone` field) and lists quick tasks as `missing` whose
SUMMARY says complete; gsd-tools saw 24 items gsd-sdk never showed.

## Deferred Items

Items acknowledged and deferred at the v3.8.0 close, 2026-10-13 (gsd-tools writer; pre-ack audit: 7 open, 47
carried forward; re-scan after: 0 open, 54 acknowledged).

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| todos | 2026-09-29-runscan-events-skip-sse-replay.md | (presence-only) | 2026-10-13 | v3.8.0 |
| uat_gaps | 88/88-UAT.md (item 2: post-merge read-back; dark read-back measured in 89-07/89-08, D-13 recompute duration unmeasurable at prod log level) | testing | 2026-10-13 | v3.8.0 |
| verification_gaps | 88/88-VERIFICATION.md (human items: wording approved D-15; post-merge read-back as above) | human_needed | 2026-10-13 | v3.8.0 |
| deferred_items | 88/deferred-items.md: 88-01 AI-summary issuesList always empty (pre-existing) | acknowledged | 2026-10-13 | v3.8.0 |
| deferred_items | 88/deferred-items.md: 88-03 MCP query_issues pages shape, raw jsonReport on scan rows | acknowledged | 2026-10-13 | v3.8.0 |
| deferred_items | 88/deferred-items.md: 88-08 scans LIST serialises raw jsonReport; GraphQL scanIssues no org guard | acknowledged | 2026-10-13 | v3.8.0 |
| deferred_items | 89/deferred-items.md: D-89-07-01 GraphQL createScan never starts; D-89-09-01..03 | acknowledged | 2026-10-13 | v3.8.0 |

Also open (not audit-tracked): quick 261013-dr7 deferred list (review WR-05, IN-01..IN-08, /api/v1 cookie CSRF sweep, list API
write-side check, MCP role strings); owner follow-ups (deactivate uat-owner/member/viewer; keep or revoke the review dismissal on the
test org; dismissal user docs; mark dialog opens scrolled in de/it/375).

### v3.7.0 close

Items acknowledged and deferred at the v3.7.0 close, 2026-09-28 (via the gsd-tools writer; totals from
its own re-scan: 0 open, 47 acknowledged). All inherited from v3.0.0-v3.6.0 except Phase 86.

| Category | Count | Items |
|----------|-------|-------|
| debug_sessions | 8 | agent-chat-ui-cluster, agent-conversation-leak-cross-user, agent-mcp-surface-parity, agent-uat-residuals, ollama-400-still-after-fix, ollama-tool-call-id-mismatch, regulations-fake-and-stuck-queue (all awaiting_human_verify, 2026-04-27); scan-stuck-running (fixing) |
| quick_tasks | 5 | as counted by gsd-tools (gsd-sdk listed 11 as `missing`, including a task whose SUMMARY is complete — scanner defect, see above) |
| uat_gaps | 13 | phases 42 (MACOS, WINDOWS), 43, 45, 46, 47, 48, 49, 52, 54 — status `unknown`, 0 pending scenarios, mostly in archived milestone v3.3.0 |
| verification_gaps | 15 | human_needed: 30.1, 31.2, 32, 35, 40, 43, 50; gaps_found: 41; gaps_found: 86 (closed/registered above) |
| deferred_items | 6 | deferred-items.md in phases 37 (x4), 31.2, 32 |

`deferred_items` acknowledgement rewrites that entry's own status; every other category keeps its
verdict and resurfaces automatically if its file changes.

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-13 — v3.8.0 archived)

**Core value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.
**Current focus:** Phase 91 — Dismissal and permission hardening

## Current Position

Phase: 91 (Dismissal and permission hardening) — EXECUTING
Plan: 3 of 18
Status: Ready to execute
Last activity: 2026-10-15 — Phase 91 execution started

## Phase Map (v3.9.0 — Dismissal follow-through)

| # | Phase | Requirements | Depends on |
|---|-------|--------------|------------|
| 90 | GraphQL createScan starts scans | SCAN-01, SCAN-02 | — |
| 91 | Dismissal and permission hardening | HARD-01..HARD-13 | — (functionally independent of 90) |
| 92 | Dismissal user documentation | DOCS-01..DOCS-03 | 91 (documents the hardened behaviour; HARD-03 and HARD-12 change who can do what) |

## Phase Map (v3.7.0 — AI output quality, archived)

| # | Phase | Requirements | Depends on |
|---|-------|--------------|------------|
| 83 | Labelled reference sets | EVALSET-01..05 | — (first phase this milestone) |
| 84 | Scoring harness | HARNESS-01..06 | 83 (needs both reference sets, incl. poison items, to run against and break-test) |
| 85 | Pre-registered decision bars | BARS-01..03 | 84 (bars encoded into the runner's verdict logic; locked BEFORE any measurement exists, not just before a future candidate) |
| 86 | Recorded baseline | BASELINE-01..02 | 85 (bars fixed before this run exists, so the baseline cannot shape the margin) and, transitively, 84 (break-test evidence must precede the first trusted green result) |

**Sequencing is strictly linear (83 → 84 → 85 → 86), not parallelizable** — this milestone is a
single evidentiary chain: sets feed the harness, the harness's break-test must be watched to fail
before any result is trusted, the bars are locked before any measurement exists, and the baseline
is the first trusted measurement produced only after both are in place. No phase in this milestone
measures a candidate model — that is explicitly next-milestone work.

## Accumulated Context

### Roadmap Evolution

- 2026-05-29: original v3.5.0 roadmap (monetization: phases 78-82 GATE/CREDIT/AGENCY/PRICE) created, then shipped direct-to-master — but the monetization spine was REVERSED by the single-product decision ([[project_single_tier_decision]]). Only Phase 78 (anti-overlay positioning) survived.
- 2026-06-07: **v3.5.0 redefined** as "Anti-overlay wedge — dev + exec first wave". Roadmap recreated: Phase 78 (shipped) preserved; new phases 79-82 (CIGATE / MCPFIX / EXPO / DIGEST) replace the retired monetization phases — same numbers, entirely new concepts. 20/20 requirements mapped, no orphans, coarse granularity (4 feature tracks → 4 phases). Key sequencing: developer tracks 79+80 are independent and parallelizable; EXPO (81, flagship) sequences before DIGEST (82) because the digest reports the exposure trend EXPO produces.
- 2026-09-04: v3.6.0 (agent surface + semantic depth) shipped directly to master with no numbered phases; v3.7.0 opened same day (approved via orchestrator, on the owner's register).
- 2026-09-05: **v3.7.0 roadmap created.** 16 requirements (EVALSET/HARNESS/BASELINE/BARS) mapped 1:1 onto the four requirement groups from the approved brief, giving 4 phases (83-86), coarse granularity, zero orphans. Bars (Phase 85) deliberately sequenced BEFORE baseline (Phase 86) — a stronger guarantee than the literal requirement text ("before any candidate measurement"), chosen so neither the non-inferiority margin nor the `analyse-visual` bar can be shaped by having already seen any real measurement, including the baseline's own.

- 2026-10-15: **v3.9.0 roadmap created.** 18 requirements (SCAN/HARD/DOCS) mapped onto the owner-approved 3-phase shape (90 GraphQL createScan, 91 hardening, 92 docs), coarse granularity, zero orphans. Docs sequenced last so they describe the hardened permission behaviour. HARD-08 flagged: raise with the owner before building if it needs a schema change.

### Decisions (v3.7.0 — AI output quality)

- **Bars sequenced before baseline, not just before a future candidate** — BARS-01/02/03 (Phase 85) precede BASELINE-01/02 (Phase 86) so the non-inferiority margin and the `analyse-visual` bar cannot be shaped by having already seen a real measurement.
- **Four phases, one per requirement group (A/B/C/D from the approved brief)** — reference sets, harness, bars, baseline — each independently observable; the milestone's explicit ordering constraints (HARNESS-05 with/before first green; BASELINE-01 before any candidate; BARS-01 before any candidate) map cleanly onto phase boundaries.
- **No candidate-model-measurement phase in this milestone** — the 16 requirements build the instrument only; using it to decide a specific model swap is next-milestone work.

### Constraints (v3.7.0)

- Tech stack: reuse the existing `@luqen/llm` capability-execution engine and provider adapters — no new frameworks, no new vendor dependency
- Ground-truth provenance is per-item and mandatory — the loader refuses an item with none
- `analyse-visual` false-PASS and false-ISSUE are scored and reported separately, never fused
- `parseGenerateFixResponse` / `parseAnalyseVisualResponse` never throw (catch → empty string) — the harness persists the raw response per item so an all-empty parse is distinguishable from a genuine low score
- Pre-registered bars must not be rewritten once a measurement exists
- `analyse-visual` stays on gemini-2.5-flash for the duration of this milestone — the READY-BUT-UNAPPLIED pin change in `docs/guides/llm-model-selection.md` stays unapplied until the live-config permission is lifted; this milestone must not become the reason to apply it early

### Known Gotchas (carried forward)

- **HTMX OOB inside `<tr>`**: wrap in `<template>` tags
- **HTMX 2.0 `hx-select` inheritance**: use plain JS `EventSource` for streaming
- **`@fastify/rate-limit` 429 bypass**: add `onSend` hook
- **All Luqen services use `/api/v1/*` prefix** — bare `/oauth/token` or `/health` returns misleading 401
- **Fastify rejects empty JSON body** — always send `{}` on bodyless POSTs
- **New services/surfaces must appear in ALL shared admin sections** (health, clients, sidebar)
- **Cross-service auth**: OAuth2 client credentials only, never raw API keys
- **Excel-only exports (no CSV)** — use `buildXlsx()`
- **WP plugin must not assume a local service** — remote Luqen endpoints are the norm; gate on a configured connection, degrade silently
- **UI phases need human UAT** — automated checks miss cross-persona / mobile / URL edge cases
- **Live tracks master, not develop** — every merge to master auto-deploys via the Deploy workflow on the self-hosted `luqen-prod` runner after green CI; the deploy drains in-flight scans first (PR #99, up to 30 min; `workflow_dispatch force=true` skips it)
- **`parseGenerateFixResponse`/`parseAnalyseVisualResponse` never throw** — they catch and return empty strings; an all-empty parse looks identical to a genuine empty/low result unless the raw response is persisted alongside it (v3.7.0 HARNESS-06)
- **Gemini thinking models share `maxOutputTokens` with thoughts** — a low cap truncates live output silently; relevant if a candidate under evaluation is a thinking model

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 261008-fs4 | Deploy waits for in-flight scans before restarting the dashboard (incident: deploy killed a customer scan); live break-test passed | 2026-10-08 | a36b2c16 | [261008-fs4-deploy-waits-for-in-flight-scans-before-](./quick/261008-fs4-deploy-waits-for-in-flight-scans-before-/) |
| 261008-dd4 | Drop htmlcs/axe contrast false positives on non-rendered noscript/video/audio fallback content (customer report); PR #97 deployed | 2026-10-08 | d18cbe66 | [261008-dd4-htmlcs-false-positives-on-noscript-video](./quick/261008-dd4-htmlcs-false-positives-on-noscript-video/) |
| 260601-fte | Manual-test evidence artifacts (screenshots/documents) in the VPAT/ACR report (web + PDF) | 2026-06-01 | 1304877 | [260601-fte-vpat-evidence-artifacts](./quick/260601-fte-vpat-evidence-artifacts/) |
| 260601-njq | Per-org legal/company identity on VPAT/ACR reports (web + PDF + share); migration 082, optional StorageAdapter field | 2026-06-01 | c3cc788 | [260601-njq-vpat-org-legal-identity](./quick/260601-njq-vpat-org-legal-identity/) |
| 260713-boq | Reports-page OOM/502: exclude json_report blob from scan list queries; opt-in includeReport for batch callers; deployed + verified live | 2026-07-13 | 35dd5e20 | [260713-reports-list-oom-json-report](./quick/260713-reports-list-oom-json-report/) |
| 260713-cpa | Admin UX batch: LLM-usage 403 for org Admins (guard + llm.view), branding-mode i18n (34 keys × 6 locales + coverage gate) + org-row link, team HTMX row column parity | 2026-07-13 | c7f016f0 + 64768996 | [260713-llm-usage-org-admin-403](./quick/260713-llm-usage-org-admin-403/) |
| 260904-llm-pricing-accuracy | LLM cost accounting: lookupPrice separator fix (siblings silently inherited a neighbour's price — a WRONG number, invisible to unpriced_rows) + stale/missing Gemini rows incl. 3.x with promo expiry recorded | 2026-09-04 | 17010cfb | [260904-llm-pricing-accuracy](./quick/260904-llm-pricing-accuracy/) |
| 260713-oom2 | Latent-OOM follow-up: rescore + branding-retag stream reports per-scan via getReport (listScans metadata-only); migrate-data keeps includeReport (one-off CLI) | 2026-07-13 | 82a67db4 | [260713-reports-list-oom-json-report](./quick/260713-reports-list-oom-json-report/) |
| 260714-cb0 | Live-error triage (324c8f6a) + full-capability UAT sweep (facdf55d, f2c44178): 10 bugs fixed incl. PDF sliver layout, teams-members 500, llm-usage forbidden_org (dashboard helpers + LLM token orgId claim, 0db428bd); 3 permanent gates; uat-live harness committed; FINAL: 6-persona crawl 742 URLs 0 failures | [260714-live-error-triage](./quick/260714-live-error-triage/) |
| 260715-pg9 | Live AI failures: Ollama Cloud retired ministral-3:3b (HTTP 410) → typed ProviderHttpError + res.ok/shape guards (ollama/openai/gemini complete()), isNonRetryable() breaks retry loops, discover-branding fetchDiagnostics + bot-protection detection (marker∧no-signals — marker alone false-positives on passive cdn-cgi/challenge-platform), never-blank fix partial, htmlContext now passed from report-detail to generate-fix (root cause of "AI fix never shows"); live routing → gemini-2.5-flash primary + gpt-oss:120b-cloud fallback, retired model deleted; 2-persona live UAT green | 2026-07-15 | 5338510c..78c1f606 | [260715-pg9-fix-live-ai-failures-generate-fix-minist](./quick/260715-pg9-fix-live-ai-failures-generate-fix-minist/) |
| 260716-fast | Compliance-created users locked out of login: /login skipped compliance OAuth when complianceUrl was the default localhost:4000 (live's value) while /admin/users creates users in the compliance service; OAuth now attempted for any configured URL with local fall-through + 5s token-request bound; verified live (compliance user 302, testadmin fall-through 302). Also deleted duplicate system-org "Fabrikamgroup" guideline 2426f11c per user decision (org copy 0f3f12c6 intact) | 2026-07-16 | 211dadcd | (fast task — no directory) |
| 260718-sse | Blank agent-companion turns + image refusals on live, found via automated companion UAT (v3.6.0 residual): (1) Gemini SSE uses CRLF frame delimiters, readSsePayloads split on \n\n only → completeStream yielded 0 tokens then done (latent since adapter shipped; exposed when 07-15 rerouting made gemini-2.5-flash the agent-conversation primary) — fixed 601548cf with \r?\n\r?\n reader + CRLF wire test; (2) agent system prompt's tool-manifest rule predates Phase 83 multimodal → model refused attached images ("I cannot directly analyze images") — fixed 927f2fd0 with LOCKED:multimodal fence declaring attached images native input. Final live UAT 8/8 (login, drawer, TTS toggle+speak-on-done, text turn, image staging, vision answer "Red"). Planning bookkeeping synced (de049e52) | 2026-07-18 | 601548cf + 927f2fd0 | (fast task — no directory) |
| 260928-863 | Phase 86 gap closure: `eval verdict --replication` consumes measured instability; licence qualifier narrowed to never supersede a false-PASS clause; replication parser hardened; docs relabel/disclosures; +28 tests (855), break-tests A-F (E exposed an unwatched clause, watcher added) | 2026-09-28 | f3d1043c (PR #81) | [260928-863-close-phase-86-gap-1-wire-measured-insta](./quick/260928-863-close-phase-86-gap-1-wire-measured-insta/) |
| 260928-g6k | Owner-approved (relayed via the orchestrator, 2026-09-28): WAF-blocked discovery surfaced as scan_records.discovery_warning (migration 089) on both orchestrator paths + report/progress UI (6 locales); sitemap+crawl scoped to start URL origin + path prefix (shared scope.ts; closed userinfo/lookalike-host/port origin-check hole) | 2026-09-28 | b8b85fc2..a92108c2 (PR pending) | [260928-g6k-waf-discovery-blocked-and-path-prefix-sc](./quick/260928-g6k-waf-discovery-blocked-and-path-prefix-sc/) |
| 260928-hkw | Owner-approved: headless-Chromium link discovery when fetch discovery hits a WAF challenge ('waf-browser-discovery'); ONE shared Chromium resolver for every launch site (7 bare sites -> 2 that take a resolved path); startup ERROR log + /health browser check (degraded, no paths exposed) | 2026-09-28 | 3af369db..ae899495 (PR pending) | [260928-hkw-browser-based-discovery-fallback-on-waf](./quick/260928-hkw-browser-based-discovery-fallback-on-waf/) |

## Session Continuity

Last session: 2026-10-15T16:42:44.613Z
Stopped at: Completed 91-02-PLAN.md
Resume file: None
Next action: none until the owner opens a new milestone. If woken with one, start with `/gsd-new-milestone`.

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone

## Performance Metrics

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 88 P01 | 75min | 3 tasks | 9 files |
| Phase 88 P02 | 7 min | 3 tasks | 5 files |
| Phase 88 P13 | 10 min | 2 tasks | 7 files |
| Phase 88 P03 | 8min | 3 tasks | 4 files |
| Phase 88 P16 | 20min | 2 tasks | 4 files |
| Phase 88 P04 | 45min | 3 tasks | 7 files |
| Phase 88 P05 | ~40 min | 3 tasks | 7 files |
| Phase 88 P06 | 25 min | 2 tasks | 5 files |
| Phase 88 P11 | 25min | 3 tasks | 8 files |
| Phase 88 P15 | 25min | 3 tasks | 0 files |
| Phase 88 P10 | 6 min | 2 tasks | 3 files |
| Phase 88 P08 | 30min | 2 tasks | 4 files |
| Phase 88 P09 | 40min | 3 tasks | 7 files |
| Phase 88 P17 | 25min | 3 tasks | 7 files |
| Phase 88 P19 | 35min | 2 tasks | 4 files |
| Phase 88 P07 | 25min | 2 tasks | 11 files |
| Phase 88 P14 | 35min | 3 tasks | 5 files |
| Phase 88 P18 | 10 min | 2 tasks | 2 files |
| Phase 88 P12 | 35min | 3 tasks | 1 files |
| Phase 89 P03 | 25 min | 3 tasks | 2 files |
| Phase 89 P05 | 27 min | 3 tasks | 18 files |
| Phase 89 P06 | ~3h | 3 tasks | 12 files |
| Phase 89 P11 | 2h48m | 3 tasks | 25 files |
| Phase 89 P09 | 27min | 3 tasks | 9 files |
| Phase 90 P01 | 70m | 2 tasks | 10 files |
| Phase 90 P02 | 35min | 3 tasks | 10 files |
| Phase 90 P03 | 35min | 3 tasks | 2 files |
| Phase 90 P06 | ~50min | 3 tasks | 6 files |
| Phase 90 P04 | 1h25m | 3 tasks | 0 files |
| Phase 91 P01 | 35min | 3 tasks | 3 files |
| Phase 91 P02 | 35min | 3 tasks | 10 files |

## Decisions

- [Phase 88]: 88-01: golden baselines use exact-literal replacement for per-run ids and dates; TZ defaults to UTC only when unset so the TZ determinism check is not vacuous
- [Phase 88]: 88-02: D-04 Case A measured on prod (340 completed scans: confirmed_violations NULL 203, 0 137, non-zero 0); D-13 largest site 138 completed scans, synchronous recompute stays
- [Phase 89]: 89-05: Revoke control and dialog are gated on dismissalControls (route-computed, includes the org predicate), not perm.issuesDismiss; mark and revoke share one status map, request path, lock and flash in issue-dismissals.js
- [Phase 89]: 89-11: API-key actor labels read once via listKeys(scan.orgId), filtered to the scan org; other key actors stay generic
- [Phase 89]: 89-11: sticky dismissal-dialog footer (bottom -space-xl for Chromium's padding inset) plus keepFieldInView for the focused textarea
- [Phase 89]: 89-11: UAT harness --keep-going (local only) so break-tests show the whole red set
- [Phase 89]: 89-09: grant PR #5 (head 9bf30d1c) HELD — issues.dismiss to org Owner/Admin + migration 091; merge needs the owner's direct OK (Plan 10)
- [Phase 89]: 89-09 open point D-89-09-01: after the lift a global admin can put issues.dismiss on a global (system-org) role; not decided at D-15; D-17 read-back flags it
- [Phase 90]: Phase 90-01: GraphQL createScan routes through ScanService.initiateScanAuthorized (permission check in the shared function, not initiateScan; MCP exception documented)
- [Phase 90]: 90-03: read-back script switch-ignored world uses a same-named other org, so the org assertion must compare name AND id; selftest lives in the script file
- [Phase 90]: 90-04: all 26 guard mutations watched failing; 25 reddened exactly the declared set, M6 reddened the declared set plus one positive-control test outside its stated category (recorded as a MISMATCH, declaration not edited); M25 first run hit nine load timeouts, re-run clean
- [Phase 91]: 91-01: the at-rest key list is anchored on call expressions with a per-site line window; every other reference to the encryption key must be a listed site or a named exemption
- [Phase 91]: 91-01: the prod read-back script checks that schedule creation goes through the shared start validation, and sweeps any probe schedule it finds stored
- [Phase 91]: Phase 91 P02: retry and cancel need the scan create permission and the scan's organization; the organization predicate is the dismissal write-side predicate under a second name (delegation plus an agreement table), no exception for the system organization
- [Phase 91]: Phase 91 P02: retry order is permission, organization, status, one start from the shared scan-start limit, then the stored start-URL check and the start; a refused stored start URL marks the row failed with the refusal text and starts nothing
- [Phase 91]: Phase 91 P02: the report page offers Retry and Cancel through a route-computed scanControls key, absent unless the viewer holds the permission and may control the scan's organization

### Blockers

- 90-03 B1: admin persona belongs to no org and the prod UAT org has no members - prod read-back (plan 05) cannot enter the UAT org; owner decision needed (not worked around)
