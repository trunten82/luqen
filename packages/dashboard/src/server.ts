import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardConfig } from './config.js';
import { registerSession } from './auth/session.js';
import { authGuard } from './auth/middleware.js';
import { authRoutes } from './routes/auth.js';
import { homeRoutes } from './routes/home.js';
import { scanRoutes } from './routes/scan.js';
import { reportRoutes } from './routes/reports.js';
import { jurisdictionRoutes } from './routes/admin/jurisdictions.js';
import { regulationRoutes } from './routes/admin/regulations.js';
import { proposalRoutes } from './routes/admin/proposals.js';
import { sourceRoutes } from './routes/admin/sources.js';
import { webhookRoutes } from './routes/admin/webhooks.js';
import { userRoutes } from './routes/admin/users.js';
import { clientRoutes } from './routes/admin/clients.js';
import { systemRoutes } from './routes/admin/system.js';
import { ScanDb } from './db/scans.js';
import { ScanOrchestrator } from './scanner/orchestrator.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Routes that bypass auth guard
const PUBLIC_PATHS = new Set(['/login', '/health']);

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith('/static/')) return true;
  return false;
}

export async function createServer(config: DashboardConfig): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env['NODE_ENV'] === 'production' ? 'warn' : 'info',
    },
  });

  // ── Database & orchestrator ──────────────────────────────────────────────
  const db = new ScanDb(config.dbPath);
  db.initialize();

  const orchestrator = new ScanOrchestrator(db, config.reportsDir, config.maxConcurrentScans);

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
  await server.register(import('@fastify/view'), {
    engine: { handlebars: (await import('handlebars')).default },
    root: viewsDir,
    layout: 'layouts/main.hbs',
    options: {
      partials: {
        sidebar: 'partials/sidebar.hbs',
        'reports-table': 'partials/reports-table.hbs',
      },
      helpers: {
        eq: (a: unknown, b: unknown) => a === b,
        canScan: (role: string) => role === 'user' || role === 'admin',
        isAdmin: (role: string) => role === 'admin',
        startsWith: (str: string, prefix: string) =>
          typeof str === 'string' && str.startsWith(prefix),
      },
    },
  });

  // ── Global auth guard ─────────────────────────────────────────────────────
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url.split('?')[0])) {
      return;
    }
    await authGuard(request, reply);
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  await authRoutes(server, config);
  await homeRoutes(server, db);
  await scanRoutes(server, db, orchestrator, config);
  await reportRoutes(server, db);

  // ── Admin routes (all require admin role via adminGuard per route) ─────────
  await jurisdictionRoutes(server, config.complianceUrl);
  await regulationRoutes(server, config.complianceUrl);
  await proposalRoutes(server, config.complianceUrl);
  await sourceRoutes(server, config.complianceUrl);
  await webhookRoutes(server, config.complianceUrl);
  await userRoutes(server, config.complianceUrl);
  await clientRoutes(server, config.complianceUrl);
  await systemRoutes(server, {
    complianceUrl: config.complianceUrl,
    webserviceUrl: config.webserviceUrl,
    dbPath: config.dbPath,
  });

  // ── Health endpoint ───────────────────────────────────────────────────────
  server.get('/health', async (_request, _reply) => {
    return { status: 'ok', version: '0.1.0' };
  });

  return server;
}
