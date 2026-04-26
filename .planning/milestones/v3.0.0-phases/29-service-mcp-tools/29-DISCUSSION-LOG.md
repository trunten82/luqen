# Phase 29: Service MCP Tools - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 29-service-mcp-tools
**Areas discussed:** Compliance tool surface, Branding tool surface, LLM tool shape, Resources + Prompts primitives

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Compliance tool surface | MCPT-01 mentions scan/report/issues but those live in dashboard, not compliance. | ✓ |
| Branding tool surface | list_guidelines + discover_branding easy; brand_scores live in dashboard.db. | ✓ |
| LLM tool shape | REST body 1:1 vs structured refs for generate_fix and analyse_report. | ✓ |
| Resources + Prompts primitives | URI scheme, hosting, RBAC; tool pre-fill vs chat templates. | ✓ |

**User's choice:** All four areas.
**Notes:** User wanted to walk every area since Phase 29 has cross-service ambiguity — scans live in dashboard, brand_scores live in dashboard.db, discover-branding lives on LLM service.

---

## Compliance tool surface

### Q1 — Where should scan/report/issue tools live in Phase 29?

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard MCP (move to Phase 30) | Tools live where data lives; cleanest service boundary. | ✓ |
| Compliance MCP calls dashboard over HTTP | Respects MCPT-01 wording but new cross-service call pattern. | |
| Compliance MCP with direct dashboard.db read | Violates service ownership — not recommended. | |

**User's choice:** Dashboard MCP (move to Phase 30).
**Notes:** MCPT-01 traceability rescope required: move from Phase 29 to Phase 30.

### Q2 — What compliance MCP tool additions belong in Phase 29?

| Option | Description | Selected |
|--------|-------------|----------|
| None — Phase 28 delivered enough | Phase 29 compliance MCP = Phase 28's 11 tools, unchanged. | ✓ |
| compliance_check_issues wrapper | Already exists as compliance_check from Phase 28. | |
| compliance_list_wcag_criteria | Read-only lookup of WCAG criteria + levels. | |

**User's choice:** None.
**Notes:** Phase 28's 11 compliance tools are the complete compliance MCP surface for v3.0.0 until further notice.

---

## Branding tool surface

### Q1 — Where does discover_branding tool register?

| Option | Description | Selected |
|--------|-------------|----------|
| LLM MCP (owns the capability) | Matches service ownership. MCPT-02 wording adjusts. | ✓ |
| Branding MCP (proxies to LLM) | Keeps MCPT-02 wording but cross-service call from branding. | |
| Both (alias on branding MCP) | Discoverability vs surface area trade-off. | |

**User's choice:** LLM MCP.

### Q2 — Where does get_brand_score live?

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard MCP (Phase 30) | Tool lives where data lives. | ✓ |
| Branding MCP reads dashboard.db directly | Fragile across dashboard migrations. | |
| Branding MCP calls dashboard HTTP | Respects ownership but new dashboard endpoint + cross-service hop. | |

**User's choice:** Dashboard MCP (Phase 30).
**Notes:** MCPT-02 "retrieve brand scores" half rescopes to Phase 30. list_guidelines + discover_branding stay Phase 29.

### Q3 — What tools DO ship on branding MCP in Phase 29?

| Option | Description | Selected |
|--------|-------------|----------|
| branding_list_guidelines | GET /api/v1/guidelines. ORG-SCOPED, branding.view. | ✓ |
| branding_get_guideline | GET /api/v1/guidelines/:id. ORG-SCOPED, branding.view. | ✓ |
| branding_list_sites | GET /api/v1/guidelines/:id/sites. ORG-SCOPED, branding.view. | ✓ |
| branding_match | POST /api/v1/match. ORG-SCOPED, branding.view. | ✓ |

**User's choice:** All four.
**Notes:** All ORG-SCOPED, all read, all `branding.view`, all non-destructive.

---

## LLM tool shape

### Q1 — How should generate_fix and analyse_report accept input?

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror REST body 1:1 (Recommended) | Self-contained on LLM service; no cross-service reads. | ✓ |
| Structured refs (scanId/issueId) | Requires LLM service to read dashboard.db — same boundary problem. | |
| Both shapes (dual mode) | More surface to test; still requires dashboard read access. | |

**User's choice:** Mirror REST body 1:1.

### Q2 — What tools ship on LLM MCP in Phase 29?

| Option | Description | Selected |
|--------|-------------|----------|
| llm_generate_fix | Mirror POST /api/v1/generate-fix. GLOBAL. llm.view. | ✓ |
| llm_analyse_report | Mirror POST /api/v1/analyse-report. GLOBAL. llm.view. | ✓ |
| llm_discover_branding | Mirror POST /api/v1/discover-branding. GLOBAL. llm.view. | ✓ |
| llm_extract_requirements | Mirror POST /api/v1/extract-requirements. GLOBAL. llm.view. | ✓ |

**User's choice:** All four.
**Notes:** Full LLM capability surface reachable via MCP, not just the 3 named in MCPT-03.

### Q3 — Fallback when LLM provider unavailable?

| Option | Description | Selected |
|--------|-------------|----------|
| Match REST behavior exactly (Recommended) | No new fallback logic; preserves hardcoded-fix fallback. | ✓ |
| Always return isError:true on provider failure | Simpler semantics but regresses fallback value. | |

**User's choice:** Match REST behavior exactly.

---

## Resources + Prompts primitives

### Q1 — MCP Resources in Phase 29?

| Option | Description | Selected |
|--------|-------------|----------|
| Defer Resources to Phase 30 (Recommended) | Scan reports + brand scores live in dashboard. | ✓ |
| Resources on each service's native data | Covers primitive but doesn't match MCPI-05 wording. | |
| Both | More to test. | |

**User's choice:** Defer to Phase 30.

### Q2 — MCP Prompts shape?

| Option | Description | Selected |
|--------|-------------|----------|
| Chat-message templates (Recommended) | Standard MCP pattern; client-agnostic. | ✓ |
| Tool-call pre-fills | Tighter UX but couples prompts to specific tools. | |

**User's choice:** Chat-message templates.
**Notes:** Shape decision locked here so Phase 30 inherits.

### Q3 — Where do Prompts register?

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard MCP (Phase 30) | Workflows span services; prompts belong where orchestrator lives. | ✓ |
| Split by service | Partial Phase 29 delivery. | |
| All on LLM MCP | LLM service becomes prompt-hub for tools it doesn't own. | |

**User's choice:** Dashboard MCP (Phase 30).
**Notes:** MCPI-06 rescopes fully to Phase 30.

---

## Claude's Discretion

- `branding_match` request shape — raw `BrandMatchRequest` vs simplified envelope (planner decides).
- Internal directory layout (`packages/branding/src/mcp/tools/` vs inline in `server.ts`) — mirror Phase 28.
- LLM tool file organisation (single file vs split) — match existing LLM layout.
- Test strategy for LLM tools — shared fixture vs per-tool (planner/TDD guide).

## Deferred Ideas

### Moved to Phase 30
- dashboard_scan_site / list_reports / get_report / query_issues (MCPT-01)
- dashboard_get_brand_score / list_brand_scores (MCPT-02 half)
- MCP Resources (MCPI-05)
- MCP Prompts /scan, /report, /fix (MCPI-06)

### Future reconsideration
- Structured-ref tool shape for llm_generate_fix — revisit at Phase 33 (agent intelligence) with client-side ref resolution.
- Per-tool audit logging — wait for Phase 31 (agent_audit_log).
- Alias tools across services — reconsider only if Phase 30 external-client testing shows discoverability gap.
