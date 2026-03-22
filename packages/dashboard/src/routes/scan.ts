import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from '../db/index.js';
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
  maxPages?: string;
  runner?: string;
  incremental?: string;
}

const VALID_STANDARDS = ['WCAG2A', 'WCAG2AA', 'WCAG2AAA'];

function normalizeJurisdictions(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

export async function scanRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  orchestrator: ScanOrchestrator,
  config: DashboardConfig,
): Promise<void> {
  // GET /scan/new — render new scan form
  server.get(
    '/scan/new',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { prefill?: string };
      const prefillUrl = typeof query.prefill === 'string' && query.prefill.trim() !== ''
        ? query.prefill.trim()
        : undefined;

      let jurisdictions: Array<{ id: string; name: string }> = [];
      let regulations: Array<{ id: string; name: string; shortName: string; jurisdictionId: string }> = [];
      let complianceWarning = '';

      try {
        const token = getToken(request);
        const orgId = getOrgId(request);
        const rawJ = await listJurisdictions(config.complianceUrl, token, orgId);
        jurisdictions = rawJ.map((j) => ({ id: j.id, name: j.name }));
        const rawR = await listRegulations(config.complianceUrl, token, undefined, orgId);
        regulations = rawR.map((r) => ({ id: r.id, name: r.name, shortName: r.shortName, jurisdictionId: r.jurisdictionId }));
      } catch {
        complianceWarning = 'Compliance service is unreachable. Jurisdiction and regulation selection is unavailable. Scans will still work without compliance checking.';
      }

      return reply.view('scan-new.hbs', {
        pageTitle: 'New Scan',
        currentPath: '/scan/new',
        user: request.user,
        jurisdictions,
        regulations,
        complianceWarning,
        standards: VALID_STANDARDS,
        defaultStandard: 'WCAG2AA',
        maxConcurrency: 10,
        defaultConcurrency: config.maxConcurrentScans,
        maxPages: config.maxPages,
        defaultRunner: config.runner ?? 'htmlcs',
        prefillUrl,
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

      // Pre-validate URL is reachable before starting scan
      try {
        const probe = await fetch(parsedUrl.toString(), {
          method: 'HEAD',
          signal: AbortSignal.timeout(10_000),
          redirect: 'follow',
        });
        if (!probe.ok && probe.status >= 500) {
          return reply.code(400).send({ error: `Site returned ${probe.status} — check the URL and try again.` });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
          return reply.code(400).send({ error: 'Domain not found — check the URL for typos.' });
        }
        if (msg.includes('ECONNREFUSED')) {
          return reply.code(400).send({ error: 'Connection refused — the server is not responding.' });
        }
        if (msg.includes('TimeoutError') || msg.includes('timed out')) {
          return reply.code(400).send({ error: 'Connection timed out — the site took too long to respond.' });
        }
        // Other network errors — let the scan proceed (WAFs may block HEAD)
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

      const VALID_RUNNERS = ['htmlcs', 'axe'];
      const runner = body.runner !== undefined && VALID_RUNNERS.includes(body.runner)
        ? (body.runner as 'htmlcs' | 'axe')
        : config.runner;

      const scanId = randomUUID();

      await storage.scans.createScan({
        id: scanId,
        siteUrl: parsedUrl.toString(),
        standard,
        jurisdictions,
        createdBy: request.user?.username ?? 'unknown',
        createdAt: new Date().toISOString(),
        orgId: request.user?.currentOrgId ?? 'system',
      });

      const incremental = body.incremental === 'true';

      const userMaxPages = body.maxPages !== undefined ? parseInt(body.maxPages, 10) : undefined;
      const maxPages = (userMaxPages !== undefined && !isNaN(userMaxPages) && userMaxPages >= 1 && userMaxPages <= 1000)
        ? userMaxPages
        : config.maxPages;

      orchestrator.startScan(scanId, {
        siteUrl: parsedUrl.toString(),
        standard,
        concurrency,
        jurisdictions,
        scanMode,
        webserviceUrl: config.webserviceUrl,
        ...(config.webserviceUrls !== undefined && config.webserviceUrls.length > 0
          ? { webserviceUrls: config.webserviceUrls }
          : {}),
        complianceUrl: config.complianceUrl,
        complianceToken: getToken(request),
        maxPages,
        ...(runner !== undefined ? { runner } : {}),
        ...(incremental ? { incremental, orgId: request.user?.currentOrgId ?? 'system' } : {}),
      });

      await reply.redirect(`/scan/${scanId}/progress`);
    },
  );

  // GET /scan/:id/progress — render progress page
  server.get(
    '/scan/:id/progress',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const scan = await storage.scans.getScan(id);
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

      const scan = await storage.scans.getScan(id);
      if (scan === null) {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Scan not found' });
      }

      // If already completed or failed, send final event immediately
      if (scan.status === 'completed' || scan.status === 'failed') {
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const eventType = scan.status === 'completed' ? 'complete' : 'failed';
        const eventData = scan.status === 'completed'
          ? { reportUrl: `/reports/${id}` }
          : { error: scan.error ?? 'Scan failed' };
        const event = { type: eventType, timestamp: new Date().toISOString(), data: eventData };
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(event)}\n\n`);
        res.end();
        return;
      }

      // Hijack the response so Fastify doesn't interfere with the raw SSE stream
      reply.hijack();

      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const send = (data: string): void => {
        res.write(data);
        // Flush immediately so the browser receives events without delay.
        // Some Node.js HTTP implementations buffer small writes.
        if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
          (res as unknown as { flush: () => void }).flush();
        }
      };

      // Send initial keepalive
      send(': connected\n\n');

      let closed = false;
      const listener = (event: { type: string; timestamp: string; data: unknown }): void => {
        if (closed) return;
        send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'complete' || event.type === 'failed') {
          closed = true;
          res.end();
        }
      };

      // Subscribe — replays buffered events and registers for future ones
      orchestrator.on(id, listener);

      request.raw.on('close', () => {
        closed = true;
        orchestrator.off(id, listener);
      });
    },
  );
}
