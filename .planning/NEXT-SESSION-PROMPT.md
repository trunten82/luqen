# Luqen — next session kickoff (self-contained; just read this file and go)

Updated 2026-07-18. Previous version of this file (2026-06-02) described the v3.6.0
build items — ALL of those shipped; do not rebuild them (details in §1).

## Current state (2026-07-18)

- **v3.5.0 "Anti-overlay wedge"** — executed 2026-06-07..11, security 26/26, archived
  (`.planning/milestones/v3.5.0-*`). Phases 78–82 all complete.
- **v3.6.0 "Agent surface + semantic depth"** — CODE-COMPLETE. Everything shipped:
  vision adapter + `analyse-visual`, core `captureVisualContext()` (incl. per-image
  bytes), dashboard vision pass (heading-semantics 1.3.1 + alt-text 1.1.1, capped),
  companion multimodal image upload (`cca049d`) + TTS (`9a018de`), WP vision mirror
  (enterprise badge v0.27.0, standalone client-side vision pass v0.28.0 `548f4bf`),
  C#2 conservative "Supports-from-vision" VPAT elevation, `llm_analyse_visual` MCP
  tool. WP plugin is at **v0.33.0** (digest + exposure + publish gate).
- **2026-07-18:** two live companion bugs found via automated UAT and fixed:
  (1) Gemini streaming broken from day one — Gemini's SSE uses CRLF
  (`\r\n\r\n`) frame delimiters and `readSsePayloads` only split on `\n\n`,
  so `completeStream()` yielded zero tokens then `done`; invisible until the
  2026-07-15 rerouting made gemini-2.5-flash the `agent-conversation` primary
  (blank companion turns). Fixed in `601548cf` + CRLF wire-format test.
  (2) The agent system prompt's tool-manifest rule made the model refuse
  attached images ("I cannot directly analyze images") — it predates Phase 83
  multimodal. Fixed in `927f2fd0` (LOCKED:multimodal fence). Final live UAT
  8/8 incl. TTS speak-on-done and a correct vision answer on an attached image.
- Live LLM routing: gemini-2.5-flash primary everywhere (+ gemini-2.5-pro backup on
  analyse-visual, gpt-oss:120b-cloud fallback elsewhere). agent-conversation is
  vision-capable — image turns work.

## v3.6.0 — what remains before `/gsd:complete-milestone` (both USER-gated)

1. **Human UAT** of companion image upload + TTS on a real browser/device (audio
   quality, mobile drawer, paste flow). Automated live UAT (login → drawer → TTS
   toggle → text turn spoken → image staged → vision answer) is green 2026-07-18.
2. **LEGAL sign-off** on the C#2 "Supports-from-vision" VPAT wording before it is
   relied on in a legal document (`vpat-service.ts` C#2 block).

Optional (explicitly deferred, fine to skip): promote gemini-2.5-pro to
analyse-visual primary (flash performing well); age-gate bypass via pa11y
actions/cookies for full-content scans of gated sites.

## GATES (unchanged — do not forget)

- Dashboard: `tsc --noEmit` clean; full `vitest run` green (CI authoritative).
  **Regen `docs:rbac` + `docs:openapi` on ANY route change** — both gate CI.
  i18n keys in ALL 6 locales.
- Core: behavioral/browser tests are LOCAL-only: `npm run test:browser -w packages/core`.
- Deploy auto-fires on green CI (self-hosted runner). Verify via the Deploy
  workflow conclusion + `/login` + a live route smoke.
- KG: one atomic fact/episode, group `knowledge`.
- `.planning/` is gitignored except `STATE.md`/`ROADMAP.md`/this file (`git add -f`).
- WP: test via wp-test lxc + Playwright; bump version + CHANGELOG + readme.txt + `.pot`.
- LLM capability assignments MUST use `--org ''` (universal fallback); `org='system'`
  rows are INERT for real scans.

## Backlog pointers (next milestone candidates)

- Follow-on moats (out of scope for v3.6.0): mobile app testing; managed expert-audit
  service; A2 deepen PR fixes; A5 fleet fix-once-apply-everywhere; B3
  remediation-velocity KPIs (see `.planning/MARKET-POSITIONING-2026-06.md`).
- Widget/overlay VPAT surface idea (memory: `project_backlog_widget_vpat_report`).
- Per-org logo/company info on legal docs (memory: `project_backlog_legal_doc_branding`).
