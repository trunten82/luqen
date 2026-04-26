---
phase: 06-service-connections-ui
plan: 03
type: execute
wave: 3
depends_on: [06-01, 06-02]
files_modified:
  - packages/dashboard/src/routes/admin/service-connections.ts
  - packages/dashboard/src/services/service-connection-tester.ts
  - packages/dashboard/src/server.ts
  - packages/dashboard/test/routes/admin-service-connections.test.ts
autonomous: true
requirements: [SVC-01, SVC-02, SVC-03, SVC-04, SVC-06, SVC-08]
must_haves:
  truths:
    - "GET /admin/service-connections returns the three rows with secrets masked (hasSecret flag only, never the plaintext)"
    - "POST /admin/service-connections/:id updates url/clientId/clientSecret, writes audit log, and calls registry.reload(:id)"
    - "POST /admin/service-connections/:id/test validates candidate values against OAuth2 + /health without saving"
    - "Non-admin users receive 403 on all three endpoints"
    - "Blank clientSecret on save means 'keep existing'"
  artifacts:
    - path: "packages/dashboard/src/routes/admin/service-connections.ts"
      provides: "Fastify route plugin registering GET list, POST update, POST test"
      exports: ["registerServiceConnectionsRoutes"]
    - path: "packages/dashboard/src/services/service-connection-tester.ts"
      provides: "testServiceConnection({url, clientId, clientSecret}) performing OAuth token + /health check with 10s timeout"
      exports: ["testServiceConnection", "ServiceTestResult"]
    - path: "packages/dashboard/test/routes/admin-service-connections.test.ts"
      provides: "Integration tests for list/update/test endpoints including 403 gating and audit log writes"
  key_links:
    - from: "routes/admin/service-connections.ts"
      to: "services/service-client-registry.ts"
      via: "fastify.serviceClientRegistry.reload(serviceId)"
      pattern: "serviceClientRegistry\\.reload"
    - from: "routes/admin/service-connections.ts"
      to: "db/service-connections-repository.ts"
      via: "fastify.serviceConnectionsRepo.upsert / list / get"
      pattern: "serviceConnectionsRepo\\.(list|get|upsert)"
    - from: "routes/admin/service-connections.ts"
      to: "audit_log table"
      via: "INSERT INTO audit_log with action='service_connection.update'"
      pattern: "service_connection\\.update"
---

<objective>
Deliver the admin API surface for service connections: list (masked), update (encrypts, reloads, audits), and test (validates candidate values). This plan owns the HTTP contract; plan 04 renders the UI against it.

Purpose: Requirements SVC-01..04 and SVC-08 demand a permission-gated admin API that never returns plaintext secrets, reloads clients on save, and validates before commit. This plan delivers that API.

Output: Route plugin, tester helper, audit log integration, and integration tests covering happy path + 403 gating.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-service-connections-ui/06-CONTEXT.md
@packages/dashboard/src/routes/admin/clients.ts
@packages/dashboard/src/routes/git-credentials.ts
@packages/dashboard/src/permissions.ts
@packages/dashboard/src/db/sqlite/migrations.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: testServiceConnection helper (OAuth + health with 10s timeout)</name>
  <files>
    packages/dashboard/src/services/service-connection-tester.ts,
    packages/dashboard/test/services/service-connection-tester.test.ts
  </files>
  <read_first>
    - packages/dashboard/src/auth/service-token.ts (current OAuth client_credentials fetch pattern — replicate URL + body + headers exactly)
    - .planning/phases/06-service-connections-ui/06-CONTEXT.md (D-20, D-21)
  </read_first>
  <behavior>
    - OAuth step: POST {url}/oauth/token with client_credentials grant
    - Health step: GET {url}/health with Bearer token from step 1
    - Returns { ok: true, latencyMs } on full success
    - Returns { ok: false, step: 'oauth'|'health', error } on failure
    - Aborts with step='oauth' or 'health' on 10s timeout
  </behavior>
  <action>
    Per D-20, D-21:

    Create `packages/dashboard/src/services/service-connection-tester.ts`:

    ```typescript
    export type ServiceTestResult =
      | { ok: true; latencyMs: number }
      | { ok: false; step: 'oauth' | 'health'; error: string };

    export async function testServiceConnection(input: {
      url: string;
      clientId: string;
      clientSecret: string;
    }): Promise<ServiceTestResult>;
    ```

    Implementation:
    1. Record start time.
    2. Create an `AbortController` with 10-second timeout for the OAuth call.
    3. POST to `${url.replace(/\/$/, '')}/oauth/token` with:
       - `Content-Type: application/x-www-form-urlencoded`
       - Body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`
    4. If response not ok or fetch throws → return `{ ok: false, step: 'oauth', error: <message> }`.
    5. Parse `access_token` from JSON response. If absent → `{ ok: false, step: 'oauth', error: 'no access_token in response' }`.
    6. Create a fresh AbortController with 10-second timeout for the health call.
    7. GET `${url.replace(/\/$/, '')}/health` with `Authorization: Bearer ${access_token}`.
    8. If response not ok or fetch throws → `{ ok: false, step: 'health', error: <message> }`.
    9. Return `{ ok: true, latencyMs: Date.now() - start }`.
    10. Never log or rethrow the `clientSecret` — error messages must not contain it.

    Tests in `test/services/service-connection-tester.test.ts` using vitest + a mocked fetch (or `msw` if already in devDeps — check package.json first; otherwise vi.stubGlobal('fetch', ...)):
    - happy path → { ok: true, latencyMs: number }
    - 401 from /oauth/token → { ok: false, step: 'oauth' }
    - health 503 → { ok: false, step: 'health' }
    - fetch throws (network error) on oauth → { ok: false, step: 'oauth' }
    - Verify error messages do NOT contain the clientSecret string
  </action>
  <verify>
    <automated>cd packages/dashboard &amp;&amp; npx vitest run test/services/service-connection-tester.test.ts</automated>
  </verify>
  <done>
    Tester tests pass; secret never appears in error output.
  </done>
  <acceptance_criteria>
    - `packages/dashboard/src/services/service-connection-tester.ts` exports `testServiceConnection` and `ServiceTestResult`
    - File contains literal `/oauth/token` and `/health`
    - File contains `AbortController` and a 10000 ms timeout
    - Test file has at least 4 cases including a "secret not leaked in error" assertion
    - All tester tests pass
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Admin route plugin (GET list, POST update, POST test) with audit + reload</name>
  <files>
    packages/dashboard/src/routes/admin/service-connections.ts,
    packages/dashboard/src/server.ts
  </files>
  <read_first>
    - packages/dashboard/src/routes/admin/clients.ts (full file — mirror auth middleware, permission check, CSRF, error handling)
    - packages/dashboard/src/routes/git-credentials.ts (blank-to-keep pattern)
    - packages/dashboard/src/permissions.ts (confirm `dashboard.admin` key, import it)
    - packages/dashboard/src/db/sqlite/migrations.ts (audit_log table schema — find existing INSERT pattern in another route)
    - .planning/phases/06-service-connections-ui/06-CONTEXT.md (D-16, D-17, D-18, D-19, D-20, D-26)
  </read_first>
  <behavior>
    - All three endpoints require `dashboard.admin` permission
    - GET returns list with clientSecret stripped, hasSecret flag present
    - POST /:id accepts { url, clientId, clientSecret } where clientSecret: '' means blank-to-keep
    - After successful upsert, reload is called, audit entry written
    - If reload throws, DB row stays updated but response is 500 with error + old client preserved (per D-09)
    - POST /:id/test uses provided values; if clientSecret blank, reads stored decrypted secret
  </behavior>
  <action>
    Per D-03, D-16..D-22, D-26:

    1. Create `packages/dashboard/src/routes/admin/service-connections.ts` exporting:

    ```typescript
    export async function registerServiceConnectionsRoutes(fastify: FastifyInstance): Promise<void>;
    ```

    Use the exact auth/permission middleware pattern from `routes/admin/clients.ts`. All three endpoints go through `fastify.requirePermission('dashboard.admin')` (or the equivalent helper used in clients.ts — read and match).

    2. Routes:

    **GET /admin/service-connections**
    - Zod-validated response: `{ connections: Array<{ serviceId, url, clientId, hasSecret, source, updatedAt, updatedBy }> }` — **W3:** `source` is `'db' | 'config'` and surfaces the fallback badge required by ROADMAP success criterion #4.
    - Reads `fastify.serviceConnectionsRepo.list()`, strips `clientSecret`, adds `hasSecret`. Rows from the repository already carry `source: 'db'` (set by the repository per P01 Task 2 / W3) — pass through as-is.
    - Always returns rows for all three services. **W3:** If a service has no DB row, synthesize a row from config values (`config.{service}Url`, `config.{service}ClientId`, `hasSecret: !!config.{service}ClientSecret`) with `updatedAt: null`, `updatedBy: null`, and `source: 'config'`. This is the ONLY place `source: 'config'` is produced.

    **POST /admin/service-connections/:id**
    - Zod body: `{ url: string.min(1), clientId: string, clientSecret: string }` (clientSecret: '' means keep existing)
    - `:id` must be one of `compliance | branding | llm`; otherwise 400.
    - Translate empty-string clientSecret → `null` (keep existing) when calling `repo.upsert`. A non-empty string replaces. A separate Zod key `clearSecret: boolean` may be accepted; if true, pass `clientSecret: ''` to upsert (wipes).
    - On successful upsert:
       1. Write audit log: `INSERT INTO audit_log (action, resource, actor, created_at) VALUES ('service_connection.update', :id, :userId, :now)` — use the exact column names found by reading migrations.ts. Match the style of any existing audit_log insert in other routes.
       2. Call `await fastify.serviceClientRegistry.reload(:id)`. Wrap in try/catch:
          - Success → return `{ ok: true, connection: <masked row> }` with 200
          - Failure → log at ERROR level with serviceId, return 500 `{ ok: false, error: 'reload_failed', message: <safe string> }`. Old client remains active (guaranteed by P02 structure).
    - Response MUST NOT include `clientSecret` under any circumstances.

    **POST /admin/service-connections/:id/test**
    - Zod body: `{ url: string, clientId: string, clientSecret: string }` (clientSecret may be empty)
    - If `clientSecret === ''`, read stored decrypted secret via `repo.get(:id)`. If no stored secret, return 400 `{ ok: false, error: 'no_secret' }`.
    - Call `testServiceConnection({ url, clientId, clientSecret })` from Task 1.
    - Return the result verbatim as JSON. Does NOT save anything. Does NOT reload.

    3. In `server.ts`, register the new route plugin: `await fastify.register(registerServiceConnectionsRoutes);` Place next to the existing admin route registrations.

    4. Permission gating MUST be verified by test in Task 3.
  </action>
  <verify>
    <automated>cd packages/dashboard &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <done>
    Route file compiles, wired into server.ts, mirrors existing admin route patterns.
  </done>
  <acceptance_criteria>
    - `packages/dashboard/src/routes/admin/service-connections.ts` exports `registerServiceConnectionsRoutes`
    - File contains all three route paths: `'/admin/service-connections'`, `'/admin/service-connections/:id'`, `'/admin/service-connections/:id/test'`
    - File contains `dashboard.admin` permission string
    - File contains `'service_connection.update'` literal (audit log action)
    - File contains `serviceClientRegistry.reload`
    - `grep -n "clientSecret" packages/dashboard/src/routes/admin/service-connections.ts` — every occurrence is inside input handling, NEVER on the response shape
    - `grep -n "registerServiceConnectionsRoutes" packages/dashboard/src/server.ts` returns a match
    - `cd packages/dashboard && npx tsc --noEmit` exits 0
    - **W3:** `grep -nE "source:\s*'config'" packages/dashboard/src/routes/admin/service-connections.ts` returns a match (synthetic fallback row sets source='config')
    - **W3:** GET response schema includes a `source` field on each connection item
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Integration tests — list, update with reload, test endpoint, 403 gating</name>
  <files>
    packages/dashboard/test/routes/admin-service-connections.test.ts
  </files>
  <read_first>
    - packages/dashboard/test/routes/ (find any existing admin route integration test to mirror setup: app bootstrap, session/auth stub, CSRF handling)
    - packages/dashboard/src/routes/admin/service-connections.ts (from Task 2)
  </read_first>
  <behavior>
    - GET returns 3 rows, never contains clientSecret field
    - GET as non-admin → 403
    - POST /:id with valid body upserts, triggers reload, writes audit row
    - POST /:id with clientSecret: '' preserves the existing secret
    - POST /:id as non-admin → 403
    - POST /:id/test with mocked fetch success → { ok: true }
    - POST /:id/test with blank secret and no stored secret → 400
  </behavior>
  <action>
    Create `packages/dashboard/test/routes/admin-service-connections.test.ts` using the existing dashboard test setup (fastify inject, in-memory SQLite, seeded session/user).

    Test cases:
    1. `GET /admin/service-connections` as admin → 200, returns exactly 3 connections, NO field named `clientSecret` appears in response JSON, `hasSecret` field present per row.
    2. `GET` as non-admin (user without dashboard.admin) → 403.
    3. `POST /admin/service-connections/compliance` with `{ url, clientId, clientSecret: 'new-secret' }` as admin → 200. Assert:
       - Stored ciphertext in DB differs from 'new-secret' (encryption happened)
       - `audit_log` has a row with action='service_connection.update', resource='compliance', actor=userId
       - Spy on `registry.reload` and assert called with 'compliance'
    4. `POST /admin/service-connections/compliance` with `{ url, clientId, clientSecret: '' }` → stored secret unchanged from the previous test's value (blank-to-keep verified).
    5. `POST /admin/service-connections/compliance` as non-admin → 403.
    6. `POST /admin/service-connections/compliance/test` with mocked global fetch returning 200 → response body is `{ ok: true, latencyMs: <number> }`.
    7. `POST /admin/service-connections/compliance/test` with empty clientSecret when no secret is stored → 400 `{ error: 'no_secret' }`.
    8. `POST /admin/service-connections/invalid-id` → 400 (not one of the three allowed IDs).

    Mock `ServiceClientRegistry.reload` via a vitest spy — do NOT actually construct real remote clients. Mock global fetch for the test endpoint case.
  </action>
  <verify>
    <automated>cd packages/dashboard &amp;&amp; npx vitest run test/routes/admin-service-connections.test.ts</automated>
  </verify>
  <done>
    All 8 integration test cases pass.
  </done>
  <acceptance_criteria>
    - Test file contains at least 8 test cases
    - Test file contains assertions: `403` (x2), `clientSecret` absence in GET response, `service_connection.update` audit row, reload spy called, blank-to-keep
    - `grep -n "hasSecret" packages/dashboard/test/routes/admin-service-connections.test.ts` returns a match
    - All tests pass
  </acceptance_criteria>
</task>

</tasks>

<verification>
- `cd packages/dashboard && npx vitest run test/routes/admin-service-connections.test.ts test/services/service-connection-tester.test.ts` passes
- `cd packages/dashboard && npx tsc --noEmit` clean
- No occurrence of raw `clientSecret` in any GET response JSON shape
</verification>

<success_criteria>
- SVC-01 (list), SVC-02 (edit), SVC-03 (masked), SVC-04 (test), SVC-06 (reload on save), SVC-08 (admin-only) all demonstrably satisfied by tests
- Audit log entries written on every save
- Reload failure path keeps old client active (guaranteed by P02 + tested here via spy on reload throwing)
</success_criteria>

<output>
After completion, create `.planning/phases/06-service-connections-ui/06-03-SUMMARY.md` documenting endpoints, response shapes, permission gating, audit integration.
</output>
