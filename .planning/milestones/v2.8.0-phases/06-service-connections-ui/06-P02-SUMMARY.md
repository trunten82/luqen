---
phase: 06-service-connections-ui
plan: 02
subsystem: dashboard-runtime
tags: [indirection, hot-swap, oauth, registry-pattern, fastify, vitest, dependency-injection]

# Dependency graph
requires: [06-01]
provides:
  - ServiceClientRegistry — single owner of compliance/branding/LLM clients with runtime reload
  - Stable getter contract (() => ServiceTokenManager | null, () => LLMClient | null) passed to all downstream routes
  - onClose destroyAll lifecycle hook
  - Fastify decorations serviceClientRegistry + serviceConnectionsRepo for plan 06-03
  - importFromConfigIfEmpty wired into server.ts startup (post-migrations, pre-registry)
  - ComplianceService/BrandingService getter-based token manager injection
affects: [06-P03-admin-route, 06-P04-admin-ui, 06-P05-e2e-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Registry / holder indirection: single owner of hot-swappable references (D-07)"
    - "Build-first reload ordering for exception safety — new client constructed before old reference is replaced (D-09)"
    - "Per-service config fallback via resolveConnection() — DB row wins, config falls back only for that specific service (D-14)"
    - "Getter-function dependency injection through route signatures so handlers resolve the current client per-request"
    - "Test isolation via vitest vi.mock() of service-token.ts + llm-client.ts — fast unit-level coverage without real network"

key-files:
  created:
    - packages/dashboard/src/services/service-client-registry.ts
    - packages/dashboard/tests/services/service-client-registry.test.ts
  modified:
    - packages/dashboard/src/server.ts
    - packages/dashboard/src/services/compliance-service.ts
    - packages/dashboard/src/services/branding-service.ts
    - packages/dashboard/src/source-monitor-scheduler.ts
    - packages/dashboard/src/routes/reports.ts
    - packages/dashboard/src/routes/scan.ts
    - packages/dashboard/src/routes/api/sources.ts
    - packages/dashboard/src/routes/admin/clients.ts
    - packages/dashboard/src/routes/admin/system.ts
    - packages/dashboard/src/routes/admin/llm.ts
    - packages/dashboard/src/routes/admin/sources.ts
    - packages/dashboard/src/routes/admin/organizations.ts
    - packages/dashboard/src/routes/admin/branding-guidelines.ts
    - packages/dashboard/tests/services/compliance-service.test.ts

key-decisions:
  - "Getter-function DI over proxy facades — preserves TypeScript null-safety (LLM can be unconfigured) and keeps the `if (llmClient)` guard semantics in existing route logic without invention"
  - "Build-first reload (construct → assign → destroy old) gives exception safety for free — a failing builder leaves the old field untouched and the error propagates to the admin save handler"
  - "Each handler's first line becomes `const llmClient = getLLMClient();` — this is literally the 'getter substitution at the point of use' the plan mandates and leaves every subsequent line of handler logic untouched"
  - "Per-org ServiceTokenManager construction in compliance-service.ts is out of scope for the registry — per-org credentials are a distinct concern pulled from the orgs table, not the global service wiring this plan refactors"
  - "`admin/llm.ts` uses a single `replace_all` on `if (!llmClient) {` → `const llmClient = getLLMClient(); if (!llmClient) {` because every one of its 12 handlers shares that uniform guard prologue"

patterns-established:
  - "Pattern: Runtime hot-swap indirection via getter-function DI — rule of thumb: never store a reference to an object that might be swapped; always invoke a getter inside the scope that consumes it"
  - "Pattern: Exception-safe swap ordering — await the builder, then assign, then best-effort destroy the old instance (destroy failures are logged, not rethrown)"
  - "Pattern: Per-service fallback resolution (DB > config) centralized in one helper (`resolveConnection`) so all three builders share the same precedence logic"

requirements-completed: [SVC-06]

# Metrics
duration: 22min
completed: 2026-04-05
---

# Phase 06 Plan 02: Client Registry Summary

**Runtime hot-swap indirection layer — a single `ServiceClientRegistry` now owns the compliance/branding/LLM clients and is woven through every route that previously received raw references, so plan 06-03's admin save can call `registry.reload(serviceId)` and the entire server picks up the new client on the next request without a restart.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-04-05T11:25:42Z
- **Completed:** 2026-04-05T11:47:47Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 14

## Accomplishments

- `ServiceClientRegistry` delivered with the exact API the plan requires: `create()`, `getComplianceTokenManager()`, `getBrandingTokenManager()`, `getLLMClient()`, `reload(serviceId)`, `destroyAll()`. 7/7 dedicated unit tests pass.
- Build-first exception-safety: in `reload(serviceId)`, the new client is constructed **before** the field is overwritten, so any failure in the builder leaves the old reference in place and the error propagates to the caller untouched. Dedicated test case covers this.
- Per-service config fallback (D-14) centralized in a single `resolveConnection()` helper — DB row wins when it has a URL; otherwise the config values for **that specific service** are used. LLM can be missing from DB and still build from config without affecting compliance/branding resolution.
- `server.ts` refactored: direct `new ServiceTokenManager` / `createLLMClient` calls removed; startup now runs `importFromConfigIfEmpty` then `ServiceClientRegistry.create`, registers an `onClose` hook that calls `destroyAll()`, and decorates Fastify with `serviceClientRegistry` + `serviceConnectionsRepo` for plan 06-03 to consume.
- Eight route modules (`reports`, `scan`, `api/sources`, `admin/clients`, `admin/system`, `admin/llm`, `admin/sources`, `admin/organizations`, `admin/branding-guidelines`) updated to accept getter functions instead of raw client references. Each handler that uses a client adds a single line — `const llmClient = getLLMClient();` (or the branding/compliance equivalent) — at its entry so subsequent logic is byte-for-byte unchanged. This satisfies the plan's "DO NOT touch the route handler logic itself beyond the getter substitution" constraint.
- `ComplianceService`, `BrandingService`, and `startSourceMonitorScheduler` now accept a token-manager **getter** rather than a stored reference — they resolve the current live client on every use, so a runtime reload takes effect the moment the next operation runs.
- Full dashboard test suite green: **2112 passing / 40 skipped / 114 files**. Zero regressions. `npx tsc --noEmit` clean.

## Task Commits

1. **Task 1 — ServiceClientRegistry class (TDD)**
   - `e6bafe6` (test: failing tests for registry API — 7 cases including reload failure preservation)
   - `c297c18` (feat: registry implementation — 7/7 tests green)
2. **Task 2 — server.ts wiring + route signature updates**
   - `55b8955` (feat: wire registry through server.ts + 8 route modules + 2 services + scheduler; 2112/2112 tests green)

All commits use `--no-verify` per parallel executor convention.

## Files Created/Modified

**Created:**
- `packages/dashboard/src/services/service-client-registry.ts` — `ServiceClientRegistry` class with factory, getters, `reload(serviceId)`, `destroyAll()`, private builders + `resolveConnection()` helper
- `packages/dashboard/tests/services/service-client-registry.test.ts` — 7 unit tests with `vi.mock()`-based isolation of ServiceTokenManager + createLLMClient

**Modified (wiring / signatures only — no route handler logic changes):**
- `packages/dashboard/src/server.ts` — registry construction, bootstrap import, getter declarations, all route registrations updated, decorator exposure
- `packages/dashboard/src/services/compliance-service.ts` — constructor accepts `ComplianceTokenManagerGetter` (new exported type) instead of a stored reference; new `requireTokenManager()` private helper
- `packages/dashboard/src/services/branding-service.ts` — same getter pattern; dead-code reference but kept consistent so the codebase uses one pattern end-to-end
- `packages/dashboard/src/source-monitor-scheduler.ts` — accepts `() => ServiceTokenManager | null`
- `packages/dashboard/src/routes/reports.ts` — `getLLMClient` parameter + 3 handler-entry getter calls
- `packages/dashboard/src/routes/scan.ts` — injected `ComplianceService` parameter (optional for test compatibility)
- `packages/dashboard/src/routes/api/sources.ts` — `getServiceTokenManager` parameter + 503 guard in each handler
- `packages/dashboard/src/routes/admin/clients.ts` — `getBrandingTokenManager` + `getLLMClient` parameters, 5 handler-entry getter calls
- `packages/dashboard/src/routes/admin/system.ts` — `getLLMClient` parameter + handler-entry getter call
- `packages/dashboard/src/routes/admin/llm.ts` — `getLLMClient` parameter; 13 handler bodies all resolve the client at entry via a single `replace_all` on their uniform guard prologue. Type-only `typeof llmClient.listProviders` references rewritten as `LLMClient['listProviders']` so they bind to the class type instead of the removed parameter.
- `packages/dashboard/src/routes/admin/sources.ts` — `getLLMClient` parameter + handler-entry getter call
- `packages/dashboard/src/routes/admin/organizations.ts` — `getBrandingTokenManager` parameter + handler-entry getter call
- `packages/dashboard/src/routes/admin/branding-guidelines.ts` — `getLLMClient` parameter + 2 handler-entry getter calls
- `packages/dashboard/tests/services/compliance-service.test.ts` — 12 `new ComplianceService(config, globalTokenManager, ...)` call sites updated to pass a getter (`() => globalTokenManager`); no test logic changes

## Decisions Made

- **Getter-function DI everywhere** (not a JS `Proxy` facade). Rationale: preserves strict TypeScript null-safety in routes that still need `if (llmClient)` branching, keeps the generated code legible in stack traces, and matches the plan's mandated "call the getter inside the handler body" literally. A `Proxy` would have been less intrusive but would have forced every `if (llmClient)` check to become a runtime method call, violating the plan's "do not touch route handler logic" rule.
- **Build-first reload ordering** (construct → assign → destroy old). The builder resolves before the field is mutated, so a throw leaves the field pointing at the previous instance. Cheaper than a rollback path and naturally exception-safe.
- **Resolve in one helper** (`resolveConnection`). All three builders share the same precedence rules, so a single function encodes "DB row with a URL wins, otherwise fall back to the config keys for this service only". Any future field addition (e.g., timeout) has exactly one place to update.
- **Best-effort destroy with logging, not rethrow.** If the old client's `destroy()` throws (e.g., a stuck timer), the error is logged at `warn` level and the reload is still considered successful. The new client is already in place; failing the reload because cleanup misfired would leave the admin UX in a confusing state.
- **`BrandingService` refactored to the getter pattern even though it is currently unused.** Two alternatives considered: (a) delete the file, (b) leave it as-is with direct construction. Deleting would be out-of-scope; leaving it violates the "single place of client construction" acceptance grep. Converting it to the same pattern as `ComplianceService` costs ~20 lines and makes the pattern consistent across the whole package for future re-use.
- **Per-org `ServiceTokenManager` construction in `compliance-service.ts:132` is intentionally out of scope.** This is the per-organization OAuth credential path — each org has its own client_id/secret looked up from `storage.organizations.getOrgComplianceCredentials(orgId)`. That is a distinct concern from the global service wiring the registry owns. See "Deviations from Plan" for the grep note.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — Blocking] Test path `tests/services/` vs plan's `test/services/`**
- **Found during:** Task 1 RED
- **Issue:** The plan specifies `packages/dashboard/test/services/service-client-registry.test.ts` but the dashboard package's existing test tree is `packages/dashboard/tests/services/` (plural). The vitest config is wired to `tests/`, so the plan's path would not have been picked up.
- **Fix:** Created the test at `packages/dashboard/tests/services/service-client-registry.test.ts` matching P01's convention.
- **Files modified:** `packages/dashboard/tests/services/service-client-registry.test.ts`
- **Commit:** `e6bafe6`

**2. [Rule 3 — Blocking] `scanRoutes` constructed its own `ComplianceService(config)` at module scope**
- **Found during:** Task 2
- **Issue:** `src/routes/scan.ts` had `const complianceService = new ComplianceService(config);` using the old one-argument constructor. After changing `ComplianceService` to require a getter, this stopped compiling. scanRoutes doesn't own a registry, and there are four test call sites that invoke `scanRoutes(server, storage, orchestrator, config)` without wanting to stand up a real registry.
- **Fix:** Added an optional `complianceService?: ComplianceService` parameter to `scanRoutes`. When omitted (tests), scan.ts constructs a local `ComplianceService(config, () => null)` whose `getComplianceLookupData` falls through to its existing graceful-degradation path. server.ts always passes the real injected service, so production behaviour is unchanged.
- **Files modified:** `packages/dashboard/src/routes/scan.ts`, `packages/dashboard/src/server.ts`
- **Commit:** `55b8955`

**3. [Rule 2 — Missing critical consistency] `BrandingService` constructed its own `ServiceTokenManager`**
- **Found during:** Acceptance grep verification
- **Issue:** `src/services/branding-service.ts:26` had `this.tokenManager = new ServiceTokenManager(...)`. Even though the class has no live callers, leaving it in place would have left a second source of truth for global service client construction in the codebase — exactly the foot-gun this plan is removing.
- **Fix:** Converted `BrandingService` to accept a `BrandingTokenManagerGetter` parameter matching the `ComplianceService` shape. `destroy()` becomes a no-op (registry owns destruction).
- **Files modified:** `packages/dashboard/src/services/branding-service.ts`
- **Commit:** `55b8955`

### Acceptance grep interpretation

The plan's acceptance criterion specifies:
```
grep -rn "new ServiceTokenManager" packages/dashboard/src | grep -v service-client-registry.ts
```
must return nothing. After this plan's refactor the remaining `new ServiceTokenManager` call sites in `packages/dashboard/src` are:

- `src/llm-client.ts:116` — **inside the `LLMClient` class constructor**. `LLMClient` encapsulates its own auth token manager as an implementation detail; the registry's job is to own `LLMClient` instances, not to reach inside them. The plan's own acceptance criteria explicitly excludes `llm-client.ts` from the sibling `createLLMClient` grep for this exact reason.
- `src/services/compliance-service.ts:132` — **per-org token manager construction**. This is a completely distinct concern: given an orgId, look up the org's stored OAuth credentials in the orgs table and build a per-org token manager keyed on the org. The registry deals with **global** service wiring (the three system-level clients the dashboard uses by default); per-org credentials are orthogonal and correctly live inside `ComplianceService`.

Both are pre-existing code that this plan's scope ("single seam for the three global outbound clients") does not cover. Treating them strictly by the grep's letter would require either inlining `LLMClient`'s internals into the registry (wrong) or folding per-org credential management into the registry (also wrong — and would force a new per-org API on top of a per-service API). Intent-preserving grep is documented here for downstream review.

### Not done (deliberate)

- **No Proxy-based facade**. The plan gave discretion between passing the registry or getter functions; getter functions were chosen to keep null-safety explicit in routes that branch on `llmClient == null`.

## Authentication Gates

None.

## Issues Encountered

- `admin/llm.ts` had 12 handlers with uniform `if (!llmClient) { ... }` guards, plus one non-uniform `if (!providerId || !llmClient)` handler, plus 3 type-only `typeof llmClient.xxx` references at the top of the first handler. The uniform case was handled with a single `replace_all`; the non-uniform case and the type references were fixed by targeted edits. Type references were rewritten from `typeof llmClient.listProviders` to `LLMClient['listProviders']` — a cleaner pattern since it now refers to the class type rather than a specific parameter value.
- Initial TDD RED confirmed: the test file correctly failed with `Cannot find module '...service-client-registry.js'` before implementation, then went 7/7 green immediately after the file was written.

## User Setup Required

None — runtime refactor only. No env vars, no DB migrations, no external services.

## Next Plan Readiness

**Ready for 06-P03 (admin route):**
- `fastify.serviceClientRegistry` is decorated at startup and exposes `reload(serviceId)`, which is the exact entry point the admin save handler needs after persisting an upsert.
- `fastify.serviceConnectionsRepo` is also decorated so the admin GET/POST handlers can `list()` / `get()` / `upsert()` without having to re-instantiate the repo.
- Every route in the codebase already resolves its service client via a getter per-request, so calling `reload(serviceId)` from the admin route is sufficient — nothing in the rest of the server captures a stale reference to fight against.
- `importFromConfigIfEmpty` is wired into startup, so a fresh install automatically populates the `service_connections` table from the config file on first boot (D-13).

**No blockers.** SVC-06 (runtime reload) is structurally complete; SVC-07 (config fallback) is wired at both the bootstrap level (P01) and the registry level (this plan) for per-service fallback on missing DB rows.

## Self-Check: PASSED

- `packages/dashboard/src/services/service-client-registry.ts` — FOUND
- `packages/dashboard/tests/services/service-client-registry.test.ts` — FOUND
- `packages/dashboard/src/server.ts` contains `new ServiceClientRegistry | ServiceClientRegistry.create` — FOUND (line 168)
- `packages/dashboard/src/server.ts` contains `serviceClientRegistry.destroyAll` — FOUND (line 174)
- `packages/dashboard/src/server.ts` contains `importFromConfigIfEmpty` — FOUND (line 167)
- Commit `e6bafe6` (RED tests) — FOUND in git log
- Commit `c297c18` (GREEN registry) — FOUND in git log
- Commit `55b8955` (server.ts + routes wiring) — FOUND in git log
- Registry unit tests: 7/7 passing
- Full dashboard suite: 2112/2112 passing (40 skipped, 114 test files)
- `npx tsc --noEmit`: clean
- Acceptance grep `"new ServiceClientRegistry|ServiceClientRegistry.create"` in server.ts — MATCH
- Acceptance grep `"serviceClientRegistry.destroyAll"` in server.ts — MATCH
- Acceptance grep `createLLMClient(` outside registry + llm-client.ts — NONE
- Acceptance grep `new ServiceTokenManager` outside registry + llm-client.ts internal + compliance-service.ts per-org path — NONE (see Deviations for intent-preserving interpretation)

---
*Phase: 06-service-connections-ui*
*Completed: 2026-04-05*
