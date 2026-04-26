# Luqen

## What This Is

Luqen is a WCAG accessibility compliance platform built as a monorepo of Fastify microservices (core, compliance, llm, dashboard) plus a separate branding service and plugin ecosystem. It scans websites for accessibility issues, matches findings against jurisdiction/regulation rules, and delivers AI-powered fix suggestions and executive summaries. Admins control cross-service configuration, brand defaults, and regulation-level scoping directly from the dashboard.

## Core Value

AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control of the whole stack through the dashboard, not config files.

## Current State

v3.0.0 shipped 2026-04-24 — MCP Servers & Agent Companion. All Luqen services (compliance, branding, LLM, dashboard) expose Streamable HTTP MCP endpoints with OAuth 2.1 Authorization Code + PKCE + DCR for external clients (Claude Desktop, IDEs). Dashboard gains a conversational agent companion with text + speech input, SSE streaming, native-dialog confirmation for destructive tools, context-hints (recent scans + active guidelines injected per turn), token-budget compaction at 85% of model max, and an admin audit log viewer at /admin/audit. 10 phases (28-33 including inserted 30.1, 31.1, 31.2, 32.1), 36 plans, 22/22 requirements satisfied. Previous: v2.12.0 (2026-04-14) Brand Intelligence Polish.

## Current Milestone: v3.1.0 Agent Companion v2 + Tech Debt & Docs

**Goal:** Harden v3.0.0's MCP + agent foundation with precise instrumentation, complete the agent companion experience (history, multi-step tool use, polish, org switching), and refresh all documentation.

**Target features:**

*Agent Companion v2*
- Conversation search & history UI in the side drawer (list, search, resume past chats)
- Better tool selection — smarter planning, parallel tool calls, error-recovery loops
- Streaming/UX polish — interrupt, retry, edit-and-resend, copy/share message
- Multi-org context switching for global admins inside the agent (no re-login)

*Tech Debt*
- Precise tokenizer replacing `char/4` heuristic (lightweight, no heavy deps)
- Nyquist validation backfill for v3.0.0 phases
- Formal VERIFICATION.md for phases 30.1, 31.2, 32, 32.1, 33
- Deferred-items review from Phase 31.2 + Phase 32 (triage, fix or close)

*Documentation*
- Full docs sweep: README, API/Swagger, installer docs, MCP integration guide, agent companion guide, prompt-template docs, RBAC matrix — all updated to reflect v3.0.0 + v3.1.0

**Key constraints:** No new heavy dependencies (tokenizer must stay light).

## Requirements

### Validated

- ✓ Standalone Fastify microservice on port 4200 — LLM Phase 1
- ✓ Provider management (Ollama + OpenAI adapters) — LLM Phase 1
- ✓ Model registration + capability assignment with org-scoped overrides — LLM Phase 1
- ✓ OAuth2 auth (RS256 JWT, client credentials) — LLM Phase 1
- ✓ Capability execution engine with retry/fallback (exponential backoff, model priority chain) — LLM Phase 2
- ✓ POST /api/v1/extract-requirements endpoint — LLM Phase 2
- ✓ Prompt templates + per-org prompt overrides with CRUD API — LLM Phase 2
- ✓ Provider timeout (per-provider, configurable) — LLM Phase 2
- ✓ Compliance integration (LLM client with OAuth2, source scan re-wired) — LLM Phase 2
- ✓ Source management mode (LLM/Manual toggle, bulk switch, degraded tracking) — LLM Phase 2
- ✓ Dashboard /admin/llm page (4 tabs: Providers, Models, Capabilities, Prompts) — LLM Phase 2
- ✓ LLM on System Health page + OAuth Clients page — LLM Phase 2
- ✓ llm.view/llm.manage permissions in RBAC — LLM Phase 2
- ✓ POST /api/v1/generate-fix — AI WCAG fix suggestions — v2.7.0
- ✓ Dashboard integration for fix suggestions on report detail page — v2.7.0
- ✓ Fallback to hardcoded fix patterns when LLM unavailable — v2.7.0
- ✓ POST /api/v1/analyse-report — AI executive summary of scan results — v2.7.0
- ✓ Dashboard AI summary tab on report detail page — v2.7.0
- ✓ Pattern detection across scan history — v2.7.0
- ✓ POST /api/v1/discover-branding — auto-detect brand colors, fonts, logo — v2.7.0
- ✓ Branding service integration (auto-populate BrandGuideline from discovery) — v2.7.0
- ✓ Interactive installer script for LLM module — v2.7.0
- ✓ Comprehensive test suite, 80%+ coverage — v2.7.0
- ✓ Full API documentation (Swagger/OpenAPI specs updated) — v2.7.0
- ✓ README and installer docs updated — v2.7.0
- ✓ Regulation filter: compliance API + scan form + report detail + exports, backwards compatible — v2.8.0
- ✓ Service connections UI: admin CRUD, encrypted at rest, runtime reload, config fallback, test button — v2.8.0
- ✓ System brand guideline: multi-template library, link/clone modes, scope-aware resolver, single code path — v2.8.0
- ✓ Retag existing scans when branding guidelines are created/updated — v2.9.0
- ✓ Branding service integration tests with real Aperol data — v2.9.0
- ✓ Auto-link scanned site to guideline on discover-branding (opt-out checkbox) — v2.9.0
- ✓ CSS file import for brand guidelines (extract colors + fonts from CSS) — v2.9.0
- ✓ Org-scoped API key creation, revocation, and management UI with rate limit display — v2.9.0
- ✓ LLM per-org OAuth client parity (migration, auto-create, fallback routing, CLI backfill) — v2.9.0
- ✓ E2E tests for retag pipeline, org API key lifecycle, system brand guideline org flow — v2.9.0
- ✓ README "Built on" section linking 20 upstream components — v2.9.0
- ✓ LLM prompt fence markers + byte-exact validator + 422 enriched violations — v2.10.0
- ✓ Split-region prompt editor with locked read-only sections and editable textareas — v2.10.0
- ✓ Compare-with-default diff modal using diff@5 — v2.10.0
- ✓ Rich reset-to-default modal with destructive confirmation showing what will be lost — v2.10.0
- ✓ Stale override detection with explicit Migrate button — v2.10.0
- ✓ Org API key TTL selector (30/90/180/365/never) with whitelist validation — v2.10.0
- ✓ Hard delete for revoked API keys with org_id + active=0 SQL guards — v2.10.0
- ✓ Auto-revoke expired API keys via startup sweep + 24h setInterval — v2.10.0
- ✓ Collapsible Revoked keys section via native `<details>` element — v2.10.0
- ✓ Expired key label distinguishing auto-revoked from manually revoked — v2.10.0

- ✓ Org admin with admin.org can manage org settings without admin.system — v2.12.0
- ✓ Branding mode toggle migrated to admin.org permission — v2.12.0
- ✓ System-wide ops (create/delete org) still require admin.system — v2.12.0
- ✓ Brand overview page at /brand-overview with per-site selector — v2.12.0
- ✓ Org-level summary card (avg score, improving/regressing counts) — v2.12.0
- ✓ Sparkline utility extracted to shared services/sparkline.ts — v2.12.0
- ✓ Per-dimension trend polylines (color/typography/components) on SVG — v2.12.0
- ✓ Gap-aware dimension lines with insufficient-data fallback — v2.12.0
- ✓ Org-level brand score target (0-100) with dashed SVG line — v2.12.0
- ✓ Score vs target gap display with color banding — v2.12.0
- ✓ Drilldown modal for sub-score dimensions with failing elements — v2.12.0
- ✓ Native dialog+showModal pattern, no new JS dependencies — v2.12.0
- ✓ Typography x-height metrics via opentype.js + Google Fonts API — v2.12.0
- ✓ Font metrics cached in branding_fonts columns (migration 045) — v2.12.0
- ✓ Typography scorer 4th heuristic (x-height ratio, 25% weight) — v2.12.0
- ✓ Non-Google-Fonts graceful fallback to 3-way mean — v2.12.0
- ✓ Historical rescore: admin-triggered batch-of-50 processing — v2.12.0
- ✓ Rescore idempotent (skip already-scored scans) — v2.12.0
- ✓ Rescore resumable with progress tracking — v2.12.0
- ✓ Rescore skips deleted guidelines with warning count — v2.12.0
- ✓ Rescore always embedded mode, never remote — v2.12.0

- ✓ Streamable HTTP MCP endpoints on all services with OAuth2 JWT + RBAC tool filtering + org scoping (MCPI-01..04) — v3.0.0
- ✓ MCP Resources expose scan reports + brand scores (MCPI-05) and MCP Prompts /scan, /report, /fix (MCPI-06) — v3.0.0
- ✓ Compliance/branding/LLM/dashboard MCP tool catalogues (MCPT-01..04) — v3.0.0
- ✓ External MCP clients (Claude Desktop, IDEs) connect via OAuth 2.1 + PKCE + DCR (MCPT-05, MCPAUTH-01..03) — v3.0.0
- ✓ mcp.use RBAC permission per-org gate + tool visibility = RBAC ∩ scope (MCPAUTH-04..05) — v3.0.0
- ✓ Text + speech chat side panel with SSE streaming (AGENT-01..03) — v3.0.0
- ✓ Context-aware agent (recent scans + active guidelines injected per turn) + token-budget compaction at 85% (AGENT-04..05) — v3.0.0
- ✓ Persistent conversation history with rolling 20-turn window (APER-01) — v3.0.0
- ✓ Native-dialog confirmation for destructive tool calls with DB recovery (APER-02) — v3.0.0
- ✓ Agent audit log (APER-03) + /admin/audit viewer with filter bar + CSV export (APER-04) — v3.0.0

### Active

(Defining requirements for v3.1.0 — see REQUIREMENTS.md)

### Out of Scope

- Multimodal image analysis for logo detection — defer to future
- Real-time streaming LLM responses — batch responses sufficient
- Custom model fine-tuning — use prompt engineering instead
- Dashboard LLM admin mobile layout refinement — cosmetic, not blocking
- ~~Org auto-creation of LLM OAuth client — manual setup sufficient~~ (DONE in v2.9.0)
- Regulation-first rework (replacing jurisdictions as primary scope) — additive regulation filter is sufficient
- Multi-tenant brand hierarchy beyond system/org — system + org-level opt-in is sufficient

## Context

- **Architecture:** Monorepo with 4 packages (core, compliance, llm, dashboard) + branding service + plugins in separate repo
- **Existing patterns:** All services follow the same pattern — standalone Fastify, OAuth2 client credentials, CLI, installer, health endpoint
- **LLM service:** Port 4200 on lxc-luqen, Ollama provider configured
- **Service wiring:** dashboard → compliance/branding/llm over OAuth2 client credentials; URLs + secrets in dashboard DB (encrypted), with config file fallback
- **BrandGuideline pipeline:** Branding service matches findings against stored guidelines — per-org or linked/cloned from system templates
- **Compliance filter model:** Compliance check API accepts `jurisdictions[]` + optional `regulations[]`, returning inclusive union
- **Deploy:** master branch → lxc-luqen production server
- **Test suite:** 2,300+ dashboard tests + 444 compliance tests (322 integration/E2E passing in v2.9.0)

## Constraints

- **Tech stack:** TypeScript, Fastify, existing patterns — no new frameworks
- **Auth:** OAuth2 client credentials (RS256 JWT) — same across all services
- **Backwards compatibility:** Config-file-based service wiring continues as bootstrap fallback
- **Backwards compatibility:** `jurisdictions[]`-only compliance API callers work unchanged
- **No downtime:** Service connection changes recreate clients at runtime, no restart

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build on existing capability engine | Phase 2 engine handles retry/fallback/priority — reuse, don't rebuild | ✓ Good |
| Hardcoded fix patterns as fallback | 50 patterns in fix-suggestions.ts provide value even without LLM | ✓ Good |
| Regulation filter additive, not replacing | Backwards compatible — no data migration, existing callers unchanged | ✓ Good — v2.8.0 |
| Service credentials in DB (encrypted) | Enables runtime reload without restart; config file remains as bootstrap | ✓ Good — v2.8.0 |
| System brand guideline: link + clone, not merge | Single code path via scope-aware resolver — no per-site mode toggle needed | ✓ Good — v2.8.0 |
| Dashboard admin owns system branding | Consistent with existing system-wide admin pages (health, clients) | ✓ Good — v2.8.0 |
| System site assignments fall back to org scans | `getGuidelineForSite` checks `org_id IN (orgId, 'system')` with org-specific priority | ✓ Good — v2.8.0 hotfix |
| URL normalization at system boundary | Strip trailing slashes on site assignment/lookup to prevent scan URL mismatches | ✓ Good — v2.8.0 hotfix |
| Retag inline (non-blocking try/catch) | Retag is fast (reads stored JSON, no network) — no background job needed | ✓ Good — v2.9.0 |
| Auto-link default ON, opt-out checkbox | User ran discover on this URL — intent is clear; absent field = disabled (linkValue === 'on') | ✓ Good — v2.9.0 |
| Overwrite-don't-block on site reassignment | Toast notification after, not confirmation dialog before — intent is clear from context | ✓ Good — v2.9.0 |
| CSS parser: regex, not PostCSS | Lightweight extraction of hex colors + font-family from custom properties; additive merge with dedup | ✓ Good — v2.9.0 |
| Org API key rate limits: static by role | @fastify/rate-limit tracks by IP, not by key — per-key live counters impractical without custom Redis tracking | ✓ Good — v2.9.0 |
| revokeKey org_id SQL guard | DB-level `AND org_id = ?` prevents cross-org revocation by UUID guessing | ✓ Good — v2.9.0 |
| LLM per-org client: best-effort provisioning | Failure logged but never blocks org creation — graceful degradation | ✓ Good — v2.9.0 |
| resolveOrgLLMClient with try/finally destroy | Short-lived per-request LLM clients avoid timer leaks; system client shared | ✓ Good — v2.9.0 |
| HTML comment fences `<!-- LOCKED:name -->` for protected prompt sections | Clear to users, maps directly to UI, no runtime cost, one-time default rewrite | ✓ Good — v2.10.0 |
| Split-region prompt editor (locked cards + editable textareas) | User visually sees what can/can't be changed — no surprises on save | ✓ Good — v2.10.0 |
| diff@5 npm package for line diff | Lightweight, pure JS, no DOM dependency, server-side render | ✓ Good — v2.10.0 |
| Native `<details>` for collapsible Revoked section | Accessible by default, zero JS, works on mobile | ✓ Good — v2.10.0 |
| API key sweep: startup + 24h setInterval | Daily granularity acceptable for 30d+ TTLs, no per-request DB overhead | ✓ Good — v2.10.0 |
| Hard delete with SQL active=0 guard | Two-step (revoke → delete) matches user mental model; DB-level defense-in-depth | ✓ Good — v2.10.0 |
| TTL whitelist `[0,30,90,180,365]` with 90d default | Matches industry norms for CI tokens; server-side rejection prevents injection | ✓ Good — v2.10.0 |
| Worktree executor isolation disabled mid-phase after stale-base incident | `git reset --soft` safety check doesn't recover stale working tree; sequential main-tree runs safer for polish phases | ⚠️ Revisit — v2.10.0 |
| Brand overview at /brand-overview, not /admin/ | Org-scoped content visible to all users with branding.view | ✓ Good — v2.12.0 |
| Score target: single org-level integer on organizations table | Per-site/per-dimension targets deferred — simple UX first | ✓ Good — v2.12.0 |
| opentype.js over fontkit for font metrics | Pure JS (~180KB), server-side only, 100% OS/2 v3+ coverage | ✓ Good — v2.12.0 |
| Historical rescore always embedded, never remote | Avoids branding service dependency; consistent scoring | ✓ Good — v2.12.0 |
| Native `<dialog>` for rescore confirmation | Consistent with drilldown modal pattern; no custom JS | ✓ Good — v2.12.0 |
| RescoreService via getRawDatabase() escape hatch | Avoids modifying StorageAdapter interface for single-use repo | ✓ Good — v2.12.0 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-24 — v3.1.0 milestone started*
