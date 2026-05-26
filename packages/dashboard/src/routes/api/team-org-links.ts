/**
 * Phase 62.1 — Multi-team RBAC overlay API.
 *
 *   GET    /api/v1/users/me/effective-roles
 *   GET    /api/v1/teams/:teamId/members
 *   POST   /api/v1/teams/:teamId/members           body: { user_id, role }
 *   DELETE /api/v1/teams/:teamId/members/:userId
 *   GET    /api/v1/teams/:teamId/org-links
 *   POST   /api/v1/teams/:teamId/org-links/invite  body: { target_org_id }
 *   POST   /api/v1/team-org-link-invites/:inviteId/accept
 *   POST   /api/v1/team-org-link-invites/:inviteId/decline
 *   DELETE /api/v1/teams/:teamId/org-links/:orgId
 *
 * Permission model:
 *   - team-member edits + cross-org invites: must be admin.org on the team's
 *     HOME org (teams.org_id).
 *   - accept/decline of a pending invite: must be admin.org on the TARGET org.
 *   - read endpoints: admin.org on the home org OR on any org the team scopes
 *     into via team_org_links (so a target org's admin can see the team that
 *     reached into their org).
 *   - effective-roles is self-scoped — every authenticated caller sees their
 *     own; admin.system can pass ?user=<id>.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';
import { hasPermission } from '../../permissions.js';
import { resolveEffectiveRoles } from '../../permissions.js';

const ErrorResponse = Type.Object({ error: Type.String() });

const EffectiveRolesResponse = Type.Object({
  user_id: Type.String(),
  orgs: Type.Array(
    Type.Object({
      org_id: Type.String(),
      role: Type.String(),
      sources: Type.Array(
        Type.Object({
          kind: Type.Union([Type.Literal('org'), Type.Literal('team')]),
          team_id: Type.Optional(Type.String()),
          role: Type.String(),
        }),
      ),
    }),
  ),
});

const TeamMembersResponse = Type.Object({
  members: Type.Array(
    Type.Object({
      user_id: Type.String(),
      username: Type.String(),
      role: Type.String(),
    }),
  ),
});

const SetMemberBody = Type.Object(
  { user_id: Type.String({ minLength: 1, maxLength: 200 }), role: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false },
);

const InviteBody = Type.Object(
  { target_org_id: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);

const InviteResponse = Type.Object({
  id: Type.String(),
  team_id: Type.String(),
  target_org_id: Type.String(),
  status: Type.String(),
  created_at: Type.String(),
});

const OrgLinksResponse = Type.Object({
  active_links: Type.Array(
    Type.Object({
      team_id: Type.String(),
      org_id: Type.String(),
      linked_at: Type.String(),
      linked_by: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
  invites: Type.Array(
    Type.Object({
      id: Type.String(),
      team_id: Type.String(),
      target_org_id: Type.String(),
      invited_by: Type.String(),
      status: Type.String(),
      created_at: Type.String(),
      decided_at: Type.Union([Type.String(), Type.Null()]),
      decided_by: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
});

type SetMember = Static<typeof SetMemberBody>;
type Invite = Static<typeof InviteBody>;

async function callerOrgAdminFor(
  request: FastifyRequest,
  orgId: string,
): Promise<boolean> {
  if (hasPermission(request, 'admin.system')) return true;
  if (!hasPermission(request, 'admin.org')) return false;
  return (request.user?.currentOrgId ?? '') === orgId;
}

function audit(
  storage: StorageAdapter,
  request: FastifyRequest,
  action: string,
  resourceId: string,
  details: Record<string, unknown>,
): Promise<void> {
  return storage.audit.log({
    actor: request.user?.username ?? request.user?.id ?? 'unknown',
    actorId: request.user?.id,
    action,
    resourceType: 'team_org_link',
    resourceId,
    details,
    orgId: request.user?.currentOrgId,
    ipAddress: request.ip,
  });
}

export async function teamOrgLinkRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // ── GET /api/v1/users/me/effective-roles ────────────────────────────────
  server.get(
    '/api/v1/users/me/effective-roles',
    {
      schema: {
        querystring: Type.Object({ user: Type.Optional(Type.String()) }),
        response: { 200: EffectiveRolesResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = request.user?.id;
      if (callerId === undefined || callerId === '') {
        return reply.code(401).send({ error: 'authentication required' });
      }
      const { user: explicit } = request.query as { user?: string };
      const targetUserId =
        explicit !== undefined && explicit !== '' ? explicit : callerId;
      if (targetUserId !== callerId && !hasPermission(request, 'admin.system')) {
        return reply.code(403).send({ error: 'cannot view another user\'s effective roles' });
      }
      const result = await resolveEffectiveRoles(
        {
          organizations: storage.organizations,
          teams: storage.teams,
          teamOrgLinks: storage.teamOrgLinks,
          roles: storage.roles,
        },
        targetUserId,
      );
      return reply.send({
        user_id: targetUserId,
        orgs: result.map((r) => ({
          org_id: r.orgId,
          role: r.role,
          sources: r.sources.map((s) => ({
            kind: s.kind,
            ...(s.teamId !== undefined ? { team_id: s.teamId } : {}),
            role: s.role,
          })),
        })),
      });
    },
  );

  // ── GET /api/v1/teams/:teamId/members ───────────────────────────────────
  server.get(
    '/api/v1/teams/:teamId/members',
    {
      schema: {
        params: Type.Object({ teamId: Type.String() }),
        response: { 200: TeamMembersResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request: FastifyRequest<{ Params: { teamId: string } }>, reply) => {
      const team = await storage.teams.getTeam(request.params.teamId);
      if (team === null) return reply.code(404).send({ error: 'team not found' });
      if (!(await callerOrgAdminFor(request, team.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const members = await storage.teams.listTeamMembers(team.id);
      return reply.send({ members });
    },
  );

  // ── POST /api/v1/teams/:teamId/members ──────────────────────────────────
  server.post(
    '/api/v1/teams/:teamId/members',
    {
      schema: {
        params: Type.Object({ teamId: Type.String() }),
        body: SetMemberBody,
        response: { 200: Type.Object({ ok: Type.Boolean() }), 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (
      request: FastifyRequest<{ Params: { teamId: string }; Body: SetMember }>,
      reply,
    ) => {
      const team = await storage.teams.getTeam(request.params.teamId);
      if (team === null) return reply.code(404).send({ error: 'team not found' });
      if (!(await callerOrgAdminFor(request, team.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await storage.teams.setTeamMemberRole(team.id, request.body.user_id, request.body.role);
      await audit(storage, request, 'team_role.granted', team.id, {
        team_id: team.id,
        user_id: request.body.user_id,
        role: request.body.role,
      });
      return reply.send({ ok: true });
    },
  );

  // ── DELETE /api/v1/teams/:teamId/members/:userId ────────────────────────
  server.delete(
    '/api/v1/teams/:teamId/members/:userId',
    {
      schema: {
        params: Type.Object({ teamId: Type.String(), userId: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }), 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (
      request: FastifyRequest<{ Params: { teamId: string; userId: string } }>,
      reply,
    ) => {
      const team = await storage.teams.getTeam(request.params.teamId);
      if (team === null) return reply.code(404).send({ error: 'team not found' });
      if (!(await callerOrgAdminFor(request, team.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await storage.teams.removeTeamMember(team.id, request.params.userId);
      await audit(storage, request, 'team_role.revoked', team.id, {
        team_id: team.id,
        user_id: request.params.userId,
      });
      return reply.send({ ok: true });
    },
  );

  // ── GET /api/v1/teams/:teamId/org-links ─────────────────────────────────
  server.get(
    '/api/v1/teams/:teamId/org-links',
    {
      schema: {
        params: Type.Object({ teamId: Type.String() }),
        response: { 200: OrgLinksResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request: FastifyRequest<{ Params: { teamId: string } }>, reply) => {
      const team = await storage.teams.getTeam(request.params.teamId);
      if (team === null) return reply.code(404).send({ error: 'team not found' });
      const callerOrgId = request.user?.currentOrgId ?? '';
      const isAdmin =
        hasPermission(request, 'admin.system') ||
        (hasPermission(request, 'admin.org') &&
          (callerOrgId === team.orgId ||
            (await storage.teamOrgLinks.getLink(team.id, callerOrgId)) !== null));
      if (!isAdmin) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const [active, invites] = await Promise.all([
        storage.teamOrgLinks.listLinksForTeam(team.id),
        storage.teamOrgLinks.inviteListByTeam(team.id),
      ]);
      return reply.send({
        active_links: active.map((l) => ({
          team_id: l.teamId,
          org_id: l.orgId,
          linked_at: l.linkedAt,
          linked_by: l.linkedBy,
        })),
        invites: invites.map((i) => ({
          id: i.id,
          team_id: i.teamId,
          target_org_id: i.targetOrgId,
          invited_by: i.invitedBy,
          status: i.status,
          created_at: i.createdAt,
          decided_at: i.decidedAt,
          decided_by: i.decidedBy,
        })),
      });
    },
  );

  // ── POST /api/v1/teams/:teamId/org-links/invite ─────────────────────────
  server.post(
    '/api/v1/teams/:teamId/org-links/invite',
    {
      schema: {
        params: Type.Object({ teamId: Type.String() }),
        body: InviteBody,
        response: { 201: InviteResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (
      request: FastifyRequest<{ Params: { teamId: string }; Body: Invite }>,
      reply,
    ) => {
      const team = await storage.teams.getTeam(request.params.teamId);
      if (team === null) return reply.code(404).send({ error: 'team not found' });
      if (!(await callerOrgAdminFor(request, team.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (request.body.target_org_id === team.orgId) {
        return reply.code(409).send({ error: 'cannot link a team to its own home org' });
      }
      const invite = await storage.teamOrgLinks.inviteCreate(
        team.id,
        request.body.target_org_id,
        request.user?.username ?? request.user?.id ?? 'unknown',
      );
      if (invite === null) {
        return reply.code(409).send({ error: 'a pending invite already exists' });
      }
      await audit(storage, request, 'team_org_link.invited', invite.id, {
        team_id: team.id,
        target_org_id: request.body.target_org_id,
      });
      return reply.code(201).send({
        id: invite.id,
        team_id: invite.teamId,
        target_org_id: invite.targetOrgId,
        status: invite.status,
        created_at: invite.createdAt,
      });
    },
  );

  // ── POST /api/v1/team-org-link-invites/:inviteId/accept ─────────────────
  server.post(
    '/api/v1/team-org-link-invites/:inviteId/accept',
    {
      schema: {
        params: Type.Object({ inviteId: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }), 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (
      request: FastifyRequest<{ Params: { inviteId: string } }>,
      reply,
    ) => {
      const invite = await storage.teamOrgLinks.inviteGet(request.params.inviteId);
      if (invite === null) return reply.code(404).send({ error: 'invite not found' });
      if (!(await callerOrgAdminFor(request, invite.targetOrgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const link = await storage.teamOrgLinks.inviteAccept(
        invite.id,
        request.user?.username ?? request.user?.id ?? 'unknown',
      );
      if (link === null) return reply.code(409).send({ error: 'invite is not pending' });
      await audit(storage, request, 'team_org_link.accepted', invite.id, {
        team_id: invite.teamId,
        target_org_id: invite.targetOrgId,
      });
      return reply.send({ ok: true });
    },
  );

  // ── POST /api/v1/team-org-link-invites/:inviteId/decline ────────────────
  server.post(
    '/api/v1/team-org-link-invites/:inviteId/decline',
    {
      schema: {
        params: Type.Object({ inviteId: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }), 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (
      request: FastifyRequest<{ Params: { inviteId: string } }>,
      reply,
    ) => {
      const invite = await storage.teamOrgLinks.inviteGet(request.params.inviteId);
      if (invite === null) return reply.code(404).send({ error: 'invite not found' });
      if (!(await callerOrgAdminFor(request, invite.targetOrgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const updated = await storage.teamOrgLinks.inviteDecline(
        invite.id,
        request.user?.username ?? request.user?.id ?? 'unknown',
      );
      if (updated === null) return reply.code(409).send({ error: 'invite is not pending' });
      await audit(storage, request, 'team_org_link.declined', invite.id, {
        team_id: invite.teamId,
        target_org_id: invite.targetOrgId,
      });
      return reply.send({ ok: true });
    },
  );

  // ── DELETE /api/v1/teams/:teamId/org-links/:orgId ───────────────────────
  server.delete(
    '/api/v1/teams/:teamId/org-links/:orgId',
    {
      schema: {
        params: Type.Object({ teamId: Type.String(), orgId: Type.String() }),
        response: { 200: Type.Object({ ok: Type.Boolean() }), 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (
      request: FastifyRequest<{ Params: { teamId: string; orgId: string } }>,
      reply,
    ) => {
      const team = await storage.teams.getTeam(request.params.teamId);
      if (team === null) return reply.code(404).send({ error: 'team not found' });
      // Either side can sever the link.
      if (
        !(await callerOrgAdminFor(request, team.orgId)) &&
        !(await callerOrgAdminFor(request, request.params.orgId))
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const removed = await storage.teamOrgLinks.unlink(team.id, request.params.orgId);
      if (!removed) return reply.code(404).send({ error: 'no active link' });
      await audit(storage, request, 'team_org_link.revoked', team.id, {
        team_id: team.id,
        org_id: request.params.orgId,
      });
      return reply.send({ ok: true });
    },
  );
}
