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

### Org Owner (has `admin.teams`, `admin.roles`, `admin.org`)
- Teams
- Roles
- Organizations (own org detail only, NOT org list)
- Audit Log

### Global Admin only (`admin.system`)
- Organizations (full list + create)
- System Health
- OAuth Clients, API Users, API Keys

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

Root cause investigation needed on live DB:
- Verify `plugins` table has `org_id` column with default 'system'
- Verify existing plugin rows have `org_id = 'system'`
- The query `WHERE org_id = @orgId OR org_id = 'system'` should return system plugins for any org context

## Compliance Org-Scoping

- Compliance sidebar section: gate with `perm.complianceView` (not `perm.adminSystem`)
- Compliance API calls from dashboard: pass org context (orgId) to scope data
- Compliance data (jurisdictions, regulations) scoped per org
- Org owners/admins can create org-specific compliance items
- Global admin can create system-wide compliance items

## Data Migrations Required

### Migration 027: Add new permissions and update role definitions
1. Add `admin.org`, `compliance.view`, `compliance.manage` to `ALL_PERMISSIONS`
2. Add `users.create` to org Owner and Admin role permissions
3. Add `compliance.view` to all org roles (Owner/Admin/Member/Viewer)
4. Add `compliance.manage` to Owner and Admin
5. Add `admin.org` to Owner only
6. Update Admin permissions: add `repos.manage`, `issues.assign`, `issues.fix`, `scans.schedule`, `reports.delete`
7. Add these permissions to system admin role too

### Code changes required
1. Update `ORG_OWNER_PERMISSIONS` and `ORG_ADMIN_PERMISSIONS` in permissions.ts
2. Update sidebar template: compliance section uses `perm.complianceView`
3. Update org member routes: accept `admin.org` permission
4. Update dashboard-users route: scope user list by org
5. Add org owner link to their org detail page
6. Add user creation flow for org owners/admins
7. Fix plugin list rendering
8. Pass org context to compliance API calls
