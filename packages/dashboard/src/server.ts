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
import { systemRoutes } from './routes/admin/system.js';
import { monitorRoutes } from './routes/admin/monitor.js';
import { pluginAdminRoutes } from './routes/admin/plugins.js';
import { pluginApiRoutes } from './routes/api/plugins.js';
import { exportRoutes } from './routes/api/export.js';
import { dataApiRoutes } from './routes/api/data.js';
import { orgRoutes } from './routes/orgs.js';
import { toolRoutes } from './routes/tools.js';
import { repoRoutes } from './routes/repos.js';
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
import { ServiceTokenManager } from './auth/service-token.js';
import { ComplianceService } from './services/compliance-service.js';
import { enforceApiKeyRole } from './auth/api-key-guard.js';
import { auditRoutes } from './routes/admin/audit.js';
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
const PUBLIC_PATHS = new Set(['/login', '/health', '/api/v1/setup']);

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

  // ── Service Token Manager (auto-refresh for compliance API calls) ────────
  const serviceTokenManager = new ServiceTokenManager(
    config.complianceUrl,
    config.complianceClientId,
    config.complianceClientSecret,
  );
  server.decorate('serviceTokenManager', serviceTokenManager);
  server.addHook('onClose', () => { serviceTokenManager.destroy(); });

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
        upgradeInsecureRequests: [],
      },
    },
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  // ── Rate Limiting ────────────────────────────────────────────────────────
  await server.register(import('@fastify/rate-limit'), {
    global: true,
    max: 100,
    timeWindow: '1 minute',
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
    cacheControl: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    },
  });

  // Handlebars views
  const viewsDir = resolve(join(__dirname, 'views'));
  const handlebars = (await import('handlebars')).default;

  // Register helpers on Handlebars instance directly (required by @fastify/view v10)
  handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
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
    return new handlebars.SafeString(JSON.stringify(context).replace(/</g, '\\u003c'));
  });

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
    if (session !== undefined && typeof session.get === 'function') {
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
  const complianceService = new ComplianceService(config, serviceTokenManager, storage.organizations);
  server.decorate('complianceService', complianceService);
  server.addHook('onClose', () => { complianceService.destroyOrgTokenManagers(); });

  server.addHook('preHandler', async (request: FastifyRequest) => {
    const session = request.session as { token?: string };
    if (!session.token) {
      const reqExt = request as unknown as Record<string, unknown>;
      reqExt['_serviceToken'] = await serviceTokenManager.getToken();

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
          auditView: perms.has('audit.view'),
        },
        isExecutiveView: !perms.has('scans.create') && perms.has('trends.view'),
        pluginAdminPages: pluginManager.getActiveAdminPages().filter((p) => perms.has(p.permission)),
        emailPluginActive: pluginManager.getActiveInstanceByPackageName?.('@luqen/plugin-notify-email') != null,
        orgContext: (request as unknown as Record<string, unknown>).orgContext,
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
  await scanRoutes(server, storage, orchestrator, config);
  await compareRoutes(server, storage);
  await trendRoutes(server, storage);
  await scheduleRoutes(server, storage);
  await reportRoutes(server, storage);
  await manualTestRoutes(server, storage);
  await assignmentRoutes(server, storage);
  await orgRoutes(server, storage);
  await toolRoutes(server);
  await repoRoutes(server, storage);

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

  await dashboardUserRoutes(server, storage);
  await apiKeyRoutes(server, storage);
  await organizationRoutes(server, storage, config.complianceUrl);
  await roleRoutes(server, storage);
  await teamRoutes(server, storage);
  await emailReportRoutes(server, storage, pluginManager);

  await auditRoutes(server, storage);
  await pluginAdminRoutes(server, pluginManager, registryEntries);

  // ── Export API routes ────────────────────────────────────────────────────
  await exportRoutes(server, storage);

  // ── Data API routes (Power BI / external integrations) ──────────────────
  await dataApiRoutes(server, storage);

  // ── Setup API (create admin user via API key) ──────────────────────────
  await setupRoutes(server, storage, authService);

  // ── Plugin API routes ────────────────────────────────────────────────────
  await pluginApiRoutes(server, pluginManager);

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
  server.addHook('onReady', () => {
    const timer = startScheduler(storage, orchestrator, config);
    const emailTimer = startEmailScheduler(storage, pluginManager);
    server.addHook('onClose', () => {
      clearInterval(timer);
      clearInterval(emailTimer);
    });
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
