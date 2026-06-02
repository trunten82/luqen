# Luqen — next session kickoff (resume v3.6.0 — only companion multimodal left)

Continue the autonomous run. Same flow: plan → TDD → real UAT → CI green → deploy →
docs + KG + STATE/ROADMAP. Only stop for a genuine product/legal fork you can't default.

## STATE (verify first — all green)
- **luqen (dashboard/llm/core):** master == origin. v3.6.0 is ~DONE except companion multimodal:
  - `85be72a` LLM **vision adapter** (image input on OpenAI/Anthropic/Ollama) + **analyse-visual**
    capability (`POST /api/v1/analyse-visual`; `heading-semantics`→1.3.1, `alt-text`→1.1.1).
  - `941c956` core **`captureVisualContext()`** (`@luqen/core/behavioral/visual.ts`).
  - `3343063` **Phase 84 vision integration DONE** — `BehavioralOptions.onVisualContext` callback;
    dashboard `LLMClient.analyseVisual()`, `scanner/vision-pass.ts`, orchestrator
    `resolveVisionAnalyzer` + `server.ts` wiring. Vision rides the deep behavioral scan; findings
    (runner='vision') flow into reports + VPAT; degrades to [] on 503.
  - `9a018de` **Phase 83 TTS DONE** — `static/agent-tts.js` voice-output toggle; i18n ×6.
  - CI + rbac-drift + openapi-drift green; Deploy auto-fires on green CI. Verify `/login` 200,
    `/api/v1/entitlement` 401.
  - SANDBOX QUIRK: `cd` stripped from compound SSH — verify deploy via Deploy workflow conclusion
    + `/login` + a live route smoke, NOT `ssh … 'cd … && git …'`.
  - Behavioral/browser tests are EXCLUDED from CI (slow tier). Run with
    `npm run test:browser -w packages/core` locally (`vitest.browser.config.ts`).
- **luqen-wordpress:** master == origin = `8fdf14e`, v0.26.0, CI green. PRIVATE. (No WP work yet.)

## DO NOT rebuild
Phase 83 was ~90% pre-shipped (v3.0.0 MCP + v3.1.0 Agent Companion v2). MCP servers + the org-aware
text companion + STT already exist. Single-tier — do NOT touch dormant Free/Pro/Agency.
See [[project_v3_6_milestone_state]].

## REMAINING WORK

### 1. Phase 83 companion multimodal (the only core v3.6.0 item left)
- Image upload/paste in the agent drawer (`views/partials/agent-drawer.hbs`, `static/agent.js`).
- Thread base64 images: `POST /agent/message` (`routes/agent.ts`) → agent service
  (`agent/agent-service.ts`) → `ChatMessage.images` (field already exists in @luqen/llm).
- Render image thumbnails in the message log (`views/partials/agent-message*.hbs`); persist with
  the message. Check `agent-conversation` capability/exec route threads `images` through (the
  provider adapters already accept them on `completeStream`).
- i18n new `{{t}}` keys in ALL 6 locales (flat dotted keys, e.g. `"agent.image.add"`).
- HUMAN UAT required (UI) — also UAT the already-shipped TTS toggle.

### 2. Optional polish
- **alt-text** vision check: capture currently feeds only the full-page screenshot + heading outline
  to `heading-semantics`. For per-image alt-text, capture each `<img>`'s bytes (puppeteer
  `element.screenshot()` or fetch src) and call `analyse-visual` with `check:'alt-text'`; map
  `suggestedAlt` into the finding.
- **Positive-pass VPAT upgrade**: today a vision *finding* moves 1.3.1 off "Not Evaluated" (good),
  but a *clean* vision pass does not upgrade to "Supports". Add a "behaviorally evaluated criteria"
  signal to `vpat-service.ts deriveRow` + an attestation line.
- Expose `analyse-visual` as an LLM **MCP tool** (`packages/llm/src/mcp/{metadata,server}.ts`).
- Verify a vision model is assignable to `analyse-visual` on `/admin/llm` (it's in `CAPABILITY_NAMES`).

### 3. WP mirror — separate later milestone (vision needs the dashboard/enterprise path).

## GATES (unchanged)
- Dashboard: `tsc --noEmit` clean; full `vitest run` green (CI authoritative; ~3900 tests/~10min).
  Regen `docs:rbac` + `docs:openapi` on ANY route change (rbac-drift/openapi-drift gate CI — both
  bit me this run; always regen after adding a route). i18n keys in all 6 locales.
- Core: behavioral tests are the browser tier (`test:browser`), NOT in CI — run locally.
- KG: one atomic fact/episode, group `knowledge`, `force=true` for release-event facts.
- `.planning/` gitignored except STATE.md/ROADMAP.md/this file (`git add -f`).
