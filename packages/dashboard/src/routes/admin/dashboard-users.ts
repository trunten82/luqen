import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter, DashboardUser } from '../../db/index.js';
import type { UserRepository } from '../../db/interfaces/user-repository.js';
import { requirePermission } from '../../auth/middleware.js';
import { toastHtml } from './helpers.js';
import { validateUsername, validatePassword } from '../../validation.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function isLastActiveAdmin(users: StorageAdapter, userId: string): Promise<boolean> {
  const userList = await users.users.listUsers();
  const activeAdmins = userList.filter(u => u.active && u.role === 'admin' && u.id !== userId);
  return activeAdmins.length === 0;
}

function roleBadgeClass(role: string): string {
  if (role === 'admin') return 'badge--error';
  if (role === 'developer') return 'badge--warning';
  if (role === 'user' || role === 'editor') return 'badge--warning';
  if (role === 'executive') return 'badge--neutral';
  return 'badge--neutral';
}

function userRowHtml(user: DashboardUser): string {
  const statusBadge = user.active
    ? '<span class="badge badge--success">Active</span>'
    : '<span class="badge badge--error">Inactive</span>';

  const roleBadge = `<span class="badge ${roleBadgeClass(user.role)}">${user.role}</span>`;

  const statusBtn = user.active
    ? `<button hx-post="/admin/dashboard-users/${encodeURIComponent(user.id)}/deactivate"
              hx-confirm="Deactivate user ${esc(user.username)}?"
              hx-target="closest tr"
              hx-swap="outerHTML"
              class="btn btn--sm btn--warning"
              aria-label="Deactivate ${esc(user.username)}">Deactivate</button>`
    : `<button hx-post="/admin/dashboard-users/${encodeURIComponent(user.id)}/activate"
              hx-confirm="Activate user ${esc(user.username)}?"
              hx-target="closest tr"
              hx-swap="outerHTML"
              class="btn btn--sm btn--success"
              aria-label="Activate ${esc(user.username)}">Activate</button>`;

  const resetPwBtn = `<button hx-get="/admin/dashboard-users/${encodeURIComponent(user.id)}/reset-password"
              hx-target="#modal-container"
              hx-swap="innerHTML"
              class="btn btn--sm btn--ghost"
              aria-label="Reset password for ${esc(user.username)}">Reset Password</button>`;

  const deleteBtn = `<button hx-delete="/admin/dashboard-users/${encodeURIComponent(user.id)}"
              hx-confirm="Permanently delete user ${esc(user.username)}? This cannot be undone."
              hx-target="closest tr"
              hx-swap="outerHTML"
              class="btn btn--sm btn--danger"
              aria-label="Delete ${esc(user.username)}">Delete</button>`;

  const roleSelect = user.active
    ? `<select hx-patch="/admin/dashboard-users/${encodeURIComponent(user.id)}/role"
              hx-target="closest tr"
              hx-swap="outerHTML"
              hx-include="this"
              name="role"
              class="input input--sm"
              aria-label="Change role for ${esc(user.username)}">
        <option value="executive" ${user.role === 'executive' ? 'selected' : ''}>executive</option>
        <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>viewer</option>
        <option value="user" ${user.role === 'user' ? 'selected' : ''}>user</option>
        <option value="developer" ${user.role === 'developer' ? 'selected' : ''}>developer</option>
        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
      </select>`
    : roleBadge;

  return `<tr id="dashboard-user-${user.id}">
  <td data-label="Username">${esc(user.username)}</td>
  <td data-label="Role">${roleSelect}</td>
  <td data-label="Status">${statusBadge}</td>
  <td>${statusBtn} ${resetPwBtn} ${deleteBtn}</td>
</tr>`;
}

const VALID_ROLES = new Set(['viewer', 'user', 'developer', 'admin', 'executive']);

export async function dashboardUserRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  const anyUserPerm = requirePermission('users.create', 'users.delete', 'users.activate', 'users.reset_password', 'users.roles');

  // GET /admin/dashboard-users — list local dashboard users
  server.get(
    '/admin/dashboard-users',
    { preHandler: anyUserPerm },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const users = await storage.users.listUsers();

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
    { preHandler: requirePermission('users.create') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/dashboard-user-form.hbs', {
        isNew: true,
        formUser: { username: '', role: 'user', password: '' },
        roles: ['executive', 'viewer', 'user', 'developer', 'admin'],
      });
    },
  );

  // POST /admin/dashboard-users — create user
  server.post(
    '/admin/dashboard-users',
    { preHandler: requirePermission('users.create') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        username?: string;
        password?: string;
        role?: string;
      };

      const username = body.username?.trim();
      const password = body.password;
      const role = body.role?.trim() ?? 'user';

      if (!username || !password) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Username and password are required.', 'error'));
      }

      const usernameCheck = validateUsername(username);
      if (!usernameCheck.valid) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml(usernameCheck.error ?? 'Invalid username.', 'error'));
      }

      const passwordCheck = validatePassword(password);
      if (!passwordCheck.valid) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml(passwordCheck.error ?? 'Invalid password.', 'error'));
      }

      if (!VALID_ROLES.has(role)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid role. Must be executive, viewer, user, developer, or admin.', 'error'));
      }

      // Check for duplicate username
      const existing = await storage.users.getUserByUsername(username);
      if (existing !== null) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml(`User "${username}" already exists.`, 'error'));
      }

      try {
        const created = await storage.users.createUser(username, password, role);
        const row = userRowHtml(created);

        void storage.audit.log({ actor: request.user?.username ?? 'unknown', actorId: request.user?.id, action: 'user.create', resourceType: 'user', resourceId: created.id, details: { username: created.username, role }, ipAddress: request.ip });
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
    { preHandler: requirePermission('users.roles') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { role?: string };
      const role = body.role?.trim();

      if (!role || !VALID_ROLES.has(role)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid role. Must be executive, viewer, user, developer, or admin.', 'error'));
      }

      const currentUser = await storage.users.getUserById(id);
      if (currentUser !== null && currentUser.role === 'admin' && role !== 'admin' && await isLastActiveAdmin(storage, id)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Cannot change role of the last active admin user.', 'error'));
      }

      try {
        await storage.users.updateUserRole(id, role);
        const updated = await storage.users.getUserById(id);

        if (updated === null) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('User not found.', 'error'));
        }

        const row = userRowHtml(updated);
        void storage.audit.log({ actor: request.user?.username ?? 'unknown', actorId: request.user?.id, action: 'user.role_change', resourceType: 'user', resourceId: id, details: { username: updated.username, newRole: role }, ipAddress: request.ip });
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
    { preHandler: requirePermission('users.activate') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const targetUser = await storage.users.getUserById(id);
      if (targetUser !== null && targetUser.role === 'admin' && await isLastActiveAdmin(storage, id)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Cannot deactivate the last active admin user.', 'error'));
      }

      try {
        await storage.users.deactivateUser(id);
        const deactivated = await storage.users.getUserById(id);

        if (deactivated === null) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('User not found.', 'error'));
        }

        const row = userRowHtml(deactivated);
        void storage.audit.log({ actor: request.user?.username ?? 'unknown', actorId: request.user?.id, action: 'user.deactivate', resourceType: 'user', resourceId: id, details: { username: deactivated.username }, ipAddress: request.ip });
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

  // POST /admin/dashboard-users/:id/activate — reactivate user
  server.post(
    '/admin/dashboard-users/:id/activate',
    { preHandler: requirePermission('users.activate') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await storage.users.activateUser(id);
        const activated = await storage.users.getUserById(id);

        if (activated === null) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('User not found.', 'error'));
        }

        const row = userRowHtml(activated);
        void storage.audit.log({ actor: request.user?.username ?? 'unknown', actorId: request.user?.id, action: 'user.activate', resourceType: 'user', resourceId: id, details: { username: activated.username }, ipAddress: request.ip });
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n${toastHtml(`User "${activated.username}" activated successfully.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to activate user';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // GET /admin/dashboard-users/:id/reset-password — show reset password form
  server.get(
    '/admin/dashboard-users/:id/reset-password',
    { preHandler: requirePermission('users.reset_password') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const user = await storage.users.getUserById(id);

      if (user === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('User not found.', 'error'));
      }

      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      return reply
        .code(200)
        .header('content-type', 'text/html')
        .send(`<div class="modal-overlay" onclick="if(event.target===this)this.remove()">
  <div class="modal" role="dialog" aria-labelledby="reset-pw-title" aria-modal="true">
    <div class="modal__header">
      <h2 id="reset-pw-title" class="modal__title">Reset Password — ${esc(user.username)}</h2>
      <button class="modal__close close-modal-btn" aria-label="Close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
    </div>
    <form hx-post="/admin/dashboard-users/${encodeURIComponent(id)}/reset-password"
          hx-target="#modal-container"
          hx-swap="innerHTML">
      <div class="modal__body">
        <div class="form-group">
          <label for="newPassword">New Password <span class="required" aria-hidden="true">*</span></label>
          <input type="password" id="newPassword" name="newPassword" class="input" required aria-required="true" minlength="8" autocomplete="new-password">
          <span class="form-hint">Min 8 chars, uppercase, lowercase, number, special character</span>
        </div>
        <div class="form-group">
          <label for="confirmPassword">Confirm Password <span class="required" aria-hidden="true">*</span></label>
          <input type="password" id="confirmPassword" name="confirmPassword" class="input" required aria-required="true" minlength="8" autocomplete="new-password">
        </div>
      </div>
      <div class="modal__footer">
        <button type="button" class="btn btn--ghost close-modal-btn" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button type="submit" class="btn btn--primary">Reset Password</button>
      </div>
    </form>
  </div>
</div>`);
    },
  );

  // POST /admin/dashboard-users/:id/reset-password — update password
  server.post(
    '/admin/dashboard-users/:id/reset-password',
    { preHandler: requirePermission('users.reset_password') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { newPassword?: string; confirmPassword?: string };

      const user = await storage.users.getUserById(id);
      if (user === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('User not found.', 'error'));
      }

      if (!body.newPassword) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Password is required.', 'error'));
      }

      const pwCheck = validatePassword(body.newPassword);
      if (!pwCheck.valid) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml(pwCheck.error ?? 'Invalid password.', 'error'));
      }

      if (body.newPassword !== body.confirmPassword) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Passwords do not match.', 'error'));
      }

      try {
        await storage.users.updatePassword(id, body.newPassword);
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${toastHtml(`Password reset successfully for "${user.username}".`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reset password';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // DELETE /admin/dashboard-users/:id — permanently delete a user
  server.delete(
    '/admin/dashboard-users/:id',
    { preHandler: requirePermission('users.delete') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const user = await storage.users.getUserById(id);
      if (user === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('User not found.', 'error'));
      }

      if (user.role === 'admin' && await isLastActiveAdmin(storage, id)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Cannot delete the last active admin user.', 'error'));
      }

      try {
        await storage.users.deleteUser(id);
        void storage.audit.log({ actor: request.user?.username ?? 'unknown', actorId: request.user?.id, action: 'user.delete', resourceType: 'user', resourceId: id, details: { username: user.username }, ipAddress: request.ip });
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${toastHtml(`User "${user.username}" deleted permanently.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete user';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
