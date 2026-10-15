import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../db/index.js';
import type { ScanOrchestrator } from '../scanner/orchestrator.js';
import type { DashboardConfig } from '../config.js';
import { getToken, getOrgId, toastHtml } from './admin/helpers.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';

const ScanIdParams = Type.Object({ id: Type.String() }, { additionalProperties: true });
const SseSchema = {
  tags: ['streaming'],
  response: { 200: Type.String() },
  produces: ['text/event-stream'],
} as const;
import {
  ScanService,
  VALID_STANDARDS,
  type InitiateScanInput,
  type ScanControlRefusalKind,
  type ScanStartLimiter,
  type ScanStartSubject,
} from '../services/scan-service.js';
import { ComplianceService } from '../services/compliance-service.js';

interface NewScanBody {
  siteUrl: string;
  standard: string;
  scanMode?: string;
  jurisdictions?: string | string[];
  regulations?: string | string[];
  concurrency?: string;
  maxPages?: string;
  runner?: string;
  incremental?: string;
  behavioral?: string;
  deepScan?: string;
  includeWarnings?: string | boolean;
  includeNotices?: string | boolean;
  authHeaders?: string;
  authActions?: string;
}

/** The caller identity the shared scan-start limit is keyed on (form and retry use this one). */
function startSubjectOf(request: FastifyRequest): ScanStartSubject {
  return {
    userId: request.user?.id,
    apiKeyId: request.user?.apiKeyId,
    clientIp: request.ip,
  };
}

function permissionsOf(request: FastifyRequest): ReadonlySet<string> {
  const granted = (request as unknown as Record<string, unknown>)['permissions'] as
    | Set<string>
    | undefined;
  return granted ?? new Set<string>();
}

const CONTROL_STATUS: Readonly<Record<ScanControlRefusalKind, 400 | 403 | 404 | 429>> = {
  forbidden: 403,
  not_found: 404,
  invalid_state: 400,
  url_refused: 400,
  rate_limited: 429,
};

/**
 * Answer a refused retry or cancel. An HTMX caller gets the status with a
 * no-swap header and an error toast (a swapped 4xx body would replace the page);
 * everyone else gets the standard 403 page or a JSON error.
 */
function refuseScanControl(
  request: FastifyRequest,
  reply: FastifyReply,
  refusal: { readonly kind: ScanControlRefusalKind; readonly error: string; readonly retryAfterSeconds?: number },
): FastifyReply {
  const status = CONTROL_STATUS[refusal.kind];
  if (refusal.kind === 'rate_limited') {
    void reply.header('Retry-After', String(refusal.retryAfterSeconds ?? 1));
  }
  if (request.headers['hx-request'] === 'true') {
    return reply
      .code(status)
      .header('HX-Reswap', 'none')
      .header('content-type', 'text/html')
      .send(toastHtml(refusal.error, 'error'));
  }
  if (refusal.kind === 'forbidden') {
    const err = new Error('Forbidden') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
  return reply.code(status).send({ error: refusal.error });
}

export async function scanRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  orchestrator: ScanOrchestrator,
  config: DashboardConfig,
  /**
   * ComplianceService instance. When omitted (tests/legacy callers) a local
   * instance is created with a no-op token getter — the compliance lookup
   * will return its graceful-degradation fallback.
   */
  complianceService?: ComplianceService,
  /**
   * The scan-start limiter shared with GraphQL createScan (D-90-07). When
   * omitted the scan service keeps its own default limiter.
   */
  scanStartLimiter?: ScanStartLimiter,
): Promise<void> {
  const scanService = new ScanService(storage, orchestrator, config, undefined, scanStartLimiter);
  const complianceSvc = complianceService ?? new ComplianceService(config, () => null);

  // GET /scan/new — render new scan form
  server.get(
    '/scan/new',
    { schema: { ...HtmlPageSchema, tags: ['scan'] } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { prefill?: string };
      const prefillUrl = typeof query.prefill === 'string' && query.prefill.trim() !== ''
        ? query.prefill.trim()
        : undefined;

      const token = getToken(request);
      const orgId = getOrgId(request);
      const lookupData = await complianceSvc.getComplianceLookupData(token, orgId);

      // Per-org deep-scan default (migration 077). Failure-safe — a missing
      // org or column must never break rendering the form. `orgId` may be
      // undefined for unauthenticated/legacy callers; skip the lookup then.
      let deepScanDefault = false;
      if (orgId !== undefined) {
        try {
          deepScanDefault = await storage.organizations.getDeepScanDefault(orgId);
        } catch {
          deepScanDefault = false;
        }
      }

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
        deepScanDefault,
        prefillUrl,
      });
    },
  );

  // POST /scan/new — validate, create record, queue scan
  server.post(
    '/scan/new',
    {
      schema: { ...HtmlPageSchema, tags: ['scan'] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as NewScanBody;

      // Parse optional authentication headers (key: value, one per line)
      const parsedHeaders: Record<string, string> = {};
      if (typeof body.authHeaders === 'string' && body.authHeaders.trim() !== '') {
        for (const line of body.authHeaders.split('\n')) {
          const idx = line.indexOf(':');
          if (idx > 0) {
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            if (key.length > 0 && value.length > 0) {
              parsedHeaders[key] = value;
            }
          }
        }
      }

      // Parse optional pa11y actions (one per line)
      const parsedActions: string[] = [];
      if (typeof body.authActions === 'string' && body.authActions.trim() !== '') {
        for (const line of body.authActions.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            parsedActions.push(trimmed);
          }
        }
      }

      const input: InitiateScanInput = {
        siteUrl: body.siteUrl,
        standard: body.standard,
        scanMode: body.scanMode,
        jurisdictions: body.jurisdictions,
        regulations: body.regulations,
        concurrency: body.concurrency,
        maxPages: body.maxPages,
        runner: body.runner,
        incremental: body.incremental,
        behavioral: body.behavioral,
        deepScan: body.deepScan,
        includeWarnings: body.includeWarnings === 'true' || body.includeWarnings === true,
        includeNotices: body.includeNotices === 'true' || body.includeNotices === true,
        headers: Object.keys(parsedHeaders).length > 0 ? parsedHeaders : undefined,
        actions: parsedActions.length > 0 ? parsedActions : undefined,
      };

      // Same function GraphQL createScan uses: the scans.create permission and
      // the start rules are decided there (D-90-01).
      const result = await scanService.initiateScanAuthorized(input, {
        username: request.user?.username ?? 'unknown',
        orgId: request.user?.currentOrgId ?? 'system',
        complianceToken: getToken(request),
        permissions: permissionsOf(request),
        startSubject: startSubjectOf(request),
      });

      if (!result.ok) {
        const isHtmx = request.headers['hx-request'] === 'true';
        if (result.kind === 'forbidden') {
          // Same refusal shape as requirePermission(): JSON for HTMX callers,
          // the standard 403 page for everyone else.
          if (isHtmx) {
            return reply.code(403).send({ error: result.error });
          }
          const err = new Error('Forbidden') as Error & { statusCode: number };
          err.statusCode = 403;
          throw err;
        }
        // The scan form (HTMX or HTML callers) or a JSON body, same message either way.
        const refuse = async (status: 400 | 429): Promise<FastifyReply> => {
          if (isHtmx || request.headers['accept']?.includes('text/html')) {
            const token = getToken(request);
            const orgId = getOrgId(request);
            const lookupData = await complianceSvc.getComplianceLookupData(token, orgId);
            return reply.code(status).view('scan-new.hbs', {
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
          return reply.code(status).send({ error: result.error });
        };
        if (result.kind === 'rate_limited') {
          void reply.header('Retry-After', String(result.retryAfterSeconds ?? 1));
          return refuse(429);
        }
        return refuse(400);
      }

      await reply.redirect(`/scan/${result.scanId}/progress`);
    },
  );

  // GET /scan/:id/progress — render progress page
  server.get(
    '/scan/:id/progress',
    { schema: { ...HtmlPageSchema, tags: ['scan'], params: ScanIdParams } },
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
    { schema: { ...SseSchema, params: ScanIdParams } },
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

  // POST /reports/:id/retry — re-enqueue a stuck queued/failed scan
  server.post(
    '/reports/:id/retry',
    { schema: { ...HtmlPageSchema, tags: ['scan'], params: ScanIdParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await scanService.retryScanAuthorized(id, {
        permissions: permissionsOf(request),
        user: request.user,
        startSubject: startSubjectOf(request),
      });
      if (!result.ok) {
        return refuseScanControl(request, reply, result);
      }

      const isHtmx = request.headers['hx-request'] === 'true';
      if (isHtmx) {
        return reply
          .header('content-type', 'text/html')
          .header('HX-Redirect', `/scan/${id}/progress`)
          .send('');
      }
      return reply.redirect(`/scan/${id}/progress`);
    },
  );

  // POST /reports/:id/cancel — mark a stuck queued/running scan as failed
  server.post(
    '/reports/:id/cancel',
    { schema: { ...HtmlPageSchema, tags: ['scan'], params: ScanIdParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await scanService.cancelScanAuthorized(id, {
        permissions: permissionsOf(request),
        user: request.user,
        startSubject: startSubjectOf(request),
      });
      if (!result.ok) {
        return refuseScanControl(request, reply, result);
      }

      const isHtmx = request.headers['hx-request'] === 'true';
      if (isHtmx) {
        return reply
          .header('content-type', 'text/html')
          .header('HX-Redirect', `/reports/${id}`)
          .send('');
      }
      return reply.redirect(`/reports/${id}`);
    },
  );
}
