# Roadmap: Luqen

## Milestones

- ✅ **v2.7.0 – v3.0.0** — Phases 01-33 (shipped) — see `milestones/` archives
- ✅ **v3.1.0 Agent Companion v2 + Tech Debt & Docs** — Phases 34-42 (shipped)
- ✅ **v3.2.0 – v3.4.0 WP Plugin, UI Revision, LLM Cost Telemetry** — Phases 43-77 (shipped directly to master)
- ✅ **v3.5.0 Anti-overlay wedge — dev + exec first wave** — Phases 78-82 (shipped 2026-06-15)
- ✅ **v3.6.0 Agent surface + semantic depth** — shipped 2026-09-04 directly to master (no numbered phases — vision adapter + `analyse-visual`, companion multimodal image upload + TTS, WP vision mirror, C#2 VPAT elevation)
- ✅ **v3.7.0 AI output quality — eval harness + labelled reference sets** — Phases 83-86 (shipped 2026-09-07; archived 2026-09-28)
- ✅ **v3.8.0 Mark as false positive** — Phases 87-89 (shipped 2026-10-13; prod 23c40aaf) — dormant-by-choice after close (closure ruling 2026-10-12)
- ✅ **v3.9.0 Dismissal follow-through** — Phases 90-92 (shipped 2026-10-21; PRs #8-#14)
- 🚧 **v3.10.0 Dismissal and session follow-ups** — Phases 93-97 (opened 2026-10-22; scope approved by the owner 2026-10-21)

> **Milestone redefined (v3.5.0).** The original v3.5.0 "Commercial positioning & agency monetization" (Pro/Agency gates, credit-metered fixes) was **reversed by the single-product decision** ([[project_single_tier_decision]]). Only its Phase 78 (anti-overlay positioning) survives. The dead monetization phases that were numbered 79-82 (GATE/CREDIT/AGENCY/PRICE) are **retired** — their concepts must NOT be reused. v3.5.0 is now the **Anti-overlay wedge**: convert the verified 2026-06 market-positioning brief into product. Phase numbering continues from 78 (no reset).

---

## Current Milestone: v3.10.0 Dismissal and session follow-ups

**Goal:** Close the follow-ups v3.9.0 recorded, so that dismissal, permission and assistant-session behaviour is accurate on every surface and API, and make the trusted-proxy setting part of a normal install. No new product features. Two owner rulings shape the work: AI fix output requires `llm.view` on every path, and JSON APIs omit element selectors for callers without technical-details permission.

**Granularity:** coarse · **Phases:** 5 (93-97) · **Requirements:** 26/26 mapped

**Standing rules for every phase (not repeated per criterion):**

- Every new guard is watched failing before it lands: break the guard, confirm that ONLY the targeted test goes red (name the isolation command and read the test NAME on the result line, not the count), then restore.
- Every phase ships the same way: merged to master via PR, CI green, auto-deploy to prod succeeded (the deploy drains in-flight scans first, up to 30 minutes), and a read-back on prod of what the system now holds, not just the deploy exit code.
- Planning artifacts under `.planning/` are not committed (`commit_docs: false`); copy new SUMMARY/VERIFICATION files out of any executor worktree before it is removed.
- This repository is public: roadmap, state and summaries describe behaviour only. Detail on any unfixed weakness stays in gitignored planning files.

## Phases

- [x] **Phase 93: Entitlement and API contract** - AI fix output requires `llm.view` on every path, and JSON APIs omit element selectors for callers without technical-details permission, documented as a contract change (completed 2026-10-22)
- [x] **Phase 94: Assistant session consistency** - Assistant conversation writes stay consistent after an abort or a delete (completed 2026-10-22)
- [ ] **Phase 95: Dismissal, audit and team follow-ups** - Dismissal copy, the Audit Log, actor labels, the disabled Dismiss button and the team page say and do what the product does
- [ ] **Phase 96: Trusted-proxy install and docs** - The trusted-proxy setting is part of a normal install and is documented
- [ ] **Phase 97: Owner UAT pack** - The owner can walk every v3.9.0 open check and every user-visible change of this milestone on fixtures, and the fixtures are cleaned up afterwards

## Phase Details

### Phase 93: Entitlement and API contract

**Goal**: AI fix output and technical element data reach only the callers entitled to them, on every API and tool path, and the API contract says so.
**Depends on**: Nothing (first phase; carries the two owner rulings, so it ships first)
**Requirements**: ENT-01, ENT-02, ENT-03, API-01, API-02, API-03, API-04
**Success Criteria** (what must be TRUE):

  1. A caller without `llm.view` never receives LLM-generated fix output from any entry point that can produce one; an inventory of entry points is taken first and each one is pinned by a test, so the rule matches the report page everywhere
  2. A caller holding `issues.fix` without `llm.view` still gets the deterministic pattern hint on MCP, the same answer the report page gives, and the MCP fix tool stays listed for that caller
  3. The scan-issues endpoint, the scan-detail endpoint (for the issues it embeds) and the GraphQL `scanIssues` query omit element selectors, and any other field the report page hides, for callers without `reports.view_technical`; all three paths and the report page apply one shared redaction rule
  4. A request authenticated with an org API key gets the redaction that key's resolved permissions give, pinned by a test
  5. The permission docs and the MCP tool description state the `llm.view` rule, and the selector omission is recorded as an API contract change in the OpenAPI spec (field optionality and a description), the API docs and the CHANGELOG

**Plans**: 5/4 plans complete (waves: 1 = 93-01 + 93-02, 2 = 93-03, 3 = 93-04)

Plans:
**Wave 1**
- [x] 93-01-PLAN.md — AI fix output needs `llm.view` on MCP and the assistant; pattern hint for `issues.fix` holders; entry-point inventory guard (ENT-01..03)
- [x] 93-02-PLAN.md — One shared technical-details helper; REST data API, report page and drilldown on it; API-key resolution pinned (API-01, API-02, API-03, API-04)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 93-03-PLAN.md — GraphQL, MCP data tools and resource, issues Excel export and dismissals list on the helper (API-01, API-03, API-04)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 93-04-PLAN.md — OpenAPI/MCP/RBAC snapshots regenerated, CHANGELOG, permission, MCP, REST and GraphQL docs (ENT-03, API-04)

### Phase 94: Assistant session consistency

**Goal**: An assistant conversation stays consistent after an abort or a delete: nothing is revived in, written to, or kept from a conversation or stream that has ended.
**Depends on**: Nothing functionally (independent of Phase 93; sequenced after it because Phase 93 carries the owner rulings)
**Requirements**: SESS-01, SESS-02, SESS-03
**Success Criteria** (what must be TRUE):

  1. Deleting an assistant conversation ends it for good: none of its paused actions or messages can be reopened, resumed or returned to pending afterwards, including after a refused confirmation
  2. After an assistant answer is aborted, a second stream of the same question starts clean and the aborted stream writes nothing further: no orphaned tool result and no kept stopped partial answer
  3. Each assistant write path (the answer stream and the edit and retry branches) refuses a deleted conversation by its own check, so correctness does not depend on the route-level not-found answer

**Plans**: 3/3 plans complete (waves 1, 2, 3; sequential: shared store files)

Plans:
- [x] 94-01-PLAN.md — A deleted conversation stays ended at the store: no refused confirmation returns its action to pending; the stream route and the edit and retry transactions refuse it (SESS-01, SESS-03)
- [x] 94-02-PLAN.md — The D-02 design recorded first, then migration 094 and the store's run token: a row of a replaced run is refused in the insert's transaction (SESS-02, SESS-03)
- [x] 94-03-PLAN.md — runTurn writes every row through the run token, the model input leaves out unanswered tool calls, and the phase is documented (SESS-02, SESS-03)

**Note**: the design decision for SESS-02 (assistant rows are tied to the stream that writes them) is recorded in the phase before any code relies on it.

### Phase 95: Dismissal, audit and team follow-ups

**Goal**: The wording of a dismissal, the Audit Log, actor labels, the disabled Dismiss button and the team page all say and do what the product actually does.
**Depends on**: Nothing functionally (independent of Phases 93 and 94)
**Requirements**: COPY-01, COPY-02, AUD-01, AUD-02, AUD-03, ACT-01, ACT-02, A11Y-01, TEAM-01, TEAM-02, TEAM-03, TEAM-04
**Success Criteria** (what must be TRUE):

  1. The dismiss dialog says a dismissal also applies to earlier completed scans of the site, and the matrix and compliance copy says a criterion stops failing only when nothing behind it remains; all six locales carry the new wording
  2. An org Owner who holds `audit.view` sees an Audit Log menu entry without needing System settings; the Audit Log Action filter lists every dismissal action and shows the active filter instead of "All actions"; opening the Audit Log address without permission renders the dashboard error page, not a raw JSON body
  3. An API-key actor reads the same on the report page, in the Excel export's "Dismissed By" column and in the Audit Log Actor column; the raw stored identifier never appears
  4. A greyed-out Dismiss button shows its reason in a form touch and keyboard users can see, not only as a hover tooltip, checked by eye at phone width and by keyboard
  5. On the team page, Add Member lists the org users who are in no team, Load More carries a real limit, the "No members yet." row disappears after a member is added, and the team form's org option says an empty value places the team in the current organization

**Plans**: 3 plans (waves: 1 = 95-01, 2 = 95-02, 3 = 95-03; sequential because each touches the six locale files)
**UI hint**: yes

Plans:
**Wave 1**
- [ ] 95-01-PLAN.md — Shared actor label on the Excel export and the report page; visible reason on a greyed Dismiss; dismissal copy in six locales (ACT-01, A11Y-01, COPY-01, COPY-02)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 95-02-PLAN.md — Audit Log: Owner menu entry, Actor column on the shared label, dismissal actions in the filter, HTML error page, real Load More limit (AUD-01, AUD-02, AUD-03, ACT-02, TEAM-02)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 95-03-PLAN.md — Team page (teamless members, request matches the list, empty row, org option), browser check at 375 px and by keyboard with screenshots, docs and CHANGELOG (TEAM-01, TEAM-03, TEAM-04, A11Y-01)

### Phase 96: Trusted-proxy install and docs

**Goal**: The trusted-proxy setting is part of a normal install and is documented, so an operator no longer depends on a hand-written service override kept outside the repo.
**Depends on**: Nothing functionally (independent of Phases 93-95)
**Requirements**: OPS-01, OPS-02
**Success Criteria** (what must be TRUE):

  1. An operator running `install.sh` can give a trusted-proxy list, and gets the loopback, link-local and unique-local default when giving none, shown by an installer run that reads back the resulting setting
  2. The install and security docs state when to set the list, its default, the refusal rules (no trust-all lists, the public-address ceiling) and the accepted residual on private networks, and an agent other than the author can follow them cold
  3. Production's trusted-proxy setting is reconciled with what the installer produces, confirmed by comparing without printing the service unit's environment

**Plans**: TBD

### Phase 97: Owner UAT pack

**Goal**: The owner can walk the v3.9.0 checks that are still open and every user-visible change of this milestone on fixtures in a dedicated UAT org, record a verdict per check, and have the fixtures removed afterwards.
**Depends on**: Phases 93, 94, 95 and 96 (the pack exercises their user-visible changes)
**Requirements**: UAT-01, UAT-02
**Success Criteria** (what must be TRUE):

  1. A UAT fixture pack exists, built like the v3.9.0 pack: it writes only into the dedicated UAT org, keeps fixture ids outside the repo, and ships a dry-run and a real cleanup script
  2. The pack covers the v3.9.0 owner checks (a)-(g) and each user-visible change of Phases 93-96; check 2 includes an org switch
  3. The owner's verdict on each check is recorded together with its channel (who answered, where, when)
  4. Cleanup runs only after the owner says the walkthrough is done, and a read-back confirms the UAT org holds no fixture from the pack

**Plans**: TBD

## Progress (v3.10.0)

**Execution Order:** 93 → 94 → 95 → 96 → 97 (93-96 are functionally independent of each other; 97 must follow all four)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 93. Entitlement and API contract | v3.10.0 | 0/0 | Not started | - |
| 94. Assistant session consistency | v3.10.0 | 0/0 | Not started | - |
| 95. Dismissal, audit and team follow-ups | v3.10.0 | 0/0 | Not started | - |
| 96. Trusted-proxy install and docs | v3.10.0 | 0/0 | Not started | - |
| 97. Owner UAT pack | v3.10.0 | 0/0 | Not started | - |

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

## Completed Milestone: v3.7.0 AI output quality — eval harness + labelled reference sets

<details>
<summary>✅ v3.7.0 (Phases 83-86) — SHIPPED 2026-09-07, archived 2026-09-28</summary>

- [x] Phase 83: Labelled reference sets (3/3 plans) — completed 2026-09-05
- [x] Phase 84: Scoring harness (4/4 plans) — completed 2026-09-06
- [x] Phase 85: Pre-registered decision bars (3/3 plans) — completed 2026-09-06
- [x] Phase 86: Recorded baseline (5/5 plans) — completed 2026-09-07; verification gap closed 2026-09-28 (PR #81)

Full phase details, success criteria and plan lists: `milestones/v3.7.0-ROADMAP.md`.
Requirements (16/16 Complete): `milestones/v3.7.0-REQUIREMENTS.md`.

</details>

---

## Completed Milestone: v3.8.0 Mark as false positive

<details>
<summary>✅ v3.8.0 Mark as false positive (Phases 87-89) — SHIPPED 2026-10-13</summary>

- [x] Phase 87: Dismissal store, domain model and permission (5/5 plans) — completed 2026-10-08
- [x] Phase 88: Dismissals applied on every surface (19/19 plans) — completed 2026-10-12 (PR #1)
- [x] Phase 89: Dismissal UI, dark launch and role grant (11/11 plans) — completed 2026-10-13 (PRs #2, #4, #5; grant on Alessandro's direct OK)
- [x] Quick 261013-dr7: review security fixes (CR-01 global-role shadowing, SC2 system-org Dismissed section, CSRF on mark/revoke) — PR #6, 23c40aaf

Full details: `milestones/v3.8.0-ROADMAP.md`, `milestones/v3.8.0-REQUIREMENTS.md`, phases in `milestones/v3.8.0-phases/`.

</details>

## Completed Milestone: v3.9.0 Dismissal follow-through

<details>
<summary>✅ v3.9.0 Dismissal follow-through (Phases 90-92) — SHIPPED 2026-10-21</summary>

- [x] Phase 90: GraphQL createScan starts scans (7/7 plans) — completed 2026-10-15 (PR #8)
- [x] Phase 91: Dismissal and permission hardening (41/41 plans) — completed 2026-10-21 (PRs #9-#13, plus the HARD-02 brand drilldown closure)
- [x] Phase 92: Dismissal user documentation (9/9 plans) — completed 2026-10-21 (PR #14); every procedure read cold by a non-author
- [x] Quick 261020-izd: fix suggestions open for issues.fix holders without llm.view — PR #12

Full details: `milestones/v3.9.0-ROADMAP.md`, `milestones/v3.9.0-REQUIREMENTS.md`.

</details>
