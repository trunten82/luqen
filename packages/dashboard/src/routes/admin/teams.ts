import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../../db/index.js';
import { requirePermission } from '../../auth/middleware.js';
import { escapeHtml, toastHtml } from './helpers.js';

interface CreateTeamBody {
  name?: string;
  description?: string;
  organizationId?: string;
  roleId?: string;
}

interface UpdateTeamBody {
  organizationId?: string;
  roleId?: string;
}

interface AddMemberBody {
  userId?: string;
}

function teamRowHtml(team: { id: string; name: string; description: string; memberCount?: number; createdAt: string }): string {
  const escapedName = escapeHtml(team.name);
  const escapedDesc = escapeHtml(team.description);
  const count = team.memberCount ?? 0;

  return `<tr id="team-row-${team.id}">
  <td data-label="Name"><a href="/admin/teams/${encodeURIComponent(team.id)}">${escapedName}</a></td>
  <td data-label="Description">${escapedDesc}</td>
  <td data-label="Members"><span class="badge badge--neutral">${count}</span></td>
  <td data-label="Created">${new Date(team.createdAt).toLocaleDateString()}</td>
  <td>
    <button hx-delete="/admin/teams/${encodeURIComponent(team.id)}"
            hx-confirm="Delete team ${escapedName}? This cannot be undone."
            hx-target="#team-row-${team.id}"
            hx-swap="outerHTML"
            class="btn btn--sm btn--warning"
            aria-label="Delete ${escapedName}">Delete</button>
  </td>
</tr>`;
}

function memberRowHtml(teamId: string, member: { userId: string; username: string; role: string }): string {
  const escapedName = escapeHtml(member.username);
  return `<tr id="member-row-${member.userId}">
  <td data-label="Username">${escapedName}</td>
  <td data-label="Role"><span class="badge badge--neutral">${escapeHtml(member.role)}</span></td>
  <td>
    <button hx-delete="/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(member.userId)}"
            hx-confirm="Remove ${escapedName} from this team?"
            hx-target="#member-row-${member.userId}"
            hx-swap="outerHTML"
            class="btn btn--sm btn--warning"
            aria-label="Remove ${escapedName}">Remove</button>
  </td>
</tr>`;
}

export async function teamRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // GET /admin/teams — list teams
  server.get(
    '/admin/teams',
    { preHandler: requirePermission('admin.teams') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Admin sees all teams; other users see teams in their org
      const isAdmin = request.user?.role === 'admin';
      const teams = isAdmin
        ? await storage.teams.listTeams()
        : await storage.teams.listTeams(request.user?.currentOrgId ?? 'system');
      const organizations = await storage.organizations.listOrgs();

      // Enrich teams with org name for display
      const orgMap = new Map(organizations.map((o) => [o.id, o.name]));
      const enrichedTeams = teams.map((t) => ({
        ...t,
        organizationName: orgMap.get(t.orgId) ?? null,
      }));

      return reply.view('admin/teams.hbs', {
        pageTitle: 'Teams',
        currentPath: '/admin/teams',
        user: request.user,
        teams: enrichedTeams,
        organizations,
      });
    },
  );

  // POST /admin/teams — create team
  server.post(
    '/admin/teams',
    { preHandler: requirePermission('admin.teams') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as CreateTeamBody;
      const name = (body.name ?? '').trim();

      if (name === '') {
        return reply.code(400).type('text/html').send(
          '<div class="toast toast--error" role="alert">Team name is required</div>',
        );
      }

      // If an organization is selected, link the team to it; otherwise use current org scope
      const organizationId = (body.organizationId ?? '').trim();
      const orgId = organizationId !== '' ? organizationId : (request.user?.currentOrgId ?? 'system');
      const roleId = (body.roleId ?? '').trim();

      // Validate role_id if provided — must exist and belong to the same org
      if (roleId !== '') {
        const role = await storage.roles.getRole(roleId);
        if (role === null) {
          return reply.code(400).type('text/html').send(
            '<div class="toast toast--error" role="alert">Selected role does not exist</div>',
          );
        }
        if (role.orgId !== orgId && role.orgId !== 'system') {
          return reply.code(400).type('text/html').send(
            '<div class="toast toast--error" role="alert">Selected role does not belong to this organization</div>',
          );
        }
      }

      const team = await storage.teams.createTeam({
        name,
        description: (body.description ?? '').trim(),
        orgId,
        ...(roleId !== '' ? { roleId } : {}),
      });

      // HTMX — return new table row
      if (request.headers['hx-request'] === 'true') {
        return reply.type('text/html').send(teamRowHtml(team));
      }

      return reply.redirect('/admin/teams');
    },
  );

  // DELETE /admin/teams/:id — delete team
  server.delete(
    '/admin/teams/:id',
    { preHandler: requirePermission('admin.teams') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const team = await storage.teams.getTeam(id);

      if (team === null) {
        return reply.code(404).send({ error: 'Team not found' });
      }

      await storage.teams.deleteTeam(id);
      return reply.type('text/html').send('');
    },
  );

  // GET /admin/teams/:id — team detail with members
  server.get(
    '/admin/teams/:id',
    { preHandler: requirePermission('admin.teams') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const team = await storage.teams.getTeam(id);

      if (team === null) {
        return reply.code(404).send({ error: 'Team not found' });
      }

      const allUsers = (await storage.users.listUsers()).filter((u) => u.active);
      const memberIds = new Set((team.members ?? []).map((m) => m.userId));
      const availableUsers = allUsers.filter((u) => !memberIds.has(u.id));

      const organizations = await storage.organizations.listOrgs();
      const linkedOrg = team.orgId !== 'system'
        ? await storage.organizations.getOrg(team.orgId)
        : null;

      return reply.view('admin/team-detail.hbs', {
        pageTitle: `Team — ${team.name}`,
        currentPath: '/admin/teams',
        user: request.user,
        team,
        availableUsers,
        organizations,
        linkedOrgName: linkedOrg?.name ?? null,
      });
    },
  );

  // POST /admin/teams/:id/org — update team organization link
  server.post(
    '/admin/teams/:id/org',
    { preHandler: requirePermission('admin.teams') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as UpdateTeamBody;

      const team = await storage.teams.getTeam(id);
      if (team === null) {
        return reply.code(404).send({ error: 'Team not found' });
      }

      const newOrgId = (body.organizationId ?? '').trim();
      const orgId = newOrgId !== '' ? newOrgId : 'system';

      // Validate org exists if not 'system'
      if (orgId !== 'system') {
        const org = await storage.organizations.getOrg(orgId);
        if (org === null) {
          return reply.code(400).type('text/html').send(
            '<div class="toast toast--error" role="alert">Organization not found</div>',
          );
        }
      }

      await storage.teams.updateTeam(id, { orgId });

      if (request.headers['hx-request'] === 'true') {
        const org = orgId !== 'system' ? await storage.organizations.getOrg(orgId) : null;
        const orgLabel = org !== null ? escapeHtml(org.name) : 'None (global)';
        return reply.type('text/html').send(
          `<span id="team-org-label" hx-swap-oob="true">${orgLabel}</span>\n${toastHtml('Organization updated')}`,
        );
      }

      return reply.redirect(`/admin/teams/${id}`);
    },
  );

  // POST /admin/teams/:id/role — update team role assignment
  server.post(
    '/admin/teams/:id/role',
    { preHandler: requirePermission('admin.teams') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { roleId?: string };

      const team = await storage.teams.getTeam(id);
      if (team === null) {
        return reply.code(404).send({ error: 'Team not found' });
      }

      const roleId = (body.roleId ?? '').trim();

      if (roleId === '') {
        // Clear role assignment
        await storage.teams.updateTeam(id, { roleId: null });
        if (request.headers['hx-request'] === 'true') {
          return reply.type('text/html').send(
            `<span id="team-role-label" hx-swap-oob="true">None</span>\n${toastHtml('Role assignment cleared')}`,
          );
        }
        return reply.redirect(`/admin/teams/${id}`);
      }

      // Validate role exists and belongs to the same org (or system)
      const role = await storage.roles.getRole(roleId);
      if (role === null) {
        return reply.code(400).type('text/html').send(
          '<div class="toast toast--error" role="alert">Role not found</div>',
        );
      }
      if (role.orgId !== team.orgId && role.orgId !== 'system') {
        return reply.code(400).type('text/html').send(
          '<div class="toast toast--error" role="alert">Role does not belong to this team\'s organization</div>',
        );
      }

      await storage.teams.updateTeam(id, { roleId });

      if (request.headers['hx-request'] === 'true') {
        return reply.type('text/html').send(
          `<span id="team-role-label" hx-swap-oob="true">${escapeHtml(role.name)}</span>\n${toastHtml('Role updated')}`,
        );
      }
      return reply.redirect(`/admin/teams/${id}`);
    },
  );

  // POST /admin/teams/:id/members — add member
  server.post(
    '/admin/teams/:id/members',
    { preHandler: requirePermission('admin.teams') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as AddMemberBody;
      const userId = (body.userId ?? '').trim();

      if (userId === '') {
        return reply.code(400).type('text/html').send(
          '<div class="toast toast--error" role="alert">Please select a user</div>',
        );
      }

      const team = await storage.teams.getTeam(id);
      if (team === null) {
        return reply.code(404).send({ error: 'Team not found' });
      }

      await storage.teams.addTeamMember(id, userId);

      // Return the new member row
      const user = await storage.users.getUserById(userId);
      const member = { userId, username: user?.username ?? userId, role: 'member' };

      if (request.headers['hx-request'] === 'true') {
        return reply.type('text/html').send(memberRowHtml(id, member));
      }

      return reply.redirect(`/admin/teams/${id}`);
    },
  );

  // DELETE /admin/teams/:id/members/:userId — remove member
  server.delete(
    '/admin/teams/:id/members/:userId',
    { preHandler: requirePermission('admin.teams') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, userId } = request.params as { id: string; userId: string };

      await storage.teams.removeTeamMember(id, userId);
      return reply.type('text/html').send('');
    },
  );
}
