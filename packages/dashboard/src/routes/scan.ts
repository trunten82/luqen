import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/index.js';
import type { ScanOrchestrator } from '../scanner/orchestrator.js';
import type { DashboardConfig } from '../config.js';
import { getToken, getOrgId } from './admin/helpers.js';
import {
  ScanService,
  VALID_STANDARDS,
  type InitiateScanInput,
} from '../services/scan-service.js';
import { ComplianceService } from '../services/compliance-service.js';

interface NewScanBody {
  siteUrl: string;
  standard: string;
  scanMode?: string;
  jurisdictions?: string | string[];
  concurrency?: string;
  maxPages?: string;
  runner?: string;
  incremental?: string;
  includeWarnings?: string | boolean;
  includeNotices?: string | boolean;
}

export async function scanRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  orchestrator: ScanOrchestrator,
  config: DashboardConfig,
): Promise<void> {
  const scanService = new ScanService(storage, orchestrator, config);
  const complianceService = new ComplianceService(config);

  // GET /scan/new — render new scan form
  server.get(
    '/scan/new',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { prefill?: string };
      const prefillUrl = typeof query.prefill === 'string' && query.prefill.trim() !== ''
        ? query.prefill.trim()
        : undefined;

      const token = getToken(request);
      const orgId = getOrgId(request);
      const lookupData = await complianceService.getComplianceLookupData(token, orgId);

      return reply.view('scan-new.hbs', {
        pageTitle: 'New Scan',
        currentPath: '/scan/new',
        user: request.user,
        jurisdictions: lookupData.jurisdictions,
        regulations: lookupData.regulations,
        complianceWarning: lookupData.warning,
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

      const input: InitiateScanInput = {
        siteUrl: body.siteUrl,
        standard: body.standard,
        scanMode: body.scanMode,
        jurisdictions: body.jurisdictions,
        concurrency: body.concurrency,
        maxPages: body.maxPages,
        runner: body.runner,
        incremental: body.incremental,
        includeWarnings: body.includeWarnings === 'true' || body.includeWarnings === true,
        includeNotices: body.includeNotices === 'true' || body.includeNotices === true,
      };

      const result = await scanService.initiateScan(input, {
        username: request.user?.username ?? 'unknown',
        orgId: request.user?.currentOrgId ?? 'system',
        complianceToken: getToken(request),
      });

      if (!result.ok) {
        const isHtmx = request.headers['hx-request'] === 'true';
        if (isHtmx || request.headers['accept']?.includes('text/html')) {
          const token = getToken(request);
          const orgId = getOrgId(request);
          const lookupData = await complianceService.getComplianceLookupData(token, orgId);
          return reply.code(400).view('scan-new.hbs', {
            pageTitle: 'New Scan',
            currentPath: '/scan/new',
            scanError: result.error,
            prefillUrl: body.siteUrl,
            jurisdictions: lookupData.jurisdictions,
            regulations: lookupData.regulations,
            complianceWarning: lookupData.warning,
            standards: VALID_STANDARDS,
            defaultStandard: body.standard || 'WCAG2AA',
            maxConcurrency: 10,
            defaultConcurrency: config.maxConcurrentScans,
            maxPages: config.maxPages,
          });
        }
        return reply.code(400).send({ error: result.error });
      }

      await reply.redirect(`/scan/${result.scanId}/progress`);
    },
  );

  // GET /scan/:id/progress — render progress page
  server.get(
    '/scan/:id/progress',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const orgId = request.user?.currentOrgId ?? 'system';

      const result = await scanService.getScanForOrg(id, orgId);
      if (!result.ok) {
        return reply.code(404).send({ error: result.error });
      }

      return reply.view('scan-progress.hbs', {
        pageTitle: 'Scan Progress',
        currentPath: `/scan/${id}/progress`,
        user: request.user,
        scan: {
          ...result.scan,
          jurisdictions: result.scan.jurisdictions.join(', '),
        },
      });
    },
  );

  // GET /scan/:id/events — SSE endpoint
  server.get(
    '/scan/:id/events',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const orgId = request.user?.currentOrgId ?? 'system';

      const lookupResult = await scanService.getScanForOrg(id, orgId);
      if (!lookupResult.ok) {
        return reply.code(404).send({ error: lookupResult.error });
      }

      const scan = lookupResult.scan;

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
