---
phase: 41-openapi-schema-backfill
verified: 2026-04-26T07:25:00Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
---

# Phase 41: OpenAPI Schema Backfill — Verification Report

**Phase Goal:** `/docs` and the committed OpenAPI snapshots reflect every shipped route with its real request/response shape — not stub objects — so the `route-vs-spec` coverage tests pass and `openapi-drift` CI gate stays green.

**Verified:** 2026-04-26T07:25:00Z
**Status:** gaps_found (1 partial — see SC-1 / OAPI-04)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP success_criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every Fastify route in compliance/branding/llm/dashboard declares `schema` (body where applicable + response) using TypeBox or JSON Schema | PARTIAL | Compliance, branding, llm: complete (every route file declares `schema:`). Dashboard non-MCP: only 2 of 58 route files declare `schema:` — 41-04 deferred per-route backfill across ~245 routes. |
| 2 | Every MCP tool in `packages/dashboard/src/mcp/tools/*` exposes its input/output schema in generated `mcp.json` | VERIFIED | `jq '.paths \| keys \| map(select(startswith("/api/v1/mcp/tools/"))) \| length'` → 19 (matches all registered tools — see plan 41-05 §"Tool count clarification") |
| 3 | `route-vs-spec` coverage tests in all 5 service test suites pass | VERIFIED | All 5 test files run + pass: compliance 1/1, branding 1/1, llm 1/1, dashboard route-coverage + mcp-route-coverage 2/2. No `describe.skip` anywhere; all `[Phase 41 pending]` markers removed. |
| 4 | `npm run docs:openapi` regenerates byte-identical snapshots; `openapi-drift` CI workflow passes | VERIFIED | Two consecutive `npm run docs:openapi` runs produce md5-identical output; first regen also matches the committed snapshots (no drift). |
| 5 | No regression in production behaviour — existing request/response shapes preserved | VERIFIED | `tsc --noEmit` clean across compliance/branding/llm/dashboard. Dev intent confirmed via `additionalProperties: true` (D-05) + slim envelope variance (D-04) + per-summary acceptance criteria (compliance 146/146 api tests, branding 95/95, llm 327/327, dashboard 73/73 named-route tests). |

**Score:** 4/5 truths fully verified; 1 partial.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/compliance/src/api/schemas/envelope.ts` | LuqenResponse + ErrorEnvelope | VERIFIED | Exists; exports both helpers per D-04. |
| `packages/branding/src/api/schemas/envelope.ts` | LuqenResponse (slim) + ErrorEnvelope | VERIFIED | Exists; slim `{data, meta?}` shape per D-04 LLM/branding variance. |
| `packages/llm/src/api/schemas/envelope.ts` | LuqenResponse (pass-through) + ErrorEnvelope | VERIFIED | Exists; pass-through `T` to preserve raw-payload consumers. |
| `packages/dashboard/src/api/schemas/envelope.ts` | LuqenResponse + ErrorEnvelope + NoContent + HtmlPageSchema | VERIFIED | Exists; all four exports present. |
| `packages/dashboard/src/mcp/openapi-bridge.ts` | snapshotRegisteredTools + registerMcpOpenApiOperations + zod-v4 dispatch | VERIFIED | Exists; both functions exported; zod v4 native `z.toJSONSchema()` path included. |
| `packages/compliance/src/api/routes/*.ts` (16 files) | every file declares `schema:` | VERIFIED | `grep -L 'schema:'` returns empty across 16 files (54 matches total). |
| `packages/branding/src/api/routes/*.ts` + `server.ts` | every route declares `schema:` | VERIFIED | `mcp.ts` not flagged because schema attached via `onRoute` hook (verified). 23 schema declarations across 18 paths. |
| `packages/llm/src/api/routes/*.ts` (11 files) | every file declares `schema:` | VERIFIED | `grep -L 'schema:'` returns empty. 33 routes, 28 LuqenResponse call sites. |
| `packages/dashboard/src/routes/**/*.ts` (~58 files) | every route declares `schema:` | STUB | Only 2 of 58 route files contain `schema:` (`agent.ts` demonstration + admin/agent-audit). Per-route TypeBox blocks across remaining ~245 routes deferred. Coverage gate compensates by enumerating all routes regardless. |
| `docs/reference/openapi/compliance.json` | substantive (>1500 lines), 22 paths | VERIFIED | 4947 lines, 41 paths, 22 with `requestBody`. |
| `docs/reference/openapi/branding.json` | substantive (>1000 lines), 18 paths | VERIFIED | 2346 lines, 18 paths, 11 with `requestBody`. |
| `docs/reference/openapi/llm.json` | substantive (>2500 lines), 25 paths | VERIFIED | 3757 lines, 25 paths, 14 with `requestBody`. |
| `docs/reference/openapi/dashboard.json` | substantive snapshot | PARTIAL | 4715 lines, 259 paths, but only **2 operations have `requestBody`** out of 301 ops; 303 responses described as "Default Response" — the per-route schema deferral surfaces here. Path coverage complete; body/response detail missing. |
| `docs/reference/openapi/mcp.json` | per-tool schemas, ≥19 ops | VERIFIED | 1450 lines, 20 paths (1 JSON-RPC entry + 19 per-tool virtual routes), each tool carrying Zod-derived input schema. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| Fastify server (4 services) | TypeBox provider | `withTypeProvider<TypeBoxTypeProvider>()` | VERIFIED | Wired in `server.ts` for compliance, branding, llm, dashboard. |
| Branding `routes/mcp.ts` | shared `@luqen/core/mcp` plugin | `onRoute` hook injecting schema | VERIFIED | Hook present; coverage test passes for `/api/v1/mcp`. |
| LLM `routes/mcp.ts` | shared `@luqen/core/mcp` plugin | new additive `routeSchema?` option on `McpHttpPluginOptions` | VERIFIED | Option added in `packages/core/src/mcp/http-plugin.ts`; backwards-compat preserved. |
| Dashboard server | route-coverage gate | `__collectedRoutes` non-enumerable on app via `onRoute` hook | VERIFIED | Both dashboard tests read `app.__collectedRoutes` instead of broken `printRoutes()` parser. |
| MCP bridge | swagger | `snapshotRegisteredTools` → `registerMcpOpenApiOperations` mounted on parent `app` | VERIFIED | 19 virtual `/api/v1/mcp/tools/{name}` routes appear in `mcp.json`. |
| `zod v4` schemas | JSON Schema | native `z.toJSONSchema()` (with v3 `zod-to-json-schema` fallback) | VERIFIED | Dispatch logic present in `openapi-bridge.ts`; tool input bodies render real shape, not `{}`. |

---

### Behavioural Spot-Checks

| Behaviour | Command | Result | Status |
|-----------|---------|--------|--------|
| Compliance `tsc --noEmit` clean | `cd packages/compliance && npx tsc --noEmit` | exit 0, no output | PASS |
| Branding `tsc --noEmit` clean | `cd packages/branding && npx tsc --noEmit` | exit 0, no output | PASS |
| LLM `tsc --noEmit` clean | `cd packages/llm && npx tsc --noEmit` | exit 0, no output | PASS |
| Dashboard `tsc --noEmit` clean | `cd packages/dashboard && npx tsc --noEmit` | exit 0, no output | PASS |
| Compliance route-coverage gate green | `npx vitest run tests/openapi/route-coverage.test.ts` | 1/1 passed | PASS |
| Branding route-coverage gate green | same | 1/1 passed | PASS |
| LLM route-coverage gate green | same | 1/1 passed | PASS |
| Dashboard route-coverage + MCP gates green | `npx vitest run tests/openapi/` | 2/2 passed | PASS |
| Snapshot regen idempotent (run #1 vs committed) | `npm run docs:openapi && md5sum` | identical | PASS |
| Snapshot regen idempotent (run #2 vs run #1) | repeat + diff | identical | PASS |
| MCP per-tool ops in mcp.json | `jq '.paths \| keys \| map(select(startswith("/api/v1/mcp/tools/"))) \| length'` | 19 | PASS |

All 11 spot-checks passed.

---

### Requirements Coverage

| Requirement | Source Plan | Description (per ROADMAP §"Phase 41") | Status | Evidence |
|-------------|-------------|---------------------------------------|--------|----------|
| OAPI-01 | 41-01 | Compliance service routes carry TypeBox schemas | SATISFIED | All 16 route files declare `schema:`; coverage gate green; snapshot 4947 lines / 41 paths / 22 requestBodies. |
| OAPI-02 | 41-02 | Branding service routes carry TypeBox schemas | SATISFIED | All 18 paths covered; 23 schema declarations; gate green; snapshot 2346 lines. |
| OAPI-03 | 41-03 | LLM service routes carry TypeBox schemas (incl. capability-exec) | SATISFIED | 33 routes, 28 LuqenResponse call sites, capability-exec four routes verified for body+response shapes; snapshot 3757 lines. |
| OAPI-04 | 41-04 | Dashboard non-MCP routes carry TypeBox schemas + Zod-to-TypeBox migration | PARTIAL | Infrastructure (TypeBox provider, envelope, onRoute capture, coverage gate, snapshot determinism) shipped. **Per-route schemas only on 2 of ~50 route files**: `agent.ts` (demo) + `admin/agent-audit.ts`. ~245 routes still emit "Default Response" with no body schema. Zod migration done in 3 named files (`agent.ts`, `admin/agent-audit.ts`, `admin/organizations.ts`). 41-04 SUMMARY documents this as a Rule-4 architectural deferral with a recommendation to open 41-04b/Phase 42. |
| OAPI-05 | 41-05 | Dashboard MCP tool schemas via zod-to-json-schema bridge | SATISFIED | Bridge ships with zod v4 native dispatch (auto-discovered the v3-fallback `{}`-emit bug); 19 virtual tool routes in mcp.json each carry full Zod-derived input schema; gate green. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/dashboard/src/routes/**/*.ts` (~245 files) | n/a | Routes lack per-route `schema:` block | Warning | OpenAPI snapshot's body/response detail is sparse for the dashboard surface. Documented and accepted by 41-04 as a deferred follow-up. Coverage gate prevents future drift; existing path enumeration is complete. |
| `packages/branding/src/api/server.ts` | (5 sites) | `as unknown as never` casts on `reply.send()` | Info | TypeBox-strict provider vs SqliteAdapter `readonly` types. Documented in 41-02 SUMMARY; runtime AJV serialisation unaffected. |
| LLM body schemas | n/a | All POST/PUT body fields `Type.Optional(...)` | Info | Preserves handlers' per-field 400 messages that 13 tests assert on. Documented in 41-03 SUMMARY; D-05 tolerant. |

No blockers. Two informational items are documented design choices.

---

## Honest Accounting of Plan 41-04 Deferral

**What 41-04 covers:**

- TypeBox infrastructure live: `withTypeProvider`, `LuqenResponse`/`ErrorEnvelope`/`NoContent`/`HtmlPageSchema` in `packages/dashboard/src/api/schemas/envelope.ts`.
- Zod removed from the 3 routes that previously used `zod.parse()` at the request path (`agent.ts`, `admin/agent-audit.ts`, `admin/organizations.ts`) — fully replaced with TypeBox + a local `safeValidate()` helper that preserves prior return-tuple shape.
- Route-vs-spec coverage gate ACTIVE and GREEN via the `__collectedRoutes` capture hook (replaces the broken `printRoutes()` parser).
- Demonstration `schema:` block on `POST /agent/message`.
- Snapshot deterministic and committed.

**What 41-04 deliberately does NOT cover (~245 dashboard routes):**

- Hand-crafted body/response TypeBox shapes on the remaining route files in `packages/dashboard/src/routes/admin/*`, `packages/dashboard/src/routes/api/*`, `packages/dashboard/src/routes/oauth/*`, and top-level routes.
- Concrete impact: `dashboard.json` lists every route (path + method) but 99% of operations carry only `"description": "Default Response"` with no `requestBody` and no typed `200` payload. Of 301 operations only **2** declare a `requestBody`.

**Mitigations the deferral relies on:**

- Coverage gate enforces every registered route appears in the spec — drift on path-presence is caught in CI.
- All envelope helpers + the `safeValidate()` adapter are in place, so per-route enrichment is mechanical (apply `schema: { body: ..., response: { 200: LuqenResponse(...) } }` per file), not architectural.
- 41-04 SUMMARY explicitly recommends opening `41-04b` or scheduling Phase 42 for the per-route enrichment.

**Assessment:** OAPI-04 is partially satisfied. The phase-goal sentence "every shipped route with its real request/response shape — not stub objects" is **not literally true** for the dashboard surface. Recording as PARTIAL rather than FAILED because (a) infrastructure + gate + Zod migration ship cleanly, (b) the deferral is documented honestly with a follow-up recommendation, (c) the OpenAPI snapshot still carries the full path enumeration so external consumers can introspect the surface even if body detail is sparse.

---

## Gaps Summary

One partial, blocking truth #1 (and reflected in artifact `dashboard.json` + requirement OAPI-04):

```yaml
gaps:
  - truth: "Every Fastify route in compliance/branding/llm/dashboard declares a schema (body where applicable + response) using TypeBox or JSON Schema"
    status: partial
    reason: "Dashboard non-MCP service ships TypeBox infrastructure + coverage gate but only 2 of ~58 route files carry per-route schema: blocks. ~245 routes emit 'Default Response' in dashboard.json. Documented as deliberate scope reality in 41-04 SUMMARY."
    artifacts:
      - path: "packages/dashboard/src/routes/**/*.ts"
        issue: "Only agent.ts and admin/agent-audit.ts declare schema:; ~245 other routes are bare app.get/post calls with no schema option"
      - path: "docs/reference/openapi/dashboard.json"
        issue: "301 operations, only 2 with requestBody; 303 responses described 'Default Response' (no schema)"
    missing:
      - "Per-route TypeBox schema: { body, response } blocks across the remaining ~245 dashboard routes"
      - "Promote 41-04b (or Phase 42) for the mechanical backfill"
```

---

## Recommendations

1. **Open `41-04b` (or schedule Phase 42)** to mechanically backfill `schema: { body, response }` blocks across the remaining ~245 dashboard route files. Pattern is now copy-paste, not design — `LuqenResponse`, `ErrorEnvelope`, `NoContent`, `HtmlPageSchema` helpers are in place.
2. **Consider an override** on the current verification if the team accepts the deferral as the intended end-state for Phase 41 (current SUMMARY language treats it as a scope reality, not a future commitment). If so, add to this VERIFICATION.md frontmatter:
   ```yaml
   overrides:
     - must_have: "Every Fastify route in compliance/branding/llm/dashboard declares a schema using TypeBox or JSON Schema"
       reason: "Dashboard non-MCP per-route schema backfill descoped to follow-up plan 41-04b — infrastructure, coverage gate, and Zod migration shipped; mechanical per-route enrichment not gating Phase 41 closure"
       accepted_by: "{name}"
       accepted_at: "{ISO timestamp}"
   ```
   Then re-run verification — status would become `passed` with `score: 5/5` (1 override).
3. **No action needed on OAPI-01/02/03/05.** All four are SATISFIED with full evidence; gates are green and deterministic.

---

_Verified: 2026-04-26T07:25:00Z_
_Verifier: Claude (gsd-verifier)_
