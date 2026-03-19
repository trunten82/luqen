import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { ScanDb } from '../../src/db/scans.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { authRoutes } from '../../src/routes/auth.js';
import { homeRoutes } from '../../src/routes/home.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { scanRoutes } from '../../src/routes/scan.js';
import type { DashboardConfig } from '../../src/config.js';
import { registerSession } from '../../src/auth/session.js';

// 32-byte test secret
const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

export interface TestContext {
  server: FastifyInstance;
  db: ScanDb;
  orchestrator: ScanOrchestrator;
  config: DashboardConfig;
  cleanup: () => void;
}

export async function createTestServer(): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-dashboard-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

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

  const db = new ScanDb(dbPath);
  db.initialize();

  const orchestrator = new ScanOrchestrator(db, reportsDir, 2);

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

  await authRoutes(server, config);
  await homeRoutes(server, db);
  await scanRoutes(server, db, orchestrator, config);
  await reportRoutes(server, db);

  server.get('/health', async () => ({ status: 'ok' }));

  await server.ready();

  const cleanup = (): void => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, db, orchestrator, config, cleanup };
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
