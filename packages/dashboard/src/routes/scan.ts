import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ScanDb } from '../db/scans.js';
import type { ScanOrchestrator } from '../scanner/orchestrator.js';
import type { DashboardConfig } from '../config.js';
import { listJurisdictions, listRegulations } from '../compliance-client.js';
import { getToken, getOrgId } from './admin/helpers.js';

interface NewScanBody {
  siteUrl: string;
  standard: string;
  scanMode?: string;
  jurisdictions?: string | string[];
  concurrency?: string;
}

const VALID_STANDARDS = ['WCAG2A', 'WCAG2AA', 'WCAG2AAA'];

function normalizeJurisdictions(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

export async function scanRoutes(
  server: FastifyInstance,
  db: ScanDb,
  orchestrator: ScanOrchestrator,
  config: DashboardConfig,
): Promise<void> {
  // GET /scan/new — render new scan form
  server.get(
    '/scan/new',
    async (request: FastifyRequest, reply: FastifyReply) => {
      let jurisdictions: Array<{ id: string; name: string }> = [];
      let regulations: Array<{ id: string; name: string; shortName: string; jurisdictionId: string }> = [];

      try {
        const token = getToken(request);
        const orgId = getOrgId(request);
        const rawJ = await listJurisdictions(config.complianceUrl, token, orgId);
        jurisdictions = rawJ.map((j) => ({ id: j.id, name: j.name }));
        const rawR = await listRegulations(config.complianceUrl, token, undefined, orgId);
        regulations = rawR.map((r) => ({ id: r.id, name: r.name, shortName: r.shortName, jurisdictionId: r.jurisdictionId }));
      } catch {
        // Non-fatal
      }

      return reply.view('scan-new.hbs', {
        pageTitle: 'New Scan',
        currentPath: '/scan/new',
        user: request.user,
        jurisdictions,
        regulations,
        standards: VALID_STANDARDS,
        defaultStandard: 'WCAG2AA',
        maxConcurrency: 10,
        defaultConcurrency: config.maxConcurrentScans,
      });
    },
  );

  // POST /scan/new — validate, create record, queue scan
  server.post(
    '/scan/new',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as NewScanBody;

      // Validate siteUrl
      if (typeof body.siteUrl !== 'string' || body.siteUrl.trim() === '') {
        return reply.code(400).send({ error: 'siteUrl is required' });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(body.siteUrl.trim());
      } catch {
        return reply.code(400).send({ error: 'siteUrl must be a valid URL' });
      }

      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        return reply.code(400).send({ error: 'URL must use http or https' });
      }

      const standard = body.standard ?? 'WCAG2AA';
      if (!VALID_STANDARDS.includes(standard)) {
        return reply.code(400).send({ error: `standard must be one of: ${VALID_STANDARDS.join(', ')}` });
      }

      const concurrency = body.concurrency !== undefined
        ? parseInt(body.concurrency, 10)
        : config.maxConcurrentScans;

      if (isNaN(concurrency) || concurrency < 1 || concurrency > 10) {
        return reply.code(400).send({ error: 'concurrency must be between 1 and 10' });
      }

      const jurisdictions = normalizeJurisdictions(body.jurisdictions);
      if (jurisdictions.length > 50) {
        return reply.code(400).send({ error: 'Maximum 50 jurisdictions per scan' });
      }
      const scanMode = body.scanMode === 'single' ? 'single' : 'site';

      const scanId = randomUUID();

      db.createScan({
        id: scanId,
        siteUrl: parsedUrl.toString(),
        standard,
        jurisdictions,
        createdBy: request.user?.username ?? 'unknown',
        createdAt: new Date().toISOString(),
        orgId: request.user?.currentOrgId ?? 'system',
      });

      orchestrator.startScan(scanId, {
        siteUrl: parsedUrl.toString(),
        standard,
        concurrency,
        jurisdictions,
        scanMode,
        webserviceUrl: config.webserviceUrl,
        complianceUrl: config.complianceUrl,
        complianceToken: getToken(request),
      });

      await reply.redirect(`/scan/${scanId}/progress`);
    },
  );

  // GET /scan/:id/progress — render progress page
  server.get(
    '/scan/:id/progress',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const scan = db.getScan(id);
      if (scan === null) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      return reply.view('scan-progress.hbs', {
        pageTitle: 'Scan Progress',
        currentPath: `/scan/${id}/progress`,
        user: request.user,
        scan: {
          ...scan,
          jurisdictions: scan.jurisdictions.join(', '),
        },
      });
    },
  );

  // GET /scan/:id/events — SSE endpoint
  server.get(
    '/scan/:id/events',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const scan = db.getScan(id);
      if (scan === null) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      // If already completed or failed, send final event immediately
      if (scan.status === 'completed') {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const event = {
          type: 'complete',
          timestamp: new Date().toISOString(),
          data: { reportUrl: `/reports/${id}` },
        };
        reply.raw.write(`event: complete\ndata: ${JSON.stringify(event)}\n\n`);
        reply.raw.end();
        return;
      }

      if (scan.status === 'failed') {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const event = {
          type: 'failed',
          timestamp: new Date().toISOString(),
          data: { error: scan.error ?? 'Scan failed' },
        };
        reply.raw.write(`event: failed\ndata: ${JSON.stringify(event)}\n\n`);
        reply.raw.end();
        return;
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Send initial keepalive
      reply.raw.write(': connected\n\n');

      const listener = (event: { type: string; timestamp: string; data: unknown }): void => {
        reply.raw.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
        if (event.type === 'complete' || event.type === 'failed') {
          reply.raw.end();
        }
      };

      orchestrator.on(id, listener);

      request.raw.on('close', () => {
        orchestrator.off(id, listener);
      });
    },
  );
}
