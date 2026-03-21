# Phase 1: Plugin System Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the plugin framework — discovery, install, configure, activate, health check — with four management interfaces (UI, CLI, API, config file) sharing one PluginManager. No actual plugins yet.

**Architecture:** A `PluginManager` class owns the plugin lifecycle. Plugins are npm packages installed to a local directory with metadata stored in SQLite. The dashboard gains JSON API endpoints at `/api/v1/plugins/*`, a Settings > Plugins admin page, and CLI subcommands. A simple sequential migration framework replaces the current `CREATE TABLE IF NOT EXISTS` pattern.

**Tech Stack:** TypeScript, Fastify 5, better-sqlite3, Commander, Handlebars/HTMX, Vitest

**Spec:** `docs/superpowers/specs/2026-03-20-plugin-system-multitenancy-design.md`

---

## File Structure

### New files to create:

```
packages/dashboard/src/
  db/
    migrations.ts              # Sequential migration runner
  plugins/
    types.ts                   # Plugin interfaces (auth, notification, storage, scanner)
    manager.ts                 # PluginManager class (lifecycle, health checks)
    registry.ts                # Load + query plugin registry
    crypto.ts                  # AES-256-GCM encrypt/decrypt for plugin secrets
    reconciler.ts              # Reconcile luqen-plugins.json on startup
  routes/
    api/
      plugins.ts               # REST API: /api/v1/plugins/*
  views/
    admin/
      plugins.hbs              # Settings > Plugins page

packages/dashboard/
  plugin-registry.json         # Static registry of official plugins
  tests/
    plugins/
      manager.test.ts
      crypto.test.ts
      registry.test.ts
      reconciler.test.ts
    db/
      migrations.test.ts
    routes/
      api-plugins.test.ts
```

### Files to modify:

```
packages/dashboard/src/
  db/scans.ts                  # Use migration framework instead of inline CREATE TABLE
  auth/middleware.ts            # Return JSON 401 for /api/* requests
  server.ts                    # Register plugin API routes, init PluginManager
  cli.ts                       # Add plugin subcommand
  config.ts                    # Add pluginsDir + pluginsConfigFile fields
  views/
    partials/sidebar.hbs       # Add Plugins link in admin section
```

---

## Task 1: Database Migration Framework

The current codebase uses `CREATE TABLE IF NOT EXISTS` inline. We need a proper migration system for all future schema changes.

**Files:**
- Create: `packages/dashboard/src/db/migrations.ts`
- Test: `packages/dashboard/tests/db/migrations.test.ts`
- Modify: `packages/dashboard/src/db/scans.ts`

- [ ] **Step 1: Write failing tests for migration runner**

Create `packages/dashboard/tests/db/migrations.test.ts` with tests for:
- Creates schema_migrations table on first run
- Runs migrations in order
- Skips already-applied migrations
- Records migration metadata (id, name, applied_at)
- Returns list of applied migrations

Run: `cd packages/dashboard && npx vitest run tests/db/migrations.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement MigrationRunner**

Create `packages/dashboard/src/db/migrations.ts` with:
- `Migration` interface: `{ id: string; name: string; sql: string }`
- `MigrationRunner` class with `run(migrations)` and `getApplied()` methods
- Creates `schema_migrations` table automatically
- Tracks which migrations have been applied via `SELECT id FROM schema_migrations`
- Uses parameterized queries for inserts

- [ ] **Step 3: Run tests, verify pass**

Run: `cd packages/dashboard && npx vitest run tests/db/migrations.test.ts`
Expected: PASS

- [ ] **Step 4: Refactor ScanDb to use migrations**

In `packages/dashboard/src/db/scans.ts`:
- Move the `CREATE_TABLE_SQL` into a migration: `{ id: '001', name: 'create-scan-records', sql: '...' }`
- Export `DASHBOARD_MIGRATIONS` array
- Update `ScanDb.initialize()` to use `MigrationRunner`
- Add `getDatabase(): Database.Database` method to expose underlying DB

- [ ] **Step 5: Run all dashboard tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add database migration framework and refactor ScanDb to use it"
```

---

## Task 2: Plugin Type Interfaces

Define the typed interfaces for all four plugin categories.

**Files:**
- Create: `packages/dashboard/src/plugins/types.ts`

- [ ] **Step 1: Create plugin type definitions**

Create `packages/dashboard/src/plugins/types.ts` with all interfaces:
- `PluginManifest` — name, displayName, type, version, description, icon, configSchema, autoDeactivateOnFailure
- `PluginType` — `'auth' | 'notification' | 'storage' | 'scanner'`
- `ConfigField` — key, label, type (string/secret/number/boolean/select), required, default, options
- `PluginStatus` — `'inactive' | 'active' | 'error' | 'install-failed' | 'unhealthy'`
- `PluginRecord` — id, packageName, type, version, config, status, installedAt, activatedAt, error
- `PluginInstance` — manifest, activate(), deactivate(), healthCheck()
- `AuthPlugin` extends PluginInstance — authenticate, getLoginUrl, handleCallback, getUserInfo, getLogoutUrl, refreshToken
- `AuthResult`, `UserInfo` — auth response types
- `NotificationPlugin` extends PluginInstance — send(event: LuqenEvent)
- `LuqenEvent` — type (scan.complete/scan.failed/violation.found/regulation.changed), timestamp, data
- `StoragePlugin` extends PluginInstance — save/load/delete with Uint8Array
- `ScannerPlugin` extends PluginInstance — rules: WcagRule[], evaluate(page: { url: string; html: string; issues: ScannerIssue[] })
- `WcagRule`, `ScannerIssue` — scanner types
- `RegistryEntry` — name, displayName, type, version, description, packageName, icon

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: define plugin type interfaces for auth, notification, storage, scanner"
```

---

## Task 3: Plugin Secret Encryption

Encrypt sensitive config values at rest using AES-256-GCM.

**Files:**
- Create: `packages/dashboard/src/plugins/crypto.ts`
- Test: `packages/dashboard/tests/plugins/crypto.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/plugins/crypto.test.ts`:
- encrypt then decrypt returns original value
- decrypt with wrong key throws
- encrypted output differs from input
- encrypt produces different ciphertext each time (random IV)
- encryptConfig encrypts only secret-typed fields
- decryptConfig decrypts only secret-typed fields
- maskSecrets replaces secret fields with `'***'`

- [ ] **Step 2: Implement crypto module**

Create `packages/dashboard/src/plugins/crypto.ts` using `node:crypto`:
- `encryptSecret(value, key)` — AES-256-GCM, returns `iv:ciphertext:tag` base64 string
- `decryptSecret(encrypted, key)` — reverses encrypt
- `encryptConfig(config, schema, key)` — encrypts fields with schema type `'secret'`
- `decryptConfig(config, schema, key)` — decrypts secret fields
- `maskSecrets(config, schema)` — replaces secret fields with `'***'`
- Derive a 32-byte key from the session secret using `scryptSync`

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add AES-256-GCM encryption for plugin secret config values"
```

---

## Task 4: Plugin Registry

Load and query the static plugin registry.

**Files:**
- Create: `packages/dashboard/src/plugins/registry.ts`
- Create: `packages/dashboard/plugin-registry.json`
- Test: `packages/dashboard/tests/plugins/registry.test.ts`

- [ ] **Step 1: Write failing tests**

- loadRegistry returns array of RegistryEntry
- filterByType returns only matching type
- getByName returns specific entry or null
- empty registry returns empty array

- [ ] **Step 2: Create static registry JSON**

Create `packages/dashboard/plugin-registry.json` with entries for:
- auth-entra (Azure Entra ID), auth-okta (Okta), auth-google (Google Workspace)
- notify-slack (Slack), notify-teams (Microsoft Teams)
- storage-s3 (AWS S3), storage-azure (Azure Blob)

Each entry: name, displayName, type, version, description, packageName, icon.

- [ ] **Step 3: Implement registry module**

Create `packages/dashboard/src/plugins/registry.ts`:
- `loadRegistry(registryPath?)` — reads JSON, returns RegistryEntry[]
- `filterByType(entries, type)` — filter by plugin type
- `getByName(entries, name)` — find by slug name

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add static plugin registry with official plugin entries"
```

---

## Task 5: Plugins Table Migration

The PluginManager (Task 6) needs the plugins table to exist. Add it as migration 002.

**Files:**
- Modify: `packages/dashboard/src/db/scans.ts` (add migration to DASHBOARD_MIGRATIONS)

- [ ] **Step 1: Add plugins table migration**

In `packages/dashboard/src/db/scans.ts`, add to the DASHBOARD_MIGRATIONS array:
```typescript
{
  id: '002',
  name: 'create-plugins',
  sql: `
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      package_name TEXT NOT NULL,
      type TEXT NOT NULL,
      version TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'inactive',
      installed_at TEXT NOT NULL,
      activated_at TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_plugins_type ON plugins(type);
    CREATE INDEX IF NOT EXISTS idx_plugins_status ON plugins(status);
  `,
},
```

- [ ] **Step 2: Run tests, verify pass**

Run: `cd packages/dashboard && npx vitest run`
Expected: All pass (migration runs on init, creates table alongside scan_records)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add plugins table as database migration 002"
```

---

## Task 6: PluginManager Core

The central class managing plugin lifecycle.

**Files:**
- Create: `packages/dashboard/src/plugins/manager.ts`
- Test: `packages/dashboard/tests/plugins/manager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/plugins/manager.test.ts`:
- install: creates DB entry with status `inactive`
- install: rejects package not in registry
- configure: updates config, encrypts secrets
- activate: sets status `active`, loads and calls plugin activate()
- activate: sets status `error` with message if activate() throws
- deactivate: sets status `inactive`, calls plugin deactivate()
- remove: deletes DB entry and plugin directory
- list: returns all plugins with masked secrets
- getPlugin: returns specific plugin or null
- healthCheck: updates status based on health response
- healthCheck: marks unhealthy after 3 consecutive failures
- initializeOnStartup: auto-activates plugins with status `active`

Use mock plugin packages (temp directories with manifest.json) — do NOT run real npm install in tests.

- [ ] **Step 2: Implement PluginManager**

Create `packages/dashboard/src/plugins/manager.ts`:

Key methods:
- `install(packageName)` — validate against registry, run npm install (using `execFile` not `exec` for security), read manifest, insert DB row
- `configure(id, config)` — validate against configSchema, encrypt secrets, update DB
- `activate(id)` — load plugin via dynamic `import()`, call `activate(decryptedConfig)`, update DB
- `deactivate(id)` — call plugin `deactivate()`, update DB status
- `remove(id)` — deactivate if active, delete DB row, remove plugin directory
- `list()` — query DB, mask secrets in response
- `getPlugin(id)` — query DB by id
- `checkHealth(id)` — call plugin `healthCheck()`, track consecutive failures
- `initializeOnStartup()` — load and activate all plugins with `status = 'active'`
- `startHealthChecks(intervalMs)` — start background interval
- `stopHealthChecks()` — clear interval
- `getActivePluginsByType(type)` — return activated plugin instances by type

IMPORTANT: Use `execFile` (not `exec`) for npm install to prevent shell injection. Import from `node:child_process`.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: implement PluginManager with full lifecycle management"
```

---

## Task 7: Plugin Config File Reconciler

Support `luqen-plugins.json` declarative config with env var substitution.

**Files:**
- Create: `packages/dashboard/src/plugins/reconciler.ts`
- Test: `packages/dashboard/tests/plugins/reconciler.test.ts`

- [ ] **Step 1: Write failing tests**

- resolveEnvVars: replaces `${VAR}` with env value
- resolveEnvVars: leaves non-env strings unchanged
- resolveEnvVars: logs warning for undefined env vars
- reconcile: installs missing plugins
- reconcile: activates plugins marked `active: true`
- reconcile: skips already-installed plugins
- reconcile: returns summary of actions taken

- [ ] **Step 2: Implement reconciler**

Create `packages/dashboard/src/plugins/reconciler.ts`:
- `resolveEnvVars(config)` — replaces `${VAR_NAME}` patterns with `process.env` values
- `reconcile(manager, configPath)` — reads luqen-plugins.json, installs/configures/activates
- Returns: `{ installed: string[], configured: string[], activated: string[], errors: string[] }`

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add plugin config file reconciler with env var substitution"
```

---

## Task 8: Update Auth Middleware for JSON API

API endpoints need JSON 401 responses instead of redirects.

**Files:**
- Modify: `packages/dashboard/src/auth/middleware.ts`

- [ ] **Step 1: Write tests for new JSON 401 behavior**

Add tests (to existing auth test file or new `packages/dashboard/tests/auth/api-auth.test.ts`):
- `/api/v1/plugins` without session returns JSON `{ error: 'Authentication required' }` with status 401
- `/api/v1/plugins` with expired token returns JSON 401
- `/login` without session still redirects to `/login` (existing behavior preserved)

- [ ] **Step 2: Update authGuard**

Modify `authGuard` in `packages/dashboard/src/auth/middleware.ts`:
- Detect API requests via `request.url.startsWith('/api/')`
- For API requests: return `reply.code(401).send({ error: 'Authentication required' })` instead of redirect
- For API requests with expired token: return JSON 401 instead of redirect
- Non-API requests: keep existing redirect behavior unchanged

- [ ] **Step 2: Run all dashboard tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: All pass (existing tests use HTML routes, not API)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: update auth middleware to return JSON 401 for API requests"
```

---

## Task 9: Plugin REST API Routes

JSON API endpoints for plugin management.

**Files:**
- Create: `packages/dashboard/src/routes/api/plugins.ts`
- Test: `packages/dashboard/tests/routes/api-plugins.test.ts`
- Modify: `packages/dashboard/src/server.ts` (register routes)

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/routes/api-plugins.test.ts`:
- `GET /api/v1/plugins` returns JSON list of installed plugins
- `GET /api/v1/plugins/registry` returns available plugins
- `POST /api/v1/plugins/install` installs a plugin (mock npm)
- `PATCH /api/v1/plugins/:id/config` updates config
- `POST /api/v1/plugins/:id/activate` activates
- `POST /api/v1/plugins/:id/deactivate` deactivates
- `DELETE /api/v1/plugins/:id` removes
- `GET /api/v1/plugins/:id/health` returns health
- All endpoints return 403 for non-admin users

- [ ] **Step 2: Implement plugin API routes**

Create `packages/dashboard/src/routes/api/plugins.ts`:
- Follow pattern from existing admin routes but return JSON instead of HTML
- All endpoints use `{ preHandler: adminGuard }`
- Each endpoint delegates to PluginManager methods

Function signature:
```typescript
export async function pluginApiRoutes(
  server: FastifyInstance,
  pluginManager: PluginManager,
): Promise<void>
```

- [ ] **Step 3: Register in server.ts and init PluginManager**

In `packages/dashboard/src/server.ts`:
- Import PluginManager, loadRegistry, reconciler
- Initialize PluginManager after DB init
- Call `pluginManager.initializeOnStartup()`
- Reconcile config file if `config.pluginsConfigFile` is set
- Start health checks
- Register `pluginApiRoutes(server, pluginManager)`

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add REST API endpoints for plugin management at /api/v1/plugins"
```

---

## Task 10: Plugin Admin UI (Settings > Plugins)

Dashboard page for managing plugins via HTMX.

**Files:**
- Create: `packages/dashboard/src/views/admin/plugins.hbs`
- Create: `packages/dashboard/src/routes/admin/plugins.ts`
- Test: `packages/dashboard/tests/routes/admin-plugins.test.ts`
- Modify: `packages/dashboard/src/views/partials/sidebar.hbs`
- Modify: `packages/dashboard/src/server.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/routes/admin-plugins.test.ts`:
- GET /admin/plugins renders plugin list page (200 HTML)
- GET /admin/plugins requires admin role (403)
- POST /admin/plugins/install delegates to PluginManager
- POST /admin/plugins/:id/activate changes plugin status
- POST /admin/plugins/:id/deactivate changes plugin status
- DELETE /admin/plugins/:id removes plugin
- GET /admin/plugins/:id/configure renders config form

- [ ] **Step 2: Create plugins admin route**

Create `packages/dashboard/src/routes/admin/plugins.ts` following the pattern from `routes/admin/system.ts`:
- `GET /admin/plugins` — render page with installed + registry data
- `POST /admin/plugins/install` — HTMX install, return updated card fragment
- `POST /admin/plugins/:id/activate` — HTMX activate
- `POST /admin/plugins/:id/deactivate` — HTMX deactivate
- `DELETE /admin/plugins/:id` — HTMX remove
- `GET /admin/plugins/:id/configure` — render config form from configSchema
- `PATCH /admin/plugins/:id/config` — HTMX save config

- [ ] **Step 2: Create plugins Handlebars template**

Create `packages/dashboard/src/views/admin/plugins.hbs`:
- Status cards: Installed count, Active count, Available count
- Installed plugins section: cards with name, type badge, version, status badge, action buttons (HTMX)
- Available plugins section (from registry, excluding installed): name, description, Install button
- Config form modal rendered from configSchema fields

- [ ] **Step 3: Add Plugins link to sidebar**

In `packages/dashboard/src/views/partials/sidebar.hbs`, add "Plugins" link in admin section before "System Health". Use a plug icon SVG.

- [ ] **Step 4: Register route in server.ts**

- [ ] **Step 5: Run dashboard tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add Settings > Plugins admin page with marketplace UI"
```

---

## Task 11: Plugin CLI Commands

Add `plugin` subcommand to dashboard CLI.

**Files:**
- Modify: `packages/dashboard/src/cli.ts`
- Test: `packages/dashboard/tests/cli-plugin.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/cli-plugin.test.ts`:
- `plugin list` outputs installed plugins table
- `plugin install` with valid package succeeds
- `plugin configure` with `--set key=value` updates config
- `plugin activate` changes status
- `plugin deactivate` changes status
- `plugin remove` deletes plugin

- [ ] **Step 2: Add plugin subcommand**

In `packages/dashboard/src/cli.ts`, add `plugin` command group with subcommands: list, install, configure, activate, deactivate, remove. Each initializes DB + PluginManager, performs action, prints result.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add plugin CLI subcommands (install, configure, activate, list, remove)"
```

---

## Task 12: Config Updates + Build

Add plugin config fields and finalize build.

**Files:**
- Modify: `packages/dashboard/src/config.ts`
- Modify: `packages/dashboard/package.json` (build copies registry JSON)

- [ ] **Step 1: Add config fields**

In `packages/dashboard/src/config.ts`:
- Add `pluginsDir: string` and `pluginsConfigFile?: string` to DashboardConfig
- Default: `pluginsDir: './plugins'`
- Env overrides: `DASHBOARD_PLUGINS_DIR`, `DASHBOARD_PLUGINS_CONFIG`

- [ ] **Step 2: Validate pluginsDir in validateConfig**

In `packages/dashboard/src/config.ts`, add validation for `pluginsDir`: ensure parent directory exists (create if missing, similar to `reportsDir` pattern).

- [ ] **Step 3: Update build script**

In `packages/dashboard/package.json`, add registry JSON copy to build script.

- [ ] **Step 4: Full build and test**

```bash
npm run build --workspaces && npm test --workspaces
```
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add plugin config fields, migration, and build setup"
```

---

## Task 13: Phase 1 Documentation

Update all docs for the plugin system.

**Files:**
- Modify: `docs/reference/cli-reference.md` — add plugin CLI commands
- Modify: `docs/reference/api-reference.md` — add /api/v1/plugins/* endpoints
- Modify: `docs/reference/dashboard-config.md` — add DASHBOARD_PLUGINS_DIR, DASHBOARD_PLUGINS_CONFIG
- Modify: `docs/paths/full-dashboard.md` — add "Managing Plugins" section
- Modify: `docs/getting-started/what-is-luqen.md` — add plugin system to overview
- Create: `docs/reference/plugin-development.md` — manifest format, interfaces, lifecycle
- Modify: `README.md` — mention plugin extensibility
- Modify: `CHANGELOG.md` — add v0.8.0 entry
- Modify: `.claude/skills/luqen/SKILL.md` — add plugin CLI and API docs

- [ ] **Step 1: Update reference docs** (cli-reference, api-reference, dashboard-config)
- [ ] **Step 2: Update path guides** (full-dashboard, what-is-luqen)
- [ ] **Step 3: Create plugin-development.md**
- [ ] **Step 4: Update README, CHANGELOG, and SKILL.md**
- [ ] **Step 5: Commit**

```bash
git commit -m "docs: add plugin system documentation to guides and references"
```

---

## Task 14: Final Verification + Release

- [ ] **Step 1: Full build and test**

```bash
npm run build --workspaces && npm test --workspaces
```
Expected: All tests pass

- [ ] **Step 2: Tag and push**

```bash
git tag v0.8.0
git push origin master --tags && git push trunten82 master --tags
```

- [ ] **Step 3: Create GitHub releases**

- [ ] **Step 4: Update project memory**
