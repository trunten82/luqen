import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { assignmentRoutes } from '../../src/routes/assignments.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['issues.assign']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-assignments-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await assignmentRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

async function makeScan(ctx: TestContext): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId: 'system',
  });
  return id;
}

describe('Assignment routes', () => {
  describe('GET /reports/:id/assignments', () => {
    it('returns 403 without issues.assign permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/reports/some-scan/assignments' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent scan', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/reports/non-existent-id/assignments' });
      ctx.cleanup();
      expect(response.statusCode).toBe(404);
    });

    it('returns 200 with assignments template', async () => {
      const ctx = await createTestServer();
      const scanId = await makeScan(ctx);
      const response = await ctx.server.inject({ method: 'GET', url: `/reports/${scanId}/assignments` });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('assignments.hbs');
    });

    it('includes assignments and stats in template data', async () => {
      const ctx = await createTestServer();
      const scanId = await makeScan(ctx);
      const now = new Date().toISOString();
      await ctx.storage.assignments.createAssignment({
        id: `asgn-${randomUUID()}`,
        scanId,
        issueFingerprint: 'fp-001',
        severity: 'error',
        message: 'Missing alt text',
        createdBy: 'alice',
        createdAt: now,
        updatedAt: now,
        orgId: 'system',
      });
      const response = await ctx.server.inject({ method: 'GET', url: `/reports/${scanId}/assignments` });
      ctx.cleanup();
      const body = response.json() as { data: { assignments: unknown[]; stats: { total: number } } };
      expect(body.data.assignments).toHaveLength(1);
      expect(body.data.stats.total).toBe(1);
    });
  });

  describe('POST /reports/:id/assignments', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without issues.assign permission', async () => {
      const noPerm = await createTestServer([]);
      const scanId = await makeScan(noPerm);
      const response = await noPerm.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/assignments`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'issueFingerprint=fp-001&severity=error&message=Test',
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 400 when required fields missing', async () => {
      const scanId = await makeScan(ctx);
      const response = await ctx.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/assignments`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ severity: 'error', message: 'Test' }),
      });
      expect(response.statusCode).toBe(400);
    });

    it('creates an assignment and returns JSON when accept is application/json', async () => {
      const scanId = await makeScan(ctx);
      const response = await ctx.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/assignments`,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        payload: JSON.stringify({
          issueFingerprint: 'fp-001',
          severity: 'error',
          message: 'Missing alt text',
        }),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { id: string; status: string };
      expect(body.id).toBeDefined();
      expect(body.status).toBe('open');
    });

    it('returns info HTML when assignment already exists', async () => {
      const scanId = await makeScan(ctx);
      const now = new Date().toISOString();
      await ctx.storage.assignments.createAssignment({
        id: `asgn-${randomUUID()}`,
        scanId,
        issueFingerprint: 'fp-dup',
        severity: 'error',
        message: 'Duplicate',
        createdBy: 'alice',
        createdAt: now,
        updatedAt: now,
        orgId: 'system',
      });
      const response = await ctx.server.inject({
        method: 'POST',
        url: `/reports/${scanId}/assignments`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ issueFingerprint: 'fp-dup', severity: 'error', message: 'Duplicate' }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Already assigned');
    });
  });

  describe('PATCH /assignments/:id', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 404 for non-existent assignment', async () => {
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: '/assignments/non-existent-id',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'in-progress' }),
      });
      expect(response.statusCode).toBe(404);
    });

    it('updates an assignment status and returns HTML', async () => {
      const scanId = await makeScan(ctx);
      const now = new Date().toISOString();
      const asgn = await ctx.storage.assignments.createAssignment({
        id: `asgn-${randomUUID()}`,
        scanId,
        issueFingerprint: 'fp-002',
        severity: 'error',
        message: 'Test issue',
        createdBy: 'alice',
        createdAt: now,
        updatedAt: now,
        orgId: 'system',
      });
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: `/assignments/${asgn.id}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'in-progress' }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });

    it('returns 400 for invalid status value', async () => {
      const scanId = await makeScan(ctx);
      const now = new Date().toISOString();
      const asgn = await ctx.storage.assignments.createAssignment({
        id: `asgn-${randomUUID()}`,
        scanId,
        issueFingerprint: 'fp-003',
        severity: 'warning',
        message: 'Test warning',
        createdBy: 'alice',
        createdAt: now,
        updatedAt: now,
        orgId: 'system',
      });
      const response = await ctx.server.inject({
        method: 'PATCH',
        url: `/assignments/${asgn.id}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'invalid-status' }),
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /assignments/:id', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without issues.assign permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({ method: 'DELETE', url: '/assignments/some-id' });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent assignment', async () => {
      const response = await ctx.server.inject({ method: 'DELETE', url: '/assignments/non-existent-id' });
      expect(response.statusCode).toBe(404);
    });

    it('deletes an assignment and returns HTML stats', async () => {
      const scanId = await makeScan(ctx);
      const now = new Date().toISOString();
      const asgn = await ctx.storage.assignments.createAssignment({
        id: `asgn-${randomUUID()}`,
        scanId,
        issueFingerprint: 'fp-004',
        severity: 'error',
        message: 'To be deleted',
        createdBy: 'alice',
        createdAt: now,
        updatedAt: now,
        orgId: 'system',
      });
      const response = await ctx.server.inject({ method: 'DELETE', url: `/assignments/${asgn.id}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      const deleted = await ctx.storage.assignments.getAssignment(asgn.id);
      expect(deleted).toBeNull();
    });
  });
});
