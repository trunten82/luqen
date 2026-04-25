---
phase: 40
plan: 40-06
subsystem: documentation
tags: [docs, readme, index, v3.1.0, cross-link]
requires:
  - 40-01 (OpenAPI snapshots under docs/reference/openapi/)
  - 40-02 (docs/reference/rbac-matrix.md)
  - 40-03 (docs/getting-started/installation.md, docs/deployment/installer-env-vars.md, docs/deployment/installer-changelog.md)
  - 40-04 (docs/guides/agent-history.md, multi-step-tools.md, streaming-share-links.md, multi-org-switching.md)
  - 40-05 (docs/guides/mcp-integration.md, agent-companion.md, prompt-templates.md)
provides:
  - DOC-01 satisfied — top-level README current, no stale instructions, surface coverage complete
affects:
  - README.md
  - docs/README.md
  - docs/QUICKSTART.md
  - docs/USER-GUIDE.md
tech-stack:
  added: []
  patterns:
    - "Incremental README patch (per audit decision) over full restructure — preserves Built-on / Architecture sections"
    - "Main README stays clean — link to docs/ rather than duplicating per-service setup recipes"
key-files:
  created:
    - .planning/phases/40-documentation-sweep/40-06-README-AUDIT.md
    - .planning/phases/40-documentation-sweep/40-06-SUMMARY.md
  modified:
    - README.md
    - docs/README.md
    - docs/QUICKSTART.md
    - docs/USER-GUIDE.md
decisions:
  - "Incremental patch chosen over full restructure for README.md — gaps were surgical (badge, callout, two new sections, reference subsection); existing Architecture / Built on / Composition Paths sections were still accurate."
  - "Per-service setup blocks (Compliance/Branding/LLM/Monitor/Dashboard, lines 168-389 of original) collapsed into a single 'Service setup' table linking the canonical per-service guides — honors the project memory rule 'main README stays clean'."
  - "docs/README.md re-indexed top-to-bottom rather than patched in place — every guide section was missing the v3.1.0 surface and the alphabetical-within-group ordering required full rewrite."
  - "QUICKSTART legacy stdio MCP recipes preserved as the @luqen/core-only path; new v3.0+ Streamable HTTP path linked at the top of the IDE Integration section."
  - "USER-GUIDE.md gained an 'Agent companion (v3.0+)' subsection inside the existing Dashboard section rather than a top-level surface — keeps the document's task-oriented narrative shape."
metrics:
  duration_minutes: ~25
  tasks_completed: 4
  files_created: 1 (audit) + 1 (this summary) = 2
  files_modified: 4
  commits: 4
completed: 2026-04-25
requirements_satisfied: [DOC-01]
---

# Phase 40 Plan 40-06: README sweep + cross-link integration Summary

## One-liner

Top-level README.md and docs/README.md re-aligned with v3.0.0 + v3.1.0 surface — agent companion, MCP integration over OAuth 2.1 + PKCE + DCR, RBAC matrix, OpenAPI snapshots, installer docs, and the four v3.1.0 feature guides — with QUICKSTART and USER-GUIDE cross-linked to the new guides; legacy v2.7.0 badge and "coming as plugins" wording removed.

## Tasks executed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Audit top-level README.md for staleness | 262253f | .planning/phases/40-documentation-sweep/40-06-README-AUDIT.md |
| 2 | Patch top-level README.md | 83eeec4 | README.md |
| 3 | Update docs/README.md index | 032b2ee | docs/README.md |
| 4 | Update QUICKSTART + USER-GUIDE cross-links | 868792b | docs/QUICKSTART.md, docs/USER-GUIDE.md |

## What shipped

### Audit (Task 1)

`40-06-README-AUDIT.md` documents:

- **Decision:** incremental patch (Decision rationale at top of file).
- **Version refs older than v3.1.0:** 2 found (badge line 7, tests badge line 9).
- **Stale feature mentions:** 7 found (e.g. "Four interfaces" → five, "coming as plugins", `/api/v1/docs` → `/docs` LLM swagger URL).
- **Stale links:** 1 in main README (line 406 IDE-integration pointer); 0 in QUICKSTART; 0 in USER-GUIDE.
- **v3.0/v3.1 coverage gaps:** 6 surfaces enumerated (MCP servers, agent companion, RBAC matrix, OpenAPI snapshots, installer docs, agent history/multi-step/streaming/multi-org).
- **Coming-soon markers:** 1 ("PostgreSQL and MongoDB adapters coming as plugins").
- **Cleanliness plan:** drop ~190 lines of duplicated CLI/systemd recipes and replace with link-out service-setup table; final target ≈ 380 lines (achieved 360).

### README.md patch (Task 2)

- Version badge: v2.7.0 → v3.1.0; tests: 2232 → 2300+.
- New "What's new in v3.1.0" callout near the top with the four bullet points + v3.0.0 context line.
- "Four interfaces" rewritten to "Five interfaces" (CLI, per-service Streamable HTTP MCP, in-dashboard agent companion, OAuth2 REST API, web dashboard).
- "Coming as plugins" → "available as plugins" (PostgreSQL/MongoDB).
- New "Agent companion" section linking `docs/guides/agent-companion.md`.
- New "MCP integration" section linking `docs/guides/mcp-integration.md` and noting the legacy stdio path in QUICKSTART.
- Architecture diagram updated: dashboard now shows `Web UI · REST · MCP · Agent companion`; per-service boxes now show `MCP` row; new Request flow row "External MCP client → /api/v1/mcp".
- Per-service setup blocks (Compliance / Branding / LLM / Monitor / Update & Restart / Service management / Dashboard / Docker prose) collapsed into one "Service setup" table linking the canonical guides; "Update & restart" reduced to a 3-line block + link to QUICKSTART.
- Documentation section rewritten to surface the new guides (`docs/guides/agent-companion.md`, `mcp-integration.md`, `agent-history.md`, `multi-step-tools.md`, `streaming-share-links.md`, `multi-org-switching.md`, `prompt-templates.md`) and the new reference files (`rbac-matrix.md`, `reference/openapi/`).
- "Built on / @fastify/swagger" row updated: "OpenAPI spec generation across all services" (was: "for the LLM service").
- LLM swagger URL bumped: `http://localhost:4200/api/v1/docs` → `http://localhost:4200/docs` (per Plan 40-01 standardisation).

Final line count: **360** (acceptance criterion ≤ 400 satisfied).

### docs/README.md rewrite (Task 3)

Full rewrite with these sections, alphabetical within each group:

- **Where to start** (9 rows including agent-companion + mcp-integration entry points)
- **Getting started** (5 rows; adds `getting-started/installation.md`)
- **Guides** (15 rows — every `.md` in `docs/guides/` listed alphabetically with one-line descriptions; includes all 7 new v3.1.0 guides)
- **Reference** (13 rows; adds `reference/cli-reference.md`, `reference/git-host-plugins.md`, `reference/graphql-schema.md`, `reference/mcp-tools.md`, `reference/openapi/`, `reference/plugin-development.md`, `reference/rbac-matrix.md`)
- **Deployment** (6 rows; adds the two installer docs and the install guide)
- **Integrations** (4 rows; adds mcp-integration cross-link)
- **Package deep dives** (7 rows; adds @luqen/branding, @luqen/llm, @luqen/monitor, plugins)
- **Other** (architecture, security, licensing)

Stale v2.4.1 callout replaced with v3.1.0 callout. Plugin guide row "all 7 plugins" → "all 11 plugins" (matches main README and project memory `project_plugin_catalogue.md`).

### QUICKSTART.md + USER-GUIDE.md cross-links (Task 4)

QUICKSTART:

- New blockquote at the top of "IDE Integration" pointing external MCP clients (Claude Desktop / Cursor / Windsurf / custom) to `guides/mcp-integration.md` and labelling the existing stdio recipes as the `@luqen/core`-only legacy path.
- "Next steps" table gained 3 new rows: `agent-companion.md`, `mcp-integration.md`, `multi-org-switching.md`.
- "New in v2.6.0" callout replaced with "What's new in v3.1.0" (4 bullets + v3.0.0 context line + link to `deployment/installer-changelog.md`).

USER-GUIDE:

- New "Agent companion (v3.0+)" subsection inside the existing Dashboard section, with a 5-row table cross-linking `agent-companion.md`, `agent-history.md`, `multi-step-tools.md`, `streaming-share-links.md`, `multi-org-switching.md`, plus an outbound link to `mcp-integration.md` for external-client setup.

No `mcp-client-setup.md` or `mcp-external-client-walkthrough.md` references existed in either file — the audit verified this — so the "remove legacy refs" acceptance criterion was satisfied at audit time.

## Acceptance criteria — all green

### Task 1

- [x] `test -f .planning/phases/40-documentation-sweep/40-06-README-AUDIT.md`
- [x] Decision line present: "**Decision: incremental** patch, not full restructure."
- [x] ≥ 1 finding per category (versions: 2; stale features: 7; stale links: 1; gaps: 6; coming-soon: 1)

### Task 2

- [x] `grep -q "v3.1.0" README.md` — 4 matches
- [x] `grep -q "agent-companion.md\|agent companion" README.md` — 7 matches
- [x] `grep -q "mcp-integration.md\|MCP integration" README.md` — 3 matches
- [x] `grep -q "rbac-matrix.md" README.md` — 1 match
- [x] `wc -l README.md` = 360 ≤ 400

Stale-term grep audit (every flagged term `grep -c` returns 0):

- `v2.7.0` — 0
- `coming as plugins` — 0
- `PostgreSQL and MongoDB adapters coming` — 0

### Task 3

All 9 path checks pass (one match each):

- [x] `guides/agent-history.md`
- [x] `guides/multi-step-tools.md`
- [x] `guides/streaming-share-links.md`
- [x] `guides/multi-org-switching.md`
- [x] `guides/mcp-integration.md`
- [x] `guides/agent-companion.md`
- [x] `guides/prompt-templates.md`
- [x] `reference/rbac-matrix.md`
- [x] `reference/openapi`

### Task 4

- [x] `grep -c "guides/agent-companion.md\|guides/mcp-integration.md" docs/QUICKSTART.md` = 3
- [x] `grep -c "guides/agent-history.md\|guides/streaming-share-links.md\|guides/multi-step-tools.md" docs/USER-GUIDE.md` = 3
- [x] `grep -E "mcp-client-setup\.md|mcp-external-client-walkthrough\.md" docs/QUICKSTART.md docs/USER-GUIDE.md` returns no matches

## Deviations from plan

**None.** All four tasks executed exactly as written. No Rule 1/2/3 auto-fixes were required; no Rule 4 architectural deviations. The audit's "incremental patch" decision is per-plan-permitted CONTEXT discretion (D-10 / DOC-01 deferred-idea).

## Authentication gates

None. Fully autonomous run.

## Threat surface scan

No new network endpoints, auth paths, file-access patterns, or schema changes — documentation-only plan. No threat flags raised.

## Known stubs

None. All four files are substantive, complete, and link only to existing artifacts (guides created in 40-04/05, reference files created in 40-01/02, deployment docs created in 40-03). The README's `docs/paths/` link is pre-existing and unchanged.

## Self-Check: PASSED

Files verified on disk in worktree:

- FOUND: README.md (modified, 360 lines)
- FOUND: docs/README.md (modified)
- FOUND: docs/QUICKSTART.md (modified)
- FOUND: docs/USER-GUIDE.md (modified)
- FOUND: .planning/phases/40-documentation-sweep/40-06-README-AUDIT.md
- FOUND: .planning/phases/40-documentation-sweep/40-06-SUMMARY.md (this file)

Linked targets verified to exist on disk (Task 3 acceptance):

- FOUND: docs/guides/agent-companion.md
- FOUND: docs/guides/mcp-integration.md
- FOUND: docs/guides/agent-history.md
- FOUND: docs/guides/multi-step-tools.md
- FOUND: docs/guides/streaming-share-links.md
- FOUND: docs/guides/multi-org-switching.md
- FOUND: docs/guides/prompt-templates.md
- FOUND: docs/reference/rbac-matrix.md
- FOUND: docs/reference/openapi/{compliance,branding,llm,dashboard,mcp}.json
- FOUND: docs/getting-started/installation.md
- FOUND: docs/deployment/installer-env-vars.md
- FOUND: docs/deployment/installer-changelog.md

Commits verified in `git log`:

- FOUND: 262253f docs(40-06): audit README.md staleness vs v3.0/v3.1 surface
- FOUND: 83eeec4 docs(40-06): patch top-level README for v3.0/v3.1 surface
- FOUND: 032b2ee docs(40-06): rewrite docs/README.md index for v3.1.0 guides + reference
- FOUND: 868792b docs(40-06): cross-link QUICKSTART + USER-GUIDE to v3.1.0 guides
