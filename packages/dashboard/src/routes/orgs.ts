import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../db/index.js';
import { HtmlPageSchema, ErrorEnvelope } from '../api/schemas/envelope.js';
import { refererReturnTo } from './auth.js';

const OrgsCurrentResponse = Type.Object({}, { additionalProperties: true });

/** Back to the page the switch was made on, when the Referer names a page of the dashboard (refererReturnTo). */
function switchReturnTarget(request: FastifyRequest): string {
  return refererReturnTo(request.headers.referer, request.headers.host);
}

export async function orgRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // ── POST /orgs/switch — switch org context ──────────────────────────────
  server.post('/orgs/switch', { schema: { ...HtmlPageSchema, tags: ['orgs'] } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (user === undefined) {
      await reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    const { orgId } = request.body as { orgId?: string };

    const session = request.session as {
      set(key: string, value: unknown): void;
      get(key: string): unknown;
    };

    // Clear org context when orgId is 'system' or empty
    if (orgId === undefined || orgId === '' || orgId === 'system') {
      session.set('currentOrgId', '');
      const redirectTo = switchReturnTarget(request);
      await reply.redirect(redirectTo);
      return;
    }

    // Validate user belongs to the requested org
    const userOrgs = await storage.organizations.getUserOrgs(user.id);
    const belongsToOrg = userOrgs.some((org) => org.id === orgId);

    if (!belongsToOrg) {
      await reply.code(403).send({ error: 'You do not have access to this organization' });
      return;
    }

    session.set('currentOrgId', orgId);
    const redirectTo = switchReturnTarget(request);
    await reply.redirect(redirectTo);
  });

  // ── GET /orgs/current — return current org context (JSON) ───────────────
  server.get('/orgs/current', { schema: { tags: ['orgs'], response: { 200: OrgsCurrentResponse, 401: ErrorEnvelope } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (user === undefined) {
      await reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    // The organization this request acts in: the request middleware's resolution (the stored
    // session org, or the user's first organization when the session stores none, as right after
    // sign-in; for an API key header, the key's organization or the one X-Org-Id names). A cookie
    // that rides along with a key header is not consulted.
    const currentOrgId = user.currentOrgId ?? '';
    const currentOrg = currentOrgId !== '' ? await storage.organizations.getOrg(currentOrgId) : null;
    const userOrgs = await storage.organizations.getUserOrgs(user.id);

    return {
      currentOrgId: currentOrgId !== '' ? currentOrgId : null,
      currentOrg,
      userOrgs,
    };
  });
}
