---
phase: 04-ship-ready
plan: "03"
subsystem: llm-documentation
tags: [openapi, swagger, documentation, readme]
dependency_graph:
  requires: [04-01, 04-02]
  provides: [llm-api-documentation, llm-swagger-schemas]
  affects: [packages/llm, README.md]
tech_stack:
  added: []
  patterns:
    - Fastify inline OpenAPI schema blocks with additionalProperties:true for dynamic responses
    - Body schema properties-only (no required array) to defer validation to handler layer
key_files:
  created: []
  modified:
    - packages/llm/src/api/routes/capabilities-exec.ts
    - packages/llm/src/api/server.ts
    - packages/llm/README.md
    - README.md
decisions:
  - Remove body.required arrays from OpenAPI schemas so handler validation runs (not Fastify JSON schema interceptor)
  - Use additionalProperties:true on 200 response schemas to preserve dynamically spread fields from capResult.data
  - Inline ErrorResponse schema instead of $ref (resolves test environment initialization error)
  - Use effort (not effortLevel) in generate-fix schema to match actual capability output field name
metrics:
  duration: 8m
  completed: 2026-04-04T19:15:53Z
  tasks_completed: 2
  files_modified: 4
---

# Phase 4 Plan 3: LLM Documentation Summary

**One-liner:** Inline OpenAPI schemas for all 4 capability routes + comprehensive LLM module README with request/response tables + updated main README architecture diagram.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add OpenAPI schemas to capability exec routes | c2a5064 | packages/llm/src/api/routes/capabilities-exec.ts, packages/llm/src/api/server.ts |
| 2 | Expand module README and update main README + architecture diagram | 106b71b | packages/llm/README.md, README.md |
| Auto-fix | Fix OpenAPI schemas to preserve handler validation and response fields | 82e5188 | packages/llm/src/api/routes/capabilities-exec.ts, packages/llm/README.md |

## What Was Built

### Task 1: OpenAPI Schemas

Added inline `schema` blocks to all four capability exec routes in `packages/llm/src/api/routes/capabilities-exec.ts`:
- `POST /api/v1/extract-requirements` — tags, summary, security, body properties, response schemas (200/400/502/503/504)
- `POST /api/v1/generate-fix` — full schema with request fields and response fields
- `POST /api/v1/analyse-report` — full schema including nested issuesList item schema
- `POST /api/v1/discover-branding` — full schema with color/font/logo response fields

Added `ErrorResponse` component schema to the swagger registration in `packages/llm/src/api/server.ts`.

### Task 2: README Documentation

**packages/llm/README.md** expanded with:
- New "Installer" section covering interactive and non-interactive (`--non-interactive`) modes with idempotency note
- New "Capability Endpoints" section with:
  - Shared error response table (400/401/502/503/504)
  - Per-endpoint request/response field tables for all 4 capabilities
  - Curl examples for each endpoint

**README.md** updated with:
- Architecture diagram redesigned to clearly show LLM service (port 4200) as a peer microservice with compliance→LLM routing arrow and capability list
- `@luqen/monitor` moved to its own row in the diagram (no longer overlapping LLM box)
- LLM Service section updated with installer reference and correct Swagger UI URL (`/api/v1/docs` not `/docs`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] OpenAPI body `required` arrays intercepted handler validation**
- **Found during:** Task 1 verification (npm test)
- **Issue:** Adding `required: [...]` to body schemas caused Fastify's JSON schema validator to run before the handler, returning a generic "Bad Request" message instead of the handler's field-specific error messages. Tests checked that error messages contained the field name (e.g. `/wcagCriterion/`).
- **Fix:** Removed `required` arrays from all body schemas. Validation stays in the handler layer. Body `properties` still document fields for Swagger UI.
- **Files modified:** packages/llm/src/api/routes/capabilities-exec.ts
- **Commit:** 82e5188

**2. [Rule 1 - Bug] 200 response schema stripped dynamic fields from capResult.data**
- **Found during:** Task 1 verification (npm test)
- **Issue:** Fastify's response serializer uses fast-json-stringify — with a strict schema, only declared properties survive. The `extract-requirements` handler spreads `capResult.data` (which contains fields like `wcagVersion`, `wcagLevel` that are not listed in the schema).
- **Fix:** Added `additionalProperties: true` to all 200 response schemas.
- **Files modified:** packages/llm/src/api/routes/capabilities-exec.ts
- **Commit:** 82e5188

**3. [Rule 1 - Bug] `$ref: '#/components/schemas/ErrorResponse'` failed server initialization in tests**
- **Found during:** Task 1 verification (first build run)
- **Issue:** `FastifyError: Cannot find reference "#/components/schemas/ErrorResponse"` — the swagger component schemas are registered after routes in some test environments.
- **Fix:** Inlined the ErrorResponse schema directly in each error response code instead of using `$ref`.
- **Files modified:** packages/llm/src/api/routes/capabilities-exec.ts
- **Commit:** 82e5188

**4. [Rule 1 - Bug] `effortLevel` schema field name didn't match actual `effort` field from capability**
- **Found during:** Task 1 verification (npm test — 200 response test failed)
- **Issue:** The schema declared `effortLevel` but `capResult.data` from generate-fix capability returns `effort`. Schema was stripping the field. README also had `effortLevel`.
- **Fix:** Renamed to `effort` in both schema and README.
- **Files modified:** packages/llm/src/api/routes/capabilities-exec.ts, packages/llm/README.md
- **Commit:** 82e5188

## Success Criteria Verification

- [x] `npm run build` exits 0 in packages/llm
- [x] `npm test` passes all 215 tests (25 test files)
- [x] All 4 capability routes have `schema.tags`, `schema.summary`, `schema.body`, `schema.response` blocks
- [x] ErrorResponse component added to server.ts swagger registration
- [x] packages/llm/README.md contains all 4 capability endpoint sections with request/response tables
- [x] packages/llm/README.md contains "Installer" section with non-interactive example
- [x] README.md architecture diagram shows all 4 services with port numbers and connection arrows
- [x] README.md LLM Service section references installer script
- [x] `grep -c "POST /api/v1/generate-fix..." packages/llm/README.md` returns 4
- [x] `grep "install-llm.sh"` returns matches in both files

## Known Stubs

None — all documentation reflects the actual implemented API.

## Self-Check: PASSED

Files verified:
- packages/llm/src/api/routes/capabilities-exec.ts — exists, contains schema blocks
- packages/llm/src/api/server.ts — exists, contains ErrorResponse component
- packages/llm/README.md — exists, contains capability tables and installer section
- README.md — exists, updated architecture diagram and LLM section

Commits verified:
- c2a5064 — feat: add OpenAPI schemas
- 106b71b — docs: expand READMEs
- 82e5188 — fix: schema auto-fixes
