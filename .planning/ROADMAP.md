# Roadmap: Luqen

## Milestones

- ✅ **v2.7.0 – v3.0.0** — Phases 01-33 (shipped) — see `milestones/` archives
- ✅ **v3.1.0 Agent Companion v2 + Tech Debt & Docs** — Phases 34-42 (shipped)
- ✅ **v3.2.0 – v3.4.0 WP Plugin, UI Revision, LLM Cost Telemetry** — Phases 43-77 (shipped directly to master)
- 🚧 **v3.5.0 Anti-overlay wedge — dev + exec first wave** — Phase 78 (Anti-overlay positioning) shipped; Phases 79-82 (CI gate, MCP fix tools, legal-exposure scoring, exec digest) below.

> **Milestone redefined.** The original v3.5.0 "Commercial positioning & agency monetization" (Pro/Agency gates, credit-metered fixes) was **reversed by the single-product decision** ([[project_single_tier_decision]]). Only its Phase 78 (anti-overlay positioning) survives. The dead monetization phases that were numbered 79-82 (GATE/CREDIT/AGENCY/PRICE) are **retired** — their concepts must NOT be reused. v3.5.0 is now the **Anti-overlay wedge**: convert the verified 2026-06 market-positioning brief into product. Phase numbering continues from 78 (no reset).

---

## Current Milestone: v3.5.0 Anti-overlay wedge — dev + exec first wave

**Goal:** Convert the verified 2026-06 market-positioning brief (`.planning/MARKET-POSITIONING-2026-06.md`) into product. Give developers real source-level remediation inside their workflow (CI gate + agent-native fix tools), and give executives a conservative, jurisdiction-grounded, proactive risk picture (legal-exposure scoring + scheduled digest). WordPress-leaned throughout — the SMB segment that was mis-sold overlays and is getting sued is the beachhead. Position Luqen as "the anti-overlay, legal-defensibility platform for developers and executives."

**Granularity:** coarse · **Phases:** 5 (78 shipped + 79-82 new) · **Requirements:** 20/20 mapped ✓

**Hard constraint threaded through every phase:** ALL user-facing reporting stays **legally conservative** — never emit "compliant" / "100%" / "lawsuit-proof". Exposure-indication + good-faith remediation + transparency framing only ("not legal advice").

**Cross-repo:** most phases touch BOTH `/root/luqen` (dashboard + core) and `/root/luqen-wordpress` (the WP plugin, v0.32.0). Ship pattern per phase: wip branch → build → test → merge to master → deploy to lxc-luqen → CI green; WP plugin has its own repo + CI (test via wp-test lxc + Playwright).

## Phases

**Phase Numbering:**
- Integer phases (78, 79, 80…): Planned milestone work
- Decimal phases (e.g. 80.1): Urgent insertions (marked INSERTED)

- [x] **Phase 78: Anti-overlay positioning** — DONE 2026-06-01. WP readme anti-overlay + public-report positioning line + docs/why-not-an-overlay.md comparison surface; dashboard-landing positioning gap (SC2) closed in f40b43e (CI green, deployed). Evidence re-verified (FTC $1M; NFB 2021/2025; UsableNet/EcomBack overlay-lawsuit rate).
- [x] **Phase 79: CI regression gate** — `luqen scan --fail-on=new` baseline diff + GitHub Action PR comment + WP scan-on-publish warn/block gate, conservative output. (completed 2026-06-07)
- [x] **Phase 80: MCP fix tools for coding agents** — scan + generate-fix exposed as MCP tools (WCAG criterion + 58-jurisdiction legal context + WP-block-aware), human-supervised, never auto-applies. (completed 2026-06-07)
- [ ] **Phase 81: Jurisdiction legal-exposure scoring (FLAGSHIP)** — conservative per-site exposure indicator fusing scan + jurisdiction framing + lawsuit/deadline data, surfaced in dashboard, fleet/portfolio view, and the WP plugin.
- [ ] **Phase 82: Scheduled executive digest** — recurring "what changed / what's at risk" digest over notify (email/Slack/Teams) + board-ready PDF + per-site WP digest, reporting the exposure trend.

## Phase Details

### Phase 78: Anti-overlay positioning
**Goal**: A prospective and existing user understands Luqen as genuine source-level remediation — not an overlay widget — across the WordPress plugin listing, the dashboard, and scan reports, backed by verified evidence.
**Track**: Cross-repo — `luqen-wordpress` (`readme.txt`) + `luqen` platform (dashboard/report copy + comparison surface)
**Depends on**: Nothing (independent; shipped first)
**Requirements**: POS-01, POS-02, POS-03 (superseded milestone — see milestones/ archive)
**Success Criteria** (what must be TRUE):
  1. A user reading the WP plugin `readme.txt` sees Luqen framed as genuine source-level remediation, with an explicit anti-overlay section
  2. A user viewing a scan report and the dashboard landing sees genuine-remediation positioning (real fixes in your source, not a widget)
  3. A user can open a "why not an overlay" comparison surface citing verified evidence (FTC $1M, NFB revocation, lawsuits-despite-widget rate)
**Plans**: 1 plan (DONE)
**UI hint**: yes

### Phase 79: CI regression gate
**Goal**: A developer can stop accessibility regressions at the source — running a Luqen scan in fail-on-regression mode in CI, getting a PR comment that diffs new vs fixed findings against a stored baseline, and (in WordPress) being warned before publishing a post that introduces new violations. Built on the existing `@luqen/core` CLI + multi-engine scan.
**Track**: Cross-repo — `luqen` core (CLI flag + baseline diff + GitHub Action) + `luqen-wordpress` (scan-on-publish gate)
**Depends on**: Phase 78 (sequenced after; functionally independent — first developer track). Independent of Phases 80/81/82.
**Requirements**: CIGATE-01, CIGATE-02, CIGATE-03, CIGATE-04, CIGATE-05
**Success Criteria** (what must be TRUE):
  1. A developer runs the CLI in fail-on-regression mode (e.g. `luqen scan --fail-on=new`) and the process exits non-zero only when the scan introduces findings absent from a stored baseline
  2. A developer can create and update a baseline of accepted findings for a target, and tune the gate's failure threshold (severity / new-only)
  3. A developer using the provided GitHub Action receives a PR comment summarizing new vs fixed findings, each with its WCAG criterion + jurisdiction context
  4. A WordPress author is warned (and optionally blocked) when publishing/updating a post that introduces new accessibility violations versus the last scan
  5. The gate's output stays conservative — it reports new/fixed findings and exposure, and NEVER asserts "compliant" even on a clean (zero-new) run
**Plans**: 3 plans (2 waves)
- [x] 79-01-PLAN.md — Core CLI gate: baseline store + new/fixed diff + conservative gate reporter + scan flags (--fail-on/--min-severity/--baseline/--update-baseline)
- [x] 79-02-PLAN.md — Composite GitHub Action + sticky PR-comment upsert (new vs fixed, WCAG + jurisdiction context)
- [x] 79-03-PLAN.md — WordPress scan-on-publish gate (per-post baseline, warn/block, Gutenberg pre-publish panel)
**UI hint**: yes

### Phase 80: MCP fix tools for coding agents
**Goal**: A coding agent (Cursor, Claude Code) connected to the Luqen MCP server can, inline in the developer's editor, scan a page and request a source-level fix for a finding — receiving a proposed diff, an explanation, the WCAG criterion, and the applicable 58-jurisdiction legal framing, including WordPress-block-aware fixes. The tools never apply changes themselves — they return drafts a human reviews and merges (anti-overlay, human-supervised). Built on the existing `@luqen/core` MCP server + the `generate-fix` LLM capability + the jurisdiction legal-framings service.
**Track**: Cross-repo — `luqen` core (MCP tool catalogue) + llm (`generate-fix` wiring) + `luqen-wordpress` (WP-block-aware fix path surfaced through the same tools)
**Depends on**: Phase 78 (sequenced after; functionally independent — second developer track, parallelizable with Phase 79). Independent of Phases 81/82.
**Requirements**: MCPFIX-01, MCPFIX-02, MCPFIX-03, MCPFIX-04, MCPFIX-05
**Success Criteria** (what must be TRUE):
  1. An agent/IDE connected to the Luqen MCP server invokes a tool to scan a URL/page/HTML and receives structured accessibility findings
  2. An agent invokes a tool to generate a source-level fix for a finding and receives the proposed diff/snippet, an explanation, and the WCAG criterion
  3. A fix-tool response carries the applicable 58-jurisdiction legal context/framing for the finding, and can return WordPress-block-aware (Gutenberg) fixes through the same path
  4. The MCP fix tools enforce existing auth (OAuth2 JWT) + RBAC + org scoping (`mcp.use`) and NEVER apply changes themselves — they return drafts a human/agent reviews and merges
  5. Fix-tool output stays conservative — it frames suggestions as good-faith remediation drafts, never claiming the fix makes the site "compliant"
**Plans**: 3 plans (3 waves)
- [x] 80-01-PLAN.md — Extend llm generate-fix capability: echo wcagCriterion, emit diff, WP-Gutenberg prompt variant, surface on /api/v1/generate-fix
- [x] 80-02-PLAN.md — Dashboard MCP tool modules: dashboard_scan_page (SSRF-safe findings) + dashboard_generate_fix (diff + legalContext + conservative disclaimer)
- [x] 80-03-PLAN.md — Wire both tools into the dashboard MCP server under OAuth2/RBAC/mcp.use; end-to-end auth + never-apply tests; drift test green

### Phase 81: Jurisdiction legal-exposure scoring (FLAGSHIP)
**Goal**: An executive viewing a site, a scan, or a whole portfolio sees a single conservative legal-exposure indicator that fuses scan findings with the site's jurisdiction framing and real lawsuit/deadline data — EU/EAA applicability, high-filing US states (NY/FL/IL), and ADA Title II 2027/2028 deadline countdowns. It is explicitly an EXPOSURE indicator (never "compliant", never an assertion of fault), surfaced per-site in both the dashboard and the WordPress plugin, with a documented, disclaimed model. Built on existing scan results + per-scan legal framing + lawsuit/deadline data.
**Track**: Cross-repo — `luqen` platform (exposure model + dashboard per-site + portfolio/fleet view) + `luqen-wordpress` (per-site exposure indicator in the plugin dashboard)
**Depends on**: Phase 78. The flagship; sequenced before Phase 82 because the digest reports the exposure trend this phase produces. Independent of the developer tracks (79, 80).
**Requirements**: EXPO-01, EXPO-02, EXPO-03, EXPO-04, EXPO-05
**Success Criteria** (what must be TRUE):
  1. A user viewing a site/scan sees a conservative legal-exposure indicator derived from scan findings + the site's selected jurisdiction framing, explicitly framed as exposure — never "compliant" and never asserting fault
  2. The indicator reflects jurisdiction-specific drivers — EU/EAA applicability, high-filing US states (NY/FL/IL), and ADA Title II 2027/2028 deadline countdowns where applicable
  3. A user can open a portfolio/fleet view that ranks sites by their exposure indicator
  4. A WordPress admin sees the per-site exposure indicator in the plugin dashboard
  5. The exposure model and its disclaimers are documented and conservative (transparency + good-faith framing, explicit "not legal advice")
**Plans**: 4 plans (4 waves)
- [ ] 81-01-PLAN.md — Pure deterministic legal-exposure model (band/drivers/asOf/disclaimer) + tests (foundation)
- [ ] 81-02-PLAN.md — Dashboard surfaces: exposure card + report-detail wiring + fleet column/ranking + 6-locale i18n + CSS
- [ ] 81-03-PLAN.md — Public methodology page + route + GET /api/v1/fleet exposure field (WP-consumed)
- [ ] 81-04-PLAN.md — WordPress per-site exposure indicator (separate repo) + blocking wp-test LXC UAT
**UI hint**: yes

### Phase 82: Scheduled executive digest
**Goal**: An admin can schedule a recurring (weekly/monthly) executive digest for an org or site that summarizes "what changed / what's at risk" since the last period — new vs fixed findings, the exposure trend (from Phase 81), and deadline countdowns — delivered over the existing notify channels (email/Slack/Teams) with a board-ready PDF, and a per-site WordPress digest reusing WP company-info. All in conservative framing. Built on existing notify plugins + report/fleet PDF pipelines + WP company-info.
**Track**: Cross-repo — `luqen` platform (scheduler + digest builder + notify delivery + board PDF) + `luqen-wordpress` (per-site digest reusing WP company-info / per-site master data)
**Depends on**: Phase 81 — the digest reports the legal-exposure trend that Phase 81 produces, so it sequences LAST. Builds on the existing notify (email/Slack/Teams) + report/fleet PDF pipelines.
**Requirements**: DIGEST-01, DIGEST-02, DIGEST-03, DIGEST-04, DIGEST-05
**Success Criteria** (what must be TRUE):
  1. An admin can schedule a recurring (weekly/monthly) executive digest for an org or site
  2. The digest summarizes "what changed / what's at risk" since the last period — new vs fixed findings, exposure trend, and deadline countdowns — in the conservative framing (never "compliant")
  3. The digest is delivered via the existing notify channels (email / Slack / Teams)
  4. An admin can download or attach a board-ready PDF export of the digest
  5. A WordPress site produces a per-site digest reusing WP company-info / per-site master data
**Plans**: 6 plans (6 waves)
- [ ] 82-01-PLAN.md — DB foundation: digest_schedules migration 088 + repository + digest.manage permission + adapter wiring
- [ ] 82-02-PLAN.md — Digest builder: buildDigest period-diff (new/fixed per-criterion) + exposure trend (band+direction) + explicit no-scan state
- [ ] 82-03-PLAN.md — Delivery: board-ready PDF + inline email body + digest sweep scheduler with isolated per-channel fan-out (email/Slack/Teams)
- [ ] 82-04-PLAN.md — Dashboard admin UX: /admin/digest-schedules CRUD + digest view + PDF download + rpt-digest partials + sidebar + 6-locale i18n
- [ ] 82-05-PLAN.md — API + wiring: GET /api/v1/digest endpoint + server.ts route registration + digest sweep startup + openapi/rbac drift regen
- [ ] 82-06-PLAN.md — WordPress per-site digest (separate repo): Luqen_Digest_Page + fetch_digest + company-info header + blocking wp-test LXC Playwright UAT
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 78 (done) → 79 → 80 → 81 → 82

**Dependency / parallelism notes:**
- **Two independent developer tracks** — Phase 79 (CI gate) and Phase 80 (MCP fix tools) share no dependency and can run concurrently after Phase 78.
- **Executive tracks are sequenced** — Phase 81 (flagship exposure scoring) MUST precede Phase 82 (digest), because the digest reports the exposure trend Phase 81 produces.
- Every phase is cross-repo (`luqen` + `luqen-wordpress`), with the WordPress-leaned SMB surface called out in each phase's scope and success criteria.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 78. Anti-overlay positioning | v3.5.0 | 1/1 | ✅ Done | 2026-06-01 |
| 79. CI regression gate | v3.5.0 | 3/3 | Complete   | 2026-06-07 |
| 80. MCP fix tools for coding agents | v3.5.0 | 3/3 | Complete   | 2026-06-07 |
| 81. Jurisdiction legal-exposure scoring | v3.5.0 | 0/4 | Planned | - |
| 82. Scheduled executive digest | v3.5.0 | 0/5 | Planned | - |

---

## Next Milestone: v3.6.0 Agent surface + semantic depth

**Goal:** Two large, mostly-independent efforts that deepen the product where it's genuinely thin — an org-aware agent surface, and the semantic (vision) accessibility checks that no static scanner can do.

**Status:** IN PROGRESS (started 2026-06-02; vision adapter + TTS + WP vision mirror shipped). Single-tier confirmed — do NOT build on or extend the dormant Free/Pro/Agency surfaces. Full detail of remaining items lives in `.planning/NEXT-SESSION-PROMPT.md`.

**Named follow-on milestones (out of scope this wave):** native mobile app testing; managed/guided expert-audit service; moats A2 (deepen PR fixes), A5 (fleet fix-once-apply-everywhere), B3 (remediation-velocity KPIs).
