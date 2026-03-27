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

  // GET /admin/organizations/:id/members — show members page (team-based)
  server.get(
    '/admin/organizations/:id/members',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply.code(404).send({ error: 'Organization not found' });
      }

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).send({ error: 'Forbidden: you can only manage your own organization' });
      }

      // Get all members (now primarily via teams)
      const allMembers = await storage.organizations.listAllMembers(id);

      const enrichMember = async (m: typeof allMembers[number]) => {
        const user = await storage.users.getUserById(m.userId);
        return { ...m, username: user?.username ?? m.userId };
      };

      const members = await Promise.all(allMembers.map(enrichMember));

      // Available users not yet in any team for this org
      const allUsers = await storage.users.listUsers();
      const allMemberUserIds = new Set(allMembers.map((m) => m.userId));
      const availableUsers = allUsers.filter((u) => !allMemberUserIds.has(u.id) && u.active);

      // Linked teams for this org (with role info)
      const linkedTeams = await storage.teams.listTeamsByOrgId(id);

      // Org-scoped roles from DB
      const orgRoles = await storage.roles.listOrgRoles(id);

      // Enrich teams with role name
      const enrichedTeams = linkedTeams.map((team) => {
        const role = orgRoles.find((r) => r.id === team.roleId);
        return { ...team, roleName: role?.name ?? 'No role' };
      });

      return reply.view('admin/organization-members.hbs', {
        pageTitle: `Members — ${org.name}`,
        currentPath: '/admin/organizations',
        user: request.user,
        org,
        members,
        linkedTeams: enrichedTeams,
        availableUsers,
        orgRoles,
      });
    },
  );

  // POST /admin/organizations/:id/members/add-to-team — add user to a team
  server.post(
    '/admin/organizations/:id/members/add-to-team',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { userId?: string; teamId?: string };

      const org = await storage.organizations.getOrg(id);
      if (org === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Organization not found.', 'error'));
      }

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).send({ error: 'Forbidden: you can only manage your own organization' });
      }

      const userId = body.userId?.trim();
      const teamId = body.teamId?.trim();

      if (!userId) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('User is required.', 'error'));
      }

      if (!teamId) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Team is required.', 'error'));
      }

      // Verify team belongs to this org
      const team = await storage.teams.getTeam(teamId);
      if (team === null || team.orgId !== id) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid team for this organization.', 'error'));
      }

      try {
        await storage.teams.addTeamMember(teamId, userId);
        const user = await storage.users.getUserById(userId);
        const username = user?.username ?? userId;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .header('hx-trigger', 'memberChanged')
          .send(toastHtml(`${escapeHtml(username)} added to team "${escapeHtml(team.name)}".`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add member to team';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/organizations/:id/members/:userId/move-team — change a member's team (role)
  server.post(
    '/admin/organizations/:id/members/:userId/move-team',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const body = request.body as { teamId?: string };

      const newTeamId = body.teamId?.trim();
      if (!newTeamId) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Team is required.', 'error'));
      }

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).send({ error: 'Forbidden: you can only manage your own organization' });
      }

      // Verify target team belongs to this org
      const newTeam = await storage.teams.getTeam(newTeamId);
      if (newTeam === null || newTeam.orgId !== id) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid team for this organization.', 'error'));
      }

      // Remove user from all teams in this org, then add to the new team
      const orgTeams = await storage.teams.listTeamsByOrgId(id);
      for (const team of orgTeams) {
        await storage.teams.removeTeamMember(team.id, userId);
      }
      await storage.teams.addTeamMember(newTeamId, userId);

      const user = await storage.users.getUserById(userId);
      const username = user?.username ?? userId;

      return reply
        .code(200)
        .header('content-type', 'text/html')
        .header('hx-trigger', 'memberChanged')
        .send(toastHtml(`${escapeHtml(username)} moved to team "${escapeHtml(newTeam.name)}".`));
    },
  );

  // POST /admin/organizations/:id/members/:userId/remove — remove member from all org teams
  server.post(
    '/admin/organizations/:id/members/:userId/remove',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, userId } = request.params as { id: string; userId: string };

      // Tenant isolation: non-admin users can only manage their own org
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && request.user?.currentOrgId !== id) {
        return reply.code(403).send({ error: 'Forbidden: you can only manage your own organization' });
      }

      try {
        const user = await storage.users.getUserById(userId);
        const username = user?.username ?? userId;

        // Remove from all teams in this org
        const orgTeams = await storage.teams.listTeamsByOrgId(id);
        for (const team of orgTeams) {
          await storage.teams.removeTeamMember(team.id, userId);
        }

        // Also remove from direct members (legacy) if present
        await storage.organizations.removeMember(id, userId);

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`${escapeHtml(username)} removed from organization.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove member';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
