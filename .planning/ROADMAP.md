# Roadmap: Luqen

## Milestones

- ✅ **v2.7.0 – v3.0.0** — Phases 01-33 (shipped) — see `milestones/` archives
- ✅ **v3.1.0 Agent Companion v2 + Tech Debt & Docs** — Phases 34-42 (shipped)
- ✅ **v3.2.0 – v3.4.0 WP Plugin, UI Revision, LLM Cost Telemetry** — Phases 43-77 (shipped directly to master)
- ✅ **v3.5.0 Commercial positioning & agency monetization** — Phases 78-82 (shipped). NOTE: product is **single-tier** ([[project_single_tier_decision]]); the Free/Pro/Agency surfaces ship but are **dormant** — do not build on them.
- 🚧 **v3.6.0 Agent surface + semantic depth** — Phases 83-84 (next): MCP servers + Agent Companion; LLM-vision behavioral checks. Plus carry-over already done this run: DB-plugin tolerance fix + widget→VPAT public ACR.

> Note: `.planning` artifacts lagged behind a sustained direct-to-master run (phases 43–77 — WordPress plugin, UI revision, and the LLM cost-telemetry stack 71–77). Git reality is v3.4.0. This milestone resumes formal roadmapping at **Phase 78**. Earlier milestone detail lives in `milestones/` archives.

---

## Current Milestone: v3.5.0 Commercial positioning & agency monetization

**Goal:** Turn verified market research into product — position Luqen explicitly as genuine source-level remediation against the collapsing overlay category, and build the freemium→Pro→Agency monetization spine (Pro feature gates, credit-metered AI fixes, an agency multi-client/white-label tier) that the WP-shelf competitors prove converts. Monetization stays admin-controlled per Core Value; Stripe/Freemius billing is out of scope.

**Granularity:** coarse · **Phases:** 5 · **Requirements:** 22/22 mapped ✓

**Two execution tracks (separate repos, separate CI — parallelizable):**
- **Platform track** (`luqen` monorepo: dashboard + llm) → Phases 80, 81, 82, and the platform half of 78
- **WordPress track** (`luqen-wordpress` repo) → Phase 79, and the `readme.txt` half of 78

Ship pattern per phase: wip branch → build → test → merge to master → deploy to lxc-luqen → CI green.

## Phases

**Phase Numbering:**
- Integer phases (78, 79, 80…): Planned milestone work
- Decimal phases (e.g. 80.1): Urgent insertions (marked INSERTED)

- [x] **Phase 78: Anti-overlay positioning** — DONE 2026-06-01. WP readme anti-overlay + public-report positioning line + docs/why-not-an-overlay.md comparison surface shipped during 43–77; the dashboard-landing positioning gap (SC2) closed in f40b43e (CI green, deployed). Evidence re-verified (FTC $1M; NFB 2021/2025; UsableNet/EcomBack overlay-lawsuit rate).
- [x] **Phase 79: Pro feature-gate bundle (WP plugin)** — DONE 2026-06-01 (luqen-wordpress `ad736f7`, v0.24.0, WP CI green, 12/12 Playwright UAT). `Luqen_Entitlement` model + *Luqen → Plan* admin screen; gated full-site/bulk scan, scan history, Excel export, CPT/WooCommerce, multisite network bulk fixes, VPAT/ACR+evidence+sharing behind free-vs-Pro. Defence-in-depth (UI paywall + handler/REST re-check). Admin-controlled (no billing); enterprise path wired via filter seam, HTTP fetch lands in Phase 80.
- [x] **Phase 80: Credit-metered AI fixes** — DONE 2026-06-01. `generate-fix` decrements a per-org AI-fix credit balance (append-only `credit_ledger` + `org_credits` in the LLM DB); exhausted → `402` so consumers degrade to the deterministic fix path; system calls unmetered; default free allocation env-configurable (seed 50). Credits API on @luqen/llm; admin credits+plan panel on `/admin/llm-usage`; `org_entitlements` table (migration 083) + `EntitlementRepository` = the thin plan foundation; inbound `GET /api/v1/entitlement` feeds the WP Pro gate. Admin-controlled (no billing). LLM 416 + dashboard 3935 tests green; docs:rbac/openapi regenerated.
- [x] **Phase 81: Agency tier** — DONE 2026-06-01. Agency console (`/admin/agency`) = multi-client overview (each client org's plan + managed WP-site count) + partner-seat entitlement. AGENCY-04 partner/resale seat modelled as `max_client_sites` on `org_entitlements` (migration 084), admin-controlled (system-admin only), over-limit warning. AGENCY-02 white-label + AGENCY-03 per-client VPAT/ACR delivered by the existing per-org Report Identity (entity+logo) threaded through the VPAT/ACR pipeline; console links to it. Sidebar link + i18n (6 locales). Dashboard 3937 tests green; docs regenerated.
- [x] **Phase 82: Pricing & packaging** — DONE 2026-06-01. Free/Pro/Agency codified as an explicit feature matrix in `plan-matrix.ts` (single platform source of truth, aligned with the WP plugin's `Luqen_Entitlement::FEATURES`); `/admin/plans` reference page + `docs/reference/plans.md`. Pro/Agency price anchors left as `null` placeholders with explicit TODO (HARD-GATED on the user's in-flight enterprise-pricing research — competitor-comparable ranges only, no invented prices). Plan keyed on `org_entitlements.plan` (Phase 80).

## Phase Details

### Phase 78: Anti-overlay positioning
**Goal**: A prospective and existing user understands Luqen as genuine source-level remediation — not an overlay widget — across the WordPress plugin listing, the dashboard, and scan reports, backed by verified evidence.
**Track**: Cross-repo — `luqen-wordpress` (`readme.txt`) + `luqen` platform (dashboard/report copy + comparison surface)
**Depends on**: Nothing (independent; cheapest, highest-impact — ship first). Lightly gated: the jurisdiction-uniqueness comparison claim awaits in-flight research; ship the other claims first and backfill that one line if research lands late.
**Requirements**: POS-01, POS-02, POS-03
**Success Criteria** (what must be TRUE):
  1. A user reading the WP plugin `readme.txt` sees Luqen framed as genuine source-level remediation, with an explicit anti-overlay section naming the risk (overlays don't deliver compliance or prevent lawsuits)
  2. A user viewing a scan report and the dashboard landing sees genuine-remediation positioning (real fixes in your source, not a widget)
  3. A user can open a "why not an overlay" comparison surface that cites the verified evidence (FTC $1M settlement, NFB revocation, lawsuits-despite-widget rate)
**Plans**: TBD
**UI hint**: yes

### Phase 79: Pro feature-gate bundle (WP plugin)
**Goal**: A free-tier WordPress user can run basic scans, while a Pro-entitled user unlocks the conversion bundle (full-site/bulk scan, audit history, Excel export, CPT/WooCommerce scanning, multisite), with entitlement enforced by the plugin.
**Track**: `luqen-wordpress` repo (own CI) — independent track, parallelizable with platform work
**Depends on**: Phase 80 (entitlement foundation) for GATE-06's enterprise-mode path, which reads the connected Luqen org plan. The standalone license-key path is stubbed (no dependency), so the gating UI and free/Pro feature splits can be built in parallel and wired to the foundation at GATE-06.
**Requirements**: GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-06
**Success Criteria** (what must be TRUE):
  1. A free-tier WP user is limited on full-site/bulk scanning; a Pro-entitled user can run full-site/bulk scans
  2. A Pro user can view retained audit history for a post/page across scans, scan custom post types / WooCommerce products, and run the plugin across a multisite network
  3. A Pro user can export findings to Excel (xlsx — no CSV per project rule)
  4. The plugin enforces free-vs-Pro entitlement: in enterprise mode it derives from the connected Luqen org plan; a standalone license-key path is stubbed for future use
**Plans**: TBD
**UI hint**: yes

### Phase 80: Credit-metered AI fixes
**Goal**: Each org has a credit balance that `generate-fix` decrements on top of the existing `llm_usage` ledger; admins can allocate/top-up credits; when exhausted the flow degrades gracefully to the deterministic fix fallback; balance is visible in the dashboard and WP plugin. This phase also establishes the thin per-org entitlement foundation (plan + allocation persistence) that GATE-06, AGENCY-04, and PRICE-03 build on.
**Track**: `luqen` platform (llm + dashboard) + a WP consumer surface (`luqen-wordpress`). Builds directly on the `llm_usage` telemetry + pricing registry + retention shipped in Phases 72–77.
**Depends on**: Phase 78 (sequenced after for ship cadence; functionally independent). Establishes the entitlement foundation other phases consume — so it precedes 79's enterprise path, 81's partner entitlement, and 82's plan model.
**Requirements**: CREDIT-01, CREDIT-02, CREDIT-03, CREDIT-04, CREDIT-05
**Success Criteria** (what must be TRUE):
  1. Each `generate-fix` call decrements the org's credit balance, recorded on top of the existing `llm_usage` ledger (balance + consumption ledger maintained)
  2. An admin can set or top-up a per-org credit allocation from the dashboard
  3. When an org's credits are exhausted, `generate-fix` is gated and degrades gracefully to the deterministic fix fallback — never hard-erroring the user flow
  4. A dashboard user sees remaining credit balance and consumption against allocation on `/admin/llm-usage`
  5. A WP plugin user sees remaining credits / a paywall prompt when AI fixes are metered out
**Plans**: TBD
**UI hint**: yes

### Phase 81: Agency tier
**Goal**: An agency user manages multiple client orgs/sites from one console, produces white-label rebrandable reports and themed client-facing surfaces, generates VPAT/ACR conformance reports, and is governed by a partner/resale entitlement covering N client sites.
**Track**: `luqen` platform (dashboard)
**Depends on**: Phase 80 — AGENCY-04 (partner/resale entitlement) extends the thin entitlement foundation established in Phase 80.
**Requirements**: AGENCY-01, AGENCY-02, AGENCY-03, AGENCY-04, AGENCY-05
**Success Criteria** (what must be TRUE):
  1. An agency user manages multiple client orgs/sites from a single multi-client console
  2. An agency can generate white-label / rebrandable client reports (agency logo + name, not Luqen branding) and apply white-label theming (logo, colors) to client-facing dashboard/report surfaces
  3. An agency can generate a VPAT / ACR (Accessibility Conformance Report) for a client site
  4. The platform models a partner/resale entitlement (agency plan covering N client sites)
**Plans**: TBD
**UI hint**: yes

### Phase 82: Pricing & packaging
**Goal**: Free/Pro/Agency tiers are codified as an explicit feature matrix, driven by a per-org plan/entitlement model that is the single source of truth consumed by dashboard, LLM, and WP, with documented pricing anchors.
**Track**: `luqen` platform — cross-cutting (consumed by all surfaces)
**Depends on**: Phases 79, 80, 81 — formalizes and unifies the entitlement slices those phases introduced (credit allocation from 80, partner entitlement from 81, WP entitlement from 79) into one plan model. HARD-GATED on the in-flight enterprise-pricing research, so it sequences LAST.
**Requirements**: PRICE-01, PRICE-02, PRICE-03
**Success Criteria** (what must be TRUE):
  1. Free/Pro/Agency tiers are codified as an explicit feature matrix showing which capabilities each tier unlocks
  2. A per-org plan/entitlement model drives feature availability platform-wide as a single source of truth consumed by dashboard, LLM, and WP
  3. Pricing anchors are documented (informed by the in-flight enterprise-pricing research; WP anchors free→~$190/yr Pro→~$2,250/yr/25-site Agency already validated)
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 78 → 79 → 80 → 81 → 82

Two parallelizable tracks: the WordPress track (78 `readme.txt`, 79) and the platform track (78 dashboard, 80, 81, 82) run concurrently, synchronizing where 79's enterprise path consumes the Phase 80 entitlement foundation.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 78. Anti-overlay positioning | v3.5.0 | 1/1 | ✅ Done | 2026-06-01 |
| 79. Pro feature-gate bundle (WP plugin) | v3.5.0 | 1/1 | ✅ Done | 2026-06-01 |
| 80. Credit-metered AI fixes | v3.5.0 | 1/1 | ✅ Done | 2026-06-01 |
| 81. Agency tier | v3.5.0 | 1/1 | ✅ Done | 2026-06-01 |
| 82. Pricing & packaging | v3.5.0 | 1/1 | ✅ Done | 2026-06-01 |

---

## Next Milestone: v3.6.0 Agent surface + semantic depth

**Goal:** Two large, mostly-independent efforts that deepen the product where it's genuinely thin — an org-aware agent surface, and the semantic (vision) accessibility checks that no static scanner can do. Both are milestone-sized; run each as a proper GSD phase.

**Status:** IN PROGRESS (started 2026-06-02). Single-tier confirmed — do NOT build on or extend the dormant Free/Pro/Agency surfaces.

**KEY DISCOVERY (2026-06-02):** Phase 83 was ~90% already shipped by prior milestones (v3.0.0 Phases 28–33 MCP + v3.1.0 Phases 34–42 Agent Companion v2). MCP servers exist across ALL services (llm/compliance/branding/dashboard/monitor — tools, resources, prompts, RBAC, org-scoped). The dashboard already has a working org-aware **text** companion + **speech-to-text** (Web Speech API, `agent-speech.js`). The ONLY gaps were **text-to-speech (voice output)** and **multimodal image input** — and the image-input gap IS the Phase 84 vision adapter. **User decision:** scope = "Vision adapter + TTS" (converge the two phases on one vision adapter, plus browser TTS for the companion).

**SHIPPED THIS SESSION (all on master, CI green, deployed):**
- `85be72a` **vision adapter** — `ImageInput` + optional `images[]` on `CompletionOptions`/`ChatMessage`; OpenAI/Anthropic/Ollama all attach images on `complete()` + `completeStream()`. (packages/llm/src/providers/)
- `85be72a` **analyse-visual capability** + `POST /api/v1/analyse-visual` — heading-semantics (1.3.1) + alt-text (1.1.1) checks, structured verdict, graceful degrade. (packages/llm/src/capabilities/analyse-visual.ts)
- `941c956` **core `captureVisualContext()`** — browser-side screenshot + heading outline + image inventory; LLM-agnostic. (packages/core/src/behavioral/visual.ts)
- `3343063` **Phase 84 vision integration (DONE)** — core `BehavioralOptions.onVisualContext` callback (capture + inject, reuses open browser, keeps core LLM-free); dashboard `LLMClient.analyseVisual()`, `scanner/vision-pass.ts` (heading-semantics mapping → `Issue` runner='vision', degrade to [] on 503), orchestrator `resolveVisionAnalyzer` + server.ts wiring. Vision findings flow into reports + VPAT (move 1.3.1 off "Not Evaluated"). Runs as part of the deep behavioral scan; no new UI toggle.
- `9a018de` **Phase 83 TTS (DONE)** — browser `speechSynthesis` voice-output toggle in the agent drawer (`static/agent-tts.js`), spoken on the SSE 'done' frame; i18n in all 6 locales.

**REMAINING (next session):**
- [ ] **Phase 83 companion multimodal** — image upload/paste in the agent drawer → thread base64 images through `POST /agent/message` → agent service → `ChatMessage.images` (field exists). Render thumbnails in the message log. (Only remaining v3.6.0 item.)
- [ ] (optional) Phase 84 polish: **alt-text** vision check needs per-image bytes (capture currently only feeds the full-page screenshot + heading outline to heading-semantics); positive-pass VPAT upgrade ("clean vision pass → Supports") needs a deriveRow change in vpat-service. Expose `analyse-visual` as an LLM **MCP tool**.
- [ ] HUMAN UAT: TTS + (future) image upload are UI — need real-browser cross-persona UAT ([[feedback_ui_phase_uat]]).
- [ ] WP mirror of vision checks is a separate later effort (WP standalone uses axe-core client-side; vision needs the dashboard/enterprise path).

### Already shipped this run (carry-overs, not part of 83/84)
- DB-plugin breaking-change tolerance fix (`55445c5`): Slice C/D repos optional + guarded.
- widget→VPAT public ACR: dashboard `/reports/:id/acr` (`bc21e3a`) + WP a11y-statement ACR link (`a52d053`, v0.26.0).
