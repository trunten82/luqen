# RBAC v2.0 — Corrected Design Spec

**Date:** 2026-03-27
**Status:** Approved (brainstorming session)

## Overview

The RBAC system has three layers:
1. **Global admin** — system-wide access, creates unbound users
2. **Org-scoped roles** — Owner/Admin/Member/Viewer per org
3. **Team-based membership** — users belong to teams, teams carry roles

## Organizational Structure

```
Organization
  ├── Team A (role: Owner)
  │   ├── User 1
  │   └── User 2
  ├── Team B (role: Admin)
  │   └── User 3
  └── Team C (role: Member)
      ├── User 4
      └── User 5
```

- One org can have multiple teams
- Each team has one org-scoped role
- A user can be in multiple teams across different orgs
- Effective permissions = global role UNION highest org role across all teams in that org

## Permission Definitions

### New Permissions (to add)

| ID | Label | Group |
|----|-------|-------|
| `admin.org` | Manage organization settings | Administration |
| `compliance.view` | View compliance data | Compliance |
| `compliance.manage` | Manage compliance items | Compliance |

### Role → Permission Matrix

| Permission | Owner | Admin | Member | Viewer |
|------------|-------|-------|--------|--------|
| `scans.create` | Yes | Yes | Yes | No |
| `scans.schedule` | Yes | Yes | No | No |
| `reports.view` | Yes | Yes | Yes | Yes |
| `reports.view_technical` | Yes | Yes | Yes | No |
| `reports.export` | Yes | Yes | Yes | No |
| `reports.delete` | Yes | Yes | No | No |
| `reports.compare` | Yes | Yes | Yes | No |
| `issues.assign` | Yes | Yes | No | No |
| `issues.fix` | Yes | Yes | No | No |
| `manual_testing` | Yes | Yes | Yes | No |
| `repos.manage` | Yes | Yes | No | No |
| `trends.view` | Yes | Yes | Yes | Yes |
| `admin.roles` | Yes | No | No | No |
| `admin.teams` | Yes | No | No | No |
| `admin.org` | Yes | No | No | No |
| `admin.plugins` | Yes | Yes | No | No |
| `users.create` | Yes | Yes | No | No |
| `compliance.view` | Yes | Yes | Yes | Yes |
| `compliance.manage` | Yes | Yes | No | No |
| `audit.view` | Yes | No | No | No |

### Global Admin

Global admin (`dashboard_users.role = 'admin'`) bypasses all org checks and gets `ALL_PERMISSION_IDS`.

## User Creation Model

### Global admin creates user
- Inserts into `dashboard_users`
- No org binding — user is "unbound"
- Visible to all orgs when adding to teams

### Org owner/admin creates user
- Inserts into `dashboard_users`
- Automatically added to a team in the creating org (e.g., the default "Members" team)
- User is "bound" to the org through team membership
- Two-step flow: create user first, then assign to specific team

### Available users for team assignment
When an org owner/admin adds users to a team, they see:
- Unbound users (not in any team for any org)
- Users already in the current org (for moving between teams)
- NOT users bound exclusively to other orgs

## Sidebar Visibility

### All authenticated users
- Home, Reports, Trends (with org context filtering)

### Org Member+ (has `scans.create`)
- New Scan, Schedules (if `scans.schedule`), Bookmarklet

### Org Viewer+ (has `compliance.view`)
- Jurisdictions, Regulations, Proposals, Sources, Monitor (read-only)

### Org Admin+ (has `admin.plugins`, `users.create`)
- Plugin Config
- Dashboard Users (scoped: unbound + own org users)
- OAuth Clients (scoped: own org's compliance clients)

### Org Owner (has `admin.teams`, `admin.roles`, `admin.org`)
- Teams
- Roles
- Organizations (own org detail only, NOT org list)
- OAuth Clients (scoped: own org's compliance clients)
- Audit Log

### Global Admin only (`admin.system`)
- Organizations (full list + create)
- System Health
- API Users, API Keys
- OAuth Clients (all clients, all orgs)

## Org Member Management

### Permission changes
- `/admin/organizations/:id/members` routes: change from `requirePermission('admin.system')` to `requirePermission('admin.org', 'admin.system')`
- Org owners access their own org detail via a direct link (not the org list page)
- Non-admin users are restricted to their own org (tenant isolation check)

### User list scoping
- The "Dashboard Users" page (`/admin/dashboard-users`) must scope the user list:
  - Global admin: sees all users
  - Org owner/admin: sees unbound users + users in their org's teams

## Plugin List Fix

Current issue: plugin page shows empty for org owners.

The query `WHERE org_id = @orgId OR org_id = 'system'` should return system plugins for any org context. Migration 021 added `org_id TEXT NOT NULL DEFAULT 'system'` to the plugins table, so existing plugins should have `org_id = 'system'`.

Root causes identified:
1. **Available plugins section gated by `isAdmin`** — plugins.hbs line 106: `{{#if isAdmin}}` hides the catalogue from org owners. They can see installed plugins but not install new ones. Fix: show available plugins to anyone with `admin.plugins` permission.
2. **Tab switching uses `hx-on::after-request`** — inline JS blocked by CSP. Tabs don't switch. Fix: replace with global event delegation (same pattern used elsewhere in the codebase).
3. **No plugins installed** — if no plugins are in the DB, both Global and Org panels are empty. The Available section (catalogue) is the only useful content, but it's hidden from org owners (see #1).

Fix approach:
1. Change `{{#if isAdmin}}` to a permission check (pass `canInstallPlugins` flag from route)
2. Replace `hx-on::after-request` with data-action event delegation for tab switching
3. Verify on live DB that schema is correct (confirmed: `org_id TEXT DEFAULT 'system'` exists)

## Compliance Multi-Tenancy

### Architecture

The compliance service gets lightweight multi-tenancy independent of dashboard orgs.

```
Compliance Service
  ├── System data (tenant_id = NULL)
  │   ├── Jurisdictions (EU, US, UK, ...)
  │   ├── Regulations (WCAG 2.1, EN 301 549, ...)
  │   └── Synced to all tenants, read-only for tenants
  │
  └── Tenant data (tenant_id = specific)
      ├── Custom jurisdictions (org-specific regulatory contexts)
      ├── Custom regulations (internal standards)
      └── Visible only to that tenant
```

### OAuth Client Model

| Client type | Scope | View system data | Create system data | View tenant data | Create tenant data |
|-------------|-------|-----------------|-------------------|-----------------|-------------------|
| System admin | `admin` | Yes | Yes | All tenants | No (must specify tenant) |
| Tenant client | `tenant:<id>` | Yes | No | Own tenant only | Yes |
| Read-only | `read` | Yes | No | No | No |

### Compliance Service Changes (packages/compliance)

1. **OAuth clients table**: add `tenant_id` column (nullable)
2. **Data tables**: add `tenant_id` column to jurisdictions, regulations, proposals, sources
   - `tenant_id = NULL` → system-level (shared, read-only for tenants)
   - `tenant_id = <value>` → tenant-specific (writable by that tenant)
3. **Token validation**: extract tenant context from OAuth scope
   - `scope: admin` → no tenant filter, full write access
   - `scope: tenant:xxx` → filter by tenant_id, write only to own tenant
   - `scope: read` → no tenant filter, read-only
4. **Query behavior**: `WHERE tenant_id IS NULL OR tenant_id = @tenantId`
   - Tenant clients see system data + their own tenant data
   - System data is always read-only for tenant clients
5. **Write behavior**: tenant clients can only INSERT/UPDATE/DELETE rows where `tenant_id = @tenantId`

### Dashboard ↔ Compliance Integration

1. **Org → Tenant mapping**: when a dashboard org is created, auto-create a compliance tenant and OAuth client
   - Store the compliance `client_id`/`client_secret` and `tenant_id` in the org record or a linking table
2. **API calls**: dashboard uses the org's compliance client for org-scoped calls
   - System-level calls (sync, global admin) use the system admin client
3. **OAuth Clients page**: org owners/admins can view and manage their org's compliance clients
   - Create additional clients (for external tools like n8n)
   - View credentials (show client_id, mask secret)
   - Regenerate secrets
   - Delete clients

### External Tool Access

External tools (n8n, scripts, third-party integrations):
- Get their own tenant-scoped OAuth client from the org owner
- Can view all system data (jurisdictions, regulations)
- Can create/modify custom compliance items for their tenant only
- Cannot modify system-level data
- Cannot see other tenants' data

### Dashboard UI Changes

- Compliance sidebar section: gate with `perm.complianceView` (not `perm.adminSystem`)
- All compliance pages show system data (read-only) + tenant data (editable if `compliance.manage`)
- Create/edit forms: new items are always scoped to the user's org/tenant
- System items show a "system" badge and are not editable by org users
- OAuth Clients page: org owners see their org's clients, global admin sees all

## Data Migrations Required

### Dashboard — Migration 027: Add new permissions and update role definitions
1. Add `admin.org`, `compliance.view`, `compliance.manage` to `ALL_PERMISSIONS`
2. Add `users.create` to org Owner and Admin role permissions
3. Add `compliance.view` to all org roles (Owner/Admin/Member/Viewer)
4. Add `compliance.manage` to Owner and Admin
5. Add `admin.org` to Owner only
6. Update Admin permissions: add `repos.manage`, `issues.assign`, `issues.fix`, `scans.schedule`, `reports.delete`
7. Add these permissions to system admin role too

### Compliance — Migration: Add tenant support
1. Add `tenant_id` column to OAuth clients table (nullable)
2. Add `tenant_id` column to jurisdictions, regulations, proposals, sources tables (nullable, default NULL = system)
3. Add index on `tenant_id` for all affected tables
4. Existing data remains system-level (tenant_id = NULL)

## Code Changes Required

### Dashboard (packages/dashboard)
1. Update `ORG_OWNER_PERMISSIONS` and `ORG_ADMIN_PERMISSIONS` in permissions.ts
2. Update sidebar template: compliance section uses `perm.complianceView`, OAuth clients visible to org owners
3. Update org member routes: accept `admin.org` permission
4. Update dashboard-users route: scope user list by org
5. Add org owner link to their org detail page in sidebar
6. Add user creation flow for org owners/admins (bound to org)
7. Fix plugin list rendering
8. Auto-create compliance tenant + OAuth client on org creation
9. Use org's compliance client for org-scoped API calls
10. OAuth Clients page: scope by org for non-admin users

### Compliance (packages/compliance)
1. Add `tenant_id` to data tables and OAuth clients
2. Update token validation to extract tenant from scope
3. Update all query endpoints to filter by tenant
4. Update all write endpoints to enforce tenant isolation
5. Add `tenant:<id>` scope type to OAuth client creation
6. System data (tenant_id=NULL) is read-only for tenant-scoped clients

### Documentation
1. Update README with RBAC model (org → team → role hierarchy)
2. Update API documentation with tenant-scoped endpoints
3. Document OAuth client types (admin, tenant, read-only) and their access levels
4. Update compliance module documentation with multi-tenancy model
5. Add org owner/admin guide (creating users, managing teams, plugin config)

### Installation Scripts
1. Update installer wizard to create initial org + system OAuth client
2. Installer creates default admin user + first org with Owner team
3. Update `dashboard.config.json` schema — remove single `complianceClientId`/`complianceClientSecret`, replace with per-org client management
4. Update systemd service templates if env vars change
5. Update Docker Compose / Dockerfile if compliance config changes
6. Migration guide for existing installations (pre-v2.0 → v2.0)
