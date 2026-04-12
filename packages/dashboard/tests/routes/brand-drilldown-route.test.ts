import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { loadTranslations } from '../../src/i18n/index.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  reportsDir: string;
  cleanup: () => void;
}

async function createTestServer(): Promise<TestContext> {
  loadTranslations();
  const dbPath = join(tmpdir(), `test-drilldown-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-drilldown-dir-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'text/html').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'user-1',
      username: 'testuser',
      role: 'admin',
      currentOrgId: 'system',
    };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set([
      'reports.delete',
      'scans.create',
    ]);
  });

  await reportRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, reportsDir, cleanup };
}

function makeBrandedReportJson(): string {
  return JSON.stringify({
    summary: {
      url: 'https://example.com',
      pagesScanned: 1,
      pagesFailed: 0,
      totalIssues: 3,
      byLevel: { error: 3, warning: 0, notice: 0 },
    },
    pages: [
      {
        url: 'https://example.com',
        issueCount: 3,
        issues: [
          {
            type: 'error',
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
            message: 'Low contrast on heading',
            selector: 'h1.hero',
            context: '<h1 class="hero" style="color:#aaa">Title</h1>',
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'Brand blue #003399' },
          },
          {
            type: 'error',
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_12.C36',
            message: 'Font mismatch',
            selector: 'body',
            context: '<body style="font-family:Comic Sans">',
            brandMatch: { matched: true, strategy: 'font', matchDetail: 'Expected Roboto' },
          },
          {
            type: 'error',
            code: 'WCAG2AA.Principle4.Guideline4_1.4_1_2.H91',
            message: 'Button style mismatch',
            selector: '.btn-primary',
            context: '<button class="btn-primary">Submit</button>',
            brandMatch: { matched: true, strategy: 'selector', matchDetail: '.btn-primary token mismatch' },
          },
        ],
      },
    ],
    errors: [],
  });
}

async function makeScanWithReport(ctx: TestContext): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'testuser',
    createdAt: new Date().toISOString(),
    orgId: 'system',
  });
  await ctx.storage.scans.updateScan(id, { status: 'completed' });

  const jsonPath = join(ctx.reportsDir, `report-${id}.json`);
  await writeFile(jsonPath, makeBrandedReportJson(), 'utf-8');
  await ctx.storage.scans.updateScan(id, { jsonReportPath: jsonPath });

  return id;
}

describe('GET /reports/:id/brand-drilldown', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns 200 with HTML for valid color dimension', async () => {
    const scanId = await makeScanWithReport(ctx);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/reports/${scanId}/brand-drilldown?dimension=color`,
    });
    expect(res.statusCode).toBe(200);
    // reply.view returns our JSON stub with template name
    const body = JSON.parse(res.body);
    expect(body.template).toBe('partials/brand-drilldown-modal.hbs');
    expect(body.data.dimension).toBe('color');
    expect(body.data.issues).toBeInstanceOf(Array);
    expect(body.data.issues.length).toBeGreaterThan(0);
  });

  it('returns 200 with HTML for typography dimension', async () => {
    const scanId = await makeScanWithReport(ctx);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/reports/${scanId}/brand-drilldown?dimension=typography`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.dimension).toBe('typography');
    expect(body.data.issues.length).toBeGreaterThan(0);
  });

  it('returns 200 with HTML for components dimension', async () => {
    const scanId = await makeScanWithReport(ctx);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/reports/${scanId}/brand-drilldown?dimension=components`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.dimension).toBe('components');
    expect(body.data.issues.length).toBeGreaterThan(0);
  });

  it('returns 400 when dimension is missing', async () => {
    const scanId = await makeScanWithReport(ctx);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/reports/${scanId}/brand-drilldown`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when dimension is invalid', async () => {
    const scanId = await makeScanWithReport(ctx);
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/reports/${scanId}/brand-drilldown?dimension=bogus`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when scan does not exist', async () => {
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/reports/${randomUUID()}/brand-drilldown?dimension=color`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when scan is not completed', async () => {
    const id = randomUUID();
    await ctx.storage.scans.createScan({
      id,
      siteUrl: 'https://example.com',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'testuser',
      createdAt: new Date().toISOString(),
      orgId: 'system',
    });
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/reports/${id}/brand-drilldown?dimension=color`,
    });
    expect(res.statusCode).toBe(404);
  });
});
