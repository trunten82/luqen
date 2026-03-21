import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ScanDb } from '../../db/scans.js';
import type { UserDb } from '../../db/users.js';
import { adminGuard } from '../../auth/middleware.js';
import { escapeHtml } from './helpers.js';

interface CreateTeamBody {
  name?: string;
  description?: string;
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
  db: ScanDb,
  userDb: UserDb,
): Promise<void> {
  // GET /admin/teams — list teams
  server.get(
    '/admin/teams',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const teams = db.listTeams(orgId);

      return reply.view('admin/teams.hbs', {
        pageTitle: 'Teams',
        currentPath: '/admin/teams',
        user: request.user,
        teams,
      });
    },
  );

  // POST /admin/teams — create team
  server.post(
    '/admin/teams',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as CreateTeamBody;
      const name = (body.name ?? '').trim();

      if (name === '') {
        return reply.code(400).type('text/html').send(
          '<div class="toast toast--error" role="alert">Team name is required</div>',
        );
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      const team = db.createTeam({
        name,
        description: (body.description ?? '').trim(),
        orgId,
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
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const team = db.getTeam(id);

      if (team === null) {
        return reply.code(404).send({ error: 'Team not found' });
      }

      db.deleteTeam(id);
      return reply.type('text/html').send('');
    },
  );

  // GET /admin/teams/:id — team detail with members
  server.get(
    '/admin/teams/:id',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const team = db.getTeam(id);

      if (team === null) {
        return reply.code(404).send({ error: 'Team not found' });
      }

      const allUsers = userDb.listUsers().filter((u) => u.active);
      const memberIds = new Set((team.members ?? []).map((m) => m.userId));
      const availableUsers = allUsers.filter((u) => !memberIds.has(u.id));

      return reply.view('admin/team-detail.hbs', {
        pageTitle: `Team — ${team.name}`,
        currentPath: '/admin/teams',
        user: request.user,
        team,
        availableUsers,
      });
    },
  );

  // POST /admin/teams/:id/members — add member
  server.post(
    '/admin/teams/:id/members',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as AddMemberBody;
      const userId = (body.userId ?? '').trim();

      if (userId === '') {
        return reply.code(400).type('text/html').send(
          '<div class="toast toast--error" role="alert">Please select a user</div>',
        );
      }

      const team = db.getTeam(id);
      if (team === null) {
        return reply.code(404).send({ error: 'Team not found' });
      }

      db.addTeamMember(id, userId);

      // Return the new member row
      const user = userDb.getUserById(userId);
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
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, userId } = request.params as { id: string; userId: string };

      db.removeTeamMember(id, userId);
      return reply.type('text/html').send('');
    },
  );
}
