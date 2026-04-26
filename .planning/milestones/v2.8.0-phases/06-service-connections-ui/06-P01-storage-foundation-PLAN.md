---
phase: 06-service-connections-ui
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/dashboard/src/db/sqlite/migrations.ts
  - packages/dashboard/src/db/service-connections-repository.ts
  - packages/dashboard/src/db/sqlite/service-connections-sqlite.ts
  - packages/dashboard/src/services/service-connections-bootstrap.ts
  - packages/dashboard/test/db/service-connections-repository.test.ts
autonomous: true
requirements: [SVC-05, SVC-07]
must_haves:
  truths:
    - "A new SQLite migration creates the service_connections table with encrypted secret column"
    - "A repository exposes CRUD for service connections with encryption/decryption built in"
    - "On first boot with an empty service_connections table, config values are imported automatically"
    - "When a service row is missing in DB, the repository signals fallback to config for that service only"
  artifacts:
    - path: "packages/dashboard/src/db/sqlite/migrations.ts"
      provides: "Sequential migration creating service_connections table"
      contains: "CREATE TABLE IF NOT EXISTS service_connections"
    - path: "packages/dashboard/src/db/service-connections-repository.ts"
      provides: "ServiceConnectionsRepository interface + ServiceConnection type"
      exports: ["ServiceConnectionsRepository", "ServiceConnection", "ServiceId"]
    - path: "packages/dashboard/src/db/sqlite/service-connections-sqlite.ts"
      provides: "SqliteServiceConnectionsRepository implementation using encryptSecret/decryptSecret"
      exports: ["SqliteServiceConnectionsRepository"]
    - path: "packages/dashboard/src/services/service-connections-bootstrap.ts"
      provides: "importFromConfigIfEmpty(repo, config, logger) bootstrap helper"
      exports: ["importFromConfigIfEmpty"]
    - path: "packages/dashboard/test/db/service-connections-repository.test.ts"
      provides: "Integration tests for repository CRUD, encryption roundtrip, bootstrap import"
  key_links:
    - from: "service-connections-sqlite.ts"
      to: "plugins/crypto.ts"
      via: "encryptSecret/decryptSecret"
      pattern: "encryptSecret|decryptSecret"
    - from: "service-connections-bootstrap.ts"
      to: "service-connections-repository.ts"
      via: "repo.list() then repo.upsert() per missing service"
      pattern: "importFromConfigIfEmpty"
---

<objective>
Establish the storage foundation for service connections: a new SQLite table with encrypted secrets, a repository abstraction with encryption built in, and a bootstrap helper that auto-imports config values on first boot when the table is empty.

Purpose: Phase 06 cannot reload clients at runtime without persistent, encrypted storage. This plan delivers the data layer so downstream plans (registry, admin route, UI) can read and write connections safely.

Output: Migration, repository interface + SQLite implementation, bootstrap import helper, and passing tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/06-service-connections-ui/06-CONTEXT.md
@packages/dashboard/src/db/sqlite/migrations.ts
@packages/dashboard/src/plugins/crypto.ts
@packages/dashboard/src/routes/git-credentials.ts
@packages/dashboard/src/config.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add service_connections migration + repository interface</name>
  <files>
    packages/dashboard/src/db/sqlite/migrations.ts,
    packages/dashboard/src/db/service-connections-repository.ts
  </files>
  <read_first>
    - packages/dashboard/src/db/sqlite/migrations.ts (understand existing migration style, find the last sequential number)
    - packages/dashboard/src/plugins/crypto.ts (verify encryptSecret/decryptSecret signatures)
    - .planning/phases/06-service-connections-ui/06-CONTEXT.md (D-04, D-06)
  </read_first>
  <behavior>
    - Migration adds table with exact schema per D-04
    - Repository interface supports list/get/upsert/clear(serviceId)
    - ServiceId is a union of the three fixed services
  </behavior>
  <action>
    Per D-03, D-04, D-06:

    1. In `packages/dashboard/src/db/sqlite/migrations.ts`, append a new sequential migration (next integer after the current last one). The migration SQL MUST be:

    ```sql
    CREATE TABLE IF NOT EXISTS service_connections (
      service_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      client_id TEXT NOT NULL DEFAULT '',
      client_secret_encrypted TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );
    ```

    Match the exact pattern (up function, down function, version number, description) of the most recent migration in that file. Do not squash into an existing migration.

    2. Create `packages/dashboard/src/db/service-connections-repository.ts` exporting:

    ```typescript
    export type ServiceId = 'compliance' | 'branding' | 'llm';

    export interface ServiceConnection {
      serviceId: ServiceId;
      url: string;
      clientId: string;
      clientSecret: string;          // decrypted; empty string = unset
      hasSecret: boolean;
      updatedAt: string;             // ISO
      updatedBy: string | null;
      source: 'db' | 'config';       // W3: 'db' when returned from repository; 'config' only when synthesized by route handler
    }

    export interface ServiceConnectionsRepository {
      list(): Promise<ServiceConnection[]>;
      get(serviceId: ServiceId): Promise<ServiceConnection | null>;
      upsert(input: {
        serviceId: ServiceId;
        url: string;
        clientId: string;
        clientSecret: string | null;  // null = keep existing (blank-to-keep)
        updatedBy: string | null;
      }): Promise<ServiceConnection>;
      clearSecret(serviceId: ServiceId, updatedBy: string | null): Promise<void>;
    }
    ```

    The `clientSecret` on `ServiceConnection` MUST be decrypted before returning. `hasSecret` is `clientSecret !== ''`.
  </action>
  <verify>
    <automated>grep -n "CREATE TABLE IF NOT EXISTS service_connections" packages/dashboard/src/db/sqlite/migrations.ts &amp;&amp; grep -n "ServiceConnectionsRepository" packages/dashboard/src/db/service-connections-repository.ts</automated>
  </verify>
  <done>
    Migration exists with exact schema; repository file exports the interface and types above (including `source: 'db' | 'config'` per W3).
  </done>
  <acceptance_criteria>
    - `grep -n "CREATE TABLE IF NOT EXISTS service_connections" packages/dashboard/src/db/sqlite/migrations.ts` returns a match
    - `grep -n "client_secret_encrypted TEXT NOT NULL DEFAULT ''" packages/dashboard/src/db/sqlite/migrations.ts` returns a match
    - `packages/dashboard/src/db/service-connections-repository.ts` exports `ServiceConnectionsRepository`, `ServiceConnection`, `ServiceId`
    - New migration version number is strictly greater than all existing versions in the same file
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement SqliteServiceConnectionsRepository with encryption</name>
  <files>
    packages/dashboard/src/db/sqlite/service-connections-sqlite.ts,
    packages/dashboard/test/db/service-connections-repository.test.ts
  </files>
  <read_first>
    - packages/dashboard/src/db/service-connections-repository.ts (the interface from Task 1)
    - packages/dashboard/src/plugins/crypto.ts (encryptSecret / decryptSecret usage)
    - packages/dashboard/src/routes/git-credentials.ts (reference: blank-to-keep UX + encrypt/decrypt pattern)
    - packages/dashboard/src/db/sqlite/*.ts (find one existing SQLite repository to mirror its Database injection + prepared-statement pattern)
  </read_first>
  <behavior>
    - `list()` returns all rows with secrets decrypted
    - `get(id)` returns null if row absent
    - `upsert()` with `clientSecret: null` preserves existing encrypted value; with a string, re-encrypts
    - `upsert()` with empty-string clientSecret stores empty-string encrypted placeholder
    - `clearSecret()` sets client_secret_encrypted = ''
    - Decrypt roundtrip: upsert a secret, read it back via list, secret matches
    - Bootstrap from empty: list() returns []
  </behavior>
  <action>
    Per D-05, D-06:

    1. Create `packages/dashboard/src/db/sqlite/service-connections-sqlite.ts` exporting `SqliteServiceConnectionsRepository implements ServiceConnectionsRepository`. Constructor takes `(db: Database, sessionSecret: string)`.

    2. Use `encryptSecret(plain, sessionSecret)` from `plugins/crypto.ts` on writes. Use `decryptSecret(cipher, sessionSecret)` on reads. If `client_secret_encrypted === ''`, return `clientSecret: ''` without calling decrypt (D-06: empty case must not throw).

    **W3:** Every `ServiceConnection` returned by `list()`, `get()`, and `upsert()` MUST set `source: 'db'` — the repository only ever returns DB-backed rows. The `'config'` value is produced exclusively by the admin route GET handler (P03 Task 2) when synthesizing a row for a missing service.

    3. `upsert` logic for `clientSecret`:
       - `null` → UPDATE keeps existing client_secret_encrypted (use `COALESCE` or split SQL branches)
       - `''` → stores '' (clears secret)
       - non-empty string → encrypts and stores

    4. Always set `updated_at = new Date().toISOString()` on upsert and clearSecret.

    5. Create `packages/dashboard/test/db/service-connections-repository.test.ts` with integration tests against an in-memory SQLite database (mirror the setup style of any existing repository test in the same folder). Cover:
       - empty list()
       - upsert new row then get() returns decrypted secret
       - upsert with `clientSecret: null` preserves the previous secret
       - upsert with `clientSecret: ''` clears the secret (hasSecret: false)
       - clearSecret() sets hasSecret: false
       - encryption roundtrip: stored ciphertext in DB is different from plaintext
  </action>
  <verify>
    <automated>cd packages/dashboard &amp;&amp; npx vitest run test/db/service-connections-repository.test.ts</automated>
  </verify>
  <done>
    All repository tests pass; encryption roundtrip verified; blank-to-keep logic verified.
  </done>
  <acceptance_criteria>
    - `packages/dashboard/src/db/sqlite/service-connections-sqlite.ts` exports class `SqliteServiceConnectionsRepository`
    - File contains references to both `encryptSecret` and `decryptSecret` from `../../plugins/crypto`
    - Test file has at least 5 test cases and all pass
    - `grep -n "clientSecret: null" packages/dashboard/test/db/service-connections-repository.test.ts` returns a match (blank-to-keep test exists)
    - **W3:** `grep -nE "source:\s*'db'" packages/dashboard/src/db/sqlite/service-connections-sqlite.ts` returns a match (repo stamps source='db' on every returned row)
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Bootstrap import helper (config → DB on first boot)</name>
  <files>
    packages/dashboard/src/services/service-connections-bootstrap.ts,
    packages/dashboard/test/services/service-connections-bootstrap.test.ts
  </files>
  <read_first>
    - packages/dashboard/src/config.ts (shape of complianceUrl/Id/Secret, brandingUrl/Id/Secret, llmUrl/Id/Secret)
    - packages/dashboard/src/db/service-connections-repository.ts (from Task 1)
    - .planning/phases/06-service-connections-ui/06-CONTEXT.md (D-13, D-14)
  </read_first>
  <behavior>
    - Only imports if repo.list() is empty
    - Skips services whose config url is missing/empty
    - Logs each imported row at INFO
    - Sets updated_by to 'bootstrap-from-config'
  </behavior>
  <action>
    Per D-13, D-14, D-15:

    1. Create `packages/dashboard/src/services/service-connections-bootstrap.ts` exporting:

    ```typescript
    export async function importFromConfigIfEmpty(
      repo: ServiceConnectionsRepository,
      config: Config,
      logger: FastifyBaseLogger
    ): Promise<void>
    ```

    2. Logic:
       - If `(await repo.list()).length > 0` → return (no-op)
       - Otherwise, for each of the three services (compliance, branding, llm):
         - Read `config.{service}Url`, `config.{service}ClientId`, `config.{service}ClientSecret`
         - If `url` is truthy, call `repo.upsert({ serviceId, url, clientId: clientId ?? '', clientSecret: clientSecret ?? '', updatedBy: 'bootstrap-from-config' })`
         - Log `logger.info({ serviceId }, 'Imported service connection from config')`
       - If `url` is empty/missing for a service, skip it (do NOT create a row — that service falls back to config later per D-14)

    3. Config file is NOT rewritten (D-15) — this helper only reads from config.

    4. Create test file `packages/dashboard/test/services/service-connections-bootstrap.test.ts` with cases:
       - repo already has rows → no import happens (spy on upsert)
       - repo empty + all three config services set → all three imported with correct values and updated_by
       - repo empty + only compliance set in config → only compliance imported, others skipped
       - Secret is encrypted at rest (verify via direct repo.list() read)
  </action>
  <verify>
    <automated>cd packages/dashboard &amp;&amp; npx vitest run test/services/service-connections-bootstrap.test.ts</automated>
  </verify>
  <done>
    Bootstrap helper tests pass, partial-config case covered.
  </done>
  <acceptance_criteria>
    - `packages/dashboard/src/services/service-connections-bootstrap.ts` exports function `importFromConfigIfEmpty`
    - File contains literal string `'bootstrap-from-config'`
    - Test file contains a case for "partial config" (only one of three services set)
    - All bootstrap tests pass
  </acceptance_criteria>
</task>

</tasks>

<verification>
- `cd packages/dashboard && npx vitest run test/db/service-connections-repository.test.ts test/services/service-connections-bootstrap.test.ts` passes
- `cd packages/dashboard && npx tsc --noEmit` passes (no type errors introduced)
- Migration file contains the new CREATE TABLE statement and a strictly-greater version number
</verification>

<success_criteria>
- Migration exists and applies cleanly against a fresh SQLite database
- Repository encrypts on write, decrypts on read, handles empty-secret case without throwing
- Bootstrap imports from config only when table is empty, skips services with missing config URL
- Tests pass with 80%+ line coverage on new files
- SVC-05 (encrypted at rest) and SVC-07 (config fallback path) are addressable by downstream plans
</success_criteria>

<output>
After completion, create `.planning/phases/06-service-connections-ui/06-01-SUMMARY.md` documenting: migration version, repository interface, bootstrap semantics, test coverage.
</output>
