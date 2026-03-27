# Dashboard RBAC Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all RBAC permission, sidebar, plugin, and member management gaps so org owners/admins can properly manage their organizations.

**Architecture:** Update permission definitions, add new permissions (`admin.org`, `compliance.view`, `compliance.manage`), fix sidebar gating, fix plugin page rendering, scope dashboard-users and org-members routes by org context, add org-bound user creation. Migration 027 backfills all permission changes to existing DB data.

**Tech Stack:** TypeScript, Fastify, Handlebars, SQLite, HTMX, Vitest

**Parallelization:** Tasks 1-4 are independent and can be executed in parallel. Task 5 depends on Task 1. Tasks 6-7 depend on Tasks 1+3. Task 8 depends on all previous tasks.

---

### Task 1: Update permission definitions and add migration 027

**Files:**
- Modify: `packages/dashboard/src/permissions.ts`
- Modify: `packages/dashboard/src/db/sqlite/migrations.ts`
- Modify: `packages/dashboard/tests/auth/rbac.test.ts`

- [ ] **Step 1: Update ALL_PERMISSIONS array**

Add 3 new permissions to `packages/dashboard/src/permissions.ts`:

```typescript
// Add after { id: 'admin.plugins', ... }:
  { id: 'admin.org', label: 'Manage organization settings', group: 'Administration' },

// Add after { id: 'audit.view', ... }:
  { id: 'compliance.view', label: 'View compliance data', group: 'Compliance' },
  { id: 'compliance.manage', label: 'Manage compliance items', group: 'Compliance' },
```

- [ ] **Step 2: Update ORG_OWNER_PERMISSIONS**

Replace the entire array in `packages/dashboard/src/permissions.ts`:

```typescript
export const ORG_OWNER_PERMISSIONS: readonly string[] = [
  'scans.create',
  'scans.schedule',
  'reports.view',
  'reports.view_technical',
  'reports.export',
  'reports.delete',
  'reports.compare',
  'issues.assign',
  'issues.fix',
  'manual_testing',
  'repos.manage',
  'trends.view',
  'admin.roles',
  'admin.teams',
  'admin.org',
  'admin.plugins',
  'users.create',
  'compliance.view',
  'compliance.manage',
  'audit.view',
];
```

- [ ] **Step 3: Update ORG_ADMIN_PERMISSIONS**

Replace the entire array:

```typescript
export const ORG_ADMIN_PERMISSIONS: readonly string[] = [
  'scans.create',
  'scans.schedule',
  'reports.view',
  'reports.view_technical',
  'reports.export',
  'reports.delete',
  'reports.compare',
  'issues.assign',
  'issues.fix',
  'manual_testing',
  'repos.manage',
  'trends.view',
  'admin.plugins',
  'users.create',
  'compliance.view',
  'compliance.manage',
];
```

- [ ] **Step 4: Update ORG_MEMBER_PERMISSIONS**

```typescript
export const ORG_MEMBER_PERMISSIONS: readonly string[] = [
  'scans.create',
  'reports.view',
  'reports.view_technical',
  'reports.export',
  'reports.compare',
  'manual_testing',
  'trends.view',
  'compliance.view',
];
```

- [ ] **Step 5: Update ORG_VIEWER_PERMISSIONS**

```typescript
export const ORG_VIEWER_PERMISSIONS: readonly string[] = [
  'reports.view',
  'trends.view',
  'compliance.view',
];
```

- [ ] **Step 6: Add migration 027**

Add to `packages/dashboard/src/db/sqlite/migrations.ts` after migration 026:

```typescript
  {
    id: '027',
    name: 'add-org-compliance-permissions-update-roles',
    sql: `
-- 1. Add new permissions to system admin role
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('admin', 'admin.org');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('admin', 'compliance.view');
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('admin', 'compliance.manage');

-- 2. Add admin.org to org Owner roles
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'admin.org' FROM roles r WHERE r.name = 'Owner' AND r.org_id != 'system';

-- 3. Add users.create to org Owner and Admin roles
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'users.create' FROM roles r WHERE r.name IN ('Owner', 'Admin') AND r.org_id != 'system';

-- 4. Add compliance.view to ALL org roles
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'compliance.view' FROM roles r WHERE r.org_id != 'system';

-- 5. Add compliance.manage to org Owner and Admin roles
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'compliance.manage' FROM roles r WHERE r.name IN ('Owner', 'Admin') AND r.org_id != 'system';

-- 6. Promote Admin role: add missing operational permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, p.perm FROM roles r
  CROSS JOIN (
    SELECT 'repos.manage' AS perm UNION ALL
    SELECT 'issues.assign' UNION ALL
    SELECT 'issues.fix' UNION ALL
    SELECT 'scans.schedule' UNION ALL
    SELECT 'reports.delete'
  ) p
  WHERE r.name = 'Admin' AND r.org_id != 'system';

-- 7. Add compliance.view to Member and Viewer (they had limited perms)
-- (Already covered by step 4 above since it targets ALL org roles)

-- 8. Add reports.view_technical + manual_testing to Member role
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, p.perm FROM roles r
  CROSS JOIN (
    SELECT 'reports.view_technical' AS perm UNION ALL
    SELECT 'manual_testing'
  ) p
  WHERE r.name = 'Member' AND r.org_id != 'system';

-- 9. Add trends.view to Viewer role
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT r.id, 'trends.view' FROM roles r WHERE r.name = 'Viewer' AND r.org_id != 'system';
    `,
  },
```

- [ ] **Step 7: Update RBAC test admin permissions set**

In `packages/dashboard/tests/auth/rbac.test.ts`, update the `adminPermissions` set to include the 3 new permissions:

```typescript
    const adminPermissions = new Set([
      'scans.create', 'scans.schedule', 'reports.view', 'reports.view_technical',
      'reports.export', 'reports.delete', 'reports.compare', 'issues.assign', 'issues.fix',
      'manual_testing', 'repos.manage', 'trends.view', 'users.create', 'users.delete',
      'users.activate', 'users.reset_password', 'users.roles', 'admin.users', 'admin.roles',
      'admin.teams', 'admin.plugins', 'admin.org', 'admin.system', 'audit.view',
      'compliance.view', 'compliance.manage',
    ]);
```

- [ ] **Step 8: Run tests**

Run: `cd /root/luqen/packages/dashboard && npx tsc --noEmit && npx vitest run tests/auth/rbac.test.ts tests/db/roles.test.ts`

Expected: All tests pass, TSC clean.

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/src/permissions.ts packages/dashboard/src/db/sqlite/migrations.ts packages/dashboard/tests/auth/rbac.test.ts
git commit -m "feat: add admin.org, compliance.view/manage permissions + migration 027"
```

---

### Task 2: Fix sidebar visibility for all roles

**Files:**
- Modify: `packages/dashboard/src/server.ts` (perm flags)
- Modify: `packages/dashboard/src/views/partials/sidebar.hbs`

- [ ] **Step 1: Add new perm flags to server.ts**

In `packages/dashboard/src/server.ts`, find the `perm:` object inside the CSRF/i18n hook and add:

```typescript
          adminOrg: perms.has('admin.org') || perms.has('admin.system'),
          complianceView: perms.has('compliance.view') || perms.has('admin.system'),
          complianceManage: perms.has('compliance.manage') || perms.has('admin.system'),
```

- [ ] **Step 2: Update sidebar — compliance section**

In `packages/dashboard/src/views/partials/sidebar.hbs`, change the compliance section gate from:

```handlebars
    {{#if perm.adminSystem}}
    <span class="sidebar__section-label">{{t "nav.compliance"}}</span>
```

To:

```handlebars
    {{#if perm.complianceView}}
    <span class="sidebar__section-label">{{t "nav.compliance"}}</span>
```

Keep all the compliance links (jurisdictions, regulations, etc.) inside this block — they're now visible to anyone with `compliance.view`.

- [ ] **Step 3: Update sidebar — org detail link for org owners**

After the Teams link (inside `{{#if perm.adminTeams}}`), add an org detail link for org owners. Add before the `{{/if}}` closing of the User Management section:

```handlebars
    {{#if perm.adminOrg}}
    <a class="sidebar__item {{#if (startsWith currentPath '/admin/organizations')}}is-active{{/if}}"
       href="/admin/organizations/{{orgContext.currentOrg.id}}/members"
       aria-current="{{#if (startsWith currentPath '/admin/organizations')}}page{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3 3h14a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V5a2 2 0 012-2z" stroke="currentColor" stroke-width="1.5"/>
        <path d="M7 10a2 2 0 100-4 2 2 0 000 4zM13 8h3M13 11h3M4 14c0-1.5 1.5-3 3-3s3 1.5 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      {{t "nav.myOrganization"}}
    </a>
    {{/if}}
```

- [ ] **Step 4: Update sidebar — OAuth Clients for org owners**

Move the OAuth Clients link out of the `perm.adminSystem` block. Change its gate to show for org owners/admins too:

Find the OAuth Clients link (currently inside `usersManageAny` block) and wrap it with:

```handlebars
    {{#if perm.complianceManage}}
    <a class="sidebar__item {{#if (startsWith currentPath '/admin/clients')}}is-active{{/if}}"
       href="/admin/clients">
      ...existing SVG...
      {{t "nav.oauthClients"}}
    </a>
    {{/if}}
```

- [ ] **Step 5: Add i18n key for "My Organization"**

Add to all 6 locale files (`packages/dashboard/src/i18n/locales/{en,it,de,es,fr,pt}.json`):

```json
"myOrganization": "My Organization"
```

(With appropriate translations for each locale.)

- [ ] **Step 6: Run tests**

Run: `cd /root/luqen/packages/dashboard && npx tsc --noEmit`

Expected: TSC clean.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/server.ts packages/dashboard/src/views/partials/sidebar.hbs packages/dashboard/src/i18n/locales/
git commit -m "feat: sidebar visibility — compliance for all, org detail for owners, OAuth for admins"
```

---

### Task 3: Fix plugin page — available section, tab switching, install permissions

**Files:**
- Modify: `packages/dashboard/src/views/admin/plugins.hbs`
- Modify: `packages/dashboard/src/routes/admin/plugins.ts`

- [ ] **Step 1: Pass canInstallPlugins flag from route**

In `packages/dashboard/src/routes/admin/plugins.ts`, in the GET `/admin/plugins` handler, add to the `reply.view()` data:

```typescript
        canInstallPlugins: isAdmin || perms.has('admin.plugins'),
```

Where `perms` is read from the request:

```typescript
      const perms = (request as unknown as Record<string, unknown>)['permissions'] as Set<string> | undefined ?? new Set<string>();
```

Add this line after `const isAdmin = ...`.

- [ ] **Step 2: Fix available plugins gate in template**

In `packages/dashboard/src/views/admin/plugins.hbs`, change line 106 from:

```handlebars
    {{#if isAdmin}}
```

To:

```handlebars
    {{#if canInstallPlugins}}
```

- [ ] **Step 3: Fix tab switching — replace inline JS with data-action**

In `packages/dashboard/src/views/admin/plugins.hbs`, replace both tab buttons (lines 12-21) with:

```handlebars
  <div class="rpt-tabs" role="tablist" id="plugins-tabs">
    <button role="tab" class="rpt-tab rpt-tab--active" id="tab-global-plugins"
            aria-controls="panel-global-plugins" aria-selected="true"
            data-action="switch-tab" data-target-show="panel-global-plugins" data-target-hide="panel-org-plugins"
            data-peer="tab-org-plugins">
      Global Plugins
    </button>
    <button role="tab" class="rpt-tab" id="tab-org-plugins"
            aria-controls="panel-org-plugins" aria-selected="false"
            data-action="switch-tab" data-target-show="panel-org-plugins" data-target-hide="panel-global-plugins"
            data-peer="tab-global-plugins">
      Org Plugins{{#if orgName}} ({{orgName}}){{/if}}
    </button>
  </div>
```

- [ ] **Step 4: Add tab switching event delegation to main layout**

In `packages/dashboard/src/views/layouts/main.hbs`, add inside the existing `<script>` block (the one with `htmx:configRequest`):

```javascript
document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action="switch-tab"]');
  if (!btn) return;
  var showId = btn.getAttribute('data-target-show');
  var hideId = btn.getAttribute('data-target-hide');
  var peerId = btn.getAttribute('data-peer');
  var showEl = document.getElementById(showId);
  var hideEl = document.getElementById(hideId);
  var peerEl = document.getElementById(peerId);
  if (showEl) showEl.classList.remove('rpt-tab-panel--hidden');
  if (hideEl) hideEl.classList.add('rpt-tab-panel--hidden');
  btn.classList.add('rpt-tab--active');
  btn.setAttribute('aria-selected', 'true');
  if (peerEl) {
    peerEl.classList.remove('rpt-tab--active');
    peerEl.setAttribute('aria-selected', 'false');
  }
});
```

- [ ] **Step 5: Also fix roles.hbs tab switching (same CSP issue)**

Check `packages/dashboard/src/views/admin/roles.hbs` for `hx-on::after-request` and replace with the same `data-action="switch-tab"` pattern.

- [ ] **Step 6: Run tests**

Run: `cd /root/luqen/packages/dashboard && npx tsc --noEmit`

Expected: TSC clean.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/views/admin/plugins.hbs packages/dashboard/src/routes/admin/plugins.ts packages/dashboard/src/views/layouts/main.hbs packages/dashboard/src/views/admin/roles.hbs
git commit -m "fix: plugin page — show catalogue to org owners, fix CSP tab switching"
```

---

### Task 4: Scope org member routes for org owners

**Files:**
- Modify: `packages/dashboard/src/routes/admin/organizations.ts`
- Modify: `packages/dashboard/tests/routes/organizations.test.ts`

- [ ] **Step 1: Change permission on member routes**

In `packages/dashboard/src/routes/admin/organizations.ts`, change ALL instances of:

```typescript
{ preHandler: requirePermission('admin.system') }
```

on the member management routes (GET members, POST add-to-team, POST move-team, POST remove) to:

```typescript
{ preHandler: requirePermission('admin.system', 'admin.org') }
```

- [ ] **Step 2: Add tenant isolation to member routes**

After each route fetches the org, add a check that non-admin users can only access their own org:

```typescript
      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).send({ error: 'Forbidden: you can only manage your own organization' });
      }
```

Add this right after the org existence check in each of the 4 member routes.

- [ ] **Step 3: Update tests**

In `packages/dashboard/tests/routes/organizations.test.ts`, the test server setup uses `createTestServer()` which likely sets `admin.system` permission. Verify the tests pass with the new permission OR logic.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/routes/organizations.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/routes/admin/organizations.ts packages/dashboard/tests/routes/organizations.test.ts
git commit -m "feat: org owners can manage their own org members (admin.org permission)"
```

---

### Task 5: Scope dashboard-users page by org

**Files:**
- Modify: `packages/dashboard/src/routes/admin/dashboard-users.ts`
- Modify: `packages/dashboard/src/db/interfaces/user-repository.ts` (if needed)
- Modify: `packages/dashboard/src/db/sqlite/repositories/user-repository.ts`

- [ ] **Step 1: Add getOrgScopedUsers method to user repository**

In `packages/dashboard/src/db/sqlite/repositories/user-repository.ts`, add:

```typescript
  /**
   * List users visible to an org context:
   * - Users in any team belonging to the specified org
   * - Unbound users (not in any team for any org)
   */
  async listUsersForOrg(orgId: string): Promise<DashboardUser[]> {
    const rows = this.db.prepare(`
      SELECT DISTINCT du.* FROM dashboard_users du
      WHERE du.id IN (
        -- Users in this org's teams
        SELECT tm.user_id FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        WHERE t.org_id = ?
      )
      OR du.id NOT IN (
        -- Unbound users (not in ANY team)
        SELECT DISTINCT tm2.user_id FROM team_members tm2
      )
      ORDER BY du.username
    `).all(orgId) as UserRow[];
    return rows.map(userRowToRecord);
  }
```

Add to the interface in `packages/dashboard/src/db/interfaces/user-repository.ts`:

```typescript
  listUsersForOrg(orgId: string): Promise<DashboardUser[]>;
```

- [ ] **Step 2: Update dashboard-users route to scope by org**

In `packages/dashboard/src/routes/admin/dashboard-users.ts`, change the GET handler:

```typescript
      const isAdmin = request.user?.role === 'admin';
      const orgId = request.user?.currentOrgId;

      const users = isAdmin
        ? await storage.users.listUsers()
        : orgId
          ? await storage.users.listUsersForOrg(orgId)
          : await storage.users.listUsers();
```

- [ ] **Step 3: Run tests**

Run: `npx tsc --noEmit && npx vitest run tests/routes/admin-dashboard-users.test.ts`

Expected: TSC clean, tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/routes/admin/dashboard-users.ts packages/dashboard/src/db/sqlite/repositories/user-repository.ts packages/dashboard/src/db/interfaces/user-repository.ts
git commit -m "feat: dashboard-users page scoped by org for non-admin users"
```

---

### Task 6: Org-bound user creation for org owners/admins

**Files:**
- Modify: `packages/dashboard/src/routes/admin/dashboard-users.ts`
- Modify: `packages/dashboard/src/views/admin/dashboard-users.hbs` (or user creation form)

- [ ] **Step 1: Update user creation route**

In the POST route for creating users (`/admin/dashboard-users`), after creating the user, if the creator is not a global admin, auto-add the new user to the creator's org:

```typescript
      // If creator is org owner/admin (not global admin), bind user to their org
      const isAdmin = request.user?.role === 'admin';
      const orgId = request.user?.currentOrgId;
      if (!isAdmin && orgId && orgId !== 'system') {
        // Find the "Direct Members" or "Members" team for this org
        const orgTeams = await storage.teams.listTeamsByOrgId(orgId);
        const memberTeam = orgTeams.find(t => t.name === 'Direct Members' || t.name === 'Members');
        if (memberTeam) {
          await storage.teams.addTeamMember(memberTeam.id, newUser.id);
        }
      }
```

- [ ] **Step 2: Run tests**

Run: `npx tsc --noEmit && npx vitest run tests/routes/admin-dashboard-users.test.ts`

Expected: TSC clean, tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/routes/admin/dashboard-users.ts
git commit -m "feat: org owners/admins create users bound to their org"
```

---

### Task 7: Fix available users list for org team assignment

**Files:**
- Modify: `packages/dashboard/src/routes/admin/organizations.ts`

- [ ] **Step 1: Scope available users in member page**

In the GET `/admin/organizations/:id/members` handler, change the available users logic. Currently it shows all active users. Change to:

```typescript
      // Available users: unbound (not in any team) + already in this org
      const isAdmin = request.user?.role === 'admin';
      const allUsers = (await storage.users.listUsers()).filter((u) => u.active);

      if (isAdmin) {
        // Admin sees all users not already in any of this org's teams
        const memberIds = new Set(allMembers.map((m) => m.userId));
        const availableUsers = allUsers.filter((u) => !memberIds.has(u.id));
      } else {
        // Org owner sees: unbound users + users already in this org (for team moves)
        const orgScopedUsers = await storage.users.listUsersForOrg(id);
        const memberIds = new Set(allMembers.map((m) => m.userId));
        const availableUsers = orgScopedUsers.filter((u) => u.active && !memberIds.has(u.id));
      }
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/routes/organizations.test.ts`

Expected: Tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/routes/admin/organizations.ts
git commit -m "feat: scope available users for org team assignment (unbound + own org)"
```

---

### Task 8: Full integration test + final verification

**Files:**
- No new files

- [ ] **Step 1: Run full TypeScript check**

Run: `cd /root/luqen/packages/dashboard && npx tsc --noEmit`

Expected: Zero errors.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run tests/db tests/auth tests/routes/admin tests/routes/teams.test.ts tests/routes/roles.test.ts tests/routes/organizations.test.ts tests/plugins tests/services tests/integration`

Expected: All tests pass.

- [ ] **Step 3: Commit any test fixes needed**

- [ ] **Step 4: Push and merge**

```bash
git push origin develop
gh pr create --base master --head develop --title "feat: RBAC v2.0 — permissions, sidebar, plugins, org management" --body "..."
gh pr merge <number> --merge
```

---

## Parallelization Guide

```
          ┌─── Task 1 (permissions + migration) ───┐
          │                                          │
Start ────├─── Task 2 (sidebar visibility) ──────────├─── Task 5 (scoped users) ──┐
          │                                          │                              │
          ├─── Task 3 (plugin page fixes) ───────────├─── Task 6 (org-bound users) ├── Task 8 (verify)
          │                                          │                              │
          └─── Task 4 (org member routes) ───────────└─── Task 7 (available users) ┘
```

Tasks 1-4: fully parallel (no file conflicts)
Tasks 5-7: depend on Task 1 (new permissions) + Task 3/4 (route changes)
Task 8: final verification after all tasks complete

---

## Out of Scope (Plan 2: Compliance Multi-Tenancy)

The following items from the spec are deferred to a separate plan:
- Compliance service `tenant_id` columns and migrations
- OAuth scope-based tenant isolation (`tenant:<id>`)
- Auto-create compliance tenant on org creation
- Per-org compliance OAuth client management
- Documentation and installer updates
