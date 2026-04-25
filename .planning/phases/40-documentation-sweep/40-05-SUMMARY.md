---
phase: 40
plan: 05
subsystem: documentation
tags: [docs, mcp, agent, prompts, oauth]
requires:
  - "MCP server, OAuth 2.1 + PKCE + DCR endpoints (Phase 30, 30.1, 31.1, 31.2)"
  - "Agent companion UI surfaces (Phases 32, 33, 35, 36, 37, 38)"
  - "Prompt template validator (segments.ts, prompts route 422)"
provides:
  - "DOC-04 deliverable: docs/guides/mcp-integration.md"
  - "DOC-05 deliverable: docs/guides/agent-companion.md"
  - "DOC-06 deliverable: docs/guides/prompt-templates.md"
affects:
  - docs/guides/mcp-integration.md
  - docs/guides/agent-companion.md
  - docs/guides/prompt-templates.md
  - docs/mcp-client-setup.md
  - docs/mcp-external-client-walkthrough.md
tech-stack:
  added: []
  patterns:
    - "D-11 audience-subsection shape (`## For end users` + `## For admins`) on MCP and agent guides"
    - "Redirect-stub pattern for legacy doc paths"
key-files:
  created:
    - docs/guides/mcp-integration.md
    - docs/guides/agent-companion.md
    - docs/guides/prompt-templates.md
  modified:
    - docs/mcp-client-setup.md
    - docs/mcp-external-client-walkthrough.md
decisions:
  - "Document `mcp-remote` bridge for stdio MCP clients (Claude Desktop, Cursor, Windsurf) and direct Streamable HTTP for IDE plugins that speak it natively"
  - "Document scopes_supported as ['read', 'write'] per /.well-known/oauth-authorization-server (admin scope deliberately not advertised)"
  - "Reset-to-default workflow described as DELETE /api/v1/prompts/:capability matching dashboard route at packages/dashboard/src/routes/admin/llm.ts:704"
  - "Cross-link to upcoming reference docs (rbac-matrix.md, installer-env-vars.md, openapi/mcp.json) — these are siblings in Phase 40 deliverables and links may be dangling until those plans land"
metrics:
  duration: "single executor session"
  tasks_completed: 4
  files_created: 3
  files_modified: 2
  completed_date: 2026-04-25
---

# Phase 40 Plan 05: MCP integration + agent companion + prompt templates guides Summary

Three new audience-aware guides that document the user-facing surfaces of v3.1.0 — connecting MCP clients via OAuth 2.1 + PKCE + DCR, using the dashboard agent companion, and authoring locked-section prompt overrides — with the two legacy MCP docs reduced to redirect stubs.

## Tasks Completed

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | docs/guides/mcp-integration.md (DOC-04) | dbba9b9 |
| 2 | Replace legacy MCP docs with redirect stubs | f715a96 |
| 3 | docs/guides/agent-companion.md (DOC-05) | 90b8ed3 |
| 4 | docs/guides/prompt-templates.md (DOC-06) | 7e34c7f |

## Highlights

- **mcp-integration.md** consolidates Claude Desktop / IDE / custom-client setup with a full OAuth 2.1 walkthrough (PKCE mandatory, DCR via `POST /oauth/register`, `mcp.use` consent gate, `read`/`write` scope tiers per the actual `/.well-known` advertisement). Endpoint paths verified against `packages/dashboard/src/routes/oauth/`. Streamable HTTP vs deprecated SSE-only is called out per the CLAUDE.md gotcha.
- **agent-companion.md** covers the full v3.0/v3.1 surface — drawer UX, streaming, tools, multi-step transparency, history panel, share permalinks, multi-org switching, Web Speech API gating, context hints, token-budget compaction at 85%. Speech-input section explicitly documents Firefox falls back to a hidden mic + hint (per `agent-speech.js` behaviour). RBAC gating via `mcp.use` documented for admins.
- **prompt-templates.md** lifts the exact fence syntax (`<!-- LOCKED:name -->` … `<!-- /LOCKED -->`) and violation taxonomy (`missing`/`modified`/`renamed`/`reordered`) from `packages/llm/src/prompts/segments.ts`. The validator section documents `PUT /api/v1/prompts/:capability` with the 422 envelope shape and the `agent-system`-no-orgId guard. Reset-to-default workflow matches the actual `DELETE /api/v1/prompts/:capability` admin UI route.
- **Legacy doc redirection** — both `docs/mcp-client-setup.md` and `docs/mcp-external-client-walkthrough.md` reduced to 5-line redirect stubs. No external inbound references existed in `docs/`, `README.md`, or `packages/` (only intra-doc cross-references in the legacy walkthrough), so no link rewrites were needed beyond the stubs themselves.

## Deviations from Plan

None substantive. The plan was executed exactly as written.

One small note: the plan's read_first instruction for Task 4 mentioned a hypothetical `npm run validate-prompts` script. The actual codebase has no standalone validator CLI — validation runs server-side at the PUT endpoint with a 422 response. The guide reflects what's actually shipping and includes a `curl` example admins can use to drive the validator.

## Cross-Link Audit

Several outbound links target guides scheduled to land later in Phase 40 (this plan ran in Wave 1):

- `docs/reference/rbac-matrix.md` — Plan 40-06 / 40-07 deliverable
- `docs/reference/installer-env-vars.md` — Plan 40-04 deliverable
- `docs/reference/openapi/mcp.json` — Plan 40-02 OpenAPI deliverable
- `docs/guides/agent-history.md`, `multi-step-tools.md`, `streaming-share-links.md`, `multi-org-switching.md` — Plan 40-03 deliverables (per CONTEXT D-12)

These are deliberate forward-references — D-12 mandates each surface gets a dedicated guide; they will be created by sibling Plan 40-03. Phase verification should run a final cross-link audit after all Phase 40 plans land.

## Self-Check: PASSED

Created files exist:

- `docs/guides/mcp-integration.md` — present (246 lines)
- `docs/guides/agent-companion.md` — present (220 lines)
- `docs/guides/prompt-templates.md` — present (277 lines)

Modified files exist as 5-line redirect stubs:

- `docs/mcp-client-setup.md` — present (5 lines, contains "Moved" + correct link)
- `docs/mcp-external-client-walkthrough.md` — present (5 lines, contains "Moved" + correct link)

Commits:

- `dbba9b9` — Task 1 commit on `worktree-agent-a3ffdf92`
- `f715a96` — Task 2 commit on `worktree-agent-a3ffdf92`
- `90b8ed3` — Task 3 commit on `worktree-agent-a3ffdf92`
- `7e34c7f` — Task 4 commit on `worktree-agent-a3ffdf92`

Acceptance grep checklist (all pass): see commit messages and inline verification output during execution.
