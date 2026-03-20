# Product Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform pally-agent from a component-organized project into a composable accessibility platform with path-based documentation and zero dead code.

**Architecture:** Fix all code review findings first (integration gaps, dead code, version strings), then restructure documentation around user composition paths. Each task produces working, testable software.

**Tech Stack:** TypeScript, Fastify, Handlebars, Vitest, Commander

**Spec:** `docs/superpowers/specs/2026-03-20-product-evolution-design.md`

---

## Phase 1: Code Fixes (from 4 review agents)

### Task 1: Add Missing User REST API Routes to Compliance Service

The dashboard admin UI calls user management endpoints that don't exist in the compliance API. This creates 404 errors on the Users admin page.

**Files:**
- Create: `packages/compliance/src/api/routes/users.ts`
- Modify: `packages/compliance/src/api/server.ts:109-119` (add route registration)
- Modify: `packages/compliance/src/types.ts` (add `active` field to User interface)
- Modify: `packages/compliance/src/db/adapter.ts` (add `listUsers`, `deactivateUser` to DbAdapter)
- Modify: `packages/compliance/src/db/sqlite-adapter.ts` (implement new adapter methods)
- Test: `packages/compliance/tests/api/users.test.ts`

- [ ] **Step 1: Add `active` field to User type**

In `packages/compliance/src/types.ts`, update the User interface (line 101):
```typescript
export interface User {
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly role: 'admin' | 'editor' | 'viewer';
  readonly active: boolean;
  readonly createdAt: string;
}
```

- [ ] **Step 2: Add adapter methods**

In `packages/compliance/src/db/adapter.ts`, add to the DbAdapter interface:
```typescript
listUsers(): Promise<User[]>;
deactivateUser(id: string): Promise<void>;
```

- [ ] **Step 3: Implement in SQLite adapter**

In `packages/compliance/src/db/sqlite-adapter.ts`, add `active` column to user schema and implement `listUsers()` and `deactivateUser()`.

- [ ] **Step 4: Write failing tests**

Create `packages/compliance/tests/api/users.test.ts`:
- Test `GET /api/v1/users` returns user list
- Test `POST /api/v1/users` creates a user
- Test `PATCH /api/v1/users/:id/deactivate` sets active=false
- Test auth: endpoints require admin scope

Run: `cd packages/compliance && npx vitest run tests/api/users.test.ts`
Expected: FAIL

- [ ] **Step 5: Create users route**

Create `packages/compliance/src/api/routes/users.ts` with:
- `GET /api/v1/users` — list all users (admin scope)
- `POST /api/v1/users` — create user (admin scope)
- `PATCH /api/v1/users/:id/deactivate` — deactivate user (admin scope)

- [ ] **Step 6: Register route**

In `packages/compliance/src/api/server.ts`, add:
```typescript
import { registerUserRoutes } from './routes/users.js';
// After line 119:
await registerUserRoutes(server, db);
```

- [ ] **Step 7: Run tests, verify pass**

Run: `cd packages/compliance && npx vitest run tests/api/users.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/compliance/src/api/routes/users.ts packages/compliance/src/api/server.ts packages/compliance/src/types.ts packages/compliance/src/db/adapter.ts packages/compliance/src/db/sqlite-adapter.ts packages/compliance/tests/api/users.test.ts
git commit -m "feat: add user management REST API routes to compliance service"
```

---

### Task 2: Add Missing Client REST API Routes to Compliance Service

Same issue as Task 1 but for OAuth client management.

**Files:**
- Create: `packages/compliance/src/api/routes/clients.ts`
- Modify: `packages/compliance/src/api/server.ts` (add route registration)
- Test: `packages/compliance/tests/api/clients.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/compliance/tests/api/clients.test.ts`:
- Test `GET /api/v1/clients` returns client list
- Test `POST /api/v1/clients` creates a client
- Test `POST /api/v1/clients/:id/revoke` deletes client
- Test auth: endpoints require admin scope

Run: `cd packages/compliance && npx vitest run tests/api/clients.test.ts`
Expected: FAIL

- [ ] **Step 2: Create clients route**

Create `packages/compliance/src/api/routes/clients.ts` with:
- `GET /api/v1/clients` — list all OAuth clients (admin scope)
- `POST /api/v1/clients` — create client (admin scope)
- `POST /api/v1/clients/:id/revoke` — delete/revoke client (admin scope)

Use existing `db.createClient()`, `db.listClients()`, `db.deleteClient()` adapter methods.

- [ ] **Step 3: Register route**

In `packages/compliance/src/api/server.ts`, add:
```typescript
import { registerClientRoutes } from './routes/clients.js';
await registerClientRoutes(server, db);
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd packages/compliance && npx vitest run tests/api/clients.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/api/routes/clients.ts packages/compliance/src/api/server.ts packages/compliance/tests/api/clients.test.ts
git commit -m "feat: add OAuth client management REST API routes to compliance service"
```

---

### Task 3: Fix Health Endpoint Path Mismatch

Dashboard calls `${complianceUrl}/health` but compliance serves `/api/v1/health`.

**Files:**
- Modify: `packages/dashboard/src/compliance-client.ts:562`
- Test: `packages/dashboard/tests/compliance-client.test.ts` (if exists, else add to scenarios)

- [ ] **Step 1: Fix the path**

In `packages/dashboard/src/compliance-client.ts` line 562, change:
```typescript
// Before:
const res = await fetch(`${complianceUrl}/health`);
// After:
const res = await fetch(`${complianceUrl}/api/v1/health`);
```

- [ ] **Step 2: Run dashboard tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/compliance-client.ts
git commit -m "fix: correct compliance health endpoint path to /api/v1/health"
```

---

### Task 4: Add Missing Webhook Test Endpoint

Dashboard calls `POST /api/v1/webhooks/:id/test` but it doesn't exist.

**Files:**
- Modify: `packages/compliance/src/api/routes/webhooks.ts`
- Test: `packages/compliance/tests/api/webhooks.test.ts` (add test case)

- [ ] **Step 1: Write failing test**

Add to webhook tests: test `POST /api/v1/webhooks/:id/test` returns 200 and dispatches a test event.

- [ ] **Step 2: Add test endpoint**

In `packages/compliance/src/api/routes/webhooks.ts`, add:
```typescript
// POST /api/v1/webhooks/:id/test — send a test webhook
server.post('/api/v1/webhooks/:id/test', { preHandler: requireScope('admin') }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const webhooks = await db.listWebhooks();
  const webhook = webhooks.find(w => w.id === id);
  if (webhook === undefined) return reply.code(404).send({ error: 'Webhook not found' });
  // Send test payload
  try {
    await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'test', timestamp: new Date().toISOString(), webhookId: id }),
    });
    return reply.send({ success: true });
  } catch (err) {
    return reply.send({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});
```

- [ ] **Step 3: Run tests, verify pass**

Run: `cd packages/compliance && npx vitest run`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/compliance/src/api/routes/webhooks.ts packages/compliance/tests/api/webhooks.test.ts
git commit -m "feat: add webhook test endpoint POST /api/v1/webhooks/:id/test"
```

---

### Task 5: Fix K8s Ingress Rewrite-Target

The global `rewrite-target: "/$2"` strips `/api` prefix, breaking all compliance API routing.

**Files:**
- Modify: `k8s/ingress.yaml`

- [ ] **Step 1: Fix the ingress**

In `k8s/ingress.yaml`:
1. Remove the global annotation: `nginx.ingress.kubernetes.io/rewrite-target: "/$2"`
2. Change compliance path rule from regex `"/api(/|$)(.*)"` to simple prefix `"/api"` with `pathType: Prefix`
3. Change dashboard path rule from regex `"/(/|$)(.*)"` to simple prefix `"/"` with `pathType: Prefix`
4. Remove the `nginx.ingress.kubernetes.io/use-regex: "true"` annotation since we no longer need regex paths

This ensures compliance receives the full `/api/v1/...` path and dashboard receives `/...` paths directly.

- [ ] **Step 2: Commit**

```bash
git add k8s/ingress.yaml
git commit -m "fix: remove ingress rewrite-target that breaks compliance API routing"
```

---

### Task 6: Dead Code Cleanup

Remove orphaned files, unused dependencies, stale templates, and broken links.

**Files:**
- Delete: `packages/compliance/src/db/mongodb-adapter.ts`
- Delete: `packages/compliance/src/db/postgres-adapter.ts`
- Delete: `packages/dashboard/src/views/report-view.hbs`
- Modify: `packages/compliance/package.json` (remove mongodb, pg, @types/pg, @types/ioredis)
- Modify: `packages/dashboard/package.json` (remove @types/ioredis)
- Modify: `packages/monitor/package.json` (remove jose)
- Modify: `packages/dashboard/src/views/partials/sidebar.hbs:71-77` (remove /admin/requirements link)
- Modify: `packages/compliance/src/types.ts:317` (remove ComplianceServiceVersion)
- Modify: `packages/compliance/src/types.ts` (remove dbAdapter, dbUrl, refreshTokenExpiry, a2a from ComplianceConfig)
- Modify: `packages/compliance/src/config.ts` (remove dbAdapter, dbUrl, a2a defaults and env overrides)
- Modify: `.gitignore` (fix pally-reports pattern)
- Delete: `packages/compliance/tests/db/adapter-contract.test.ts` (tests the dead adapters — verify first)

- [ ] **Step 1: Remove orphaned adapter files**

```bash
rm packages/compliance/src/db/mongodb-adapter.ts
rm packages/compliance/src/db/postgres-adapter.ts
```

- [ ] **Step 2: Remove unused dependencies**

In `packages/compliance/package.json`, remove from dependencies: `mongodb`, `pg`, `@types/pg`.
In `packages/monitor/package.json`, remove from dependencies: `jose`.

**Note:** Do NOT remove `@types/ioredis` — ioredis v5+ still needs it for TypeScript compilation in some configurations. Redis is an active feature.

- [ ] **Step 3: Remove dead config fields**

In `packages/compliance/src/types.ts`:
- Remove `dbAdapter` field entirely from ComplianceConfig (no longer needed — only SQLite is used)
- Remove `dbUrl` from ComplianceConfig
- Remove `refreshTokenExpiry` from ComplianceConfig
- Remove `a2a` from ComplianceConfig
- Remove `ComplianceServiceVersion` type export (line 317)
- Remove `'mongodb' | 'postgres'` from any union types referencing adapter names

In `packages/compliance/src/config.ts`:
- Remove `dbAdapter`, `dbUrl`, `a2a` from DEFAULT_CONFIG
- Remove corresponding env var overrides (`COMPLIANCE_DB_ADAPTER`, `COMPLIANCE_DB_URL`)

- [ ] **Step 4: Remove stale template and broken sidebar link**

```bash
rm packages/dashboard/src/views/report-view.hbs
```

In `packages/dashboard/src/views/partials/sidebar.hbs`, remove lines 71-77 (the `/admin/requirements` link).

- [ ] **Step 5: Fix .gitignore**

In `.gitignore` line 4, change `.pally-reports/` to `pally-reports/`.
Also add committed report files to .gitignore and untrack them:
```bash
git rm --cached pally-reports/*.json 2>/dev/null || true
```

- [ ] **Step 6: Run all tests**

```bash
npm run build --workspaces && npm test --workspaces
```
Expected: All pass. Some compliance contract tests may need removal if they test the dead adapters.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove dead code — orphaned adapters, unused deps, stale templates, broken links"
```

---

### Task 7: Make Version Strings Dynamic

Replace all hardcoded `0.1.0` strings with runtime reads from package.json.

**Files:**
- Create: `packages/compliance/src/version.ts`
- Create: `packages/core/src/version.ts`
- Create: `packages/dashboard/src/version.ts`
- Create: `packages/monitor/src/version.ts`
- Modify: 13 files with hardcoded versions (see list below)

Each version.ts:
```typescript
import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function loadVersion(): string {
  try {
    const pkgPath = resolve(join(__dirname, '..', 'package.json'));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = loadVersion();
```

- [ ] **Step 1: Create version.ts for each package**

Create the 4 version.ts files above.

- [ ] **Step 2: Replace all hardcoded versions**

Files to update (replace `'0.1.0'` with `VERSION` import):
- `packages/compliance/src/cli.ts:27`
- `packages/compliance/src/api/routes/health.ts:20`
- `packages/compliance/src/api/server.ts:74`
- `packages/core/src/cli.ts:30`
- `packages/core/src/mcp.ts:23`
- `packages/dashboard/src/cli.ts:11`
- `packages/dashboard/src/server.ts:165`
- `packages/monitor/src/mcp/server.ts:23`
- `packages/monitor/src/cli.ts:13`
- `packages/monitor/src/a2a/agent-card.ts:29`
- `packages/monitor/src/sources.ts:98`
- `packages/monitor/src/config.ts:21`
- `packages/compliance/tests/api/health.test.ts:26` (test assertion — update expected value)

- [ ] **Step 3: Build and test**

```bash
npm run build --workspaces && npm test --workspaces
```
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/*/src/version.ts packages/*/src/cli.ts packages/*/src/server.ts packages/core/src/mcp.ts packages/monitor/src/mcp/server.ts packages/monitor/src/a2a/agent-card.ts packages/monitor/src/sources.ts packages/monitor/src/config.ts packages/compliance/src/api/routes/health.ts packages/compliance/src/api/server.ts
git commit -m "chore: make version strings dynamic — read from package.json at runtime"
```

---

### Task 8: Add PALLY_COMPLIANCE_URL Env Var to Core

Make it easier to connect core to compliance service via environment variable.

**Files:**
- Modify: `packages/core/src/config.ts`
- Test: `packages/core/tests/config.test.ts`

- [ ] **Step 1: Write failing test**

Add test: setting `PALLY_COMPLIANCE_URL` env var populates `config.compliance.url`.

- [ ] **Step 2: Add env var support**

In `packages/core/src/config.ts`, add `PALLY_COMPLIANCE_URL` to the env override logic.

- [ ] **Step 3: Run tests, verify pass**

Run: `cd packages/core && npx vitest run`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/config.ts packages/core/tests/config.test.ts
git commit -m "feat: add PALLY_COMPLIANCE_URL env var for easier compliance integration"
```

---

### Task 9: Core First-Run UX — Helpful Pa11y Error

When pa11y webservice is unreachable, show a helpful error with setup instructions.

**Files:**
- Modify: `packages/core/src/scanner/webservice-client.ts`
- Test: `packages/core/tests/scanner/webservice-client.test.ts`

- [ ] **Step 1: Write failing test**

Test that when webservice returns ECONNREFUSED, the error message includes setup instructions.

- [ ] **Step 2: Add helpful error handling**

In the webservice client's fetch wrapper, catch connection errors and throw with message:
```
Cannot connect to pa11y webservice at ${url}.

To set up pa11y webservice:
  npm install -g pa11y-webservice
  pa11y-webservice

Or use Docker:
  docker run -p 3000:3000 pa11y/pa11y-webservice

Then retry your scan.
```

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/scanner/webservice-client.ts packages/core/tests/scanner/webservice-client.test.ts
git commit -m "feat: show helpful setup instructions when pa11y webservice is unreachable"
```

---

### Task 10: Report "Next Steps" Hints

Add contextual footer to JSON and HTML reports suggesting available tiers.

**Files:**
- Modify: `packages/core/src/reporter/json-reporter.ts`
- Modify: `packages/core/src/reporter/html-reporter.ts` (or `report.hbs`)
- Test: `packages/core/tests/reporter/json-reporter.test.ts`

- [ ] **Step 1: Write failing test**

Test that JSON report includes a `nextSteps` field. When no compliance data is present, it suggests adding compliance. When compliance data is present, it suggests the dashboard.

- [ ] **Step 2: Add nextSteps to JSON reporter**

Add a `nextSteps` field to the JSON output based on what data is present:
- No compliance data → `"Want legal compliance mapping? Add @pally-agent/compliance. See: https://github.com/alanna82/pally-agent"`
- Has compliance data → `"Want a web dashboard to track compliance over time? Add @pally-agent/dashboard."`

- [ ] **Step 3: Add hint to HTML report footer**

In `packages/core/src/reporter/report.hbs`, add a subtle footer line with the same hint text.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reporter/json-reporter.ts packages/core/src/reporter/html-reporter.ts packages/core/src/reporter/report.hbs packages/core/tests/reporter/json-reporter.test.ts
git commit -m "feat: add next-steps hints to scan reports for progressive discovery"
```

---

### Task 11: Monitor Standalone Mode — Local Config Fallback

Allow monitor to work without a compliance service by reading sources from a local config file.

**Files:**
- Modify: `packages/monitor/src/config.ts` (add `sourcesFile` field)
- Create: `packages/monitor/src/local-sources.ts` (load sources from local JSON)
- Modify: `packages/monitor/src/agent.ts` (use local sources when compliance unavailable)
- Test: `packages/monitor/tests/local-sources.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/monitor/tests/local-sources.test.ts`:
- Test loading sources from a `.pally-monitor.json` file
- Test fallback: returns empty array when file doesn't exist
- Test validation: rejects malformed JSON

- [ ] **Step 2: Create local-sources.ts**

```typescript
// Lookup order: --config CLI flag, then cwd, then $HOME
// File format: { "sources": [{ "name": "...", "url": "...", "type": "html|rss|api" }] }
```

- [ ] **Step 3: Integrate into agent.ts**

In `runScan()`, if `getToken()` fails (compliance unavailable), fall back to `loadLocalSources()`. Log a warning that compliance enrichment is unavailable.

- [ ] **Step 4: Add `--sources-file` CLI flag**

In `packages/monitor/src/cli.ts`, add `--sources-file <path>` option to `scan` command.

- [ ] **Step 5: Run tests, verify pass**

Run: `cd packages/monitor && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/monitor/src/config.ts packages/monitor/src/local-sources.ts packages/monitor/src/agent.ts packages/monitor/src/cli.ts packages/monitor/tests/local-sources.test.ts
git commit -m "feat: add local config fallback for monitor standalone mode"
```

---

### Task 12: Dashboard Graceful Degradation

Improve dashboard behavior when compliance service is unavailable — scans and reports should still work, just without legal mapping.

**Files:**
- Modify: `packages/dashboard/src/compliance-client.ts` (add try/catch wrappers that return empty defaults)
- Modify: `packages/dashboard/src/routes/scan.ts` (handle missing jurisdictions gracefully)
- Modify: `packages/dashboard/src/routes/home.ts` (handle compliance unavailable)
- Test: `packages/dashboard/tests/graceful-degradation.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/graceful-degradation.test.ts`:
- Test: scan form renders without jurisdictions when compliance is down
- Test: report list renders when compliance is down
- Test: home page renders with "compliance unavailable" warning

- [ ] **Step 2: Add safe wrappers to compliance-client**

Create wrapper functions that catch fetch errors and return safe defaults:
- `safeListJurisdictions()` → returns `[]` on error
- `safeGetSystemHealth()` → returns degraded status on error

- [ ] **Step 3: Update routes to use safe wrappers**

In `routes/scan.ts`, `routes/home.ts`: replace direct compliance calls with safe wrappers. Add `complianceAvailable: boolean` to template data for conditional UI.

- [ ] **Step 4: Run tests, verify pass**

Run: `cd packages/dashboard && npx vitest run`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/compliance-client.ts packages/dashboard/src/routes/scan.ts packages/dashboard/src/routes/home.ts packages/dashboard/tests/graceful-degradation.test.ts
git commit -m "feat: dashboard graceful degradation when compliance service unavailable"
```

---

## Phase 2: Documentation Restructure

### Task 13: Create New Docs Directory Structure

Set up the path-based docs layout and migrate reference docs.

**Files:**
- Create: `docs/getting-started/` directory
- Create: `docs/paths/` directory
- Create: `docs/reference/` directory
- Create: `docs/deployment/` directory
- Create: `docs/contributing/` directory

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p docs/getting-started docs/paths docs/reference docs/deployment docs/contributing
```

- [ ] **Step 2: Move and consolidate reference docs**

```bash
mv docs/configuration/core.md docs/reference/core-config.md
mv docs/configuration/compliance.md docs/reference/compliance-config.md
mv docs/configuration/dashboard.md docs/reference/dashboard-config.md
mv docs/configuration/monitor.md docs/reference/monitor-config.md
mv docs/integrations/api-reference.md docs/reference/api-reference.md
mv docs/installation/docker.md docs/deployment/docker.md
mv docs/installation/kubernetes.md docs/deployment/kubernetes.md
mv docs/installation/cloud.md docs/deployment/cloud.md
mv docs/ARCHITECTURE.md docs/contributing/architecture.md
```

- [ ] **Step 3: Fix all doc issues from review**

In moved reference docs:
- `docs/reference/monitor-config.md`: Fix env var names (`COMPLIANCE_URL` → `MONITOR_COMPLIANCE_URL`, etc.)
- `docs/reference/compliance-config.md`: Add `COMPLIANCE_REDIS_URL` documentation
- `docs/reference/dashboard-config.md`: Add `DASHBOARD_REDIS_URL` and `self-audit` CLI command documentation
- `docs/deployment/kubernetes.md`: Fix overlay names (`development/staging/production` → `dev/prod`)

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: create path-based directory structure and fix reference doc issues"
```

---

### Task 14: Write Getting Started Guides

**Files:**
- Create: `docs/getting-started/what-is-pally.md`
- Create: `docs/getting-started/quick-scan.md`
- Create: `docs/getting-started/one-line-install.md`

- [ ] **Step 1: Write what-is-pally.md**

Overview: what pally-agent is, the tiered architecture, how pieces fit together, which path to choose. Include the composition paths table from the spec. Link to each path guide.

- [ ] **Step 2: Write quick-scan.md**

Self-contained guide: install pa11y webservice, install core, scan a URL, read the report. Under 100 lines. Include troubleshooting for common errors (webservice not running, URL unreachable).

- [ ] **Step 3: Write one-line-install.md**

Migrate content from `docs/installation/one-line.md`, add what it installs, how to verify, how to access dashboard.

- [ ] **Step 4: Commit**

```bash
git add docs/getting-started/
git commit -m "docs: add getting-started guides — overview, quick scan, one-line install"
```

---

### Task 15: Write Path Guides

**Files:**
- Create: `docs/paths/developer-cli.md`
- Create: `docs/paths/ide-integration.md`
- Create: `docs/paths/compliance-checking.md`
- Create: `docs/paths/full-dashboard.md`
- Create: `docs/paths/regulatory-monitoring.md`

Each guide follows the same structure: Prerequisites → Install → Configure → First Run → Verify → Next Steps.

- [ ] **Step 1: Write developer-cli.md**

Covers paths 1-3 (quick scan, CI/CD gate, fix proposals). Core package only. Include CI/CD pipeline examples (GitHub Actions, Azure DevOps).

- [ ] **Step 2: Write ide-integration.md**

Path 2: MCP setup for VS Code, Cursor, Windsurf, JetBrains, Neovim. Migrate and consolidate from current QUICKSTART.md IDE section.

- [ ] **Step 3: Write compliance-checking.md**

Paths 4-5: Core + Compliance. How to scan with legal mapping, understand the compliance matrix, use the compliance API standalone.

- [ ] **Step 4: Write full-dashboard.md**

Path 6: All services. Docker Compose quickstart, manual setup, admin configuration, user management.

- [ ] **Step 5: Write regulatory-monitoring.md**

Path 7: Monitor + Compliance. Setup, configure sources, interpret proposals, schedule scans.

- [ ] **Step 6: Commit**

```bash
git add docs/paths/
git commit -m "docs: add path-based guides for all 5 composition paths"
```

---

### Task 16: Consolidate MCP and CLI Reference Docs

**Files:**
- Create: `docs/reference/mcp-tools.md`
- Create: `docs/reference/cli-reference.md`
- Create: `docs/contributing/publish.md`

- [ ] **Step 1: Write mcp-tools.md**

All 20 MCP tools in one document, organized by package (Core: 6, Compliance: 11, Monitor: 3). For each: name, description, parameters, example.

- [ ] **Step 2: Write cli-reference.md**

All CLI commands across all 4 packages. For each: command, flags, examples, exit codes.

- [ ] **Step 3: Write publish.md**

Document the `scripts/publish.sh` workflow and npm publish process.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/mcp-tools.md docs/reference/cli-reference.md docs/contributing/publish.md
git commit -m "docs: add consolidated MCP tools, CLI reference, and publish guide"
```

---

### Task 17: Update README, CHANGELOG, and Root Docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/SECURITY-REVIEW.md`
- Modify: `.claude/skills/pally-agent/SKILL.md`
- Remove: old docs directories (after verifying no broken links)

- [ ] **Step 1: Rewrite README.md**

- Update version badge to v0.7.0
- Update test count to 813+
- Add architecture diagram including monitor package
- Replace documentation links with new path-based structure
- Add composition paths table as the primary navigation
- Fix `your-org` placeholder → `alanna82`
- Fix monitor env var names

- [ ] **Step 2: Update CHANGELOG.md**

- Add version history entry for v0.6.0
- Note the documentation restructure

- [ ] **Step 3: Fix SECURITY-REVIEW.md**

- Fix `keys:generate` → `keys generate` (line 53)
- Mark bcrypt finding as RESOLVED

- [ ] **Step 4: Update SKILL.md**

- Fix MCP path on line 224: `dist/mcp.js` → `packages/core/dist/mcp.js`
- Fix `--format json,html` → `--format both`
- Update test counts and version references

- [ ] **Step 5: Clean up old docs directories**

Remove directories that have been fully migrated:
```bash
rm -rf docs/installation docs/configuration docs/guides docs/integrations
```

Update any remaining cross-references.

- [ ] **Step 6: Run link check**

Verify no broken internal markdown links across all docs.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: update README, CHANGELOG, security review, and remove old doc structure"
```

---

### Task 18: Final Verification and Release

- [ ] **Step 1: Full build and test**

```bash
npm run build --workspaces && npm test --workspaces
```
Expected: All 813+ tests pass

- [ ] **Step 2: Verify all review findings resolved**

Check against the 4 review reports:
- System completeness: 2 critical, 3 important → all fixed
- Dead code: 1 critical, 16 removals → all fixed
- Scenario testing: 55 new tests → all passing
- Documentation: 3 critical, 8 important → all fixed

- [ ] **Step 3: Tag and push**

```bash
git tag v0.7.0
git push origin master --tags && git push trunten82 master --tags
```

- [ ] **Step 4: Create GitHub release**

Create a release on both remotes with release notes summarizing v0.7.0:
```bash
gh release create v0.7.0 --title "v0.7.0 — Composable Accessibility Platform" --notes "$(cat <<'EOF'
## What's New

### Code Fixes
- Added missing User and Client REST API routes to compliance service
- Fixed health endpoint path mismatch in dashboard
- Added webhook test endpoint
- Fixed K8s ingress rewrite-target breaking compliance API routing
- Removed dead code: orphaned DB adapters, unused deps, stale templates
- Made version strings dynamic (read from package.json)

### New Features
- `PALLY_COMPLIANCE_URL` env var for easier core→compliance integration
- Helpful error message when pa11y webservice is unreachable
- Report "next steps" hints for progressive discovery
- Monitor standalone mode with local config fallback
- Dashboard graceful degradation when compliance is unavailable

### Documentation Restructure
- Path-based guides: developer CLI, IDE integration, compliance checking, full dashboard, regulatory monitoring
- Getting started: overview, quick scan, one-line install
- Consolidated MCP tools and CLI reference
- Fixed all doc inaccuracies (env var names, versions, test counts)

**Full Changelog:** https://github.com/alanna82/pally-agent/compare/v0.6.0...v0.7.0
EOF
)"
```

- [ ] **Step 5: Update project memory**

Update `/root/.claude/projects/-root-pally-agent/memory/project_pally_ecosystem.md` with new test counts, version, and documentation structure.
