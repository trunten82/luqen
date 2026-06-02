# Luqen — next session kickoff (self-contained; just read this file and go)

You are resuming the Luqen autonomous build. **Run to completion autonomously**, the
same flow per item: plan → TDD → real UAT → CI green → deploy → docs + KG +
ROADMAP/STATE. Only stop for a genuine product/legal fork you cannot reasonably
default. Checkpoint with a handoff (update this file) if context runs low.

## 0. First steps
1. **Verify green state** (all confirmed green at handoff 2026-06-02, session 2):
   - luqen: `master == origin == 0afbc49` (Item A `cca049d` + C#3 MCP tool `0afbc49`);
     live `/login` → 200, `/api/v1/entitlement` → 401.
   - luqen-wordpress: `master == origin == 8fdf14e`, **v0.26.0**, WP CI green. PRIVATE repo.
2. **Load these memory files before planning:**
   - `project_v3_6_milestone_state` — what's DONE vs remaining (do NOT rebuild done work).
   - `project_single_tier_decision` — product is SINGLE-TIER; Free/Pro/Agency surfaces are
     dormant — do NOT build on or rebuild them.
   - `feedback_ui_phase_uat`, `feedback_autonomous_gsd`, `feedback_ci_after_phases`,
     `feedback_wp_plugin_testing_lxc`, `reference_wp_test_lxc`, `reference_wp_test_lxc_git_state`.

## 1. Already DONE this milestone (v3.6.0) — do NOT redo
Phase 83 was ~90% pre-shipped (v3.0.0 MCP + v3.1.0 Agent Companion v2): MCP servers across
all services + an org-aware **text** companion + **speech-to-text** already existed. Shipped
this run (all on master, CI green, deployed):
- `85be72a` LLM **vision adapter** (image input on OpenAI/Anthropic/Ollama, `complete()` +
  `completeStream()`) + **analyse-visual** capability + `POST /api/v1/analyse-visual`
  (`heading-semantics`→WCAG 1.3.1, `alt-text`→1.1.1).
- `941c956` core **`captureVisualContext()`** (`@luqen/core/behavioral/visual.ts`): screenshot
  + heading outline + image inventory; LLM-agnostic; exported from core public index.
- `3343063` **Phase 84 vision integration**: core `BehavioralOptions.onVisualContext` callback;
  dashboard `LLMClient.analyseVisual()`, `scanner/vision-pass.ts` (heading-semantics →
  `Issue` runner='vision', degrade to [] on 503), orchestrator `resolveVisionAnalyzer` +
  `server.ts` wiring. Vision rides the deep behavioral scan; findings flow into reports + VPAT.
- `9a018de` **Phase 83 TTS**: `static/agent-tts.js` browser `speechSynthesis` voice-output
  toggle; spoken on the SSE 'done' frame; i18n in all 6 locales.

## 2. REMAINING WORK (suggested order)

### Item A — DONE 2026-06-02 (`cca049d`, CI green, deployed)
Phase 83 companion multimodal image upload shipped. Image upload + clipboard paste
in the drawer (`agent-images.js`, staging tray, ≤4 × ≤5 MB png/jpeg/webp/gif), base64
threaded through `POST /agent/message` (new `images` array + urlencoded `imagesJson`,
both validated through one schema; image-only turns allowed; per-route `bodyLimit`
raised) → migration 085 `agent_messages.images` → `windowToChatMessages` carries
`images` → LLM `agent-conversation` spreads into `completeStream` (adapters render).
Thumbnails in the optimistic bubble + history rehydrate. i18n ×6, CSS, openapi regen.
Full dashboard suite green (3965). **STILL NEEDS HUMAN UAT** — and a vision-capable
model must be assigned to the `agent-conversation` capability on `/admin/llm`, else the
provider 400s on image turns (graceful, but no vision).

### Item C#3 — DONE 2026-06-02 (`0afbc49`). `llm_analyse_visual` MCP tool added.
### Item C#4 — already satisfied (`analyse-visual` ∈ `CAPABILITY_NAMES` → surfaces on /admin/llm).

### Item B — WordPress vision mirror (luqen-wordpress repo, PRIVATE, separate CI)
Bring the LLM-vision heading-semantics (and, if Item C lands, alt-text) check to the WP plugin.
- **Enterprise mode (connected to a Luqen instance):** WP scans delegate to the dashboard
  `/api/v1/scans`, so vision findings already flow through automatically once the connected
  Luqen has a vision model configured. CONFIRM this end-to-end and surface vision findings in
  the WP findings UI (they arrive as `runner='vision'` issues). Likely small.
- **Standalone mode (axe-core client-side, no dashboard):** the real work. The in-browser
  scan runner (`assets/js/scan-runner.js`, injected by `includes/class-scan-runner.php`)
  already drives an iframe — capture a screenshot + heading outline client-side, then POST to
  the connected Luqen's `analyse-visual` (vision REQUIRES an LLM, so standalone-with-no-
  connection cannot do vision — gate the feature on a configured connection; degrade silently
  otherwise). Map verdicts into the existing findings POST
  (`/wp-json/luqen/v1/scans/<uid>/findings`).
- Respect single-tier: do NOT gate behind Pro/Agency (those surfaces are dormant).
- **Testing is mandatory via the wp-test lxc + Playwright** (`feedback_wp_plugin_testing_lxc`):
  rsync the plugin to lxc `192.168.3.160`, restart wp-now (`:8881`), run PHPCS/PHPUnit/smoke
  ON the box, Playwright from the dev box via the `:8881` tunnel. For DB-seeded UAT drop a
  mu-plugin fixture in `/root/.wp-now/mu-plugins/`.
- Bump version + CHANGELOG + readme.txt (keep `Stable tag:` == header Version — it has lagged)
  + regen `.pot`. WP gates: PHPCS (errors only) + PHPUnit + smoke + Playwright.

### Item C — optional polish (dashboard) — C#3 + C#4 DONE; C#1 + C#2 remain
- **C#1 alt-text vision check (DEFERRED — higher effort):** `captureVisualContext`
  (`@luqen/core/behavioral/visual.ts`) captures `CapturedImage.src` but NOT per-image
  BYTES. To do alt-text: capture each `<img>`'s bytes (puppeteer ElementHandle
  `imgEl.screenshot()` or fetch the src), then in dashboard `scanner/vision-pass.ts`
  `buildVisionAnalyzer` call `analyseVisual({check:'alt-text', image, context:altText})`
  per image and map `suggestedAlt`→1.1.1 `Issue`. Cost: one LLM call per image (cap it).
  NOTE: core behavioral/browser tests are LOCAL-only (`npm run test:browser -w packages/core`),
  NOT in CI — verify there.
- **C#2 positive-pass VPAT upgrade (DEFERRED — legally sensitive):** today a vision
  *finding* moves 1.3.1 off "Not Evaluated" (good), but a *clean* vision pass does not
  upgrade to "Supports". `vpat-service.ts deriveRow` deliberately keeps `requiresManual`
  criteria at "Not Evaluated" on a clean automated scan (anti-over-claim, FTC/accessiBe
  precedent). To upgrade, plumb a "vision/behaviorally-evaluated criteria" SET from the
  scan into the VPAT builder and add a careful attestation line — frame conservatively.
- ~~C#3 analyse-visual MCP tool~~ DONE (`0afbc49`). ~~C#4 admin/llm surfacing~~ verified.

When v3.6.0's items ship, consider `/gsd:complete-milestone` to archive the milestone.
Suggested next order: **HUMAN UAT (A + TTS)** → Item B (WP) → C#1 → C#2.

## 3. GATES (do not forget)
- Dashboard: `tsc --noEmit` clean; full `vitest run` green (CI authoritative; ~3900 tests/
  ~10 min). **Regen `docs:rbac` + `docs:openapi` on ANY route change** — both gate CI
  (`rbac-drift` + `openapi-drift`); they bit this run twice. i18n keys in ALL 6 locales.
- Core: behavioral/browser tests are EXCLUDED from CI (slow tier). Run locally:
  `npm run test:browser -w packages/core` (`vitest.browser.config.ts`).
- Deploy auto-fires on green CI. SANDBOX QUIRK: `cd` is stripped from compound SSH — verify
  deploy via the Deploy workflow conclusion + `/login` + a live route smoke, NOT
  `ssh … 'cd … && git …'`.
- KG: one atomic fact/episode, group `knowledge`, `force=true` for release-event facts.
- `.planning/` is gitignored except `STATE.md`/`ROADMAP.md`/this file (`git add -f`).
- WP: test via wp-test lxc + Playwright; bump version + CHANGELOG + readme.txt + `.pot`.
