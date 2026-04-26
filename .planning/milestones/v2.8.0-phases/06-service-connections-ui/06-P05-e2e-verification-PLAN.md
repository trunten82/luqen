---
phase: 06-service-connections-ui
plan: 05
type: execute
wave: 5
depends_on: [06-02, 06-03, 06-04]
files_modified:
  - packages/dashboard/test/integration/service-connections-flow.test.ts
  - packages/dashboard/test/integration/service-connections-fallback.test.ts
autonomous: true
requirements: [SVC-05, SVC-06, SVC-07, SVC-08]
must_haves:
  truths:
    - "End-to-end save → reload → test flow is covered by an integration test that exercises the repo, registry, and admin route together"
    - "Config-fallback path (empty DB) is verified: dashboard boots, bootstrap runs, clients are usable"
    - "Permission gating is end-to-end verified (non-admin 403 across all endpoints)"
    - "Encryption-at-rest is verified by inspecting the raw DB ciphertext"
  artifacts:
    - path: "packages/dashboard/test/integration/service-connections-flow.test.ts"
      provides: "Save → reload → GET round-trip with real registry wired to a fake ServiceTokenManager factory"
    - path: "packages/dashboard/test/integration/service-connections-fallback.test.ts"
      provides: "Bootstrap import test + config-fallback for missing rows"
  key_links:
    - from: "test/integration/service-connections-flow.test.ts"
      to: "routes/admin/service-connections.ts + services/service-client-registry.ts"
      via: "fastify inject requests against a fully wired app"
      pattern: "serviceClientRegistry"
---

<objective>
Prove the full Phase 06 feature works by wiring a real dashboard instance (in-memory SQLite) and running end-to-end scenarios through fastify.inject: save, reload, test, fallback, permission gating, encryption at rest.

Purpose: Unit tests in P01–P04 cover each seam individually. This plan proves the seams connect correctly and the must-haves hold at the application level. No new production code — tests only.

Output: Two integration test files covering the happy path and the fallback/security paths.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-service-connections-ui/06-CONTEXT.md
@packages/dashboard/src/server.ts
@packages/dashboard/src/routes/admin/service-connections.ts
@packages/dashboard/src/services/service-client-registry.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: End-to-end save → reload → GET flow integration test</name>
  <files>
    packages/dashboard/test/integration/service-connections-flow.test.ts
  </files>
  <read_first>
    - packages/dashboard/test/ (find any existing integration test that boots the full server via fastify.inject — mirror its setup: DB init, session/user seeding, CSRF handling)
    - packages/dashboard/src/routes/admin/service-connections.ts
    - packages/dashboard/src/services/service-client-registry.ts
    - .planning/phases/06-service-connections-ui/06-CONTEXT.md (SVC-05, SVC-06)
  </read_first>
  <behavior>
    - Full app boots with in-memory SQLite and seeded admin user
    - POST /admin/service-connections/compliance with new url+clientId+clientSecret → 200
    - Immediately after, GET /admin/service-connections shows the new url + clientId, no clientSecret in response
    - registry.getComplianceTokenManager() returns a NEW instance (different object identity) after the save
    - Raw DB query on service_connections shows client_secret_encrypted is NOT equal to the plaintext (encryption at rest)
    - Audit log row with action='service_connection.update' exists
  </behavior>
  <action>
    Create `packages/dashboard/test/integration/service-connections-flow.test.ts`.

    Setup:
    - Boot the full fastify app via the same factory used by existing integration tests (look for `buildApp` or `createServer` helper — match exactly).
    - Use an in-memory SQLite database.
    - Stub out any outbound network calls: mock `ServiceTokenManager` construction (via `vi.mock('../../src/auth/service-token.js', ...)`) so it returns a simple fake with a no-op `destroy()` method; mock `createLLMClient` similarly.
    - Seed an admin user with `dashboard.admin` permission and obtain a session cookie (mirror existing auth test helper).
    - Mock global fetch for the /test endpoint as needed.

    Test cases:

    1. **Save updates state and triggers reload**
       - Grab a reference: `const before = app.serviceClientRegistry.getComplianceTokenManager();`
       - Inject POST /admin/service-connections/compliance with `{ url: 'http://localhost:9999', clientId: 'new-id', clientSecret: 'plaintext-secret-xyz' }` + admin session + CSRF.
       - Assert status 200.
       - `const after = app.serviceClientRegistry.getComplianceTokenManager();`
       - Assert `before !== after` (new instance).
       - Inject GET /admin/service-connections; assert response contains `"url":"http://localhost:9999"` and `"clientId":"new-id"` and does NOT contain `plaintext-secret-xyz` anywhere in the body.
       - Query DB directly: `SELECT client_secret_encrypted FROM service_connections WHERE service_id='compliance'`; assert the stored value is non-empty AND does NOT equal `'plaintext-secret-xyz'` (encryption at rest, SVC-05).
       - Query DB: `SELECT * FROM audit_log WHERE action='service_connection.update' AND resource='compliance'`; assert at least one row.

    2. **Blank-to-keep preserves secret**
       - Save again with `{ url, clientId, clientSecret: '' }`.
       - Query DB for ciphertext; assert it matches the ciphertext from case 1 (unchanged).

    3. **Test endpoint uses stored secret when blank**
       - Mock global fetch to return 200 for both `/oauth/token` (with `{ access_token: 'tok' }`) and `/health`.
       - POST /admin/service-connections/compliance/test with `{ url, clientId, clientSecret: '' }`.
       - Assert response has `ok: true`.
       - Assert the fetch mock was called with the stored plaintext secret in the request body (proving the stored secret was decrypted and used).
  </action>
  <verify>
    <automated>cd packages/dashboard &amp;&amp; npx vitest run test/integration/service-connections-flow.test.ts</automated>
  </verify>
  <done>
    Flow test passes; save triggers real registry swap; encryption at rest verified by raw DB read.
  </done>
  <acceptance_criteria>
    - Test file exists with at least 3 test cases
    - File contains assertion comparing `before` and `after` registry references (proves swap)
    - File contains a raw SQL query against `service_connections` for `client_secret_encrypted`
    - File contains assertion that response JSON does NOT contain the plaintext secret
    - File contains query/assertion against `audit_log`
    - All tests pass
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Fallback + permission gating integration test</name>
  <files>
    packages/dashboard/test/integration/service-connections-fallback.test.ts
  </files>
  <read_first>
    - packages/dashboard/src/services/service-connections-bootstrap.ts
    - packages/dashboard/src/services/service-client-registry.ts
    - .planning/phases/06-service-connections-ui/06-CONTEXT.md (D-13, D-14, SVC-07, SVC-08)
  </read_first>
  <behavior>
    - Boot with empty service_connections table and config values for all three services → bootstrap imports all three
    - Boot with empty table and config values for only compliance → only compliance imported, branding and llm fall back to config per-service via registry
    - Non-admin user receives 403 on GET, POST update, and POST test
  </behavior>
  <action>
    Create `packages/dashboard/test/integration/service-connections-fallback.test.ts`.

    Setup: same app factory as Task 1 but with configurable config values per test (mock/override config loading).

    Test cases:

    1. **Bootstrap imports all services from config on first boot**
       - Boot with config containing complianceUrl+Id+Secret, brandingUrl+Id+Secret, llmUrl+Id+Secret and empty DB.
       - After boot, query `SELECT * FROM service_connections`; assert 3 rows exist with `updated_by = 'bootstrap-from-config'`.
       - Assert encrypted secret columns are NOT equal to the plaintext config secrets.

    2. **Partial config: only compliance set**
       - Boot with only complianceUrl+Id+Secret in config (branding/llm config values empty strings or undefined) and empty DB.
       - After boot, query DB; assert exactly 1 row (`compliance`) exists.
       - Assert `app.serviceClientRegistry.getBrandingTokenManager()` returns a non-null manager (built from config fallback even though config is empty — or a stub — assert the call doesn't throw; exact behavior matches whatever P02 builders produce for empty config).
       - Assert `app.serviceClientRegistry.getLLMClient()` does not throw and returns a non-null client.

    3. **Non-admin 403 on all endpoints**
       - Seed a regular user without dashboard.admin permission.
       - Inject GET /admin/service-connections → 403
       - Inject POST /admin/service-connections/compliance with valid body → 403
       - Inject POST /admin/service-connections/compliance/test → 403
       - Verify nothing was written to audit_log for these attempts.

    4. **Bootstrap no-op when DB already populated**
       - Boot with DB pre-populated with a row for compliance (different URL than config).
       - After boot, query DB; assert compliance row still has the pre-populated URL (not overwritten by bootstrap — D-12: DB always wins).
  </action>
  <verify>
    <automated>cd packages/dashboard &amp;&amp; npx vitest run test/integration/service-connections-fallback.test.ts</automated>
  </verify>
  <done>
    Fallback and permission tests pass; DB-wins-over-config verified; 403 gating verified end-to-end.
  </done>
  <acceptance_criteria>
    - Test file contains at least 4 test cases
    - File contains `'bootstrap-from-config'` literal assertion
    - File contains three separate `403` assertions (GET, POST update, POST test)
    - File contains assertion that DB-wins over config on subsequent boots
    - All tests pass
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3: Full phase regression run + coverage sanity check</name>
  <files></files>
  <read_first>
    - packages/dashboard/package.json (find the test script name and coverage script)
  </read_first>
  <action>
    **W4: Verification-only task — modify files only if the coverage gate fails; in that case, extend the existing tests from Tasks 1/2, do not create new test files.**

    Run the complete dashboard test suite and verify no regressions introduced by this phase.

    1. `cd packages/dashboard && npx tsc --noEmit` — must exit 0
    2. `cd packages/dashboard && npx vitest run` — must exit 0 (all tests including pre-existing)
    3. `cd packages/dashboard && npx vitest run --coverage test/db/service-connections-repository.test.ts test/services/service-connections-bootstrap.test.ts test/services/service-client-registry.test.ts test/services/service-connection-tester.test.ts test/routes/admin-service-connections.test.ts test/integration/service-connections-flow.test.ts test/integration/service-connections-fallback.test.ts` — check that new Phase 06 files have ≥80% line coverage.

    4. If coverage is below 80% on any new file, add targeted tests. Do NOT modify production code unless a genuine bug is found.

    5. No file modifications required if all checks pass — this task is a verification gate.
  </action>
  <verify>
    <automated>cd packages/dashboard &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run</automated>
  </verify>
  <done>
    Full test suite green; 80%+ coverage on new Phase 06 files.
  </done>
  <acceptance_criteria>
    - `cd packages/dashboard && npx tsc --noEmit` exits 0
    - `cd packages/dashboard && npx vitest run` exits 0
    - Coverage for new Phase 06 files ≥ 80% (reported by vitest --coverage)
  </acceptance_criteria>
</task>

</tasks>

<verification>
- All new integration tests pass
- Full dashboard test suite has no regressions
- TypeScript clean
- Coverage threshold met for new files
</verification>

<success_criteria>
- SVC-05: encryption at rest verified by raw DB ciphertext assertion
- SVC-06: runtime reload verified by before/after registry reference comparison
- SVC-07: config fallback (full and partial) verified
- SVC-08: 403 gating verified end-to-end across all three endpoints
- Phase 06 is done: all 8 requirements covered by passing tests and production code
</success_criteria>

<output>
After completion, create `.planning/phases/06-service-connections-ui/06-05-SUMMARY.md` documenting integration test coverage, full-suite results, and coverage numbers for new files.
</output>
