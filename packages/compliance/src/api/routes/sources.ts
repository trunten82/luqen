import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { createHash } from 'node:crypto';

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
      await db.deleteSource(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/sources/scan
  app.post('/api/v1/sources/scan', {
    preHandler: [requireScope('admin')],
  }, async (_request, reply) => {
    try {
      const sources = await db.listSources();
      let scanned = 0;
      const proposals = [];

      for (const source of sources) {
        try {
          // Fetch source content
          const response = await fetch(source.url, { signal: AbortSignal.timeout(10000) });
          const content = await response.text();
          const contentHash = createHash('sha256').update(content).digest('hex');

          scanned++;

          if (source.lastContentHash !== contentHash) {
            // Content changed — create a proposal
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
            await db.updateSourceLastChecked(source.id, contentHash);
          } else {
            await db.updateSourceLastChecked(source.id, contentHash);
          }
        } catch {
          // Skip sources that fail to fetch
          scanned++;
        }
      }

      await reply.send({
        scanned,
        proposalsCreated: proposals.length,
        proposals,
      });
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
