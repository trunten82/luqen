import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { manualTestRoutes } from '../../src/routes/manual-tests.js';
import { MANUAL_CRITERIA } from '../../src/manual-criteria.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';
const CRITERION = MANUAL_CRITERIA[0].id;

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  uploadsDir: string;
  cleanup: () => void;
}

async function createTestServer(
  userOverride?: { role: string; currentOrgId: string },
): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-evidence-${randomUUID()}.db`);
  const uploadsDir = join(tmpdir(), `test-uploads-${randomUUID()}`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/multipart'), { limits: { fileSize: 5 * 1024 * 1024 } });
  await registerSession(server, TEST_SESSION_SECRET);
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });

  const role = userOverride?.role ?? 'admin';
  const orgId = userOverride?.currentOrgId ?? 'system';
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role, currentOrgId: orgId };
  });

  await manualTestRoutes(server, storage, uploadsDir);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
    void server.close();
  };
  return { server, storage, uploadsDir, cleanup };
}

async function makeScan(ctx: TestContext, orgId = 'system'): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId,
  });
  return id;
}

/** Build a minimal multipart/form-data body for a single file part. */
function multipart(
  fileName: string,
  mime: string,
  bytes: Buffer,
): { headers: Record<string, string>; payload: Buffer } {
  const boundary = '----luqentestboundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload };
}

describe('Manual Test Evidence Routes', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestServer();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  it('uploads an image, persists it, and returns the evidence list fragment', async () => {
    const scanId = await makeScan(ctx);
    const { headers, payload } = multipart('shot.png', 'image/png', Buffer.from('\x89PNG fake bytes'));

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/reports/${scanId}/evidence/${encodeURIComponent(CRITERION)}`,
      headers,
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('shot.png');
    expect(res.body).toContain(`data-count="1"`);

    const rows = await ctx.storage.manualTestEvidence.listEvidence(scanId);
    expect(rows).toHaveLength(1);
    expect(rows[0].criterionId).toBe(CRITERION);
    expect(rows[0].mimeType).toBe('image/png');
    expect(existsSync(join(ctx.uploadsDir, 'system', 'evidence'))).toBe(true);
  });

  it('accepts a PDF', async () => {
    const scanId = await makeScan(ctx);
    const { headers, payload } = multipart('report.pdf', 'application/pdf', Buffer.from('%PDF-1.4 fake'));
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/reports/${scanId}/evidence/${encodeURIComponent(CRITERION)}`,
      headers,
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect((await ctx.storage.manualTestEvidence.listEvidence(scanId))).toHaveLength(1);
  });

  it('rejects a disallowed mime type (400)', async () => {
    const scanId = await makeScan(ctx);
    const { headers, payload } = multipart('evil.txt', 'text/plain', Buffer.from('hello'));
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/reports/${scanId}/evidence/${encodeURIComponent(CRITERION)}`,
      headers,
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect((await ctx.storage.manualTestEvidence.listEvidence(scanId))).toHaveLength(0);
  });

  it('rejects an unknown criterion (400)', async () => {
    const scanId = await makeScan(ctx);
    const { headers, payload } = multipart('shot.png', 'image/png', Buffer.from('bytes'));
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/reports/${scanId}/evidence/99.99.99`,
      headers,
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('deletes an evidence file', async () => {
    const scanId = await makeScan(ctx);
    const { headers, payload } = multipart('shot.png', 'image/png', Buffer.from('bytes'));
    await ctx.server.inject({
      method: 'POST',
      url: `/reports/${scanId}/evidence/${encodeURIComponent(CRITERION)}`,
      headers,
      payload,
    });
    const [row] = await ctx.storage.manualTestEvidence.listEvidence(scanId);

    const del = await ctx.server.inject({
      method: 'POST',
      url: `/reports/${scanId}/evidence/${row.id}/delete`,
    });
    expect(del.statusCode).toBe(200);
    expect(del.body).toContain('data-count="0"');
    expect(await ctx.storage.manualTestEvidence.listEvidence(scanId)).toHaveLength(0);
  });

  it('returns 404 when a non-admin uploads to another org\'s scan', async () => {
    const other = await createTestServer({ role: 'member', currentOrgId: 'org-a' });
    const scanId = await makeScan(other, 'other-org');
    const { headers, payload } = multipart('shot.png', 'image/png', Buffer.from('bytes'));
    const res = await other.server.inject({
      method: 'POST',
      url: `/reports/${scanId}/evidence/${encodeURIComponent(CRITERION)}`,
      headers,
      payload,
    });
    other.cleanup();
    expect(res.statusCode).toBe(404);
  });
});
