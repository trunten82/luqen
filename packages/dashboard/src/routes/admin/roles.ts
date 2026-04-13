import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../../db/index.js';
import { hasPermission, getPermissionGroups, ALL_PERMISSION_IDS, DEFAULT_ORG_ROLES } from '../../permissions.js';
import { toastHtml, escapeHtml } from './helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateRoleBody {
  readonly name?: string;
  readonly description?: string;
  readonly permissions?: string | string[];
  readonly _csrf?: string;
}

interface UpdateRoleBody {
  readonly name?: string;
  readonly description?: string;
  readonly permissions?: string | string[];
  readonly _csrf?: string;
}

// ---------------------------------------------------------------------------
// Default org role names (cannot be deleted)
// ---------------------------------------------------------------------------

const DEFAULT_ORG_ROLE_NAMES = new Set(DEFAULT_ORG_ROLES.map((r) => r.name));

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

function requireRolesRead(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!hasPermission(request, 'admin.roles')) {
    reply.code(403).send({ error: 'Forbidden: admin.roles permission required' });
    return false;
  }
  return true;
}

/** Check if user can manage roles for a given scope. */
function canManageRoles(request: FastifyRequest, roleOrgId: string): boolean {
  const isAdmin = request.user?.role === 'admin';
  if (isAdmin) return true;

  // Org owner/admin can manage their org's roles
  const userOrgId = request.user?.currentOrgId;
  if (roleOrgId !== 'system' && userOrgId === roleOrgId && hasPermission(request, 'admin.roles')) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Parse permissions helper
// ---------------------------------------------------------------------------

function parsePermissions(rawPerms: string | string[] | undefined): string[] {
  return Array.isArray(rawPerms)
    ? rawPerms.filter((p) => ALL_PERMISSION_IDS.includes(p))
    : typeof rawPerms === 'string'
      ? [rawPerms].filter((p) => ALL_PERMISSION_IDS.includes(p))
      : [];
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function roleRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  const permissionGroups = getPermissionGroups();

  // ── GET /admin/roles — tabbed view: Global Roles + Org Roles ──────

  server.get(
    '/admin/roles',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireRolesRead(request, reply)) return;

      const isAdmin = request.user?.role === 'admin';
      const orgId = request.user?.currentOrgId ?? 'system';
      const hasOrgContext = orgId !== 'system';

      // Fetch global (system) roles
      const globalRoles = await storage.roles.listGlobalRoles();
      const globalView = globalRoles.map((r) => ({
        ...r,
        permissionCount: r.permissions.length,
        systemBadge: r.isSystem,
        canDelete: !r.isSystem && isAdmin,
        canEdit: isAdmin,
      }));

      // Fetch org-scoped roles (if user has an org context)
      let orgRoles: typeof globalView = [];
      let orgName: string | null = null;
      if (hasOrgContext) {
        const rawOrgRoles = await storage.roles.listOrgRoles(orgId);
        const canManageOrg = canManageRoles(request, orgId);
        orgRoles = rawOrgRoles.map((r) => ({
          ...r,
          permissionCount: r.permissions.length,
          systemBadge: r.isSystem,
          canDelete: canManageOrg && !DEFAULT_ORG_ROLE_NAMES.has(r.name),
          canEdit: canManageOrg,
        }));
        const org = await storage.organizations.getOrg(orgId);
        orgName = org?.name ?? orgId;
      }

      // Admin sees all orgs' roles if no specific org context
      if (isAdmin && !hasOrgContext) {
        const allOrgs = await storage.organizations.listOrgs();
        for (const org of allOrgs) {
          const rawOrgRoles = await storage.roles.listOrgRoles(org.id);
          const mapped = rawOrgRoles.map((r) => ({
            ...r,
            permissionCount: r.permissions.length,
            systemBadge: r.isSystem,
            canDelete: !DEFAULT_ORG_ROLE_NAMES.has(r.name),
            canEdit: true,
            orgName: org.name,
          }));
          orgRoles = orgRoles.concat(mapped);
        }
      }

      const canCreateGlobal = isAdmin;
      const canCreateOrg = hasOrgContext && canManageRoles(request, orgId);

      return reply.view('admin/roles.hbs', {
        pageTitle: 'Roles Management',
        currentPath: '/admin/roles',
        user: request.user,
        globalRoles: globalView,
        orgRoles,
        hasGlobalRoles: globalRoles.length > 0,
        hasOrgRoles: orgRoles.length > 0,
        hasOrgContext,
        orgName,
        canCreateGlobal,
        canCreateOrg,
        isAdmin,
      });
    },
  );

  // ── GET /admin/roles/global — HTMX partial for global roles tab ───

  server.get(
    '/admin/roles/global',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireRolesRead(request, reply)) return;

      const isAdmin = request.user?.role === 'admin';
      const globalRoles = await storage.roles.listGlobalRoles();
      const globalView = globalRoles.map((r) => ({
        ...r,
        permissionCount: r.permissions.length,
        systemBadge: r.isSystem,
        canDelete: !r.isSystem && isAdmin,
        canEdit: isAdmin,
      }));

      return reply.view('admin/roles-global-panel.hbs', {
        globalRoles: globalView,
        hasGlobalRoles: globalRoles.length > 0,
        canCreateGlobal: isAdmin,
        isAdmin,
        user: request.user,
      });
    },
  );

  // ── GET /admin/roles/org — HTMX partial for org roles tab ─────────

  server.get(
    '/admin/roles/org',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireRolesRead(request, reply)) return;

      const isAdmin = request.user?.role === 'admin';
      const orgId = request.user?.currentOrgId ?? 'system';
      const hasOrgContext = orgId !== 'system';

      let orgRoles: Array<{
        id: string;
        name: string;
        description: string;
        isSystem: boolean;
        orgId: string;
        createdAt: string;
        permissions: readonly string[];
        permissionCount: number;
        systemBadge: boolean;
        canDelete: boolean;
        canEdit: boolean;
      }> = [];
      let orgName: string | null = null;

      if (hasOrgContext) {
        const rawOrgRoles = await storage.roles.listOrgRoles(orgId);
        const canManageOrg = canManageRoles(request, orgId);
        orgRoles = rawOrgRoles.map((r) => ({
          ...r,
          permissionCount: r.permissions.length,
          systemBadge: r.isSystem,
          canDelete: canManageOrg && !DEFAULT_ORG_ROLE_NAMES.has(r.name),
          canEdit: canManageOrg,
        }));
        const org = await storage.organizations.getOrg(orgId);
        orgName = org?.name ?? orgId;
      } else if (isAdmin) {
        const allOrgs = await storage.organizations.listOrgs();
        for (const org of allOrgs) {
          const rawOrgRoles = await storage.roles.listOrgRoles(org.id);
          const mapped = rawOrgRoles.map((r) => ({
            ...r,
            permissionCount: r.permissions.length,
            systemBadge: r.isSystem,
            canDelete: !DEFAULT_ORG_ROLE_NAMES.has(r.name),
            canEdit: true,
            orgName: org.name,
          }));
          orgRoles = orgRoles.concat(mapped);
        }
      }

      const canCreateOrg = hasOrgContext && canManageRoles(request, orgId);

      return reply.view('admin/roles-org-panel.hbs', {
        orgRoles,
        hasOrgRoles: orgRoles.length > 0,
        hasOrgContext,
        orgName,
        canCreateOrg,
        isAdmin,
        user: request.user,
      });
    },
  );

  // ── GET /admin/roles/new — new role form ────────────────────────────

  server.get(
    '/admin/roles/new',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireRolesRead(request, reply)) return;

      const query = request.query as { scope?: string };
      const scope = query.scope ?? 'org';
      const orgId = request.user?.currentOrgId ?? 'system';
      const isAdmin = request.user?.role === 'admin';

      // Only admin can create global roles
      if (scope === 'global' && !isAdmin) {
        return reply.code(403).send({ error: 'Forbidden: only admins can create global roles' });
      }

      // Must have org context or be admin to create org roles
      if (scope === 'org' && orgId === 'system' && !isAdmin) {
        return reply.code(403).send({ error: 'Forbidden: no organization context' });
      }

      return reply.view('admin/role-form.hbs', {
        pageTitle: 'Create Role',
        currentPath: '/admin/roles',
        user: request.user,
        role: null,
        isNew: true,
        isSystem: false,
        scope,
        permissionGroups,
        selectedPermissions: {},
      });
    },
  );

  // ── POST /admin/roles — create custom role ──────────────────────────

  server.post(
    '/admin/roles',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireRolesRead(request, reply)) return;

      const body = request.body as CreateRoleBody & { scope?: string };
      const name = (body.name ?? '').trim();
      const description = (body.description ?? '').trim();
      const scope = body.scope ?? 'org';

      if (name === '') {
        if (request.headers['hx-request'] === 'true') {
          return reply.code(422).send(toastHtml('Role name is required', 'error'));
        }
        return reply.code(422).send({ error: 'Role name is required' });
      }

      // Validate name format
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        if (request.headers['hx-request'] === 'true') {
          return reply.code(422).send(toastHtml('Role name must contain only letters, numbers, hyphens and underscores', 'error'));
        }
        return reply.code(422).send({ error: 'Invalid role name format' });
      }

      const isAdmin = request.user?.role === 'admin';
      const userOrgId = request.user?.currentOrgId ?? 'system';
      let targetOrgId: string;

      if (scope === 'global') {
        if (!isAdmin) {
          return reply.code(403).send(toastHtml('Only admins can create global roles', 'error'));
        }
        targetOrgId = 'system';
      } else {
        targetOrgId = userOrgId;
        if (!canManageRoles(request, targetOrgId)) {
          return reply.code(403).send(toastHtml('You cannot manage roles for this organization', 'error'));
        }
      }

      // Check for duplicates within the same org scope
      const existing = await storage.roles.getRoleByNameAndOrg(name, targetOrgId);
      if (existing !== null) {
        if (request.headers['hx-request'] === 'true') {
          return reply.code(422).send(toastHtml(`Role "${escapeHtml(name)}" already exists`, 'error'));
        }
        return reply.code(422).send({ error: 'Role name already exists' });
      }

      // Parse permissions
      const permissions = parsePermissions(body.permissions);

      await storage.roles.createRole({
        name,
        description,
        permissions,
        orgId: targetOrgId,
      });

      if (request.headers['hx-request'] === 'true') {
        reply.header('HX-Redirect', '/admin/roles');
        return reply.send(toastHtml(`Role "${escapeHtml(name)}" created`, 'success'));
      }

      await reply.redirect('/admin/roles');
    },
  );

  // ── GET /admin/roles/:id/edit — edit role form ──────────────────────

  server.get(
    '/admin/roles/:id/edit',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireRolesRead(request, reply)) return;

      const { id } = request.params as { id: string };
      const role = await storage.roles.getRole(id);

      if (role === null) {
        return reply.code(404).send({ error: 'Role not found' });
      }

      // Check write access
      if (!canManageRoles(request, role.orgId)) {
        return reply.code(403).send({ error: 'You do not have permission to edit this role' });
      }

      const permissionSet = new Set(role.permissions);
      const selectedPermissions: Record<string, boolean> = {};
      for (const pid of ALL_PERMISSION_IDS) {
        selectedPermissions[pid] = permissionSet.has(pid);
      }

      const scope = role.orgId === 'system' ? 'global' : 'org';

      return reply.view('admin/role-form.hbs', {
        pageTitle: `Edit Role — ${role.name}`,
        currentPath: '/admin/roles',
        user: request.user,
        role,
        isNew: false,
        isSystem: role.isSystem,
        scope,
        permissionGroups,
        selectedPermissions,
      });
    },
  );

  // ── PATCH /admin/roles/:id — update role permissions ────────────────

  server.patch(
    '/admin/roles/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireRolesRead(request, reply)) return;

      const { id } = request.params as { id: string };
      const role = await storage.roles.getRole(id);

      if (role === null) {
        return reply.code(404).send(toastHtml('Role not found', 'error'));
      }

      if (!canManageRoles(request, role.orgId)) {
        return reply.code(403).send(toastHtml('You do not have permission to edit this role', 'error'));
      }

      const body = request.body as UpdateRoleBody;
      const description = body.description?.trim();
      const permissions = parsePermissions(body.permissions);

      const updateData: {
        name?: string;
        description?: string;
        permissions?: string[];
      } = { permissions };

      if (description !== undefined) {
        updateData.description = description;
      }

      // Only allow name change for non-system, non-default roles
      if (!role.isSystem && !DEFAULT_ORG_ROLE_NAMES.has(role.name) && body.name !== undefined) {
        const name = body.name.trim();
        if (name !== '' && /^[a-zA-Z0-9_-]+$/.test(name)) {
          const existing = await storage.roles.getRoleByNameAndOrg(name, role.orgId);
          if (existing !== null && existing.id !== id) {
            return reply.code(422).send(toastHtml(`Role "${escapeHtml(name)}" already exists`, 'error'));
          }
          updateData.name = name;
        }
      }

      await storage.roles.updateRole(id, updateData);

      if (request.headers['hx-request'] === 'true') {
        reply.header('HX-Redirect', '/admin/roles');
        return reply.send(toastHtml(`Role "${escapeHtml(role.name)}" updated`, 'success'));
      }

      await reply.redirect('/admin/roles');
    },
  );

  // ── POST /admin/roles/:id (method override for PATCH) ──────────────
  // HTML forms only support GET/POST, so we accept POST with _method=PATCH

  server.post(
    '/admin/roles/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireRolesRead(request, reply)) return;

      const { id } = request.params as { id: string };
      const role = await storage.roles.getRole(id);

      if (role === null) {
        return reply.code(404).send(toastHtml('Role not found', 'error'));
      }

      if (!canManageRoles(request, role.orgId)) {
        return reply.code(403).send(toastHtml('You do not have permission to edit this role', 'error'));
      }

      const body = request.body as UpdateRoleBody & { _method?: string };
      const description = body.description?.trim();
      const permissions = parsePermissions(body.permissions);

      const updateData: {
        name?: string;
        description?: string;
        permissions?: string[];
      } = { permissions };

      if (description !== undefined) {
        updateData.description = description;
      }

      // Only allow name change for non-system, non-default roles
      if (!role.isSystem && !DEFAULT_ORG_ROLE_NAMES.has(role.name) && body.name !== undefined) {
        const name = body.name.trim();
        if (name !== '' && /^[a-zA-Z0-9_-]+$/.test(name)) {
          const existing = await storage.roles.getRoleByNameAndOrg(name, role.orgId);
          if (existing !== null && existing.id !== id) {
            return reply.code(422).send(toastHtml(`Role "${escapeHtml(name)}" already exists`, 'error'));
          }
          updateData.name = name;
        }
      }

      await storage.roles.updateRole(id, updateData);

      if (request.headers['hx-request'] === 'true') {
        reply.header('HX-Redirect', '/admin/roles');
        return reply.send(toastHtml(`Role "${escapeHtml(role.name)}" updated`, 'success'));
      }

      await reply.redirect('/admin/roles');
    },
  );

  // ── DELETE /admin/roles/:id — delete custom role ────────────────────

  server.delete(
    '/admin/roles/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireRolesRead(request, reply)) return;

      const { id } = request.params as { id: string };
      const role = await storage.roles.getRole(id);

      if (role === null) {
        return reply.code(404).send(toastHtml('Role not found', 'error'));
      }

      if (role.isSystem) {
        return reply.code(422).send(toastHtml('Cannot delete system roles', 'error'));
      }

      // Cannot delete default org roles (Owner, Admin, Member, Viewer)
      if (DEFAULT_ORG_ROLE_NAMES.has(role.name) && role.orgId !== 'system') {
        return reply.code(422).send(toastHtml('Cannot delete default organization roles', 'error'));
      }

      if (!canManageRoles(request, role.orgId)) {
        return reply.code(403).send(toastHtml('You do not have permission to delete this role', 'error'));
      }

      await storage.roles.deleteRole(id);

      if (request.headers['hx-request'] === 'true') {
        reply.header('HX-Redirect', '/admin/roles');
        return reply.send(toastHtml(`Role "${escapeHtml(role.name)}" deleted`, 'success'));
      }

      await reply.redirect('/admin/roles');
    },
  );
}
