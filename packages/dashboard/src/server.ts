import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardConfig } from './config.js';
import { registerSession } from './auth/session.js';
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
import { systemRoutes } from './routes/admin/system.js';
import { monitorRoutes } from './routes/admin/monitor.js';
import { pluginAdminRoutes } from './routes/admin/plugins.js';
import { pluginApiRoutes } from './routes/api/plugins.js';
import { exportRoutes } from './routes/api/export.js';
import { dataApiRoutes } from './routes/api/data.js';
import { orgRoutes } from './routes/orgs.js';
import { toolRoutes } from './routes/tools.js';
import { repoRoutes } from './routes/repos.js';
import { ScanDb } from './db/scans.js';
import { PluginManager } from './plugins/manager.js';
import { loadRegistry } from './plugins/registry.js';
import { ScanOrchestrator } from './scanner/orchestrator.js';
import { createRedisClient, RedisScanQueue, SsePublisher } from './cache/redis.js';
import { getOrCreateApiKey } from './auth/api-key.js';
import { UserDb } from './db/users.js';
import { OrgDb } from './db/orgs.js';
import { dashboardUserRoutes } from './routes/admin/dashboard-users.js';
import { apiKeyRoutes } from './routes/admin/api-keys.js';
import { organizationRoutes } from './routes/admin/organizations.js';
import { VERSION } from './version.js';
import { getFixSuggestion } from './fix-suggestions.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Routes that bypass auth guard
const PUBLIC_PATHS = new Set(['/login', '/health']);

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith('/static/')) return true;
  if (path.startsWith('/auth/callback/')) return true;
  if (path.startsWith('/auth/sso/')) return true;
  return false;
}

export async function createServer(config: DashboardConfig): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env['NODE_ENV'] === 'production' ? 'warn' : 'info',
    },
  });

  // ── Database ──────────────────────────────────────────────────────────────
  const db = new ScanDb(config.dbPath);
  db.initialize();

  // ── Plugin Manager ──────────────────────────────────────────────────────
  const registryEntries = loadRegistry();
  const pluginManager = new PluginManager({
    db: db.getDatabase(),
    pluginsDir: resolve(config.reportsDir, '..', 'plugins'),
    encryptionKey: config.sessionSecret,
    registryEntries,
  });
  await pluginManager.initializeOnStartup();
  pluginManager.startHealthChecks(60_000);

  // ── Auth Service ────────────────────────────────────────────────────────
  const authService = new AuthService(db.getDatabase(), pluginManager);
  const userDb = new UserDb(db.getDatabase());
  const orgDb = new OrgDb(db.getDatabase());

  // ── Solo mode: first-start API key ──────────────────────────────────────
  if (authService.getAuthMode() === 'solo') {
    const { key, isNew } = getOrCreateApiKey(db.getDatabase());
    if (isNew) {
      server.log.info('');
      server.log.info('========================================');
      server.log.info('  PALLY DASHBOARD — First Start');
      server.log.info('  API Key: ' + key);
      server.log.info('  Save this key — it will not be shown again.');
      server.log.info('========================================');
      server.log.info('');
    }
  }

  // ── Optional Redis ────────────────────────────────────────────────────────
  const redisClient = createRedisClient(config.redisUrl);
  const ssePublisher = redisClient !== null ? new SsePublisher(redisClient) : undefined;
  const redisScanQueue = redisClient !== null ? new RedisScanQueue(redisClient) : undefined;

  if (redisClient !== null) {
    server.log.info('Dashboard Redis enabled (SSE pub/sub + scan queue).');
  }

  // ── Orchestrator ──────────────────────────────────────────────────────────
  const orchestrator = new ScanOrchestrator(db, config.reportsDir, {
    maxConcurrent: config.maxConcurrentScans,
    ssePublisher,
    redisQueue: redisScanQueue,
  });

  // ── Rate Limiting ────────────────────────────────────────────────────────
  await server.register(import('@fastify/rate-limit'), {
    global: false,   // Only apply to routes that opt in
  });

  // ── Plugins ──────────────────────────────────────────────────────────────
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
  });

  // Handlebars views
  const viewsDir = resolve(join(__dirname, 'views'));
  const handlebars = (await import('handlebars')).default;

  // Register helpers on Handlebars instance directly (required by @fastify/view v10)
  handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
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
  handlebars.registerHelper('json', (context: unknown) => JSON.stringify(context));

  handlebars.registerHelper('fixSuggestion', (criterion: string, message: string) => {
    const fix = getFixSuggestion(criterion, message);
    if (!fix) return '';
    const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return new handlebars.SafeString(
      `<details class="rpt-fix-hint"><summary class="rpt-fix-hint__toggle">How to fix: ${escaped(fix.title)} <span class="rpt-fix-effort rpt-fix-effort--${fix.effort}">${fix.effort}</span></summary><p class="rpt-fix-hint__desc">${escaped(fix.description)}</p><pre class="rpt-fix-hint__code"><code>${escaped(fix.codeExample)}</code></pre></details>`
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
      },
    },
  });

  // ── Global auth guard ─────────────────────────────────────────────────────
  const authGuard = createAuthGuard(authService);
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url.split('?')[0])) {
      return;
    }
    await authGuard(request, reply);
  });

  // ── CSRF token injection into all view renders ─────────────────────────
  server.addHook('preHandler', async (_request: FastifyRequest, reply: FastifyReply) => {
    const csrfToken = reply.generateCsrf();
    const originalView = reply.view.bind(reply) as typeof reply.view;
    reply.view = (page: string, data?: Record<string, unknown>) => {
      return originalView(page, { ...data, csrfToken });
    };
  });

  // ── Org context injection ────────────────────────────────────────────────
  server.addHook('preHandler', async (request: FastifyRequest) => {
    if (request.user === undefined) return;

    const session = request.session as { get(key: string): unknown } | undefined;
    if (session === undefined || typeof session.get !== 'function') return;

    const currentOrgId = session.get('currentOrgId') as string | undefined;
    if (currentOrgId !== undefined && currentOrgId !== '') {
      request.user = {
        ...request.user,
        currentOrgId,
      };
    }

    // Populate org context for sidebar org switcher
    const userOrgs = orgDb.getUserOrgs(request.user.id);
    const currentOrg = currentOrgId !== undefined && currentOrgId !== ''
      ? orgDb.getOrg(currentOrgId)
      : null;

    (request as FastifyRequest & { orgContext?: unknown }).orgContext = {
      userOrgs,
      currentOrg,
    };
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  await authRoutes(server, config, authService);
  await homeRoutes(server, db, config);
  await scanRoutes(server, db, orchestrator, config);
  await compareRoutes(server, db);
  await trendRoutes(server, db);
  await scheduleRoutes(server, db);
  await reportRoutes(server, db);
  await manualTestRoutes(server, db);
  await assignmentRoutes(server, db);
  await orgRoutes(server, orgDb);
  await toolRoutes(server);
  await repoRoutes(server, db);

  // ── Admin routes (all require admin role via adminGuard per route) ─────────
  await jurisdictionRoutes(server, config.complianceUrl);
  await regulationRoutes(server, config.complianceUrl);
  await proposalRoutes(server, config.complianceUrl);
  await sourceRoutes(server, config.complianceUrl);
  await webhookRoutes(server, config.complianceUrl);
  await userRoutes(server, config.complianceUrl);
  await clientRoutes(server, config.complianceUrl);
  await monitorRoutes(server, config.complianceUrl);
  await systemRoutes(server, {
    complianceUrl: config.complianceUrl,
    webserviceUrl: config.webserviceUrl,
    dbPath: config.dbPath,
  });

  await dashboardUserRoutes(server, userDb);
  await apiKeyRoutes(server, db.getDatabase());
  await organizationRoutes(server, orgDb, userDb, config.complianceUrl);

  await pluginAdminRoutes(server, pluginManager, registryEntries, config.pluginsDir);

  // ── Export API routes ────────────────────────────────────────────────────
  await exportRoutes(server, db);

  // ── Data API routes (Power BI / external integrations) ──────────────────
  await dataApiRoutes(server, db);

  // ── Plugin API routes ────────────────────────────────────────────────────
  await pluginApiRoutes(server, pluginManager);

  // ── Health endpoint ───────────────────────────────────────────────────────
  server.get('/health', async (_request, _reply) => {
    return { status: 'ok', version: VERSION };
  });

  // ── Scheduler — start after server is ready ────────────────────────────
  server.addHook('onReady', () => {
    const timer = startScheduler(db, orchestrator, config);
    server.addHook('onClose', () => {
      clearInterval(timer);
    });
  });

  return server;
}
