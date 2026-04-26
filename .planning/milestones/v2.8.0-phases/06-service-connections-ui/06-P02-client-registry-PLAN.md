---
phase: 06-service-connections-ui
plan: 02
type: execute
wave: 2
depends_on: [06-01]
files_modified:
  - packages/dashboard/src/services/service-client-registry.ts
  - packages/dashboard/src/server.ts
  - packages/dashboard/test/services/service-client-registry.test.ts
autonomous: true
requirements: [SVC-06, SVC-07]
must_haves:
  truths:
    - "A single ServiceClientRegistry owns the compliance + branding + LLM clients and exposes per-request getters"
    - "server.ts constructs the registry at startup instead of directly constructing the three clients"
    - "Calling registry.reload(serviceId) atomically swaps the in-memory client and destroys the old one"
    - "If a DB row is missing for a service, the registry builds its client from config values as a per-service fallback"
    - "If reload throws (e.g., bad credentials), the old client remains active and the error propagates to the caller"
  artifacts:
    - path: "packages/dashboard/src/services/service-client-registry.ts"
      provides: "ServiceClientRegistry class with getComplianceTokenManager, getBrandingTokenManager, getLLMClient, reload, destroyAll"
      exports: ["ServiceClientRegistry"]
    - path: "packages/dashboard/src/server.ts"
      provides: "Startup wiring that constructs the registry and passes it (or its getters) to all routes that previously received raw clients"
      contains: "new ServiceClientRegistry"
    - path: "packages/dashboard/test/services/service-client-registry.test.ts"
      provides: "Unit tests for construction-from-DB-or-config, reload swap-and-destroy, failure isolation, destroyAll"
  key_links:
    - from: "services/service-client-registry.ts"
      to: "auth/service-token.ts"
      via: "new ServiceTokenManager(...) for compliance and branding"
      pattern: "new ServiceTokenManager"
    - from: "services/service-client-registry.ts"
      to: "llm-client.ts"
      via: "createLLMClient(...)"
      pattern: "createLLMClient"
    - from: "server.ts"
      to: "services/service-client-registry.ts"
      via: "startup construction + onClose destroyAll"
      pattern: "new ServiceClientRegistry|registry\\.destroyAll"
---

<objective>
Introduce a runtime indirection layer (ServiceClientRegistry) so the dashboard can hot-swap compliance, branding, and LLM clients after a UI save — without requiring a restart. Refactor server.ts so all routes that currently receive raw client references receive the registry (or a getter) instead.

Purpose: SVC-06 (runtime reload) requires that routes never hold stale client references. This plan delivers the single seam through which all service client access flows, enabling the admin route (plan 03) to call `registry.reload(serviceId)` on save.

Output: New registry class, updated server.ts wiring, passing unit tests, and all existing routes still working against the registry.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-service-connections-ui/06-CONTEXT.md
@packages/dashboard/src/server.ts
@packages/dashboard/src/auth/service-token.ts
@packages/dashboard/src/llm-client.ts
@packages/dashboard/src/compliance-client.ts
@packages/dashboard/src/config.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create ServiceClientRegistry class with construction, reload, destroyAll</name>
  <files>
    packages/dashboard/src/services/service-client-registry.ts,
    packages/dashboard/test/services/service-client-registry.test.ts
  </files>
  <read_first>
    - packages/dashboard/src/auth/service-token.ts (full file — understand ServiceTokenManager constructor args, destroy() method)
    - packages/dashboard/src/llm-client.ts (full file — understand createLLMClient signature and LLMClient destroy/close semantics)
    - packages/dashboard/src/server.ts lines 140-180 and 640-660 (current construction of the three clients)
    - packages/dashboard/src/db/service-connections-repository.ts (from P01)
    - .planning/phases/06-service-connections-ui/06-CONTEXT.md (D-07, D-08, D-09, D-10, D-11, D-14)
  </read_first>
  <behavior>
    - Construct from repo + config: for each service, prefer DB row; fall back to config values per-service
    - getComplianceTokenManager() / getBrandingTokenManager() / getLLMClient() return the current live reference
    - reload(serviceId) reads latest DB row (or config fallback), builds new client, swaps, destroys old
    - If new client construction throws, old reference is unchanged AND the error is rethrown
    - destroyAll() calls destroy on all three clients
  </behavior>
  <action>
    Per D-07, D-08, D-09, D-10, D-11, D-14:

    1. Create `packages/dashboard/src/services/service-client-registry.ts`:

    ```typescript
    import { ServiceTokenManager } from '../auth/service-token.js';
    import { createLLMClient, LLMClient } from '../llm-client.js';
    import { ServiceConnectionsRepository, ServiceId } from '../db/service-connections-repository.js';
    import { Config } from '../config.js';
    import { FastifyBaseLogger } from 'fastify';

    export class ServiceClientRegistry {
      private complianceTokenManager!: ServiceTokenManager;
      private brandingTokenManager!: ServiceTokenManager;
      private llmClient!: LLMClient;

      private constructor(
        private readonly repo: ServiceConnectionsRepository,
        private readonly config: Config,
        private readonly logger: FastifyBaseLogger
      ) {}

      static async create(
        repo: ServiceConnectionsRepository,
        config: Config,
        logger: FastifyBaseLogger
      ): Promise<ServiceClientRegistry> {
        const reg = new ServiceClientRegistry(repo, config, logger);
        reg.complianceTokenManager = await reg.buildCompliance();
        reg.brandingTokenManager = await reg.buildBranding();
        reg.llmClient = await reg.buildLLM();
        return reg;
      }

      getComplianceTokenManager(): ServiceTokenManager { return this.complianceTokenManager; }
      getBrandingTokenManager(): ServiceTokenManager { return this.brandingTokenManager; }
      getLLMClient(): LLMClient { return this.llmClient; }

      async reload(serviceId: ServiceId): Promise<void> {
        if (serviceId === 'compliance') {
          const next = await this.buildCompliance();
          const old = this.complianceTokenManager;
          this.complianceTokenManager = next;
          try { old?.destroy?.(); } catch (e) { this.logger.warn({ err: e }, 'Failed to destroy old compliance client'); }
        } else if (serviceId === 'branding') {
          const next = await this.buildBranding();
          const old = this.brandingTokenManager;
          this.brandingTokenManager = next;
          try { old?.destroy?.(); } catch (e) { this.logger.warn({ err: e }, 'Failed to destroy old branding client'); }
        } else if (serviceId === 'llm') {
          const next = await this.buildLLM();
          const old = this.llmClient;
          this.llmClient = next;
          try { (old as any)?.destroy?.(); } catch (e) { this.logger.warn({ err: e }, 'Failed to destroy old llm client'); }
        }
        this.logger.info({ serviceId }, 'Service client reloaded');
      }

      async destroyAll(): Promise<void> {
        try { this.complianceTokenManager?.destroy?.(); } catch {}
        try { this.brandingTokenManager?.destroy?.(); } catch {}
        try { (this.llmClient as any)?.destroy?.(); } catch {}
      }

      // Private builders: DB row wins, config fallback per-service (D-14)
      private async buildCompliance(): Promise<ServiceTokenManager> { /* ... */ }
      private async buildBranding(): Promise<ServiceTokenManager> { /* ... */ }
      private async buildLLM(): Promise<LLMClient> { /* ... */ }
    }
    ```

    2. Implement the three private builders. Each:
       - Calls `await this.repo.get(serviceId)`
       - If row exists and has a URL → build from row (url, clientId, clientSecret)
       - Else → build from `this.config.{service}Url / {service}ClientId / {service}ClientSecret`
       - If neither path yields a usable URL → still construct but with empty values (whatever the existing code does today — match current behavior exactly)
       - The exact ServiceTokenManager constructor args and createLLMClient args MUST match the current server.ts usage verbatim. Read server.ts first.

    3. Exception safety (D-09 sub-bullet): If `buildCompliance()` throws inside `reload`, the old `this.complianceTokenManager` field is NOT overwritten (because we only assign after the build resolves). The error propagates to the caller. Verify this by structure: all three reload branches must call the builder FIRST, then assign, then destroy old.

    4. Create `packages/dashboard/test/services/service-client-registry.test.ts` with cases:
       - create() with repo returning rows for all 3 services → each getter returns a manager built from DB values
       - create() with repo returning nothing for LLM → LLM built from config (partial fallback)
       - reload('compliance') after repo upsert → getComplianceTokenManager() returns the new instance (not the original)
       - reload('compliance') where buildCompliance throws → getComplianceTokenManager() still returns the original instance + the error propagates
       - destroyAll() calls destroy on all three (use spies)

       Use mocked ServiceTokenManager and createLLMClient (vitest mock or inject factories via constructor — Claude's choice; prefer vitest mock of the modules).
  </action>
  <verify>
    <automated>cd packages/dashboard &amp;&amp; npx vitest run test/services/service-client-registry.test.ts</automated>
  </verify>
  <done>
    Registry tests pass including swap-on-reload, failure-isolation, and destroyAll cases.
  </done>
  <acceptance_criteria>
    - `packages/dashboard/src/services/service-client-registry.ts` exports class `ServiceClientRegistry`
    - File contains methods `getComplianceTokenManager`, `getBrandingTokenManager`, `getLLMClient`, `reload`, `destroyAll`
    - File contains at least one `new ServiceTokenManager` and one `createLLMClient` call
    - Test file has a case titled/commented for "reload failure preserves old client"
    - All registry tests pass
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Refactor server.ts to construct and wire the registry</name>
  <files>
    packages/dashboard/src/server.ts
  </files>
  <read_first>
    - packages/dashboard/src/server.ts (full file — find every reference to `serviceTokenManager`, `brandingTokenManager`, `llmClient`, and every route registration that passes them)
    - packages/dashboard/src/services/service-client-registry.ts (from Task 1)
    - packages/dashboard/src/services/service-connections-bootstrap.ts (from P01 Task 3)
    - packages/dashboard/src/db/sqlite/service-connections-sqlite.ts (from P01 Task 2)
  </read_first>
  <behavior>
    - Startup: run migrations → construct repo → run bootstrap import → construct registry
    - Every route that previously received a raw client now receives the registry (or a getter) and still works
    - onClose hook calls registry.destroyAll()
    - No direct `new ServiceTokenManager` or `createLLMClient` calls remain outside the registry
  </behavior>
  <action>
    Per D-10, D-11:

    1. In `server.ts`, at startup (after migrations run, before route registration):
       - Construct `const serviceConnectionsRepo = new SqliteServiceConnectionsRepository(db, config.sessionSecret);`
       - Call `await importFromConfigIfEmpty(serviceConnectionsRepo, config, fastify.log);`
       - Construct `const serviceClientRegistry = await ServiceClientRegistry.create(serviceConnectionsRepo, config, fastify.log);`
       - Remove the existing direct construction of `serviceTokenManager`, `brandingTokenManager`, `llmClient` at lines ~155-170 and ~648. Replace references with registry getter calls at the point of use.

    2. For every route module that previously received `serviceTokenManager` / `brandingTokenManager` / `llmClient` as a parameter, update its signature to accept `serviceClientRegistry: ServiceClientRegistry` instead (or alternatively, accept a getter function — Claude's discretion but prefer passing the whole registry for simplicity). Inside each route handler, call the getter at the point of use rather than at registration time. This is critical — capturing a reference at registration time would defeat the purpose.

       **DO NOT touch the route handler logic itself beyond the getter substitution.** Each handler MUST call `serviceClientRegistry.getComplianceTokenManager()` (etc.) inside its async function body, not destructured at module load.

    3. Add `fastify.addHook('onClose', async () => { await serviceClientRegistry.destroyAll(); });` after registry construction.

    4. Decorate fastify with the registry and repo so the admin route (P03) can access them: `fastify.decorate('serviceClientRegistry', serviceClientRegistry); fastify.decorate('serviceConnectionsRepo', serviceConnectionsRepo);` and add matching type declarations to the existing fastify module augmentation block if one exists.

    5. Run `npx tsc --noEmit` — fix all type errors introduced by the refactor.
  </action>
  <verify>
    <automated>cd packages/dashboard &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run</automated>
  </verify>
  <done>
    Dashboard compiles; full existing test suite still passes; no `new ServiceTokenManager` or `createLLMClient` calls remain outside service-client-registry.ts.
  </done>
  <acceptance_criteria>
    - `grep -rn "new ServiceTokenManager" packages/dashboard/src | grep -v service-client-registry.ts` returns nothing
    - `grep -rn "createLLMClient(" packages/dashboard/src | grep -v service-client-registry.ts | grep -v llm-client.ts` returns nothing
    - `grep -n "new ServiceClientRegistry\|ServiceClientRegistry.create" packages/dashboard/src/server.ts` returns a match
    - `grep -n "registry.destroyAll\|serviceClientRegistry.destroyAll" packages/dashboard/src/server.ts` returns a match
    - `grep -n "importFromConfigIfEmpty" packages/dashboard/src/server.ts` returns a match
    - `cd packages/dashboard && npx tsc --noEmit` exits 0
    - Existing `npx vitest run` suite passes (no regressions)
  </acceptance_criteria>
</task>

</tasks>

<verification>
- TypeScript compilation clean
- All pre-existing dashboard tests still pass
- New registry unit tests pass
- grep verifies no stray direct client construction
</verification>

<success_criteria>
- ServiceClientRegistry is the sole construction site for the three clients
- server.ts wires the registry at startup with bootstrap import
- Routes receive the registry (or getter) and call it per-request
- Reload failures preserve the old client (verified by test)
- SVC-06 (runtime reload) and SVC-07 (config fallback) are unblocked for plan 03
</success_criteria>

<output>
After completion, create `.planning/phases/06-service-connections-ui/06-02-SUMMARY.md` documenting: registry API, refactor scope (which routes touched), onClose wiring, test coverage.
</output>
