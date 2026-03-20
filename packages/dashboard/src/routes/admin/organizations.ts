import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { OrgDb, Organization } from '../../db/orgs.js';
import type { UserDb, DashboardUser } from '../../db/users.js';
import { adminGuard } from '../../auth/middleware.js';

function toastHtml(message: string, type: 'success' | 'error' = 'success'): string {
  return `<div id="toast" hx-swap-oob="true" role="alert" aria-live="assertive" class="toast toast--${type}">${message}</div>`;
}

function orgRowHtml(org: Organization): string {
  return `<tr id="org-${org.id}">
  <td>${org.name}</td>
  <td><code>${org.slug}</code></td>
  <td>${org.createdAt}</td>
  <td>
    <a href="/admin/organizations/${encodeURIComponent(org.id)}/members"
       class="btn btn--sm btn--ghost"
       aria-label="Manage members for ${org.name}">Members</a>
    <button hx-post="/admin/organizations/${encodeURIComponent(org.id)}/delete"
            hx-confirm="Delete organization ${org.name}? This cannot be undone."
            hx-target="closest tr"
            hx-swap="outerHTML"
            class="btn btn--sm btn--danger"
            aria-label="Delete ${org.name}">Delete</button>
  </td>
</tr>`;
}

function memberRowHtml(
  orgId: string,
  member: { userId: string; role: string; joinedAt: string },
  username: string,
): string {
  return `<tr id="member-${member.userId}">
  <td>${username}</td>
  <td><span class="badge badge--neutral">${member.role}</span></td>
  <td>${member.joinedAt}</td>
  <td>
    <button hx-post="/admin/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(member.userId)}/remove"
            hx-confirm="Remove ${username} from this organization?"
            hx-target="closest tr"
            hx-swap="outerHTML"
            class="btn btn--sm btn--warning"
            aria-label="Remove ${username}">Remove</button>
  </td>
</tr>`;
}

const VALID_MEMBER_ROLES = new Set(['owner', 'admin', 'member', 'viewer']);

export async function organizationRoutes(
  server: FastifyInstance,
  orgDb: OrgDb,
  userDb: UserDb,
): Promise<void> {
  // GET /admin/organizations — list all organizations
  server.get(
    '/admin/organizations',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgs = orgDb.listOrgs();

      return reply.view('admin/organizations.hbs', {
        pageTitle: 'Organizations',
        currentPath: '/admin/organizations',
        user: request.user,
        orgs,
      });
    },
  );

  // GET /admin/organizations/new — create org form fragment
  server.get(
    '/admin/organizations/new',
    { preHandler: adminGuard },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/organization-form.hbs', {});
    },
  );

  // POST /admin/organizations — create org
  server.post(
    '/admin/organizations',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { name?: string; slug?: string };

      const name = body.name?.trim();
      const slug = body.slug?.trim();

      if (!name || !slug) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Name and slug are required.', 'error'));
      }

      // Check for duplicate slug
      const existing = orgDb.getOrgBySlug(slug);
      if (existing !== null) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml(`Organization with slug "${slug}" already exists.`, 'error'));
      }

      try {
        const created = orgDb.createOrg({ name, slug });
        const row = orgRowHtml(created);

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(
            `${row}\n<div id="modal-container" hx-swap-oob="true"></div>\n${toastHtml(`Organization "${created.name}" created successfully.`)}`,
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create organization';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/organizations/:id/delete — delete org
  server.post(
    '/admin/organizations/:id/delete',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const org = orgDb.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      try {
        orgDb.deleteOrg(id);
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`Organization "${org.name}" deleted successfully.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete organization';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // GET /admin/organizations/:id/members — show members page
  server.get(
    '/admin/organizations/:id/members',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const org = orgDb.getOrg(id);
      if (org === null) {
        return reply.code(404).send({ error: 'Organization not found' });
      }

      const rawMembers = orgDb.listMembers(id);
      const members = rawMembers.map((m) => {
        const user = userDb.getUserById(m.userId);
        return {
          ...m,
          username: user?.username ?? m.userId,
        };
      });

      const allUsers = userDb.listUsers();
      const memberUserIds = new Set(rawMembers.map((m) => m.userId));
      const availableUsers = allUsers.filter((u) => !memberUserIds.has(u.id) && u.active);

      return reply.view('admin/organization-members.hbs', {
        pageTitle: `Members — ${org.name}`,
        currentPath: '/admin/organizations',
        user: request.user,
        org,
        members,
        availableUsers,
        roles: ['owner', 'admin', 'member', 'viewer'],
      });
    },
  );

  // POST /admin/organizations/:id/members — add member
  server.post(
    '/admin/organizations/:id/members',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { userId?: string; role?: string };

      const org = orgDb.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      const userId = body.userId?.trim();
      const role = body.role?.trim() ?? 'member';

      if (!userId) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('User is required.', 'error'));
      }

      if (!VALID_MEMBER_ROLES.has(role)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid role. Must be owner, admin, member, or viewer.', 'error'));
      }

      try {
        const member = orgDb.addMember(id, userId, role);
        const user = userDb.getUserById(userId);
        const username = user?.username ?? userId;
        const row = memberRowHtml(id, member, username);

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n${toastHtml(`${username} added to organization.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add member';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/organizations/:id/members/:userId/remove — remove member
  server.post(
    '/admin/organizations/:id/members/:userId/remove',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, userId } = request.params as { id: string; userId: string };

      try {
        const user = userDb.getUserById(userId);
        const username = user?.username ?? userId;
        orgDb.removeMember(id, userId);

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`${username} removed from organization.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove member';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
