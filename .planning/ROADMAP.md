# Roadmap: Luqen

## Milestones

- ✅ **v2.7.0 – v3.0.0** — Phases 01-33 (shipped) — see `milestones/` archives
- ✅ **v3.1.0 Agent Companion v2 + Tech Debt & Docs** — Phases 34-42 (shipped)
- ✅ **v3.2.0 – v3.4.0 WP Plugin, UI Revision, LLM Cost Telemetry** — Phases 43-77 (shipped directly to master)
- ✅ **v3.5.0 Anti-overlay wedge — dev + exec first wave** — Phases 78-82 (shipped 2026-06-15)
- ✅ **v3.6.0 Agent surface + semantic depth** — shipped 2026-09-04 directly to master (no numbered phases — vision adapter + `analyse-visual`, companion multimodal image upload + TTS, WP vision mirror, C#2 VPAT elevation)
- ✅ **v3.7.0 AI output quality — eval harness + labelled reference sets** — Phases 83-86 (shipped 2026-09-07; archived 2026-09-28)
- 🚧 **v3.8.0 Mark as false positive** — Phases 87-89 (in progress, opened 2026-10-08)

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

## Current Milestone: v3.8.0 Mark as false positive

**Goal:** A dashboard user can dismiss a scan finding they have verified is a false positive, with a required reason and a full audit trail, so it stops counting against the site everywhere a count, a score or a conformance document is produced, and stays dismissed on every later scan.

**Owner ruling:** approved by Alessandro 2026-10-08 via an AskUserQuestion card in Allanon's session, relayed to luqen by a2a 01M4DHK3ZWJJB7TBYHKWPNQSNT. WordPress mirror OUT. Alessandro gets a test link BEFORE it goes live.

**Granularity:** coarse · **Phases:** 3 (87-89) · **Requirements:** 18/18 mapped ✓ · **Research:** `.planning/research/v3.8.0-DISMISSAL-SURFACE-MAP.md` (file:line map at af2a526f — re-verify at plan time)

**Hard constraints threaded through every phase:**
- **Apply at read, never rewrite evidence.** Stored issues in `json_report` are never mutated. Dismissals are applied by one pure function before `normalizeReportData`; only the derived `scan_records` count columns are rewritten, and the raw (pre-dismissal) counts stay recoverable.
- **Safe in prod while dark.** Every master merge auto-deploys (the deploy drains in-flight scans first, PR #99). So every phase must be output-identical to today when no dismissal exists, and `issues.dismiss` must be unreachable by any customer identity until the final step of Phase 89.
- **Every surface is its own call site.** The surface map lists dozens of producers (render, ACR, exports, raw/bypass, column readers, both orchestrator paths). Each needs its own test. Do not count one as covered because a sibling is.
- **Break every guard in the phase that lands it.** For the exclusion, isolation and permission guards: remove the guard, watch the targeted tests go red and only those tests, record the command and its verbatim output in that phase's VERIFICATION, then restore. A later phase cannot capture that failure once the guard is in the tree.

**Phases (v3.8.0):**

- [ ] **Phase 87: Dismissal store, domain model and permission** — per-org dismissal store + history + audit, selector refusal, permission-gated mark/revoke API, and the pure apply + shared count functions. Nothing user-visible changes in prod.
- [ ] **Phase 88: Dismissals applied on every surface** — render paths, VPAT/ACR with per-criterion disclosure, exports, bypass surfaces, compliance matrices, stored count columns + recompute on mark/revoke + re-application at scan end on both orchestrator paths.
- [ ] **Phase 89: Dismissal UI, dark launch and role grant** — mark dialog with reason + preview, Dismissed section with revoke, 6-locale i18n, browser UAT; then the blocking test-link checkpoint with Alessandro, and the Owner/Admin grant as the last step.

### Phase 87: Dismissal store, domain model and permission
**Goal**: An authorised user can record, revoke and audit a false-positive dismissal for one finding on one org's site through a permission-gated API, and one pure function turns any stored report plus its active dismissals into a filtered report and the counts every later surface will use. Nothing that customers see changes.
**Depends on**: Nothing (first phase of v3.8.0)
**Requirements**: FP-01, FP-02, FP-03, FP-04, FP-05, FP-17
**Success Criteria** (what must be TRUE):
  1. A global admin can mark a finding as a false positive by (org, site URL, rule code, selector) with a reason, and the stored dismissal records the actor and timestamp. The API refuses an empty, whitespace-only or over-length reason. It also refuses a selector of `html`, `body` or empty with a message saying the selector cannot identify an element (FP-01, FP-04).
  2. Revoking a dismissal changes its state and keeps the record. Each mark and each revoke shows up in the append-only dismissal history (who, when, reason or comment, action) and in `/admin/audit` (FP-02, FP-03).
  3. `issues.dismiss` appears in the RBAC matrix (`docs:rbac` drift green). The mark and revoke routes each return 403 to a user without the permission, enforced by route-level `requirePermission`. Break-test: remove the preHandler from one route and watch only that route's permission tests go red. While dark, three paths must not yield the permission, each with its own test: an org role (no `DEFAULT_ORG_ROLES` set includes it, and an org Owner cannot add it to a custom org role through `admin.roles`), and an org-scoped API key (FP-17, precondition for FP-18).
  4. The pure apply function returns the filtered report plus the dismissed occurrences and never mutates its input (proved on a deep-frozen fixture). The one shared count function derives errors, warnings, notices and total from that result. With zero dismissals, the count function reproduces the existing stored counts on a corpus of real stored reports covering both standard and incremental scan shapes. Any mismatch blocks the phase, because it would shift every historical score the moment Phase 88 deploys (FP-05).
  5. Isolation break-test: a matching dismissal removes exactly its own occurrences. Weakening the match key (dropping org or site) turns red only the cross-org and cross-site isolation tests, so a dismissal on site A never affects site B or another org. The new migration (next free id, `090` at af2a526f) applies cleanly to a prod-shaped DB copy. After merge, prod shows no user-visible change.
**Plans**: 5 plans (wave 1: 01, 02, 03 in parallel; wave 2: 04, 05)

Plans:
- [ ] 87-01-PLAN.md — pure domain: countIssues, applyDismissals, toSiteKey, validators; D-09a identity through the real orchestrator (FP-05, FP-04, FP-01)
- [ ] 87-02-PLAN.md — `issues.dismiss` + DARK_PERMISSIONS on default and custom roles; org-scoped admin keys pinned on PR #102's Owner-set cap; /login re-run (FP-17)
- [ ] 87-03-PLAN.md — migration 090, dismissal store + append-only history + atomic audit_log, isolation break-tests (FP-01, FP-02, FP-03)
- [ ] 87-04-PLAN.md — mark/revoke/list API (bypassesOrgScope from PR #102), createServer proof of the dark path, drift regen, route break-tests (FP-01..04, FP-17)
- [ ] 87-05-PLAN.md — read-only prod: D-09b count identity over every completed scan + migration 090 dry-run on prod's schema (FP-05, FP-01)

### Phase 88: Dismissals applied on every surface
**Goal**: Once a dismissal exists, the dismissed finding stops counting everywhere a count, a score, a matrix or a conformance document is produced, now and on every later scan. The ACR says so openly instead of hiding the judgement. With zero dismissals, every surface is unchanged.
**Depends on**: Phase 87
**Requirements**: FP-06, FP-07, FP-08, FP-09, FP-10, FP-11, FP-12, FP-13
**Success Criteria** (what must be TRUE):
  1. With one active dismissal on a test-org site, the finding is gone from every one of these surfaces:
     - report detail (Issues, Templates and Pages tabs), print, the public report, AI-summary input, brand drilldown and email/notification bodies
     - compare, MCP `dashboard_get_report` / `dashboard_query_issues` / the report resource / fleet criterion counts, and REST `/api/v1/scans/:id/issues`
     - fix-PR and bulk-fix candidates
     - `issues.xlsx` and `report.pdf`

     `issues.xlsx` also has a "Dismissed" sheet with reason, actor and date. Every call site in the surface map has its own test (FP-06, FP-10, FP-11).
  2. Every ACR path drops dismissed findings from its verdicts and discloses, per affected criterion, how many automated findings were dismissed as false positives after review. The paths are report VPAT, share, public ACR, report page, `vpat.pdf`, `vpat-pack.zip`, accessibility statement and fleet report. A criterion whose issues are all dismissed is not shown as failing in the compliance or regulation matrix. Break-test: suppressing the disclosure turns the disclosure test red on each ACR path separately (FP-07, FP-12).
  3. The stored `errors` / `warnings` / `notices` / `total_issues` columns exclude dismissed issues. So does `confirmed_violations` where it can be derived, and the plan states which case applies. Raw pre-dismissal counts stay recoverable. A cross-surface test confirms that these surfaces all agree with the rendered report for the same scan, including the mixed JSON+column exposure source at `reports.ts` 553-555: home, trends score, badge, fleet, digest, legal exposure, reports list, raw-SQL API, GraphQL, MCP list and the scans/trends xlsx. Marking or revoking recomputes that site's existing scans immediately, streaming one scan at a time and never loading every `json_report` blob at once (FP-08, FP-09).
  4. A later scan applies active dismissals on BOTH orchestrator paths (standard and incremental). The counts persisted at scan end exclude them, and so do the webhook, plugin and completion payloads. Break-test per path: removing the apply call from one path turns red only that path's test (FP-13).
  5. With zero active dismissals, every surface above produces the same output as before the change, ACR included. A golden comparison on real stored reports proves it, which makes the merge safe to auto-deploy while the permission is dark.
**Plans**: TBD

### Phase 89: Dismissal UI, dark launch and role grant
**Goal**: A permitted user can mark and revoke false positives from the report itself, with a required reason, a coverage preview and a visible Dismissed section in all six locales. Alessandro proves the flow on a test org before the permission reaches any customer role.
**Depends on**: Phase 88
**Requirements**: FP-14, FP-15, FP-16, FP-18
**Success Criteria** (what must be TRUE):
  1. On the report Issues and Templates tabs, a user with `issues.dismiss` can open a mark dialog. The dialog requires a reason and, before confirming, previews how many occurrences on how many pages of the site the dismissal will cover. A user without the permission sees no control, and a direct POST from that user returns 403 (FP-14).
  2. A collapsed "Dismissed" section lists each dismissed issue with its reason, actor and date. Anyone with report access can see it. A permitted user can revoke with an optional comment, and the finding returns to counts, score and ACR (FP-15).
  3. All new UI text exists in the 6 dashboard locales (template-key coverage gate green). The UI uses design-system classes only and no inline scripts under CSP, and the mobile layout works. A real-browser UAT (`tests/browser-uat`) runs mark → excluded everywhere → revoke → restored end to end on the deployed dark build (FP-16).
  4. **BLOCKING human checkpoint, before any grant.**
     - First, a measured read-back on prod shows `issues.dismiss` is held only by global human admins and that no customer user is one. The read-back counts every path that yields the permission (users, org and custom roles, API keys, API-key `/login` sessions), not users only.
     - Then Alessandro receives a test link on a test org and reviews the flow, including the ACR disclosure wording, which goes into a document with legal weight.
     - The grant does not merge until he approves directly, and the record names the channel (FP-18).
  5. The grant of `issues.dismiss` to org Owner and Admin is the LAST step of the milestone. It updates the default role sets and adds a seeding migration for existing orgs, and ships as its own PR held until that approval, because merges auto-deploy. After deploy, a read-back confirms that an Owner on the test org can mark and that a Member or Viewer cannot (FP-18).
**Plans**: TBD
**UI hint**: yes

**Progress (v3.8.0):**

**Execution order:** strictly linear, 87 → 88 → 89. Each phase consumes the one before: 88 applies 87's pure functions everywhere, and 89's UI and rollout need the exclusion to be real on every surface before anyone can be shown it.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 87. Dismissal store, domain model and permission | v3.8.0 | 0/? | Not started | - |
| 88. Dismissals applied on every surface | v3.8.0 | 0/? | Not started | - |
| 89. Dismissal UI, dark launch and role grant | v3.8.0 | 0/? | Not started | - |

**Risks carried into planning (read from source 2026-10-08; not exercised live):**
- **Dark-launch leaks beyond global admins.** `resolveEffectivePermissions` gives `ALL_PERMISSION_IDS` to any identity whose role is `admin` (`permissions.ts:92-93`, `role-repository.ts:192/207`). Two paths reach that role from a customer org. First, org-scoped API keys default to role `admin` (`auth-service.ts:161`, `api-key.ts:67`) (`org-api-keys.ts:240-242`), and anyone holding `admin.org` (in the default roles, org Owner) can create them. Second (FIXED 2026-10-08, PR #100 be59abf4, live): `POST /login` used to write `role: 'admin'` with no org for ANY valid key; only system-scope admin keys may open a session now. Investigation of the 48 historical API-key logins found none opened by an org key (reported to Allanon). Separately, an org Owner holds `admin.roles` and `parsePermissions` accepts any id in `ALL_PERMISSION_IDS` for custom org roles (`routes/admin/roles.ts:76/87-93`). The 2026-10-08 measurement ("2 global admins") counted users only. Phase 87 SC3 and Phase 89 SC4 carry this. The `/login` escalation was fixed outside the milestone (PR #100); org-scoped ADMIN keys holding every permission via Bearer remain Phase 87's to close.
- **Count identity on deploy.** If the shared count function disagrees with core's `summary.byLevel` (incremental scans, template dedup, `confirmed_violations` from compliance), historical scores shift on the first deploy. Phase 87 SC4 gates this.
- **Selector instability.** There is no selector normalisation anywhere, so a dismissal survives a later scan only if the selector is byte-identical. Expected behaviour for v1, since FP-V2-02 is deferred, but the UI copy should not promise more than that.
- **Naming collision.** "dismiss" already exists for compliance proposals (`routes/admin/proposals.ts`, `compliance-client.ts`). Choose distinct identifiers and i18n keys.
