# Phase 30: Dashboard MCP + External Clients - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 30-dashboard-mcp-external-clients
**Areas discussed:** Dashboard data tool catalogue, Admin tool surface + destructive guards, MCP Resources shape, Prompts content + external-client proof

---

## Gray area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard data tool catalogue | MCPT-01 + MCPT-02 brand-score half: tool list, sync vs async, destructive, RBAC | ✓ |
| Admin tool surface + destructive guards | MCPT-04: scope, secret redaction, per-tool RBAC, confirmation | ✓ |
| MCP Resources shape (MCPI-05) | URI scheme, list scope, content format, RBAC | ✓ |
| Prompts content + external-client proof (MCPI-06 + MCPT-05) | Prompt set, placeholders, system-message voice, verification | ✓ |

**User's choice:** All four areas selected.

---

## Area 1: Dashboard data tool catalogue

### Q1.1 — Tool catalogue for MCPT-01

| Option | Description | Selected |
|--------|-------------|----------|
| Minimum 4 | dashboard_scan_site, dashboard_list_reports, dashboard_get_report, dashboard_query_issues. Mirrors Phase 29 branding's 4-tool discipline. | ✓ |
| Richer 6 | Above + dashboard_get_scan_status + dashboard_list_scans | |
| Leaner 3 | scan_site, get_report (issues embedded), list_reports; no separate query_issues | |

**User's choice:** Minimum 4 (Recommended).
**Notes:** Recorded as D-01 alongside 2 brand-score tools (6 data tools total).

### Q1.2 — Scan mode

| Option | Description | Selected |
|--------|-------------|----------|
| Async: {scanId, status:'queued'} | Initiate + immediate return; LLM polls via a companion tool | ✓ |
| Sync: block until complete | Single call returns final report; risks tool-call timeouts | |
| Hybrid | Return scanId plus polling-hint string | |

**User's choice:** Async (Recommended).
**Notes:** Resolved in D-02 — polling uses dashboard_get_report (which returns {status, report?}) rather than a 5th tool, preserving the minimum-4 catalogue.

### Q1.3 — Destructive flag on dashboard_scan_site

| Option | Description | Selected |
|--------|-------------|----------|
| Yes destructive:true | External fetches + new row + downstream LLM quota | ✓ |
| No | Self-contained DB write, idempotent-enough | |

**User's choice:** Yes destructive:true (Recommended).
**Notes:** Recorded as D-03.

### Q1.4 — Brand-score tool shape

| Option | Description | Selected |
|--------|-------------|----------|
| Two tools: list + get | Mirrors Phase 29 branding pattern | ✓ |
| One filterable tool | Single dashboard_get_brand_scores with optional {siteUrl?} | |
| Two tools + trend | list + get + get_brand_score_trend | |

**User's choice:** Two tools list+get (Recommended).
**Notes:** Recorded as D-04. Trend tool deferred to Phase 33.

**Area check:** User chose "Next area" — Area 1 settled. Tool permissions (`scans.create`, `reports.view`, `branding.view`) captured as Claude's Discretion.

---

## Area 2: Admin tool surface + destructive guards

### Q2.1 — Admin scope

| Option | Description | Selected |
|--------|-------------|----------|
| Read + safe writes; no deletes | Deletes deferred to Phase 32 alongside APER-02 confirmation modal | ✓ |
| Full CRUD with destructive:true on deletes | Relies entirely on external-client confirmation | |
| Read-only now | Writes deferred to Phase 32 | |

**User's choice:** Read + safe writes; no deletes (Recommended).
**Notes:** Recorded as D-05. API-key and role/team tools also deferred (outside MCPT-04 wording).

### Q2.2 — Secrets handling

| Option | Description | Selected |
|--------|-------------|----------|
| Always redacted | Returns {hasSecret: bool, secretPreview} — never plaintext or ciphertext | ✓ |
| Return encrypted blob | Pass ciphertext through; assumes callers can't decrypt | |
| Omit service-connection tools | Punt entirely to Phase 32 | |

**User's choice:** Always redacted (Recommended).
**Notes:** Recorded as D-06. Also applies to test_service_connection error messages.

### Q2.3 — RBAC gating granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Per-tool, specific permissions | Each tool declares its own requiredPermission per Phase 28 D-03 | ✓ |
| Coarse: all admin behind admin.system | Simple but breaks org admins | |
| Two tiers: admin.system + admin.org | Less granular; collapses audit.view etc. | |

**User's choice:** Per-tool, specific permissions (Recommended).
**Notes:** Recorded as D-07 with explicit mapping of all admin tool → permission.

### Q2.4 — Confirmation pattern beyond destructive:true

| Option | Description | Selected |
|--------|-------------|----------|
| destructive:true only; app dialog Phase 32 | Rely on Claude Desktop confirmation now; APER-02 later | ✓ |
| Two-phase token pattern | Return "needs confirmation" envelope; re-invoke with token | |
| Block all destructive until Phase 32 | Contradicts "safe writes" allowance in Q2.1 | |

**User's choice:** destructive:true only (Recommended).
**Notes:** Recorded as D-08.

**Area check:** User chose "Next area" — Area 2 settled.

---

## Area 3: MCP Resources shape (MCPI-05)

### Q3.1 — URI scheme

| Option | Description | Selected |
|--------|-------------|----------|
| Bare: scan://report/{id} + brand://score/{siteUrl} | Verbatim from ROADMAP.md SC#5 | ✓ |
| Namespaced: luqen://scan/report/{id} + luqen://brand/score/{siteUrl} | Avoids collisions across aggregated MCP servers | |
| HTTP-like: dashboard://reports/{id} + dashboard://brand-scores?site={url} | Query-string style for siteUrl | |

**User's choice:** Bare schemes (Recommended).
**Notes:** Recorded as D-09 with siteUrl encoded via encodeURIComponent.

### Q3.2 — Resources List scope

| Option | Description | Selected |
|--------|-------------|----------|
| Last 50 reports + all org brand scores | Reasonable default bound | ✓ |
| All org resources unbounded | Simpler code; risk of huge responses | |
| Recent 20 + brand scores for assigned sites only | Tighter; may hide older reports LLM needs | |

**User's choice:** Last 50 reports + all brand scores (Recommended).
**Notes:** Recorded as D-10. Pagination for >50 deferred to Phase 33.

### Q3.3 — Resource content format

| Option | Description | Selected |
|--------|-------------|----------|
| JSON with mime 'application/json' | Same envelope as tool responses | ✓ |
| Markdown summary | Easier to quote; loses structured fields | |
| Both (JSON for scan, markdown for brand) | Mixed per type; inconsistent | |

**User's choice:** JSON (Recommended).
**Notes:** Recorded as D-11.

### Q3.4 — RBAC filter on Resources

| Option | Description | Selected |
|--------|-------------|----------|
| Same RBAC: reports.view for scan://, branding.view for brand:// | Extends createMcpHttpPlugin with resource filter | ✓ |
| Authenticated-only, no permission filter | Viewers could enumerate unusable resources | |
| Filter at read time only | List always complete; LLM hallucinates broken URIs | |

**User's choice:** Same RBAC (Recommended).
**Notes:** Recorded as D-12. Requires ListResourcesRequestSchema + ReadResourceRequestSchema handlers in @luqen/core/mcp.

**Area check:** User chose "Next area" — Area 3 settled.

---

## Area 4: Prompts content + external-client proof

### Q4.1 — Prompt set

| Option | Description | Selected |
|--------|-------------|----------|
| Three: /scan, /report, /fix | Exact list from ROADMAP.md SC#6 and MCPI-06 | ✓ |
| Expanded: +/brand-score, /compare, /assign-guideline | Wider library; scope creep | |
| Two: /scan + /fix only | /report absorbed into /scan; loses common intent | |

**User's choice:** Three prompts (Recommended).
**Notes:** Recorded as D-13.

### Q4.2 — Placeholder schema

| Option | Description | Selected |
|--------|-------------|----------|
| Minimum required args + JSDoc | /scan: siteUrl + optional standard; /report: scanId; /fix: issueId + optional scanId | ✓ |
| Free-form {query} arg | Single string per prompt; loses form-fill value | |
| Rich args incl. orgId override | Violates D-05 Phase 28 invariant | |

**User's choice:** Minimum required args + JSDoc (Recommended).
**Notes:** Recorded as D-14. No orgId anywhere.

### Q4.3 — System-message voice

| Option | Description | Selected |
|--------|-------------|----------|
| Tool-aware + neutral | Lists cross-service tool names; doesn't prescribe sequence | ✓ |
| Prescriptive ("always call X first") | Scripts exact tool sequence; brittle when tools move | |
| Minimal system + verbose user | Generic system msg; user msg carries context | |

**User's choice:** Tool-aware + neutral (Recommended).
**Notes:** Recorded as D-15. Aligns with 29-CONTEXT D-12 (templates, not pre-fills).

### Q4.4 — MCPT-05 verification

| Option | Description | Selected |
|--------|-------------|----------|
| Inspector smoke + manual Claude Desktop + docs | Three-part proof: automated, manual, documented | ✓ |
| Automated only (Inspector in CI) | Faster but doesn't exercise real client | |
| Manual only + docs | Risks regressions | |
| Add OAuth discovery metadata | Scope creep — MCPE-01 deferred | |

**User's choice:** Inspector smoke + manual Claude Desktop + docs (Recommended).
**Notes:** Recorded as D-16.

**Area check:** User chose "I'm ready for context" — all areas settled.

---

## Claude's Discretion

- Exact pagination shape for list tools (cursor vs offset; default limit)
- Filter shape for dashboard_query_issues (severity, WCAG level, standard, rule code)
- Directory layout under packages/dashboard/src/mcp/ (single server.ts vs per-domain split)
- Response size cap for dashboard_get_report on huge reports
- destructive marker for dashboard_test_service_connection
- Test strategy (extend http.test.ts vs per-domain test files)

## Deferred Ideas

- dashboard_delete_user / dashboard_delete_org / dashboard_delete_service_connection — Phase 32 alongside APER-02
- API-key management tools — Phase 32
- Role/team management tools — Phase 32
- dashboard_get_brand_score_trend — Phase 33
- Resource pagination for >50 reports — Phase 33
- OAuth2 discovery metadata endpoints — MCPE-01 (v3.1)
- External client auth via API key or device code — MCPE-02 (v3.1)
- Server Card at /.well-known/mcp.json — MCPE-01 (v3.1)
