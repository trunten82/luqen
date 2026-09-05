---
gsd_state_version: 1.0
milestone: v3.7.0
milestone_name: AI output quality — eval harness + labelled reference sets
current_phase: 83
current_phase_name: Labelled reference sets
status: Phase 83 COMPLETE and verified (4/4 success criteria) — Phase 84 (Scoring harness) ready to plan
stopped_at: "Phase 83 complete: all 3 plans merged and verified; 83-VERIFICATION.md status=passed. Next: /gsd-plan-phase 84"
last_updated: "2026-09-05T21:38:32.693Z"
last_activity: 2026-09-05
last_activity_desc: Phase 83 wave 2 (83-02 WCAG-fix set, 83-03 image set) merged, verified 4/4, EVALSET-01..05 all Complete
state_head: 0272957c  # last CODE commit of phase 83 (the 83-03 merge). Deliberately NOT "latest commit": planning-only commits land after it, so this names a re-checkable thing — `git diff --stat 0272957c..HEAD` must list nothing outside .planning/ and .gitignore.
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
  percent: 25
---

# Project State

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

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-05 — v3.7.0 AI output quality opened)

**Core value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.
**Current focus:** Phase 83 — Labelled reference sets

## Current Position

Phase: 83 (Labelled reference sets) — COMPLETE, verified 4/4
Plan: 3 of 3
Status: Phase 83 verified and merged to master. Next: /gsd-plan-phase 84 (Scoring harness)
Last activity: 2026-09-05 — 83-02 + 83-03 executed in parallel worktrees, merged, full suite green, verified

Progress: [██░░░░░░░░] 25%

## Phase Map (v3.7.0 — AI output quality)

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
- **Live tracks master, not develop** — push to master before deploy; no CI on lxc-luqen, deploy via explicit ssh
- **`parseGenerateFixResponse`/`parseAnalyseVisualResponse` never throw** — they catch and return empty strings; an all-empty parse looks identical to a genuine empty/low result unless the raw response is persisted alongside it (v3.7.0 HARNESS-06)
- **Gemini thinking models share `maxOutputTokens` with thoughts** — a low cap truncates live output silently; relevant if a candidate under evaluation is a thinking model

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260601-fte | Manual-test evidence artifacts (screenshots/documents) in the VPAT/ACR report (web + PDF) | 2026-06-01 | 1304877 | [260601-fte-vpat-evidence-artifacts](./quick/260601-fte-vpat-evidence-artifacts/) |
| 260601-njq | Per-org legal/company identity on VPAT/ACR reports (web + PDF + share); migration 082, optional StorageAdapter field | 2026-06-01 | c3cc788 | [260601-njq-vpat-org-legal-identity](./quick/260601-njq-vpat-org-legal-identity/) |
| 260713-boq | Reports-page OOM/502: exclude json_report blob from scan list queries; opt-in includeReport for batch callers; deployed + verified live | 2026-07-13 | 35dd5e20 | [260713-reports-list-oom-json-report](./quick/260713-reports-list-oom-json-report/) |
| 260713-cpa | Admin UX batch: LLM-usage 403 for org Admins (guard + llm.view), branding-mode i18n (34 keys × 6 locales + coverage gate) + org-row link, team HTMX row column parity | 2026-07-13 | c7f016f0 + 64768996 | [260713-llm-usage-org-admin-403](./quick/260713-llm-usage-org-admin-403/) |
| 260904-llm-pricing-accuracy | LLM cost accounting: lookupPrice separator fix (siblings silently inherited a neighbour's price — a WRONG number, invisible to unpriced_rows) + stale/missing Gemini rows incl. 3.x with promo expiry recorded | 2026-09-04 | 17010cfb | [260904-llm-pricing-accuracy](./quick/260904-llm-pricing-accuracy/) |
| 260713-oom2 | Latent-OOM follow-up: rescore + branding-retag stream reports per-scan via getReport (listScans metadata-only); migrate-data keeps includeReport (one-off CLI) | 2026-07-13 | 82a67db4 | [260713-reports-list-oom-json-report](./quick/260713-reports-list-oom-json-report/) |
| 260714-cb0 | Live-error triage (324c8f6a) + full-capability UAT sweep (facdf55d, f2c44178): 10 bugs fixed incl. PDF sliver layout, teams-members 500, llm-usage forbidden_org (dashboard helpers + LLM token orgId claim, 0db428bd); 3 permanent gates; uat-live harness committed; FINAL: 6-persona crawl 742 URLs 0 failures | [260714-live-error-triage](./quick/260714-live-error-triage/) |
| 260715-pg9 | Live AI failures: Ollama Cloud retired ministral-3:3b (HTTP 410) → typed ProviderHttpError + res.ok/shape guards (ollama/openai/gemini complete()), isNonRetryable() breaks retry loops, discover-branding fetchDiagnostics + bot-protection detection (marker∧no-signals — marker alone false-positives on passive cdn-cgi/challenge-platform), never-blank fix partial, htmlContext now passed from report-detail to generate-fix (root cause of "AI fix never shows"); live routing → gemini-2.5-flash primary + gpt-oss:120b-cloud fallback, retired model deleted; 2-persona live UAT green | 2026-07-15 | 5338510c..78c1f606 | [260715-pg9-fix-live-ai-failures-generate-fix-minist](./quick/260715-pg9-fix-live-ai-failures-generate-fix-minist/) |
| 260716-fast | Compliance-created users locked out of login: /login skipped compliance OAuth when complianceUrl was the default localhost:4000 (live's value) while /admin/users creates users in the compliance service; OAuth now attempted for any configured URL with local fall-through + 5s token-request bound; verified live (compliance user 302, testadmin fall-through 302). Also deleted duplicate system-org "Camparigroup" guideline 2426f11c per user decision (org copy 0f3f12c6 intact) | 2026-07-16 | 211dadcd | (fast task — no directory) |
| 260718-sse | Blank agent-companion turns + image refusals on live, found via automated companion UAT (v3.6.0 residual): (1) Gemini SSE uses CRLF frame delimiters, readSsePayloads split on \n\n only → completeStream yielded 0 tokens then done (latent since adapter shipped; exposed when 07-15 rerouting made gemini-2.5-flash the agent-conversation primary) — fixed 601548cf with \r?\n\r?\n reader + CRLF wire test; (2) agent system prompt's tool-manifest rule predates Phase 83 multimodal → model refused attached images ("I cannot directly analyze images") — fixed 927f2fd0 with LOCKED:multimodal fence declaring attached images native input. Final live UAT 8/8 (login, drawer, TTS toggle+speak-on-done, text turn, image staging, vision answer "Red"). Planning bookkeeping synced (de049e52) | 2026-07-18 | 601548cf + 927f2fd0 | (fast task — no directory) |

## Session Continuity

Last session: 2026-09-05T09:36:52.873Z
Stopped at: Completed 83-01-PLAN.md (labelled reference-set spine: types/schema/loader/set-paths + seed sets + refusal tests)
Resume file: None
Next action: `/gsd-discuss-phase 83` (Labelled reference sets) or `/gsd-plan-phase 83`

## Operator Next Steps

- Review the v3.7.0 roadmap in .planning/ROADMAP.md
- Start phase work with `/gsd-discuss-phase 83` or `/gsd-plan-phase 83`
