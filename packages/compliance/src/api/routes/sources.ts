import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import type { MonitoredSource } from '../../types.js';
import { requireScope } from '../../auth/middleware.js';
import { createHash } from 'node:crypto';

const SCHEDULE_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/** Check if a source is due for a scan based on its schedule and lastCheckedAt. */
function isSourceDue(source: MonitoredSource): boolean {
  if (source.lastCheckedAt == null) return true; // never checked
  const intervalMs = SCHEDULE_MS[source.schedule] ?? SCHEDULE_MS.weekly;
  const lastChecked = new Date(source.lastCheckedAt).getTime();
  return Date.now() - lastChecked >= intervalMs;
}

export async function registerSourceRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/sources
  app.get('/api/v1/sources', {
    preHandler: [requireScope('read')],
  }, async (request, reply) => {
    try {
      const orgId = (request as unknown as { orgId?: string }).orgId;
      const filters = orgId != null ? { orgId } : undefined;
      const sources = await db.listSources(filters);
      await reply.send(sources);
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/sources
  app.post('/api/v1/sources', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof db.createSource>[0];
      const orgId = (request as unknown as { orgId?: string }).orgId ?? 'system';
      const source = await db.createSource({ ...body, orgId });
      await reply.status(201).send(source);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // DELETE /api/v1/sources/:id
  app.delete('/api/v1/sources/:id', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const requestOrgId = (request as unknown as { orgId?: string }).orgId;
      const recordOrgId = await db.getSourceOrgId(id);
      if (recordOrgId == null) {
        await reply.status(404).send({ error: `Source '${id}' not found`, statusCode: 404 });
        return;
      }
      if (recordOrgId === 'system' && requestOrgId !== 'system') {
        await reply.status(403).send({ error: 'Cannot delete system data', statusCode: 403 });
        return;
      }
      if (requestOrgId != null && recordOrgId !== 'system' && recordOrgId !== requestOrgId) {
        await reply.status(403).send({ error: 'Cannot delete data belonging to another organisation', statusCode: 403 });
        return;
      }
      await db.deleteSource(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/sources/scan
  // Query param ?force=true skips schedule check (used by manual "Scan Now" button)
  app.post('/api/v1/sources/scan', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const query = request.query as { force?: string };
      const force = query.force === 'true';
      const allSources = await db.listSources();

      // Filter to sources that are due unless force=true (manual scan)
      const sources = force ? allSources : allSources.filter((s) => isSourceDue(s));

      let scanned = 0;
      let changed = 0;
      let baselined = 0;
      let failed = 0;
      const proposals = [];

      // Fetch existing pending proposals to avoid duplicates
      const existingPending = await db.listUpdateProposals({ status: 'pending' });
      const pendingSourceUrls = new Set(existingPending.map((p) => p.source));

      for (const source of sources) {
        try {
          // Fetch source content
          const response = await fetch(source.url, { signal: AbortSignal.timeout(10000) });
          const content = await response.text();
          const contentHash = createHash('sha256').update(content).digest('hex');

          scanned++;

          if (source.lastContentHash == null) {
            // First scan — just baseline the hash, don't create a proposal
            baselined++;
            await db.updateSourceLastChecked(source.id, contentHash);
          } else if (source.lastContentHash !== contentHash) {
            changed++;
            // Content changed — create proposal only if no pending proposal for this source
            if (!pendingSourceUrls.has(source.url)) {
              const proposal = await db.createUpdateProposal({
                source: source.url,
                type: 'amendment',
                summary: `Content change detected at ${source.name} (${source.url})`,
                proposedChanges: {
                  action: 'update',
                  entityType: 'regulation',
                  entityId: source.id,
                  before: { contentHash: source.lastContentHash },
                  after: { contentHash },
                },
              });
              proposals.push(proposal);
            }
            await db.updateSourceLastChecked(source.id, contentHash);
          } else {
            await db.updateSourceLastChecked(source.id, contentHash);
          }
        } catch {
          // Skip sources that fail to fetch
          scanned++;
          failed++;
        }
      }

      await reply.send({
        scanned,
        changed,
        baselined,
        failed,
        proposalsCreated: proposals.length,
        proposals,
      });
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
