import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { authRoutes } from '../../src/routes/auth.js';
import { homeRoutes } from '../../src/routes/home.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { compareRoutes } from '../../src/routes/compare.js';
import { scanRoutes } from '../../src/routes/scan.js';
import { scheduleRoutes } from '../../src/routes/schedules.js';
import { manualTestRoutes } from '../../src/routes/manual-tests.js';
import { assignmentRoutes } from '../../src/routes/assignments.js';
import { trendRoutes } from '../../src/routes/trends.js';
import { orgRoutes } from '../../src/routes/orgs.js';
import { repoRoutes } from '../../src/routes/repos.js';
import { toolRoutes } from '../../src/routes/tools.js';
import { roleRoutes } from '../../src/routes/admin/roles.js';
import { teamRoutes } from '../../src/routes/admin/teams.js';
import { emailReportRoutes } from '../../src/routes/admin/email-reports.js';
import { apiKeyRoutes } from '../../src/routes/admin/api-keys.js';
import { organizationRoutes } from '../../src/routes/admin/organizations.js';
import { auditRoutes } from '../../src/routes/admin/audit.js';
import { systemRoutes } from '../../src/routes/admin/system.js';
import { dashboardUserRoutes } from '../../src/routes/admin/dashboard-users.js';
import { jurisdictionRoutes } from '../../src/routes/admin/jurisdictions.js';
import { regulationRoutes } from '../../src/routes/admin/regulations.js';
import { proposalRoutes } from '../../src/routes/admin/proposals.js';
import { sourceRoutes } from '../../src/routes/admin/sources.js';
import { webhookRoutes } from '../../src/routes/admin/webhooks.js';
import { clientRoutes } from '../../src/routes/admin/clients.js';
import { monitorRoutes } from '../../src/routes/admin/monitor.js';
import { dataApiRoutes } from '../../src/routes/api/data.js';
import { exportRoutes } from '../../src/routes/api/export.js';
import { setupRoutes } from '../../src/routes/api/setup.js';
import { userRoutes } from '../../src/routes/admin/users.js';
import { AuthService } from '../../src/auth/auth-service.js';
import { PluginManager } from '../../src/plugins/manager.js';
import { loadRegistry } from '../../src/plugins/registry.js';
import type { RegistryEntry } from '../../src/plugins/registry.js';
import type { DashboardConfig } from '../../src/config.js';
import { registerSession } from '../../src/auth/session.js';

// TODO: pluginAdminRoutes and pluginApiRoutes require a full PluginManager
// with installed plugins and a real pluginsDir. They are mounted below with
// a minimal PluginManager; plugin-specific behaviour may not be available
// in tests (no plugins are installed).
import { pluginAdminRoutes } from '../../src/routes/admin/plugins.js';
import { pluginApiRoutes } from '../../src/routes/api/plugins.js';

// 32-byte test secret
const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

export interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  orchestrator: ScanOrchestrator;
  config: DashboardConfig;
  authService: AuthService;
  pluginManager: PluginManager;
  registryEntries: readonly RegistryEntry[];
  cleanup: () => void;
}

export async function createTestServer(): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-dashboard-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-reports-${randomUUID()}`);
  const pluginsDir = join(tmpdir(), `test-plugins-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });

  const config: DashboardConfig = {
    port: 5000,
    complianceUrl: 'http://localhost:4000',
    webserviceUrl: 'http://localhost:3000',
    reportsDir,
    dbPath,
    sessionSecret: TEST_SESSION_SECRET,
    maxConcurrentScans: 2,
    complianceClientId: 'dashboard',
    complianceClientSecret: '',
  };

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const rawDb = storage.getRawDatabase();

  // Minimal PluginManager — no plugins installed, used for routes that accept
  // an optional pluginManager. Will not load real plugins but satisfies the
  // type and lets routes register without errors.
  const registryEntries = loadRegistry();
  const pluginManager = new PluginManager({
    db: rawDb,
    pluginsDir,
    encryptionKey: TEST_SESSION_SECRET,
    registryEntries,
  });
  // NOTE: We intentionally skip pluginManager.initializeOnStartup() to avoid
  // attempting to load real npm packages in the test environment.

  // AuthService requires raw DB and pluginManager
  const authService = new AuthService(rawDb, pluginManager, storage);

  const orchestrator = new ScanOrchestrator(storage, reportsDir, 2);

  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Replace reply.view with a JSON-returning stub so tests can inspect template data
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  // ── Core routes ────────────────────────────────────────────────────────────
  await authRoutes(server, config, authService, storage);
  await homeRoutes(server, storage, config);
  await scanRoutes(server, storage, orchestrator, config);
  await compareRoutes(server, storage);
  await reportRoutes(server, storage);

  // ── Additional core routes ─────────────────────────────────────────────────
  await scheduleRoutes(server, storage);
  await manualTestRoutes(server, storage);
  await assignmentRoutes(server, storage);
  await trendRoutes(server, storage);
  await orgRoutes(server, storage);
  await repoRoutes(server, storage);
  await toolRoutes(server);

  // ── Admin routes ───────────────────────────────────────────────────────────
  await roleRoutes(server, storage);
  await teamRoutes(server, storage);
  await emailReportRoutes(server, storage, pluginManager);
  await apiKeyRoutes(server, storage);
  await organizationRoutes(server, storage, config.complianceUrl);
  await auditRoutes(server, storage);
  await dashboardUserRoutes(server, storage);
  await systemRoutes(server, {
    complianceUrl: config.complianceUrl,
    webserviceUrl: config.webserviceUrl,
    dbPath: config.dbPath,
  });

  // ── Admin routes that proxy to compliance API (need complianceUrl) ─────────
  await jurisdictionRoutes(server, config.complianceUrl);
  await regulationRoutes(server, config.complianceUrl);
  await proposalRoutes(server, config.complianceUrl);
  await sourceRoutes(server, config.complianceUrl);
  await webhookRoutes(server, config.complianceUrl);
  await clientRoutes(server, config.complianceUrl);
  await monitorRoutes(server, config.complianceUrl);
  // userRoutes proxies to compliance API for user management
  await userRoutes(server, config.complianceUrl);

  // ── Plugin admin/API routes (minimal PluginManager — no plugins installed) ──
  await pluginAdminRoutes(server, pluginManager, registryEntries, pluginsDir);
  await pluginApiRoutes(server, pluginManager);

  // ── API routes ─────────────────────────────────────────────────────────────
  await dataApiRoutes(server, storage);
  await exportRoutes(server, storage);
  await setupRoutes(server, storage, authService);

  server.get('/health', async () => ({ status: 'ok' }));

  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, orchestrator, config, authService, pluginManager, registryEntries, cleanup };
}

export function makeToken(role = 'admin'): string {
  const payload = {
    sub: 'test-user-id',
    username: 'testuser',
    role,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}
