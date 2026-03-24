import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter, Organization } from '../../db/index.js';
import { deleteOrgData } from '../../compliance-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, toastHtml, escapeHtml } from './helpers.js';

function orgRowHtml(org: Organization): string {
  return `<tr id="org-${org.id}">
  <td data-label="Name">${org.name}</td>
  <td data-label="Slug"><code>${org.slug}</code></td>
  <td data-label="Created">${org.createdAt}</td>
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
  <td data-label="Username">${username}</td>
  <td data-label="Role"><span class="badge badge--neutral">${member.role}</span></td>
  <td data-label="Joined">${member.joinedAt}</td>
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
  storage: StorageAdapter,
  complianceUrl?: string,
): Promise<void> {
  // GET /admin/organizations — list all organizations
  server.get(
    '/admin/organizations',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgs = await storage.organizations.listOrgs();

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
    { preHandler: requirePermission('admin.system') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/organization-form.hbs', {});
    },
  );

  // POST /admin/organizations — create org
  server.post(
    '/admin/organizations',
    { preHandler: requirePermission('admin.system') },
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

      if (!/^[a-z0-9-]+$/.test(slug)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Slug must contain only lowercase letters, numbers, and hyphens.', 'error'));
      }

      // Check for duplicate slug
      const existing = await storage.organizations.getOrgBySlug(slug);
      if (existing !== null) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml(`Organization with slug "${slug}" already exists.`, 'error'));
      }

      try {
        const created = await storage.organizations.createOrg({ name, slug });
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
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      try {
        await storage.organizations.deleteOrg(id);

        // Best effort — compliance cleanup failure shouldn't block org deletion
        if (complianceUrl !== undefined) {
          try {
            const token = getToken(request);
            await deleteOrgData(complianceUrl, token, id);
          } catch {
            // intentionally ignored
          }
        }

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
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply.code(404).send({ error: 'Organization not found' });
      }

      const allMembers = await storage.organizations.listAllMembers(id);
      const directMembers = allMembers.filter((m) => m.source !== 'team');
      const teamMembers = allMembers.filter((m) => m.source === 'team');

      const enrichMember = async (m: typeof allMembers[number]) => {
        const user = await storage.users.getUserById(m.userId);
        return { ...m, username: user?.username ?? m.userId };
      };

      const members = await Promise.all(directMembers.map(enrichMember));
      const inheritedMembers = await Promise.all(teamMembers.map(enrichMember));

      const allUsers = await storage.users.listUsers();
      const allMemberUserIds = new Set(allMembers.map((m) => m.userId));
      const availableUsers = allUsers.filter((u) => !allMemberUserIds.has(u.id) && u.active);

      // Linked teams for this org
      const linkedTeams = await storage.teams.listTeamsByOrgId(id);

      return reply.view('admin/organization-members.hbs', {
        pageTitle: `Members — ${org.name}`,
        currentPath: '/admin/organizations',
        user: request.user,
        org,
        members,
        inheritedMembers,
        linkedTeams,
        availableUsers,
        roles: ['owner', 'admin', 'member', 'viewer'],
      });
    },
  );

  // POST /admin/organizations/:id/members — add member
  server.post(
    '/admin/organizations/:id/members',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { userId?: string; role?: string };

      const org = await storage.organizations.getOrg(id);
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
        const member = await storage.organizations.addMember(id, userId, role);
        const user = await storage.users.getUserById(userId);
        const username = user?.username ?? userId;
        const row = memberRowHtml(id, member, username);

        // Show table + hide empty state via inline script (OOB can't change attributes)
        const reveal = `<script>
          var t=document.getElementById('org-members-wrapper');if(t)t.style.display='';
          var e=document.getElementById('org-no-members');if(e)e.style.display='none';
        </script>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n${reveal}\n${toastHtml(`${username} added to organization.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add member';
        const isDuplicate = message.includes('UNIQUE constraint');
        return reply
          .code(isDuplicate ? 409 : 500)
          .header('content-type', 'text/html')
          .send(toastHtml(isDuplicate ? 'User is already a member of this organization.' : message, 'error'));
      }
    },
  );

  // POST /admin/organizations/:id/members/:userId/remove — remove member
  server.post(
    '/admin/organizations/:id/members/:userId/remove',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, userId } = request.params as { id: string; userId: string };

      try {
        const user = await storage.users.getUserById(userId);
        const username = user?.username ?? userId;
        await storage.organizations.removeMember(id, userId);

        // Add user back to the "available users" dropdown via OOB swap
        const optionHtml = `<option value="${escapeHtml(userId)}" hx-swap-oob="beforeend:#add-member-user">${escapeHtml(username)}</option>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${optionHtml}\n${toastHtml(`${username} removed from organization.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove member';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
