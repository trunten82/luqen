# Milestones

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
