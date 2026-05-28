/**
 * Phase 61 — WordPress Network mode API.
 *
 * Endpoints (all under /api/v1/):
 *   GET  /fleet                — list registered WP sites for the caller's org.
 *   POST /fleet                — idempotent register / heartbeat for one site.
 *   GET  /groups               — list teams (renamed for plugin UI clarity).
 *   POST /users/link           — link a WP user (site_url + wp_user_id) to a
 *                                dashboard user resolved by email.
 *
 * Auth: existing dashboard auth chain (session, API key, OAuth Bearer). All
 * queries scoped to `request.user.currentOrgId`; rejected with 401 if no org
 * context is resolvable.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const FleetQuerySchema = Type.Object(
  { status: Type.Optional(Type.Union([
    Type.Literal('active'), Type.Literal('stale'), Type.Literal('all'),
  ])) },
  { additionalProperties: false },
);

const RegisterFleetBodySchema = Type.Object(
  {
    url: Type.String({ minLength: 1, maxLength: 2048 }),
    wp_version: Type.Optional(Type.String({ maxLength: 32 })),
    plugin_version: Type.Optional(Type.String({ maxLength: 32 })),
  },
  { additionalProperties: false },
);

const LinkUserBodySchema = Type.Object(
  {
    site_url: Type.String({ minLength: 1, maxLength: 2048 }),
    wp_user_id: Type.Integer({ minimum: 1 }),
    wp_login: Type.String({ minLength: 1, maxLength: 200 }),
    email: Type.String({ minLength: 3, maxLength: 320 }),
  },
  { additionalProperties: false },
);

const ErrorResponse = Type.Object({ error: Type.String() });

const FleetSiteSchema = Type.Object({
  id:             Type.String(),
  url:            Type.String(),
  wp_version:     Type.Union([Type.String(), Type.Null()]),
  plugin_version: Type.Union([Type.String(), Type.Null()]),
  status:         Type.String(),
  last_seen:      Type.String(),
});

const FleetListResponse  = Type.Object({ sites: Type.Array(FleetSiteSchema) });
const FleetPostResponse  = Type.Object({ site_id: Type.String(), status: Type.String() });
const FleetSiteDetailResponse = Type.Object({ site: FleetSiteSchema });
const FleetSiteParams = Type.Object({ siteId: Type.String({ minLength: 1, maxLength: 64 }) });
type FleetSiteParamsT = Static<typeof FleetSiteParams>;
const GroupsResponse     = Type.Object({
  groups: Type.Array(Type.Object({
    id:           Type.String(),
    name:         Type.String(),
    org_id:       Type.String(),
    member_count: Type.Integer(),
  })),
});
const LinkUserResponse   = Type.Object({
  linked:         Type.Boolean(),
  link_id:        Type.String(),
  dashboard_user: Type.Union([
    Type.Object({ id: Type.String(), display_name: Type.String() }),
    Type.Null(),
  ]),
  groups:         Type.Array(Type.String()),
});

type RegisterFleetBody = Static<typeof RegisterFleetBodySchema>;
type LinkUserBody = Static<typeof LinkUserBodySchema>;
type FleetQuery = Static<typeof FleetQuerySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AuthContext {
  readonly orgId: string;
  readonly oauthClientId: string;
}

/**
 * Resolve org + OAuth client id from the authenticated request. Returns null
 * if the chain hasn't authenticated (caller should reply 401).
 *
 * - currentOrgId: present on session, API-key, and OAuth Bearer requests.
 * - oauthClientId: present on OAuth Bearer. Falls back to 'session' or
 *   'api-key:<id>' so registrations made from the dashboard UI (an unusual
 *   path, but possible during local dev) still have a stable bucket.
 */
function getAuthContext(request: FastifyRequest): AuthContext | null {
  const orgId = request.user?.currentOrgId;
  if (orgId == null || orgId === '') return null;
  const tokenClient = (request as unknown as { mcp?: { clientId?: string } }).mcp?.clientId;
  const oauthClientId =
    typeof tokenClient === 'string' && tokenClient !== ''
      ? tokenClient
      : request.user?.id === 'api-key'
        ? `api-key:${orgId}`
        : `user:${request.user?.id ?? 'unknown'}`;
  return { orgId, oauthClientId };
}

function requireAuthOrSend401(
  request: FastifyRequest,
  reply: FastifyReply,
): AuthContext | null {
  const ctx = getAuthContext(request);
  if (ctx === null) {
    reply.code(401).send({ error: 'authentication required' });
    return null;
  }
  return ctx;
}

const rateLimitConfig = {
  rateLimit: { max: 120, timeWindow: '1 minute' },
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function wpNetworkApiRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {

  // ── GET /api/v1/fleet ────────────────────────────────────────────────────
  server.get(
    '/api/v1/fleet',
    {
      config: rateLimitConfig,
      schema: {
        querystring: FleetQuerySchema,
        response: { 200: FleetListResponse, 401: ErrorResponse },
      },
    },
    async (request: FastifyRequest<{ Querystring: FleetQuery }>, reply) => {
      const ctx = requireAuthOrSend401(request, reply);
      if (ctx === null) return;
      const sites = await storage.wpSites.list({
        orgId: ctx.orgId,
        status: request.query.status ?? 'active',
      });
      return reply.send({
        sites: sites.map((s) => ({
          id: s.id,
          url: s.url,
          wp_version: s.wpVersion,
          plugin_version: s.pluginVersion,
          status: s.status,
          last_seen: s.lastSeenAt,
        })),
      });
    },
  );

  // ── GET /api/v1/fleet/:siteId ────────────────────────────────────────────
  // Per-site detail. Scoped to the caller's org — a 404 is returned both
  // when the row doesn't exist AND when it exists under a different org,
  // so existence isn't leaked across tenants.
  server.get(
    '/api/v1/fleet/:siteId',
    {
      config: rateLimitConfig,
      schema: {
        params: FleetSiteParams,
        response: {
          200: FleetSiteDetailResponse,
          401: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Params: FleetSiteParamsT }>, reply) => {
      const ctx = requireAuthOrSend401(request, reply);
      if (ctx === null) return;
      const site = await storage.wpSites.get(request.params.siteId);
      if (site === null || site.orgId !== ctx.orgId) {
        return reply.code(404).send({ error: 'site not found' });
      }
      return reply.send({
        site: {
          id: site.id,
          url: site.url,
          wp_version: site.wpVersion,
          plugin_version: site.pluginVersion,
          status: site.status,
          last_seen: site.lastSeenAt,
        },
      });
    },
  );

  // ── POST /api/v1/fleet ───────────────────────────────────────────────────
  server.post(
    '/api/v1/fleet',
    {
      config: rateLimitConfig,
      schema: {
        body: RegisterFleetBodySchema,
        response: { 201: FleetPostResponse, 401: ErrorResponse },
      },
    },
    async (request: FastifyRequest<{ Body: RegisterFleetBody }>, reply) => {
      const ctx = requireAuthOrSend401(request, reply);
      if (ctx === null) return;
      const site = await storage.wpSites.register({
        orgId: ctx.orgId,
        oauthClientId: ctx.oauthClientId,
        url: request.body.url,
        wpVersion: request.body.wp_version,
        pluginVersion: request.body.plugin_version,
      });
      return reply.code(201).send({ site_id: site.id, status: site.status });
    },
  );

  // ── GET /api/v1/groups ───────────────────────────────────────────────────
  server.get(
    '/api/v1/groups',
    {
      config: rateLimitConfig,
      schema: { response: { 200: GroupsResponse, 401: ErrorResponse } },
    },
    async (request, reply) => {
      const ctx = requireAuthOrSend401(request, reply);
      if (ctx === null) return;
      // Surface only the fields the plugin's group picker needs.
      const teams = await storage.teams.listTeamsByOrgId(ctx.orgId);
      return reply.send({
        groups: teams.map((t) => ({
          id: t.id,
          name: t.name,
          org_id: t.orgId,
          member_count: t.memberCount ?? 0,
        })),
      });
    },
  );

  // ── POST /api/v1/users/link ──────────────────────────────────────────────
  server.post(
    '/api/v1/users/link',
    {
      config: rateLimitConfig,
      schema: {
        body: LinkUserBodySchema,
        response: { 200: LinkUserResponse, 401: ErrorResponse },
      },
    },
    async (request: FastifyRequest<{ Body: LinkUserBody }>, reply) => {
      const ctx = requireAuthOrSend401(request, reply);
      if (ctx === null) return;

      const email = request.body.email.trim().toLowerCase();
      // Dashboard's primary identifier is `username` — by convention installs
      // use email as the username. Match case-insensitively against that.
      const dashUser =
        (await storage.users.getUserByUsername(email)) ??
        (await storage.users.getUserByUsername(request.body.email.trim()));
      const dashboardUserId = dashUser?.id ?? null;

      const link = await storage.wpUserLinks.upsert({
        siteUrl: request.body.site_url,
        wpUserId: request.body.wp_user_id,
        wpLogin: request.body.wp_login,
        email,
        dashboardUserId,
      });

      // Resolve groups (teams) for the linked user by scanning team
      // membership rows within the caller's org. Org team counts are tiny
      // (~tens), so the per-team listTeamMembers() roundtrip is acceptable
      // until we add a dedicated index method.
      const teamIds: string[] = [];
      if (dashboardUserId !== null) {
        const teams = await storage.teams.listTeamsByOrgId(ctx.orgId);
        for (const t of teams) {
          const members = await storage.teams.listTeamMembers(t.id);
          if (members.some((m) => m.userId === dashboardUserId)) {
            teamIds.push(t.id);
          }
        }
      }

      return reply.send({
        linked: dashboardUserId !== null,
        link_id: link.id,
        dashboard_user:
          dashUser !== null && dashUser !== undefined
            ? {
                id: dashUser.id,
                display_name: dashUser.username,
              }
            : null,
        groups: teamIds,
      });
    },
  );
}
