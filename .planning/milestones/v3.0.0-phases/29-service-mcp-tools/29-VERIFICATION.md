---
phase: 29-service-mcp-tools
verified: 2026-04-17T12:21:00Z
status: passed
score: 19/19 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 29: Service MCP Tools Verification Report

**Phase Goal:** Populate the empty Phase 28 branding and LLM MCP server stubs with their first real tool catalogues — 4 org-scoped branding tools + 4 global LLM tools — all wired through the shared `createMcpHttpPlugin()` factory, all RBAC-filtered and org-scoped where appropriate, with no `orgId` accepted in any tool's `inputSchema`.
**Verified:** 2026-04-17T12:21:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Scope Note (Rescope Acknowledged)

The phase was intentionally rescoped during execution by Plan 29-03. Delivered scope per `29-CONTEXT.md` D-14/D-15:

- Delivered: **MCPT-02** (guidelines + match + discover-branding via LLM MCP per D-08) + **MCPT-03** (all 4 LLM capabilities)
- Moved to Phase 30: **MCPT-01** (scan/report/issue), **MCPT-02** brand-score-retrieval half, **MCPI-05** (Resources), **MCPI-06** (Prompts)

The verifier confirms the rescope landed cleanly in `REQUIREMENTS.md` and `ROADMAP.md` — it does NOT flag the rescoped items as missing work.

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                                                                   | Status     | Evidence                                                                                                                            |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Branding service MCP serves exactly 4 org-scoped tools (list_guidelines, get_guideline, list_sites, match)                                              | ✓ VERIFIED | `grep -c "server.registerTool" packages/branding/src/mcp/server.ts` → 4; all 4 names present in source + metadata                   |
| 2  | LLM service MCP serves exactly 4 global tools (generate_fix, analyse_report, discover_branding, extract_requirements)                                   | ✓ VERIFIED | `grep -c "server.registerTool" packages/llm/src/mcp/server.ts` → 4; all 4 names present in source + metadata                        |
| 3  | All 4 branding tools are ORG-SCOPED with `// orgId: ctx.orgId` classification comments and 0 global markers                                              | ✓ VERIFIED | `grep -c "// orgId: ctx.orgId"` → 4; `grep -c "// orgId: N/A"` → 0                                                                 |
| 4  | All 4 LLM tools are GLOBAL with `// orgId: N/A` classification comments and 0 org-scoped markers                                                         | ✓ VERIFIED | `grep -c "// orgId: N/A"` → 4; `grep -c "// orgId: ctx.orgId"` → 0                                                                  |
| 5  | Cross-org guards on branding_get_guideline, branding_list_sites, branding_match (3 tools) — `guideline.orgId !== orgId` → "not found"                   | ✓ VERIFIED | `grep -c "guideline.orgId !== orgId" packages/branding/src/mcp/server.ts` → 3                                                       |
| 6  | Every branding handler reads orgId from `getCurrentToolContext()` via `resolveOrgId()` helper — never from args (D-13)                                  | ✓ VERIFIED | `resolveOrgId()` defined at line 43; called inside every handler; no `args.orgId` usage anywhere                                    |
| 7  | Every LLM handler reads orgId from `getCurrentToolContext()` → `resolveOrgId()` → passes to capability executor for per-org prompt override only        | ✓ VERIFIED | `resolveOrgId()` defined at line 51; orgId passed to all 4 `execute*` calls                                                         |
| 8  | D-13 invariant: NO tool accepts `orgId` in its zod inputSchema                                                                                          | ✓ VERIFIED | Static grep `grep -En "orgId\s*:\s*z\." packages/{branding,llm}/src/mcp/server.ts` → 0 matches; runtime iteration test passes (6/6) |
| 9  | BRANDING_TOOL_METADATA has exactly 4 entries, all `requiredPermission: 'branding.view'`, zero destructive                                                | ✓ VERIFIED | `grep -c "name: 'branding_"` → 4; `grep -c "requiredPermission: 'branding.view'"` → 4; no `destructive: true` matches               |
| 10 | LLM_TOOL_METADATA has exactly 4 entries, all `requiredPermission: 'llm.view'`, zero destructive                                                          | ✓ VERIFIED | `grep -c "name: 'llm_"` → 4; `grep -c "requiredPermission: 'llm.view'"` → 4; no `destructive: true` matches                         |
| 11 | No `console.log` anywhere in `packages/*/src/mcp/*` (stdio safety, PITFALLS.md #11)                                                                      | ✓ VERIFIED | `grep -rn "console\.log" packages/branding/src/mcp/ packages/llm/src/mcp/` → no matches                                             |
| 12 | No TODO(phase-30) markers or TODO phase-30/phase 30 anywhere in MCP source                                                                               | ✓ VERIFIED | `grep -rEn "TODO\(phase-30\)\|TODO phase-30\|TODO phase 30"` → no matches                                                           |
| 13 | Factory signature accepts `{ db }`: `createBrandingMcpServer({ db: SqliteAdapter })` / `createLlmMcpServer({ db: DbAdapter })`                            | ✓ VERIFIED | `BrandingMcpServerOptions = { readonly db: SqliteAdapter }` (line 48); `LlmMcpServerOptions = { readonly db: DbAdapter }` (line 62) |
| 14 | `registerMcpRoutes(app, { db })` threads db to factory in both services                                                                                  | ✓ VERIFIED | Branding `api/server.ts:550`: `await registerMcpRoutes(app, { db });`; LLM `api/server.ts:137`: same; routes/mcp.ts forwards to factory |
| 15 | Compliance MCP tool count unchanged from Phase 28 (11 tools — D-01 locked)                                                                               | ✓ VERIFIED | `grep -c "server.registerTool" packages/compliance/src/mcp/server.ts` → 11                                                          |
| 16 | REQUIREMENTS.md traceability reflects rescope — MCPT-01/MCPI-05/MCPI-06 → Phase 30, MCPT-02 split, MCPT-03 Phase 29                                       | ✓ VERIFIED | All 4 target rows present exactly; row count = 20 (coverage preserved); Phase 29 Scope Rescope section + D-14 reference present     |
| 17 | ROADMAP.md Phase 29 section reflects delivered scope (3 plans, rescope note, D-13 invariant) and Phase 30 absorbs rescoped items                         | ✓ VERIFIED | Phase 29 Requirements: `MCPT-02 (partial — guidelines + match + discover), MCPT-03`; Phase 30 lists all 6 absorbed IDs; Plans list 29-01/02/03 all `[x]` |
| 18 | D-12 chat-message-template shape locked into Phase 30 SC6 — "chat-message templates...NOT tool-call pre-fills"                                           | ✓ VERIFIED | ROADMAP.md line 68: explicit reference with "**chat-message templates**" bolded; cites 29-CONTEXT.md D-12                           |
| 19 | Tools are wired end-to-end — branding tools call real DB adapter methods; LLM tools call real capability executors                                       | ✓ VERIFIED | 6 `db.*` calls in branding (listGuidelines, getGuideline×3, getSiteAssignments, getGuidelineForSite); 4 `execute*` calls in LLM    |

**Score:** 19/19 truths verified

### Required Artifacts

| Artifact                                                          | Expected                                                                 | Status     | Details                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------ |
| `packages/branding/src/mcp/metadata.ts`                           | BRANDING_TOOL_METADATA — 4 entries, branding.view                        | ✓ VERIFIED | 4 entries, all branding.view, none destructive                                       |
| `packages/branding/src/mcp/server.ts`                             | createBrandingMcpServer({ db }) — 4 tools                                | ✓ VERIFIED | 189 lines, 4 registerTool calls, 4 classification comments, 3 cross-org guards      |
| `packages/branding/src/api/routes/mcp.ts`                         | registerMcpRoutes(app, { db })                                            | ✓ VERIFIED | Signature updated, forwards `opts.db` to factory                                     |
| `packages/branding/tests/mcp/http.test.ts`                        | 4 tests: tool-list, D-13, classification, admin                           | ✓ VERIFIED | 6 tests total (2 original + 4 new); 78/78 branding suite green                       |
| `packages/llm/src/mcp/metadata.ts`                                | LLM_TOOL_METADATA — 4 entries, llm.view                                   | ✓ VERIFIED | 4 entries, all llm.view, none destructive                                            |
| `packages/llm/src/mcp/server.ts`                                  | createLlmMcpServer({ db }) — 4 tools                                      | ✓ VERIFIED | 252 lines, 4 registerTool calls, 4 classification comments, error-mapper helper      |
| `packages/llm/src/api/routes/mcp.ts`                              | registerMcpRoutes(app, { db })                                            | ✓ VERIFIED | Signature updated, forwards `opts.db` to factory                                     |
| `packages/llm/tests/mcp/http.test.ts`                             | 4 tests: tool-list, D-13, classification, admin                           | ✓ VERIFIED | 6 tests total; 258/258 llm suite green                                               |
| `.planning/REQUIREMENTS.md`                                       | Updated traceability (4 rescoped rows + rescope section + timestamp)      | ✓ VERIFIED | All 4 target rows confirmed; 20/20 coverage preserved; rescope section references D-14 |
| `.planning/ROADMAP.md`                                            | Phase 29 + Phase 30 sections rewritten; Progress row 29 → 3/3 Complete    | ✓ VERIFIED | Phase 29 Plans list has 3 `[x]` entries; Phase 30 absorbs 6 IDs; Progress row flipped |

### Key Link Verification

| From                                                          | To                                                                | Via                                                          | Status     | Details                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------- |
| `packages/branding/src/mcp/server.ts`                         | `@luqen/core/mcp`                                                  | `getCurrentToolContext()` in every handler + resolveOrgId     | ✓ WIRED    | 5+ call sites in server.ts                                             |
| `packages/branding/src/mcp/server.ts`                         | `packages/branding/src/db/sqlite-adapter.ts`                       | `db.listGuidelines/getGuideline/getSiteAssignments/getGuidelineForSite` | ✓ WIRED    | 6 `db.*` method calls inside tool handlers                             |
| `packages/branding/src/api/routes/mcp.ts`                     | `packages/branding/src/mcp/server.ts`                              | `createBrandingMcpServer({ db: opts.db })`                   | ✓ WIRED    | `routes/mcp.ts:16` invokes factory with opts.db                        |
| `packages/branding/src/api/server.ts`                         | `packages/branding/src/api/routes/mcp.ts`                          | `await registerMcpRoutes(app, { db })`                       | ✓ WIRED    | `api/server.ts:550` passes `{ db }`                                    |
| `packages/llm/src/mcp/server.ts`                              | `@luqen/core/mcp`                                                  | `getCurrentToolContext()` + resolveOrgId                      | ✓ WIRED    | 5+ call sites                                                          |
| `packages/llm/src/mcp/server.ts`                              | `packages/llm/src/capabilities/*`                                  | `executeGenerateFix/AnalyseReport/DiscoverBranding/ExtractRequirements(db, adapterFactory, params)` | ✓ WIRED    | All 4 executors called exactly once                                    |
| `packages/llm/src/api/routes/mcp.ts`                          | `packages/llm/src/mcp/server.ts`                                   | `createLlmMcpServer({ db: opts.db })`                        | ✓ WIRED    | `routes/mcp.ts:16` invokes factory with opts.db                        |
| `packages/llm/src/api/server.ts`                              | `packages/llm/src/api/routes/mcp.ts`                               | `await registerMcpRoutes(app, { db })`                       | ✓ WIRED    | `api/server.ts:137` passes `{ db }`                                    |
| `.planning/ROADMAP.md`                                        | `.planning/REQUIREMENTS.md`                                        | Phase 29 Requirements field references IDs in traceability    | ✓ WIRED    | MCPT-02 (partial) + MCPT-03 in both docs                               |
| `.planning/REQUIREMENTS.md`                                   | `.planning/phases/29-service-mcp-tools/29-CONTEXT.md`              | D-14 citation in Phase 29 Scope Rescope section               | ✓ WIRED    | Rescope section explicitly cites 29-CONTEXT.md D-14                    |

### Data-Flow Trace (Level 4)

| Artifact                                                      | Data Variable          | Source                                    | Produces Real Data           | Status     |
| ------------------------------------------------------------- | ---------------------- | ----------------------------------------- | ---------------------------- | ---------- |
| `packages/branding/src/mcp/server.ts` `branding_list_guidelines` | `items`                 | `db.listGuidelines(orgId)`                 | Yes — SqliteAdapter real query | ✓ FLOWING  |
| `packages/branding/src/mcp/server.ts` `branding_get_guideline`   | `guideline`             | `db.getGuideline(args.id)` + cross-org guard | Yes — real DB read            | ✓ FLOWING  |
| `packages/branding/src/mcp/server.ts` `branding_list_sites`      | `sites`                 | `db.getSiteAssignments(args.id)`           | Yes — real DB read            | ✓ FLOWING  |
| `packages/branding/src/mcp/server.ts` `branding_match`           | `branded`               | `new BrandingMatcher().match(issues, guideline)` | Yes — real matcher invocation | ✓ FLOWING  |
| `packages/llm/src/mcp/server.ts` `llm_generate_fix`              | `capResult`             | `executeGenerateFix(db, adapterFactory, params)` | Yes — real capability executor with fallback | ✓ FLOWING  |
| `packages/llm/src/mcp/server.ts` `llm_analyse_report`            | `capResult`             | `executeAnalyseReport(db, adapterFactory, params)` | Yes — real executor           | ✓ FLOWING  |
| `packages/llm/src/mcp/server.ts` `llm_discover_branding`         | `capResult`             | `executeDiscoverBranding(db, adapterFactory, params)` | Yes — real executor           | ✓ FLOWING  |
| `packages/llm/src/mcp/server.ts` `llm_extract_requirements`      | `capResult`             | `executeExtractRequirements(db, adapterFactory, params)` | Yes — real executor           | ✓ FLOWING  |

All 8 tool handlers carry real data end-to-end — no stubs, no hardcoded empty returns.

### Behavioral Spot-Checks

| Behavior                                                               | Command                                                      | Result              | Status   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- | -------- |
| Branding test suite (78/78 expected)                                   | `npm run test -w packages/branding`                          | 78 passed / 11 files | ✓ PASS   |
| LLM test suite (258/258 expected)                                      | `npm run test -w packages/llm`                               | 258 passed / 27 files | ✓ PASS   |
| Compliance test suite (550/550 expected — Phase 28 regression check)   | `npm run test -w packages/compliance`                        | 550 passed / 43 files | ✓ PASS   |
| Branding registerTool count = 4                                        | `grep -c "server.registerTool" packages/branding/src/mcp/server.ts` | 4                   | ✓ PASS   |
| LLM registerTool count = 4                                             | `grep -c "server.registerTool" packages/llm/src/mcp/server.ts` | 4                   | ✓ PASS   |
| Compliance registerTool count = 11 (unchanged)                         | `grep -c "server.registerTool" packages/compliance/src/mcp/server.ts` | 11                  | ✓ PASS   |
| All 6 plan commits present                                             | `git log --oneline` grep for all 6 hashes                    | All found           | ✓ PASS   |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| **MCPT-02** (partial) | 29-01-PLAN (branding side) + 29-02-PLAN (llm_discover_branding side per D-08) | User can list guidelines, get brand scores, and run discover-branding via branding MCP tools | ✓ SATISFIED (Phase 29 half) | 4 branding tools (list_guidelines/get_guideline/list_sites/match) registered in `packages/branding/src/mcp/server.ts`; `llm_discover_branding` registered in `packages/llm/src/mcp/server.ts` per D-08; brand-score retrieval half deferred to Phase 30 (documented in REQUIREMENTS.md split annotation) |
| **MCPT-03** | 29-02-PLAN | User can generate fixes and analyse reports via LLM MCP tools | ✓ SATISFIED | 4 LLM tools registered in `packages/llm/src/mcp/server.ts`: generate_fix, analyse_report, discover_branding, extract_requirements |
| **MCPT-01** | 29-03-PLAN (rescope) | User can scan sites, list reports, check issues via compliance MCP tools | ✓ REASSIGNED to Phase 30 | REQUIREMENTS.md row `\| MCPT-01 \| Phase 30 \| Pending \|`; ROADMAP.md Phase 30 SC1 absorbs it; origin cited in Phase 29 Scope Rescope section (D-14) |
| **MCPI-05** | 29-03-PLAN (rescope) | MCP Resources expose scan reports and brand scores | ✓ REASSIGNED to Phase 30 | REQUIREMENTS.md row `\| MCPI-05 \| Phase 30 \| Pending \|`; ROADMAP.md Phase 30 SC5 absorbs it with `scan://report/{id}` / `brand://score/{siteUrl}` URI templates |
| **MCPI-06** | 29-03-PLAN (rescope) | MCP Prompts expose predefined workflow shortcuts | ✓ REASSIGNED to Phase 30 | REQUIREMENTS.md row `\| MCPI-06 \| Phase 30 \| Pending \|`; ROADMAP.md Phase 30 SC6 locks D-12 chat-message-template shape verbatim |

**Coverage check:** 20/20 traceability rows present in REQUIREMENTS.md — no orphans, no duplicates. Rescoped items are reassigned, not lost.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| _(none)_ | — | — | — | — |

Clean sweep — no `console.log`, no `TODO(phase-30)`, no `orgId: z.*` in schemas, no `return null/[]` stubs, no unreached fallback branches. All tools call real data sources with real data end-to-end.

### Human Verification Required

_(none)_

This is a backend protocol-adapter phase with no UI surface. Tool registration is fully verifiable via automated grep + iteration tests + integration test suites. Test suites exercise the HTTP path, the D-13 invariant at runtime, and RBAC permission-filtering via admin scope fallback. No visual/UX/mobile/accessibility concerns, no new external service integrations, no real-time behavior requiring human observation.

### Gaps Summary

None. All 19 truths verified. All 10 artifacts exist with substantive, wired, data-flowing content. All 10 key links verified WIRED. All 8 data-flow paths confirmed. All 7 behavioral spot-checks PASS. Phase 28 regression check (compliance 550/550) clean. Rescope reflected in REQUIREMENTS.md (20/20 coverage preserved) and ROADMAP.md (Phase 29/30 sections rewritten with Plans list `[x]` ticked and Progress row flipped to 3/3 Complete).

The phase delivered exactly what its rewritten goal states: 4 org-scoped branding tools + 4 global LLM tools, all wired through `createMcpHttpPlugin()`, all RBAC-filtered, no `orgId` in any inputSchema, with the intentional rescope of dashboard-owned requirements to Phase 30 properly documented at both the requirements and roadmap layers.

---

_Verified: 2026-04-17T12:21:00Z_
_Verifier: Claude (gsd-verifier)_
