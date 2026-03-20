import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { UserDb, DashboardUser } from '../../db/users.js';
import { adminGuard } from '../../auth/middleware.js';

function toastHtml(message: string, type: 'success' | 'error' = 'success'): string {
  return `<div id="toast" hx-swap-oob="true" role="alert" aria-live="assertive" class="toast toast--${type}">${message}</div>`;
}

function roleBadgeClass(role: string): string {
  if (role === 'admin') return 'badge--error';
  if (role === 'user' || role === 'editor') return 'badge--warning';
  return 'badge--neutral';
}

function userRowHtml(user: DashboardUser): string {
  const statusBadge = user.active
    ? '<span class="badge badge--success">Active</span>'
    : '<span class="badge badge--error">Inactive</span>';

  const roleBadge = `<span class="badge ${roleBadgeClass(user.role)}">${user.role}</span>`;

  const deactivateBtn = user.active
    ? `<button hx-post="/admin/dashboard-users/${encodeURIComponent(user.id)}/deactivate"
              hx-confirm="Deactivate user ${user.username}?"
              hx-target="closest tr"
              hx-swap="outerHTML"
              class="btn btn--sm btn--warning"
              aria-label="Deactivate ${user.username}">Deactivate</button>`
    : '';

  const roleSelect = user.active
    ? `<select hx-patch="/admin/dashboard-users/${encodeURIComponent(user.id)}/role"
              hx-target="closest tr"
              hx-swap="outerHTML"
              hx-include="this"
              name="role"
              class="input input--sm"
              aria-label="Change role for ${user.username}">
        <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>viewer</option>
        <option value="user" ${user.role === 'user' ? 'selected' : ''}>user</option>
        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
      </select>`
    : roleBadge;

  return `<tr id="dashboard-user-${user.id}">
  <td>${user.username}</td>
  <td>${roleSelect}</td>
  <td>${statusBadge}</td>
  <td>${deactivateBtn}</td>
</tr>`;
}

const VALID_ROLES = new Set(['viewer', 'user', 'admin']);

export async function dashboardUserRoutes(
  server: FastifyInstance,
  userDb: UserDb,
): Promise<void> {
  // GET /admin/dashboard-users — list local dashboard users
  server.get(
    '/admin/dashboard-users',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const users = userDb.listUsers();

      return reply.view('admin/dashboard-users.hbs', {
        pageTitle: 'Dashboard Users',
        currentPath: '/admin/dashboard-users',
        user: request.user,
        users,
      });
    },
  );

  // GET /admin/dashboard-users/new — create user form fragment
  server.get(
    '/admin/dashboard-users/new',
    { preHandler: adminGuard },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/dashboard-user-form.hbs', {
        isNew: true,
        formUser: { username: '', role: 'user', password: '' },
        roles: ['viewer', 'user', 'admin'],
      });
    },
  );

  // POST /admin/dashboard-users — create user
  server.post(
    '/admin/dashboard-users',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        username?: string;
        password?: string;
        role?: string;
      };

      const username = body.username?.trim();
      const password = body.password?.trim();
      const role = body.role?.trim() ?? 'user';

      if (!username || !password) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Username and password are required.', 'error'));
      }

      if (!VALID_ROLES.has(role)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid role. Must be viewer, user, or admin.', 'error'));
      }

      // Check for duplicate username
      const existing = userDb.getUserByUsername(username);
      if (existing !== null) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml(`User "${username}" already exists.`, 'error'));
      }

      try {
        const created = await userDb.createUser(username, password, role);
        const row = userRowHtml(created);

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(
            `${row}\n<div id="modal-container" hx-swap-oob="true"></div>\n${toastHtml(`User "${created.username}" created successfully.`)}`,
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create user';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // PATCH /admin/dashboard-users/:id/role — update user role
  server.patch(
    '/admin/dashboard-users/:id/role',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { role?: string };
      const role = body.role?.trim();

      if (!role || !VALID_ROLES.has(role)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid role. Must be viewer, user, or admin.', 'error'));
      }

      try {
        userDb.updateUserRole(id, role);
        const updated = userDb.getUserById(id);

        if (updated === null) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('User not found.', 'error'));
        }

        const row = userRowHtml(updated);
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n${toastHtml(`Role updated to "${role}" for ${updated.username}.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update role';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/dashboard-users/:id/deactivate — deactivate user
  server.post(
    '/admin/dashboard-users/:id/deactivate',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        userDb.deactivateUser(id);
        const deactivated = userDb.getUserById(id);

        if (deactivated === null) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('User not found.', 'error'));
        }

        const row = userRowHtml(deactivated);
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n${toastHtml(`User "${deactivated.username}" deactivated successfully.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to deactivate user';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
