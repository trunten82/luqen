# Plugin System & Multi-Tenancy Design

**Date:** 2026-03-20
**Status:** Draft
**Author:** trunten82 + Claude

## Problem Statement

Luqen-agent currently has a single deployment model: install everything, configure services manually, authenticate via OAuth2 client credentials. This works for developers but creates friction for two important scenarios:

1. **Solo/small team use** — Too much setup for someone who just wants to scan and report. OAuth2 client credentials is overkill.
2. **Enterprise deployment** — No organization isolation, no SSO, no centralized user management. Not viable for multi-team or multi-client use.

The platform needs to scale from a single developer running locally to an enterprise deployment with SSO, org isolation, and extensibility — without requiring different architectures or codebases.

## Design Goals

1. **One app, progressive capability** — Features activate based on what you configure, not what you pay for. No tiers, no license keys.
2. **Plugin system** — Extensible architecture supporting auth providers, notification channels, storage backends, and scanner extensions.
3. **Marketplace UX** — Admins discover, install, configure, and manage plugins through the dashboard UI without touching config files.
4. **Code-manageable** — Plugins also manageable via CLI, REST API, and declarative config file for automation and GitOps.
5. **Multi-tenancy** — Org-level data isolation that activates only when orgs are created, transparent in single-user mode.

## Non-Goals

- Hosted plugin registry (static JSON file is sufficient initially)
- Paid tiers or feature gating
- Third-party plugin development SDK (internal plugins first)
- Schema-per-org database isolation (query-level filtering is sufficient)

## Progressive Capability Model

There are no tiers. The app progressively gains capability based on configuration:

| State | Auth | Users | Data | Activates When |
|-------|------|-------|------|----------------|
| **Fresh install** | API key (auto-generated) | Single implicit user | All shared | Default |
| **Users added** | Username/password + API key | Multiple users with roles | Shared, role-based access | Admin creates first user |
| **SSO plugin installed** | SSO + local users + API key | Multiple users, multiple orgs | Org-isolated | Admin installs and configures SSO plugin |

Each state is additive — nothing breaks when capability grows. Solo API key keeps working alongside local users alongside SSO.

## Plugin System Architecture

### Plugin Package Structure

A plugin is a standard npm package with a manifest:

```
@luqen/plugin-auth-entra/
  package.json
  manifest.json         # metadata + config schema
  dist/
    index.js            # exports: activate, deactivate, healthCheck
```

### Plugin Manifest

```json
{
  "name": "auth-entra",
  "displayName": "Azure Entra ID",
  "type": "auth",
  "version": "1.0.0",
  "description": "Single sign-on via Azure Entra ID (formerly Azure AD)",
  "icon": "entra.svg",
  "configSchema": [
    { "key": "tenantId", "label": "Tenant ID", "type": "string", "required": true },
    { "key": "clientId", "label": "Client ID", "type": "string", "required": true },
    { "key": "clientSecret", "label": "Client Secret", "type": "secret", "required": true },
    { "key": "redirectUri", "label": "Redirect URI", "type": "string", "default": "/auth/callback" }
  ]
}
```

### Plugin Types

Four plugin categories, each with a typed interface:

**Auth plugins** — Provide authentication strategies:
```typescript
interface AuthPlugin {
  readonly type: 'auth';
  authenticate(request: FastifyRequest): Promise<AuthResult>;
  getLoginUrl?(): string;
  handleCallback?(request: FastifyRequest): Promise<AuthResult>;
  getUserInfo?(token: string): Promise<UserInfo>;
  getLogoutUrl?(returnTo?: string): string;
  refreshToken?(token: string): Promise<AuthResult>;
}
```

**Notification plugins** — Deliver alerts on events (scan complete, violation found, regulation changed):
```typescript
interface NotificationPlugin {
  readonly type: 'notification';
  send(event: LuqenEvent): Promise<void>;
}
```

**Storage plugins** — Alternative report/data storage (S3, Azure Blob):
```typescript
interface StoragePlugin {
  readonly type: 'storage';
  save(key: string, data: Uint8Array): Promise<string>;
  load(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
```

**Scanner plugins** — Custom WCAG rules or industry-specific checks:
```typescript
interface ScannerPlugin {
  readonly type: 'scanner';
  readonly rules: readonly WcagRule[];
  evaluate(page: PageResult): Promise<Issue[]>;
}
```

### Plugin Lifecycle

1. **Discover** — Dashboard shows available plugins from registry
2. **Install** — `npm install` to `<data-dir>/plugins/` directory
3. **Configure** — Admin fills config form (rendered from `configSchema`)
4. **Activate** — Plugin starts, registers capabilities
5. **Monitor** — Health checks, status visible in admin UI
6. **Update/Remove** — Version management, clean deactivation

### Plugin Manager

New module in the dashboard package: `PluginManager` class.

**Responsibilities:**
- Discover available plugins from registry
- Install/uninstall npm packages to plugins directory
- Store plugin config in SQLite `plugins` table
- Auto-activate plugins with `status = 'active'` on startup
- Provide health check aggregation
- Expose plugin capabilities to the rest of the app

**Database schema:**
```sql
CREATE TABLE plugins (
  id TEXT PRIMARY KEY,           -- slug derived from manifest name (e.g., 'auth-entra')
  package_name TEXT NOT NULL,    -- npm package (e.g., '@luqen/plugin-auth-entra')
  type TEXT NOT NULL,
  version TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',  -- secrets encrypted with AES-256-GCM
  status TEXT NOT NULL DEFAULT 'inactive',  -- inactive|active|error|install-failed|unhealthy
  installed_at TEXT NOT NULL,
  activated_at TEXT,
  error TEXT                     -- last error message if status is error/install-failed
);
```

The `id` is the short slug used in CLI and API paths. The `package_name` is the full npm package name for install/update.

**Plugin registry:** A static `plugin-registry.json` file listing official plugins with name, type, version, npm package name, description, and icon URL. Initially bundled in the repo. Later could be hosted.

### Four Management Interfaces

**1. Dashboard UI:**
Settings → Plugins page with installed plugins, available plugins, install/configure/activate controls.

**2. CLI:**
```bash
luqen-dashboard plugin install @luqen/plugin-auth-entra
luqen-dashboard plugin configure auth-entra --set tenantId=xxx
luqen-dashboard plugin activate auth-entra
luqen-dashboard plugin list
luqen-dashboard plugin remove auth-entra
```

**3. REST API:**
```
GET    /api/plugins
POST   /api/plugins/install
PATCH  /api/plugins/:id/config
POST   /api/plugins/:id/activate
POST   /api/plugins/:id/deactivate
DELETE /api/plugins/:id
GET    /api/plugins/:id/health
GET    /api/plugins/registry
```

**4. Config file** (`luqen-plugins.json`):
```json
{
  "plugins": [
    {
      "name": "@luqen/plugin-auth-entra",
      "config": { "tenantId": "...", "clientId": "..." },
      "active": true
    }
  ]
}
```

On startup, the plugin manager reconciles: installs missing plugins, applies config, activates. This supports GitOps workflows.

All four interfaces use the same `PluginManager` underneath.

## Plugin Security and Reliability

**Install isolation:** Plugins run in-process (same Node.js runtime as the dashboard). Sandboxing is out of scope for initial release. Only official plugins from the registry are installable — no arbitrary npm packages.

**Install failure handling:** Plugin install uses `npm install --save-exact` with pinned versions only (no ranges). If install fails, the `plugins` table entry remains `status = 'install-failed'` with the error message. No partial state — either the package is fully installed or the entry is marked failed.

**Activation rollback:** If `activate()` throws, the plugin is set to `status = 'error'` with the error stored. The dashboard continues running. Admin can retry activation or remove the plugin.

**Health check behavior:** Health checks run on a 60-second interval. Three consecutive failures set the plugin to `status = 'unhealthy'` (informational, not auto-deactivated). Admin is notified via the dashboard UI. Auto-deactivation is opt-in via plugin manifest `"autoDeactivateOnFailure": true`.

**Secret storage:** Config values with `"type": "secret"` in the manifest are encrypted at rest using AES-256-GCM with the dashboard's session secret as the encryption key. Decrypted only when passed to `activate()`. Never returned in API responses — masked as `"***"`.

**Config file secrets:** The `luqen-plugins.json` config file supports environment variable references for secrets: `"clientSecret": "${ENTRA_CLIENT_SECRET}"`. The plugin manager resolves these at startup. Plain secrets in the config file are accepted but a warning is logged recommending env var references. The config file should be in `.gitignore`.

## Auth Migration Strategy

**Current state:** The dashboard authenticates by calling the compliance service's OAuth2 token endpoint (`POST /api/v1/oauth/token`). Users and OAuth clients live in the compliance service's database. The dashboard decodes JWTs issued by the compliance service.

**Target state:** The dashboard becomes self-sufficient for auth. It manages its own users, sessions, and API keys. The compliance service is no longer required for authentication.

**Migration approach:**

1. **Solo mode (API key):** Dashboard generates and stores an API key in its own database. No JWT, no compliance service needed. The `authGuard` middleware accepts either a valid session cookie OR an `Authorization: Bearer <api-key>` header.

2. **Team mode (local users):** Dashboard gets its own `users` table (migrated from compliance service pattern). Password hashing uses bcrypt (same as compliance). The dashboard issues its own JWTs (signed with its session secret) for session management. The compliance service is called with a service-level API key for data access, not user tokens.

3. **SSO mode (auth plugin):** The auth plugin handles the OAuth2/OIDC flow and returns a `UserInfo` object. The dashboard creates/updates a local user record and issues a session JWT.

**Compliance service access:** In all modes, the dashboard uses a **service-level API key** to communicate with the compliance service (configured via `DASHBOARD_COMPLIANCE_API_KEY`). This replaces the current per-user token forwarding. The compliance service gains a simple API key auth option alongside its existing OAuth2.

**Backward compatibility:** Existing compliance-service users are NOT automatically migrated. The migration is a clean break — the first user created in the dashboard is the new admin. This avoids cross-database sync complexity.

## Dashboard API Architecture

The dashboard currently serves only HTML pages. The plugin system and future extensibility require JSON API endpoints.

**Route namespace:** Plugin API routes live at `/api/v1/plugins/*` (consistent with compliance service versioning).

**Auth middleware update:** The existing `authGuard` is updated to detect JSON API requests (via `Accept: application/json` header or `/api/` path prefix) and return `401 JSON` instead of redirecting to `/login`. API key auth works for all `/api/*` routes.

**Future API surface:** This establishes the pattern for a full dashboard REST API if needed later (e.g., `/api/v1/scans/*`, `/api/v1/reports/*`).

## Auth Progression

### Solo (default — fresh install)

- No plugin required, built-in behavior
- On first start, generates a random 32-byte API key, prints to console
- Dashboard protected by API key (entered once, stored in browser cookie)
- No user management UI visible in sidebar
- All data shared under implicit `system` user
- API key works for programmatic access (CLI, MCP, integrations)

### Team (activates when first user is created)

- Built-in `auth-local` capability (refactored from current OAuth2 auth)
- Admin clicks "Add Users" in Settings → creates first admin account
- API key auth continues to work for programmatic access
- User management UI appears in sidebar
- Roles: viewer, user, admin
- All data shared across users, filtered by role permissions

### Enterprise (activates when SSO plugin installed)

- Admin installs SSO plugin (e.g., `@luqen/plugin-auth-entra`) via marketplace
- Configures tenant ID, client ID, etc. via dashboard form
- SSO becomes primary auth method for browser users
- Org management UI appears when first org is created
- Data isolated per org
- Local users and API keys continue to work (for service accounts)

## Multi-Tenancy

### Activation Model

Org isolation activates only when the first org is created — which only happens after an SSO plugin is configured. Until then, all data lives under `orgId = 'system'` and multi-tenancy is invisible.

### Database Changes (Query-Level Isolation)

Add `orgId TEXT NOT NULL DEFAULT 'system'` column to:

**Dashboard:**
- `scan_records` — scans belong to an org

**Compliance:**
- `jurisdictions` — global (`system`) + org-specific
- `regulations` — global (`system`) + org-specific
- `requirements` — global (`system`) + org-specific
- `update_proposals` — per-org
- `monitored_sources` — global (`system`) + org-specific
- `webhooks` — per-org
- `users` — per-org (org membership)
- `oauth_clients` — per-org

New tables (in the **dashboard** database — the dashboard owns org management):
```sql
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE org_members (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
```

**Cross-service org awareness:** The dashboard passes `orgId` to the compliance service via an `X-Org-Id` HTTP header on every request. The compliance service reads this header and applies org scoping to queries. The compliance service does NOT own or manage orgs — it trusts the dashboard's header (validated by the service-level API key).

**Org deletion cascade:** When an org is deleted from the dashboard, the dashboard: (1) deletes its own org-scoped scan records, (2) calls `DELETE /api/v1/orgs/:id/data` on the compliance service to clean up org-scoped compliance data.

**API key org context:** For programmatic API access (no session), the org is specified via `X-Org-Id` header. API keys can be scoped to a specific org or be org-agnostic (system-level).

### Database Migration Framework

A simple sequential migration system is introduced in Phase 1 as a prerequisite:
- Migrations are numbered SQL files: `001-initial.sql`, `002-add-orgid.sql`
- A `schema_migrations` table tracks which migrations have run
- On startup, the app runs any pending migrations
- Both dashboard and compliance service use this pattern

### Query Scoping

Every query includes `WHERE orgId = ?`. In single-user mode, this is always `'system'` — transparent and zero-cost.

For compliance data (hybrid model):
- `WHERE orgId IN ('system', ?)` — user sees global + their org's custom data
- Global data is read-only to orgs
- Only system admins can modify global data

### Org Management

- System admin creates orgs and assigns users (admin-provisioned, as decided earlier)
- Users can belong to multiple orgs, switch between them
- Session stores `currentOrgId`
- Scan data belongs to the org, survives user removal
- Dashboard shows org switcher in header when multiple orgs exist

### Monitor in Multi-Tenant Context

Hybrid model: global sources for shared regulations + orgs can add custom sources.
- Sources with `orgId = 'system'` are global (scanned for all)
- When changes detected in global sources, proposals created for all affected orgs
- Org-specific sources only generate proposals for that org

## Implementation Phases

### Phase 1: Plugin System Foundation (~2-3 weeks)

Build the plugin framework with no actual plugins:
- Database migration framework (prerequisite for all future schema changes)
- Plugin type interfaces (auth, notification, storage, scanner)
- `PluginManager` class (discover, install, configure, activate, deactivate, health)
- Database table for plugins (with encrypted secret storage)
- Plugin registry (static JSON)
- Dashboard API architecture (JSON endpoints at `/api/v1/plugins/*`, updated auth middleware)
- Dashboard Settings → Plugins page (marketplace UI)
- CLI commands (`luqen-dashboard plugin install/configure/activate/list/remove`)
- REST API endpoints for plugin management
- Config file support (`luqen-plugins.json` with env var substitution for secrets)
- Health check polling (60s interval, 3-failure threshold)
- Tests for plugin manager lifecycle

### Phase 2: Auth Progression (~2 weeks)

Refactor auth and build the first auth plugin:
- Refactor current auth into built-in `auth-local` module
- Solo mode: API key generation on first start, browser cookie auth
- Team mode: progressive activation when first user created
- Build `@luqen/plugin-auth-entra` (Azure Entra ID SSO)
- Auth plugin integration with PluginManager
- Tests for auth flow transitions

### Phase 3a: Multi-Tenancy — Schema & Query Scoping (~2 weeks)

Database foundation:
- Database migration framework (sequential SQL files + schema_migrations table)
- Add `orgId` column to all tables with migrations
- `organizations` and `org_members` tables in dashboard DB
- Update dashboard `ScanDb` with org-scoped CRUD
- Update compliance `DbAdapter` interface — add `orgId` parameter to all methods
- Update compliance SQLite adapter implementation
- Compliance service reads `X-Org-Id` header for org context
- `DELETE /api/v1/orgs/:id/data` cleanup endpoint on compliance
- Tests for query scoping and org isolation

### Phase 3b: Multi-Tenancy — UI & Integration (~2 weeks)

User-facing features:
- Org management dashboard pages (create, list, members)
- Org switcher in dashboard header
- Hybrid compliance data (global `system` + org-specific queries)
- Monitor multi-tenant: global sources create proposals for all orgs, org sources are private
- API key org scoping (`X-Org-Id` header)
- Tests for UI flows and cross-service integration

### Phase 4: First Non-Auth Plugin (~1 week)

Prove the plugin system works beyond auth:
- `@luqen/plugin-notify-slack` or `plugin-notify-teams`
- Sends notifications on scan complete, violations found
- Validates the notification plugin interface

### Documentation Updates (continuous — after each phase)

Each phase includes documentation as a deliverable, not an afterthought. Guides must be updated before the phase is considered complete.

**After Phase 1 (Plugin System):**
- Update `docs/getting-started/what-is-luqen.md` — add plugin system to architecture overview
- Update `docs/paths/full-dashboard.md` — add Settings → Plugins section
- Update `docs/reference/cli-reference.md` — add `luqen-dashboard plugin *` commands
- Update `docs/reference/api-reference.md` — add `/api/v1/plugins/*` endpoints
- Create `docs/reference/plugin-development.md` — manifest format, type interfaces, config schema
- Update `README.md` — mention plugin extensibility

**After Phase 2 (Auth Progression):**
- Update `docs/getting-started/quick-scan.md` — document API key auth (printed on first start)
- Update `docs/paths/full-dashboard.md` — document progressive auth (solo → team → SSO)
- Create `docs/paths/enterprise-sso.md` — new path guide for SSO setup (Entra ID walkthrough)
- Update `docs/reference/dashboard-config.md` — document new auth config options
- Update `docs/deployment/docker.md` and `docs/deployment/kubernetes.md` — auth configuration in production

**After Phase 3a+3b (Multi-Tenancy):**
- Create `docs/paths/multi-tenant.md` — new path guide for org setup and management
- Update `docs/paths/full-dashboard.md` — add org management section
- Update `docs/reference/api-reference.md` — document `X-Org-Id` header, org management endpoints
- Update `docs/reference/compliance-config.md` — document org-aware query behavior
- Update `docs/deployment/kubernetes.md` — multi-tenant production recommendations

**After Phase 4 (Notification Plugin):**
- Create `docs/paths/notifications.md` — guide for setting up Slack/Teams alerts
- Update `docs/reference/plugin-development.md` — add notification plugin example

**CHANGELOG and SKILL.md** are updated at the end of each phase with version bump.

## Success Criteria

1. Fresh install works with zero configuration — API key printed, dashboard accessible
2. Adding a user via Settings activates user management without restart
3. Installing a plugin via dashboard UI works end-to-end (discover → install → configure → activate)
4. Plugins manageable via CLI, API, and config file with identical results
5. SSO plugin (Entra ID) handles full login flow
6. Org isolation: users in different orgs cannot see each other's scans
7. Global compliance data visible to all orgs, org-specific data is private
8. Existing single-user installs unaffected by multi-tenancy code (zero behavior change)
9. All existing tests continue to pass
10. Plugin health checks visible in admin UI
11. Every new feature has a corresponding guide or reference doc update
12. A new user can follow any path guide end-to-end without hitting undocumented steps

## Out of Scope

- Hosted plugin registry
- Third-party plugin development SDK
- Billing, plans, or usage limits
- Schema-per-org database isolation
- Self-service org creation (admin-provisioned only)
- Plugin sandboxing or security isolation
