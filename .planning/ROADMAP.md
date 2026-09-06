# Roadmap: Luqen

## Milestones

- ✅ **v2.7.0 – v3.0.0** — Phases 01-33 (shipped) — see `milestones/` archives
- ✅ **v3.1.0 Agent Companion v2 + Tech Debt & Docs** — Phases 34-42 (shipped)
- ✅ **v3.2.0 – v3.4.0 WP Plugin, UI Revision, LLM Cost Telemetry** — Phases 43-77 (shipped directly to master)
- ✅ **v3.5.0 Anti-overlay wedge — dev + exec first wave** — Phases 78-82 (shipped 2026-06-15)
- ✅ **v3.6.0 Agent surface + semantic depth** — shipped 2026-09-04 directly to master (no numbered phases — vision adapter + `analyse-visual`, companion multimodal image upload + TTS, WP vision mirror, C#2 VPAT elevation)
- 🚧 **v3.7.0 AI output quality — eval harness + labelled reference sets** — Phases 83-86 (in progress)

> **Milestone redefined (v3.5.0).** The original v3.5.0 "Commercial positioning & agency monetization" (Pro/Agency gates, credit-metered fixes) was **reversed by the single-product decision** ([[project_single_tier_decision]]). Only its Phase 78 (anti-overlay positioning) survives. The dead monetization phases that were numbered 79-82 (GATE/CREDIT/AGENCY/PRICE) are **retired** — their concepts must NOT be reused. v3.5.0 is now the **Anti-overlay wedge**: convert the verified 2026-06 market-positioning brief into product. Phase numbering continues from 78 (no reset).

---

## Completed Milestone: v3.5.0 Anti-overlay wedge — dev + exec first wave

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
- [x] **Phase 82: Scheduled executive digest** — recurring "what changed / what's at risk" digest over notify (email/Slack/Teams) + board-ready PDF + per-site WP digest, reporting the exposure trend. (completed 2026-06-11)

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
- [x] 82-01-PLAN.md — DB foundation: digest_schedules migration 088 + repository + digest.manage permission + adapter wiring
- [x] 82-02-PLAN.md — Digest builder: buildDigest period-diff (new/fixed per-criterion) + exposure trend (band+direction) + explicit no-scan state
- [x] 82-03-PLAN.md — Delivery: board-ready PDF + inline email body + digest sweep scheduler with isolated per-channel fan-out (email/Slack/Teams)
- [ ] 82-04-PLAN.md — Dashboard admin UX: /admin/digest-schedules CRUD + digest view + PDF download + rpt-digest partials + sidebar + 6-locale i18n
- [x] 82-05-PLAN.md — API + wiring: GET /api/v1/digest endpoint + server.ts route registration + digest sweep startup + openapi/rbac drift regen
- [x] 82-06-PLAN.md — WordPress per-site digest (separate repo): Luqen_Digest_Page + fetch_digest + company-info header + blocking wp-test LXC Playwright UAT
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
| 81. Jurisdiction legal-exposure scoring | v3.5.0 | 4/4 | Complete | 2026-06-11 |
| 82. Scheduled executive digest | v3.5.0 | 5/6 | Complete    | 2026-06-11 |

---

## Completed Milestone: v3.6.0 Agent surface + semantic depth

**Goal:** Two large, mostly-independent efforts that deepen the product where it's genuinely thin — an org-aware agent surface, and the semantic (vision) accessibility checks that no static scanner can do.

**Status:** COMPLETE — shipped 2026-09-04. Both owner-gated items cleared that day: the human UAT of companion image upload + TTS was run on a real device and PASSED, and the owner cleared the C#2 legal sign-off gate. Note for anyone relying on the C#2 "Supports-from-vision" elevation in a conformance document: that gate was cleared by the product owner, not by external legal counsel. Released as v3.6.0 (package.json 3.4.0 -> 3.6.0, closing a two-milestone version drift — 3.5.0 never bumped). Was CODE-COMPLETE 2026-07-18. All development items shipped: vision adapter + analyse-visual capability, core `captureVisualContext()` (incl. per-image bytes for the alt-text check), dashboard vision pass (heading-semantics + alt-text), companion multimodal image upload + TTS, WP vision mirror (enterprise badge v0.27.0 + standalone client-side vision pass v0.28.0), C#2 conservative "Supports-from-vision" VPAT elevation, `llm_analyse_visual` MCP tool. 2026-07-18: fixed Gemini streaming (CRLF SSE frames, `601548cf`) which had blanked companion turns since gemini became the agent-conversation primary; automated live UAT of image upload + TTS wiring green. Remaining before closing the milestone (user-gated): human UAT of image upload + TTS on a real browser/device, and LEGAL sign-off on the C#2 "Supports-from-vision" wording. Single-tier confirmed — do NOT build on or extend the dormant Free/Pro/Agency surfaces.

**Named follow-on milestones (out of scope this wave):** native mobile app testing; managed/guided expert-audit service; moats A2 (deepen PR fixes), A5 (fleet fix-once-apply-everywhere), B3 (remediation-velocity KPIs).

---

## Current Milestone: v3.7.0 AI output quality — eval harness + labelled reference sets

**Approved** 2026-09-04 (proposed by luqen, approved via the orchestrator; on the owner's register). **Roadmapped** 2026-09-05.

**Goal:** Luqen has NO evaluation infrastructure for ANY LLM capability. Build the instrument for
the two whose output is DURABLE — `generate-fix`, which ships into someone's source code, and
`analyse-visual`, which feeds a VPAT/ACR conformance document with legal weight — so a model
decision can be closed on evidence instead of on n=4. On 2026-09-04 a three-model comparison had
to be justified on 4 hand-scraped WCAG violations and 4 twenty-pixel icons; that was enough to
recommend a switch for six capabilities and to REFUSE it for `analyse-visual`, because n=4 is not
an evidence base for a conformance input. Everything else degrades gracefully or is read once and
discarded, and stays out of scope.

**Granularity:** coarse · **Phases:** 4 (83-86, new) · **Requirements:** 16/16 mapped ✓

**Hard constraints threaded through every phase:**
- **Pre-registration, not post-hoc fitting.** The tolerated non-inferiority margin and the
  `analyse-visual` bar are recorded and encoded BEFORE any measurement exists and MUST NOT be
  rewritten once one does — a bar edited after its result is not a bar.
- **The harness must be breakable.** Poison items (a bad fix, a wrong alt-text) must be scored DOWN
  by a committed, evidenced break-test before any green result from the runner is trusted. A
  quality gate nobody has watched fail measures nothing.
- **Ground-truth provenance is mandatory, per item.** Unattributed ground truth is a rubric fitted
  to whoever built it — the loader refuses an item that has none.
- **`analyse-visual` errors are asymmetric.** A false ISSUE is cheap (a human reviews it); a false
  PASS is expensive (it can elevate a VPAT criterion to "Supports" in a document someone relies on
  legally). Bar: non-inferior AND zero increase in false-pass — a candidate that scores better on
  average while over-elevating more often FAILS.
- **Reuse only.** Built on the existing `@luqen/llm` capability-execution engine and provider
  adapters — no new frameworks, no new vendor dependency.

**Cross-cutting trap to design around:** `parseGenerateFixResponse` and `parseAnalyseVisualResponse`
never throw — they catch and return empty strings. The harness persists the raw model response per
item so an all-empty parse is distinguishable from a genuine low score (HARNESS-06).

**Closes:** the READY-BUT-UNAPPLIED pin change in `docs/guides/llm-model-selection.md`. That
recommendation stands unapplied until the owner lifts the live-config permission — this milestone
must NOT become the reason to apply it early, and `analyse-visual` stays on gemini-2.5-flash for the
duration of this milestone.

**Ranked next and proposed as v3.8.0:** behavioral a11y testing beyond Pa11y (Playwright keyboard /
dynamic / a11y-tree). Bigger product moat, plan already decided, but it ADDS a capability while this
milestone protects the ones already shipped and relied upon.

## Phases

**Phase Numbering:**
- Integer phases (83, 84, 85, 86): Planned milestone work, continuing from Phase 82 (v3.5.0's last
  numbered phase — v3.6.0 shipped directly to master with no numbered phases)
- Decimal phases (e.g. 84.1): Urgent insertions (marked INSERTED)

- [x] **Phase 83: Labelled reference sets** — Versioned, provenance-attributed WCAG-violation and image reference sets, each carrying the poison items the harness break-test needs.
- [x] **Phase 84: Scoring harness** — A runner that scores any registered model against both sets, reports asymmetric `analyse-visual` errors separately, records its own run-function, and is proven to score poison items down before any green result is trusted.
- [x] **Phase 85: Pre-registered decision bars** — The non-inferiority margin and the `analyse-visual` zero-false-pass bar, recorded and encoded into the runner's PASS/FAIL/UNDERPOWERED verdict, before any measurement exists.
- [ ] **Phase 86: Recorded baseline** — The current production pins of `generate-fix` and `analyse-visual`, baselined and committed with run-to-run variance, before any candidate model is measured.

## Phase Details

### Phase 83: Labelled reference sets
**Goal**: A maintainer has versioned, provenance-attributed reference sets for both durable capabilities — real WCAG violations with known-good fixes, and a labelled image set spanning photographs, charts, decorative icons and complex graphics — each carrying the poison items the harness will later be proven against.
**Depends on**: Nothing (first phase this milestone)
**Requirements**: EVALSET-01, EVALSET-02, EVALSET-03, EVALSET-04, EVALSET-05
**Success Criteria** (what must be TRUE):
  1. A maintainer can load a versioned reference set of real WCAG violations, each item carrying the offending source snippet, the failing success criterion, and a known-good fix
  2. A maintainer can load a versioned labelled image set spanning photographs, charts, decorative icons, and complex graphics, each item carrying attributed alt-text ground truth and an explicit expected VPAT-relevant verdict (issue vs pass) recorded as data, not inferred later from a score
  3. Loading an item that lacks attributed provenance (where the label came from, who stands behind it, and when) is REFUSED by the loader, not silently accepted
  4. Both sets contain deliberately-wrong poison items (a bad fix, a wrong alt-text), explicitly flagged as such in the data, ready for Phase 84's break-test
**Plans**: 3 plans (waves: 83-01 alone in wave 1; 83-02 and 83-03 parallel in wave 2)
- [x] 83-01-PLAN.md — Reference-set schema, loader, and its six refusals, proven on a one-item seed of each set and then broken
- [x] 83-02-PLAN.md — WCAG-fix set content: ≥15 items each citing BOTH a Failure and a Sufficient Technique, plus poison items
- [x] 83-03-PLAN.md — Labelled image set: openly-licensed assets with a stated licence, expectedVerdict as data, poison including a false-PASS (has a blocking licence checkpoint)

### Phase 84: Scoring harness
**Goal**: A maintainer can run a single harness against any registered model for either durable capability and receive per-item and aggregate scores worth trusting — because the harness has already been watched to fail on poison data before any green result from it is believed.
**Depends on**: Phase 83 (needs both reference sets, including their poison items, to run against and to break-test)
**Requirements**: HARNESS-01, HARNESS-02, HARNESS-03, HARNESS-04, HARNESS-05, HARNESS-06
**Success Criteria** (what must be TRUE):
  1. A maintainer runs the harness against any registered model for `generate-fix` and receives per-item and aggregate scores
  2. A maintainer runs the harness against any registered model for `analyse-visual` and receives per-item and aggregate scores, with false-PASS and false-ISSUE counts reported separately — never fused into one accuracy number, because the two errors have different costs
  3. A maintainer can point at a committed break-test whose recorded output shows the harness scoring the poison items down — this evidence exists WITH or BEFORE the first trusted green result from the harness, never after
  4. Every harness run records what its result is a function of (model id, prompt version, temperature, harness version, set version, timestamp), and the runner refuses to compare two runs whose function differs
  5. A maintainer inspecting any scored item can see the raw model response next to the parsed score, so an all-empty parse (the silent-catch trap in `parseGenerateFixResponse`/`parseAnalyseVisualResponse`) is distinguishable from a genuine low score
**Plans**: 4 plans (3 waves: 84-01 alone in wave 1; 84-02 and 84-03 parallel in wave 2; 84-04 in wave 3)
- [x] 84-01-PLAN.md — Raw-response seam through production (HARNESS-06) + end-to-end tracer on one WCAG item + the generate-fix scorer
- [x] 84-02-PLAN.md — Run function: computed prompt version, single-source temperature, and the refusal to compare across a differing run (HARNESS-04)
- [x] 84-03-PLAN.md — analyse-visual scorer with false-PASS/false-ISSUE never fused (HARNESS-03) + the committed poison break-test (HARNESS-05), landing before any full-set green
- [x] 84-04-PLAN.md — Full-set runner, replay fixtures, per-item + aggregate report, and the `luqen-llm eval` CLI (HARNESS-01/02)

### Phase 85: Pre-registered decision bars
**Goal**: The tolerated margins for both durable capabilities are locked into the repo and into the runner's verdict logic before the first real measurement exists, so neither bar can be fitted to a result once one is produced.
**Depends on**: Phase 84. The bars are encoded into the runner's comparison/verdict logic (needs the runner to exist), and are deliberately locked in BEFORE Phase 86 produces the first baseline measurement — a stronger guarantee than the literal requirement text ("before any candidate measurement"), chosen so that no measurement of any kind, baseline included, can shape the margin.
**Requirements**: BARS-01, BARS-02, BARS-03
**Success Criteria** (what must be TRUE):
  1. The tolerated non-inferiority margin for text capabilities, together with the number of items required to detect it, is recorded in the repo before any baseline or candidate measurement exists
  2. The `analyse-visual` bar — non-inferior AND zero increase in false-pass — is encoded in the runner, which emits PASS/FAIL against it rather than leaving a reader to judge
  3. Every verdict the runner emits carries a REQUIRED power field — bar, measured value, the variance ASSUMPTION the sample size came from, and the observed variance — and a run whose observed variance exceeds that assumption reports UNDERPOWERED and can never report PASS. The field is structurally non-omittable (a required field, not a habit): a rule that lives only in a plan does not fire at the moment of use
**Known circularity — must be handled in this phase, not discovered in Phase 86**: SC1 asks for the number of items required to detect the margin. A power calculation needs a variance estimate, and the only variance estimate this milestone produces is BASELINE-02's run-to-run variance, which does not exist until Phase 86 — after the bars are locked. Do NOT resolve this by moving the baseline earlier; that reintroduces exactly the fitting risk Phase 85 exists to prevent. Resolve it by recording the sample size WITH the variance ASSUMPTION it was derived from, labelled as an assumption rather than a measurement. Phase 86 then checks the observed variance against that assumption and reports whether the pre-registered n is sufficient — **the margin itself stays fixed either way**. An n that turns out too small makes results UNDERPOWERED; it never relaxes the bar.
**Plans**: 3 plans (3 waves, strictly sequential — the phase's guarantee is an ORDERING one: the bar file is committed before any code exists that could judge a measurement against it, and every later surface consumes the previous one's interface)
- [x] 85-01-PLAN.md — The pre-registered bar file committed alone before anything that can judge, plus its loader, its set-registration refusals, and a digest pin that makes a later edit fail a test
- [x] 85-02-PLAN.md — Tracer: one `generate-fix` verdict end to end, the hand-rolled arithmetic pinned against hand-checkable values, and a PASS the compiler refuses to build without a sufficient power assessment
- [x] 85-03-PLAN.md — The `analyse-visual` bar as two side-by-side mechanisms (count gate + statistical clause), the `eval verdict` CLI, and a guide stating what each verdict licenses

### Phase 86: Recorded baseline
**Goal**: The CURRENT production pins of `generate-fix` and `analyse-visual` are baselined and committed against the already-fixed bars, with known run-to-run variance, so any future candidate is judged against noise and a real reference point rather than against zero or against a bar that has already seen a result.
**Depends on**: Phase 85 (the bars must be fixed before this run exists, so the baseline cannot shape the margin) and, transitively, Phase 84 (needs the runner and its break-test evidence to produce a trusted result — HARNESS-05 lands with or before this phase's first green result)
**Requirements**: BASELINE-01, BASELINE-02
**Success Criteria** (what must be TRUE):
  1. A recorded baseline for the CURRENT production pins of both `generate-fix` and `analyse-visual` exists and is committed — before any candidate model is measured
  2. The baseline records what it is a function of (model, prompt version, temperature, harness version, date), so it cannot be confused with a measurement of a different environment
  3. A maintainer can re-run the baseline unchanged and read the harness's own run-to-run variance, so a future candidate's delta is judged against noise rather than against zero
  4. The observed run-to-run variance is checked against the variance ASSUMPTION Phase 85 recorded its sample size from, and the harness OUTPUTS the power verdict as a required field of every report — not as prose a future reader is trusted to remember — without altering the margin
  5. The power check is BROKEN and watched to fail: feed the harness an observed variance above the assumption and confirm the report flips to UNDERPOWERED and refuses PASS. A guard nobody has watched fire measures nothing
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 83 → 84 → 85 → 86

**Dependency / parallelism notes:**
- **Strictly sequential** — every phase in this milestone consumes an artifact or guarantee the previous phase produced (data → runner → locked bars → baseline). No two phases here are independent or parallelizable.
- The break-test evidence (HARNESS-05, produced in Phase 84) must exist WITH or BEFORE Phase 86 produces the first trusted green (baseline) result.
- The decision bars (Phase 85) are deliberately sequenced BEFORE the baseline (Phase 86) — not merely before a future candidate — so neither the non-inferiority margin nor the `analyse-visual` bar can be shaped by having already seen a real measurement.
- No phase in this milestone measures a candidate model — that is explicitly next-milestone work, once the instrument built here exists.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 83. Labelled reference sets | v3.7.0 | 3/3 | Complete | 2026-09-05 |
| 84. Scoring harness | v3.7.0 | 4/4 | Complete | 2026-09-06 |
| 85. Pre-registered decision bars | v3.7.0 | 3/3 | Complete | 2026-09-06 |
| 86. Recorded baseline | v3.7.0 | 0/TBD | Not started | - |
