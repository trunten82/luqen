import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import type { MonitoredSource } from '../../types.js';
import { acknowledgeUpdate } from '../../engine/proposals.js';
import { requireScope } from '../../auth/middleware.js';
import { createHash } from 'node:crypto';
import type { LLMClient } from '../../llm/llm-client.js';

const Source = Type.Object({}, { additionalProperties: true });
const SourceList = Type.Array(Source);
const SourceParams = Type.Object({ id: Type.String() });
const SourceBody = Type.Object({}, { additionalProperties: true });
const SourcePatchBody = Type.Object(
  { managementMode: Type.Optional(Type.Union([Type.Literal('llm'), Type.Literal('manual')])) },
  { additionalProperties: true },
);
const SourceScanQuery = Type.Object({ force: Type.Optional(Type.String()) }, { additionalProperties: true });
const SourceScanResponse = Type.Object({}, { additionalProperties: true });
const BulkSwitchBody = Type.Object(
  { mode: Type.Optional(Type.Union([Type.Literal('llm'), Type.Literal('manual')])) },
  { additionalProperties: true },
);
const SourceUploadBody = Type.Object(
  {
    content: Type.String(),
    name: Type.String(),
    url: Type.Optional(Type.String()),
    regulationId: Type.Optional(Type.String()),
    jurisdictionId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const SourceCreatedResponse = Type.Object({}, { additionalProperties: true });
const SourceReprocessResponse = Type.Object({}, { additionalProperties: true });
const PatchResponse = Type.Object({}, { additionalProperties: true });
const BulkResponse = Type.Object({}, { additionalProperties: true });

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

// ── Helper: extract jurisdiction ISO code from W3C policy URL ──────────────

function extractJurisdictionFromUrl(url: string): string {
  const match = url.match(/\/([^/]+)\.md$/);
  if (!match) return 'unknown';
  const name = match[1].replace(/-/g, ' ');
  const COUNTRY_MAP: Record<string, string> = {
    'germany': 'DE', 'france': 'FR', 'italy': 'IT', 'spain': 'ES',
    'united states': 'US', 'united kingdom': 'UK', 'australia': 'AU',
    'canada': 'CA', 'japan': 'JP', 'european union': 'EU',
    'netherlands': 'NL', 'austria': 'AT', 'belgium': 'BE',
    'sweden': 'SE', 'norway': 'NO', 'switzerland': 'CH',
    'ireland': 'IE', 'india': 'IN', 'brazil': 'BR',
    'argentina': 'AR', 'colombia': 'CO', 'mexico': 'MX',
    'chile': 'CL', 'china': 'CN', 'korea': 'KR',
    'hong kong': 'HK', 'taiwan': 'TW', 'israel': 'IL',
    'new zealand': 'NZ', 'south africa': 'ZA',
    'russian federation': 'RU', 'nigeria': 'NG',
    'kenya': 'KE', 'singapore': 'SG', 'thailand': 'TH',
  };
  return COUNTRY_MAP[name] ?? name.toUpperCase().slice(0, 2);
}

// ── Helper: generic paragraph-diff proposal ─────────────────────────────────

async function createGenericProposal(
  db: DbAdapter,
  source: MonitoredSource,
  content: string,
  contentHash: string,
  proposals: unknown[],
): Promise<void> {
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

/** Auto-acknowledge a certified proposal (trusted structured source). */
async function autoAcknowledgeCertified(
  db: DbAdapter,
  proposal: { readonly id: string; readonly trustLevel?: string },
): Promise<void> {
  if (proposal.trustLevel === 'certified') {
    try {
      await acknowledgeUpdate(db, proposal.id, 'system', 'Auto-acknowledged (certified source)');
    } catch { /* best-effort */ }
  }
}

export async function registerSourceRoutes(
  app: FastifyInstance,
  db: DbAdapter,
  llmClient?: LLMClient,
): Promise<void> {
  // GET /api/v1/sources
  app.get('/api/v1/sources', {
    schema: {
      tags: ['sources'],
      summary: 'List monitored sources',
      response: { 200: SourceList, 401: ErrorEnvelope, 500: ErrorEnvelope },
    },
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
    schema: {
      tags: ['sources'],
      summary: 'Create monitored source',
      body: SourceBody,
      response: { 201: Source, 400: ErrorEnvelope, 401: ErrorEnvelope },
    },
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
    schema: {
      tags: ['sources'],
      summary: 'Delete monitored source',
      params: SourceParams,
      response: { 204: Type.Null(), 403: ErrorEnvelope, 404: ErrorEnvelope, 500: ErrorEnvelope },
    },
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
    schema: {
      tags: ['sources'],
      summary: 'Trigger scan of monitored sources (use ?force=true for manual scan)',
      querystring: SourceScanQuery,
      // No body schema — endpoint may be POSTed with empty body.
      response: { 200: SourceScanResponse, 401: ErrorEnvelope, 500: ErrorEnvelope },
    },
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

      // Collect content hashes from ALL existing proposals (not just pending)
      // to prevent re-creating proposals when page has dynamic content but
      // the actual regulatory text hasn't changed
      const existingProposals = await db.listUpdateProposals();
      const proposalSourceUrls = new Set(
        existingProposals
          .filter((p) => p.status === 'pending')
          .map((p) => p.source),
      );
      // Track content hashes from recent proposals to detect "same content, different page chrome"
      const proposalContentHashes = new Set(
        existingProposals
          .filter((p) => p.status !== 'rejected' && p.status !== 'dismissed')
          .map((p) => {
            const after = p.proposedChanges?.after as Record<string, unknown> | undefined;
            return after?.contentHash as string | undefined;
          })
          .filter((h): h is string => h != null),
      );

      for (const source of sources) {
        try {
          // Fetch source content
          const response = await fetch(source.url, { signal: AbortSignal.timeout(10000) });
          const content = await response.text();
          const contentHash = createHash('sha256').update(content).digest('hex');

          scanned++;

          if (source.lastContentHash == null) {
            // First scan — baseline hash and store content
            baselined++;

            await db.updateSourceLastChecked(source.id, contentHash, content);
          } else if (source.lastContentHash !== contentHash) {
            changed++;
            // Content changed — route by sourceCategory
            // Skip if there's already ANY active proposal for this source
            // (pending, acknowledged, or reviewed — only create new if rejected/dismissed or none exist)
            const hasActiveProposal = existingProposals.some(
              (p) => p.source === source.url && p.status !== 'rejected' && p.status !== 'dismissed',
            );
            if (!hasActiveProposal) {
              const category = source.sourceCategory ?? 'generic';

              if (category === 'w3c-policy') {
                try {
                  const { parseW3cPolicyYaml } = await import('../../parsers/w3c-parser.js');
                  const jurisdictionId = extractJurisdictionFromUrl(source.url);
                  const parsed = parseW3cPolicyYaml(content, jurisdictionId);

                  if (parsed.length > 0) {
                    const summary = `W3C policy update for ${jurisdictionId}: ${parsed.length} regulation(s) found`;
                    const trustLevel = 'certified' as const;
                    const proposal = await db.createUpdateProposal({
                      source: source.url,
                      type: 'amendment',
                      summary,
                      trustLevel,
                      affectedJurisdictionId: jurisdictionId,
                      proposedChanges: {
                        action: 'update',
                        entityType: 'regulation',
                        after: {
                          contentHash,
                          regulations: parsed,
                        },
                      },
                    });
                    proposals.push(proposal);
                    await autoAcknowledgeCertified(db, proposal);
                  }
                } catch {
                  await createGenericProposal(db, source, content, contentHash, proposals);
                }
              } else if (category === 'wcag-upstream') {
                try {
                  const { parseQuickRefJson, parseTenOnJson } = await import('../../parsers/wcag-upstream-parser.js');
                  let parsed;
                  if (source.url.includes('wcag21.json') || source.url.includes('quickref')) {
                    parsed = parseQuickRefJson(JSON.parse(content));
                  } else {
                    parsed = parseTenOnJson(JSON.parse(content), '2.2');
                  }

                  if (parsed.length > 0) {
                    const proposal = await db.createUpdateProposal({
                      source: source.url,
                      type: 'new_requirement',
                      summary: `WCAG criteria upstream update: ${parsed.length} criteria parsed`,
                      trustLevel: 'certified',
                      proposedChanges: {
                        action: 'update',
                        entityType: 'requirement',
                        after: {
                          contentHash,
                          criteria: parsed,
                        },
                      },
                    });
                    proposals.push(proposal);
                    await autoAcknowledgeCertified(db, proposal);
                  }
                } catch {
                  await createGenericProposal(db, source, content, contentHash, proposals);
                }
              } else if (category === 'government' && source.managementMode === 'llm' && llmClient != null) {
                try {
                  const extracted = await llmClient.extractRequirements({
                    content,
                    regulationId: source.id,
                    regulationName: source.name,
                  });
                  const proposal = await db.createUpdateProposal({
                    source: source.url,
                    type: 'amendment',
                    summary: `LLM extraction for ${source.name}: ${extracted.criteria.length} criteria found (confidence ${extracted.confidence})`,
                    trustLevel: 'extracted',
                    proposedChanges: {
                      action: 'update',
                      entityType: 'regulation',
                      entityId: source.id,
                      before: { contentHash: source.lastContentHash },
                      after: {
                        contentHash,
                        wcagVersion: extracted.wcagVersion,
                        wcagLevel: extracted.wcagLevel,
                        criteria: extracted.criteria,
                        confidence: extracted.confidence,
                        model: extracted.model,
                        provider: extracted.provider,
                      },
                    },
                  });
                  proposals.push(proposal);
                  await db.updateSourceStatus(source.id, 'active');
                } catch {
                  // LLM extraction failed — create degraded generic proposal
                  await createGenericProposal(db, source, content, contentHash, proposals);
                  await db.updateSourceStatus(source.id, 'degraded');
                }
              } else {
                await createGenericProposal(db, source, content, contentHash, proposals);
              }
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

  // PATCH /api/v1/sources/:id — update managementMode
  app.patch('/api/v1/sources/:id', {
    schema: {
      tags: ['sources'],
      summary: 'Update source managementMode',
      params: SourceParams,
      body: SourcePatchBody,
      response: { 200: PatchResponse, 400: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('write')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { managementMode?: string };
      if (body.managementMode === 'llm' || body.managementMode === 'manual') {
        await db.updateSourceManagementMode(id, body.managementMode);
        await reply.send({ updated: true, managementMode: body.managementMode });
      } else {
        await reply.status(400).send({ error: 'managementMode must be "llm" or "manual"', statusCode: 400 });
      }
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/sources/bulk-switch-mode — switch all government sources
  app.post('/api/v1/sources/bulk-switch-mode', {
    schema: {
      tags: ['sources'],
      summary: 'Bulk switch government source management mode',
      body: BulkSwitchBody,
      response: { 200: BulkResponse, 400: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    const body = request.body as { mode?: string };
    if (body.mode !== 'llm' && body.mode !== 'manual') {
      await reply.status(400).send({ error: 'mode must be "llm" or "manual"', statusCode: 400 });
      return;
    }
    try {
      const sources = await db.listSources();
      let count = 0;
      for (const s of sources) {
        if (s.sourceCategory === 'government') {
          await db.updateSourceManagementMode(s.id, body.mode);
          count++;
        }
      }
      await reply.send({ updated: count, mode: body.mode });
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/sources/upload — upload document content for LLM parsing
  app.post('/api/v1/sources/upload', {
    schema: {
      tags: ['sources'],
      summary: 'Upload document content for LLM-based extraction',
      body: SourceUploadBody,
      response: {
        201: SourceCreatedResponse,
        400: ErrorEnvelope,
        500: ErrorEnvelope,
        503: ErrorEnvelope,
      },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    if (llmClient == null) {
      await reply.status(503).send({
        error: 'LLM service not configured. Set COMPLIANCE_LLM_URL, COMPLIANCE_LLM_CLIENT_ID, and COMPLIANCE_LLM_CLIENT_SECRET.',
        statusCode: 503,
      });
      return;
    }

    try {
      const body = request.body as {
        content: string;
        name: string;
        url?: string;
        regulationId?: string;
        jurisdictionId?: string;
      };
      const orgId = (request as unknown as { orgId?: string }).orgId ?? 'system';

      if (typeof body.content !== 'string' || body.content.length === 0) {
        await reply.status(400).send({ error: 'content is required', statusCode: 400 });
        return;
      }
      if (typeof body.name !== 'string' || body.name.length === 0) {
        await reply.status(400).send({ error: 'name is required', statusCode: 400 });
        return;
      }

      const sourceUrl = body.url ?? `upload://${Date.now()}/${encodeURIComponent(body.name)}`;

      // Create source record
      const source = await db.createSource({
        name: body.name,
        url: sourceUrl,
        type: 'html',
        schedule: 'monthly',
        sourceCategory: 'government',
        orgId,
      });

      // Extract requirements via LLM
      const extracted = await llmClient.extractRequirements({
        content: body.content,
        regulationId: body.regulationId ?? source.id,
        regulationName: body.name,
        jurisdictionId: body.jurisdictionId,
      });

      const contentHash = createHash('sha256').update(body.content).digest('hex');
      await db.updateSourceLastChecked(source.id, contentHash, body.content);

      const proposal = await db.createUpdateProposal({
        source: sourceUrl,
        type: 'new_regulation',
        summary: `Uploaded document "${body.name}": ${extracted.criteria.length} criteria extracted (confidence ${extracted.confidence})`,
        trustLevel: 'extracted',
        proposedChanges: {
          action: 'create',
          entityType: 'regulation',
          entityId: source.id,
          after: {
            contentHash,
            wcagVersion: extracted.wcagVersion,
            wcagLevel: extracted.wcagLevel,
            criteria: extracted.criteria,
            confidence: extracted.confidence,
            model: extracted.model,
            provider: extracted.provider,
          },
        },
        orgId,
      });

      await reply.status(201).send({ source, proposal });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      await reply.status(500).send({ error: message, statusCode: 500 });
    }
  });

  // POST /api/v1/sources/:id/reprocess — re-run LLM extraction on a source
  app.post('/api/v1/sources/:id/reprocess', {
    schema: {
      tags: ['sources'],
      summary: 'Re-run LLM extraction on stored source content',
      params: SourceParams,
      response: {
        200: SourceReprocessResponse,
        404: ErrorEnvelope,
        422: ErrorEnvelope,
        502: ErrorEnvelope,
        503: ErrorEnvelope,
      },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    if (llmClient == null) {
      await reply.status(503).send({
        error: 'LLM service not configured. Set COMPLIANCE_LLM_URL, COMPLIANCE_LLM_CLIENT_ID, and COMPLIANCE_LLM_CLIENT_SECRET.',
        statusCode: 503,
      });
      return;
    }

    try {
      const { id } = request.params as { id: string };

      const source = await db.getSource(id);
      if (source == null) {
        await reply.status(404).send({ error: `Source '${id}' not found`, statusCode: 404 });
        return;
      }

      // Fetch content — use stored content or re-fetch from URL
      let content = await db.getSourceContent(id);
      if (content == null) {
        if (!source.url.startsWith('upload://')) {
          const response = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
          content = await response.text();
        } else {
          await reply.status(422).send({
            error: 'No stored content for this source and URL is not fetchable.',
            statusCode: 422,
          });
          return;
        }
      }

      const extracted = await llmClient.extractRequirements({
        content,
        regulationId: source.id,
        regulationName: source.name,
      }).catch(async (err: unknown) => {
        await db.updateSourceStatus(id, 'degraded');
        throw err;
      });

      await db.updateSourceStatus(id, 'active');

      const contentHash = createHash('sha256').update(content).digest('hex');
      const proposal = await db.createUpdateProposal({
        source: source.url,
        type: 'amendment',
        summary: `Reprocessed "${source.name}": ${extracted.criteria.length} criteria extracted (confidence ${extracted.confidence})`,
        trustLevel: 'extracted',
        proposedChanges: {
          action: 'update',
          entityType: 'regulation',
          entityId: source.id,
          after: {
            contentHash,
            wcagVersion: extracted.wcagVersion,
            wcagLevel: extracted.wcagLevel,
            criteria: extracted.criteria,
            confidence: extracted.confidence,
            model: extracted.model,
            provider: extracted.provider,
          },
        },
      });

      await reply.send({ source: { ...source, status: 'active' as const }, proposal });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      const statusCode = message.includes('not found') ? 404 : 502;
      await reply.status(statusCode).send({ error: message, statusCode });
    }
  });
}
