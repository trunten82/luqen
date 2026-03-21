# Phase 2: Auth Progression — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor authentication into a progressive system — Solo (API key, default), Team (local users), Enterprise (SSO plugin) — where each mode activates based on configuration, not code changes.

**Architecture:** The dashboard becomes self-sufficient for auth. A new `AuthService` abstraction sits between the auth middleware and the actual auth providers (API key, local password, SSO plugins). The compliance service gains a simple API key auth option for service-to-service calls. The first SSO plugin (`@luqen/plugin-auth-entra`) proves the auth plugin interface works end-to-end.

**Tech Stack:** TypeScript, Fastify 5, better-sqlite3, jose, bcrypt, @azure/msal-node (for Entra plugin)

**Spec:** `docs/superpowers/specs/2026-03-20-plugin-system-multitenancy-design.md` (Phase 2 + Auth sections)

---

## File Structure

### New files:

```
packages/dashboard/src/
  auth/
    auth-service.ts            # Central auth abstraction — delegates to providers
    api-key.ts                 # API key generation, validation, storage
  db/
    users.ts                   # Dashboard users table + CRUD (bcrypt passwords, roles)

packages/dashboard/tests/
  auth/
    auth-service.test.ts
    api-key.test.ts

packages/plugins/auth-entra/   # New package: @luqen/plugin-auth-entra
  package.json
  manifest.json
  tsconfig.json
  src/
    index.ts                   # Plugin entry — exports activate/deactivate/healthCheck
    entra-provider.ts          # MSAL-based Entra ID auth logic
  tests/
    entra-provider.test.ts
```

### Files to modify:

```
packages/dashboard/src/
  auth/middleware.ts            # Delegate to AuthService instead of direct JWT decode
  routes/auth.ts               # Support API key, local, and SSO login flows
  views/login.hbs              # Show SSO buttons when auth plugins active
  server.ts                    # Initialize AuthService, pass to routes
  config.ts                    # Remove complianceClientId/Secret (replaced by service API key)
  db/scans.ts                  # Add users table migration (003)
```

---

## Task 1: Dashboard Users Table

Move user management into the dashboard's own database (currently users live only in compliance service).

**Files:**
- Create: `packages/dashboard/src/db/users.ts`
- Modify: `packages/dashboard/src/db/scans.ts` (add migration 003)
- Test: `packages/dashboard/tests/db/users.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/db/users.test.ts`:
- createUser: creates user with hashed password, returns user without hash
- createUser: rejects duplicate username
- getUserByUsername: returns user or null
- getUserById: returns user or null
- verifyPassword: returns true for correct password, false for wrong
- listUsers: returns all users
- updateUserRole: changes role
- deactivateUser: sets active=false
- countUsers: returns total count (used to detect Solo→Team transition)

- [ ] **Step 2: Add migration 003**

In `packages/dashboard/src/db/scans.ts`, add to DASHBOARD_MIGRATIONS:
```typescript
{
  id: '003',
  name: 'create-users',
  sql: `
    CREATE TABLE IF NOT EXISTS dashboard_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_users_username ON dashboard_users(username);
  `,
},
```

Note: table is `dashboard_users` (not `users`) to avoid confusion with the compliance service's `users` table.

- [ ] **Step 3: Implement UserDb**

Create `packages/dashboard/src/db/users.ts`:
- `UserDb` class wrapping better-sqlite3
- Uses bcrypt for password hashing (add `bcrypt` to dashboard dependencies)
- `createUser(username, password, role)` — hash password, insert, return user (without hash)
- `getUserByUsername(username)` — returns DashboardUser | null
- `getUserById(id)` — returns DashboardUser | null
- `verifyPassword(username, password)` — lookup + bcrypt.compare
- `listUsers()` — returns all users (without hashes)
- `updateUserRole(id, role)` — update role
- `deactivateUser(id)` — set active=0
- `countUsers()` — returns number (used to detect if team mode is active)

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add dashboard users table and UserDb for local auth"
```

---

## Task 2: API Key Auth

Generate an API key on first start, validate it for API and browser requests.

**Files:**
- Create: `packages/dashboard/src/auth/api-key.ts`
- Test: `packages/dashboard/tests/auth/api-key.test.ts`
- Modify: `packages/dashboard/src/db/scans.ts` (add migration 004 for api_keys table)

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/auth/api-key.test.ts`:
- generateApiKey: returns 32-byte hex string
- storeApiKey: saves hashed key to database
- validateApiKey: returns true for valid key
- validateApiKey: returns false for invalid key
- getOrCreateApiKey: returns existing key if one exists
- getOrCreateApiKey: creates and prints new key on first run
- apiKeyCount: returns number of active keys

- [ ] **Step 2: Add migration 004**

```typescript
{
  id: '004',
  name: 'create-api-keys',
  sql: `
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'default',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);
  `,
},
```

- [ ] **Step 3: Implement api-key module**

Create `packages/dashboard/src/auth/api-key.ts`:
- `generateApiKey()` — crypto.randomBytes(32).toString('hex')
- `hashApiKey(key)` — SHA-256 hash (fast, since API keys are high-entropy)
- `storeApiKey(db, key, label)` — insert hashed key
- `validateApiKey(db, key)` — hash input, look up in table
- `getOrCreateApiKey(db)` — if no active keys exist, generate one, store it, return plaintext (logged to console on first start)
- `revokeAllKeys(db)` — set all keys to `active=0` (used before generating new key)
- `updateLastUsed(db, id)` — touch last_used_at
- `validateApiKey` only checks keys where `active=1`

The CLI `api-key` command revokes all previous keys before generating a new one.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add API key generation and validation for solo auth mode"
```

---

## Task 3: AuthService — Central Auth Abstraction

Single point that decides how to authenticate a request based on current state.

**Files:**
- Create: `packages/dashboard/src/auth/auth-service.ts`
- Test: `packages/dashboard/tests/auth/auth-service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/dashboard/tests/auth/auth-service.test.ts`:
- getAuthMode: returns 'solo' when no users exist
- getAuthMode: returns 'team' when users exist but no SSO plugin
- getAuthMode: returns 'enterprise' when SSO plugin is active
- authenticateRequest (solo): validates API key from Authorization header
- authenticateRequest (solo): validates API key from session cookie
- authenticateRequest (team): validates username/password via local UserDb
- authenticateRequest (team): also accepts API key
- authenticateRequest (enterprise): delegates to auth plugin
- authenticateRequest (enterprise): also accepts API key and local password
- getLoginMethods: returns available login methods based on mode
- createSession: stores auth result in session

- [ ] **Step 2: Implement AuthService**

Create `packages/dashboard/src/auth/auth-service.ts`:

```typescript
import type Database from 'better-sqlite3';
import type { PluginManager } from '../plugins/manager.js';
import type { AuthPlugin, AuthResult } from '../plugins/types.js';

export type AuthMode = 'solo' | 'team' | 'enterprise';

export interface LoginMethod {
  readonly type: 'api-key' | 'password' | 'sso';
  readonly label: string;
  readonly pluginId?: string;
  readonly loginUrl?: string;
}

export class AuthService {
  constructor(
    db: Database.Database,
    pluginManager: PluginManager,
  );

  // Detect current mode based on state
  getAuthMode(): AuthMode;

  // Available login methods for the login page
  getLoginMethods(): LoginMethod[];

  // Authenticate a request (tries API key first, then session, then plugin)
  // Session strategy: keep @fastify/secure-session for browser sessions.
  // No dashboard-issued JWTs needed — session cookie IS the token.
  // The session stores { userId, username, role, authMethod } instead of compliance JWT.
  async authenticateRequest(request: FastifyRequest): Promise<AuthResult>;

  // Password-based login (team mode)
  async loginWithPassword(username: string, password: string): Promise<AuthResult>;

  // SSO callback (enterprise mode)
  async handleSsoCallback(pluginId: string, request: FastifyRequest): Promise<AuthResult>;
}
```

Key logic in `getAuthMode()`:
- Count users in `dashboard_users`: if 0 → 'solo'
- Check active auth plugins via `pluginManager.getActivePluginsByType('auth')`: if any → 'enterprise'
- Otherwise → 'team'

Key logic in `authenticateRequest()`:
1. Check `Authorization: Bearer <key>` header → validate as API key
2. Check session token → validate as JWT or session
3. If enterprise: delegate to active auth plugin
4. Return AuthResult

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add AuthService abstraction for progressive auth modes"
```

---

## Task 4: Refactor Auth Middleware

Replace direct JWT decode with AuthService delegation.

**Files:**
- Modify: `packages/dashboard/src/auth/middleware.ts`
- Modify: `packages/dashboard/src/server.ts` (pass AuthService to middleware)
- Test: update existing auth tests

- [ ] **Step 1: Update authGuard to use AuthService**

Modify `packages/dashboard/src/auth/middleware.ts`:

The `authGuard` function now receives `AuthService` via Fastify decoration or closure:

```typescript
export function createAuthGuard(authService: AuthService) {
  return async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const isApiRequest = request.url.startsWith('/api/');

    const result = await authService.authenticateRequest(request);

    if (!result.authenticated) {
      if (isApiRequest) {
        await reply.code(401).send({ error: result.error ?? 'Authentication required' });
        return;
      }
      await reply.redirect('/login');
      return;
    }

    request.user = {
      id: result.user!.id,
      username: result.user!.username,
      role: result.user!.role ?? 'viewer',
    };
  };
}
```

Keep `adminGuard` and `requireRole` unchanged.

**skipAuth handling:** The global auth hook in server.ts checks `isPublicPath()`. Add SSO callback and login paths to PUBLIC_PATHS:
```typescript
const PUBLIC_PATHS = new Set(['/login', '/health']);
// Also skip: /auth/callback/* and /auth/sso/*
function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith('/static/')) return true;
  if (path.startsWith('/auth/callback/')) return true;
  if (path.startsWith('/auth/sso/')) return true;
  return false;
}
```

This replaces the per-route `skipAuth` config pattern (which doesn't actually work with Fastify global hooks).

- [ ] **Step 2: Update server.ts**

In `packages/dashboard/src/server.ts`:
- Create AuthService after PluginManager init
- Use `createAuthGuard(authService)` for the global hook
- Pass AuthService to auth routes

- [ ] **Step 3: Update auth tests**

Update existing middleware tests to mock AuthService instead of session tokens.

- [ ] **Step 4: Run all dashboard tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: delegate auth middleware to AuthService for progressive auth"
```

---

## Task 5: Refactor Login Routes

Support all three auth modes in the login flow.

**Files:**
- Modify: `packages/dashboard/src/routes/auth.ts`
- Modify: `packages/dashboard/src/views/login.hbs`

- [ ] **Step 1: Update login route**

In `packages/dashboard/src/routes/auth.ts`:

**GET /login:**
- Get `authService.getAuthMode()` and `authService.getLoginMethods()`
- Pass to template: `{ mode, loginMethods }`
- In solo mode: show API key input form
- In team mode: show username/password form (current behavior)
- In enterprise mode: show SSO buttons + optional password form

**POST /login:**
- Solo: validate API key, create session
- Team: call `authService.loginWithPassword(username, password)`, create session
- Enterprise: handled via SSO redirect, not POST

**GET /auth/callback/:pluginId:**
- New route for SSO callback
- Call `authService.handleSsoCallback(pluginId, request)`
- On success: create session, redirect to /
- On failure: redirect to /login with error

**GET /auth/sso/:pluginId:**
- Redirect to SSO provider's login URL via auth plugin

- [ ] **Step 2: Update login.hbs**

Add conditional rendering:
- Solo mode: "Enter your API key" form with single field
- Team mode: username/password form (current)
- Enterprise mode: SSO buttons (one per active auth plugin) + optional "Or sign in with password" form

- [ ] **Step 3: Run dashboard tests**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: support progressive auth modes in login flow (solo/team/SSO)"
```

---

## Task 6: Solo Mode — First Start Experience

On first dashboard start with no users, generate and display an API key.

**Files:**
- Modify: `packages/dashboard/src/server.ts`
- Modify: `packages/dashboard/src/cli.ts`

- [ ] **Step 1: Add first-start API key generation**

In `packages/dashboard/src/server.ts`, after AuthService init:

```typescript
const authMode = authService.getAuthMode();
if (authMode === 'solo') {
  const { key, isNew } = await getOrCreateApiKey(db.getDatabase());
  if (isNew) {
    server.log.info('');
    server.log.info('=== PALLY DASHBOARD ===');
    server.log.info(`API Key: ${key}`);
    server.log.info('Save this key — it won\'t be shown again.');
    server.log.info('Use it to access the dashboard or API.');
    server.log.info('');
  }
}
```

- [ ] **Step 2: Add API key regenerate CLI command**

In `packages/dashboard/src/cli.ts`, add:
```typescript
program
  .command('api-key')
  .description('Generate a new API key')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    // Generate new key, store it, print it
  });
```

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: generate and display API key on first dashboard start (solo mode)"
```

---

## Task 7: Team Mode — "Add Users" Activation

When admin creates the first user via Settings, team mode activates.

**Files:**
- Create: `packages/dashboard/src/routes/admin/dashboard-users.ts`
- Create: `packages/dashboard/src/views/admin/dashboard-users.hbs`
- Modify: `packages/dashboard/src/views/partials/sidebar.hbs`
- Modify: `packages/dashboard/src/server.ts`

- [ ] **Step 1: Create dashboard users admin route**

Create `packages/dashboard/src/routes/admin/dashboard-users.ts`:
- `GET /admin/dashboard-users` — list local users
- `GET /admin/dashboard-users/new` — create user form
- `POST /admin/dashboard-users` — create user (username, password, role)
- `PATCH /admin/dashboard-users/:id/role` — update role
- `POST /admin/dashboard-users/:id/deactivate` — deactivate user
- All use `adminGuard`

Follow the pattern from existing admin routes (HTMX fragments, toast notifications).

**CSRF protection:** All POST/PATCH/DELETE routes are protected by `sameSite: 'strict'` session cookies (set in `auth/session.ts`). HTMX requests include `hx-request: true` header which provides additional origin validation. This matches the existing CSRF strategy used by all other admin routes.

- [ ] **Step 2: Create users admin template**

Create `packages/dashboard/src/views/admin/dashboard-users.hbs`:
- Users table with username, role, status, actions
- "Add User" button/form
- Role dropdown (viewer/user/admin)

- [ ] **Step 3: Update sidebar**

Show "Dashboard Users" link in admin section only when `authMode !== 'solo'` (pass authMode to template data).

- [ ] **Step 4: Register route in server.ts**

- [ ] **Step 5: Test and commit**

```bash
git commit -m "feat: add dashboard user management for team auth mode"
```

---

## Task 8: Compliance Service API Key Auth

Add simple API key authentication to the compliance service for service-to-service calls.

**Files:**
- Modify: `packages/compliance/src/api/routes/oauth.ts` (add API key validation)
- Modify: `packages/compliance/src/auth/middleware.ts` (accept API key alongside JWT)
- Test: `packages/compliance/tests/api/api-key-auth.test.ts`

- [ ] **Step 1: Write failing tests**

- Request with `Authorization: Bearer <api-key>` where key matches `COMPLIANCE_API_KEY` env var returns 200
- Request with wrong API key returns 401
- Existing JWT auth still works
- API key grants admin scope

- [ ] **Step 2: Add API key support to compliance auth**

In compliance auth middleware, check for API key before JWT:
```typescript
import { timingSafeEqual } from 'node:crypto';

const apiKey = process.env['COMPLIANCE_API_KEY'];
if (apiKey && authHeader) {
  const expected = Buffer.from(`Bearer ${apiKey}`);
  const received = Buffer.from(authHeader);
  if (expected.length === received.length && timingSafeEqual(expected, received)) {
    // Grant admin scope, set request.user
    return;
  }
}
// Fall through to JWT validation
```

- [ ] **Step 3: Run all compliance tests**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add API key auth to compliance service for service-to-service calls"
```

---

## Task 9: Build Entra ID SSO Plugin

The first auth plugin — Azure Entra ID SSO via OIDC.

**Files:**
- Create: `packages/plugins/auth-entra/` (new package)

- [ ] **Step 1: Create package structure**

```
packages/plugins/auth-entra/
  package.json          # @luqen/plugin-auth-entra
  manifest.json         # Plugin manifest with configSchema
  tsconfig.json
  src/
    index.ts            # Plugin entry
    entra-provider.ts   # MSAL OIDC logic
  tests/
    entra-provider.test.ts
```

**manifest.json:**
```json
{
  "name": "auth-entra",
  "displayName": "Azure Entra ID",
  "type": "auth",
  "version": "1.0.0",
  "description": "Single sign-on via Azure Entra ID (formerly Azure AD)",
  "configSchema": [
    { "key": "tenantId", "label": "Tenant ID", "type": "string", "required": true },
    { "key": "clientId", "label": "Application (Client) ID", "type": "string", "required": true },
    { "key": "clientSecret", "label": "Client Secret", "type": "secret", "required": true },
    { "key": "redirectUri", "label": "Redirect URI", "type": "string", "default": "/auth/callback/auth-entra" }
  ]
}
```

- [ ] **Step 2: Write tests**

Create `packages/plugins/auth-entra/tests/entra-provider.test.ts`:
- getLoginUrl returns valid Entra authorization URL
- handleCallback exchanges code for token (mock MSAL)
- getUserInfo extracts claims from ID token
- getLogoutUrl returns Entra logout URL
- healthCheck verifies tenant is reachable
- activate validates required config fields
- deactivate cleans up MSAL client

- [ ] **Step 3: Implement plugin**

`src/index.ts` — exports plugin factory that returns AuthPlugin:
```typescript
export default function createPlugin(): AuthPlugin {
  return {
    manifest,
    async activate(config) { /* init MSAL ConfidentialClientApplication */ },
    async deactivate() { /* cleanup */ },
    async healthCheck() { /* check Entra endpoint */ },
    async authenticate(request) { /* check session/token */ },
    getLoginUrl() { /* MSAL auth code URL */ },
    async handleCallback(request) { /* exchange code, return AuthResult */ },
    async getUserInfo(token) { /* decode ID token claims */ },
    getLogoutUrl(returnTo) { /* Entra logout URL */ },
  };
}
```

Use `@azure/msal-node` for OIDC flow (ConfidentialClientApplication).

- [ ] **Step 4: Build and test**

```bash
cd packages/plugins/auth-entra && npm test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add @luqen/plugin-auth-entra — Azure Entra ID SSO plugin"
```

---

## Task 10: Phase 2 Documentation

**Files to update:**
- `docs/getting-started/quick-scan.md` — document API key on first start
- `docs/paths/full-dashboard.md` — document progressive auth modes
- Create: `docs/paths/enterprise-sso.md` — Entra ID setup walkthrough
- `docs/reference/dashboard-config.md` — new auth config
- `docs/reference/cli-reference.md` — api-key command
- `CHANGELOG.md` — v0.9.0 entry
- `.claude/skills/luqen/SKILL.md` — update

- [ ] **Step 1: Update existing docs**
- [ ] **Step 2: Create enterprise-sso.md path guide**
- [ ] **Step 3: Update CHANGELOG and SKILL.md**
- [ ] **Step 4: Commit**

```bash
git commit -m "docs: add progressive auth and SSO documentation"
```

---

## Task 11: Final Verification + Release

- [ ] **Step 1: Full build and test**

```bash
npm run build --workspaces && npm test --workspaces
```

- [ ] **Step 2: Tag and push**

```bash
git tag v0.9.0
git push origin master --tags && git push trunten82 master --tags
```

- [ ] **Step 3: Create GitHub releases**

- [ ] **Step 4: Update project memory**
