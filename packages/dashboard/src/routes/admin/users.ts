import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listUsers,
  createUser,
  deactivateUser,
} from '../../compliance-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml } from './helpers.js';

export async function userRoutes(
  server: FastifyInstance,
  baseUrl: string,
): Promise<void> {
  // GET /admin/users — list users
  server.get(
    '/admin/users',
    { preHandler: requirePermission('admin.users') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      let users: Awaited<ReturnType<typeof listUsers>> = [];
      let error: string | undefined;

      try {
        users = await listUsers(baseUrl, getToken(request), getOrgId(request));
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load users';
      }

      const formatted = users.map((u) => ({
        ...u,
        createdAtDisplay: new Date(u.createdAt).toLocaleString(),
      }));

      return reply.view('admin/users.hbs', {
        pageTitle: 'API Users (Compliance)',
        currentPath: '/admin/users',
        user: request.user,
        users: formatted,
        error,
      });
    },
  );

  // GET /admin/users/new — modal form fragment
  server.get(
    '/admin/users/new',
    { preHandler: requirePermission('admin.users') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/user-form.hbs', {
        isNew: true,
        formUser: { username: '', role: 'viewer', password: '' },
        roles: ['viewer', 'user', 'admin'],
      });
    },
  );

  // POST /admin/users — create user
  server.post(
    '/admin/users',
    { preHandler: requirePermission('admin.users') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        username?: string;
        password?: string;
        role?: string;
      };

      if (!body.username?.trim() || !body.password?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Username and password are required.', 'error'));
      }

      const role = body.role?.trim() ?? 'viewer';
      if (!['viewer', 'user', 'admin'].includes(role)) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Invalid role.', 'error'));
      }

      try {
        const created = await createUser(baseUrl, getToken(request), {
          username: body.username.trim(),
          password: body.password.trim(),
          role: role as 'viewer' | 'user' | 'admin',
        }, getOrgId(request));

        const row = `<tr id="user-${created.id}">
  <td data-label="Username">${created.username}</td>
  <td data-label="Role"><span class="badge badge--neutral">${created.role}</span></td>
  <td data-label="Created">${new Date(created.createdAt).toLocaleString()}</td>
  <td data-label="Status"><span class="badge ${created.active ? 'badge--success' : 'badge--error'}">${created.active ? 'Active' : 'Inactive'}</span></td>
  <td>
    <button hx-post="/admin/users/${encodeURIComponent(created.id)}/deactivate"
            hx-confirm="Deactivate user ${created.username}?"
            hx-target="closest tr"
            hx-swap="outerHTML"
            class="btn btn--sm btn--warning"
            ${!created.active ? 'disabled' : ''}
            aria-label="Deactivate ${created.username}">Deactivate</button>
  </td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n<div id="modal-container" hx-swap-oob="true"></div>\n${toastHtml(`User "${created.username}" created successfully.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create user';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/users/:id/deactivate — deactivate user
  server.post(
    '/admin/users/:id/deactivate',
    { preHandler: requirePermission('admin.users') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await deactivateUser(baseUrl, getToken(request), id, getOrgId(request));

        const rowHtml = `<tr id="user-${id}">
  <td data-label="Username" colspan="4">User deactivated.</td>
  <td data-label="Status"><span class="badge badge--error">Inactive</span></td>
  <td></td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${rowHtml}\n${toastHtml('User deactivated successfully.')}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to deactivate user';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
