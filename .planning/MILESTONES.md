# Milestones

## v3.0.0 MCP Servers & Agent Companion (Shipped: 2026-04-24)

**Phases completed:** 10 phases (28-33 including inserted 30.1, 31.1, 31.2, 32.1), 36 plans
**Files changed:** 294 (+48142/-4484 LOC)
**Timeline:** 2026-04-14 → 2026-04-24 (10 days)
**Commits:** 206
**Archive:** [v3.0.0-ROADMAP.md](milestones/v3.0.0-ROADMAP.md) · [v3.0.0-REQUIREMENTS.md](milestones/v3.0.0-REQUIREMENTS.md) · [v3.0.0-MILESTONE-AUDIT.md](v3.0.0-MILESTONE-AUDIT.md)

**Key accomplishments:**

- Every Luqen service (compliance, branding, LLM, dashboard) exposes a secured Streamable HTTP MCP endpoint at `POST /api/v1/mcp` with OAuth2 JWT validation, RBAC tool filtering, and per-request org scoping. `@luqen/core/mcp` shared plugin provides the factory, ALS-backed tool context, and filter primitives; tool catalogues total 33 tools (compliance 11 + branding 4 + LLM 4 + dashboard 14).
- OAuth 2.1 Authorization Server on the dashboard: Authorization Code + PKCE + refresh rotation + Dynamic Client Registration (RFC 7591) + `.well-known/oauth-authorization-server` + `.well-known/oauth-protected-resource` per service + JWKS rotation UI + `/admin/oauth-keys`. JWKS-backed RS256 verifier swap across all 4 services with RFC 8707 audience enforcement. Claude Desktop and MCP Inspector verified end-to-end.
- `mcp.use` per-org RBAC permission gate on `/oauth/authorize`, tool visibility = RBAC ∩ scope (no more broad scope bundles), org-scoped DCR client revoke via `/admin/clients`, service-side `WWW-Authenticate: Bearer resource_metadata=...` parity. All three G1/G9/G10 gaps from 31.1 smoke closed.
- Dashboard agent companion: Fastify AgentService + ToolDispatcher + per-dispatch RS256 JWT minter; SSE token streaming via EventSource; floating entry button + side drawer chat UI with localStorage persistence; Ollama/OpenAI/Anthropic streaming adapters (Anthropic SDK pinned at exact 0.90.0); Web Speech API with Firefox text fallback; destructive tool calls require native `<dialog>` confirmation with DB-recovery on page reload.
- Conversation persistence: migrations 047 (`agent_conversations` + `agent_messages` with rolling-20-turn `in_window` flag + `pending_confirmation` durability) and 048 (`agent_audit_log` append-only distinct from pre-existing `storage.audit`); ConversationRepository maintains the window at write time; 49/49 repo tests green.
- Context-aware responses: recent scans + active brand guidelines + applicable regulations injected into the system prompt every `runTurn`. Token-budget estimator (char/4) + sliding-window summary compaction triggered at 85% of model max — agent stays coherent on long conversations. Admin audit log viewer at `/admin/audit` with filter bar (date range / user / tool) + CSV export + `orgId=null` cross-org read for `admin.system`.

**22/22 v3.0.0 requirements satisfied:** MCPI-01..06, MCPT-01..05, AGENT-01..05, APER-01..04, MCPAUTH-01..05.

**Tech debt (documented in v3.0.0-MILESTONE-AUDIT.md):**

- Phases 30.1, 31.2, 32, 32.1, 33 produced no formal VERIFICATION.md — coverage via plan SUMMARYs + UAT walkthroughs + live dashboard testing
- Token estimator uses char/4 heuristic; precise tokenizer deferred
- Nyquist validation not run for any v3.0.0 phase
- `deferred-items.md` files in Phase 31.2 and Phase 32 — review for v3.1

**Inserted phases:**

- Phase 30.1 (scope-filter gate) — inserted 2026-04-18 after Phase 30 SC#4 walkthrough revealed OAuth client-credentials tokens could invoke destructive tools
- Phase 31.1 (MCP Authorization Spec Upgrade) — inserted 2026-04-19 when bootstrap `client_credentials` + static Bearer was found to fail MCP Authorization spec for external clients; relocated MCPAUTH-01/02/03 out of Phase 32
- Phase 31.2 (Access Control Refinement) — inserted 2026-04-19 to close G1/G9/G10 gaps from 31.1 smoke
- Phase 32.1 (Agent Chat Fixes) — inserted 2026-04-23/24 for in-session fixes: global-admin org-agnostic handling, MCP bridge hardening, markdown/table rendering, mobile layout, multimodal output (Mermaid + DOMPurify-sanitized SVG)

---


## v2.12.0 Brand Intelligence Polish (Shipped: 2026-04-14)

**Phases completed:** 6 phases, 8 plans, 10 tasks

**Key accomplishments:**

- Migrated 3 branding routes to dual admin.system/admin.org permission with tenant isolation, plus 13 permission matrix tests
- Org-level brand score target with dashed SVG line, target input form, and color-coded gap display on summary card
- 1. [Rule 2] No-candidates returns button partial instead of inline HTML

---

## v2.11.0 Brand Intelligence (Shipped: 2026-04-12)

**Phases completed:** 7 phases (15-21), 24 plans, ~50 tasks
**Tests:** 189 new automated tests (2528 total dashboard, 0 regressions)
**Commits:** 104 (feat/test/refactor/docs across all 7 phases)
**Latency gate:** PASS — grand median -1.3% (14951 → 14759 ms) over 3-site benchmark
**Archive:** [v2.11.0-ROADMAP.md](milestones/v2.11.0-ROADMAP.md) · [v2.11.0-REQUIREMENTS.md](milestones/v2.11.0-REQUIREMENTS.md)

**Key accomplishments:**

- Pure brand score calculator (`packages/dashboard/src/services/scoring/`) with tagged-union `ScoreResult` contract, locked 50/30/20 composite weights, `wcagContrastPasses()` as single WCAG threshold source of truth, and filesystem-based D-07 guard preventing literal threshold drift. 84 scoring unit tests.
- Migration 043 delivering `brand_scores` table (17 columns, nullable score columns + `coverage_profile` JSON + `subscore_details` JSON for SubScoreDetail round-trip + CHECK constraint on mode) and `organizations.branding_mode` column with default `'embedded'`. Atomic single-transaction migration. 28 DB schema + repository tests.
- `BrandingOrchestrator` with per-request mode dispatch via `OrgRepository.getBrandingMode()` (zero caching), `EmbeddedBrandingAdapter` (mechanical extraction of inline matcher), `RemoteBrandingAdapter` (wraps dormant `BrandingService` with `isMatchableIssue` type guard + `RemoteBrandingMalformedError`), and the load-bearing no-cross-route invariant: Test 4 asserts `embeddedFn.toHaveBeenCalledTimes(0)` when the remote adapter rejects. 26 adapter + orchestrator tests.
- Scanner + retag hot-path rewire: `scanner/orchestrator.ts` and `services/branding-retag.ts` now call `brandingOrchestrator.matchAndScore()` exactly once per scan, persist brand_scores rows via the typed repository (scored + degraded variants; no-guideline skips persistence), with non-blocking scoring failure. 13 retag call sites across 3 files updated. Latency gate verified at -1.3% via a 4-site warm-1/measured-3 bench. 18 scanner/retag integration tests.
- Admin mode toggle at `/admin/organizations/:id/branding-mode` with two-step confirmation (DB-unchanged invariant on no-confirm POST), reset-to-default, and a test-connection button routing through the production `BrandingOrchestrator.matchAndScore()` code path (Pitfall #5 enforced at 3 levels: plan text, grep, test spy). System Health + sidebar branding parity locked via structural `toEqual` assertions. 15 admin route tests.
- Report detail brand score panel (`views/partials/brand-score-panel.hbs`) with 3 render variants (scored with progress bars + delta + counter, unscorable with reason label, null with empty-state card), color-banded green/amber/red using existing CSS variables, and `{{#if brandScore}}` Pitfall #8 guard for pre-v2.11.0 scans. 9 template render tests.
- Home dashboard brand score widget (`views/partials/brand-score-widget.hbs`) with inline SVG `<polyline>` sparkline (zero client-side JS), `sr-only` accessible description, 3 empty-state variants (0/1/2+ scores), and cross-phase i18n sweep replacing 18 hardcoded English strings with `{{t}}` keys across 6 locales (en/fr/it/pt/de/es). 9 widget render tests.

**20/20 v2.11.0 requirements satisfied:** BSCORE-01..05, BSTORE-01..06, BMODE-01..05, BUI-01..04.

**Known incidents:**

- Plan 18-01 executor rate-limited mid-Task-2 during the pre-rewire latency bench (pa11y + sap.com OOM'd at 6 GB heap); orchestrator continued inline site-by-site under OS timeout wrappers. sap.com excluded from both baseline and post-rewire (apples-to-apples); 3-site comparison remained valid.
- Phase 17 UAT-17-01 branding service liveness checkpoint executed via SSH to lxc-luqen (not human-interactive); branding service confirmed running on port 4100 (plan/doc said 4300 — corrected in UAT report).

---

## v2.10.0 Prompt Safety & API Key Polish (Shipped: 2026-04-10)

**Phases completed:** 2 phases, 6 plans, ~16 tasks
**Tests:** 89 automated (45 phase 13, 44 phase 14) + 9 UAT manual on live
**Commits:** 13 (9 feat/test/docs + 3 post-UAT UX fixes + 1 recovery commit)
**Archive:** [v2.10.0-ROADMAP.md](milestones/v2.10.0-ROADMAP.md) · [v2.10.0-REQUIREMENTS.md](milestones/v2.10.0-REQUIREMENTS.md)

**Key accomplishments:**

- LLM default prompt templates rewritten with `<!-- LOCKED:output-format -->` / `<!-- LOCKED:variable-injection -->` fence markers; new `parsePromptSegments()` + byte-exact `validateOverride()` helpers in `packages/llm/src/prompts/segments.ts`; PUT `/api/v1/prompts/:capability` returns 422 with `violations: [{name, reason, explanation}]` from a new `LOCKED_SECTION_EXPLANATIONS` lookup when protected sections are modified.
- Split-region prompt editor on `/admin/llm?tab=prompts` renders locked sections as read-only gray cards and editable regions as textareas; on save, locked content is always sourced from the default (never from form input) to prevent template injection; stale override detection flags pre-fence overrides with an explicit `<button name="_migrate">` that pads editable slots with default fillers on next save.
- Three-part error toast for rejected prompt saves: section name + generic explanation + clickable HTMX "Reset to default" button linking directly to the reset-confirm modal, with `escapeHtml()` applied to all dynamic values.
- Diff modal + rich reset-to-default modal sharing a single `prompt-diff-body.hbs` partial, powered by the `diff@5` npm package for server-side unified line diffs; new `.modal--wide` CSS variant (`max-width: min(960px, 95vw)`) sized for diff-heavy content.
- Migration 042 adds nullable `expires_at` column to `api_keys` with partial index; `ApiKeyRepository` gains `storeKey(..., expiresAt)`, `deleteKey(id, orgId)`, and `revokeExpiredKeys()`; hard delete SQL uses `WHERE id=? AND org_id=? AND active=0` for two-level guarding.
- Org API key creation form has a TTL selector (30d / 90d default / 180d / 1y / Never expires) with an inline warning when "Never" is selected; server-side whitelist rejects any other value with 400 + toast.
- `runApiKeySweep` helper in `packages/dashboard/src/api-key-sweep.ts` wired at server startup + `setInterval(24 * 60 * 60 * 1000)` + `server.addHook('onClose', () => clearInterval(apiKeySweepHandle))` for graceful shutdown; writes a single `api_key.auto_revoke { count, trigger }` audit entry per sweep when keys are affected.
- Org API key list split into Active table + native `<details>` collapsible "Revoked keys (N)" section; expired keys show `<small class="text-muted">(Expired)</small>` suffix inside an inline-flex `.status-cell` wrapper; revoke handler moves rows across tables via `<template>`-wrapped OOB swaps with first-revoke `HX-Refresh` edge case; delete handler returns OOB count updates.
- Pre-existing audit log bug fixed: org-api-key revoke handler was writing `api_key.delete` — now correctly writes `api_key.revoke`, and new hard-delete handler writes `api_key.delete`.
- Phase 13 isOverride field rename: `LLMPrompt.isCustom` renamed to `isOverride` to match the LLM service response field; the Reset button would otherwise never render because `apiFetch` returns raw JSON without field mapping. Caught during verifier pass, fixed in `9687aa6`.

**Known incidents:**

- Wave 1 of Phase 14 initially ran in a worktree created from a stale base snapshot, and its commits inadvertently reverted all of phase 13. Detected at merge time via massive deletions in the merge log. Recovery: `git reset --hard 9687aa6` then surgical `git checkout c554074 -- <5 phase-14 files>` to preserve backend work. Waves 2 and 3 ran sequentially on the main tree without worktree isolation to avoid the stale-base issue.
- Post-deploy UX fixes found during UAT: status cell stacked badge + `(Expired)` on two lines (fixed with `.status-cell` inline-flex wrapper); phase 13 locked segments overflowed the card and diff modal wasn't responsive to screen size (fixed with `.modal--wide` + `overflow-wrap: anywhere`).

---

## v2.9.0 Branding Completeness & Org Isolation (Shipped: 2026-04-06)

**Phases completed:** 4 phases, 14 plans, 13 tasks

**Key accomplishments:**

- One-liner:
- Auto-link logic (ALD-01, ALD-02):
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- Org admins can self-service create/revoke API keys scoped to their org, with rate limit tier display and DB-level org_id revocation guard preventing cross-org UUID guessing.
- Task 1 — Data layer:
- `resolveOrgLLMClient()` helper routes generateFix, analyseReport, and discoverBranding through per-org OAuth credentials when available, falling back transparently to the system LLM client
- `backfill-llm-clients` CLI command and server startup loop that provision per-org LLM OAuth clients for existing organizations, completing org isolation parity with compliance and branding
- 5-scenario integration test suite proving org API key create/validate/revoke lifecycle and cross-org revocation guard on real SQLite with no mocks
- One-liner:
- README.md 'Built on' section added — 20 upstream components grouped by role (scanning, framework, frontend, database, security, AI/LLM, export, testing) each linked to official repository or homepage

---

## v2.8.0 Admin UX & Compliance Precision (Shipped: 2026-04-06)

**Phases completed:** 3 phases, 13 plans, 13 tasks

**Key accomplishments:**

- Encrypted-at-rest SQLite storage for the three outbound service connections (compliance, branding, LLM), with a blank-to-keep repository API and a first-boot config→DB bootstrap helper — zero new dependencies, full reuse of existing crypto utilities.
- Runtime hot-swap indirection layer — a single `ServiceClientRegistry` now owns the compliance/branding/LLM clients and is woven through every route that previously received raw references, so plan 06-03's admin save can call `registry.reload(serviceId)` and the entire server picks up the new client on the next request without a restart.
- Admin HTTP contract for the three outbound service connections — list (masked), update (encrypt + audit + hot-reload), test (OAuth + /health probe without persistence), and clear-secret — permission-gated on `admin.system` with 12 integration tests covering the full happy path, blank-to-keep semantics, 403 gating, reload-failure 500 path, and the test-endpoint stored-secret fallback.
- Created:
- Phase 06 is done — two integration test files (`service-connections-flow.test.ts`, `service-connections-fallback.test.ts`) prove the full save → reload → GET → test → clear-secret pipeline against a real SQLite-backed dashboard with a real `ServiceClientRegistry`, covering encryption at rest, runtime client hot-swap, per-service config fallback, DB-wins-over-config, admin-only RBAC, HTMX content-negotiation for every endpoint, and 400-validation branches. All five Phase 06 source files are ≥80% line-covered and the full dashboard suite runs 2147 passing / 40 skipped with zero regressions.
- Before
- File:
- None relative to the behaviour spec.
- None relative to behavior spec.
- None — Task 2 resolved as CASE 1.

---
