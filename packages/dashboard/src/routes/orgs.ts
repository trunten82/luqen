import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/index.js';

function safeRedirect(referer: string | undefined): string {
  if (referer == null || referer === '') return '/';
  // Only allow relative paths starting with /
  if (referer.startsWith('/') && !referer.startsWith('//')) return referer;
  return '/';
}

export async function orgRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // ── POST /orgs/switch — switch org context ──────────────────────────────
  server.post('/orgs/switch', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const redirectTo = safeRedirect(request.headers.referer as string | undefined);
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
    const redirectTo = safeRedirect(request.headers.referer as string | undefined);
    await reply.redirect(redirectTo);
  });

  // ── GET /orgs/current — return current org context (JSON) ───────────────
  server.get('/orgs/current', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (user === undefined) {
      await reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    const session = request.session as {
      get(key: string): unknown;
    };

    const currentOrgId = (session.get('currentOrgId') as string | undefined) ?? '';
    const currentOrg = currentOrgId !== '' ? await storage.organizations.getOrg(currentOrgId) : null;
    const userOrgs = await storage.organizations.getUserOrgs(user.id);

    return {
      currentOrgId: currentOrgId !== '' ? currentOrgId : null,
      currentOrg,
      userOrgs,
    };
  });
}
