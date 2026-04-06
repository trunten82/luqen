import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DashboardConfig } from './config.js';
import { registerSession, getSessionExpiryMs, createSessionExpiryHook } from './auth/session.js';
import { createAuthGuard } from './auth/middleware.js';
import { AuthService } from './auth/auth-service.js';
import { authRoutes } from './routes/auth.js';
import { homeRoutes } from './routes/home.js';
import { scanRoutes } from './routes/scan.js';
import { reportRoutes } from './routes/reports.js';
import { compareRoutes } from './routes/compare.js';
import { trendRoutes } from './routes/trends.js';
import { scheduleRoutes } from './routes/schedules.js';
import { startScheduler } from './scheduler.js';
import { manualTestRoutes } from './routes/manual-tests.js';
import { assignmentRoutes } from './routes/assignments.js';
import { jurisdictionRoutes } from './routes/admin/jurisdictions.js';
import { regulationRoutes } from './routes/admin/regulations.js';
import { proposalRoutes } from './routes/admin/proposals.js';
import { sourceRoutes } from './routes/admin/sources.js';
import { webhookRoutes } from './routes/admin/webhooks.js';
import { userRoutes } from './routes/admin/users.js';
import { clientRoutes } from './routes/admin/clients.js';
import { registerServiceConnectionsRoutes } from './routes/admin/service-connections.js';
import { systemBrandGuidelineRoutes } from './routes/admin/system-brand-guidelines.js';
import { systemRoutes } from './routes/admin/system.js';
import { monitorRoutes } from './routes/admin/monitor.js';
import { pluginAdminRoutes } from './routes/admin/plugins.js';
import { pluginApiRoutes } from './routes/api/plugins.js';
import { sourceApiRoutes } from './routes/api/sources.js';
import { generateApiKey, storeApiKey } from './auth/api-key.js';
import { exportRoutes } from './routes/api/export.js';
import { dataApiRoutes } from './routes/api/data.js';
import { brandingApiRoutes } from './routes/api/branding.js';
import { orgRoutes } from './routes/orgs.js';
import { toolRoutes } from './routes/tools.js';
import { repoRoutes } from './routes/repos.js';
import { gitCredentialRoutes } from './routes/git-credentials.js';
import { fixPrRoutes } from './routes/fix-pr.js';
import { resolveStorageAdapter } from './db/index.js';
import { SqliteStorageAdapter } from './db/sqlite/index.js';
import { PluginManager } from './plugins/manager.js';
import { loadRegistry } from './plugins/registry.js';
import { ScanOrchestrator } from './scanner/orchestrator.js';
import { createRedisClient, RedisScanQueue, SsePublisher } from './cache/redis.js';
import { dashboardUserRoutes } from './routes/admin/dashboard-users.js';
import { apiKeyRoutes } from './routes/admin/api-keys.js';
import { organizationRoutes } from './routes/admin/organizations.js';
import { VERSION } from './version.js';
import { getFixSuggestion } from './fix-suggestions.js';
import { ALL_PERMISSION_IDS, resolveEffectivePermissions } from './permissions.js';
import { roleRoutes } from './routes/admin/roles.js';
import { teamRoutes } from './routes/admin/teams.js';
import { emailReportRoutes } from './routes/admin/email-reports.js';
import { setupRoutes } from './routes/api/setup.js';
import { startEmailScheduler } from './email/scheduler.js';
import { startSourceMonitorScheduler } from './source-monitor-scheduler.js';
import { ComplianceService } from './services/compliance-service.js';
import { ServiceClientRegistry } from './services/service-client-registry.js';
import { SqliteServiceConnectionsRepository } from './db/sqlite/service-connections-sqlite.js';
import { importFromConfigIfEmpty } from './services/service-connections-bootstrap.js';
import { createComplianceClient } from './compliance-client.js';
import { createBrandingOrgClient } from './branding-client.js';
import { createLLMOrgClient } from './llm-client.js';
import { enforceApiKeyRole } from './auth/api-key-guard.js';
import { auditRoutes } from './routes/admin/audit.js';
import { changeHistoryRoutes } from './routes/admin/change-history.js';
import { gitHostRoutes } from './routes/admin/git-hosts.js';
import { brandingGuidelineRoutes } from './routes/admin/branding-guidelines.js';
import { llmAdminRoutes } from './routes/admin/llm.js';
import { setGitHostPluginManager } from './git-hosts/registry.js';
import { loadTranslations, t, SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from './i18n/index.js';
import mercurius from 'mercurius';
import { schema as graphqlSchema } from './graphql/schema.js';
import { resolvers as graphqlResolvers } from './graphql/resolvers.js';
import type { GraphQLContext } from './graphql/resolvers.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function wantsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept || '';
  const isHtmx = request.headers['hx-request'] === 'true';
  return !isHtmx && accept.includes('text/html');
}

// Routes that bypass auth guard
const PUBLIC_PATHS = new Set(['/login', '/health', '/api/v1/setup', '/robots.txt']);

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith('/static/')) return true;
  if (path.startsWith('/auth/callback/')) return true;
  if (path.startsWith('/auth/sso/')) return true;
  return false;
}

// HTTP methods that mutate state and require CSRF verification
const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Paths exempt from CSRF verification (API-key auth, OAuth callbacks, GraphQL)
function isCsrfExempt(path: string): boolean {
  if (path.startsWith('/api/')) return true;
  if (path.startsWith('/auth/callback/')) return true;
  if (path.startsWith('/auth/sso/')) return true;
  if (path === '/graphql') return true;
  if (path === '/health') return true;
  return false;
}

export async function createServer(config: DashboardConfig): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env['NODE_ENV'] === 'production' ? 'warn' : 'info',
    },
    trustProxy: true,
  });

  // ── Database ──────────────────────────────────────────────────────────────
  const storage = await resolveStorageAdapter({ type: 'sqlite', sqlite: { dbPath: config.dbPath } });
  // For consumers that still need raw DB (PluginManager, AuthService):
  const rawDb = (storage as SqliteStorageAdapter).getRawDatabase();

  // ── Plugin Manager ──────────────────────────────────────────────────────
  const registryEntries = await loadRegistry({
    catalogueUrl: config.catalogueUrl,
    cacheTtlSeconds: config.catalogueCacheTtl,
  });
  const pluginManager = new PluginManager({
    db: rawDb,
    pluginsDir: resolve(config.reportsDir, '..', 'plugins'),
    encryptionKey: config.sessionSecret,
    registryEntries,
  });
  await pluginManager.initializeOnStartup();

  setGitHostPluginManager(pluginManager);

  pluginManager.startHealthChecks(60_000);

  // ── Auth Service ────────────────────────────────────────────────────────
  const authService = new AuthService(rawDb, pluginManager, storage);

  // ── Solo mode: first-start API key ──────────────────────────────────────
  if (authService.getAuthMode() === 'solo') {
    const { key, isNew } = await storage.apiKeys.getOrCreateKey();
    if (isNew) {
      server.log.info('');
      server.log.info('========================================');
      server.log.info('  LUQEN DASHBOARD — First Start');
      server.log.info('  API Key: ' + key);
      server.log.info('  Save this key — it will not be shown again.');
      server.log.info('========================================');
      server.log.info('');
    }
  }

  // ── Service Connections Registry (compliance + branding + LLM) ──────────
  // The registry is the single owner of the three outbound service clients
  // and supports runtime hot-swap (Phase 06 D-07..D-11). server.ts holds
  // only the registry handle; routes receive getter functions and resolve
  // the current live client inside each handler so that an admin UI save
  // (plan 06-03) is picked up without a restart.
  const serviceConnectionsRepo = new SqliteServiceConnectionsRepository(
    rawDb,
    config.sessionSecret,
  );
  await importFromConfigIfEmpty(serviceConnectionsRepo, config, server.log);
  const serviceClientRegistry = await ServiceClientRegistry.create(
    serviceConnectionsRepo,
    config,
    server.log,
  );
  server.addHook('onClose', async () => {
    await serviceClientRegistry.destroyAll();
  });
  // Expose registry + repo so the admin save route (plan 06-03) can invoke
  // registry.reload(serviceId) after an upsert. Decorated untyped — the
  // admin route will import the types directly.
  server.decorate('serviceClientRegistry', serviceClientRegistry);
  server.decorate('serviceConnectionsRepo', serviceConnectionsRepo);

  // Stable getter functions passed to downstream services/routes. Each call
  // re-resolves the current live client from the registry — capturing the
  // return value of these getters at module-load time would defeat hot-swap.
  const getComplianceTokenManager = (): ReturnType<typeof serviceClientRegistry.getComplianceTokenManager> =>
    serviceClientRegistry.getComplianceTokenManager();
  const getBrandingTokenManager = (): ReturnType<typeof serviceClientRegistry.getBrandingTokenManager> =>
    serviceClientRegistry.getBrandingTokenManager();
  const getLLMClient = (): ReturnType<typeof serviceClientRegistry.getLLMClient> =>
    serviceClientRegistry.getLLMClient();

  // ── Optional Redis ────────────────────────────────────────────────────────
  const redisClient = createRedisClient(config.redisUrl);
  const ssePublisher = redisClient !== null ? new SsePublisher(redisClient) : undefined;
  const redisScanQueue = redisClient !== null ? new RedisScanQueue(redisClient) : undefined;

  if (redisClient !== null) {
    server.log.info('Dashboard Redis enabled (SSE pub/sub + scan queue).');
  }

  // ── Orchestrator ──────────────────────────────────────────────────────────
  const orchestrator = new ScanOrchestrator(storage, config.reportsDir, {
    maxConcurrent: config.maxConcurrentScans,
    ssePublisher,
    redisQueue: redisScanQueue,
    pluginManager,
  });

  // ── Security Headers (helmet) ────────────────────────────────────────────
  const isProd = process.env['NODE_ENV'] === 'production';
  await server.register(import('@fastify/helmet'), {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'static.cloudflareinsights.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginOpenerPolicy: isProd ? { policy: 'same-origin' } : false,
    originAgentCluster: isProd,
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  // ── Rate Limiting ────────────────────────────────────────────────────────
  await server.register(import('@fastify/rate-limit'), {
    global: true,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Authenticated requests get their own bucket with a higher limit
      const auth = req.headers.authorization ?? '';
      return auth.startsWith('Bearer ') ? `auth:${req.ip}` : req.ip;
    },
    max: (req) => {
      const auth = req.headers.authorization ?? '';
      return auth.startsWith('Bearer ') ? 2000 : 100;
    },
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded, retry in ${Math.ceil(context.ttl / 1000)} seconds`,
    }),
    onExceeded: (req) => {
      // Tag the request so the onSend hook can rewrite to HTML for browsers
      (req as unknown as Record<string, unknown>)._rateLimited = true;
    },
  });
  server.addHook('onSend', async (request, reply, payload) => {
    if ((request as unknown as Record<string, unknown>)._rateLimited && reply.statusCode === 429) {
      const accept = request.headers.accept ?? '';
      if (accept.includes('text/html')) {
        const retryAfter = reply.getHeader('retry-after') ?? '60';
        void reply.header('content-type', 'text/html');
        return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Too Many Requests</title><meta http-equiv="refresh" content="${retryAfter}"><style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8f9fa}div{text-align:center;max-width:400px}h1{font-size:3rem;margin:0}p{color:#666}</style></head><body><div><h1>429</h1><p>Too many requests. Page will refresh in ${retryAfter} seconds.</p></div></body></html>`;
      }
    }
    return payload;
  });

  // ── Plugins ──────────────────────────────────────────────────────────────
  await server.register(import('@fastify/multipart'), { limits: { fileSize: 5 * 1024 * 1024 } });

  await server.register(import('@fastify/formbody'));

  await registerSession(server, config.sessionSecret);

  // CSRF protection for state-changing methods
  await server.register(import('@fastify/csrf-protection'), {
    sessionPlugin: '@fastify/secure-session',
  });

  // Static files
  const staticDir = resolve(join(__dirname, 'static'));
  await server.register(import('@fastify/static'), {
    root: staticDir,
    prefix: '/static/',
    decorateReply: false,
    cacheControl: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    },
  });

  // Uploaded files (persistent across builds — stored alongside DB, not in dist/)
  const uploadsRoot = resolve(config.dbPath ? join(config.dbPath, '..', 'uploads') : './uploads');
  await server.register(import('@fastify/static'), {
    root: uploadsRoot,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // robots.txt — guides crawlers (including Luqen's own scanner) to skip non-page URLs
  server.get('/robots.txt', async (_request, reply) => {
    return reply.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /graphql\nDisallow: /scan/*/progress\nDisallow: /scan/*/events\n`,
    );
  });

  // Handlebars views
  const viewsDir = resolve(join(__dirname, 'views'));
  const handlebars = (await import('handlebars')).default;

  // Register helpers on Handlebars instance directly (required by @fastify/view v10)
  handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  handlebars.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));
  // Legacy role helpers kept for backward compatibility — they still work if
  // templates reference them, but the canonical approach is the `perm.*` flags.
  handlebars.registerHelper('canScan', (role: string) => role === 'user' || role === 'admin' || role === 'developer');
  handlebars.registerHelper('isAdmin', (role: string) => role === 'admin');
  handlebars.registerHelper('isDeveloper', (role: string) => role === 'developer' || role === 'admin');
  handlebars.registerHelper('isExecutive', (role: string) => role === 'executive');
  handlebars.registerHelper('canRunScans', (role: string) => role === 'admin' || role === 'developer' || role === 'user');
  handlebars.registerHelper('canViewTechnical', (role: string) => role === 'admin' || role === 'developer');
  handlebars.registerHelper('canFixCode', (role: string) => role === 'admin' || role === 'developer');
  handlebars.registerHelper('canManageSchedules', (role: string) => role === 'admin' || role === 'user');
  handlebars.registerHelper('canDoManualTesting', (role: string) => role !== 'executive');
  handlebars.registerHelper('canAssignIssues', (role: string) => role !== 'executive');
  handlebars.registerHelper('startsWith', (str: string, prefix: string) =>
    typeof str === 'string' && str.startsWith(prefix));
  handlebars.registerHelper('issuesByType', (issues: readonly { type: string }[], type: string) =>
    Array.isArray(issues) && issues.some((i) => i.type === type));
  handlebars.registerHelper('countByType', (issues: readonly { type: string }[], type: string) =>
    Array.isArray(issues) ? issues.filter((i) => i.type === type).length : 0);
  handlebars.registerHelper('obligationClass', (obligation: string) => {
    if (obligation === 'mandatory') return 'obligation-mandatory';
    if (obligation === 'recommended') return 'obligation-recommended';
    return 'obligation-optional';
  });
  handlebars.registerHelper('complianceStatusClass', (status: string) =>
    status === 'pass' ? 'compliance-pass' : 'compliance-fail');
  handlebars.registerHelper('reviewStatusClass', (reviewStatus: string) => {
    if (reviewStatus === 'fail') return 'fail-head';
    if (reviewStatus === 'review') return 'review-head';
    return 'pass-head';
  });
  handlebars.registerHelper('reviewStatusLabelClass', (reviewStatus: string) => {
    if (reviewStatus === 'fail') return 's-fail';
    if (reviewStatus === 'review') return 's-review';
    return 's-pass';
  });
  handlebars.registerHelper('reviewStatusLabel', (reviewStatus: string) => {
    if (reviewStatus === 'fail') return 'FAIL';
    if (reviewStatus === 'review') return 'REVIEW NEEDED';
    return 'PASS';
  });
  handlebars.registerHelper('formatStandard', (code: string) => {
    const map: Record<string, string> = {
      'WCAG2A': 'WCAG 2.1 Level A',
      'WCAG2AA': 'WCAG 2.1 Level AA',
      'WCAG2AAA': 'WCAG 2.1 Level AAA',
    };
    return map[code] ?? code;
  });
  handlebars.registerHelper('cmpPositive', (n: number) => typeof n === 'number' && n > 0);
  handlebars.registerHelper('cmpNegative', (n: number) => typeof n === 'number' && n < 0);
  handlebars.registerHelper('cmpSign', (n: number) => {
    if (typeof n !== 'number') return '0';
    if (n > 0) return `+${n}`;
    if (n < 0) return `${n}`;
    return '0';
  });
  handlebars.registerHelper('json', (context: unknown) => {
    const str = JSON.stringify(context ?? null);
    return new handlebars.SafeString(str.replace(/</g, '\\u003c'));
  });
  handlebars.registerHelper('includes', (arr: unknown, value: unknown) =>
    Array.isArray(arr) && arr.includes(value),
  );

  // ── i18n ──────────────────────────────────────────────────────────────────
  loadTranslations();
  handlebars.registerHelper('t', function (key: string, options: { hash?: Record<string, unknown>; data?: { root?: { locale?: string } } }) {
    const locale = (options?.data?.root?.locale as Locale) ?? 'en';
    const params = options?.hash != null
      ? Object.fromEntries(Object.entries(options.hash).map(([k, v]) => [k, String(v ?? '')]))
      : undefined;
    return t(key, locale, params);
  });

  handlebars.registerHelper('issueAssignStatus', (assignedMap: Record<string, { id: string; status: string; assignedTo: string | null }> | undefined, code: string, selector: string, message: string, wcagCriterion?: string) => {
    if (assignedMap == null) return '';
    // Check exact fingerprint first
    const fp = `${code}|${selector}|${message}`;
    let a = assignedMap[fp];
    // Fall back to criterion-based match (for bulk-assigned items)
    if (!a && wcagCriterion && typeof wcagCriterion === 'string') {
      a = assignedMap[`criterion:${wcagCriterion}`];
    }
    // Fall back to extracting criterion from pa11y code
    if (!a && code) {
      const m = code.match(/(\d+_\d+(?:_\d+)?)/);
      if (m) {
        const criterion = m[1].replace(/_/g, '.');
        a = assignedMap[`criterion:${criterion}`];
      }
    }
    if (!a) return '';
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const who = a.assignedTo ? ` &middot; ${esc(a.assignedTo)}` : '';
    return new handlebars.SafeString(
      `<button type="button" class="rpt-assigned-toggle rpt-assigned-toggle--${a.status}" data-assignment-id="${esc(a.id)}" onclick="rptToggleAssignment(this)" title="Click to unassign">${esc(a.status)}${who}</button>`
    );
  });

  handlebars.registerHelper('fixSuggestion', (criterion: string, message: string, scanId: string) => {
    if (!criterion || !message || !scanId) return '';

    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const params = new URLSearchParams({ criterion, message, htmlContext: '' });

    const loadingHtml =
      `<div class="rpt-fix-hint__loading" aria-busy="true" aria-label="Loading AI fix suggestion">`
      + `<div class="skeleton" style="height:1rem;margin-bottom:var(--space-xs);"></div>`
      + `<div class="skeleton" style="height:1rem;margin-bottom:var(--space-xs);width:80%;"></div>`
      + `<div class="skeleton" style="height:3rem;"></div>`
      + `</div>`;

    return new handlebars.SafeString(
      `<details class="rpt-fix-hint" `
      + `hx-get="/reports/${esc(scanId)}/fix-suggestion?${params.toString()}" `
      + `hx-trigger="toggle once" `
      + `hx-target="find .rpt-fix-hint__loading-wrap" `
      + `hx-swap="innerHTML">`
      + `<summary class="rpt-fix-hint__toggle">`
      + `How to fix: ${esc(criterion)} `
      + `</summary>`
      + `<div class="rpt-fix-hint__loading-wrap">`
      + loadingHtml
      + `</div>`
      + `</details>`
    );
  });

  await server.register(import('@fastify/view'), {
    engine: { handlebars },
    root: viewsDir,
    layout: 'layouts/main.hbs',
    options: {
      partials: {
        sidebar: 'partials/sidebar.hbs',
        'reports-table': 'partials/reports-table.hbs',
        'page-header': 'partials/page-header.hbs',
        'data-table': 'partials/data-table.hbs',
        'form-group': 'partials/form-group.hbs',
        'stat-card': 'partials/stat-card.hbs',
        'empty-state': 'partials/empty-state.hbs',
        'modal-confirm': 'partials/modal.hbs',
        'badge': 'partials/badge.hbs',
        'login-form': 'partials/login-form.hbs',
        'pagination': 'partials/pagination.hbs',
        'alert': 'partials/alert.hbs',
        'service-connection-row': 'admin/partials/service-connection-row.hbs',
        'service-connection-edit-row': 'admin/partials/service-connection-edit-row.hbs',
        'system-brand-guideline-row': 'admin/partials/system-brand-guideline-row.hbs',
        'system-library-row': 'admin/partials/system-library-row.hbs',
        'rpt-regulation-card': 'partials/rpt-regulation-card.hbs',
      },
    },
  });

  // ── Prevent browser caching of HTML pages (locale/permission-sensitive) ──
  server.addHook('onSend', async (_request, reply, payload) => {
    const ct = reply.getHeader('content-type');
    if (typeof ct === 'string' && ct.includes('text/html')) {
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      reply.header('Pragma', 'no-cache');
    }
    return payload;
  });

  // ── Session expiry ──────────────────────────────────────────────────────
  const sessionExpiryMs = getSessionExpiryMs();
  server.addHook('preHandler', createSessionExpiryHook(sessionExpiryMs));

  // ── Global auth guard ─────────────────────────────────────────────────────
  const authGuard = createAuthGuard(authService);
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url.split('?')[0])) {
      return;
    }
    await authGuard(request, reply);
  });

  // ── API key role enforcement ────────────────────────────────────────────
  server.addHook('preHandler', enforceApiKeyRole);

  // ── Org context + permission loading ──────────────────────────────────────
  // Must run BEFORE the CSRF/perm/i18n hook so perm flags are available.
  server.addHook('preHandler', async (request: FastifyRequest) => {
    if (request.user === undefined) return;

    const session = request.session as { get(key: string): unknown } | undefined;

    // 1. Determine org context
    // API key users can override org via X-Org-Id header (admin keys only)
    const orgHeader = request.headers['x-org-id'] as string | undefined;
    // Org-scoped API keys are locked to their org — no header override
    if (request.user.id === 'api-key' && request.user.currentOrgId !== undefined) {
      // currentOrgId already set from key's org_id — skip header override
    } else if (orgHeader !== undefined && request.user.id === 'api-key' && request.user.role === 'admin') {
      request.user = { ...request.user, currentOrgId: orgHeader };
    } else if (session !== undefined && typeof session.get === 'function') {
      const userOrgs = await storage.organizations.getUserOrgs(request.user.id);

      let currentOrgId = session.get('currentOrgId') as string | undefined;
      if ((currentOrgId === undefined || currentOrgId === '') && userOrgs.length > 0) {
        currentOrgId = userOrgs[0].id;
      }

      if (currentOrgId !== undefined && currentOrgId !== '') {
        request.user = {
          ...request.user,
          currentOrgId,
        };
      }

      const currentOrg = currentOrgId !== undefined && currentOrgId !== ''
        ? await storage.organizations.getOrg(currentOrgId)
        : null;

      (request as FastifyRequest & { orgContext?: unknown }).orgContext = {
        userOrgs,
        currentOrg,
      };
    }

    // 2. Resolve permissions WITH org context
    const permissions = await resolveEffectivePermissions(
      storage.roles,
      request.user.id,
      request.user.role,
      request.user.currentOrgId,
    );
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  // ── Service token injection (auto-refresh for compliance API calls) ────
  const complianceService = new ComplianceService(config, getComplianceTokenManager, storage.organizations);
  server.decorate('complianceService', complianceService);
  server.addHook('onClose', () => { complianceService.destroyOrgTokenManagers(); });

  server.addHook('preHandler', async (request: FastifyRequest) => {
    const session = request.session as { token?: string };
    if (!session.token) {
      const reqExt = request as unknown as Record<string, unknown>;
      const complianceTm = getComplianceTokenManager();
      reqExt['_serviceToken'] = complianceTm !== null ? await complianceTm.getToken() : '';

      // Inject per-org token when the user has a current org with stored credentials
      const orgId = request.user?.currentOrgId;
      if (orgId) {
        try {
          const orgToken = await complianceService.getOrgToken(orgId);
          reqExt['_orgServiceToken'] = orgToken;
        } catch {
          // Fall through — global token will be used via _serviceToken
        }
      }
    }
  });

  // ── CSRF token + permission + i18n injection into all view renders ────
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const csrfToken = reply.generateCsrf();
    const perms = (request as unknown as Record<string, unknown>)['permissions'] as Set<string> | undefined ?? new Set<string>();
    const session = request.session as { get?(key: string): unknown } | undefined;
    const locale: Locale = (
      typeof session?.get === 'function'
        ? session.get('locale') as Locale | undefined
        : undefined
    ) ?? 'en';
    const gitHostConfigs = await storage.gitHosts.listConfigs(request.user?.currentOrgId ?? 'system');
    const hasGitHostConfigs = gitHostConfigs.length > 0;
    const originalView = reply.view.bind(reply) as typeof reply.view;
    const isHtmxRequest = request.headers['hx-request'] === 'true';
    reply.view = (page: string, data?: Record<string, unknown>) => {
      const merged = {
        ...data,
        csrfToken,
        locale,
        locales: SUPPORTED_LOCALES,
        localeLabels: LOCALE_LABELS,
        perm: {
          scansCreate: perms.has('scans.create'),
          scansSchedule: perms.has('scans.schedule'),
          reportsView: perms.has('reports.view'),
          reportsViewTechnical: perms.has('reports.view_technical'),
          reportsExport: perms.has('reports.export'),
          reportsDelete: perms.has('reports.delete'),
          reportsCompare: perms.has('reports.compare'),
          issuesAssign: perms.has('issues.assign'),
          issuesFix: perms.has('issues.fix'),
          manualTesting: perms.has('manual_testing'),
          reposManage: perms.has('repos.manage'),
          trendsView: perms.has('trends.view'),
          usersCreate: perms.has('users.create'),
          usersDelete: perms.has('users.delete'),
          usersActivate: perms.has('users.activate'),
          usersResetPassword: perms.has('users.reset_password'),
          usersRoles: perms.has('users.roles'),
          usersManageAny: perms.has('users.create') || perms.has('users.delete') || perms.has('users.activate') || perms.has('users.reset_password') || perms.has('users.roles'),
          adminUsers: perms.has('admin.users'),
          adminRoles: perms.has('admin.roles'),
          adminTeams: perms.has('admin.teams') || perms.has('admin.system'),
          adminPlugins: perms.has('admin.plugins') || perms.has('admin.system'),
          adminSystem: perms.has('admin.system'),
          adminOrg: perms.has('admin.org') || perms.has('admin.system'),
          complianceView: perms.has('compliance.view') || perms.has('admin.system'),
          complianceManage: perms.has('compliance.manage') || perms.has('admin.system'),
          brandingView: perms.has('branding.view') || perms.has('admin.system'),
          brandingManage: perms.has('branding.manage') || perms.has('admin.system'),
          llmView: perms.has('llm.view') || perms.has('admin.system'),
          llmManage: perms.has('llm.manage') || perms.has('admin.system'),
          reposCredentials: perms.has('repos.credentials'),
          auditView: perms.has('audit.view'),
        },
        isExecutiveView: !perms.has('scans.create') && perms.has('trends.view'),
        pluginAdminPages: pluginManager.getActiveAdminPages().filter((p) => perms.has(p.permission)),
        emailPluginActive: pluginManager.getActiveInstanceByPackageName?.('@luqen/plugin-notify-email') != null,
        hasGitHostConfigs,
        orgContext: (request as unknown as Record<string, unknown>).orgContext,
        appVersion: `v${VERSION}`,
      };
      // HTMX partial requests: render template without layout
      if (isHtmxRequest) {
        const templatePath = join(viewsDir, page);
        const source = readFileSync(templatePath, 'utf-8');
        const compiled = handlebars.compile(source);
        return reply.type('text/html').send(compiled(merged));
      }
      return originalView(page, merged);
    };
  });

  // ── CSRF verification for state-changing requests ──────────────────────
  // Uses preHandler (not onRequest) so the body has been parsed by @fastify/formbody
  // and req.body._csrf is available for token extraction.
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!CSRF_METHODS.has(request.method)) return;
    const path = request.url.split('?')[0];
    if (isCsrfExempt(path)) return;
    await new Promise<void>((resolve, reject) => {
      server.csrfProtection(request, reply, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  // (Org context + permissions already loaded in earlier preHandler hook)

  // ── Routes ────────────────────────────────────────────────────────────────
  await authRoutes(server, config, authService, storage);
  await homeRoutes(server, storage, config);
  await scanRoutes(server, storage, orchestrator, config, complianceService);
  await compareRoutes(server, storage);
  await trendRoutes(server, storage);
  await scheduleRoutes(server, storage);
  // LLM client is owned by serviceClientRegistry (constructed above).
  // Routes receive getLLMClient and resolve the current live instance per
  // request so a runtime reload is picked up without a restart.
  await reportRoutes(server, storage, getLLMClient);
  await manualTestRoutes(server, storage);
  await assignmentRoutes(server, storage);
  await orgRoutes(server, storage);
  await toolRoutes(server);
  await repoRoutes(server, storage, config);
  await gitCredentialRoutes(server, storage, config);
  await fixPrRoutes(server, storage, config);

  // ── Admin routes (all require admin role via adminGuard per route) ─────────
  await jurisdictionRoutes(server, config.complianceUrl);
  await regulationRoutes(server, config.complianceUrl);
  await proposalRoutes(server, config.complianceUrl, storage);
  await changeHistoryRoutes(server, config.complianceUrl);
  await sourceRoutes(server, config.complianceUrl, pluginManager, getLLMClient);
  await webhookRoutes(server, config.complianceUrl);
  await userRoutes(server, config.complianceUrl);
  await clientRoutes(server, config.complianceUrl, storage, config.brandingUrl, getBrandingTokenManager, getLLMClient);
  await registerServiceConnectionsRoutes(server, storage, config);
  await systemBrandGuidelineRoutes(server, storage, getLLMClient);
  await monitorRoutes(server, config.complianceUrl);
  await systemRoutes(server, {
    complianceUrl: config.complianceUrl,
    brandingUrl: config.brandingUrl,
    webserviceUrl: config.webserviceUrl,
    dbPath: config.dbPath,
  }, getLLMClient);

  await dashboardUserRoutes(server, storage);
  await apiKeyRoutes(server, storage);
  const { orgApiKeyRoutes } = await import('./routes/admin/org-api-keys.js');
  await orgApiKeyRoutes(server, storage);
  await organizationRoutes(server, storage, config.complianceUrl, config.brandingUrl, getBrandingTokenManager, getLLMClient);
  await roleRoutes(server, storage);
  await teamRoutes(server, storage);
  await emailReportRoutes(server, storage, pluginManager);

  await auditRoutes(server, storage);
  await gitHostRoutes(server, storage);
  const uploadsDir = resolve(config.dbPath ? join(config.dbPath, '..', 'uploads') : './uploads');
  await brandingGuidelineRoutes(server, storage, getLLMClient, uploadsDir);
  await pluginAdminRoutes(server, pluginManager, registryEntries, storage);

  // ── LLM admin routes ────────────────────────────────────────────────────
  await llmAdminRoutes(server, getLLMClient);

  // ── Export API routes ────────────────────────────────────────────────────
  await exportRoutes(server, storage);

  // ── Data API routes (Power BI / external integrations) ──────────────────
  await dataApiRoutes(server, storage);

  // ── Branding API routes ──────────────────────────────────────────────────
  await brandingApiRoutes(server, storage);

  // ── Setup API (create admin user via API key) ──────────────────────────
  await setupRoutes(server, storage, authService);

  // ── Plugin API routes ────────────────────────────────────────────────────
  await pluginApiRoutes(server, pluginManager);

  // ── Source intelligence API routes ─────────────────────────────────────
  await sourceApiRoutes(server, config.complianceUrl, pluginManager, getComplianceTokenManager);

  // ── GraphQL API (mercurius) ──────────────────────────────────────────────
  await server.register(mercurius, {
    schema: graphqlSchema,
    resolvers: graphqlResolvers as Parameters<typeof mercurius>[1]['resolvers'],
    graphiql: process.env['NODE_ENV'] !== 'production',
    context: (request): GraphQLContext => ({
      storage,
      user: request.user,
      permissions:
        ((request as unknown as Record<string, unknown>)['permissions'] as Set<string> | undefined) ??
        new Set<string>(),
      orgId: request.user?.currentOrgId ?? 'system',
    }),
  });

  // ── Health endpoint ───────────────────────────────────────────────────────
  server.get('/health', async (_request, _reply) => {
    return { status: 'ok', version: VERSION };
  });

  // ── Scheduler — start after server is ready ────────────────────────────
  server.addHook('onReady', async () => {
    const timer = startScheduler(storage, orchestrator, config);
    const emailTimer = startEmailScheduler(storage, pluginManager);
    const sourceMonitorTimer = startSourceMonitorScheduler(config, getComplianceTokenManager);
    server.addHook('onClose', () => {
      clearInterval(timer);
      clearInterval(emailTimer);
      clearInterval(sourceMonitorTimer);
    });

    // ── Backfill missing OAuth clients for existing orgs ──────────────────
    // Orgs created before a service was added won't have stored credentials.
    // We create them now (best-effort) so every org has compliance, branding,
    // and LLM clients ready.
    try {
      const complianceTm = getComplianceTokenManager();
      const brandingTm = getBrandingTokenManager();
      const llmClient = getLLMClient();
      const complianceToken = complianceTm !== null ? await complianceTm.getToken() : '';
      const brandingToken = brandingTm !== null ? await brandingTm.getToken() : null;
      const llmToken = llmClient !== null ? await llmClient.getToken() : null;
      const allOrgs = await storage.organizations.listOrgs();

      for (const org of allOrgs) {
        // Compliance client
        if (config.complianceUrl) {
          const compCreds = await storage.organizations.getOrgComplianceCredentials(org.id);
          if (compCreds === null) {
            try {
              const { clientId, clientSecret } = await createComplianceClient(
                config.complianceUrl, complianceToken, org.id, org.slug,
              );
              await storage.organizations.updateOrgComplianceClient(org.id, clientId, clientSecret);
              server.log.info(`Created compliance OAuth client for org "${org.name}"`);
            } catch (err) {
              server.log.warn({ err }, `Failed to backfill compliance client for org "${org.name}"`);
            }
          }
        }

        // Branding client
        if (config.brandingUrl && brandingToken) {
          const brandCreds = await storage.organizations.getOrgBrandingCredentials(org.id);
          if (brandCreds === null) {
            try {
              const { clientId, clientSecret } = await createBrandingOrgClient(
                config.brandingUrl, brandingToken, org.id, org.slug,
              );
              await storage.organizations.updateOrgBrandingClient(org.id, clientId, clientSecret);
              server.log.info(`Created branding OAuth client for org "${org.name}"`);
            } catch (err) {
              server.log.warn({ err }, `Failed to backfill branding client for org "${org.name}"`);
            }
          }
        }

        // LLM client
        if (config.llmUrl && llmToken) {
          const llmCreds = await storage.organizations.getOrgLLMCredentials(org.id);
          if (llmCreds === null) {
            try {
              const { clientId, clientSecret } = await createLLMOrgClient(
                config.llmUrl, llmToken, org.id, org.slug,
              );
              await storage.organizations.updateOrgLLMClient(org.id, clientId, clientSecret);
              server.log.info(`Created LLM OAuth client for org "${org.name}"`);
            } catch (err) {
              server.log.warn({ err }, `Failed to backfill LLM client for org "${org.name}"`);
            }
          }
        }
      }
    } catch (err) {
      server.log.warn({ err }, 'OAuth client backfill encountered an error');
    }

    // ── Recover stuck scans ─────────────────────────────────────────────
    // Scans left in queued/running state after a restart will never complete.
    // Re-enqueue queued scans; mark running scans as failed (partial state).
    try {
      const stuckQueued = await storage.scans.listScans({ status: 'queued' });
      const stuckRunning = await storage.scans.listScans({ status: 'running' });

      for (const scan of stuckRunning) {
        await storage.scans.updateScan(scan.id, {
          status: 'failed',
          error: 'Interrupted by server restart',
          completedAt: new Date().toISOString(),
        });
        server.log.info(`Marked interrupted scan ${scan.id} (${scan.siteUrl}) as failed`);
      }

      for (const scan of stuckQueued) {
        orchestrator.startScan(scan.id, {
          siteUrl: scan.siteUrl,
          standard: scan.standard,
          concurrency: config.maxConcurrentScans,
          jurisdictions: scan.jurisdictions,
          regulations: scan.regulations ?? [],
          ...(config.webserviceUrl !== undefined ? { webserviceUrl: config.webserviceUrl } : {}),
          ...(config.webserviceUrls !== undefined && config.webserviceUrls.length > 0
            ? { webserviceUrls: config.webserviceUrls }
            : {}),
          complianceUrl: config.complianceUrl,
          orgId: scan.orgId,
        });
        server.log.info(`Re-enqueued stuck scan ${scan.id} (${scan.siteUrl})`);
      }

      if (stuckRunning.length > 0 || stuckQueued.length > 0) {
        server.log.info(`Scan recovery: ${stuckRunning.length} marked failed, ${stuckQueued.length} re-enqueued`);
      }
    } catch (err) {
      server.log.warn({ err }, 'Scan recovery encountered an error');
    }
  });

  // ── Error page renderer (no layout) ──────────────────────────────────────
  // @fastify/view always wraps with the global layout; for standalone error
  // pages we read and compile the template directly, same as the HTMX path.
  function renderErrorPage(templateName: string, data: Record<string, unknown> = {}): string {
    const templatePath = join(viewsDir, 'errors', templateName);
    const source = readFileSync(templatePath, 'utf-8');
    const compiled = handlebars.compile(source);
    return compiled(data);
  }

  // ── 404 handler ──────────────────────────────────────────────────────────
  server.setNotFoundHandler((request, reply) => {
    if (wantsHtml(request)) {
      return reply.status(404).type('text/html').send(renderErrorPage('404.hbs'));
    }
    return reply.status(404).send({ error: 'Not Found' });
  });

  // ── Global error handler ──────────────────────────────────────────────────
  server.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode ?? 500;

    if (status === 403 && wantsHtml(request)) {
      return reply.status(403).type('text/html').send(renderErrorPage('403.hbs'));
    }

    if (status === 429 && wantsHtml(request)) {
      const retryAfter = reply.getHeader('retry-after') ?? '60';
      return reply.status(429).type('text/html').send(renderErrorPage('429.hbs', { retryAfter }));
    }

    if (status >= 500 && wantsHtml(request)) {
      request.log.error(error);
      return reply.status(500).type('text/html').send(renderErrorPage('500.hbs'));
    }

    return reply.status(status).send({
      error: (error as Error).message || 'Internal Server Error',
    });
  });

  return server;
}
