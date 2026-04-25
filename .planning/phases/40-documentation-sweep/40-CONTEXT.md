# Phase 40: Documentation Sweep & Installer Refresh - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 40 delivers documentation and installer scripts that accurately describe Luqen as it ships at v3.1.0. Scope covers DOC-01 through DOC-07: top-level README, Swagger/OpenAPI specs (compliance, branding, llm, dashboard, MCP), installer scripts AND installer docs, MCP integration guide, agent companion user guide, prompt-template authoring guide, RBAC matrix, plus net-new dedicated docs for v3.1.0 surfaces (agent history, multi-step tool use, streaming UX + share permalinks, multi-org context switching).

In scope:
- Documentation rewrites/updates and new doc pages
- Installer SCRIPT changes (install.sh / install.command / install.ps1) — patching gaps as we find them
- OpenAPI generation tooling and CI guards
- RBAC matrix generation script and CI gate
- Fresh-container install dry-run as final acceptance gate

Out of scope:
- New product features (none introduced; this phase only describes what shipped)
- Changes to runtime auth, RBAC model, or MCP protocol behaviour
- Refactors of underlying services beyond what installer correctness requires
</domain>

<decisions>
## Implementation Decisions

### Installer Verification & Scope
- **D-01:** Acceptance gate is a fresh-container dry-run (clean LXC or Docker), running install.sh end-to-end followed by smoke checks: services up, migrations at head 061, admin login works, new admin pages reachable, new RBAC permissions present.
- **D-02:** Installer SCRIPT fixes are in-scope for Phase 40. When the dry-run (or static audit) reveals missing env vars, migrations, systemd units, admin routes, or RBAC permissions introduced since v2.12.0, we patch install.sh / install.command / install.ps1 directly in this phase.
- **D-03:** Installer migration baseline lands at migration 061 (current head as of v3.1.0). Fresh installs migrate all the way to 061 in one pass — no first-boot deferred migrations.

### OpenAPI Specs
- **D-04:** OpenAPI specs are auto-generated from Fastify route schemas via `@fastify/swagger` for all 5 services (compliance, branding, llm, dashboard, MCP). Code is the single source of truth. Routes lacking schemas get schemas added rather than hand-written spec entries.
- **D-05:** "Every shipped route appears" (success criterion #2) is enforced by a CI test that enumerates Fastify-registered routes per service and asserts each appears in the generated spec. Test failure blocks merge.
- **D-06:** Specs are served live at a `/docs` endpoint per service AND committed as JSON snapshots under `docs/reference/openapi/{service}.json`. CI fails if a snapshot is out of date relative to generated output.

### RBAC Matrix
- **D-07:** RBAC matrix is script-generated markdown sourced from code. Matches success criterion #8 ("machine-checkable against code"). Hand-maintained tables are explicitly rejected.
- **D-08:** Single matrix with permissions as one axis and the union of (HTTP routes + dashboard pages + MCP tools) as the other. One file: `docs/reference/rbac-matrix.md`.
- **D-09:** Generation lives in `scripts/generate-rbac-matrix.ts`, exposed as an npm script (e.g. `npm run docs:rbac`). CI re-runs the script and fails on any uncommitted diff in `docs/reference/rbac-matrix.md`.

### New Docs Structure & Audience
- **D-10:** Narrative docs live under `docs/guides/`; matrices and specs live under `docs/reference/`. Top-level `docs/README.md` and `docs/QUICKSTART.md` keep their current locations.
- **D-11:** Each cross-audience surface gets ONE guide file with explicit `## For end users` and `## For admins` sub-sections (rather than split files). Applies to MCP integration guide and agent companion guide.
- **D-12:** All four v3.1.0 surfaces get dedicated NEW doc pages under `docs/guides/`:
  - `docs/guides/agent-history.md` — Phase 35 (search, resume, soft-delete)
  - `docs/guides/multi-step-tools.md` — Phase 36 (parallel dispatch, retry budget, transparency UI)
  - `docs/guides/streaming-share-links.md` — Phase 37 (streaming UX + share permalinks)
  - `docs/guides/multi-org-switching.md` — Phase 38 (context switching)

### Claude's Discretion
- README rewrite scope (DOC-01) — incremental patch vs full restructure: not discussed; planner may decide based on diff scope after first audit pass. Default to incremental unless coverage gaps demand restructure.
- Doc accuracy verification beyond what's already locked above (CI route-vs-spec test, RBAC drift gate, fresh-container install) — planner may add additional checks (link-check, code-grep) if low-cost.
- Exact tone/voice for new end-user guides and the prompt-template authoring guide.
- Decision on whether MCP-specific spec format needs JSON-RPC schema additions beyond what `@fastify/swagger` covers.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & Requirements
- `.planning/ROADMAP.md` §"Phase 40: Documentation Sweep" — goal, depends-on, all 9 success criteria
- `.planning/REQUIREMENTS.md` — DOC-01 through DOC-07 wording

### Predecessor Phase Context (the surfaces being documented)
- `.planning/phases/35-agent-conversation-history/` — agent history feature surface
- `.planning/phases/36-multi-step-tool-use/36-CONTEXT.md` — multi-step tool use, parallel dispatch, retry budget
- `.planning/phases/37-streaming-ux-polish/37-CONTEXT.md` — streaming UX + share permalinks
- `.planning/phases/38-multi-org-context-switching/38-CONTEXT.md` — multi-org switching
- `.planning/phases/39-verification-backfill-deferred-items-triage/TRIAGE.md` — verified state for RBAC sourcing
- `.planning/phases/39.1-deferred-item-resolution-agent-js-split-test-staleness-fixes/39.1-CONTEXT.md` — final v3.1.0 cleanups

### Existing Docs (in-place; updates target these)
- `docs/README.md`, `docs/QUICKSTART.md`, `docs/USER-GUIDE.md`
- `docs/mcp-client-setup.md`, `docs/mcp-external-client-walkthrough.md` — fold/supersede with the new MCP integration guide
- `docs/getting-started/`, `docs/guides/`, `docs/reference/`, `docs/dashboard/`, `docs/compliance/`, `docs/branding/`, `docs/deployment/`, `docs/plugins/`

### Installer Scripts (subjects of D-02)
- `install.sh`, `install.command`, `install.ps1` (repo root)

### Project Memory (carry-forward conventions)
- `feedback_documentation_patterns.md` — every change updates docs/API specs/installer; main README stays clean
- `feedback_module_service_pattern.md` — new modules follow compliance pattern (CLI, OAuth, installer)
- `feedback_cross_service_consistency.md` — services appear in all shared admin sections (relevant to RBAC matrix coverage)

If a downstream agent references additional ADRs/specs during planning, add them here.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docs/` already has `guides/` and `reference/` sub-directories — D-10 layering uses what's there.
- `scripts/build-plugin-tarball.sh`, `scripts/publish.sh` — established pattern for `scripts/` housing project-wide tooling; new `scripts/generate-rbac-matrix.ts` follows this convention.
- All services are Fastify — `@fastify/swagger` should integrate cleanly across compliance, branding, llm, dashboard, MCP without per-service framework variation.

### Established Patterns
- Repo uses npm scripts as the canonical entrypoint for tooling and CI gates — follow same pattern for `npm run docs:rbac` and any OpenAPI snapshot scripts.
- Services already prefix routes under `/api/v1/*` (per `feedback_service_routes_prefix.md`) — OpenAPI spec must reflect this prefix.
- Live admin pages and route handlers carry permission decorators (per RBAC implementation in dashboard) — generator script reads these to produce the matrix.

### Integration Points
- Fastify app bootstrap per service — register `@fastify/swagger` and expose `/docs` (and `/docs/json` for snapshot diff).
- CI workflow — add jobs: (a) route-vs-spec diff test per service, (b) RBAC matrix drift gate, (c) installer dry-run smoke (may live in a slower nightly lane if container spin-up is too heavy for PR CI).
- New docs link from `docs/README.md` index so they're discoverable.
</code_context>

<specifics>
## Specific Ideas

- Success criterion #3 wording is the contract: "A fresh install of v3.1.0 from these scripts succeeds end-to-end without manual edits." The fresh-container dry-run (D-01) is exactly this.
- Success criterion #8 wording is the contract for D-07: "machine-checkable against code." Hand-maintained markdown will not pass.
- v2.12.0 is the boundary for "introduced since" — planner should diff installer-relevant surfaces (env vars, migrations, systemd units, admin pages, RBAC perms) from v2.12.0 to current head.
- One guide per surface with audience sub-sections (D-11) is the user-preferred shape — do not split into end-user vs admin files.
</specifics>

<deferred>
## Deferred Ideas

- README rewrite as a full restructure (vs incremental patch) — left to planner discretion; can become its own phase if it would balloon scope.
- Token-cost dashboard per org/user — already deferred to v3.2.0 in REQUIREMENTS.md.
- Interactive in-dashboard RBAC matrix page — not adopted (markdown is sufficient and machine-checkable).
- MCP-specific JSON-RPC spec format beyond what `@fastify/swagger` produces — left to planner; raise as a deferred idea if it doesn't fit cleanly.
- Additional installer concerns not raised this round (Linux/macOS/Windows parity testing, env-var validation, rollback) — handled implicitly by the fresh-container dry-run (D-01); raise as gaps if the dry-run surfaces them.
</deferred>

---

*Phase: 40-documentation-sweep*
*Context gathered: 2026-04-25*
