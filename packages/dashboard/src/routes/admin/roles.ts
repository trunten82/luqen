import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ScanDb } from '../../db/scans.js';
import { hasPermission, getPermissionGroups, ALL_PERMISSION_IDS } from '../../permissions.js';
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
// Guard helper
// ---------------------------------------------------------------------------

function requireAdminRoles(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!hasPermission(request, 'admin.roles')) {
    reply.code(403).send({ error: 'Forbidden: admin.roles permission required' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function roleRoutes(
  server: FastifyInstance,
  db: ScanDb,
): Promise<void> {
  const permissionGroups = getPermissionGroups();

  // ── GET /admin/roles — list all roles ───────────────────────────────

  server.get(
    '/admin/roles',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireAdminRoles(request, reply)) return;

      const orgId = request.user?.currentOrgId ?? 'system';
      const roles = db.listRoles(orgId);

      const rolesView = roles.map((r) => ({
        ...r,
        permissionCount: r.permissions.length,
        systemBadge: r.isSystem,
        canDelete: !r.isSystem,
      }));

      return reply.view('admin/roles.hbs', {
        pageTitle: 'Roles Management',
        currentPath: '/admin/roles',
        user: request.user,
        roles: rolesView,
        hasRoles: roles.length > 0,
      });
    },
  );

  // ── GET /admin/roles/new — new role form ────────────────────────────

  server.get(
    '/admin/roles/new',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireAdminRoles(request, reply)) return;

      return reply.view('admin/role-form.hbs', {
        pageTitle: 'Create Role',
        currentPath: '/admin/roles',
        user: request.user,
        role: null,
        isNew: true,
        isSystem: false,
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
      if (!requireAdminRoles(request, reply)) return;

      const body = request.body as CreateRoleBody;
      const name = (body.name ?? '').trim();
      const description = (body.description ?? '').trim();

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

      // Check for duplicates
      const existing = db.getRoleByName(name);
      if (existing !== null) {
        if (request.headers['hx-request'] === 'true') {
          return reply.code(422).send(toastHtml(`Role "${escapeHtml(name)}" already exists`, 'error'));
        }
        return reply.code(422).send({ error: 'Role name already exists' });
      }

      // Parse permissions
      const rawPerms = body.permissions;
      const permissions: string[] = Array.isArray(rawPerms)
        ? rawPerms.filter((p) => ALL_PERMISSION_IDS.includes(p))
        : typeof rawPerms === 'string'
          ? [rawPerms].filter((p) => ALL_PERMISSION_IDS.includes(p))
          : [];

      const orgId = request.user?.currentOrgId ?? 'system';

      db.createRole({
        name,
        description,
        permissions,
        orgId,
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
      if (!requireAdminRoles(request, reply)) return;

      const { id } = request.params as { id: string };
      const role = db.getRole(id);

      if (role === null) {
        return reply.code(404).send({ error: 'Role not found' });
      }

      const permissionSet = new Set(role.permissions);
      const selectedPermissions: Record<string, boolean> = {};
      for (const pid of ALL_PERMISSION_IDS) {
        selectedPermissions[pid] = permissionSet.has(pid);
      }

      return reply.view('admin/role-form.hbs', {
        pageTitle: `Edit Role — ${role.name}`,
        currentPath: '/admin/roles',
        user: request.user,
        role,
        isNew: false,
        isSystem: role.isSystem,
        permissionGroups,
        selectedPermissions,
      });
    },
  );

  // ── PATCH /admin/roles/:id — update role permissions ────────────────

  server.patch(
    '/admin/roles/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireAdminRoles(request, reply)) return;

      const { id } = request.params as { id: string };
      const role = db.getRole(id);

      if (role === null) {
        return reply.code(404).send(toastHtml('Role not found', 'error'));
      }

      const body = request.body as UpdateRoleBody;
      const description = body.description?.trim();

      // Parse permissions
      const rawPerms = body.permissions;
      const permissions: string[] = Array.isArray(rawPerms)
        ? rawPerms.filter((p) => ALL_PERMISSION_IDS.includes(p))
        : typeof rawPerms === 'string'
          ? [rawPerms].filter((p) => ALL_PERMISSION_IDS.includes(p))
          : [];

      const updateData: {
        name?: string;
        description?: string;
        permissions?: string[];
      } = { permissions };

      if (description !== undefined) {
        updateData.description = description;
      }

      // Only allow name change for non-system roles
      if (!role.isSystem && body.name !== undefined) {
        const name = body.name.trim();
        if (name !== '' && /^[a-zA-Z0-9_-]+$/.test(name)) {
          // Check for duplicates (excluding current)
          const existing = db.getRoleByName(name);
          if (existing !== null && existing.id !== id) {
            return reply.code(422).send(toastHtml(`Role "${escapeHtml(name)}" already exists`, 'error'));
          }
          updateData.name = name;
        }
      }

      db.updateRole(id, updateData);

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
      if (!requireAdminRoles(request, reply)) return;

      const { id } = request.params as { id: string };
      const role = db.getRole(id);

      if (role === null) {
        return reply.code(404).send(toastHtml('Role not found', 'error'));
      }

      const body = request.body as UpdateRoleBody & { _method?: string };

      // Handle method override for PATCH
      const description = body.description?.trim();

      // Parse permissions
      const rawPerms = body.permissions;
      const permissions: string[] = Array.isArray(rawPerms)
        ? rawPerms.filter((p) => ALL_PERMISSION_IDS.includes(p))
        : typeof rawPerms === 'string'
          ? [rawPerms].filter((p) => ALL_PERMISSION_IDS.includes(p))
          : [];

      const updateData: {
        name?: string;
        description?: string;
        permissions?: string[];
      } = { permissions };

      if (description !== undefined) {
        updateData.description = description;
      }

      // Only allow name change for non-system roles
      if (!role.isSystem && body.name !== undefined) {
        const name = body.name.trim();
        if (name !== '' && /^[a-zA-Z0-9_-]+$/.test(name)) {
          const existing = db.getRoleByName(name);
          if (existing !== null && existing.id !== id) {
            return reply.code(422).send(toastHtml(`Role "${escapeHtml(name)}" already exists`, 'error'));
          }
          updateData.name = name;
        }
      }

      db.updateRole(id, updateData);

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
      if (!requireAdminRoles(request, reply)) return;

      const { id } = request.params as { id: string };
      const role = db.getRole(id);

      if (role === null) {
        return reply.code(404).send(toastHtml('Role not found', 'error'));
      }

      if (role.isSystem) {
        return reply.code(422).send(toastHtml('Cannot delete system roles', 'error'));
      }

      db.deleteRole(id);

      if (request.headers['hx-request'] === 'true') {
        reply.header('HX-Redirect', '/admin/roles');
        return reply.send(toastHtml(`Role "${escapeHtml(role.name)}" deleted`, 'success'));
      }

      await reply.redirect('/admin/roles');
    },
  );
}
