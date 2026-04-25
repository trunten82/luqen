# 40-06 README Audit (Top-level README.md + docs/README.md)

**Decision: incremental** patch, not full restructure.

Rationale: README.md already covers v3.0.0-era surfaces (LLM, branding, MCP server,
plugins, etc.) at the right altitude. Gaps are concentrated in (a) the version
badge, (b) the missing v3.0/v3.1 callout, (c) absence of the new agent companion
+ MCP integration sections, and (d) stale links to retired docs. Each is a
surgical change. A full restructure would invalidate the existing "Built on" /
"Composition Paths" / "Architecture" sections that are still accurate.

`docs/README.md` index, by contrast, needs near-total rewrite because every guide
section is missing the 7 new v3.1.0 guides and the new reference / deployment
files. That is handled in Task 3 (separate file, separate decision).

---

## Findings — README.md

### Version references older than v3.1.0

| Line | Content | Action |
| ---- | ------- | ------ |
| 7    | `![Version](https://img.shields.io/badge/version-v2.7.0-blue)` | bump to `v3.1.0` |
| 9    | `![Tests](https://img.shields.io/badge/tests-2232%20passing-brightgreen)` | bump to `v3.1.0`-era count (≥2300 per PROJECT.md context) |

### Stale feature mentions / removed wording

| Line(s) | Content | Action |
| ------- | ------- | ------ |
| 7 (badge) | `v2.7.0` | replace with `v3.1.0` |
| 18 | "all through a unified dashboard, CLI, MCP server, and REST API" — accurate but missing **agent companion** | extend to include agent companion |
| 41 | "Four interfaces — CLI for humans, MCP server for AI agents (Claude Code), OAuth2 REST API with OpenAPI/Swagger, web dashboard" | rewrite to FIVE interfaces: CLI, MCP server (per service, OAuth 2.1 + PKCE + DCR), agent companion (in-dashboard, streaming + speech), OAuth2 REST API (with live `/docs`), web dashboard |
| 46 | "PostgreSQL and MongoDB adapters coming as plugins" — "coming" is stale (per memory: implemented in v1.7.0) | drop "coming as plugins" — say "available as plugins" |
| 262 | "The REST API is documented at `http://localhost:4000/docs` (Swagger UI)" — fine, but page-level docs URL has changed across services from `/api/v1/docs` → `/docs` (Plan 40-01 standardisation) | leave (already correct) |
| 341 | "The interactive API docs are at `http://localhost:4200/api/v1/docs` (Swagger UI)" — Plan 40-01 standardised on `/docs` | bump to `http://localhost:4200/docs` |
| 466 | "@fastify/swagger — OpenAPI spec generation **for the LLM service**" — Plan 40-01 wired this across all 5 services | rewrite: "OpenAPI spec generation across all services" |
| Whole installer/Quick-Start block | Bare-metal flow points at `npm link` and not at the official installers documented in Plan 40-03 (`docs/getting-started/installation.md`) | Add a single-line link to the new install guide alongside the existing `curl ... install.sh` block |

### Stale links / links to retired files

| Line | Link | Action |
| ---- | ---- | ------ |
| 410 | `docs/getting-started/` | OK — directory exists |
| 411 | `docs/paths/` | exists — leave |
| 412 | `docs/reference/` | OK |
| 413 | `docs/deployment/` | OK |
| 414 | `docs/QUICKSTART.md` | OK |
| 415 | `docs/USER-GUIDE.md` | OK |
| 416 | `docs/SECURITY-REVIEW.md` | OK |
| 417 | `docs/LICENSING.md` | OK |
| 406 | "MCP Integration … See `docs/QUICKSTART.md#ide-integration`" — `QUICKSTART.md` IDE-integration section is now superseded by `docs/guides/mcp-integration.md` | replace with link to `docs/guides/mcp-integration.md` |

### Coverage gaps (v3.0 / v3.1 surface)

| Surface | Status in current README | Action |
| ------- | ----------------------- | ------ |
| MCP servers (OAuth 2.1 + PKCE + DCR, Streamable HTTP) | One-liner under "Four interfaces"; no integration link | New "MCP integration" section pointing at `docs/guides/mcp-integration.md` |
| Agent companion (text + speech, SSE streaming, native-dialog tool confirmation, audit log, multi-step tools, share permalinks, multi-org switching) | Not mentioned | New "Agent companion" section pointing at `docs/guides/agent-companion.md` |
| RBAC matrix (machine-checkable, generated) | Not mentioned | New "Reference" subsection linking `docs/reference/rbac-matrix.md` |
| OpenAPI snapshots (Plan 40-01 deliverable, all 5 services) | Not mentioned | Same Reference subsection links `docs/reference/openapi/{compliance,branding,llm,dashboard,mcp}.json` plus `/docs` per service |
| Installer docs (env vars, changelog, end-to-end install) | "One-line install" block exists; no link to the canonical install guide | Reference `docs/getting-started/installation.md` and `docs/deployment/installer-env-vars.md` |
| Agent history / multi-step tools / streaming-share / multi-org switching (Phases 35-38) | Not mentioned | Covered indirectly via the agent-companion guide link; no per-feature section needed in main README to keep it clean (per `feedback_documentation_patterns.md`: main README stays clean) |

### "Coming soon" / TODO / WIP markers

- Line 46 "coming as plugins" (PostgreSQL/MongoDB) — stale, drop.
- No literal "TODO" / "WIP" markers. None other found.

### Sanity / cleanliness

Current line count: 515. Target ≤ 400. The new content adds 1 callout + 2
short feature sections + 1 Reference subsection (~25 lines net). To stay ≤ 400
the audit recommends collapsing/replacing:

- The standalone **Compliance Service Setup**, **Branding Service**, **LLM
  Service**, **Monitor Agent**, **Update & Restart**, **Service management**,
  and **Dashboard** narrative blocks (lines 168-389) into **one** "Service
  setup" subsection that links to the canonical per-service guides
  (`docs/getting-started/installation.md`, `packages/llm/README.md`,
  `docs/branding/README.md`, `docs/reference/dashboard-config.md`,
  `docs/reference/monitor-config.md`). This is consistent with the project memory
  rule "main README stays clean — link to docs rather than duplicating content"
  (`feedback_documentation_patterns.md`).
- The `Test Suite` block can shrink to 3 lines.
- `Built on` table set is excellent context for new contributors — keep, but
  consolidate the seven small subsection tables into a single grouped table
  to save vertical space, OR leave as-is and accept the extra lines if total
  stays ≤ 400. **Decision:** keep as-is; it's the most-read section per memory.

Net plan: **drop ~190 lines** of duplicated CLI / systemd recipes that live in
the canonical install guide (Plan 40-03), **add ~50 lines** of new v3.0/v3.1
content + reference links. Final target ≈ 380 lines.

---

## Findings — docs/README.md (handled in Task 3)

| Issue | Action |
| ----- | ------ |
| Line 5 v2.4.1 callout | replace with v3.1.0 callout |
| No "Guides" group listing the 7 new v3.1.0 guides | add Guides section listing all 15 .md files in docs/guides/ alphabetically with one-line descriptions |
| No reference to `docs/reference/openapi/` | add to Reference table |
| No reference to `docs/reference/rbac-matrix.md` | add to Reference table |
| No reference to `docs/reference/cli-reference.md` | add to Reference table (file exists per `ls docs/reference/`) |
| No reference to `docs/deployment/installer-env-vars.md` / `installer-changelog.md` | add to Deployment section |
| No reference to `docs/getting-started/installation.md` | add to Getting Started + Installation tables |
| Plugin guide row points at "all 7 plugins" — actual count is 11 | bump to "11 plugins" (matches README.md line 217) |

---

## Findings — docs/QUICKSTART.md / docs/USER-GUIDE.md (handled in Task 4)

### docs/QUICKSTART.md

| Line | Issue | Action |
| ---- | ----- | ------ |
| 127-208 | "IDE Integration" section — describes stdio MCP setup with raw `node packages/core/dist/mcp.js`. v3.0/v3.1 ships Streamable HTTP MCP per service with OAuth 2.1 + PKCE + DCR (see `docs/guides/mcp-integration.md`). The legacy stdio path still works for `core` only; the multi-service per-org path needs the new guide. | Add a "Connecting from external MCP clients (v3.0+)" subsection at the top of "IDE Integration" pointing at `docs/guides/mcp-integration.md`; keep the existing stdio recipes as the legacy core-only path. |
| 207 | Link `compliance/integrations/claude-code.md` for "full 20-tool reference" | Replace target with `docs/reference/mcp-tools.md` (the actual current ref) — out of scope if file path differs; verify before edit. |
| 211-219 | "Next steps" table — only 5 internal links | Add: `guides/agent-companion.md`, `guides/mcp-integration.md`, `guides/multi-org-switching.md` |
| 266 | "New in v2.6.0" callout | Replace with "New in v3.1.0" callout (or remove and link `docs/deployment/installer-changelog.md` for the per-version log). Decision: replace with "What's new" pointer. |
| 217 | Footer cross-link | OK |
| no occurrence | search for `mcp-client-setup.md` / `mcp-external-client-walkthrough.md` | no inbound references found in QUICKSTART; nothing to remove |

### docs/USER-GUIDE.md

| Line(s) | Issue | Action |
| ------- | ----- | ------ |
| 138-281 | Dashboard section — describes scanning, scheduling, teams, assignments, sources, repos, role-based experience, scan modes, report layout, filters, trends, email reports, print/PDF, manual checklists, bookmarklet — **but no mention of the agent companion** which is the headline v3.0/v3.1 dashboard surface. | Add an "Agent companion" subsection under Dashboard pointing at `docs/guides/agent-companion.md`, `docs/guides/agent-history.md`, `docs/guides/streaming-share-links.md`, `docs/guides/multi-step-tools.md`. |
| no occurrence of `v3` | no version reference at all | Acceptable — no version block to update |
| no occurrence | search for `mcp-client-setup.md` / `mcp-external-client-walkthrough.md` | none found in USER-GUIDE; nothing to remove |
| 333 (footer) | cross-links | OK |

---

## Acceptance criteria checklist

- [x] File exists at `.planning/phases/40-documentation-sweep/40-06-README-AUDIT.md`
- [x] Contains "Decision: incremental | restructure" line (line 3)
- [x] ≥ 1 finding per category:
  - Version refs: 2 ✓
  - Stale feature mentions: 7 ✓
  - Stale links: 1 (line 406) + 2 in QUICKSTART ✓
  - Gaps: 6 v3.0/v3.1 surfaces ✓
  - Coming-soon markers: 1 (line 46) ✓
