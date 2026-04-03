import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import type { IComplianceLLMProvider, MonitoredSource } from '../../types.js';
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

export async function registerSourceRoutes(
  app: FastifyInstance,
  db: DbAdapter,
  llmProvider?: IComplianceLLMProvider,
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
            // First scan — baseline hash and store content
            baselined++;

            // For government sources with LLM available, extract requirements on first scan
            const firstCategory = source.sourceCategory ?? 'generic';
            if (firstCategory === 'government' && llmProvider != null && !pendingSourceUrls.has(source.url)) {
              try {
                const allRegs = await db.listRegulations();
                const matchedReg = allRegs.find(r => r.url === source.url);

                const extracted = await llmProvider.extractRequirements(content, {
                  regulationId: matchedReg?.id ?? source.name,
                  regulationName: matchedReg?.name ?? source.name,
                });

                if (extracted.criteria.length > 0) {
                  const reqs = extracted.criteria.map(c => ({
                    regulationId: matchedReg?.id ?? '',
                    wcagVersion: extracted.wcagVersion as '2.0' | '2.1' | '2.2',
                    wcagLevel: c.obligation === 'excluded' ? 'A' as const : 'AA' as const,
                    wcagCriterion: c.criterion,
                    obligation: c.obligation,
                    ...(c.notes ? { notes: c.notes } : {}),
                  }));

                  const proposal = await db.createUpdateProposal({
                    source: source.url,
                    type: 'new_requirement',
                    affectedRegulationId: matchedReg?.id,
                    summary: `Initial LLM extraction (confidence: ${(extracted.confidence * 100).toFixed(0)}%): ${reqs.length} requirement(s) found`,
                    proposedChanges: {
                      action: 'update',
                      entityType: 'requirement',
                      after: {
                        contentHash,
                        regulationId: matchedReg?.id ?? '',
                        diff: { added: reqs, removed: [], changed: [] },
                        confidence: extracted.confidence,
                      },
                    },
                  });
                  proposals.push(proposal);
                }
              } catch { /* LLM extraction failed — still baseline the hash */ }
            }

            await db.updateSourceLastChecked(source.id, contentHash, content);
          } else if (source.lastContentHash !== contentHash) {
            changed++;
            // Content changed — route by sourceCategory
            if (!pendingSourceUrls.has(source.url)) {
              const category = source.sourceCategory ?? 'generic';

              if (category === 'w3c-policy') {
                try {
                  const { parseW3cPolicyYaml } = await import('../../parsers/w3c-parser.js');
                  const jurisdictionId = extractJurisdictionFromUrl(source.url);
                  const parsed = parseW3cPolicyYaml(content, jurisdictionId);

                  if (parsed.length > 0) {
                    const summary = `W3C policy update for ${jurisdictionId}: ${parsed.length} regulation(s) found`;
                    const proposal = await db.createUpdateProposal({
                      source: source.url,
                      type: 'amendment',
                      summary,
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
                  }
                } catch {
                  await createGenericProposal(db, source, content, contentHash, proposals);
                }
              } else if (category === 'government' && llmProvider != null) {
                try {
                  const allRegs = await db.listRegulations();
                  const matchedReg = allRegs.find(r => r.url === source.url);

                  const extracted = await llmProvider.extractRequirements(content, {
                    regulationId: matchedReg?.id ?? source.name,
                    regulationName: matchedReg?.name ?? source.name,
                    currentWcagVersion: undefined,
                    currentWcagLevel: undefined,
                  });

                  const { diffRequirements } = await import('../../parsers/requirement-differ.js');
                  const currentReqs = matchedReg
                    ? await db.listRequirements({ regulationId: matchedReg.id })
                    : [];
                  const extractedReqs = extracted.criteria.map(c => ({
                    regulationId: matchedReg?.id ?? '',
                    wcagVersion: extracted.wcagVersion as '2.0' | '2.1' | '2.2',
                    wcagLevel: c.obligation === 'excluded' ? 'A' as const : 'AA' as const,
                    wcagCriterion: c.criterion,
                    obligation: c.obligation,
                    ...(c.notes ? { notes: c.notes } : {}),
                  }));

                  const diff = diffRequirements(matchedReg?.id ?? '', currentReqs, extractedReqs);

                  if (diff.hasChanges) {
                    const proposal = await db.createUpdateProposal({
                      source: source.url,
                      type: 'amendment',
                      affectedRegulationId: matchedReg?.id,
                      summary: `LLM-extracted changes (confidence: ${(extracted.confidence * 100).toFixed(0)}%): ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`,
                      proposedChanges: {
                        action: 'update',
                        entityType: 'requirement',
                        after: {
                          contentHash,
                          regulationId: matchedReg?.id ?? '',
                          diff: { added: diff.added, removed: diff.removed, changed: diff.changed },
                          confidence: extracted.confidence,
                        },
                      },
                    });
                    proposals.push(proposal);
                  }
                } catch {
                  await createGenericProposal(db, source, content, contentHash, proposals);
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

  // POST /api/v1/sources/upload — upload document content for LLM parsing
  // Creates a source record + proposal with extracted requirements
  app.post('/api/v1/sources/upload', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      if (llmProvider == null) {
        await reply.status(503).send({
          error: 'No LLM provider configured. Set DASHBOARD_URL and DASHBOARD_API_KEY environment variables and ensure an LLM plugin is active.',
          statusCode: 503,
        });
        return;
      }

      const body = request.body as {
        content?: string;
        name?: string;
        regulationId?: string;
        regulationName?: string;
        jurisdictionId?: string;
        url?: string;
      };

      if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
        await reply.status(400).send({ error: 'content is required (text/HTML of the regulation document)', statusCode: 400 });
        return;
      }

      const name = body.name ?? 'Uploaded document';
      const regId = body.regulationId ?? name;
      const regName = body.regulationName ?? name;
      const sourceUrl = body.url ?? `upload://${name.replace(/\s+/g, '-').toLowerCase()}`;

      // Extract requirements via LLM
      const extracted = await llmProvider.extractRequirements(body.content, {
        regulationId: regId,
        regulationName: regName,
      });

      if (extracted.criteria.length === 0) {
        await reply.send({
          message: 'LLM could not extract any WCAG requirements from the document.',
          confidence: extracted.confidence,
          criteria: [],
        });
        return;
      }

      // Create or find source record
      const orgId = (request as unknown as { orgId?: string }).orgId ?? 'system';
      const contentHash = createHash('sha256').update(body.content).digest('hex');

      let sourceRecord;
      try {
        sourceRecord = await db.createSource({
          name,
          url: sourceUrl,
          type: 'html',
          schedule: 'monthly',
          sourceCategory: 'government',
          orgId,
        });
      } catch {
        // Source may already exist
        const existing = await db.listSources();
        sourceRecord = existing.find(s => s.url === sourceUrl) ?? null;
      }

      // Find matching regulation if regulationId provided
      const allRegs = await db.listRegulations();
      const matchedReg = body.regulationId
        ? allRegs.find(r => r.id === body.regulationId)
        : allRegs.find(r => r.url === sourceUrl);

      // Build requirement records
      const reqs = extracted.criteria.map(c => ({
        regulationId: matchedReg?.id ?? regId,
        wcagVersion: extracted.wcagVersion as '2.0' | '2.1' | '2.2',
        wcagLevel: c.obligation === 'excluded' ? 'A' as const : 'AA' as const,
        wcagCriterion: c.criterion,
        obligation: c.obligation,
        ...(c.notes ? { notes: c.notes } : {}),
      }));

      // Create proposal
      const proposal = await db.createUpdateProposal({
        source: sourceUrl,
        type: 'new_requirement',
        affectedRegulationId: matchedReg?.id,
        affectedJurisdictionId: body.jurisdictionId,
        summary: `Uploaded document "${name}": ${reqs.length} requirement(s) extracted (confidence: ${(extracted.confidence * 100).toFixed(0)}%)`,
        proposedChanges: {
          action: 'update',
          entityType: 'requirement',
          after: {
            contentHash,
            regulationId: matchedReg?.id ?? regId,
            diff: { added: reqs, removed: [], changed: [] },
            confidence: extracted.confidence,
          },
        },
        orgId,
      });

      // Store content hash on source
      if (sourceRecord) {
        await db.updateSourceLastChecked(sourceRecord.id, contentHash, body.content);
      }

      await reply.status(201).send({
        message: `Extracted ${reqs.length} requirement(s) from "${name}"`,
        confidence: extracted.confidence,
        wcagVersion: extracted.wcagVersion,
        wcagLevel: extracted.wcagLevel,
        criteriaCount: reqs.length,
        proposal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload processing failed';
      await reply.status(500).send({ error: message, statusCode: 500 });
    }
  });
}
