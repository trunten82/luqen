import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import type { MonitoredSource } from '../../types.js';
import { requireScope } from '../../auth/middleware.js';
import { createHash } from 'node:crypto';

// ── Lightweight inline diff for source content ──────────────────────────────

interface ContentDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly string[];
  readonly summary: string;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}|(?<=[.!?])\s{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

function computeDiff(oldContent: string, newContent: string): ContentDiff {
  const oldItems = splitParagraphs(oldContent);
  const newItems = splitParagraphs(newContent);
  const oldSet = new Set(oldItems);
  const newSet = new Set(newItems);

  const rawAdded = newItems.filter((item) => !oldSet.has(item));
  const rawRemoved = oldItems.filter((item) => !newSet.has(item));

  // Find modified: removed+added pairs with >50% word overlap
  const modified: string[] = [];
  const matchedR = new Set<number>();
  const matchedA = new Set<number>();

  for (let ri = 0; ri < rawRemoved.length; ri++) {
    const rWords = new Set(rawRemoved[ri].toLowerCase().split(/\s+/));
    for (let ai = 0; ai < rawAdded.length; ai++) {
      if (matchedA.has(ai)) continue;
      const aWords = new Set(rawAdded[ai].toLowerCase().split(/\s+/));
      const intersection = [...rWords].filter((w) => aWords.has(w)).length;
      const union = new Set([...rWords, ...aWords]).size;
      if (union > 0 && intersection / union > 0.5) {
        modified.push(`"${truncate(rawRemoved[ri], 120)}" → "${truncate(rawAdded[ai], 120)}"`);
        matchedR.add(ri);
        matchedA.add(ai);
        break;
      }
    }
  }

  const added = rawAdded.filter((_, i) => !matchedA.has(i)).map((s) => truncate(s, 200));
  const removed = rawRemoved.filter((_, i) => !matchedR.has(i)).map((s) => truncate(s, 200));

  const parts: string[] = [];
  if (added.length > 0) parts.push(`${added.length} section(s) added`);
  if (removed.length > 0) parts.push(`${removed.length} section(s) removed`);
  if (modified.length > 0) parts.push(`${modified.length} section(s) modified`);
  const summary = parts.length > 0 ? parts.join(', ') + '.' : 'Content changed (formatting only).';

  return { added, removed, modified, summary };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

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
            // First scan — just baseline the hash and store content
            baselined++;
            await db.updateSourceLastChecked(source.id, contentHash, content);
          } else if (source.lastContentHash !== contentHash) {
            changed++;
            // Content changed — compute diff and create proposal
            if (!pendingSourceUrls.has(source.url)) {
              const oldContent = await db.getSourceContent(source.id);
              const diff = oldContent != null ? computeDiff(oldContent, content) : null;

              const proposal = await db.createUpdateProposal({
                source: source.url,
                type: 'amendment',
                summary: diff != null
                  ? `${source.name}: ${diff.summary}`
                  : `Content change detected at ${source.name} (${source.url})`,
                proposedChanges: {
                  action: 'update',
                  entityType: 'regulation',
                  entityId: source.id,
                  before: { contentHash: source.lastContentHash },
                  after: {
                    contentHash,
                    ...(diff != null ? { diff: { added: diff.added, removed: diff.removed, modified: diff.modified } } : {}),
                  },
                },
              });
              proposals.push(proposal);
            }
            await db.updateSourceLastChecked(source.id, contentHash, content);
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
