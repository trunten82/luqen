# Luqen — next session kickoff (resume v3.6.0 "Agent surface + semantic depth")

Continue the autonomous run. Same flow each item: plan → TDD → real UAT →
CI green → deploy → docs + KG + STATE/ROADMAP. Only stop for a genuine
product/legal fork you cannot reasonably default.

## STATE (verify first — all green)
- **luqen (dashboard/llm/core):** master == origin. v3.6.0 FOUNDATION shipped this run:
  - `85be72a` LLM **vision adapter** (image input on OpenAI/Anthropic/Ollama) + **analyse-visual**
    capability (`POST /api/v1/analyse-visual`, checks: `heading-semantics`→1.3.1, `alt-text`→1.1.1).
  - `941c956` core **`captureVisualContext()`** (`@luqen/core/behavioral/visual.ts`): screenshot +
    heading outline + image inventory; LLM-agnostic. Exported from core public index.
  - CI + rbac-drift + openapi-drift green; Deploy auto-fires on green CI. Verify `/login` 200,
    `/api/v1/entitlement` 401.
  - SANDBOX QUIRK: `cd` stripped from compound SSH — verify deploy via Deploy workflow conclusion
    + `/login` + a live route smoke, NOT `ssh … 'cd … && git …'`.
  - Behavioral/browser tests are EXCLUDED from CI (slow tier). Run core's visual tests locally with
    `npm run test:browser -w packages/core` (config `vitest.browser.config.ts`). They pass.
- **luqen-wordpress:** master == origin = `8fdf14e`, v0.26.0, CI green. PRIVATE. (No WP work this run.)

## KEY DISCOVERY (2026-06-02) — read before planning
Phase 83 was ~90% ALREADY SHIPPED (v3.0.0 MCP + v3.1.0 Agent Companion v2). MCP servers exist
across ALL services; the dashboard has a working **org-aware text companion + speech-to-text**
(`packages/dashboard/src/agent/*`, `static/agent.js`, `static/agent-speech.js`, drawer partials
`views/partials/agent-*.hbs`). Image input on the LLM providers was MISSING — now shipped.
**User decision: scope = "Vision adapter + TTS"** (converge P83/P84 on one vision adapter + add TTS).
DO NOT rebuild the companion or MCP servers. Single-tier — do NOT touch dormant Free/Pro/Agency.

## REMAINING WORK (suggested order)

### 1. Phase 84 integration — evidence-backed VPAT (highest value)
Wire the pieces that already exist end-to-end in the **dashboard scan pipeline**:
- Map `packages/core/src/index.ts` scan orchestration (`runBehavioralChecks` is called in the
  behavioral pass around line ~310 `runBehavioralPass`). Add a parallel **vision pass** that, for
  up to N pages, runs `captureVisualContext(page)` and calls the LLM `analyse-visual` capability.
  - DECISION TO MAKE: core stays LLM-free, so the vision call belongs in the **dashboard**
    (it owns the LLM client `packages/dashboard/src/llm-client.ts`). Options: (a) capture in core,
    orchestrate+call in dashboard; (b) pass a callback into the scan. Prefer (a) — capture is already
    exported; add a dashboard-side `runVisionPass(urls)` that re-opens pages OR have core return the
    captured contexts. Check how the dashboard invokes core scans before deciding.
- Map verdicts → `Issue`s (runner `vision`, WCAG codes embedding `1_3_1` / `1_1_1` so
  `extractCriterion()` maps them). Merge into each page's issues like behavioral/lighthouse do.
- VPAT/ACR: flip the relevant rows from "Not Evaluated" → evidence-backed when a vision pass ran
  clean/with-findings. Find the VPAT builder (`BuildVpatOptions.evaluator` already exists per
  [[project_backlog_legal_doc_branding]]); add a "Behavioral/Visual simulation" evidence source.
- Opt-in (like `opts.behavioral`); degrade silently on 503 (no vision model) / 504.
- Admin: ensure `analyse-visual` is assignable to a vision-capable model on `/admin/llm` (it's
  already in `CAPABILITY_NAMES`, so it should surface; verify a vision model can be added).

### 2. Phase 83 finish — companion multimodal + TTS
- **Multimodal:** image upload/paste in the agent drawer (`views/partials/agent-drawer.hbs`,
  `static/agent.js`) → thread base64 images through `POST /agent/message` → agent service →
  `ChatMessage.images` (the field now exists). Render image thumbnails in the message log.
- **TTS:** browser `speechSynthesis` voice output — a toggle in the drawer that speaks assistant
  responses, respecting `navigator.language`. Mirror the STT feature-detect/CSP pattern in
  `static/agent-speech.js` (new `agent-tts.js` or extend it). No new provider/cost.
- i18n any new `{{t}}` keys in ALL 6 locales.

### 3. Optional
- Expose `analyse-visual` as an LLM **MCP tool** (`packages/llm/src/mcp/{metadata,server}.ts`) for
  agent access (image-in-args is awkward; low priority).

## GATES (unchanged)
- Dashboard: `tsc --noEmit` clean; full `vitest run` green (CI authoritative; ~3900 tests/~10min).
  Regen `docs:rbac` + `docs:openapi` on ANY route change (rbac-drift/openapi-drift gate CI — both
  bit me this run; always regen after adding a route). i18n keys in all 6 locales.
- Core: behavioral tests are the browser tier (`test:browser`), NOT in CI — run locally.
- KG: one atomic fact/episode, group `knowledge`, `force=true` for release-event facts.
- `.planning/` gitignored except STATE.md/ROADMAP.md/this file (`git add -f`).
