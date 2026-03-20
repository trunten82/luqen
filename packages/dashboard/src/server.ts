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
import { orgRoutes } from './routes/orgs.js';
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
  handlebars.registerHelper('canScan', (role: string) => role === 'user' || role === 'admin');
  handlebars.registerHelper('isAdmin', (role: string) => role === 'admin');
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
  handlebars.registerHelper('cmpPositive', (n: number) => typeof n === 'number' && n > 0);
  handlebars.registerHelper('cmpNegative', (n: number) => typeof n === 'number' && n < 0);
  handlebars.registerHelper('cmpSign', (n: number) => {
    if (typeof n !== 'number') return '0';
    if (n > 0) return `+${n}`;
    if (n < 0) return `${n}`;
    return '0';
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
  await reportRoutes(server, db);
  await orgRoutes(server, orgDb);

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

  // ── Plugin API routes ────────────────────────────────────────────────────
  await pluginApiRoutes(server, pluginManager);

  // ── Health endpoint ───────────────────────────────────────────────────────
  server.get('/health', async (_request, _reply) => {
    return { status: 'ok', version: VERSION };
  });

  return server;
}
